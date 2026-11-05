# Academic Structure: Years, Homerooms and Teams

As of 5 Nov 2026. Part of the [rebuild docs](README.md). The design is a Neon Postgres project per school with Cloudflare for everything else ([01](01-architecture-options.md), [10](10-target-architecture.md)). Classrooms (the LMS) are in [28-classrooms-and-coursework.md](28-classrooms-and-coursework.md); timetable subjects and groups in [31-timetable.md](31-timetable.md).

## 1. Summary

Three shared structures that most other sections hang off:

- **Academic years** (`academic_years`): the school session (April to March by default), one active at a time. Fees, transport, certificates, homerooms, timetables and payroll all record which year a row belongs to.
- **Homerooms** (`homerooms`, `homeroom_members`): a class-section such as "Grade 5 A" for one academic year, with a class teacher, its students, an optional smartboard kiosk and an expiry date. Student attendance, smartboards, leave and many reports are organised by homeroom.
- **Teacher teams** (`teams`, `team_members`, `team_coordinators`): groups of staff with one or more coordinators, used for task assignment, leave approval routing, announcements and visibility rules.

What changes: nothing in the data or its functions. The `SECURITY DEFINER` helpers (`my_teammate_ids`, `shares_team_with`, `is_homeroom_member`, `get_homeroom_classrooms`) stay and keep serving the policies; academic-year management moves from the fee settings screen to a core admin screen.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/more/homerooms` (1,048 lines) | Admin, coordinators; class teachers for their own | Homeroom Manager: create and edit homerooms, set class teacher, add and remove students (by email or search), link or unlink a smartboard account, set the smartboard banner, see which classrooms hold the homeroom's students |
| `/more/teacher-teams` (703 lines) | Admin, coordinators | Teams: create, edit dates, add members and coordinators |
| Fees → Settings → Academic year (`AcademicYearSettings.tsx`) | Admin | Create sessions, set dates, set the active year |
| Everywhere | All | `AcademicYearContext` exposes the active year and the list of years to every screen |

Code: `src/lib/academicYear.ts`, `homerooms.ts`, `homeroomClassTeachers.ts`, `homeroomAutoManage.ts`, `grades.ts`, `cbseSubjects.ts`, `src/contexts/AcademicYearContext.tsx`, team functions in `src/lib/admin.ts` and the teacher-teams page.

## 3. How it works today

**Academic years.** Codes look like `2026-27`; `normalize_academic_year_code` accepts `2026-2027` or `2026`. New years default to 1 April – 31 March. Only one row is active (`set_active_academic_year`, admin only, closes the previous active year). An exclusion constraint stops two years' date ranges overlapping. `ensure_academic_year` creates a year on demand (used by imports and transport triggers). Many tables carry both a legacy text `academic_year` and an `academic_year_id`.

**Grades.** Stored as integers; pre-primary as negatives: Pre-KG −3, LKG −2, UKG −1, then 1–12. Sections are free text.

**Homerooms.** One per grade-section per year, named like "Grade 5 A", with `expiry_date` (default 31 May after the year ends, overridable per year in `app_settings.homeroom_expiry_dates`). Students are members through `homeroom_members`; a student's `profiles.grade`/`section` are kept in step by `syncStudentHomeroom` when admins create or edit students (and by `/api/admin/sync-homerooms` in bulk). A homeroom can have one smartboard account (`smartboard_id`) and a banner for it; `restrict_smartboard_homeroom_update` stops a smartboard changing anything but its banner.

**Teams.** `team_members` and `team_coordinators` (several coordinators allowed). `my_teammate_ids()` and `shares_team_with()` power visibility rules in tasks, leave and the staff directory.

## 4. Data

| Table | Rows | Purpose |
| --- | --- | --- |
| `academic_years` | 3 | Code, dates, active flag, status (`planning`, `active`, `closed`), promoted_at, notes |
| `homerooms` | 43 | Name, grade, section, academic year (text and id), expiry, class teacher, smartboard id, smartboard banner |
| `homeroom_members` | 1,066 | Homeroom ↔ student |
| `teams` | 8 | Name, description, dates |
| `team_members` | 126 | Team ↔ staff |
| `team_coordinators` | 10 | Team ↔ coordinator |
| `app_settings` (key `homeroom_expiry_dates`) | 1 | Per-year expiry overrides |

Full columns: [reference/live-schema.md §22](reference/live-schema.md#22--academic-structure).

## 5. Logic in the database

Under Neon every function, trigger and policy below moves unchanged with the database ([13](13-data-layer.md)), and the policies keep deciding who sees what. The right-hand column notes the exceptions: jobs `pg_cron` called, which the hub's timer now calls, and anything that used `pg_net`, Supabase Auth or Storage.

| Function | What it does | Under Neon |
| --- | --- | --- |
| `current_academic_year`, `current_academic_year_id` | Active year | Unchanged |
| `academic_year_code_for`, `academic_year_id_for`, `normalize_academic_year_code` | Map a date or code to a year | Unchanged |
| `ensure_academic_year` | Create a year if missing | Unchanged |
| `set_active_academic_year` | Switch the active year; close the old one | Unchanged |
| Exclusion constraint on `academic_years` | No overlapping date ranges | Unchanged |
| `is_homeroom_member`, `get_homeroom_classrooms` | Access and the "classrooms holding my students" list | Unchanged |
| `my_teammate_ids`, `shares_team_with` | Team visibility | Unchanged |
| `get_grade_sections_with_students` | Distinct grade-sections that have students | Unchanged |
| `homeroom_attendance_counts`, `student_attendance_tally` | Attendance summaries per homeroom | Unchanged |
| `restrict_smartboard_homeroom_update` (trigger) | Smartboard may change only its banner | Unchanged |

## 6. Server routes and integrations

`/api/admin/sync-homerooms` becomes the batched `admin.syncHomerooms` job. Everything else is direct browser queries today: they run unchanged through the Data API in phase 1 and become endpoints in phase 2. No integrations.

## 7. Jobs, files and live updates

- **Jobs:** the homeroom sync; archiving a year when it closes; optionally a yearly "expire homerooms" job on each homeroom's expiry date (today expiry is only read, not acted on).
- **Files:** none.
- **Live updates:** none.

## 8. Single-tenant assumptions

| Assumption | Fix |
| --- | --- |
| Session runs April–March (Indian academic year) | Per-school default session start month in settings; still overridable per year |
| Grade scale Pre-KG to 12 | Keep as the default; a school setting could rename or hide levels later |
| `getAcademicYear()` derives a year from a date for homeroom auto-manage | Use the stored `academic_years` rows only (the code comment already asks for this) |

## 9. Target design

Under Neon ([01](01-architecture-options.md)) this section's tables, functions and policies move as they are; nothing below is needed for the move itself. What follows is the phase 2 design ([16](16-frontend-and-api.md)): the endpoints the screens call, each running one SQL function as the signed-in user, and schema improvements worth making along the way as ordinary migrations. An endpoint written `section.action` is `POST /api/section/action`. Permission names label today's rules, which stay in the policies and functions; the fee module's grants remain the only named permission system.

### Tables

Carried over: `academic_years`, `homerooms`, `homeroom_members`, `teams`, `team_members`, `team_coordinators`. Drop the legacy text `academic_year` columns once every reader uses `academic_year_id` (keep them through the import, drop in a later migration). `homeroom_expiry_dates` moves to `settings`.

Indexes worth keeping: `homeroom_members (student_id)`, `homeroom_members (homeroom_id)`, `homerooms (academic_year_id, grade, section)` unique, `team_members (user_id)`, `team_coordinators (user_id)`.

### Endpoints (phase 2)

| Endpoint | Permission |
| --- | --- |
| `years.list`, `years.active` | signed in |
| `years.create`, `years.update`, `years.setActive` | `structure.years.manage` (admin) |
| `homerooms.list`, `homerooms.get` | staff; smartboard (own) |
| `homerooms.save`, `homerooms.delete`, `homerooms.setClassTeacher` | `structure.homerooms.manage` (admin, coordinator) |
| `homerooms.addMember`, `homerooms.removeMember` | `structure.homerooms.manage`, or class teacher of that homeroom |
| `homerooms.linkSmartboard`, `unlinkSmartboard`, `setSmartboardBanner` | admin; banner also by the smartboard itself |
| `homerooms.classrooms` | class teacher of that homeroom, coordinator, principal, admin |
| `teams.list`, `teams.save`, `teams.setMembers`, `teams.setCoordinators` | `structure.teams.manage` (admin, coordinator) |
| `structure.gradeSections` | staff |

### Shared helpers

Today's `SECURITY DEFINER` helpers (`my_teammate_ids`, `shares_team_with`, `is_homeroom_member`, `get_homeroom_classrooms`) stay in SQL and serve both the policies and the phase 2 functions.

## 10. Moving existing data

Moves with the dump ([13](13-data-layer.md)). Check: every homeroom's `academic_year_id` is set (fill from the text code with `ensure_academic_year` logic where it is not); every student in `homeroom_members` matches their profile's grade and section, and list mismatches for the admin.

## 11. Parity checklist

- [ ] Only one academic year can be active; switching closes the previous one.
- [ ] Two academic years can never overlap.
- [ ] Creating or editing a student with grade and section places them in the right homeroom, creating it when needed.
- [ ] Class teachers can manage their own homeroom's members but not others'.
- [ ] Team-based visibility (tasks, leave, directory) matches today for coordinators and members.
- [ ] Pre-KG, LKG and UKG sort before Grade 1 everywhere.

## 12. Open questions

- [ ] Should year-end promotion (move every student up a grade into next year's homerooms) be built as a guided action? `promoted_at` exists but there is no promotion screen today.
- [ ] Should homerooms actually expire (hide from lists) after `expiry_date`?
