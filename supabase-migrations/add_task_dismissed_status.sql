-- ============================================================================
-- add_task_dismissed_status  —  allow 'dismissed' on tasks & subtasks
-- ============================================================================
-- Run this in the Supabase SQL Editor.
--
-- Adds a fifth status value, 'dismissed', to both tasks.status and
-- subtasks.status. A verifier uses it to wave off a task/subtask that requires
-- verification but should not count toward anyone's stats — it is rendered in
-- grey in the UI and treated as "deleted" by every analytics calculation
-- (see get_monthly_member_stats.sql, which already excludes it).
--
-- Inline column CHECK constraints are auto-named "<table>_status_check"; we drop
-- and recreate them with the expanded value list. IF EXISTS keeps this idempotent.

ALTER TABLE public.tasks   DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('not_done', 'partial', 'done', 'checked', 'dismissed'));

ALTER TABLE public.subtasks DROP CONSTRAINT IF EXISTS subtasks_status_check;
ALTER TABLE public.subtasks
  ADD CONSTRAINT subtasks_status_check
  CHECK (status IN ('not_done', 'partial', 'done', 'checked', 'dismissed'));
