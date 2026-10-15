-- The last Task Manager read still driving its join from the wrong side.
--
-- fetchAnalyticsData's task page query is the same shape the calendar reads had before
-- perf_task_calendar_join_direction.sql: `tasks?select=...,task_assignees!inner(user_id)`,
-- which PostgREST renders as a LATERAL driven from `tasks`. It measured 94.3ms mean
-- against an 8-row sample — low volume, off the 08:45 path, which is why it was left
-- alone during the outage fix. It is the same defect, and it would bite the moment the
-- Analytics tab lands on a hot page.
--
-- Paging is kept: the caller still walks 1000 rows at a time, because a staff member
-- with daily recurring tasks can exceed PostgREST's response cap inside one period.
-- The ordering is explicit and total (created_at, then id) so the pages cannot overlap
-- or skip rows when two tasks share a created_at.
--
-- Filters mirror the PostgREST query exactly:
--   status <> 'dismissed'
--   AND (due_date >= p_cutoff_date OR (due_date IS NULL AND created_at >= p_cutoff_ts))

CREATE OR REPLACE FUNCTION public.task_stats_rows_for_user(
  p_user_id     uuid,
  p_cutoff_date date,
  p_cutoff_ts   timestamptz,
  p_offset      integer,
  p_limit       integer
)
RETURNS TABLE (
  status        text,
  require_check boolean,
  due_date      date,
  bonus_points  integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT t.status, t.require_check, t.due_date, t.bonus_points
  FROM public.task_assignees ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE ta.user_id = p_user_id
    AND t.status <> 'dismissed'
    AND (t.due_date >= p_cutoff_date
         OR (t.due_date IS NULL AND t.created_at >= p_cutoff_ts))
  ORDER BY t.created_at, t.id
  OFFSET p_offset
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.task_stats_rows_for_user(uuid, date, timestamptz, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_stats_rows_for_user(uuid, date, timestamptz, integer, integer) TO authenticated;
