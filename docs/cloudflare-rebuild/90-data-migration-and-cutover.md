# Data Migration and Cutover

As of 5 Nov 2026. Part of the [rebuild docs](README.md). This is the runbook for moving a school from its Supabase project and Vercel deployment to its own Neon project and the Cloudflare platform ([01](01-architecture-options.md), [10](10-target-architecture.md)). The mechanics are covered elsewhere and are only referenced here:

- preparing the database, dump and restore, the adaptation migration: [13-data-layer.md](13-data-layer.md#moving-each-schools-data-from-supabase);
- accounts: [12-auth-and-permissions.md](12-auth-and-permissions.md#moving-existing-accounts);
- files: [15-files-and-media.md](15-files-and-media.md#moving-existing-files);
- each section's checks: §10 of docs 20–37.

Because the database engine does not change, the move is a copy, not a translation: no type conversion, no rewritten logic. Most of the risk is in what surrounds the database (sign-in, files, jobs, webhooks), and the checks below concentrate there.

## 1. What is being moved

The first school is the live one: Supabase project `tgxxqzeaqxiwoqzopcku` (mps-web, Mumbai), with its Vercel deployment.

| Item | Size |
| --- | --- |
| Database | 207 MB, 221 tables, 304 functions, 172 triggers, 699 policies, about 1,178 accounts |
| Files | About 1 GB across the Supabase buckets |
| Scheduled jobs | 18 `pg_cron` jobs, 5 of them every minute |
| Realtime tables | 6 |
| External callers | Bank and Razorpay webhooks (configured but unused), the Traccar gateway (no devices linked), WhatsApp (Meta), web push subscribers |

Later schools are moved the same way. A brand-new school skips this doc and is provisioned empty ([11](11-tenancy-and-control-plane.md)).

## 2. Principles

1. **Rehearse until boring.** The import runs against a fresh copy of live data at least three times before the real cutover. The last rehearsal must pass every check with no manual step.
2. **Freeze, don't sync.** There is no two-way sync. The old app goes read-only for the cutover window; the import is a single consistent dump.
3. **Verify by recomputing, not by trusting.** Money, totals and derived tables are recomputed on Neon and compared with the imported values, and the row-level security tests run against the new database ([91](91-test-and-parity-plan.md)).
4. **Keep the way back open.** Supabase and Vercel stay intact and read-only for 30 days. Rolling back means pointing DNS back and unfreezing.
5. **Links outlive the move.**
   - Every printed or sent link keeps working: certificate QR codes, receipt QR codes, fee pay links, WhatsApp links.
   - Hosts stay mapped, and tokens are copied unchanged.

## 3. Before cutover (weeks ahead)

| Step | Detail | Owner check |
| --- | --- | --- |
| Spikes passed | S1–S8 ([01](01-architecture-options.md)), above all S1 (restore), S2 (policies with the `auth.uid()` shim), S3 (Data API), S4 (latency from India) and S7 (sleeps at night) | Results recorded in the README |
| Platform ready | Router Worker, `SchoolHub`, the platform database with Hyperdrive and the KV host cache, R2 bucket, queues, Email Service, containers (solver, bank gateway) deployed to production; monitoring and alerts on | All health checks green for a week |
| School row and project | Provision the school ([11](11-tenancy-and-control-plane.md), steps 1–3): the `schools` row (status `provisioning`), its plan and features, its hosts (the current custom domain as primary, plus the old Vercel host so old links resolve), and its Neon project in Singapore | `school_hosts` lists every host ever printed on a QR or sent in a link |
| Section parity | Every section's parity checklist ([91](91-test-and-parity-plan.md)) passes on a rehearsal import | Sign-off per section |
| Decisions | Every open question marked as blocking is decided (list in §10) | Recorded in the README |
| Secrets inventory | List every secret the school uses today: Vercel environment variables, `payment_secrets`, `integration_secrets`, WhatsApp, VAPID, Razorpay, solver | Each one has a new home or is retired ([17](17-integrations-and-secrets.md)) |
| Email | The school's sending domain verified for the Email Service; invite and password-reset emails tested | A test email lands in the inbox, not spam |
| Communication | Tell staff, parents and students: date, the expected downtime, "sign in again once" (passwords stay the same), and how to reset a password | Message sent through announcements and WhatsApp a week before and on the day |
| Freeze switch | Add a read-only mode to the old app: a banner, plus `site_settings.read_only = true` checked by the API routes and by a database trigger that rejects writes for non-service roles | Tested on a Supabase branch |
| Pick the window | A Saturday evening (IST) outside exam and fee-collection deadlines; no bus runs scheduled | Agreed with the school |

## 4. Rehearsal import

Run against a Supabase branch or a restored backup of live, never against live itself, into a scratch Neon project (`<slug>-rehearsal-<n>`) that is deleted afterwards:

1. **Prepare** the target: roles (`anon`, `authenticated`, `service_role`, `app_worker`, `app_jobs`), the `extensions` schema with its extensions, and the `auth` schema with our `auth.users`, `auth.sessions` and the `auth.uid()` functions ([13](13-data-layer.md)).
2. **Accounts:** copy the needed columns of `auth.users` ([12](12-auth-and-permissions.md)).
3. **Dump and restore:** `pg_dump --schema=public --no-owner --no-privileges` from Supabase, `pg_restore` into Neon, then the baseline grants.
4. **Adapt:** the adaptation migration drops the `pg_net` functions and the realtime publication, rewrites Storage URLs to R2 keys, and encrypts the values in `payment_secrets` and `integration_secrets` with the platform key.
5. **Section rules:**

| Section | Rule |
| --- | --- |
| Users ([20](20-users-profiles-and-admin.md)) | One auth user without a profile: import or drop (decide). bcrypt hashes kept as `password_scheme = 'bcrypt'` |
| Settings ([21](21-school-settings-and-branding.md)) | Image URLs in `site_settings` JSON rewritten to R2 keys; the runtime-URL keys left unused |
| Academic structure ([22](22-academic-structure.md)) | Report homerooms without `academic_year_id` and homeroom-member and profile grade mismatches |
| Leave ([24](24-leave.md)) | Check each status against its approvals |
| Announcements ([25](25-announcements-and-notifications.md)) | Attachment JSON URLs → R2 keys; push subscriptions not moved (browsers re-subscribe with the new VAPID key) |
| Classrooms, exams, smartboard, tasks ([26](26-tasks-and-projects.md)–[29](29-exams.md)) | File URLs → R2 keys |
| Grades ([30](30-grades-and-report-cards.md)) | Recompute component totals; differences go to a report |
| Timetable ([31](31-timetable.md)) | Drop the slot-times backup table |
| Certificates ([32](32-certificates.md)) | Every QR host is in `school_hosts` |
| Fees ([33](33-fees.md)) | Recompute invoices and ledger balances (any difference stops the switch); check old receipt hashes still verify (`pgcrypto` in the `extensions` schema); keep verify tokens and pay-link tokens unchanged |
| Payroll ([34](34-payroll-and-salary.md)) | Cycle totals and net pay recomputed |
| Transport ([36](36-transport.md)) | Delete resolved `no_gps` alerts first if decided; import the 2 legacy `bus_fees` through `fee_import_bus_ledger` before cutover if not done yet |
| Home and feedback ([37](37-home-profile-and-misc.md)) | Review the 2 orphan feedback files |

6. **Files:** copy to `schools/<schoolId>/` in R2 (the real prefix; the copy is incremental, so rehearsals do most of the work for the real night).
7. **Verify:** row counts per table, money totals, checksums of ids and key columns, recomputations, file references, and the row-level security suite run against the restored database ([91](91-test-and-parity-plan.md) §3).
8. **Click through:** the automated parity suite and a scripted click-through of each role against a rehearsal host pointed at the scratch project.
9. **Time it.** Record each phase. The real window is planned from the slowest rehearsal, times two.

## 5. Cutover day

Times are relative to T, the start of the freeze. Expected total: under 2 hours. The data is small: 207 MB and 1 GB.

| When | Step | Rollback if it fails |
| --- | --- | --- |
| T − 24 h | Lower the DNS TTL on the school's host to 60 s. Final announcement | — |
| T − 1 h | Confirm no bus runs, exams in progress, or online payments pending (`fee_online_orders` in `created` or `processing`). Take a Supabase backup | Postpone |
| T | Turn on read-only mode in the old app. Unschedule all 18 `pg_cron` jobs, keeping the list to restore. Stop the Traccar forwarders for the school's devices, if any | Turn read-only off, reschedule cron |
| T + 5 m | Prepare, copy accounts, dump and restore, adapt (steps 1–4 of §4) into the school's real Neon project | Reset the Neon project's branch; unfreeze |
| T + 20 m | Copy files to R2 (only those added since the last rehearsal) | As above |
| T + 30 m | Verify: all checks from the rehearsal must pass exactly. Any money difference stops the cutover | Unfreeze old app; investigate |
| T + 45 m | Register external endpoints: the bank collect and payout callbacks and Razorpay webhooks at `/hooks/<schoolId>/...`; Traccar forward URLs for linked devices; the WhatsApp webhook if inbound messages are used | Old URLs still work while DNS points back |
| T + 55 m | Set the school's status to `active`. Switch DNS (or the Cloudflare custom hostname) to the platform. Keep the old Vercel routes for webhooks forwarding to the new hooks for a week | Point DNS back; set the school to `read_only` |
| T + 60 m | Turn on the school's hub jobs (transport tick, the night window, fee autogen, reminders) and outbound messages | Turn them off |
| T + 65 m | Smoke test with real accounts for each role: sign in (bcrypt hash upgraded on success), home loads, mark attendance, open a classroom, open fees and a receipt QR, scan a certificate QR, open the timetable, open transport | Roll back if any core flow fails |
| T + 90 m | Announce the app is back. Monitor errors, sign-in failures and the outbox for the evening | — |

## 6. After cutover

| When | Step |
| --- | --- |
| Night 1 | Confirm in the Neon console that the school's compute suspended after the night window and stayed asleep until morning |
| Day 1–7 | Daily check: sign-in failure rate, error rate per route, latency per screen from India, outbox failures, hub alarm health, R2 404s (missing files), webhook deliveries. Fix forward rather than roll back unless data is at risk |
| Day 1–7 | Track how many users have signed in, so the bcrypt hashes are being upgraded to scrypt. Proposal: after 90 days, users who still have a bcrypt hash get a reset link on their next attempt instead of a bcrypt check, so the bcrypt code can be removed |
| Day 7 | Remove the old Vercel webhook forwarders |
| Day 14 | Read the compute hours and size from Neon's console and update the cost model ([02](02-cost-study.md)) |
| Day 30 | Final decision: no rollback. Take a final Supabase `pg_dump` to R2 (`backups/<schoolId>/legacy/`), then pause the Supabase project and delete the Vercel project. Cancel the Supabase plan once every school has moved |
| Day 30 | Revoke old secrets: Supabase service role, Vercel tokens, the per-deployment Traccar token, old VAPID keys |

## 7. Rollback

Rollback is possible until day 30, but data written on the new platform after cutover is not copied back automatically.

- **Within the cutover window:** point DNS back, turn read-only off, reschedule cron. Nothing is lost.
- **After users have written new data:** both sides are Postgres with the same schema, so the rows written after T (by `created_at` or `updated_at`) can be copied back table by table with plain SQL before DNS is pointed back. Accounts created after T need their `auth.users` rows recreated in Supabase. This is still the reason for the strict verification before switching DNS, and for fixing forward afterwards.

## 8. Moving later schools

Each school that runs the current single-tenant app follows the same runbook with its own Supabase project. The differences:

- The importer takes the Supabase connection string and a target school id. Nothing else in it is specific to a school.
- A small school can be restored straight into a pod instead of a project of its own ([11](11-tenancy-and-control-plane.md)).
- Several schools can be moved on the same evening; each is independent.
- Each school's schema must be at the same migration version as the baseline. A school that has missed some of `supabase-migrations/` gets them applied in Supabase first, or the importer applies the gap after the restore.

## 9. Tooling to build

| Tool | Purpose |
| --- | --- |
| `tools/import-supabase` | Prepare, copy accounts, dump and restore, adapt and verify one school; resumable from any step |
| `tools/copy-files` | Copy Supabase Storage objects to R2 with the key mapping; incremental by `updated_at` and size |
| `tools/migrate` | Apply `db/migrations` to the school after the restore, and to every school afterwards ([13](13-data-layer.md)) |
| Verify queries | Row counts, money totals, checksums and recomputations, run on both sides and compared |
| Read-only switch for the old app | Small change to the current repo (API routes plus a write-blocking trigger) |
| Cutover checklist page | The steps in §5 as a checklist in the platform console, with timestamps, so the run is recorded |

## 10. Decisions needed before the first cutover

Under Neon the schema moves as it is, so only decisions that affect the copy itself or the running platform block the cutover:

- [ ] Data location: school data stored in Singapore; confirm no contract forbids it ([01](01-architecture-options.md)).
- [ ] Import the one auth user with no profile? ([20](20-users-profiles-and-admin.md))
- [ ] Delete resolved transport `no_gps` alerts before the move? ([36](36-transport.md))
- [ ] Which modules the live school's plan includes ([11](11-tenancy-and-control-plane.md)).
- [x] Students reading raw marks before publication: tightened in the current app on 28 Oct 2026 ([30](30-grades-and-report-cards.md)).

No longer blocking, because they are later migrations rather than part of the move: folding `task_assignees` into `tasks` ([26](26-tasks-and-projects.md)), payroll option A, B or C ([34](34-payroll-and-salary.md)), and settling bank collections into v2 fee bills only ([35](35-bank-collections-and-payouts.md)).
