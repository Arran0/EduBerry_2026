# Task Manager and Projects

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md).

## 1. Summary

The staff Task Manager: tasks assigned to staff with a due date, a time or timetable period, optional classes, checklist, comments with attachments, recurrence, a "bonus" tag with points, and an optional verification step (done → checked by a coordinator). Teachers can generate a week of period-by-period tasks from their timetable or import a planner spreadsheet. Projects group subtasks on a board with members, optional sequential mode, checklists and comments. Coordinators see team analytics.

This is the busiest part of the app today: `tasks` (57,917 rows) and `task_assignees` (57,901) are the two largest tables, about 10,000 new tasks a month for 86 teachers (40,799 tasks are tied to a timetable period), and task queries account for most rows read (32 million index fetches on `tasks` in 13 days). At 700 staff that becomes roughly 80,000 tasks a month.

What changes: each task row already has exactly one assignee (assigning to N people creates N rows), so `task_assignees` folds into a column on `tasks`, halving rows and writes; `tasks` keeps far fewer than today's 10 indexes; week views read from one indexed query per person; closed academic years move to the archive.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/tasks` (581 lines) | Staff | Weekly calendar of own tasks and project subtasks; create tasks; detail sheet (status, checklist, comments, submission); overdue list; verification queue; analytics; team analytics (coordinators) |
| Planner (`PlannerModal`) | Teachers | Download a day-wise and period-wise planner template, fill it, import tasks |
| Timetable suggest (`TimetableSuggestSheet`) | Teachers | Create a week of tasks from the published timetable |
| Projects (`ProjectsList`, `ProjectCard`, `NewProjectForm`, `SubtaskCard`) | Staff | Project boards with members and subtasks |
| Home | Staff | Task calendar card (`homeTaskCalendarVisibility`), overdue and unread comment counts |

Code: `src/lib/tasks.ts` (1,137 lines), `projects.ts` (621), `planner.ts`, `taskClasses.ts`, `taskSlots.ts`, `useTaskNotifications`, `/api/analytics/team` (331 lines), 15 components under `src/components/tasks`.

## 3. How it works today

