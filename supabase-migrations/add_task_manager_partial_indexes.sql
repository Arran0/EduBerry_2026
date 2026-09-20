-- ============================================================================
-- Task Manager hot-path partial indexes
-- ============================================================================
-- Applied to the live project (tgxxqzeaqxiwoqzopcku). Safe to re-run.
--
-- The tasks table is large (~44k rows) but every Task Manager hot query targets
-- a small, permanently-selective slice of it. Plain single-column indexes on
-- created_by / status / bonus_points still forced a bitmap heap scan over every
-- one of a user's rows, with the real predicate applied as a post-filter.
--
-- Measured on the largest real account (1,488 authored / 1,376 assigned tasks):
--
--   fetchTasksAwaitingVerification  569 heap blocks, 204 ms  →  1 buffer, 0.06 ms
--   fetchOverdueTasks               4,698 buffers            →  1,726 buffers
--   fetchBonusTasksForCalendar      4,698 buffers            →  1,437 buffers
--
-- The predicates below are immutable (no CURRENT_DATE), so they are valid as
-- partial-index predicates and keep the indexes tiny: 2 / 1,675 / 1,071 rows
-- out of 43,792.

-- fetchTasksAwaitingVerification: tasks I assigned that the assignee has now
-- marked "Checking". Runs on every Weekly tab render and again after every
-- task status change, so it is the single hottest query in the app.
CREATE INDEX IF NOT EXISTS idx_tasks_awaiting_verification
  ON public.tasks (created_by, due_date)
  WHERE status = 'done' AND require_check;

-- fetchOverdueTasks: the calendar's Overdue panel. The due_date/CURRENT_DATE
-- half of the filter stays a post-filter (CURRENT_DATE is not immutable); the
-- status half is what removes 96% of the table.
CREATE INDEX IF NOT EXISTS idx_tasks_open_or_checking
  ON public.tasks (created_at DESC)
  WHERE status IN ('not_done', 'partial') OR (status = 'done' AND require_check);

-- fetchBonusTasksForCalendar: the calendar's Bonus panel.
CREATE INDEX IF NOT EXISTS idx_tasks_bonus_flagged
  ON public.tasks (created_at DESC)
  WHERE bonus_points <> 0 OR tag = 'bonus';

-- ----------------------------------------------------------------------------
-- Drop idx_tasks_status_due_date_created (add_tasks_overdue_index.sql).
-- ----------------------------------------------------------------------------
-- It was added for fetchOverdueTasks, but the planner never chose it — confirmed
-- by the Supabase performance advisor's unused_index lint and by EXPLAIN —
-- because a leading equality on `status` cannot serve that query's OR'd status
-- predicate. idx_tasks_open_or_checking above expresses the same intent as a
-- partial index and the planner does use it. Keeping the old index only costs
-- write amplification on every insert and status change.
DROP INDEX IF EXISTS public.idx_tasks_status_due_date_created;

NOTIFY pgrst, 'reload schema';
