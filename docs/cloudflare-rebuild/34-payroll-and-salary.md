# Payroll and Salary

As of 5 Nov 2026. Part of the [rebuild docs](README.md). The design is a Neon Postgres project per school with Cloudflare for everything else ([01](01-architecture-options.md), [10](10-target-architecture.md)). Design detail: `docs/payroll-upgrade-plan.md` (rounds A and B shipped) and `docs/payroll-multi-location-plan.md` (round C1 shipped; C2–C4 planned). Bank payouts are in [35-bank-collections-and-payouts.md](35-bank-collections-and-payouts.md).

## 1. Summary

Two payroll systems live side by side, and the rebuild has to choose how to carry them:

| | Salary cycles (in use) | Payroll engine v2/v3 (built, not yet run on live) |
| --- | --- | --- |
| Tables | `salary_cycles`, `salary_records`, `salary_record_items`, `staff_salary_base`, `support_staff_salary_base`, bank accounts; driver equivalents (`driver_payroll_*`) | 29 `payroll_*` tables: components, structures, employee structures, policy groups, calendars, rule sets (EPF, ESI, PT, LWF, TDS by state, versioned), runs with a 9-state workflow, lines with inputs and trace, exceptions, arrears, loans, advances, F&F, tax declarations, legal entities, work locations |
| Live data | 2 cycles, 225 records, 356 items, 95 staff bases, 28 support-staff bases, 9 driver bases | 30 components, 25 rule sets, 1 entity, 1 location, 104 location members; 0 runs |
| Screens | `/more/salary/manage/[cycleId]` (1,578 lines), `/more/salary`, downloads, driver salary | `/more/payroll` (runs, structures, policies, compliance, money, locations, simulate), `/payroll/me` (self-service) |
| Payout | Wired (manual, bank file, bank API) | No payout route yet (C4 planned) |

Both depend on attendance (working days, leave, late, half days), task bonus points, statutory rules (EPF/ESI/PT), and bank accounts.

What changes: all calculation already lives in pure TypeScript (`src/lib/payroll/engine/*`, `src/lib/salary*.ts`, `statutory.ts`) and moves unchanged. The database guards that make a locked run immutable and rule sets frozen once published move with the dump unchanged. A run's calculation over hundreds of employees runs as a batched job through the `jobs` queue instead of in the browser.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/more/salary` | Staff | Own salary view and statements |
| `/more/salary/manage`, `/more/salary/manage/[cycleId]` | Admin | Cycle roster: base, overrides (working days, leave, late, half days, PF, ESI), items, cash/bank, autosave, verification, statements, EPF documents, download centre, hidden members |
| `/more/salary/downloads` | Admin | Payslips and bank files |
| `/driver/salary` | Drivers | Own driver salary |
| `/more/payroll` + `runs/[runId]`, `structures`, `policies`, `compliance`, `money`, `locations`, `simulate` | Admin, payroll role | v2 engine: runs with workflow rail, exceptions board, "Why?" panel, statutory returns; components and structures; policy groups and calendars; rule sets per state; loans and advances; work locations; scenarios |
| `/payroll/me` | Staff | Self-service: payslips, declarations (stub) |
| Bus → Payroll (`/more/bus/payroll/*`) | Admin | Driver payroll cycles and bank details (see [36](36-transport.md)) |

Code: `src/lib/salary.ts`, `salaryEdits.ts`, `salaryStats.ts`, `driverSalary.ts`, `statutory.ts`, `src/lib/payroll/*` (admin, hydrate, locations, money, returns, rows, runs, serverGuard) and `engine/*` (arrears, attendance, calcLine, calendar, expr, ff, money, recoveries, resolveLocation, resolvePolicy, statutory, structure, tds, variance, workflow), components under `src/components/salary` and `src/components/payroll`.

## 3. How it works today

### Salary cycles

