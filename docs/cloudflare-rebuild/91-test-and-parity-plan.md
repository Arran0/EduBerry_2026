# Test and Parity Plan

As of 5 Nov 2026. Part of the [rebuild docs](README.md). How to prove that each section of the rebuilt app does what today's app does, for every school, before and after the move. Each section doc's §11 lists that section's checks; this doc says how they are run. The design is a Neon Postgres project per school with Cloudflare for everything else ([01](01-architecture-options.md)).

## 1. Where testing starts from

| Today | Count |
| --- | --- |
| TypeScript test files (Vitest) | 40, plus guards added since (for example `profileColumns.test.ts`) |
| Python tests | 1 file for the CP-SAT solver (`services/solver/tests/test_model.py`) |
| Test cases | About 590 (588 at the last full run in `docs/gps-system-status.md`) |
| Tests of SQL functions, triggers and row-level security | None |
| End-to-end browser tests | None |

The TypeScript test files cover:

| Area | Files |
| --- | --- |
| Timetable | 7 |
| Fee engine and fees | 6 |
| Payroll and salary | 8 |
| Attendance | 5 |
| Home cards | 3 |
| Others | 11 |

Under Neon the 699 policies and 304 SQL functions move unchanged, so the risk is no longer rewritten logic. It is the same logic in new surroundings:

- does `auth.uid()` return the right user on both the Worker path and the Data API path;
- do the policies show each role the same rows on Neon as on Supabase;
- do the jobs, drains and webhooks still reach the same functions;
- does the Data API answer today's queries exactly as PostgREST does.

None of that has tests today, so most of this plan is about it.

## 2. Test layers in the new repository

| Layer | Tool | What it proves | Runs |
| --- | --- | --- | --- |
| Unit | Vitest (Node) | Pure logic: fee engine, payroll engine, timetable generator, exam scoring, date and money helpers. The existing files are ported first and must pass unchanged | Every commit |
| Database | Vitest against a fresh Neon branch of the seeded test school (copy-on-write, created and deleted per run) | SQL functions, triggers and locks as each role, through the same "run as user" helper the Worker uses; each test in a transaction that is rolled back | Every commit |
| Row-level security matrix | Generated database tests | Every table × every role × own or other record: the rows visible, insertable, updatable and deletable equal what Supabase allows today (§4) | Every commit |
| Worker | Vitest with `@cloudflare/vitest-pool-workers` (runs in `workerd`) against the same Neon branch | Routes, sign-in and tokens, the `/api/db` proxy, webhooks, queue consumers, the `SchoolHub` timer and sockets | Every commit |
| Tenant isolation | Worker and database tests with two schools | No route, hook, token, file key, socket topic or job can read or change another school's data (§5) | Every commit |
| Data API parity (phase 1) | Today's query catalogue replayed through `/api/db` and through Supabase's PostgREST | Same rows, same counts, same errors, for each role (§4) | Every commit while phase 1 is live |
| Migration dry run | `tools/migrate --dry-run` on a Neon branch of every live school | Pending migrations apply cleanly to real data ([13](13-data-layer.md)) | Every release |
| Import verification | `tools/import-supabase verify` | An imported school matches its source: counts, totals, checksums, recomputations (§6) | Each rehearsal and the cutover |
| End-to-end | Playwright (Chromium is available in CI) against a seeded school on a preview deployment with its own Neon branch | Core journeys per role through the real UI (§7) | Every merge to main, and nightly |
| Load | k6 or a Worker-based load script against a staging school | Peak-hour latency from India and compute size at 10,000 users (§8) | Before each milestone and before onboarding a large school |

## 3. Port the existing tests first

Step 1 of the build ([92](92-build-order.md)) is a repository where the existing TypeScript test files and the solver test pass. Rules:

- Keep the test bodies unchanged. Change only imports, and the data-access stubs where a test mocks Supabase.
- A test that relied on Supabase behaviour (for example `payoutClaim.test.ts` mocking a conditional update) becomes a database test against a Neon branch, which runs the real conditional update.
- Money stays in rupees as `numeric`, so no assertion changes units.

