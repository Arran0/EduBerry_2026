# EduBerry Cloudflare Rebuild Docs

Started 27 Oct 2026. These documents describe the EduBerry app section by section: how each part works today as a one-school-per-deployment app on Supabase and Vercel, and what it must become in the multi-tenant version on Cloudflare. They are written to be the brief for rebuilding the app in a new repository cloned from this one.

## Why these docs exist

Today every school is a separate copy of the app: its own Vercel project, its own Supabase project (database, login, files, realtime, scheduled jobs) and its own environment variables. The target is one app that serves every school, runs entirely on Cloudflare, and uses no Supabase service, including Supabase Auth.

The new repository starts as a clone of this one. Read these docs in order, run the spikes in the architecture doc, then rebuild one section at a time. Each section doc lists what exists today in enough detail (tables, functions, triggers, routes, screens, jobs, integrations, single-school assumptions) that nothing is lost, and says how it maps onto the target design.

## Target in one paragraph

One router Worker serves the app for every school. It finds the school from the host name, checks the session cookie, and calls that school's **School Durable Object**, which holds the school's data in its own SQLite database (up to 10 GB) and runs the school's business logic one request at a time. One **D1 database** holds the platform's own records (schools, domains, plans, provisioning). Files go to **R2** under a per-school prefix. **Queues** carry outgoing WhatsApp, push, email and webhook work; each school object sets its own **alarms** for scheduled work, with a **Cron Trigger** as a watchdog. The browser app is a static single-page app served free from **Workers Static Assets**. The reasoning, the options rejected and the spikes to run first are in [01-architecture-options.md](01-architecture-options.md); the costs are in [02-cost-study.md](02-cost-study.md).

## Words used in every doc

| Term | Meaning |
| --- | --- |
| School, tenant | One customer school. Today: one Vercel project + one Supabase project. Target: one row in the platform D1 + one School object + one R2 prefix |
| Router Worker | The single Worker that receives every request for every school |
| School object | The SQLite-backed Durable Object that owns one school's data and logic, addressed as `SCHOOL.idFromName(schoolId)` |
| Platform D1 | The one shared D1 database for platform records; never holds school data |
| Today | `main` at commit `4762ae2` and the live database `mps-web` (Supabase project `tgxxqzeaqxiwoqzopcku`, Mumbai), as of 27 Oct 2026 |
| Single-tenant assumption | Anything that works only because a deployment serves one school: environment variables, singleton settings rows, hard-coded names, domains or time zones |

## Documents and status

Status: **Done** = written and pushed; **Next** = the round in progress; blank = planned.

| Round | Doc | Covers | Status |
| --- | --- | --- | --- |
| 1 | [README.md](README.md) | This index, the plan and the template | Done |
| 1 | [01-architecture-options.md](01-architecture-options.md) | D1 per school vs shared D1 vs Durable Objects vs others; validation; recommendation; spikes | Done |
| 1 | [02-cost-study.md](02-cost-study.md) + [tools/costmodel.py](tools/costmodel.py) | Workload model from live data; cost per school and per fleet up to 10,000 users | Done |
| 2 | [10-target-architecture.md](10-target-architecture.md) | Repository layout, Workers and Durable Object classes, request lifecycle, environments, deploys, observability | Done |
| 2 | [11-tenancy-and-control-plane.md](11-tenancy-and-control-plane.md) | Platform D1, finding the school from the host, domains, provisioning and offboarding, platform admin | Done |
| 2 | [12-auth-and-permissions.md](12-auth-and-permissions.md) | Replacing Supabase Auth; sessions; password import; invites and resets; replacing row-level security | Done |
| 2 | [13-data-layer.md](13-data-layer.md) | Postgres to SQLite rules, migrations inside each school, data export and import, archiving, backups | Done |
| 2 | [14-jobs-messaging-realtime.md](14-jobs-messaging-realtime.md) | `pg_cron`, `pg_net` and Realtime replaced by alarms, Cron Triggers, Queues and WebSockets | Done |
| 2 | [15-files-and-media.md](15-files-and-media.md) | Supabase Storage to R2 | Done |
| 2 | [16-frontend-and-api.md](16-frontend-and-api.md) | Next.js to a static app; API conventions; CSP; PWA and push | Done |
| 2 | [17-integrations-and-secrets.md](17-integrations-and-secrets.md) | Banks, Razorpay, WhatsApp, GPS gateway, email, web push, solver; per-school secrets | Done |
| 2 | [reference/live-schema.md](reference/live-schema.md) | Every live table, column, link, trigger, function, enum, view and cron job, by section | Done |
| 3 | 20-users-profiles-and-admin.md | Profiles, student and staff details, user management, bulk import, audit | Next |
| 3 | 21-school-settings-and-branding.md | Site settings, design, page themes, banners, school profile, favicon | Next |
| 3 | 22-academic-structure.md | Academic years, homerooms, classrooms, teams, subjects | Next |
| 4 | 23-attendance.md | Student and staff attendance, geofence, rules, holiday calendars, reports | |
| 4 | 24-leave.md | Student and staff leave and approvals | |
| 4 | 25-announcements-and-notifications.md | Announcements, audiences, reads, push and in-app notifications | |
| 4 | 26-tasks-and-projects.md | Task manager, subtasks, projects, planner, team analytics | |
| 4 | 27-smartboard.md | Homeroom kiosk | |
| 5 | 28-classrooms-and-coursework.md | LMS: coursework, homework, files, discussions, analysis | |
| 5 | 29-exams.md | Exams, attempts, grading, results | |
| 5 | 30-grades-and-report-cards.md | Assessments, marks, report cards, academic record | |
| 5 | 31-timetable.md | Timetable builder and the CP-SAT solver | |
| 5 | 32-certificates.md | Certificates and public verification | |
| 6 | 33-fees.md | Fee structures, invoices, collection, receipts, refunds, reminders | |
| 6 | 34-payroll-and-salary.md | Payroll runs, salary records, statutory, locations | |
| 6 | 35-bank-collections-and-payouts.md | Bank smart collect, UPI, payouts, webhooks, Razorpay | |
| 7 | 36-transport.md | Routes, runs, GPS, driver app, alerts, live tracking, bus fees and bus payroll | |
| 8 | 37-home-profile-and-misc.md | Home dashboards, profile, feedback, gamification, quotes | |
| 8 | 90-data-migration-and-cutover.md | Moving each live school from Supabase to its School object | |
| 8 | 91-test-and-parity-plan.md | How to prove each section matches today | |
| 8 | 92-build-order.md | Order of work in the new repository, milestones | |

