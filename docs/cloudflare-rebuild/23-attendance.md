# Attendance: Students, Staff and Support Staff

As of 5 Nov 2026. Part of the [rebuild docs](README.md). The design is a Neon Postgres project per school with Cloudflare for everything else ([01](01-architecture-options.md), [10](10-target-architecture.md)).

## 1. Summary

Three kinds of attendance, one rules engine:

- **Students** are marked once a day per homeroom (present, absent, late, on leave, excused, on duty, half day) by the class teacher, staff or the homeroom's smartboard. Approved leave writes attendance automatically.
- **Staff** punch in and out from their phones. Each punch takes several GPS samples in the browser; the database scores the position against the staff member's geofence, records a verdict and decides Present, Late, Half Day or Exception (a second check-in) from day timings. Admins can mark or correct any day.
- **Support staff** (no logins) are marked by an admin.

Day rules (late and checkout cutoffs, holidays, non-working days) can apply to everyone or to named groups of staff, by date or by weekday. When a rule changes, past staff days in the window are recomputed.

This is the heaviest daily write path in the app: about 1,050 student marks and 50–80 staff punches a school day today, about 9,000 marks and 1,400 punches at a 10,000-user school. What changes: little. The 2,700-line `staff_attendance_punch` family of functions moves unchanged, row locks and all; the location-attempt clean-up moves from `pg_cron` to the hub's timer; in phase 2, leave-to-attendance sync moves from the browser into the leave decision function, and reports read from a summary table.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/more/attendance` (1,666 lines) | Staff, students | Student attendance: mark sheet per homeroom and date, daily tallies across homerooms, student and staff reports, calendars; students see their own month |
| `/more/staff-attendance` (369 lines) | Staff | Own check-in/check-out (`StaffCheckIn`), own calendar, forgotten-checkout prompt, leave updates |
| `/admin/attendance` (559 lines) | Admin | Attendance rules: day timings, holiday calendars, non-working days, staff groups, review queue |
| `/admin/geofencing` (296 lines) | Admin | Geofence zones (circle or polygon on a map), trusted accuracy, staff membership, exemptions |
| Smartboard | Kiosk | Marks its own homeroom (see [27](27-smartboard.md)) |
| Reports | Admin, principal, coordinators | All-staff and support-staff reports, monthly PDFs and spreadsheets generated in the browser (`components/attendance/reports`) |

