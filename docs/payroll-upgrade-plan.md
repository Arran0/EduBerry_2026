# School Payroll Engine — Round-by-Round Upgrade Plan

A staged plan to grow the current Salary Manager into a payroll system built for
schools, aimed squarely at what MyClassBoard / Entab / Fedena payroll modules do
badly: opaque numbers, mutable history, one-size-fits-all leave rules, and no
answer to "why did this change?". Each round is independently shippable, builds
on the last, and ends with a paste-ready prompt.

> **Continued in `docs/payroll-multi-location-plan.md` (Round C)** — work
> locations and multi-state statutories, the taxes-and-forms module (TDS
> liabilities, challans, Form 24Q, Form 16), loan management with perquisite,
> and bulk disbursal from the v2 runs, with a competitive analysis of Zoho
> Payroll on each.

---

## Where we start (current state)

**Schema** (`supabase-migrations/`): `add_salary_manager.sql`,
`add_payroll_calibration.sql`, `add_payroll_record_overrides.sql`,
`add_epf_esi_statutory.sql`, plus a full parallel copy for transport in
`add_driver_payroll_cycles.sql`.

- `staff_salary_base` — one `base_amount` per person, plus `pf_basic`,
  `pf_applicable`, `esi_override`, `uan`, `esi_ip_number`, `eps_applicable`.
- `salary_cycles` — one row per month, `status` is `open` | `closed`, optional
  `payroll_config` JSONB override.
- `salary_records` — one per person per cycle, snapshots `base_amount`, carries
  five `*_override` columns (working days, leave, late, PF, ESI).
- `salary_record_items` — flat `(label, amount)` bag; positive = earning,
  negative = deduction.
- `driver_payroll_base` / `_cycles` / `_records` / `_record_items` — the same
  four tables again, for `role = 'driver'`.

**Engine**: `src/lib/payroll.ts` — `PayrollCalibration` (PF rate, ESI rate +
ceiling, tiered LOP for late/leave, task-bonus mode), `calcLopDays`,
`computeStaffAttendanceStats`, `computePayrollRow`. Calibration is one global
JSONB in `site_settings.payroll_calibration`, optionally overridden per cycle.

**Statutory**: `src/lib/statutory.ts` — genuinely good. Builds EPFO ECR rows
(11 fields, `#~#`) and ESIC Monthly Contribution rows, with establishment
config, name normalisation, filability checks and totals.

**UI**: `src/app/more/salary/page.tsx` (admin hub: Pay Cycles / Base Salaries /
Bank Accounts, plus the staff self-view), `manage/[cycleId]/page.tsx` (the
786-line 13-column cycle sheet), `manage/settings/page.tsx`,
`src/components/salary/**` (statements, EPF documents, calibration fields).

**Payouts**: `src/lib/payoutProvider.ts` + `src/app/api/salary/payout/*` —
provider disbursement and webhook reconciliation. Works; stays.

### What is actually wrong

1. **No salary structure.** One `base_amount` and a bag of labelled amounts.
   No Basic/HRA/DA, no percentage or formula components, no effective dates, no
   revision history, no bulk increments.
2. **The engine runs in the browser.** `computePayrollRow` is called inside a
   `useMemo` in `manage/[cycleId]/page.tsx`; "locking" a cycle means the client
   writes derived PF/ESI/LOP/bonus back as `salary_record_items` rows.
3. **History is not immutable.** Change someone's `pf_basic` today and reopening
   any past cycle recomputes it differently. `reopenCycle` deletes and rewrites
   the auto items outright.
4. **Rules are global.** Calibration is site-wide or per-cycle. There is no way
   to give the primary-section teachers a different LOP policy from the
   secondary section, or transport staff a different working calendar.
5. **Two-state workflow.** `open` / `closed`. No review gate, no exception list,
   no variance check, no approval record, no reconcile step.
6. **Compliance is hardcoded and unversioned.** PF and ESI only. Rates live in a
   flat config; a rate change silently rewrites what past cycles claim.
7. **Whole feature areas missing.** Arrears, advances, loans, EMI, TDS,
   Professional Tax, LWF, gratuity, statutory bonus, full & final settlement,
   variance analysis, simulation.
8. **Transport payroll is a copy-paste fork.** Every feature below would have to
   be built twice.
9. **No tests anywhere in the repo.** Payroll is the one module where that is
   not survivable.

### What is worth keeping

- `src/lib/statutory.ts` — the ECR / ESIC builders, near-intact.
- The **policy-group pattern** from attendance: `attendance_day_timings` and
  `attendance_holidays` already do `is_default` + a members table +
  priority-ordered resolution (`resolveLateCutoff`, `attendance.ts:2613`;
  `fetchEffectiveCutoffsForStaff`, `attendance.ts:1931`). This plan generalises
  exactly that shape into payroll policy groups and working calendars.