## 4. Parity: same inputs on both sides

Because both sides run the same SQL, parity is checked by running the same inputs against a Supabase branch and a Neon branch restored from the same dump, and comparing. A difference points at the surroundings: an extension, a `search_path`, a database setting such as `TimeZone`, or `auth.uid()`.

1. **Seed:** a Supabase branch restored from live, plus synthetic additions where live data does not exercise a rule. For example: fee concessions over the approval threshold, partial payments, a reversed payment, a payroll run with arrears, a transport run with a skipped stop. The same dump is restored into a Neon branch.
2. **Run both:** a script signs in as each role on each side and runs the same function calls, writes and queries, saving `{call, role, inputs, output}` from both. For trigger chains, it performs the write and records the resulting rows of every affected table.
3. **Compare:** ids and timestamps are normalised; money is compared exactly.
4. **Freeze:** the Supabase answers are committed as fixtures (scrubbed of personal data), so the Neon side can be checked on every commit after Supabase is gone. When a section intentionally changes behaviour, the fixture is updated in a commit that says so.

Priority, by risk:

| Priority | Area | What to compare |
| --- | --- | --- |
| 1 | Accounts and row-level security ([12](12-auth-and-permissions.md)) | `auth.uid()` and `auth.jwt()` on both paths; every table's visible and writable rows for each role; the two functions that read `user_metadata.role` |
| 1 | Data API ([16](16-frontend-and-api.md)) | Today's query catalogue: embedding, `...profile_emails(email)` spreads, `count: 'exact'`, RPCs returning sets with filters, upserts, error codes such as `PGRST116` |
| 1 | Fees ([33](33-fees.md)) | Grid issue, charges, concessions, late fees, collection and allocation, reversal, refunds, credits, carry-forward, bill register, every report and view, receipt payload and hash (`pgcrypto` in the `extensions` schema) |
| 1 | Jobs ([14](14-jobs-messaging-realtime.md)) | Each former `pg_cron` function called by the hub's timer gives the same result at the same local time; the outbox produces the same messages, once each |
| 2 | Attendance ([23](23-attendance.md)) | Staff punch with geofence verdicts and exceptions, recompute, daily and monthly reports (time-zone sensitive) |
| 2 | Transport ([36](36-transport.md)) | `transport_simulate_day` plus recorded real runs sent through the Worker route: stop events, ETAs, delays, alerts, tick outcomes, live events published to the hub |
| 2 | Payroll and salary ([34](34-payroll-and-salary.md)) | Cycle generation, tallies, lock hash, run transitions |
| 3 | Grades, leave, classrooms, tasks, announcements, timetable, certificates, exams | Each section's §11 checks |

## 5. Tenant isolation tests

These must never fail. A failure blocks a release.

- Two seeded schools, A and B, with overlapping names, ids generated independently, and the same certificate and receipt number formats, each in its own Neon branch.
- Host routing: a request to A's host only ever uses A's connection string; B's host never serves A's data.
- Tokens: an access token issued by A is refused by B, on the Worker path and through B's Data API; a refresh cookie for A's host is never sent to B's.
- Hooks: `/hooks/<A>/...` with B's secret is rejected.
- Public routes: `/verify/<certNo>` on B's host never finds A's certificate.
- R2 keys: a signed file URL for A cannot be altered to read B's key; the files route builds the prefix from the host's school.
- WebSockets: each school has its own hub, so a socket on A's hub cannot receive B's events; still tested.
- Jobs and queues: every message carries a school id. A consumer given a mixed batch never touches the wrong school's database.
- Pods: A's login roles cannot connect to B's database in the same project.
- Platform staff: access to a school's data needs a support grant; the grant is audited and expires.

## 6. Import verification (each rehearsal and the cutover)

