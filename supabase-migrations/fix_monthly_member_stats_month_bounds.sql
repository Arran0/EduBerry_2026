-- Fix get_monthly_member_stats: add upper month bound so queries return
-- only the requested month, not everything from that month onwards.
--
-- The original WHERE only had  due_date >= p_month_start  with no upper
-- bound, so toggling to e.g. April returned April + May + June + ...
--
-- Also fixes is_overdue for historical months: uses the month-end as the
-- overdue cut-off instead of CURRENT_DATE, so past-month reports are
-- self-contained and don't change as time passes.

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
  WITH
  -- Compute the exclusive upper bound once so every reference is consistent.
  bounds AS (
    SELECT
      p_month_start + INTERVAL '1 month'                          AS month_end,
      (p_month_start_ts + INTERVAL '1 month')::TIMESTAMPTZ        AS month_end_ts
  ),
  task_rows AS (
    SELECT
      ta.user_id,
      (t.status IN ('done', 'checked'))                                     AS is_completed,
      CASE WHEN t.status IN ('done', 'checked')
           THEN COALESCE(t.bonus_points, 0) ELSE 0 END                     AS bp,
      (
        t.due_date IS NOT NULL
        AND t.due_date < bounds.month_end
        AND t.status NOT IN ('done', 'checked')
      )                                                                     AS is_overdue
    FROM task_assignees ta
    JOIN tasks t ON t.id = ta.task_id
    CROSS JOIN bounds
    WHERE ta.user_id = ANY(p_member_ids)
      AND (
        -- task due within this calendar month
        (t.due_date IS NOT NULL
          AND t.due_date >= p_month_start
          AND t.due_date <  bounds.month_end)
        -- or no due-date but created within this month
        OR (t.due_date IS NULL
          AND t.created_at >= p_month_start_ts
          AND t.created_at <  bounds.month_end_ts)
      )
  ),
  subtask_rows AS (
    SELECT
      s.assignee_id                                                         AS user_id,
      (s.status IN ('done', 'checked'))                                     AS is_completed,
      CASE WHEN s.status IN ('done', 'checked')
           THEN COALESCE(s.bonus_points, 0) ELSE 0 END                     AS bp,
      (
        s.due_date IS NOT NULL
        AND s.due_date < bounds.month_end
        AND s.status NOT IN ('done', 'checked')
      )                                                                     AS is_overdue
    FROM subtasks s
    CROSS JOIN bounds
    WHERE s.assignee_id = ANY(p_member_ids)
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