1. `generate_salary_cycle(month, year)` creates a cycle and one record per staff and support-staff member from their active base, snapshotting name, role, working days, leave, late, half days and bonus points.
2. Admins adjust overrides and add items (allowances, deductions) on the roster; edits autosave and can require verification (`useVerifiedEdits`).
3. EPF and ESI are computed per `statutory.ts` from `pf_basic`, applicability flags and overrides; documents (ECR, ESIC) are generated.
4. The cycle moves `open` → `processing` → `completed`; records `draft` → `approved` → `paid`; payout via `payoutProvider` (manual, bank file, bank API) with `payout_status` and reference.
5. `salary_hidden_members` (setting) hides people from the roster.

### Payroll engine v2/v3

1. Components (earnings, deductions, employer contributions) with calc types (fixed, percent of, formula, slabs), rounding and statutory flags; structures group them; employees get effective-dated structures with an anchor amount; revisions create arrears.
2. Policy groups (LOP rules, half-day handling) and working calendars resolve per employee.
3. Rule sets per domain and jurisdiction are versioned and frozen when published (`payroll_rule_sets_freeze_published`); a run pins the rule-set ids it used.
4. A run is created for a period (optionally scoped to locations), calculated (`/api/payroll/runs/[runId]/calculate`: `hydrate.ts` loads inputs, the engine computes lines with full `inputs` and `trace`), checked (exceptions, variance acknowledgement), approved, locked (hash), paid, reconciled (`/transition`). `payroll_reject_locked_write` and `payroll_runs_guard_status` enforce immutability and legal transitions; `payroll_events_append_only` keeps the event log.
5. Loans, advances and repayments (`payroll_repayments_guard`), F&F settlements, tax declarations, scenarios (`/api/payroll/simulate`).

## 4. Data