Existing docs in `docs/` (fee, payroll, timetable, transport plans; GPS, email and WhatsApp status) describe features in depth and stay valid as feature references. Section docs link to them rather than repeat them.

## Template for section docs

Every section doc (20 onwards) follows this outline, so that each one can be used on its own:

1. **Summary** — what the section does, who uses it, and how much changes.
2. **Users and screens** — roles, routes and the main components.
3. **How it works today** — the main flows, step by step.
4. **Data** — tables (purpose, key columns, live row counts, relations), enums, views.
5. **Logic in the database** — functions, RPCs and triggers, and what each guarantees.
6. **Server routes and integrations** — API routes, external services, secrets.
7. **Jobs, files and live updates** — scheduled work, storage buckets, realtime channels.
8. **Single-tenant assumptions** — everything that only works because one deployment serves one school.
9. **Target design** — tables in the School object, API endpoints and object methods, permission matrix, jobs, files, live updates, integrations.
10. **Moving existing data** — transforms needed from Postgres to SQLite.
11. **Parity checklist** — behaviours the rebuilt section must reproduce, as testable statements.
12. **Open questions** — decisions for the owner.

## Measuring the live school again

The cost model and several docs quote live numbers. To refresh them, run these read-only queries on the live project (Supabase SQL editor or MCP) and compare:

```sql
-- Accounts by role, and daily active users over 14 days
select role::text, count(*) from public.profiles group by 1;
select date_trunc('day', updated_at)::date d, count(distinct user_id)
from auth.refresh_tokens where updated_at > now() - interval '14 days' group by 1 order by 1;

-- Requests and rows since the last stats reset
select pg_postmaster_start_time(),
       (select sum(calls) from pg_stat_statements s join pg_roles r on r.oid = s.userid
        where r.rolname = 'authenticated' and s.query like 'select set_config(%') as api_requests;
select sum(seq_tup_read) + sum(idx_tup_fetch) as rows_read,
       sum(n_tup_ins) + sum(n_tup_upd) + sum(n_tup_del) as rows_changed
from pg_stat_user_tables where schemaname = 'public';

-- Sizes
select pg_size_pretty(pg_database_size(current_database()));
select bucket_id, count(*), sum((metadata->>'size')::bigint) from storage.objects group by 1;
```

Divide by the days since `pg_postmaster_start_time()`.

## Progress log

| Date | Round | What was done |
| --- | --- | --- |
| 27 Oct 2026 | 1 | Architecture options evaluated against live usage and current Cloudflare limits; cost model and study; this index |
| 27 Oct 2026 | 2 | Live schema reference; platform docs 10–17 (target architecture, tenancy, auth and permissions, data layer, jobs and realtime, files, front end and API, integrations and secrets) |