- `attendance_holidays` + `attendance_holiday_members` — already group-scoped,
  reused as-is for working calendars.
- The payout provider layer and the statements/PDF stack (`@react-pdf/renderer`).
- `deriveDayStatus` and the attendance record model.

---

## Target architecture

Three decisions settled up front; everything below assumes them.

### 1. Server-side TypeScript engine with a stored trace

`src/lib/payroll/engine/**` is **pure** — no `supabase` import, no I/O, no
`Date.now()`. It takes a fully-hydrated input object and returns numbers plus an
explain tree.

```
src/lib/payroll/engine/
  types.ts         EngineInput, EngineResult, ExplainNode
  resolvePolicy.ts which policy group / calendar / rule sets apply, and why
  structure.ts     components resolved on an effective date → ordered heads
  attendance.ts    LOP days, per-day reasons, paid days
  statutory.ts     PF, EPS, EDLI, ESI, PT, LWF, TDS from versioned rule sets
  arrears.ts       revision-driven back-pay, period by period
  recoveries.ts    advances, loan EMI, notice recovery
  calcLine.ts      the orchestrator → { components[], net, trace }
  index.ts
```

The browser imports it for live preview and simulation (no writes). A route
handler imports the **same functions** for the authoritative Calculate step:

```
POST /api/payroll/runs/[runId]/calculate
  → hydrate inputs (structures, policies, calendars, attendance, rule sets)
  → engine.calcLine() per employee
  → INSERT payroll_run_lines + payroll_line_components + trace JSONB
```

The trace is not a debug artifact. It is the product feature: every payslip
figure, every "Why?" drill-down and every statutory return reads from it.

### 2. New `payroll_*` tables alongside; `salary_*` frozen read-only

`salary_cycles` / `salary_records` / `salary_record_items` keep working and keep
opening, so nothing that has already been paid is disturbed. A one-time import
maps each old `salary_record` into a v2 run line with a synthetic single-
component structure. Old screens retire per-round, never big-bang.

### 3. One engine for every employee

`employee_category` — `teaching` | `non_teaching` | `transport` | `support` —
drives policy group, calendar and structure eligibility. `driver_payroll_*` is
imported and retired in Round 4.

---

## Five invariants

These are the things the competition gets wrong. Every round is checked against
them.

1. **Nothing derived is ever stored without its inputs.** A `payroll_run_line`
   carries `inputs` and `trace` JSONB alongside the money.
2. **A locked run is physically immutable.** A trigger raises on any UPDATE or
   DELETE to a line, component or trace once `payroll_runs.status >= 'locked'`.
   Corrections happen as a supplementary run, never as an edit.
3. **Rules are versioned and pinned per run.** The run stores the
   `payroll_rule_sets` ids it used. A February rate change cannot move January's
   numbers.
4. **Structures are effective-dated and append-only.** A revision inserts a new
   `payroll_employee_structures` row and closes the previous one. Nothing is
   overwritten. A revision effective before the last locked run produces
   **arrears**; it does not rewrite that run.
5. **Every deduction can answer "Why?"** — down to the day, the rule, the rule
   version, and the person who approved the override.

---

## Schema map

```
── People ─────────────────────────────────────────────────────────────
staff_details               + employee_category, date_of_exit, exit_reason,
                              notice_period_days, probation_end
── Structure ──────────────────────────────────────────────────────────
payroll_components          catalogue of salary heads (BASIC, HRA, DA, …)
payroll_structures          named, versioned, effective-dated template
payroll_structure_components component values inside a structure
payroll_employee_structures assignment, effective-dated, APPEND-ONLY
payroll_employee_overrides  per-person override of one head, effective-dated
payroll_revisions           the batch header for an increment / promotion
── Policy ─────────────────────────────────────────────────────────────
payroll_policy_groups       LOP + attendance + rounding rules, is_default+priority
payroll_policy_group_members
payroll_calendars           working-day basis, week-off pattern
payroll_calendar_members
attendance_holidays         (existing, already group-scoped — reused)
── Compliance ─────────────────────────────────────────────────────────
payroll_rule_sets           versioned PF/ESI/PT/LWF/TDS/gratuity/bonus rules
── Runs ───────────────────────────────────────────────────────────────
payroll_runs                9-state workflow, pins rule-set ids
payroll_run_lines           per employee: money + inputs JSONB + trace JSONB
payroll_line_components     per head, resolved — this is what a payslip prints
payroll_run_events          append-only audit of every state transition
payroll_exceptions          block / warn / info, gates approval
── Money owed ─────────────────────────────────────────────────────────
payroll_arrears
payroll_advances
payroll_loans + payroll_loan_schedule + payroll_repayments
── Exit ───────────────────────────────────────────────────────────────
payroll_ff_settlements
── Tax ────────────────────────────────────────────────────────────────
payroll_tax_declarations    per employee per financial year, regime + proofs
```

