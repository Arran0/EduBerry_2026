# Smartboard (Homeroom Kiosk)

As of 5 Nov 2026. Part of the [rebuild docs](README.md). The design is a Neon Postgres project per school with Cloudflare for everything else ([01](01-architecture-options.md), [10](10-target-architecture.md)).

## 1. Summary

A smartboard is a classroom display signed in with a special `smartboard` account linked to one homeroom. It shows the homeroom's day: attendance panel (and marking), homeroom tasks and homework with student completions, a weekly calendar, the homeroom's announcements, the top three students by edu points in a rotating loop, a quote and a banner the board can edit. Teachers can also post homework tasks to the board's homeroom or a classroom.

Live: 1 smartboard account; 37 smartboard tasks; 249 completions.

What changes: the kiosk gets its own non-expiring, revocable session kind bound to one homeroom ([12](12-auth-and-permissions.md)); its narrow rights (only its homeroom; only its banner on the homeroom row) stay in today's policies and trigger.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/smartboard` (234 lines) | Smartboard account | Kiosk home: banner, attendance panel, weekly calendar, tasks and completions, top-3 loop, quote |
| `/smartboard/announcements` | Smartboard | Homeroom announcement feed |
| Homeroom Manager | Admin | Create smartboard accounts, link to a homeroom, edit banner ([22](22-academic-structure.md)) |
| Classroom and homeroom screens | Teachers | Post smartboard tasks and homework (`SmartboardHomeworkForm`) |

Code: `src/lib/smartboard.ts` (775 lines), components `SmartboardAnnouncements`, `SmartboardAttendancePanel`, `SmartboardBannerEditor`, `SmartboardHomeworkForm`, `SmartboardQuote`, `SmartboardTop3Loop`, `SmartboardWeeklyCalendar`; `src/lib/quotes.ts`; `/api/admin/create-smartboard`.

## 3. How it works today

- An admin creates a `smartboard` login (`/api/admin/create-smartboard`) and links it to a homeroom (`homerooms.smartboard_id`).
- `fetchSmartboardContext` loads the homeroom, its students, today's attendance counts and classrooms.
- Smartboard tasks (`smartboard_tasks`) belong to a homeroom or a classroom; students' progress is tracked per student in `smartboard_task_completions` with the same four-state cycle as staff tasks (not done → partial → done → checked when verification is required).
- The board can mark its homeroom's attendance (row-level security allows a smartboard to insert and update attendance for its own homeroom only).
- `restrict_smartboard_homeroom_update` lets a smartboard change only `smartboard_banner` on its homeroom (`set_smartboard_banner`).
- The top-3 loop reads classroom edu-point leaderboards ([28](28-classrooms-and-coursework.md)).
- `importHomeroomIntoClassroom` copies a homeroom's students into a classroom.

## 4. Data

| Table | Rows | Purpose |
| --- | --- | --- |
| `smartboard_tasks` | 37 | Homeroom or classroom task: title, description, due date, timing, edu points, verification and submission flags, attachment |
| `smartboard_task_completions` | 249 | Student ↔ task status and submission |
| `homerooms.smartboard_id`, `homerooms.smartboard_banner` | — | Link and banner |

## 5. Logic in the database

Under Neon every function, trigger and policy below moves unchanged with the database ([13](13-data-layer.md)), and the policies keep deciding who sees what. The right-hand column notes the exceptions: jobs `pg_cron` called, which the hub's timer now calls, and anything that used `pg_net`, Supabase Auth or Storage.

| Function | Under Neon |
| --- | --- |
| `is_smartboard_account`, `is_homeroom_smartboard`, `is_smartboard_of_student` | Unchanged |
| `restrict_smartboard_homeroom_update` (trigger) | Unchanged |
| `set_smartboard_banner` | Unchanged |
| `get_homeroom_announcement_feed` | Unchanged |

## 6. Server routes and integrations

`/api/admin/create-smartboard` (create and delete) becomes `admin.smartboards.create` / `remove`, which also issues and revokes the kiosk session.

## 7. Jobs, files and live updates

- **Files:** task attachments under `smartboard/<homeroomId>/...`.
- **Live updates:** a `smartboard:<homeroomId>` channel would let the board refresh attendance and completions without polling; useful but optional.

## 8. Single-tenant assumptions

None.

## 9. Target design

Under Neon ([01](01-architecture-options.md)) this section's tables, functions and policies move as they are; nothing below is needed for the move itself. What follows is the phase 2 design ([16](16-frontend-and-api.md)): the endpoints the screens call, each running one SQL function as the signed-in user, and schema improvements worth making along the way as ordinary migrations. An endpoint written `section.action` is `POST /api/section/action`. Permission names label today's rules, which stay in the policies and functions; the fee module's grants remain the only named permission system.

### Session

A kiosk session (`kind = 'kiosk'`, `homeroom_id`) is created by an admin from the Homeroom Manager ("Sign in this board"), shown as a one-time code or QR the board scans, and never expires until revoked. No password is needed on the board itself. The board's account stays a `profiles` row with role `smartboard` so existing references hold.

### Endpoints (phase 2)

| Endpoint | Permission |
| --- | --- |
| `smartboard.context` | kiosk of that homeroom; staff |
| `smartboard.tasks`, `smartboard.completions` | kiosk of that homeroom; staff of the homeroom or classroom |
| `smartboard.tasks.create` / `update` / `delete` | staff (class teacher, classroom staff, coordinators, admin) |
| `smartboard.completions.set` | kiosk of the homeroom; staff |
| `smartboard.setBanner` | kiosk of the homeroom; admin |
| `attendance.sheet` / `saveSheet` for its homeroom | kiosk of the homeroom ([23](23-attendance.md)) |
| `smartboard.top3` | kiosk; staff |

## 10. Moving existing data

Moves with the dump ([13](13-data-layer.md)); attachment URLs to R2 keys. The live smartboard signs in once with the new kiosk flow after cutover.

## 11. Parity checklist

- [ ] A board sees and acts on its own homeroom only.
- [ ] A board cannot change any homeroom field except its banner.
- [ ] Task completion cycles match today with and without verification.
- [ ] Attendance marked on a board appears in reports exactly like a teacher's marks (marker recorded as the board).
- [ ] Revoking a board's session signs it out immediately.

## 12. Open questions

- [ ] Should a board show the day's timetable for its homeroom (data exists in [31](31-timetable.md))?
