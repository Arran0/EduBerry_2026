-- Monthly member stats RPC
-- Replaces the multi-query approach in /api/analytics/team that was hitting
-- Supabase's 1000-row default limit for admin / principal views.
--
-- Returns ONE row per member with aggregated task + subtask stats for the
-- current calendar month.  Result set size == number of members who have at
-- least one task/subtask that month — always well under 1000.
--
-- SECURITY DEFINER so it works even when called via the anon key (fallback
-- path in the API route when SUPABASE_SERVICE_ROLE_KEY is not set).

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
  WITH task_rows AS (
    -- One row per task assignment that falls in the requested month
    SELECT
      ta.user_id,
      (t.status IN ('done', 'checked'))                                           AS is_completed,
      CASE WHEN t.status IN ('done', 'checked')
           THEN COALESCE(t.bonus_points, 0) ELSE 0 END                           AS bp,
      (
        t.due_date IS NOT NULL
        AND t.due_date < CURRENT_DATE
        AND t.status NOT IN ('done', 'checked')
      )                                                                            AS is_overdue
    FROM task_assignees ta
    JOIN tasks t ON t.id = ta.task_id
    WHERE ta.user_id = ANY(p_member_ids)
      AND (
        -- task is due this month or later
        (t.due_date IS NOT NULL AND t.due_date >= p_month_start)
        -- or no due-date but was created this month
        OR (t.due_date IS NULL AND t.created_at >= p_month_start_ts)
      )
  ),
  subtask_rows AS (
    -- One row per subtask that falls in the requested month
    SELECT
      s.assignee_id                                                                AS user_id,
      (s.status IN ('done', 'checked'))                                           AS is_completed,
      CASE WHEN s.status IN ('done', 'checked')
           THEN COALESCE(s.bonus_points, 0) ELSE 0 END                           AS bp,
      (
        s.due_date IS NOT NULL
        AND s.due_date < CURRENT_DATE
        AND s.status NOT IN ('done', 'checked')
      )                                                                            AS is_overdue
    FROM subtasks s
    WHERE s.assignee_id = ANY(p_member_ids)
      AND (
        (s.due_date IS NOT NULL AND s.due_date >= p_month_start)
        OR (s.due_date IS NULL AND s.created_at >= p_month_start_ts)
      )
  ),
  all_rows AS (
    SELECT * FROM task_rows
    UNION ALL
    SELECT * FROM subtask_rows
  )
  -- Aggregate: one output row per member
  SELECT
    user_id,
    COUNT(*) FILTER (WHERE is_completed)::BIGINT  AS completed,
    SUM(bp)::BIGINT                               AS bonus,
    COUNT(*) FILTER (WHERE is_overdue)::BIGINT    AS overdue,
    COUNT(*)::BIGINT                              AS total
  FROM all_rows
  GROUP BY user_id
$$;