---

## Round map & dependencies

Delivered as **two rounds**, not eleven — the original 11 are folded in, and the
column below records where each one landed.

| Round | Theme | Delivered in |
|---|---|---|
| 0 | Test harness + engine extraction | **A** ✅ |
| 1 | Component catalogue, structures, effective dating, revisions | **A** ✅ |
| 2 | Policy groups + working calendars + LOP engine v2 | **A** ✅ |
| 3 | Versioned statutory rules; PF/ESI ported; PT + LWF added | **A** ✅ |
| 4 | Payroll runs: 9-state workflow, exceptions, variance gate, lock; import + unify | **A** (schema) / **B** (API + UI) ✅ |
| 5 | Explainability: trace UI, payslip v2, "Why?" everywhere | **B** ✅ |
| 6 | Arrears, advances, loans, EMI, recoveries | **A** (engine) / **B** (UI) ✅ |
| 7 | TDS engine, declarations, Form 16 / 24Q | **A** (engine) / **B** (partial UI) ⚠️ |
| 8 | Full & final: gratuity, bonus, encashment, notice recovery | **A** (engine) / **B** (partial UI) ⚠️ |
| 9 | Employee self-service portal | **B** ✅ |
| 10 | Variance analysis, simulation, school cost analytics | **B** (variance + simulation) ⚠️ |

**Round A — foundation.** Eight migrations, fifteen pure engine modules, 69 tests.
**Round B — product.** Data layer, four API routes, eight screens.

### What is not finished

Three items were engine-complete but did not get their full screen, and are
called out honestly rather than marked done:

- **Form 16 Part B and Form 24Q output** (Round 7). `engine/tds.ts` computes the
  liability, the regime comparison and the projection, and the ESS screen shows
  the year-to-date figures — but the two filing artefacts are not generated. The
  declaration form itself is stubbed behind `/payroll/me/declaration`.
- **The F&F screen** (Round 8). `engine/ff.ts` computes encashment, notice
  recovery, gratuity and the proportionate bonus, and an F&F run calculates
  correctly through the normal workflow when a `payroll_ff_settlements` row
  exists. There is no screen yet to raise that row; it has to be inserted by
  hand.
- **School cost analytics** (Round 10). Variance and simulation both shipped.
  Cost per student, per department and per campus did not — and the campus axis
  still needs a schema change that has not been made.

### Deployment order

Migrations must run in this order; each depends on the last:

```
payroll_v2_structures.sql
payroll_v2_policy.sql
payroll_v2_rules.sql
payroll_v2_seed.sql          -- catalogue + rule sets v1 + default group/calendar
payroll_v2_runs.sql
payroll_v2_money.sql
payroll_v2_tax_ff.sql
payroll_v2_import_legacy.sql -- last; check payroll_import_reconciliation after
```

`payroll_v2_seed.sql` reproduces `DEFAULT_PAYROLL_CALIBRATION` and
`DEFAULT_STATUTORY_CONFIG` exactly, so the changeover moves no numbers until
somebody deliberately configures a group or publishes a new rule version.

After the import, before retiring any legacy screen:

```sql
SELECT * FROM public.payroll_import_reconciliation WHERE NOT reconciled;
```

Zero rows means every historical cycle came across intact.

---

## Round 0 — Test harness and engine extraction

**Goal.** Make payroll changes safe to make. Ships no feature.

- Add `vitest` + `@vitest/coverage-v8`; `pnpm test`, `pnpm test:watch`.
  `src/lib/**/*.test.ts` colocated.
- Move today's math into `src/lib/payroll/engine/` unchanged, behind the same
  exported signatures, and write tests that **lock current behaviour**:
  `calcLopDays` tier exhaustion and carry-on rate, ESI `Math.ceil`, PF on
  `pf_basic`, `computeStaffAttendanceStats` holiday/weekend handling, the
  override precedence in `rowFigures`.
- Golden-file test: build ECR and ESIC rows from a fixed fixture and assert the
  serialised bytes. Every later round must keep these green or explain the diff.
- Fixture builders in `src/lib/payroll/__fixtures__/`.

**Done when** `pnpm test` covers the existing engine and the two statutory file
formats, and CI runs it.

---

## Round 1 — Components, structures, effective dating, revisions

**Goal.** A real salary structure engine. Old salary structures are never
overwritten.

**Schema** — `supabase-migrations/payroll_v2_structures.sql`:

- `payroll_components` — `code` (unique, e.g. `BASIC`, `HRA`, `DA`, `CONV`,
  `SPL`), `name`, `kind` (`earning` | `deduction` | `employer_contribution` |
  `informational`), `calc_type` (`fixed` | `percent_of` | `formula` | `slab` |
  `balance`), `percent_of` (a component code, or `GROSS` / `CTC`), `formula`,
  `sequence` (evaluation order), `rounding`, and the flags that make a head mean
  something: `is_taxable`, `counts_for_pf`, `counts_for_esi`, `counts_for_pt`,
  `lop_applicable`, `prorate_on_join_exit`, `show_on_payslip`, `is_system`.
  Seed the standard Indian school heads plus room for custom ones.