37 tables in [reference/live-schema.md §34](reference/live-schema.md#34--payroll-and-salary), plus the driver tables in §36. Views: `payroll_advance_balances`, `payroll_leave_available`, `payroll_loan_balances`.

## 5. Logic in the database

Under Neon every function, trigger and policy below moves unchanged with the database ([13](13-data-layer.md)), and the policies keep deciding who sees what. The right-hand column notes the exceptions: jobs `pg_cron` called, which the hub's timer now calls, and anything that used `pg_net`, Supabase Auth or Storage.

| Function or trigger | Under Neon |
| --- | --- |
| `generate_salary_cycle`, `generate_driver_payroll_cycle` | Unchanged |
| `salary_cycle_tallies`, `driver_cycle_tallies` | Unchanged |
| `salary_record_belongs_to_me`, `driver_payroll_record_belongs_to_me`, `payroll_belongs_to_me`, `payroll_line_is_mine_and_final` | Unchanged |
| `payroll_lock_run`, `payroll_verify_lock`, `payroll_run_is_locked` | Unchanged |
| `payroll_reject_locked_write`, `payroll_allow_payout_update` (triggers) | Unchanged |
| `payroll_runs_guard_status` (trigger) | Unchanged |
| `payroll_events_append_only` (trigger) | Unchanged |
| `payroll_rule_sets_freeze_published` (trigger) | Unchanged |
| `payroll_repayments_guard` (trigger) | Unchanged |
| `payroll_resolve_rule_set` | Unchanged |
| Exclusion constraints on `payroll_employee_structures`, `payroll_location_members`, `payroll_rule_sets` (no overlapping effective ranges) | Unchanged |

## 6. Server routes and integrations

| Route | Target |
| --- | --- |
| `/api/payroll/runs` | `payroll.runs.create` / `list` |
| `/api/payroll/runs/[runId]/calculate` | `payroll.runs.calculate` (job for large runs) |
| `/api/payroll/runs/[runId]/transition` | `payroll.runs.transition` |
| `/api/payroll/simulate` | `payroll.simulate` |
| `/api/salary/payout/initiate`, `/api/salary/payout/webhook` | `payroll.payout.*` and `/hooks/<schoolId>/bank-payout` ([35](35-bank-collections-and-payouts.md)) |
| `/api/bus/payroll/payout/initiate`, `/api/bus/payroll/payout/webhook` | Same, for drivers |

## 7. Jobs, files and live updates

- **Jobs:** cycle generation and run calculation in batches; none scheduled.
- **Files:** bank payout files and statutory files (ECR, ESIC) generated on demand; optionally stored under `payroll/<runId>/` for audit.
- **Live updates:** none.

## 8. Single-tenant assumptions

| Assumption | Where | Fix |
| --- | --- | --- |
| Default jurisdiction `IN-TN` (was hard-coded; C1 introduced locations) | `hydrate.ts` | Every school sets its legal entity and default work location at onboarding |
| Statutory registration numbers in one `site_settings` row | `statutory.ts` | Per work location (C1 already models this) |
| Seeded state rule sets are drafts until someone publishes them | Compliance screen | Platform-maintained rule-set library: EduBerry publishes state PT/LWF/EPF/ESI rule sets once, schools adopt them |

## 9. Target design

Under Neon ([01](01-architecture-options.md)) this section's tables, functions and policies move as they are; nothing below is needed for the move itself. What follows is the phase 2 design ([16](16-frontend-and-api.md)): the endpoints the screens call, each running one SQL function as the signed-in user, and schema improvements worth making along the way as ordinary migrations. An endpoint written `section.action` is `POST /api/section/action`. Permission names label today's rules, which stay in the policies and functions; the fee module's grants remain the only named permission system.

### Decision needed: one payroll or two

| Option | Effect |
| --- | --- |
| A. Carry both as today | Least risk for the live school; two code paths to maintain |
| B. Move every school to the v2 engine at cutover, import salary cycles as historical runs | One system; requires mapping each cycle record to a locked run with lines (base + items → components) and running v2 for at least one month in parallel first |
| C. Carry both, retire cycles after the first v2 month at each school | Recommended: launch with both, switch each school to v2 when it has run one month cleanly, keep cycles read-only for history |

### Tables

All carried over unchanged ([13](13-data-layer.md)). Driver payroll tables stay with transport or merge into the same salary module with a `person_kind` (staff, support staff, driver); merging is simpler to maintain.

### Endpoints (phase 2, grouped)

| Group | Endpoints | Permission |
| --- | --- | --- |
| Self-service | `salary.mine`, `payroll.me.payslips`, `payroll.me.declaration.*` | the employee |
| Cycles | `salary.cycles.*`, `salary.records.update`, `salary.items.*`, `salary.statements`, `salary.epfDocuments` | `payroll.manage` |
| Engine setup | `payroll.components.*`, `structures.*`, `employeeStructures.*`, `policies.*`, `calendars.*`, `ruleSets.*`, `entities.*`, `locations.*` | `payroll.configure` |
| Runs | `payroll.runs.create`, `calculate`, `exceptions.*`, `acknowledgeVariance`, `transition`, `lock`, `verify`, `why(lineId)` | `payroll.run`; approve and lock may need a second person (maker-checker) |
| Money | `payroll.loans.*`, `advances.*`, `repayments.*`, `ff.*`, `arrears.*` | `payroll.manage` |
| Payout | `payroll.payout.*` | `payroll.pay` |
| Simulation | `payroll.simulate` | `payroll.configure` |

Calculating a run for 700 employees with full traces is CPU work for the Worker: split into batches of ~50 employees, one `jobs` message each, so no step exceeds a few seconds, with progress on the run screen.

## 10. Moving existing data

Moves with the dump ([13](13-data-layer.md)). Verify each cycle's totals and each record's net pay recompute to the same amount. If option B is chosen, a separate, reviewed mapping step converts cycles to runs.

## 11. Parity checklist

- [ ] Port and pass every payroll test (`engine.test.ts`, `expr.test.ts`, `location.test.ts`, `payroll.test.ts`, `salaryEdits.test.ts`, `salaryStats.test.ts`, `payoutClaim.test.ts`, `returns.test.ts`).
- [ ] A cycle generated for the same month gives identical records, snapshots and EPF/ESI.
- [ ] A locked run cannot change (except payout fields); its hash verifies.
- [ ] Published rule sets cannot change; runs keep their pinned rule sets.
- [ ] Payslips, statements, ECR and ESIC files are byte-identical for the same inputs.

## 12. Open questions

- [ ] Option A, B or C for the two payroll systems?
- [ ] Should EduBerry maintain the statutory rule-set library centrally for all schools?
- [ ] Maker-checker (two people) for approving and paying runs?
