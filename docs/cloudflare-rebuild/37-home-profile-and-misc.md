# Home, Profile and Other Screens

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). This doc covers what no other section owns:

- the home dashboards;
- the `/more` hub;
- the profile page;
- feedback;
- app-open streaks;
- the daily quote.

Sign-in and password pages are in [12-auth-and-permissions.md](12-auth-and-permissions.md), banners and branding in [21-school-settings-and-branding.md](21-school-settings-and-branding.md), and the classroom leaderboard in [28-classrooms-and-coursework.md](28-classrooms-and-coursework.md).

## 1. Summary

- **`/home`** (2,008 lines) is a role-aware dashboard:
  - Students: today's timetable, school-work calendar, latest assessments, report cards, exams, overdue fees.
  - Teachers: attendance card, weekly calendar, exam grading queue, classrooms.
  - Admins, principals and coordinators: school overview, attendance and fee infographic panels on desktop, leave approvals.
  - Everyone: the welcome banner with a quote, the notifications summary, and a push toggle.

  It loads with 8 direct Supabase queries in the page, plus a dozen or more helper calls from the cards it renders, several of them in sequence.
- **`/more`** (253 lines) is the hub of section tiles, filtered by role and by which modules are switched on.
- **`/profile`** (382 lines) shows the user's details, avatar upload and the profile banner.
- **`/more/feedback`** (833 lines) lets any user send feedback with an optional private file attachment. Admins reply.
- **Streaks:** `record_app_open` counts consecutive days on which a user opened the app.
- **Quotes:** a curated list in code (`quotes.ts`, 178 lines), one per day, with a Wikipedia portrait looked up at runtime.

Live data:

- `feedbacks`: 0 rows, but 2 files in `feedback-files`.
- `user_activity_streaks`: 195 rows.

**Gap found while writing this doc.** The home page's fee widgets (`OverdueFeesCard` for students, and the admin fee summary at `home/page.tsx:793`) read the first-generation tables `school_fees`, `school_fee_payments`, `bus_fees` and `bus_payments`. All four are empty or near-empty on live. The v2 fee app keeps its bills in `fee_invoices` and `fee_payments`, so these widgets never show real bills or collections. The rebuild must read the v2 fee module ([33](33-fees.md)).

What changes:

1. Home becomes one call, `POST /api/home/load` → `home.load()` ([16](16-frontend-and-api.md)), returning only the cards the user's role and settings show.
2. The fee cards read v2 bills.
3. The streak's "today" uses the school's time zone, not the browser's.
4. Feedback attachments move to private R2 keys.
5. The `/more` tiles come from the school's modules in the platform database (`plans.modules` plus `school_features` overrides), not hard-coded per deployment.

## 2. Users and screens

| Route or component | Who | Purpose |
| --- | --- | --- |
| `/home` (`src/app/home/page.tsx`, `src/components/home/*`, `desktop/*`) | Everyone | Role-aware dashboard. Cards: `TodayTimetableCard`, `SchoolWorkMiniCalendar`, `LatestAssessmentsMiniList`, `ReportCardsMiniList`, `ExamsMiniCard`, `ExamGradingCard`, `OverdueFeesCard`, `TeacherAttendanceCard`, `AttendanceScopesCard`, `StaffWeeklyCalendarCard`, `NotificationsSummaryCard`, `DailyQuoteCard` / `BannerQuote`, `HomeCardDeck`; on desktop, `SchoolOverviewPanel`, `AttendanceInfographicPanel`, `FeesInfographicPanel` |
| `/more` | Everyone | Hub of tiles per role and module |
| `/profile` | Everyone | Own details, avatar, profile banner (admin can change the banner for everyone) |
| `/more/feedback` | Everyone; admin replies | Send feedback with a file; list own feedback; admin inbox with pending and replied filters, reply and delete |
| Academics header streak | Students | Current and longest streak |

Things that change home:

- Per-user show or hide of the task calendar and classrooms cards. These are kept in the browser's `localStorage` (`home_task_calendar_visible_<userId>`, `home_classrooms_visible_<userId>`), so they do not follow the user to another device.
- The `welcome_banner` setting, plus a banner luminance sample (`luminance.ts`) that picks a readable text colour.

## 3. How it works today

1. **Load.** On mount, home works out the role and fires the queries for every card that role can see. These include tasks for the week (`fetchCalendarData`), team rosters, classrooms by last visit, grading queues, leave approvals, timetable for today, fees, and the notification summary.
2. **Banner upload.** An admin uploads the welcome banner straight from home into the public `classroom-files` bucket (`home/page.tsx:596`). The URL is saved to a setting.
3. **Streak.**
   - `recordAppOpen()` runs once per session at sign-in.
   - It calls `record_app_open(p_today)` with the browser's local date. The function increments the streak if the last open was yesterday, resets it otherwise, and does nothing on the same day.
   - `fetchStreak` reads the row.
   - Because `p_today` comes from the browser, a user can move their clock to keep a streak alive.