- `payroll_structures` — `name`, `code`, `employee_category`, `effective_from`,
  `effective_to`, `status` (`draft` | `active` | `archived`), `version`,
  `supersedes_id`. Editing an *active* structure forks a new version; it never
  mutates in place.
- `payroll_structure_components` — `structure_id`, `component_id`, `value_type`,
  `value`, `formula`, `sequence`.
- `payroll_employee_structures` — `employee_id`, `structure_id`,
  `effective_from`, `effective_to` (null = open), `anchor_amount` (the CTC or
  gross the percentages resolve against), `revision_id`, `reason`. **Append-only**:
  a `BEFORE UPDATE` trigger rejects any change to a row whose period has been
  used by a locked run. Non-overlap enforced with `btree_gist` and an
  `EXCLUDE USING gist (employee_id WITH =, daterange(effective_from, effective_to) WITH &&)`.
- `payroll_employee_overrides` — same effective-dated shape, one component.
- `payroll_revisions` — `label`, `kind` (`individual` | `bulk_increment` |
  `promotion`), `basis` (`percent` | `amount` | `new_structure`), `value`,
  `effective_from`, `arrears_from`, `status` (`draft` | `applied`),
  `approved_by`. Applying a revision inserts the new employee-structure rows and
  closes the old ones in one transaction.

**Engine** — `engine/structure.ts`:

`buildStructure(employee, onDate)` → ordered resolved heads. Evaluation is a
topological sort over `percent_of` and formula references with cycle detection;
a `balance` head absorbs whatever is left of the anchor after the rest resolve
(the standard "Special Allowance = CTC − everything else" pattern). Formulas run
in a tiny whitelisted expression evaluator — component codes, `+ - * / ( )`,
`min`, `max`, `round` — never `eval`.

**Data layer** — `src/lib/payroll/structures.ts`: catalogue CRUD, structure
versioning, assignment, `previewStructure()` (engine, no writes),
`applyRevision()`, `previewBulkIncrement()`.

**UI** — `/more/payroll/structures`:
- **Salary Heads** — the component catalogue, with a live "what this does to a
  ₹40,000 structure" preview beside each flag.
- **Structures** — build a template, drag to reorder, live gross/net preview,
  version history with a diff between versions.
- **Assignments** — per-employee timeline: every structure they have ever been
  on, with dates, reason, and who approved it. Read-only for past periods.
- **Revisions** — pick a cohort (role, category, department, policy group, or an
  explicit list), choose percent or amount, set effective date and arrears date,
  see a before/after table for every affected person and the total monthly and
  annual cost delta, then apply.

**Done when** a structure can be built, versioned, assigned, revised in bulk, and
the assignment timeline shows a complete unedited history.

---

## Round 2 — Policy groups, working calendars, LOP engine v2

**Goal.** Different LOP and attendance rules for different groups of teachers,
using the resolution pattern this codebase already uses for attendance cutoffs.

**Schema** — `supabase-migrations/payroll_v2_policy.sql`:

- `payroll_policy_groups` — `name`, `is_default` (unique partial index, one per
  scope), `priority` INT, `effective_from`, `effective_to`, and `policy` JSONB:
  ```
  { lop: { late: LopRule, leave: LopRule, half_day: LopRule },
    leave_treatment: { casual: 'paid', medical: 'paid', on_duty: 'paid',
                       half_day: 'half', unapproved: 'lop' },
    lop_basis: 'calendar_days' | 'working_days' | 'fixed_days',
    half_day_fraction: 0.5,
    late_grace_minutes: 10,
    round_lop_to: 0.5,
    encashment: { rate_basis: 'basic' | 'gross', max_days: 30 },
    notice_period_days: 60 }
  ```
- `payroll_policy_group_members` — `(group_id, employee_id)` unique. Plus an
  optional `match` JSONB on the group (role / category / department IN …) used
  only when the explicit member list is empty.
- `payroll_calendars` — `name`, `is_default`, `priority`,
  `working_day_basis` (`calendar_days` | `fixed_days` | `calendar_minus_holidays`
  | `actual_working_days`), `fixed_days`, `week_off_pattern` JSONB (per weekday
  `full` | `half` | `off`, plus nth-weekday rules for "2nd and 4th Saturday off"),
  `effective_from`, `effective_to`.
- `payroll_calendar_members` — same shape.
- Holidays reuse `attendance_holidays` + `attendance_holiday_members` unchanged.

**Engine** — `engine/resolvePolicy.ts`, generalising `resolveLateCutoff`:

