-- Morning-peak hardening for the Task Manager queries.
--
-- At 08:45 every weekday the whole staff opens the app at once. Three cheap-looking
-- reads turned that into a database-wide outage:
--
--   1. The unread-comment badge (Navbar + BottomNav, so twice per page) pulled every
--      task_assignees row for the user — 1,636 for the busiest staff member — and fed
--      them back as a 1,636-element IN list. 164,354 calls and counting.
--   2. task_comments had no index on created_at, so that count sequentially scanned
--      the table every time.
--   3. The calendar's task reads drive their join from `tasks`, so each one walks every
--      open task in the school before filtering down to the handful the user is on.
--
-- None of it mattered with ten people online. With eighty it saturated PostgREST's
-- connection pool, and once the pool was full PostgREST could not run its own schema
-- cache query either — so every endpoint started answering PGRST002 / 503, including
-- login. This migration removes reasons 1 and 2; the join direction is fixed in
-- src/lib/tasks.ts.
--
-- Everything here is additive: dropping the function and the indexes restores the
-- previous behaviour exactly.

-- The badge's real access path: "comments newer than the last time this user looked".
-- p_since is recent in the steady state, so leading with created_at keeps the scan
-- proportional to what is actually new rather than to the size of the table.
CREATE INDEX IF NOT EXISTS idx_task_comments_created_at
  ON public.task_comments USING btree (created_at DESC);

-- Serves the per-task probe when a user has few assignments and many comments are new.
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id_created_at
  ON public.task_comments USING btree (task_id, created_at DESC);

-- One indexed count in place of (a) a 1,636-row fetch and (b) a 1,636-element IN.
--
-- SECURITY INVOKER (the default) is deliberate: the existing RLS policies on
-- task_comments and task_assignees still apply, so this grants no visibility the
-- caller did not already have through PostgREST.
--
-- auth.uid() is wrapped in a scalar sub-select so the planner evaluates it once for
-- the statement instead of re-running it per candidate row.
CREATE OR REPLACE FUNCTION public.task_unread_comment_count(p_since timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.task_comments c
  WHERE c.created_at > p_since
    AND c.user_id <> (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.task_assignees ta
      WHERE ta.task_id = c.task_id
        AND ta.user_id = (SELECT auth.uid())
    );
$$;

COMMENT ON FUNCTION public.task_unread_comment_count(timestamptz) IS
  'Unread task-comment count for the calling user since p_since. Replaces the '
  'two-query badge path (assignee id list -> IN filter) that made the 08:45 peak '
  'exhaust the PostgREST connection pool.';

REVOKE ALL ON FUNCTION public.task_unread_comment_count(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_unread_comment_count(timestamptz) TO authenticated;
