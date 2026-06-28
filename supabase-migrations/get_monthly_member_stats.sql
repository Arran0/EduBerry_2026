-- ============================================================================
-- get_monthly_member_stats  —  Team analytics aggregation (canonical version)
-- ============================================================================
-- Run this in the Supabase SQL Editor.
--
-- Used by  /api/analytics/team  to power the Team section of the task manager.
-- It aggregates tasks + subtasks per member ENTIRELY in Postgres and returns
-- ONE row per member, so:
--   • it is immune to Supabase's 1000-row response cap (which silently
--     truncated the old client-side row fetching and made every staffer's
--     task / bonus counts come out far too low), and
--   • it needs no giant `IN (...)` URL filters.
--
-- A task/subtask "belongs to" the selected month when:
--   • it has a due_date inside [month_start, month_end), OR
--   • it has no due_date but was created inside the same window.
-- completed / bonus / overdue / total all derive from the CURRENT status of
-- that month's set ("how many of June's tasks are done?").
--
-- overdue cut-off = LEAST(month_end, current_date): a current-month task is
-- overdue only once its due_date is in the past; a past month is self-contained
-- and uses its own month-end, so historical reports never change over time.
--
-- SECURITY DEFINER so it also works through the anon key (the API route's
-- fallback when SUPABASE_SERVICE_ROLE_KEY is not set).

CREATE OR REPLACE FUNCTION get_monthly_member_stats(
  p_member_ids     UUID[],
  p_month_start    DATE,
  p_month_start_ts TIMESTAMPTZ
)
RETURNS TABLE (
  user_id   UUID,
  completed BIGINT,
  bonus     BIGINT,
  overdue   BIGINT,
  total     BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      (p_month_start + INTERVAL '1 month')::DATE              AS month_end,
      (p_month_start_ts + INTERVAL '1 month')::TIMESTAMPTZ    AS month_end_ts,
      LEAST((p_month_start + INTERVAL '1 month')::DATE, CURRENT_DATE) AS overdue_cutoff
  ),
  task_rows AS (
    SELECT
      ta.user_id,
      (t.status IN ('done', 'checked'))                                     AS is_completed,
      CASE WHEN t.status IN ('done', 'checked')
           THEN COALESCE(t.bonus_points, 0) ELSE 0 END                     AS bp,
      (
        t.due_date IS NOT NULL
        AND t.due_date < bounds.overdue_cutoff
        AND t.status NOT IN ('done', 'checked')
      )                                                                     AS is_overdue
    FROM task_assignees ta
    JOIN tasks t ON t.id = ta.task_id
    CROSS JOIN bounds
    WHERE ta.user_id = ANY(p_member_ids)
      AND t.status <> 'dismissed'   -- dismissed = deleted: never counted
      AND (
        (t.due_date IS NOT NULL
          AND t.due_date >= p_month_start
          AND t.due_date <  bounds.month_end)
        OR (t.due_date IS NULL
          AND t.created_at >= p_month_start_ts
          AND t.created_at <  bounds.month_end_ts)
      )
  ),
  subtask_rows AS (
    SELECT
      s.assignee_id                                                        AS user_id,
      (s.status IN ('done', 'checked'))                                     AS is_completed,
      CASE WHEN s.status IN ('done', 'checked')
           THEN COALESCE(s.bonus_points, 0) ELSE 0 END                     AS bp,
      (
        s.due_date IS NOT NULL
        AND s.due_date < bounds.overdue_cutoff
        AND s.status NOT IN ('done', 'checked')
      )                                                                     AS is_overdue
    FROM subtasks s
    CROSS JOIN bounds
    WHERE s.assignee_id = ANY(p_member_ids)
      AND s.status <> 'dismissed'   -- dismissed = deleted: never counted
      AND (
        (s.due_date IS NOT NULL
          AND s.due_date >= p_month_start
          AND s.due_date <  bounds.month_end)
        OR (s.due_date IS NULL
          AND s.created_at >= p_month_start_ts
          AND s.created_at <  bounds.month_end_ts)
      )
  ),
  all_rows AS (
    SELECT * FROM task_rows
    UNION ALL
    SELECT * FROM subtask_rows
  )
  SELECT
    user_id,
    COUNT(*) FILTER (WHERE is_completed)::BIGINT  AS completed,
    SUM(bp)::BIGINT                               AS bonus,
    COUNT(*) FILTER (WHERE is_overdue)::BIGINT    AS overdue,
    COUNT(*)::BIGINT                              AS total
  FROM all_rows
  GROUP BY user_id
$$;

GRANT EXECUTE ON FUNCTION get_monthly_member_stats(UUID[], DATE, TIMESTAMPTZ)
  TO authenticated, anon;