```
resolve(kind, employeeId, onDate, pools):
  1. explicit non-default groups containing the employee, highest priority first
  2. rule-matched non-default groups, highest priority first
  3. the default group
  4. the built-in fallback
→ { value, source: { groupId, groupName, rank, why } }
```

`source` is not optional. It is what the Why? panel prints, and it is what makes
a disputed deduction settle in ten seconds instead of an afternoon.

**Engine** — `engine/attendance.ts`:

`calcAttendance()` walks the period day by day and emits a `DayVerdict[]`:
`{ date, calendarStatus, attendanceStatus, leaveType, leaveApplicationId,
correctionId, paidFraction, lopFraction, rule, ruleSource }`. Half-days, paid vs
unpaid leave, on-duty, approved corrections, holidays and week-offs all resolve
here and nowhere else. `lopDays` is the sum of `lopFraction`; the day list *is*
the explanation.

**Attendance corrections** — `payroll_attendance_corrections`: `employee_id`,
`date`, `from_status`, `to_status`, `reason`, `requested_by`, `approved_by`,
`applied_to_run_id`. A correction after a run is locked cannot alter it — it
lands as an arrear or adjustment in the next run, and says so.

**UI** — `/more/payroll/policies`:
- Group list with priority ordering (drag to reorder) and an "everyone" default.
- **Coverage check**: for each employee, which group wins and why; flag anyone
  matched by two groups at the same priority.
- Calendar editor with a month grid preview showing exactly which days are
  paid, half, off or holiday for the selected group.

**Done when** two teacher cohorts on different LOP policies and different working
calendars both compute correctly in a preview, and the coverage check explains
every assignment.

---

## Round 3 — Versioned statutory rules

**Goal.** Compliance as data, not code. Regulations change; history does not.

**Schema** — `supabase-migrations/payroll_v2_rules.sql`:

- `payroll_rule_sets` — `domain` (`pf` | `esi` | `pt` | `lwf` | `tds` |
  `gratuity` | `bonus`), `jurisdiction` (`IN`, `IN-TN`, …), `effective_from`,
  `effective_to`, `version`, `rules` JSONB, `source_note` (the notification or
  circular this came from), `published_by`, `published_at`, `is_active`.
- Exactly one active rule set per `(domain, jurisdiction)` per date — partial
  unique index plus a range-overlap exclusion.

**Seed** — `supabase-migrations/payroll_v2_seed_rules_2026.sql`, migrating
today's `statutory_config` and `payroll_calibration` values in as version 1 so
nothing changes on the day it ships:

- **PF** — employee 12%, EPS 8.33% capped at ₹15,000, EDLI 0.5%, admin 0.5% with
  a ₹500 monthly minimum, `cap_epf_wages` flag, plus the international-worker and
  ₹15,000-at-joining exemption flags.
- **ESI** — 0.75% / 3.25%, ₹21,000 ceiling, and the **contribution-period
  continuity rule** (Apr–Sep, Oct–Mar): once enrolled, a member stays enrolled to
  the end of the period even after crossing the ceiling. Today this is a manual
  `esi_override` boolean; the rules engine derives it and only asks for an
  override where the law is genuinely ambiguous.
- **Professional Tax** — half-yearly slabs, per state. Tamil Nadu first.
- **LWF** — annual, per state, with the deduction month.
- **Gratuity** — 15/26 × last drawn × completed years, 5-year eligibility with
  the 4-years-240-days reading, ₹20,00,000 cap.
- **Statutory Bonus** — 8.33% floor to 20% ceiling, ₹21,000 eligibility, ₹7,000
  or minimum-wage calculation ceiling.
- **TDS** — both regimes' slabs, standard deduction, 87A rebate, cess,
  surcharge bands. Consumed in Round 7.

**Engine** — `engine/statutory.ts`: one function per domain, each taking
`(wages, ruleSet, employeeFlags)` and returning `{ amount, trace }`. No rate
appears anywhere else in the codebase. `src/lib/statutory.ts` keeps the ECR and
ESIC builders but reads its rates from the pinned rule set instead of
`statutory_config`.

**UI** — `/more/payroll/compliance`:
- Rule sets by domain with their effective ranges on a timeline.
- Editing an active set **forks a new version with a future effective date**; it
  cannot be edited in place.
- A "what changes" preview: apply the draft set to last month's run and show the
  per-employee and total delta before publishing.

**Done when** PF and ESI produce byte-identical ECR/ESIC files to Round 0's
golden fixtures while sourcing every rate from a pinned rule set, and PT + LWF
compute for Tamil Nadu.

---

## Round 4 — Payroll runs: the 9-state workflow

**Goal.** The workflow, the exceptions gate, and immutability. This is the round
that replaces the current cycle page.

**Schema** — `supabase-migrations/payroll_v2_runs.sql`:

