# Data Migration and Cutover

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). This is the runbook for moving a school from its Supabase project and Vercel deployment to the Cloudflare platform. The mechanics are covered elsewhere and are only referenced here:

- the importer and type map: [13-data-layer.md](13-data-layer.md#moving-each-schools-data-from-supabase);
- accounts: [12-auth-and-permissions.md](12-auth-and-permissions.md#moving-existing-accounts);
- files: [15-files-and-media.md](15-files-and-media.md#moving-existing-files);
- each section's special steps: §10 of docs 20–37.

## 1. What is being moved

The first school is the live one: Supabase project `tgxxqzeaqxiwoqzopcku` (mps-web, Mumbai), with its Vercel deployment.

| Item | Size |
| --- | --- |
| Database | 192 MB, 217 tables, about 1,178 accounts |
| Files | About 1 GB across the Supabase buckets |
| Academic years | 2026-27 active; 2025-26 and 2027-28 in planning. None closed, so everything goes into the live school object and no archive objects are created at cutover |
| Scheduled jobs | 15 `pg_cron` jobs |
| Realtime tables | 6 |
| External callers | Bank and Razorpay webhooks (configured but unused), the Traccar gateway (no devices linked), WhatsApp (Meta), web push subscribers |

Later schools are moved the same way. A brand-new school skips this doc and is provisioned empty ([11](11-tenancy-and-control-plane.md)).

## 2. Principles

1. **Rehearse until boring.** The importer runs against a fresh copy of live data at least three times before the real cutover. The last rehearsal must pass every check with no manual step.
2. **Freeze, don't sync.** There is no two-way sync. The old app goes read-only for the cutover window; the import is a single consistent copy.
3. **Verify by recomputing, not by trusting.** Money, totals and derived tables are recomputed in the new system and compared with the imported values ([91](91-test-and-parity-plan.md)).
4. **Keep the way back open.** Supabase and Vercel stay intact and read-only for 30 days. Rolling back means pointing DNS back and unfreezing.
5. **Links outlive the move.**
   - Every printed or sent link keeps working: certificate QR codes, receipt QR codes, fee pay links, WhatsApp links.
   - Hosts stay mapped, and tokens are copied unchanged.

## 3. Before cutover (weeks ahead)

| Step | Detail | Owner check |
| --- | --- | --- |
| Platform ready | Router Worker, `School` object class, `platform` D1, R2 bucket, queues, Email Service, containers (solver, bank gateway) deployed to production; monitoring and alerts on | All health checks green for a week |
| School row | Create the `schools` row (status `provisioning`), its plan and features, and its hosts: the current custom domain as primary, plus the old Vercel host so old links resolve | `school_hosts` lists every host ever printed on a QR or sent in a link |
| Section parity | Every section's parity checklist ([91](91-test-and-parity-plan.md)) passes on a rehearsal import | Sign-off per section |
| Decisions | Every open question marked as blocking in docs 10–37 is decided (list in §10) | Recorded in the README |
| Secrets inventory | List every secret the school uses today: Vercel environment variables, `payment_secrets`, `integration_secrets`, WhatsApp, VAPID, Razorpay, solver | Each one has a new home or is retired ([17](17-integrations-and-secrets.md)) |
| Email | The school's sending domain verified for the Email Service; invite and password-reset emails tested | A test email lands in the inbox, not spam |
| Communication | Tell staff, parents and students: date, the expected downtime, "sign in again once", and how to reset a password | Message sent through announcements and WhatsApp a week before and on the day |
| Freeze switch | Add a read-only mode to the old app: a banner, plus `site_settings.read_only = true` checked by the API routes and by a database trigger that rejects writes for non-service roles | Tested on a branch project |
| Pick the window | A Saturday evening (IST) outside exam and fee-collection deadlines; no bus runs scheduled | Agreed with the school |

## 4. Rehearsal import

Run against a Supabase branch or a restored backup of live, never against live itself:

1. Export: every table in `public`, plus `auth.users` (id, email, hash, confirmation, ban and last sign-in only).
2. Transform with the type map in [13](13-data-layer.md), applying each section's rules:

| Section | Rule |
| --- | --- |
| Users ([20](20-users-profiles-and-admin.md)) | One auth user without a profile: import or drop (decide). bcrypt hashes kept as `password_scheme = 'bcrypt'` |
| Settings ([21](21-school-settings-and-branding.md)) | Keys renamed to namespaces; `fee_runtime` and `transport_runtime_config` dropped; image URLs rewritten to R2 keys; every value validated against its schema |
| Academic structure ([22](22-academic-structure.md)) | Fill missing `academic_year_id`; report homeroom-member and profile grade mismatches |
| Attendance ([23](23-attendance.md)) | `e` → `exception`; build `student_attendance_daily` |
| Leave ([24](24-leave.md)) | Check each status against its approvals |
| Announcements ([25](25-announcements-and-notifications.md)) | Attachment JSON URLs → R2 keys; push subscriptions not moved |
| Tasks ([26](26-tasks-and-projects.md)) | Split the 37 tasks that have several assignees; decide on the 155 with none; build `task_stats_monthly` |
| Classrooms ([28](28-classrooms-and-coursework.md)) | Build `edu_points_ledger` from progress and homework completions |
| Grades ([30](30-grades-and-report-cards.md)) | Recompute component totals; differences go to a report |
| Timetable ([31](31-timetable.md)) | Drop the slot-times backup table |
| Fees ([33](33-fees.md)) | Rupees → paise (reject more than 2 decimals); percentages → basis points; recompute invoices and ledger balances (any difference stops the import); keep receipt hashes, verify tokens and pay-link tokens unchanged; drop empty first-generation tables after confirming they are empty |
| Payroll ([34](34-payroll-and-salary.md)) | Units converted; cycle totals and net pay recomputed |
| Payments ([35](35-bank-collections-and-payouts.md)) | Payment config to settings; `payment_secrets` (empty today) to encrypted secrets |
| Transport ([36](36-transport.md)) | Skip resolved `no_gps` alerts if decided; import the 2 legacy `bus_fees` through `fee_import_bus_ledger` first; driver payroll base and banks into salary with `person_kind = 'driver'` |
| Home and feedback ([37](37-home-profile-and-misc.md)) | Streaks and feedback copied; review the 2 orphan feedback files |

3. Import into a **rehearsal** school object (`<schoolId>-rehearsal-<n>`) with jobs and outbound messages switched off.
4. Copy files to `schools/<rehearsalId>/` in R2.
5. Verify: row counts, money totals, checksums, recomputations, and file references ([91](91-test-and-parity-plan.md) §3).
6. Run the automated parity suite and a scripted click-through of each role against the rehearsal host.
7. Record the time each phase took. The real window is planned from the slowest rehearsal, times two.

## 5. Cutover day

Times are relative to T, the start of the freeze. Expected total: under 2 hours. The data is small: 192 MB and 1 GB.

| When | Step | Rollback if it fails |
| --- | --- | --- |
| T − 24 h | Lower the DNS TTL on the school's host to 60 s. Final announcement | — |
| T − 1 h | Confirm no bus runs, exams in progress, or online payments pending (`fee_online_orders` in `created` or `processing`). Snapshot Supabase (backup) | Postpone |
| T | Turn on read-only mode in the old app. Pause all `pg_cron` jobs (`cron.unschedule`, keeping the list to restore). Stop the Traccar forwarders for the school's devices, if any | Turn read-only off, re-enable cron |
| T + 5 m | Export, transform, import into the real school object (jobs and outbound messages still off) | Discard the school object; unfreeze |
| T + 30 m | Copy files to R2 (incremental since the last rehearsal; most files were copied in advance and only new ones move now) | As above |
| T + 45 m | Verify: all checks from the rehearsal must pass exactly. Any money difference stops the cutover | Unfreeze old app; investigate |
| T + 60 m | Register external endpoints: the bank collect and payout callbacks and Razorpay webhooks at `/hooks/<schoolId>/...`; Traccar forward URLs for linked devices; the WhatsApp webhook if inbound messages are used | Old URLs still work while DNS points back |
| T + 70 m | Set the school's status to `active`. Switch DNS (or the Cloudflare custom hostname) to the platform. Keep the old Vercel routes for webhooks forwarding to the new hooks for a week | Point DNS back; set the school to `read_only` |
| T + 75 m | Turn on the school's alarms and jobs: tick, materialise, fee autogen, reminders, cleanups. Turn on outbound messages | Turn them off |
| T + 80 m | Smoke test with real accounts for each role: sign in (bcrypt hash upgraded on success), home loads, mark attendance, open a classroom, open fees and a receipt QR, scan a certificate QR, open the timetable, open transport | Roll back if any core flow fails |
| T + 2 h | Announce the app is back. Monitor errors, sign-in failures and the outbox for the evening | — |

## 6. After cutover

| When | Step |
| --- | --- |
| Day 1–7 | Daily check: sign-in failure rate, error rate per method, outbox failures, alarm health, R2 404s (missing files), webhook deliveries. Fix forward rather than roll back unless data is at risk |
| Day 1–7 | Track how many users have signed in, so the bcrypt hashes are being upgraded to scrypt. Proposal: after 90 days, users who still have a bcrypt hash get a reset link on their next attempt instead of a bcrypt check, so the bcrypt code can be removed |
| Day 7 | Remove the old Vercel webhook forwarders |
| Day 30 | Final decision: no rollback. Take a final Supabase backup to R2 (`schools/<id>/legacy/`), then pause the Supabase project and delete the Vercel project. Cancel the Supabase plan once every school has moved |
| Day 30 | Revoke old secrets: Supabase service role, Vercel tokens, the per-deployment Traccar token, old VAPID keys |

## 7. Rollback

Rollback is possible until day 30, but data written on the new platform after cutover is not copied back automatically.

- **Within the cutover window:** point DNS back, turn read-only off, re-enable cron. Nothing is lost.
- **After users have written new data:** first export the new writes per table, by `created_at` or `updated_at` after T, so they can be re-entered or replayed. Then point DNS back. This is the reason for the strict verification before switching DNS, and for fixing forward afterwards.

## 8. Moving later schools

Each new school deployment that runs the current single-tenant app follows the same runbook with its own Supabase project. The differences:

- The importer takes the Supabase connection string and a target school id. Nothing else in it is specific to a school.
- Schools that have closed academic years: after import, run the year-close archive job for each closed year, so the live object starts small ([13](13-data-layer.md)).
- Several schools can be moved on the same evening; each is independent.

## 9. Tooling to build

| Tool | Purpose |
| --- | --- |
| `tools/import-supabase` | Export, transform, import and verify one school; idempotent per batch; resumable |
| `tools/copy-files` | Copy Supabase Storage objects to R2 with the key mapping; incremental by `updated_at` and size |
| `system.importBatch`, `system.verify`, `system.recompute` | School object methods, callable only by platform staff with a support grant |
| Read-only switch for the old app | Small change to the current repo (API routes plus a write-blocking trigger) |
| Cutover checklist page | The steps in §5 as a checklist in the platform admin, with timestamps, so the run is recorded |

## 10. Decisions needed before the first cutover

Collected from the open questions in the section docs. Each must be decided because it changes the schema or the import:

- [ ] Import the one auth user with no profile? ([20](20-users-profiles-and-admin.md))
- [ ] Tasks with several assignees: split or keep a child table? Tasks with no assignee: assign to the creator or drop? ([26](26-tasks-and-projects.md))
- [x] Students reading raw marks before publication: tightened in the current app on 28 Oct 2026 ([30](30-grades-and-report-cards.md))
- [ ] Payroll option A, B or C ([34](34-payroll-and-salary.md))
- [ ] Bank collections settle into v2 fee bills only ([35](35-bank-collections-and-payouts.md))
- [ ] Keep or drop resolved transport alerts ([36](36-transport.md))
- [ ] Which modules the live school's plan includes ([11](11-tenancy-and-control-plane.md))
