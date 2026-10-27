# Test and Parity Plan

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). How to prove that each section of the rebuilt app does what today's app does, for every school, before and after the move. Each section doc's §11 lists that section's checks; this doc says how they are run.

## 1. Where testing starts from

| Today | Count |
| --- | --- |
| TypeScript test files (Vitest) | 40 |
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

The pure TypeScript engines, which move unchanged, are reasonably covered. The 696 row-level security policies and 268 SQL functions, which are rewritten, have no tests at all. That is where the rebuild's risk is, so most of this plan is about them.

## 2. Test layers in the new repository

| Layer | Tool | What it proves | Runs |
| --- | --- | --- | --- |
| Unit | Vitest (Node) | Pure logic: fee engine, payroll engine, timetable generator, geofence, ETA, grading, date and money helpers. The 40 existing files are ported first and must pass unchanged | Every commit |
| Module | Vitest with `@cloudflare/vitest-pool-workers` (runs in `workerd` with real Durable Objects and SQLite) | Each module method against a real school object: transactions, triggers turned into code, permission checks, migrations | Every commit |
| Permission matrix | Generated module tests | Every method × every role × own or other record: allowed or refused as the table in each section doc says | Every commit |
| Tenant isolation | Module tests with two schools | No method, hook, file key, socket topic or job can read or change another school's data (§5) | Every commit |
| Golden parity | Fixtures recorded from Supabase (§4) | The new code gives the same results as today's SQL functions for the same inputs | Every commit (fixtures stored in the repo) |
| Import verification | `tools/import-supabase verify` | An imported school matches its source: counts, totals, checksums, recomputations (§6) | Each rehearsal and the cutover |
| End-to-end | Playwright (Chromium is available in CI) against a seeded school on a preview deployment | Core journeys per role through the real UI (§7) | Every merge to main, and nightly |
| Load | k6 or a Worker-based load script against a staging school | Peak-hour behaviour of one school object at 10,000 users (§8) | Before each milestone and before onboarding a large school |

## 3. Port the existing tests first

Step 1 of the build ([92](92-build-order.md)) is a repository where the 40 TypeScript test files and the solver test pass. Rules:

- Keep the test bodies unchanged. Change only imports, and the data-access stubs where a test mocks Supabase.
- A test that relied on Supabase behaviour (for example `payoutClaim.test.ts` mocking a conditional update) becomes a module test against a real school object.
- Money assertions move from rupees to paise only where the engine's interface changes. Keep rupee helpers for display tests.

## 4. Golden parity: recording today's answers

For each SQL function, trigger chain or report that is rewritten, record what today's system returns for a fixed set of inputs, and replay those inputs into the new code.

1. **Seed:** a Supabase branch restored from live, plus synthetic additions where live data does not exercise a rule. For example: fee concessions over the approval threshold, partial payments, a reversed payment, a payroll run with arrears, a transport run with a skipped stop.
2. **Record:** a script calls each function and report on the branch with recorded inputs and saves `{function, inputs, output}` as JSON fixtures. For trigger chains, the script performs the write and records the resulting rows of every affected table.
3. **Replay:** a module test imports the same seed into a school object, runs the new method with the same inputs, and compares. Ids and timestamps are normalised; money is compared exactly in paise.
4. **Freeze:** fixtures are committed. When a section intentionally changes behaviour (each section doc marks these as "a fix, not parity"), the fixture is updated in a commit that says so.

Priority, by risk and by how much SQL is rewritten:

| Priority | Section | What to record |
| --- | --- | --- |
| 1 | Fees ([33](33-fees.md)) | Grid issue, charges, concessions, late fees, collection and allocation, reversal, refunds, credits, carry-forward, bill register, every report and view, receipt payload and hash |
| 1 | Attendance ([23](23-attendance.md)) | Student marking, staff punch with geofence verdicts and exceptions, recompute, daily and monthly reports, present percentage |
| 1 | Transport ([36](36-transport.md)) | `transport_simulate_day` plus recorded real runs: every fix through `transport_process_fix`, stop events, ETAs, delays, alerts; tick outcomes; boarding; metrics rollup and the five reports |
| 2 | Payroll and salary ([34](34-payroll-and-salary.md)) | Cycle generation, tallies, lock hash, run transitions |
| 2 | Grades ([30](30-grades-and-report-cards.md)) | Component recompute, class-wise marks, trend |
| 2 | Leave ([24](24-leave.md)) | Approval chain roll-up, balance effects |
| 2 | Classrooms ([28](28-classrooms-and-coursework.md)) | Edu points, leaderboards, month summary |
| 3 | Tasks ([26](26-tasks-and-projects.md)) | Calendar data, stats, unread counts |
| 3 | Announcements ([25](25-announcements-and-notifications.md)) | Feed for each role, audience resolution |
| 3 | Others | Timetable save, certificates verify, exams grading |