- `payroll_runs` — `period_month`, `period_year`, `pay_date`, `run_type`
  (`regular` | `supplementary` | `arrears` | `bonus` | `ff`), `status`, plus
  `rule_set_ids` JSONB, `calculated_at`, `approved_by`, `approved_at`,
  `locked_at`, `locked_by`, `locked_hash`.

  ```
  draft → review → calculated → exceptions → pending_approval
        → approved → locked → paid → reconciled
  ```

  Transitions are a state machine in `engine/workflow.ts` with an explicit
  allowed-transition table; the API rejects anything else. `reconciled` closes
  the loop with the existing payout webhook.

- `payroll_run_lines` — `run_id`, `employee_id`, plus snapshots:
  `structure_id`, `policy_group_id`, `calendar_id`, `gross`, `total_earnings`,
  `total_deductions`, `employer_cost`, `net_pay`, `paid_days`, `lop_days`,
  `inputs` JSONB, `trace` JSONB.
- `payroll_line_components` — `line_id`, `component_code`, `name`, `kind`,
  `amount`, `computed_from` JSONB. What a payslip prints.
- `payroll_run_events` — append-only: `from_status`, `to_status`, `actor`, `at`,
  `note`. Insert-only RLS; no UPDATE or DELETE policy at all.
- `payroll_exceptions` — `severity` (`block` | `warn` | `info`), `code`,
  `message`, `details` JSONB, `resolved_at`, `resolved_by`, `resolution_note`.

  Codes: `NO_STRUCTURE`, `MISSING_BANK`, `INVALID_IFSC`, `DUPLICATE_ACCOUNT`,
  `MISSING_PAN`, `MISSING_UAN`, `MISSING_IP_NUMBER`, `NEGATIVE_NET`, `ZERO_NET`,
  `LOP_EXCEEDS_PERIOD`, `VARIANCE_ABOVE_THRESHOLD`, `NEW_JOINER`,
  `EXIT_WITHOUT_FF`, `ATTENDANCE_INCOMPLETE`, `UNAPPROVED_CORRECTION`,
  `STRUCTURE_EXPIRED`, `RULE_SET_STALE`.

**Immutability triggers** — the heart of the round:

```sql
CREATE FUNCTION payroll_reject_locked_write() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM payroll_runs r
             WHERE r.id = COALESCE(NEW.run_id, OLD.run_id)
               AND r.status IN ('locked','paid','reconciled'))
  THEN RAISE EXCEPTION 'Run is locked — post a supplementary run instead';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

Attached BEFORE UPDATE OR DELETE on `payroll_run_lines` and
`payroll_line_components`. `locked_hash` is a SHA-256 over the sorted line
totals, stored at lock time, so tampering is detectable even by someone with
direct database access.

**API** — `src/app/api/payroll/runs/`:
`POST /` (create), `POST /[id]/calculate`, `POST /[id]/validate`,
`POST /[id]/transition`, `POST /[id]/lock`, `POST /[id]/payout` (delegates to
the existing provider layer), `GET /[id]/variance`.

**Import & unify** — `supabase-migrations/payroll_v2_import_legacy.sql`:
each `salary_record` and `driver_payroll_record` becomes a `payroll_run_line`
in a `locked` run, with a synthetic single-component structure and the original
items as components. `staff_details.employee_category` is backfilled from
`profiles.role` and `is_non_teaching`. The old screens go read-only behind an
"Archive" tab; the tables are not dropped.

**UI** — `/more/payroll/runs/[runId]`, replacing the current cycle sheet:
- A workflow rail across the top showing the nine states, which are done, who
  did each, and when.
- **Exceptions board** — grouped by code, with a one-click fix path per code
  (open the bank form, open the structure assignment, open the attendance day).
  Approval is physically blocked while any `block` exception is unresolved.
- **Pre-approval summary**, shown before the approve button and required to be
  scrolled past: total payroll, month-on-month variance in ₹ and %, the
  employees whose net moved more than the threshold with the reason attributed,
  missing bank / PAN / UAN / IP counts, new joiners, exits, and the headcount
  delta.
- The register itself, virtualised, with the 13-column sheet's density but every
  cell drillable.

**Done when** a run walks all nine states, a locked run physically rejects an
UPDATE, and the legacy import reproduces every historical cycle.

---

## Round 5 — Explainability

**Goal.** Every figure in the system opens into the reasoning that produced it.
This is the single clearest differentiator against every competitor named.

**Trace shape** — `ExplainNode`:

```ts
{ label: string
  value: number
  unit: 'INR' | 'days' | 'percent'
  formula?: string          // "PF Basic × 12%"
  inputs?: Record<string, number | string>
  rule?: { domain, ruleSetId, version, effectiveFrom }
  policy?: { groupId, groupName, rank, why }
  children?: ExplainNode[]
  note?: string }
