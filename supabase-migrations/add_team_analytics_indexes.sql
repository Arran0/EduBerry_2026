-- ============================================================================
-- Composite indexes for Team Analytics monthly report performance
-- ============================================================================
-- Run in the Supabase SQL Editor.
--
-- The get_monthly_member_stats RPC performs two hot JOIN/filter patterns:
--
--   1. task_assignees: filter by user_id → join task_id to tasks
--      A composite (user_id, task_id) index lets Postgres satisfy both the
--      WHERE and the JOIN column from a single index scan (covering index).
--
--   2. subtasks: filter by assignee_id + due_date range
--      A composite (assignee_id, due_date) index enables an efficient range
--      scan on both columns instead of two separate single-column lookups.
--      A matching partial index for the due_date IS NULL branch
--      (filtered by created_at) covers the undated-task path.
--
-- All indexes are created with IF NOT EXISTS so re-running is safe.

-- task_assignees: cover user_id lookup + task_id JOIN in one index scan
CREATE INDEX IF NOT EXISTS idx_task_assignees_user_id_task_id
  ON public.task_assignees (user_id, task_id);

-- subtasks: cover assignee_id + due_date range scan (dated tasks)
CREATE INDEX IF NOT EXISTS idx_subtasks_assignee_due_date
  ON public.subtasks (assignee_id, due_date)
  WHERE due_date IS NOT NULL;

-- subtasks: cover assignee_id + created_at range scan (undated tasks)
CREATE INDEX IF NOT EXISTS idx_subtasks_assignee_created_at
  ON public.subtasks (assignee_id, created_at)
  WHERE due_date IS NULL;

-- tasks: cover due_date IS NULL + created_at range scan (undated tasks)
CREATE INDEX IF NOT EXISTS idx_tasks_created_at_no_due_date
  ON public.tasks (created_at)
  WHERE due_date IS NULL;