4. **Quote.** The day's quote is picked from `QUOTES` by date. `resolveAuthorImage` looks up the author's Wikipedia thumbnail from the browser, falling back to initials.
5. **Profile.** The avatar is uploaded to the public `classroom-files` bucket and its URL saved on `profiles.avatar_url`. The banner is changed through `/api/admin/update-banner` ([21](21-school-settings-and-branding.md)).
6. **Feedback.**
   - `submitFeedback` uploads the file to the private `feedback-files` bucket and inserts the row.
   - Admins list all feedback and reply (`replied_by`, `replied_at`). Files open through one-hour signed URLs.
   - Users see their own feedback. Admins can delete.

## 4. Data

| Table | Rows | Purpose |
| --- | --- | --- |
| `feedbacks` | 0 | Subject, message, file path, name and size, reply, replier, reply time |
| `user_activity_streaks` | 195 | Current streak, longest streak, last open date per user |

## 5. Logic in the database

| Function | Target |
| --- | --- |
| `record_app_open(p_today)` | `streaks.recordOpen()`: today is computed on the server in the school's time zone |
| Row-level security on `feedbacks` (own rows; admin all) | `feedback.*` permissions (below) |

## 6. Server routes and integrations

| Today | Target |
| --- | --- |
| Many browser queries on home | `home.load()`: one object call, returning a payload per visible card. Cards still render independently on the client from that payload |
| `/api/admin/update-banner` | `settings.banners.save` ([21](21-school-settings-and-branding.md)) |
| Wikipedia thumbnail lookup from the browser | Unchanged (public API, no secrets). Optionally cache the resolved URL per author in the platform database |

## 7. Jobs, files and live updates

- **Files:**
  - Avatars: `schools/<schoolId>/avatars/<userId>.<ext>`, served through the files route with long cache headers.
  - Feedback attachments: `schools/<schoolId>/feedback/<feedbackId>/<name>`, private, served only to the sender and admins.
  - Banners: as in [21](21-school-settings-and-branding.md).
- **Jobs:** none.
- **Live updates:** the notification counts on home can come over the user's WebSocket ([14](14-jobs-messaging-realtime.md)) instead of being re-fetched.

## 8. Single-tenant assumptions

| Assumption | Fix |
| --- | --- |
| Home banner and avatars in the shared public `classroom-files` bucket | Per-school R2 keys behind the files route |
| `/more` tiles assume every module exists | Modules per school from `plans.modules` and `school_features` ([11](11-tenancy-and-control-plane.md)); `home.load` and the tile list honour them |
| Home card visibility kept in `localStorage` per browser | Optional: a per-user preference in the school object so it follows the user |
| Streak date from the browser's clock | Server date in the school's time zone |

## 9. Target design

### Tables

Carried over. `feedbacks` gains `file_key` (an R2 key) in place of `file_url`. `user_activity_streaks` is unchanged.

### Methods

| Method | Permission |
| --- | --- |
| `home.load()` | signed in; returns only cards for the caller's role, switched-on modules and settings |
| `streaks.recordOpen()`, `streaks.mine()` | signed in |
| `profile.me`, `profile.updateAvatar` | signed in (own) |
| `feedback.submit`, `feedback.mine`, `feedback.file(id)` | signed in (own) |
| `feedback.all`, `feedback.reply`, `feedback.delete`, `feedback.file(id)` | `feedback.manage` (admin) |

`home.load()` gathers each card's data by calling the owning module's read methods inside the object. For example, the overdue-fees card calls `fees.mine.outstanding`. No SQL is duplicated in the home module.

## 10. Moving existing data

- Copy `user_activity_streaks` and `feedbacks`. There are no feedback rows, but there are 2 orphan files in `feedback-files`; check them before deleting.
- Copy avatars from `classroom-files` to the new keys and rewrite `profiles.avatar_url` ([15](15-files-and-media.md)).

## 11. Parity checklist

- [ ] Each role sees the same cards as today, with the same data, in at most two network round trips.
- [ ] The overdue-fees card and the admin fee summary show v2 bills and today's collections (a fix, not parity).
- [ ] A streak increments once per school day in the school's time zone, resets after a missed day, and cannot be kept alive by changing the device clock.
- [ ] Feedback attachments open only for the sender and admins.
- [ ] The `/more` hub shows only modules switched on for the school.

## 12. Open questions

- [ ] Should streaks count only school days (skip holidays and weekends) rather than calendar days?
- [ ] Should feedback go to the school's admins, to EduBerry support, or to both (a platform-level inbox for product feedback)?
