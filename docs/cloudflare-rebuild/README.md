# EdZee Rebuild Docs: Neon and Cloudflare

**EdZee** is the name of the rebuilt, multi-tenant app; **EduBerry** is today's one-school app that these docs describe as the starting point. Host names such as `<slug>.edzee.in` are placeholders until the domain is registered.

Started 27 Oct 2026; rewritten around Neon on 5 Nov 2026. These documents describe the EduBerry app section by section: how each part works today as a one-school-per-deployment app on Supabase and Vercel, and what it must become in the multi-tenant version on Neon Postgres and Cloudflare. They are written to be the brief for rebuilding the app in a new repository cloned from this one.

## Why these docs exist

Today every school is a separate copy of the app: its own Vercel project, its own Supabase project (database, login, files, realtime, scheduled jobs) and its own environment variables. The target is one app that serves every school. Each school keeps its own Postgres database, moved from Supabase to a Neon project of its own; everything else runs on Cloudflare; no Supabase service is used, including Supabase Auth.

The new repository starts as a clone of this one; [HANDOFF.md](HANDOFF.md) holds the prompt that starts its first session. Read these docs in order, run the spikes in the architecture doc, then build the platform and move the sections in the order given in [92-build-order.md](92-build-order.md). Each section doc lists what exists today in enough detail (tables, functions, triggers, routes, screens, jobs, integrations, single-school assumptions) that nothing is lost, and says how it maps onto the target design.

## Target in one paragraph

One router Worker serves the app for every school. It finds the school from the host name, verifies the user's access token, and runs each request as that user against the school's own **Neon Postgres database**, where today's tables, functions, triggers and row-level security policies keep working unchanged. A **platform database** (also Neon, reached through Hyperdrive, cached in KV) holds the platform's own records: schools, hosts, plans, encrypted connection strings. Files go to **R2** under a per-school prefix. A small **`SchoolHub` Durable Object** per school holds live WebSockets and the school's job timer, so nothing scheduled runs inside Postgres and each database can sleep when nobody is using the app. **Queues** carry outgoing WhatsApp, push, email, webhook and job work. The browser app is a static single-page app served free from **Workers Static Assets**; in phase 1 it keeps today's queries through Neon's Data API, and in phase 2 each screen moves to one Worker endpoint. The reasoning, the options rejected and the spikes to run first are in [01-architecture-options.md](01-architecture-options.md); the costs are in [02-cost-study.md](02-cost-study.md).

## Words used in every doc

| Term | Meaning |
| --- | --- |
| School, tenant | One customer school. Today: one Vercel project + one Supabase project. Target: one row in the platform database + one Neon project (or a database in a pod) + one `SchoolHub` + one R2 prefix |
| Router Worker | The single Worker that receives every request for every school |
| School database | The school's own Postgres database in Neon, holding its data and logic as today |
| `SchoolHub` | The small Durable Object per school for live sockets and the job timer; it holds no school data |
| Platform database | The one shared Neon database for platform records; never holds school data |
| Pod | A Neon project holding several small schools' databases on one compute, to save cost ([11](11-tenancy-and-control-plane.md)) |
| Phase 1, phase 2 | Phase 1: today's browser queries through Neon's Data API. Phase 2: one Worker endpoint per screen ([16](16-frontend-and-api.md)) |
| Today | The live database `mps-web` (Supabase project `tgxxqzeaqxiwoqzopcku`, Mumbai), counts read on 5 Nov 2026; section docs were written against `main` at commit `4762ae2` on 27 Oct 2026 |
| Single-tenant assumption | Anything that works only because a deployment serves one school: environment variables, singleton settings rows, hard-coded names, domains or time zones |

## Documents and status

Status: **Done** = written and pushed. All rounds are done; round 10 rewrote the set around Neon. The order of work in the new repository is in [92-build-order.md](92-build-order.md).