Code: `src/lib/attendance.ts` (3,180 lines), `attendanceReports.ts`, `attendanceCalendars.ts`, `geofence.ts`, `gpsAcquisition.ts` (multi-sample GPS in the browser), `supportStaff.ts`, `studentPresentPct`, 30 components under `src/components/attendance`, `useSchoolClock` (server time in the school's time zone).

## 3. How it works today

### Student marking

1. A teacher opens a homeroom and date; the sheet loads members, existing records and approved leave.
2. Saving upserts all rows in one call (`attendance_records`, unique on homeroom, student, date). The `force_attendance_marked_by` trigger stamps the real marker.
3. When a leave application is approved, the browser calls `syncLeaveToStudentAttendance`, writing a record for every homeroom the student belongs to and every date in the leave: on-duty → present, half day → half day, late permit → late, others → absent, linked by `leave_application_id`.

### Staff punch

```mermaid
sequenceDiagram
  participant P as Staff phone
  participant DB as staff_attendance_punch()
  P->>P: gpsAcquisition: several fixes, agreement, best accuracy, spread
  P->>DB: action, lat, lng, accuracy, samples, failure reason
  DB->>DB: effective fence for this staff (zone membership or school default)
  DB->>DB: verdict: inside / outside / uncertain / exempt / no_fence / location_off / device_problem
  DB->>DB: which slot: in, out, in2, out2 (max 4 punches a day, 5-minute minimum gap)
  DB->>DB: effective cutoffs (member date rule > member weekday rule > default date > default weekday > settings)
  DB->>DB: status: late after late cutoff; half day if out before checkout cutoff; 'e' on a second check-in
  DB->>DB: write record + one attendance_location_attempts row
  DB-->>P: success, verdict, distance, status, slot
```

- Every verdict is written; "outside" is recorded and flagged, not refused (an exemption only turns "uncertain" into "exempt").
- Location columns can only be written by the punch function (`guard_attendance_location_columns` checks a session flag the function sets), so a browser cannot forge a position.
- The phone shows the server's clock in the school's time zone (`get_server_time`, `attendance_timezone`), never its own.
- A punch left open past the day prompts a "forgotten checkout" acknowledgement (`ack_forgotten_checkout`).

### Rules and recompute

Day timings, holidays and non-working days each have a scope (`date` or `weekday`), may be the default for everyone, or apply to named staff through `*_members` tables. Triggers on these tables and on `site_settings.attendance_config` queue rows in `attendance_recompute_queue`; `attendance_recompute_pending(92)` then re-derives statuses (`attendance_derived_status`) for the affected dates within 92 days.

### Support staff

Admins mark `support_staff_attendance` by hand (present, absent, late, half day, on leave, exception).

## 4. Data

| Table | Rows | Purpose |
| --- | --- | --- |
| `attendance_records` | 50,449 | Student day marks (homeroom, student, date, status, leave link, marker, remarks) |
| `staff_attendance_records` | 7,753 | Staff day: status, up to four punches each with time, position, accuracy, distance and verdict, forgotten-checkout ack |
| `attendance_location_attempts` | 7,882 | Every punch attempt's GPS evidence and verdict |
| `support_staff_attendance` | 1,962 | Support staff day marks |
| `attendance_geofence_zones`, `attendance_geofence_zone_members` | 0 / 0 | Named zones (circle or polygon) and which staff they apply to; school default in `site_settings.geofence` |
| `attendance_day_timings`, `attendance_day_timing_members` | 4 / 15 | Late and checkout cutoffs by date or weekday, default or for named staff |
| `attendance_holidays`, `attendance_holiday_members` | 8 / 0 | Holidays by date or weekday |
| `attendance_non_working_days`, `attendance_non_working_day_members` | 0 / 0 | Non-working days |
| `attendance_recompute_queue` | 0 | Pending recompute scopes |

Also read: `profiles.geofence_exempt`, `profiles.attendance_hidden`, `homerooms`, `homeroom_members`, `leave_applications`, `site_settings.attendance_config` (time zone, default cutoffs) and `geofence`.

## 5. Logic in the database

Under Neon every function, trigger and policy below moves unchanged with the database ([13](13-data-layer.md)), and the policies keep deciding who sees what. The right-hand column notes the exceptions: jobs `pg_cron` called, which the hub's timer now calls, and anything that used `pg_net`, Supabase Auth or Storage.

| Function | Under Neon |
| --- | --- |
| `staff_attendance_punch` (9.6 KB) | Unchanged |
| `attendance_effective_fence`, `attendance_location_verdict`, `attendance_polygon_signed_distance_m`, `attendance_haversine_m`, `attendance_no_position_verdict`, `attendance_failure_class` | Unchanged |
| `attendance_effective_cutoffs`, `attendance_day_off_kind`, `attendance_derived_status`, `attendance_minute_of_day` | Unchanged |
| `attendance_timezone`, `get_server_time` | Unchanged |
| `attendance_queue_recompute`, `attendance_rule_changed`, `attendance_rule_member_changed`, `attendance_config_changed` (triggers) | Unchanged |
| `attendance_recompute_pending`, `recompute_staff_attendance_dates` | Unchanged |
| `force_attendance_marked_by`, `guard_attendance_location_columns` (triggers) | Unchanged |
| `ack_forgotten_checkout` | Unchanged |
| `homeroom_attendance_counts`, `student_attendance_tally` | Unchanged |
| `get_monthly_member_stats` | Unchanged |
| `cleanup_attendance_location_attempts` (cron) | Unchanged; called by the hub's timer through the `jobs` queue ([14](14-jobs-messaging-realtime.md)) |

## 6. Server routes and integrations

No API routes today; everything is browser queries and RPCs. No external services (maps tiles only for the geofence editor).

## 7. Jobs, files and live updates

- **Jobs:** recompute after rule changes; nightly clean-up of location attempts, writing old ones to R2 first if they must be kept ([13](13-data-layer.md#keeping-the-working-set-small)).
- **WhatsApp:** the reminders branch adds "absent without leave" parent messages from this data (see `docs/whatsapp-system-status.md`).
- **Files:** none (reports are generated in the browser).
- **Live updates:** the smartboard and today's tally could use a `attendance:homeroom:<id>` channel; not required.

## 8. Single-tenant assumptions

| Assumption | Fix |
| --- | --- |
| Time zone from `site_settings.attendance_config`, default `Asia/Kolkata` | School setting `school.timezone`, required at provisioning |
| `PERFORM set_config('app.attendance_write', 'on')` session flag to let only the punch write positions | Unchanged: the punch function sets the flag inside its own transaction, which behaves the same on Neon |
| Week numbering (`EXTRACT(DOW)`, Sunday = 0) | Same convention in shared code; the school's first day of week as a setting if needed |

## 9. Target design

Under Neon ([01](01-architecture-options.md)) this section's tables, functions and policies move as they are; nothing below is needed for the move itself. What follows is the phase 2 design ([16](16-frontend-and-api.md)): the endpoints the screens call, each running one SQL function as the signed-in user, and schema improvements worth making along the way as ordinary migrations. An endpoint written `section.action` is `POST /api/section/action`. Permission names label today's rules, which stay in the policies and functions; the fee module's grants remain the only named permission system.

### Tables

All tables above, carried over unchanged. Worth adding:

- `student_attendance_daily` (homeroom_id, date, present, absent, late, on_leave, excused, on_duty, half_day), kept up to date by a trigger on `attendance_records`, so tallies and monthly percentages never scan raw marks.
- Indexes: `attendance_records (homeroom_id, date)`, `(student_id, date)`; `staff_attendance_records (staff_id, date)` unique, `(date)`; rule tables by `(scope_type, scope_date)` and `(scope_type, scope_weekday)`; members by `staff_id`.

### Endpoints (phase 2)

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `attendance.sheet(homeroomId, date)` | class teacher of the homeroom, `attendance.mark_students`, or the homeroom's smartboard | Members, marks, approved leave, holiday notice — one call |
| `attendance.saveSheet(homeroomId, date, rows)` | same | Upsert + daily summary + outbox (absence messages, if enabled) |
| `attendance.tally(date)` | `attendance.reports` | From the daily summary |
| `attendance.myMonth(month)` | the student or staff member | |
| `attendance.punch(action, reading)` | staff with attendance tracking (not hidden) | One call to `staff_attendance_punch` |
| `attendance.adminMark(staffId, date, status)` / `clear` | `attendance.manage_staff` | |
| `attendance.supportStaff.mark` / `report` | `attendance.manage_staff` | |
| `attendance.rules.*` (timings, holidays, non-working days, groups) | `attendance.rules` (admin) | Each save enqueues recompute |
| `attendance.geofence.*` (zones, members, exemptions, defaults) | `attendance.rules` | |
| `attendance.reports.*` (staff, support staff, student monthly) | `attendance.reports` | Return rows; PDFs and spreadsheets still built in the browser |
| `attendance.ackForgottenCheckout` | the staff member | |

### Leave integration

`leave.decide` ([24](24-leave.md)) calls `attendance.applyLeave(application)` in the same transaction, replacing today's browser-side sync, so an approval can never leave attendance unsynced.

## 10. Moving existing data

Moves with the dump ([13](13-data-layer.md)). If `student_attendance_daily` is added, its migration builds it from `attendance_records`. Verify per-homeroom per-month counts against today's report screens.

## 11. Parity checklist

- [ ] A punch gives the same verdict, slot, status and distance as today for the same inputs (port the existing unit tests in `attendance.test.ts`, `gpsAcquisition.test.ts`, `attendanceRecompute.test.ts`, `attendanceCalendars.test.ts`, `attendanceReports.test.ts`, `studentPresentPct.test.ts`).
- [ ] Late and half-day decisions follow the same rule precedence (member date > member weekday > default date > default weekday > settings).
- [ ] Changing a rule recomputes affected staff days within 92 days.
- [ ] Approving leave writes the same student or staff attendance as today, in the same transaction.
- [ ] Nobody can set a punch position or verdict except through a punch.
- [ ] Daily tallies and monthly percentages match today's reports for the imported data.
- [ ] The morning rush (all staff punching between 08:00 and 08:30, all homerooms marking by 09:00) stays under 300 ms per call at a 10,000-user school (spike S5).

## 12. Open questions

- [ ] Should student marking be locked after a cut-off time or after N days, with only admins able to change it?
- [ ] Should the absent-without-leave WhatsApp reminder (branch) ship with the rebuild or before it?
