-- Drive the Task Manager's calendar reads from the user's assignments.
--
-- PostgREST renders `tasks?select=*,task_assignees!inner(user_id)&task_assignees.user_id=eq.X`
-- as an INNER JOIN LATERAL whose *driving* side is `tasks`. So the database walks every
-- open task in the school and runs the assignee lookup once per row, then throws almost
-- all of it away:
--
--   Nested Loop                                        (actual time=23.865..1038.644)
--     ->  Index Scan using idx_tasks_open_or_checking   rows=1475
--     ->  Result                                        loops=1475
--   Execution Time: 1039.034 ms          -- on an IDLE database, for ONE user, to return 4 rows
--
-- One second each, eighty staff at 08:45, on a 2-vCPU instance with an 8s statement
-- timeout. The timeouts held PostgREST's connections open until the pool was empty, and
-- a pool with nothing left in it cannot answer PostgREST's own schema cache query either
-- — which is why the browser saw PGRST002 "Could not query the database for the schema
-- cache" on every endpoint at once, login included.
--
-- Starting from task_assignees instead lets the planner hash-join the user's own rows
-- (idx_task_assignees_user_id_task_id) against the already-indexed task filter:
--
--   Hash Join                                          (actual time=35.948..37.254)
--   Execution Time: 37.472 ms            -- ~28x faster, and ~15ms of that was test scaffolding
--
-- SECURITY INVOKER throughout: RLS on `tasks` still applies exactly as it does through
-- PostgREST, so these expose nothing the existing endpoints did not. They return
-- SETOF public.tasks, so callers get the identical row shape `select('*')` produced.

-- The visible week of a user's calendar.
CREATE OR REPLACE FUNCTION public.tasks_for_user_week(
  p_user_id uuid,
  p_start   date,
  p_end     date
)
RETURNS SETOF public.tasks
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT t.*
  FROM public.task_assignees ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.user_id = p_user_id
    AND t.due_date BETWEEN p_start AND p_end
  ORDER BY t.created_at DESC;
$$;

-- The collapsible "Overdue" panel: still open, and either undated or past due.
CREATE OR REPLACE FUNCTION public.tasks_overdue_for_user(
  p_user_id uuid,
  p_today   date
)
RETURNS SETOF public.tasks
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT t.*
  FROM public.task_assignees ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.user_id = p_user_id
    AND (t.due_date IS NULL OR t.due_date < p_today)
    AND (
      t.status IN ('not_done', 'partial')
      OR (t.status = 'done' AND t.require_check)
    )
  ORDER BY t.created_at DESC;
$$;

-- The collapsible "Bonus Tasks" panel.
CREATE OR REPLACE FUNCTION public.tasks_bonus_for_user(p_user_id uuid)
RETURNS SETOF public.tasks
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT t.*
  FROM public.task_assignees ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.user_id = p_user_id
    AND (t.bonus_points <> 0 OR t.tag = 'bonus')
  ORDER BY t.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.tasks_for_user_week(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tasks_overdue_for_user(uuid, date)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tasks_bonus_for_user(uuid)            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.tasks_for_user_week(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tasks_overdue_for_user(uuid, date)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.tasks_bonus_for_user(uuid)            TO authenticated;