```

Produced by the engine, stored on the line, never recomputed for display.

**UI** — `src/components/payroll/WhyPanel.tsx`. Any amount anywhere is wrapped
in `<Explain nodeId>`; clicking opens a right-hand panel with the tree expanded
one level, the formula in plain words, and a link to the source record. LOP
opens the **day grid**: every day of the period, its calendar status, its
attendance status, the leave application if any, the fraction paid, and the rule
that decided it — with the policy group named.

**Payslip v2** — built from `payroll_line_components`, not recomputed. Earnings,
deductions, employer contributions, YTD columns, LOP summary, and a QR code
linking to the ESS view of that same payslip. Renders from the existing
`@react-pdf/renderer` stack.

**Done when** a teacher can be shown, in under thirty seconds and without a
spreadsheet, exactly why ₹1,840 was deducted and which rule version said so.

---

## Round 6 — Arrears, advances, loans

**Schema** — `supabase-migrations/payroll_v2_money.sql`:

- `payroll_arrears` — `employee_id`, `revision_id`, `from_period`, `to_period`,
  `breakdown` JSONB (per period, per component: was, now, delta), `amount`,
  `status` (`pending` | `scheduled` | `paid`), `run_id`. Generated when a
  revision's `effective_from` precedes a locked run — the locked run is never
  touched.
- `payroll_advances` — `amount`, `reason`, `sanctioned_by`, `sanctioned_on`,
  `recovery_mode` (`single` | `emi`), `start_period`, `status`.
- `payroll_loans` — `principal`, `interest_rate`, `interest_type` (`none` |
  `flat` | `reducing`), `emi_amount`, `tenure_months`, `start_period`, `status`
  (`active` | `on_hold` | `closed` | `written_off`).
- `payroll_loan_schedule` — generated amortisation: `period`, `emi_due`,
  `principal_part`, `interest_part`, `status`.
- `payroll_repayments` — `loan_id` or `advance_id`, `run_id` (null for a manual
  lump sum), `amount`, `principal_part`, `interest_part`, `at`, `note`.

**Outstanding balance is always derived** — `principal − Σ repayments.principal`,
exposed as a view. Never a mutable column that can drift from its history.

**Engine** — `engine/recoveries.ts`: EMI due this period, capped so net pay
cannot go negative (the shortfall rolls forward and says so in the trace);
partial repayment; hold and resume; foreclosure with interest recalculation.
`engine/arrears.ts`: replays the affected periods against the *old* and *new*
structures and diffs them, component by component.

**UI** — `/more/payroll/money`: per-employee ledger with the amortisation
schedule, outstanding, and every repayment traced back to the run that took it.
On the run register, recoveries appear as their own deduction heads and drill
into the loan.

**Done when** a mid-year 8% increment backdated three months produces the right
arrears without altering any locked run, and a ₹50,000 loan at 12 EMIs recovers
correctly across a resignation.

---

## Round 7 — TDS

**Schema** — `payroll_tax_declarations`: `employee_id`, `financial_year`,
`regime` (`old` | `new`), `sections` JSONB (80C, 80D, 80CCD(1B), 24(b), HRA
rent, LTA, previous-employer income), `proofs` (storage paths), `status`
(`draft` | `submitted` | `verified` | `rejected`), `verified_by`.

**Engine** — `engine/tds.ts`: projects annual taxable income from earnings to
date plus the remaining months at current structure, applies the declared
deductions under the chosen regime, computes annual liability from the pinned
TDS rule set, subtracts TDS already deducted, and spreads the balance over the
remaining months. A regime comparison runs both and shows which is cheaper — the
thing every teacher actually asks in January.

**Outputs** — Form 16 Part B data, Form 24Q quarterly annexures, a monthly TDS
register, and a per-employee tax projection sheet showing month-by-month
liability.

**UI** — ESS declaration form with live "this changes your monthly TDS by ₹X",
proof upload, and an admin verification queue.

**Done when** a declaration change moves the next run's TDS correctly and the
projection reconciles to the annual liability at year end.

---

## Round 8 — Full & final settlement

**Schema** — `payroll_ff_settlements`: `employee_id`, `resignation_date`,
`last_working_day`, `notice_days_required`, `notice_days_served`, `status`,
`run_id`, `computed` JSONB, `approved_by`.

**Engine** — `engine/ff.ts`, assembling components the earlier rounds already
built:

1. Final-month salary, prorated to the last working day, with LOP.
2. **Leave encashment** — balance × per-day at the policy group's rate basis.
   *Prerequisite*: `LEAVE_ALLOWANCES` in `src/lib/leave.ts` is currently two
   hardcoded constants (casual 12, medical 15) with no carry-forward and no
   per-group entitlement. Round 8 must first move entitlement into the policy
   group and add `payroll_leave_balances` with opening balance, accrual,
   carry-forward cap and lapse.
3. Notice-period recovery for days short.
4. Loan and advance outstanding, recovered in full.
5. Gratuity where eligible, from the pinned gratuity rule set.
6. Proportionate statutory bonus.
7. TDS true-up on the settlement.

Produced as a `run_type = 'ff'` run so it inherits the whole workflow: exceptions,
approval, lock, payout, trace. An F&F statement PDF is the payslip renderer with
a different section list.

**Done when** a resignation mid-month with an outstanding loan, 14 unused casual
days, 30 notice days served of 60 required, and 6 years of service settles
correctly and explains every line.

---

## Round 9 — Employee self-service

Extend the existing staff view in `src/app/more/salary/page.tsx` into
`/payroll/me`:

- Payslips by month and financial year, with PDF download.
- Salary breakdown with the same Why? drill-down the admin gets.
- PF passbook view (contributions by month, UAN, EPS split) and ESI contributions.
- TDS: deducted to date, projected liability, regime comparison, declarations
  with proof upload, Form 16 when published.
- Advances and loans: outstanding, schedule, next EMI, repayment history.
- Salary history: every revision with date, reason and delta.
- Leave balance and encashable days.

RLS is the existing `staff_id = auth.uid()` pattern extended to the v2 tables.
Employees can read their own lines, components and traces; they can write only
their own tax declarations.

---

## Round 10 — Variance, simulation, school analytics

**Variance** — `GET /api/payroll/runs/[id]/variance` diffs two runs' traces and
attributes every rupee of movement to a cause: increment, promotion, new joiner,
exit, LOP change, arrears, bonus, statutory rate change, structure change,
loan recovery started or ended. The answer to "why did payroll increase ₹1.8L
this month?" is a waterfall chart with each band clickable through to the
employees behind it.

**Simulation** — `POST /api/payroll/simulate` runs the engine with a scenario
patch and writes nothing:

```
{ scope: { category: 'teaching' },
  change: { kind: 'percent', component: 'BASIC', value: 5 },
  period: '2026-04' }