- **Statuses:** `not_done`, `partial`, `done`, `checked` (verified), `dismissed`. Tasks with `require_check` need a verifier (`canVerifyTask`: coordinators of the assignee's team, principal, admin) to move `done` → `checked`. Tasks with `requires_submission` need a note before `done`.
- **Create:** one row per assignee with identical content, then assignees and checklist rows. Duplicate-title, period-conflict and slot-conflict checks run first (`checkDuplicateTaskTitle`, `checkTaskPeriodConflict`, `checkTaskSlotConflict`).
- **Recurrence:** `none` (57,264), `weekly` (378), `daily` (250), `monthly` (25); recurring tasks are expanded when the week is read (`tasks_for_user_week`).
- **Bonus points:** `tag = 'bonus'` with `bonus_points`, summed by `tasks_bonus_for_user`; feed into gamification and the salary bonus snapshot ([34](34-payroll-and-salary.md)).
- **Comments:** text plus one attachment (public bucket, `task-comments/`); unread counts by `task_unread_comment_count(since)` polled from the browser.
- **Projects:** members, subtasks with assignee, status, due date, timing, bonus points, verification, sequential mode; subtask checklists and comments; subtask attachments target a `subtask-attachments` bucket that does not exist on live ([15](15-files-and-media.md)).
- **Analytics:** per-person stats (`task_stats_rows_for_user`), team analytics (`/api/analytics/team` pages through all tasks and subtasks of a month for every team member, because Supabase caps responses at 1,000 rows), monthly member stats (`get_monthly_member_stats`, shared with attendance).
- **Delete account:** the person's created tasks are deleted (see [20](20-users-profiles-and-admin.md)).
- **Calendar sharing:** `calendar_access` lets one person view another's calendar (0 rows on live).

## 4. Data

| Table | Rows | Notes |
| --- | --- | --- |
| `tasks` | 57,917 | 22 columns; `classes text[]`; 10 indexes |
| `task_assignees` | 57,901 | 37 tasks have more than one row, 155 have none (both are anomalies of the "one row per assignee" rule) |
| `task_checklist_items` | 764 | |
| `task_comments` | 1,410 | Attachment URL, name and type |
| `projects` | 23 | Sequential mode flag |
| `project_members` | 264 | |
| `subtasks` | 298 | Assignee, status, bonus, verification |
| `subtask_checklist_items` | 3 | |
| `subtask_comments` | 189 | |
| `subtask_comment_attachments` | 0 | |
| `calendar_access` | 0 | Owner ↔ viewer |

## 5. Logic in the database

| Function | Target |
| --- | --- |
| `tasks_for_user_week` | `tasks.week(userId, weekStart)`: one indexed query by assignee and due date plus recurring templates |
| `tasks_overdue_for_user` | `tasks.overdue(userId)` |
| `tasks_bonus_for_user` | `tasks.bonusTotal(userId, range)`, from a per-person monthly summary |
| `task_stats_rows_for_user` | `tasks.stats(userId, period)` |
| `task_unread_comment_count` | `tasks.unreadComments(userId)`; later a live channel |
| `get_monthly_member_stats` | `analytics.memberMonth(memberIds, month)` (shared with attendance) |
| `record_app_open` | Owned by [37](37-home-profile-and-misc.md) (streaks) |
| Row-level security (staff only) | `tasks.*` permission (teacher, coordinator, principal, admin) plus assignee/creator/verifier relationship checks |

## 6. Server routes and integrations

`/api/analytics/team` becomes `tasks.teamAnalytics(month)`, computed inside the object from summaries, with no 1,000-row paging workaround.

## 7. Jobs, files and live updates

- **Files:** `tasks/<taskId>/...` for task and subtask comment attachments, private to staff who can see the task.
- **Jobs:** nightly maintenance rolls up per-person monthly counts; year-end archive of tasks older than the previous academic year.
- **Live updates:** optional `tasks:user:<id>` channel for comment and verification counts.

## 8. Single-tenant assumptions

None specific.

## 9. Target design

### Tables

| Table | Change |
| --- | --- |
| `tasks` | Add `assignee_id` (from `task_assignees`); keep `task_assignees` only if multi-assignee tasks are wanted (today's 37 multi rows are anomalies). `classes` stays a JSON array (only filtered by the planner) |
| `task_checklist_items`, `task_comments` | Carried over |
| `projects`, `project_members`, `subtasks`, `subtask_checklist_items`, `subtask_comments`, `subtask_comment_attachments`, `calendar_access` | Carried over |
| New `task_stats_monthly` | Per person per month: assigned, done, checked, overdue, bonus points; updated on each status change |

Indexes on `tasks`, the most important cost decision in this section (each index adds a billed row to every task write):

| Index | Serves |
| --- | --- |
| `(assignee_id, due_date)` | Week view, overdue list, analytics |
| `(created_by, created_at)` | "Tasks I assigned" and verification queue |
| `(status, require_check, due_date)` partial `WHERE status = 'done' AND require_check = 1` | Verification queue |

Everything else today's 10 indexes cover is served by these three or by `task_stats_monthly`.

### Methods

| Method | Permission | Notes |
| --- | --- | --- |
| `tasks.week`, `tasks.overdue`, `tasks.get` | staff; assignee, creator, verifier, team coordinator | Week call returns tasks, subtasks and counts in one response |
| `tasks.create`, `tasks.createFromTimetable`, `tasks.importPlanner` | `tasks.assign` (staff); assigning to others limited to team members for teachers, anyone for coordinators and above (as today) | Conflict checks run in the same call |
| `tasks.setStatus`, `tasks.submit`, `tasks.verify` | assignee; verifier for `checked` | Updates `task_stats_monthly` |
| `tasks.update`, `tasks.delete` | creator; principal, admin | |
| `tasks.checklist.*`, `tasks.comment`, `tasks.unreadComments` | as `tasks.get` | |
| `tasks.analytics(period)`, `tasks.teamAnalytics(month)` | self; coordinators for their teams; principal, admin | From summaries |
| `projects.*` (list, create, update, delete, members, subtasks, checklist, comments) | project members; creator; principal, admin | |
| `calendar.grantAccess`, `calendar.revoke` | owner | |

## 10. Moving existing data

- `tasks` + `task_assignees` → `tasks.assignee_id`: one row per task; for the 37 tasks with several assignee rows, split into one task per extra assignee (matching the "one row per assignee" rule) and report them; for the 155 tasks with no assignee, assign to the creator (as `createTask` does) or drop, after review.
- Comment attachment URLs → R2 keys.
- Build `task_stats_monthly` from history.
- Tasks from closed academic years go straight into the year's archive object.

## 11. Parity checklist

- [ ] The weekly calendar, overdue list, verification queue and analytics show the same items and numbers as today for the imported data.
- [ ] Creating a task for N people creates N independent tasks.
- [ ] Duplicate-title and period/slot conflict warnings appear exactly as today.
- [ ] Recurring tasks appear on the right days.
- [ ] `require_check` and `requires_submission` rules hold; only allowed verifiers can check.
- [ ] Planner import accepts today's template; timetable-generated weeks match.
- [ ] Bonus totals match those used for salary bonus snapshots.
- [ ] Team analytics for a busy month return complete counts (no 1,000-row truncation).

## 12. Open questions

- [ ] Are multi-assignee tasks wanted (one task, several people), or is "one copy each" the rule?
- [ ] Should timetable-period tasks be generated on demand instead of stored (they are 70% of all tasks)?