## 5. Tenant isolation tests

These must never fail. A failure blocks a release.

- Two seeded schools, A and B, with overlapping names, ids generated independently, and the same certificate and receipt number formats.
- For every method: a user of A calling with an id from B gets "not found" (never "forbidden", which would confirm the id exists).
- Every route that resolves a school from the host or path:
  - B's host never serves A's data;
  - `/hooks/<A>/...` with B's secret is rejected;
  - `/api/public/certificates/<no>` on B's host never finds A's certificate.
- R2 keys: a signed file URL for A cannot be altered to read B's key; the files route checks the key prefix against the session's school.
- WebSockets: a socket on A's object cannot subscribe to any topic of B. Topics are per object, so this is structural, but it is still tested.
- Jobs and queues: every message carries a school id. A consumer given a message for A never touches B (tested with a mixed batch).
- Platform staff: access to a school's data needs a support grant; the grant is audited and expires.

## 6. Import verification (each rehearsal and the cutover)

| Check | Rule |
| --- | --- |
| Row counts | Equal per table, after documented exclusions (dropped tables, split tasks, skipped alerts) |
| Money | Per student and per academic year: billed, paid, concession, refund, balance equal to the paisa. Per salary record: net pay equal |
| Recompute | Invoices from lines and allocations; ledger running balances; assessment totals from components; leave status from approvals; cycle tallies. Any difference is listed, and money differences stop the import |
| Checksums | Per table, a hash of sorted ids and key columns, computed on both sides |
| References | Every foreign key resolves. Every R2 key referenced by a row exists. Every certificate, receipt and pay-link token resolves on the school's host |
| Accounts | Every profile has an account and vice versa (except documented exceptions). A sample of bcrypt hashes verifies with known test passwords on a rehearsal copy that includes seeded test accounts |
| Settings | Every migrated setting validates against its schema |

## 7. End-to-end journeys (Playwright)

One seeded school with every role. Each journey runs on phone and desktop viewports.

| Role | Journeys |
| --- | --- |
| Student | Sign in; home cards; timetable; classroom, open coursework, submit homework with a file; take an exam; see a published report card; pay a fee online (Razorpay test mode) and get a receipt; see the bus live (simulated run) |
| Parent | Pay link from WhatsApp opens without sign-in and pays; child's bus view |
| Teacher | Mark attendance; staff punch inside and outside the geofence; create an assessment with components and enter marks; create a task from the timetable; apply for leave |
| Class teacher | Publish report cards; class-wise marks |
| Approver (coordinator, principal) | Approve leave in the chain; see notifications |
| Admin | Create users and import from CSV; issue a fee grid and undo; collect at the counter and reverse; generate a salary cycle and download the bank file; issue and verify a certificate; build and publish a timetable (with the solver container); manage routes, start a simulated run |
| Driver | Start a run, send fixes (simulated geolocation), mark boarding by scan, end the run; raise SOS |
| Smartboard | Kiosk sign-in; announcements display |
| Public | Verify a certificate QR and a receipt QR |

## 8. Load and limits

The target is the cost model's 10,000-user school ([02](02-cost-study.md)). Tests run against a staging school seeded at that size:

| Scenario | Target |
| --- | --- |
| Morning peak: attendance marking by 300 teachers in 15 minutes, while 50 buses send fixes every 5 s and 3,000 parents watch | p95 method latency under 200 ms; no errors; school object CPU under 50% |
| Fee deadline: 1,000 online payments in an hour, plus webhooks | No double receipts; every payment settled once |
| Results day: 5,000 students open report cards in 10 minutes | p95 under 300 ms |
| Sign-in storm: 2,000 sign-ins in 5 minutes (scrypt cost) | Within the Worker CPU limit per request; rate limits do not block real users |
| Import: a 10,000-user school's export | Finishes within the cutover window budget (§5 of [90](90-data-migration-and-cutover.md)) |

If the bus-peak scenario breaks the latency target, that is the trigger to move live runs into per-run objects ([36](36-transport.md) §9).

## 9. Release gates

| Gate | Must pass |
| --- | --- |
| Every commit | Unit, module, permission matrix, tenant isolation, golden parity, typecheck, lint |
| Merge to main | All of the above plus end-to-end on a preview deployment |
| Milestone ([92](92-build-order.md)) | Load scenarios for the sections in the milestone; a rehearsal import of live data verifies cleanly |
| Cutover | Three clean rehearsals; every section's §11 checklist signed off; the decisions list in [90](90-data-migration-and-cutover.md) §10 closed |

## 10. Open questions

- [ ] Golden fixtures contain real names and data from live. Keep them anonymised (a scrubbing step after recording) so they can sit in the repository?
- [ ] Run end-to-end tests against Razorpay test mode in CI, or against a stub?