→ { totalDelta, employerCostDelta, pfDelta, esiDelta, tdsDelta,
    perEmployee[], annualisedDelta }
```

Optionally saved as `payroll_scenarios` for sharing with the trust or board.
Because it is the same engine, a simulation and the real run cannot disagree.

**School analytics** — salary cost per student (against the homeroom roster),
per department, per employee category, per grade band; teaching vs non-teaching
vs transport split; cost as a share of fee collection (joins the existing
`src/lib/fees.ts`); twelve-month trend. No campus dimension exists in the schema
today — add `campus_id` to `staff_details` and `homerooms` first if the school
is multi-campus, otherwise skip that axis.

**Done when** the board pack — headcount, cost, variance, and a 5% increment
scenario — comes out of the product instead of a spreadsheet.

---

## Why this beats the incumbents

| | MyClassBoard / Entab / Fedena | This plan |
|---|---|---|
| Salary structure | Fixed heads, edit in place | Versioned, effective-dated, formula components, append-only |
| Historical payroll | Recomputed from current master | Physically immutable; trigger-enforced; hashed at lock |
| A disputed deduction | "Contact the admin" | Why? panel: day grid, rule, rule version, approver |
| Different rules per cohort | Global settings | Priority-resolved policy groups + calendars, with a coverage check |
| Compliance changes | Developer ticket | Publish a new rule-set version with a dated effect and a delta preview |
| Approval | A status field | 9-state workflow, blocking exceptions, mandatory pre-approval variance |
| "Why did payroll rise?" | Export to Excel | Attributed waterfall, clickable to the employees |
| "What if we give 5%?" | Not offered | Simulation on the same engine that runs payroll |

---

## Risks and how they are handled

- **Engine drift between preview and authority.** Mitigated structurally: one
  pure module, imported by both. A test asserts a browser preview and a server
  calculate produce identical output for the same fixture.
- **The import round.** Legacy `salary_record_items` carry free-text labels
  including legacy prefixes (`Task bonus (June 2026) · 4 pts`). The import maps
  known labels to components and puts the rest in an `IMPORTED_ADJUSTMENT` head
  rather than guessing. Reconciliation report required before the old tables go
  read-only.
- **JSONB rules becoming a second, worse programming language.** Every rule set
  is typed and Zod-validated on write, and each domain has a hand-written engine
  function. Rules are data; behaviour stays in TypeScript.
- **Round 4 is large.** It cannot ship in pieces — the workflow, exceptions and
  immutability are one feature. Budget for it accordingly, and keep the old
  cycle page live until the import reconciles.
- **Leave entitlement is thinner than the plan assumes.** `LEAVE_ALLOWANCES` is
  hardcoded with no balance table. Round 8 carries that work; do not discover it
  in Round 8.
- **No campus dimension exists.** Round 10's per-campus analytics needs schema
  work first, or should be dropped from scope.
