# Classrooms and Coursework (LMS)

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). Assessments, marks and report cards that live inside classrooms are in [30-grades-and-report-cards.md](30-grades-and-report-cards.md).

## 1. Summary

A classroom is a subject class (for example "Grade 7 B Science") with staff and student members. Inside it: coursework and homework folders holding files (documents, links, YouTube, text) with optional due dates, submission requirements, verification and "edu points"; per-student progress and submissions; a discussion thread; an analysis tab (completion, edu-point leaderboards, assessment trends); and the assessments tab. Students see their classrooms under Academics with a game-style standings section.

Live: 325 classrooms, 10,706 memberships, 27 folders, 110 files, 1,293 progress rows, 85 submissions, 40 discussion posts; about 1 GB of files in storage, most of it classroom material.

What changes: the edu-point and analysis functions (several hard-coded to `Asia/Kolkata`) move into the classroom module and read from a points summary; files become private and served per member; the classroom manager list pages server-side as today.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/academics` (684 lines) | Students; staff | My classrooms grid (recently visited first), streaks and edu standings (`StudentGameSection`), homeroom work calendar, report cards section |
| `/classrooms/[id]` (599 lines) | Members | Tabs: Course work, Homework, Discussion, Assessments, Analysis |
| `/more/classrooms` (1,167 lines) | Admin, coordinators | Classroom Manager: create, edit (title, subject, grade, section, dates, banner, logo, coordinator), members, import a homeroom's students, close |
| `/classrooms` | — | Redirect to `/academics` |

Code: `src/lib/classrooms.ts` (2,550 lines, also report-card and marks functions), `gamification.ts`, `classroomVisits.ts` (recent-first ordering in `localStorage`), `homeClassroomsVisibility.ts`, `classroomGridLayout.ts`, `classroomPalette.ts`; 16 components under `src/components/classrooms` (`CourseWorkTab`, `HomeworkTab`, `DiscussionTab`, `AnalysisTab`, `AssessmentsTab`, `FolderFileView`, `SchoolWorkManager`, `AIAssistantFloat` (opens an external AI chat with a prompt; no API), ...).

## 3. How it works today

- **Membership.** `classroom_members` with role `student` or a staff role. Staff add members by email or import a homeroom (`importHomeroomIntoClassroom`). A classroom is "closed" after its `end_date`.
- **Folders and files.** Folders are `coursework` or `homework`; files have title, description, due date, attachment (public bucket under `<classroomId>/`), `requires_submission` (`text`, `link`, `file`), `requires_check`, `edu_points`, sort order.
- **Progress.** Students move a file through `not_done` → `partial` → `done`; staff mark `completed` when verification is required. Submissions are stored per student per file (files under `submissions/<fileId>/<studentId>/`).
- **Edu points.** A student earns a file's `edu_points` when its progress is `completed`, and a classroom smartboard task's points when completed (checked if verification is required). `_classroom_edu_earned` totals them per month (months cut in `Asia/Kolkata`); leaderboards, top 3, monthly series and the student dashboard (`get_student_edu_dashboard`, `get_student_edu_standings`) read from it.
- **Discussion.** Threaded posts (`parent_id`) with images (`discussions/<classroomId>/<userId>/`).
- **Analysis.** Completion by file and student, edu leaderboards, assessment trend (`get_classroom_assessment_trend`), all computed in the database ("DB-side analytics").
- **Classroom manager.** `classroom_manager_page(search, limit, offset)` and `classroom_member_counts` page the list server-side.

## 4. Data

| Table | Rows | Purpose |
| --- | --- | --- |
| `classrooms` | 325 | Title, description, subject, grade, section, start and end dates, coordinator, banner, logo |
| `classroom_members` | 10,706 | Classroom ↔ user with role |
| `classroom_folders` | 27 | Type, title, due date, order |
| `classroom_files` | 110 | Content item: attachment, due date, submission type, verification, edu points, order |
| `classroom_file_progress` | 1,293 | Student ↔ file status |
| `classroom_submissions` | 85 | Student ↔ file content (text, link or file URL) |
| `classroom_discussions` | 40 | Threaded posts |

Assessment tables (`classroom_assessments`, `classroom_assessment_marks`, components) are documented in [30](30-grades-and-report-cards.md).

## 5. Logic in the database

| Function | Target |
| --- | --- |
| `is_classroom_member`, `user_is_classroom_member`, `is_classroom_staff`, `_assert_classroom_staff`, `owns_submission` | Relationship helpers `isClassroomMember`, `isClassroomStaff`, `ownsSubmission` |
| `_classroom_edu_earned` | Replaced by an `edu_points_ledger` written when progress or a completion changes (student, classroom, source, points, earned_on in the school's time zone) |
| `get_classroom_edu_leaderboard`, `get_classroom_edu_month_summary`, `get_classroom_edu_monthly`, `get_classroom_edu_top3`, `get_classroom_homework_edu_top3`, `get_student_edu_dashboard`, `get_student_edu_standings` | Queries over `edu_points_ledger` (or a monthly summary of it) |
| `get_classroom_assessment_trend` | Owned by [30](30-grades-and-report-cards.md) |
| `classroom_manager_page`, `classroom_member_counts` | `classrooms.managerPage(search, cursor)` with a member count kept on `classrooms` |
| `get_homeroom_classrooms` | [22](22-academic-structure.md) |

## 6. Server routes and integrations

None today (all browser queries). The AI assistant button only opens an external chat site with a prompt.

## 7. Jobs, files and live updates

- **Files:** `classrooms/<id>/...` (banners, logos, coursework), `submissions/<fileId>/<studentId>/...`, `discussions/<classroomId>/...`; readable by classroom members (submissions: the student and classroom staff only).
- **Jobs:** year-end archive of closed classrooms' progress, submissions and discussions.
- **Live updates:** none needed; discussion could use a channel later.

## 8. Single-tenant assumptions

| Assumption | Fix |
| --- | --- |
| Months for edu points cut in `Asia/Kolkata`, hard-coded in SQL (also in two other migrations) | School time zone setting |
| Coursework URLs stored with the Supabase storage host | R2 keys |

## 9. Target design

### Tables

Carried over: `classrooms`, `classroom_members`, `classroom_folders`, `classroom_files`, `classroom_file_progress`, `classroom_submissions`, `classroom_discussions`. Add `classrooms.student_count` (maintained on membership change), `edu_points_ledger` (student_id, classroom_id, source_kind `file`/`homework`, source_id, points, earned_on, unique per student and source), and keep it in step whenever progress or a homework completion changes state (points removed if the state goes back).

Indexes: `classroom_members (user_id, classroom_id)` and `(classroom_id, role)`; `classroom_files (folder_id, sort_order)`; `classroom_file_progress (file_id, student_id)` unique, `(student_id)`; `classroom_submissions (file_id, student_id)`; `edu_points_ledger (classroom_id, earned_on)`, `(student_id, earned_on)`.

### Methods

| Method | Permission |
| --- | --- |
| `classrooms.mine` | signed in |
| `classrooms.get(id)` (one call: header, folders, files, my progress or class progress) | members |
| `classrooms.create` / `update` / `close` / `delete` | `classrooms.manage` (admin, coordinator); staff members may edit their classroom's content |
| `classrooms.members.add` / `remove` / `importHomeroom` | classroom staff; `classrooms.manage` |
| `classrooms.folders.*`, `classrooms.files.*` | classroom staff |
| `classrooms.progress.set` | the student (up to `done`); classroom staff (any, including `completed`) |
| `classrooms.submit`, `classrooms.submissions(fileId)` | the student; classroom staff |
| `classrooms.discussion.*` | members; delete own or staff |
| `classrooms.analysis(id)`, `classrooms.leaderboard(id, month)`, `edu.dashboard(studentId)` | classroom staff; the student for own standing |
| `classrooms.managerPage` | `classrooms.manage` |

## 10. Moving existing data

Straight copy; attachment and submission URLs to R2 keys with files copied; build `edu_points_ledger` from current `completed` progress and homework completions (using `updated_at` as `earned_on` in the school's time zone, as today's function does), and check leaderboards match.

## 11. Parity checklist

- [ ] Students see the same classrooms, folders, files and progress; staff see class-wide progress.
- [ ] Edu-point totals, leaderboards, top 3 and the student dashboard match today's numbers for the imported data.
- [ ] Verification rules for files and homework hold.
- [ ] Submissions are visible to the student and classroom staff only.
- [ ] Classroom Manager search and paging work at 1,000+ classrooms.

## 12. Open questions

- [ ] Should coursework support scheduled release (visible from a date)?
- [ ] Keep the external AI assistant links, or remove them?
