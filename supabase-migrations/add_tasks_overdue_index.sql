-- ============================================================================
-- Composite index for the overdue tasks query in the Weekly Calendar panel.
-- ============================================================================
--
-- The fetchOverdueTasks query (via task_assignees!inner join) filters tasks on:
--
--   (status IN ('not_done','partial') OR (status='done' AND require_check))
--   AND (due_date IS NULL OR due_date < CURRENT_DATE)
--   ORDER BY created_at DESC
--
-- The existing single-column idx_tasks_status and idx_tasks_due_date indexes
-- cannot satisfy this combined filter efficiently — Postgres must intersect
-- two separate index scans. A composite index on (status, due_date, created_at)
-- lets Postgres resolve the status + date filter and the ORDER BY in one scan.
--
-- Note: the stored is_overdue BOOLEAN column is intentionally NOT used as the
-- DB filter because it has no trigger or cron keeping it current. The query
-- filters dynamically on status + due_date, which is always accurate.

CREATE INDEX IF NOT EXISTS idx_tasks_status_due_date_created
  ON public.tasks (status, due_date, created_at DESC);