| Check | Rule |
| --- | --- |
| Row counts | Equal per table, after documented exclusions (dropped tables, skipped alerts) |
| Money | Per student and per academic year: billed, paid, concession, refund, balance equal to the paisa. Per salary record: net pay equal |
| Recompute | Invoices from lines and allocations; ledger running balances; assessment totals from components; leave status from approvals; cycle tallies. Any difference is listed, and money differences stop the switch |
| Checksums | Per table, a hash of sorted ids and key columns, computed on both sides |
| References | Every foreign key resolves. Every R2 key referenced by a row exists. Every certificate, receipt and pay-link token resolves on the school's host |
| Accounts | Every profile has an `auth.users` row and vice versa (except documented exceptions). A sample of bcrypt hashes verifies with known test passwords on a rehearsal copy that includes seeded test accounts |
| Row-level security | The §4 matrix passes against the imported database |
| Objects | Function, trigger, policy and index counts equal to the source, less the documented drops |

## 7. End-to-end journeys (Playwright)

One seeded school with every role. Each journey runs on phone and desktop viewports.

| Role | Journeys |
| --- | --- |
| Student | Sign in; home cards; timetable; classroom, open coursework, submit homework with a file; take an exam; see a published report card; pay a fee online (Razorpay test mode) and get a receipt; see the bus live (simulated run) |
| Parent | Pay link from WhatsApp opens without sign-in and pays; child's bus view |
| Teacher | Mark attendance; staff punch inside and outside the geofence; create an assessment with components and enter marks; create a task from the timetable; apply for leave |
| Class teacher | Publish report cards; class-wise marks |
| Approver (coordinator, principal) | Approve leave in the chain; see notifications and the live badge |
| Admin | Create users and import from CSV; issue a fee grid and undo; collect at the counter and reverse; generate a salary cycle and download the bank file; issue and verify a certificate; build and publish a timetable (with the solver container); manage routes, start a simulated run |
| Driver | Start a run, send fixes (simulated geolocation), mark boarding by scan, end the run; raise SOS |
| Smartboard | Kiosk sign-in; announcements display |
| Public | Verify a certificate QR and a receipt QR |

## 8. Load and limits

The target is the cost model's 10,000-user school ([02](02-cost-study.md)). Tests run from India against a staging school seeded at that size:

| Scenario | Target |
| --- | --- |
| Morning peak: attendance marking by 300 teachers in 15 minutes, while 50 buses send fixes every 5 s and 3,000 parents watch | p95 route latency under 300 ms; no errors; autoscaling stays under 2 CU (spikes S4, S5) |
| Fee deadline: 1,000 online payments in an hour, plus webhooks | No double receipts; every payment settled once |
| Results day: 5,000 students open report cards in 10 minutes | p95 under 300 ms |
| Sign-in storm: 2,000 sign-ins in 5 minutes (scrypt cost) | Within the Worker CPU limit per request; rate limits do not block real users |
| A quiet night | The compute suspends after the night window and stays asleep until morning (spike S7) |
| Import: a 10,000-user school's dump | Restores within the cutover window budget (§5 of [90](90-data-migration-and-cutover.md)) |

If the bus-peak scenario slows the hub, that is the trigger to give busy runs a hub of their own ([36](36-transport.md) §9). If it slows the database, raise the school's autoscaling range before changing code.

## 9. Release gates

| Gate | Must pass |
| --- | --- |
| Every commit | Unit, database, row-level security matrix, Worker, tenant isolation, Data API parity (while phase 1 is live), typecheck, lint |
| Merge to main | All of the above plus end-to-end on a preview deployment |
| Release | Migration dry run on a branch of every live school |
| Milestone ([92](92-build-order.md)) | Load scenarios for the sections in the milestone; a rehearsal import of live data verifies cleanly |
| Cutover | Three clean rehearsals; every section's §11 checklist signed off; the decisions list in [90](90-data-migration-and-cutover.md) §10 closed |

## 10. Open questions

- [ ] Parity fixtures contain real names and data from live. Keep them anonymised (a scrubbing step after recording) so they can sit in the repository?
- [ ] Run end-to-end tests against Razorpay test mode in CI, or against a stub?
- [ ] One seeded test school project for every branch, or one per developer?