| Round | Doc | Covers | Status |
| --- | --- | --- | --- |
| 1 | [README.md](README.md) | This index, the plan and the template | Done |
| 1 | [01-architecture-options.md](01-architecture-options.md) | Neon per school (chosen) vs pods vs Durable Objects vs D1 and others; validation; decision; spikes S1–S8 | Done |
| 1 | [02-cost-study.md](02-cost-study.md) + [tools/costmodel.py](tools/costmodel.py) | Workload model from live data; Neon compute model; cost per school and per fleet up to 10,000 users, against Durable Objects and Supabase | Done |
| 11 | [04-database-and-region-options.md](04-database-and-region-options.md) | MongoDB and India-hosted Postgres (Supabase Mumbai, Aurora, RDS) against Neon Singapore: cost per school and per fleet, effort, latency, data location | Done |
| 9 | [03-cost-efficiency.md](03-cost-efficiency.md) | Cost-efficiency practices checked against the cost study; what is done, what the rebuild must do, a checklist per screen | Done |
| 2 | [10-target-architecture.md](10-target-architecture.md) | Building blocks, request lifecycle, how the database knows the user, repository layout, environments, deploys, observability, limits | Done |
| 2 | [11-tenancy-and-control-plane.md](11-tenancy-and-control-plane.md) | Platform database, finding the school from the host, roles in each school database, domains, instant provisioning after checkout from a pool of ready databases, pods and the 100-project limit, offboarding, platform console | Done |
| 2 | [12-auth-and-permissions.md](12-auth-and-permissions.md) | Replacing Supabase Auth with our own sign-in; `auth.users` kept; tokens; `auth.uid()` on both paths; row-level security kept | Done |
| 2 | [13-data-layer.md](13-data-layer.md) | Supabase Postgres to Neon Postgres: the 11 hooks to replace, migrations per school, query rules, dump and restore, backups | Done |
| 2 | [14-jobs-messaging-realtime.md](14-jobs-messaging-realtime.md) | `pg_cron`, `pg_net` and Realtime replaced by the hub's timer, Queues and WebSockets; keeping databases asleep | Done |
| 2 | [15-files-and-media.md](15-files-and-media.md) | Supabase Storage to R2 | Done |
| 2 | [16-frontend-and-api.md](16-frontend-and-api.md) | Next.js to a static app; phase 1 through the Data API proxy; phase 2 endpoints; CSP; PWA | Done |
| 2 | [17-integrations-and-secrets.md](17-integrations-and-secrets.md) | Banks, Razorpay, WhatsApp, GPS gateway, email, web push, solver; per-school secrets | Done |
| 2 | [reference/live-schema.md](reference/live-schema.md) | Every live table, column, link, trigger, function, enum, view and cron job, by section | Done |
| 3 | [20-users-profiles-and-admin.md](20-users-profiles-and-admin.md) | Profiles, student and staff details, user management, bulk import, audit | Done |
| 3 | [21-school-settings-and-branding.md](21-school-settings-and-branding.md) | Site settings, design, page themes, banners, school profile, favicon | Done |
| 3 | [22-academic-structure.md](22-academic-structure.md) | Academic years, homerooms, classrooms, teams, subjects | Done |
| 4 | [23-attendance.md](23-attendance.md) | Student and staff attendance, geofence, rules, holiday calendars, reports | Done |
| 4 | [24-leave.md](24-leave.md) | Student and staff leave and approvals | Done |
| 4 | [25-announcements-and-notifications.md](25-announcements-and-notifications.md) | Announcements, audiences, reads, push and in-app notifications | Done |
| 4 | [26-tasks-and-projects.md](26-tasks-and-projects.md) | Task manager, subtasks, projects, planner, team analytics | Done |
| 4 | [27-smartboard.md](27-smartboard.md) | Homeroom kiosk | Done |
| 5 | [28-classrooms-and-coursework.md](28-classrooms-and-coursework.md) | LMS: coursework, homework, files, discussions, analysis | Done |
| 5 | [29-exams.md](29-exams.md) | Exams, attempts, grading, results | Done |
| 5 | [30-grades-and-report-cards.md](30-grades-and-report-cards.md) | Assessments, marks, report cards, academic record | Done |
| 5 | [31-timetable.md](31-timetable.md) | Timetable builder and the CP-SAT solver | Done |
| 5 | [32-certificates.md](32-certificates.md) | Certificates and public verification | Done |
| 6 | [33-fees.md](33-fees.md) | Fee structures, invoices, collection, receipts, refunds, reminders | Done |
| 6 | [34-payroll-and-salary.md](34-payroll-and-salary.md) | Payroll runs, salary records, statutory, locations | Done |
| 6 | [35-bank-collections-and-payouts.md](35-bank-collections-and-payouts.md) | Bank smart collect, UPI, payouts, webhooks, Razorpay | Done |
| 7 | [36-transport.md](36-transport.md) | Routes, runs, GPS, driver app, alerts, live tracking, bus fees and bus payroll | Done |
| 8 | [37-home-profile-and-misc.md](37-home-profile-and-misc.md) | Home dashboards, profile, feedback, gamification, quotes | Done |
| 8 | [90-data-migration-and-cutover.md](90-data-migration-and-cutover.md) | Moving each live school from Supabase to its Neon project | Done |
| 8 | [91-test-and-parity-plan.md](91-test-and-parity-plan.md) | How to prove each section matches today | Done |
| 8 | [92-build-order.md](92-build-order.md) | Order of work in the new repository, milestones | Done |

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
9. **Target design** — what moves unchanged, phase 2 endpoints, schema improvements worth making later, jobs, files, live updates, integrations.
10. **Moving existing data** — checks and rewrites needed when the school's database is dumped and restored into Neon.
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
| 27 Oct 2026 | 3 | Section docs 20–22: users, profiles and admin; school settings and branding; academic years, homerooms and teams |
| 27 Oct 2026 | 4 | Section docs 23–27: attendance, leave, announcements and notifications, task manager and projects, smartboard |
| 27 Oct 2026 | 5 | Section docs 28–32: classrooms and coursework, exams, assessments and report cards, timetable, certificates |
| 27 Oct 2026 | 6 | Section docs 33–35: fees, payroll and salary, bank collections and payouts |
| 27 Oct 2026 | 7 | Section doc 36: transport (live runs stay in the school object; positions move out of SQL into trail chunks and R2) |
| 27 Oct 2026 | 8 | Doc 37 (home, profile, feedback, streaks); 90 data migration and cutover runbook; 91 test and parity plan; 92 build order with milestones M0–M7 and the list of issues to fix now versus in the rebuild |
| 28 Oct 2026 | 9 | Doc 03 (cost efficiency). Live fixes in the current app: home fee figures, private attachments, subtask uploads, report-card marks gate, profile email visibility |
| 5 Nov 2026 | 10 | Decision changed to Neon Postgres per school, Cloudflare for everything else: rewrote 01, 02 (Neon cost model), 03, 10–17, 90–92 and this index; updated section docs 20–37 (functions and policies move unchanged; jobs on the hub's timer; phase 2 endpoints). The Durable Object design is kept in 01 and git history as the alternative |
| 5 Nov 2026 | 11 | Doc 04 (MongoDB and India-hosted Postgres against Neon; `db_options()` in the cost model). Doc 11: schools start within seconds of checkout from a pool of ready databases; new and small schools start in pods |
| 5 Nov 2026 | 12 | Neon confirmed after the MongoDB, Firebase and DigitalOcean checks (doc 04; `tools/spike-do/verify.sh` proves the multi-tenancy model on any Postgres). Spike S4 desk estimate in doc 01. Handoff prompt rewritten: build the school database from the live Supabase schema, not from scratch |
