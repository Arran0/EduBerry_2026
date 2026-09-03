# Round C — Work Locations, Taxes & Forms, Loans, Bulk Disbursal

A follow-on to `docs/payroll-upgrade-plan.md` (Rounds A and B, shipped). That
plan built the engine, the versioned rule sets, the 9-state run workflow and the
explainability layer. It assumed one school, in one state, paying from one bank
account, and it said so — "No campus dimension exists in the schema today".

This round closes four gaps, each named against what Zoho Payroll actually does:

| # | Gap | Zoho equivalent |
|---|---|---|
| C1 | One hardcoded state; no office/branch dimension | Work Locations + multi-state statutories |
| C2 | TDS is computed but nothing is filed | Taxes and Forms (TDS liabilities, challans, 24Q, Form 16) |
| C3 | Loans exist as a ledger, not a managed product | Loans module (loan types, perquisite, foreclosure) |
| C4 | Disbursal is bound to the *legacy* cycle tables | Direct Deposit (ICICI/HSBC) + Bank Advice |

Each part is independently shippable. C1 is a prerequisite for the per-location
parts of C2 and C4, and should go first.

---

## Where we actually stand

Verified against the code, not the plan document.

### Multi-location / multi-state

- **There is no location entity anywhere.** No table, no column, no UI. The only
  location tables in the schema are `bus_locations` and
  `attendance_location_attempts`, both unrelated.
- **Jurisdiction is a single hardcoded constant.** `src/lib/payroll/hydrate.ts:33`
  — `const DEFAULT_JURISDICTION = 'IN-TN'`. Not a setting, not per-tenant.
- **Per-employee jurisdiction half-exists.** `staff_details.pt_jurisdiction`
  (added in `payroll_v2_structures.sql:32`) is read by
  `toEngineEmployee` (`src/lib/payroll/rows.ts:230`) and flows into PT and LWF
  (`engine/calcLine.ts:170-171`). So the *engine* is already multi-state capable
  for PT/LWF. Nothing populates the column, and no screen exposes it.
- **The run pins the wrong rule sets.** `loadRunContext` pins one rule set per
  domain using the single default jurisdiction (`hydrate.ts:73-77`), and writes
  those ids to `payroll_runs.rule_set_ids`. But `buildEngineInput` resolves the
  rules the engine actually uses from the *employee's* jurisdiction
  (`hydrate.ts:259`). On a two-state run these disagree: the stored provenance
  claims Tamil Nadu PT for a Karnataka employee. Invariant 3 of the original
  plan ("rules are versioned and pinned per run") is violated the moment a
  second state exists. **This is a bug today, latent only because no employee
  has a non-default `pt_jurisdiction`.**
- **Statutory registration numbers are singletons.** `StatutoryConfig`
  (`src/lib/statutory.ts:25-57`) holds one `epf_establishment_id` and one
  `esi_employer_code` in a single `site_settings` row. Two ESIC sub-codes cannot
  be represented, so two ESIC returns cannot be filed.
- **A run has no scope.** `payroll_runs` (`payroll_v2_runs.sql:23`) has period,
  type and status but no location filter; `payroll_run_lines` snapshots
  structure, policy group and calendar but not location.

### Taxes and forms

- `engine/tds.ts` (210 lines) is real: both regimes, slabs, rebate, surcharge,
  cess, annual projection spread over remaining months, regime comparison.
- `payroll_tax_declarations` exists (`payroll_v2_tax_ff.sql`), with regime,
  sections, previous employer, proofs and a verification status.
- **Nothing is filed.** There is no TDS liability ledger, no challan record, no
  Form 24Q text file, no Form 16 Part A/Part B generator. The "Form 16" in
  `src/components/salary/statements/documents.tsx:308` is explicitly *not* the
  statutory form — its own footer says so ("not a statutory Form 16 / TDS
  certificate"). The ESS declaration form at `/payroll/me/declaration` is a stub.
- The EPF ECR and ESIC MC builders in `src/lib/statutory.ts` are good and stay.

### Loans

- Schema is sound: `payroll_loans`, `payroll_loan_schedule`, `payroll_repayments`,
  `payroll_advances`, with outstanding derived as a view, never stored
  (`payroll_v2_money.sql`).
- `engine/recoveries.ts` (153 lines) caps EMI so net pay cannot go negative and
  rolls the shortfall forward with a trace note.
- `/more/payroll/money` (256 lines) creates loans and advances, shows the
  amortisation schedule and records manual repayments.
- **Missing**: loan *types* with policy caps, an employee request → sanction
  workflow, perquisite tax on interest-free/concessional loans (a real Indian
  compliance obligation, and the single biggest functional gap versus Zoho),
  foreclosure and part-prepayment with re-amortisation, hold/resume from the UI,
  opening-balance import for loans that predate the system, and any ESS view.

### Bulk disbursal

- `src/lib/payoutProvider.ts` (386 lines) is the strongest piece: three live
  modes — `manual`, `bank_file`, `bank_api` — with the school's own bank moving
  the money and no aggregator taking a cut. `bankConfig.ts` carries bank presets,
  auth modes, transfer modes (NEFT/RTGS/IMPS/INTRA), an RTGS floor check and a
  configurable field map and file format.
- **It is wired to the wrong tables.** `POST /api/salary/payout/initiate` takes a
  `cycle_id` and reads `salary_cycles` / `salary_records`
  (`src/app/api/salary/payout/initiate/route.ts:56`). The v2 run has
  `payout_status` and `payout_reference` columns on its lines and a `paid` /
  `reconciled` state in its workflow, but **no payout route exists** —
  `src/app/api/payroll/runs/[runId]/` contains only `calculate` and `transition`.
  A v2 run cannot currently pay anybody.
- Single source account. No per-location or per-entity funding account, no
  maker-checker, no batch record, no partial/selective payment, no retry ledger.

---

## Competitive analysis — how Zoho Payroll does it

Sources are linked at the end. Only what is relevant to the four gaps.

### Work Locations (C1)

Zoho models a **legal entity** with many **work locations** under it. A location
is not cosmetic: it carries the state, and the state carries the statutory
regime. Employees are assigned to a location, and Zoho then applies that state's
Professional Tax slabs and LWF rules automatically, updating them itself when a
state changes its rates or its deduction cycle. Multi-state work locations are a
paid-plan gate, which is a fair signal of how much machinery sits behind it.

What matters for us:

- **PT and LWF are location-derived, not person-derived.** Zoho asks for the work
  location; the state and slab follow. Our `pt_jurisdiction` on the person is the
  same data one level too low — it lets two people at the same office be taxed
  under different states, which is never correct, and requires the field to be
  set 400 times instead of 4.
- **PF and ESI registrations are per-establishment.** An ESIC sub-code and an
  EPFO establishment id belong to a location, and returns are filed per
  registration. Our single `StatutoryConfig` cannot express this.
- **Deduction cycles differ by state.** Tamil Nadu PT is half-yearly; Karnataka
  is monthly; Maharashtra is monthly with a February variation; LWF is annual in
  some states and half-yearly in others. Our `engine/statutory.ts` already models
  `frequency` and `deductionMonths` per rule set, so the engine is ready — only
  the resolution and the seed data are missing.

### Taxes and Forms (C2)

Zoho's Taxes and Forms section is four linked artefacts, and the linkage is the
product:

1. **TDS Liabilities** — what was deducted, by month, aggregated to a payable.
2. **Challans** — the actual payment to the government, recorded and then
   *associated* with the liabilities it settles. Excess on a challan can be
   redistributed across employees.
3. **Form 24Q** — the quarterly return, generated as the standardised text file
   the Income Tax Department's FVU accepts, drawing employee salary, TDS and the
   linked challan details.
4. **Form 16** — Part A and Part B, with generation for edge cases (no-TDS
   employees, mid-year joiners, rehires needing a consolidated form), signing
   (offline DSC or Zoho Sign), and a separate *publish* step so the employer
   controls when employees see it.

Two design points worth stealing: the **challan is a first-class record that
liabilities attach to** (this is what makes 24Q generate instead of being typed),
and **generation, signing and publishing are three separate states** rather than
one button.

### Loans (C3)

Zoho's Loans module is thin but correct on the one thing we lack:

- Loans have a **Loan Type**, created under "Manage Loans", and the type carries
  a **perquisite rate**.
- An interest-free or concessional loan is a **taxable perquisite** under Indian
  income tax. Zoho computes the perquisite monthly from the difference between
  the benchmark rate (the SBI perquisite rate, published for exactly this) and
  the rate actually charged, and feeds it into the employee's taxable income and
  so into TDS.
- Per-loan **exemption flag** for cases the law exempts — medical loans, and
  loans whose aggregate does not exceed ₹20,000.
- Disbursement date, repayment start date, instalment amount, automatic monthly
  deduction, manual repayment recording, and a documented path for loans that
  predate the system ("prior payroll loans").

We already beat this on amortisation (interest types, derived outstanding,
net-pay-floor capping with roll-forward, full trace). We lose on perquisite,
loan types and prior-loan import.

### Bulk disbursal by connecting banks (C4) — the deep dive

This is the part the question asked about specifically.

**Zoho does not move money.** There is no Zoho-operated payments rail for Indian
payroll. It integrates with a small number of **corporate banking channels** and
otherwise hands you a file:

- **ICICI Bank** — the flagship integration, via ICICI's Connected Banking / CIB
  channel. Requires a corporate current account, a paid Zoho Finance
  subscription, and MFA on the Zoho account. Setup takes the CIB login id (or
  corporate id + user id), then **an offline document verification with an ICICI
  relationship manager, possibly with a processing fee**, before the link goes
  Active. Credentials cannot be edited afterwards.
- **HSBC** — the currently-promoted second option.
- **YES Bank** — was integrated, **no longer accepting new requests**; existing
  connections keep working.
- **Everyone else** — download a **Bank Advice** file after approving the pay
  run and upload it to your bank's portal yourself, then **Record Payment** in
  Zoho to mark employees paid.

The authorisation flow is the interesting part, and it is deliberately
double-gated:

1. Zoho-side consent: "Approve Now", or approve in the CIB portal under
   Connected Banking Approvals, confirmed by **OTP to the registered mobile**.
2. Bank-side workflow: if the corporate has an approval (maker-checker) workflow
   configured in CIB, **each payment must additionally be approved in the bank's
   own portal** before it is released.

Operationally:

- Initiation is from the approved pay run, one click, **NEFT by default**, with
  an **OTP per transaction batch**.
- **Status is not synchronous** — it becomes available roughly **30 minutes**
  after initiation. Successful lines go to *Paid*; failed lines can be
  **re-initiated from Zoho or recorded as offline payments**.
- **A hard banking window**: ICICI payments can only be initiated on business
  days, 01:00–18:30.
- Charges vary by account; no published disbursement ceiling.
- Selective payment is supported: pay some employees now, others later, filtered
  by Unpaid / Paid+Unpaid, and record each batch separately.

**What this tells us.** Zoho's advantage is not technology — it is one
pre-negotiated bank relationship and a hosted OAuth-ish handshake. Everything
else (file generation, record-payment, per-employee status, retry) is exactly
what `payoutProvider.ts` already does, and our `bank_api` mode is strictly more
general than Zoho's fixed two-bank list. The genuine lessons are:

1. **Asynchronous status is the norm, not the exception.** Design for a poll and
   a webhook, never for a synchronous "paid".
2. **Maker-checker is the bank's, not ours** — but we must *represent* it, or the
   admin will not know why money has not moved.
3. **Partial success is the normal case.** The unit of work is a batch of lines,
   each with its own status and its own retry.
4. **The file path is not the fallback; for most Indian schools it is the
   product.** Zoho's own answer for every bank but two is a Bank Advice download.
5. **Banking windows and holidays are real constraints** worth surfacing before
   an admin clicks, not after the bank rejects.

---

## C1 — Work locations and multi-state payroll

**Goal.** One school running offices in more than one state files correctly in
each, and every figure still names the rule version it used.

### Schema — `supabase-migrations/payroll_v3_locations.sql`

```
payroll_legal_entities     name, pan, tan, registered_address, is_default
                           -- the deductor for TDS; usually one, but a trust
                           -- running two registered societies needs two.
payroll_work_locations     entity_id, name, code, address, state_code (IN-TN…),
                           is_default, status,
                           epf_establishment_id, esi_employer_code,
                           pt_registration_no, pt_enrolment_no, lwf_registration_no,
                           bank_account_id (funding account, used by C4),
                           effective_from, effective_to
payroll_location_members   (location_id, employee_id, effective_from, effective_to)
                           -- effective-dated, like every other assignment in v2,
                           -- because a transfer mid-year changes which state's
                           -- PT applies from that month and must not rewrite
                           -- history.
```

`staff_details.pt_jurisdiction` is **kept but demoted** to an explicit override
for the rare genuine case (a remote employee taxed where they live). Resolution
order becomes: explicit `pt_jurisdiction` → location's `state_code` → the
entity's default → `IN`.

`payroll_runs` gains `location_ids UUID[]` (null = all) so a run can be scoped to
one office. `payroll_run_lines` gains `location_id` and `entity_id`, snapshotted
at calculate time — a transfer next year must not move last year's return.

### Engine

- `engine/resolveLocation.ts` — same shape as `resolvePolicy.ts`, returning
  `{ locationId, stateCode, source: { rank, why } }`. `source` is mandatory, as
  everywhere else, so the Why? panel can say "Karnataka PT because Jane is
  assigned to the Bengaluru office from 2026-04-01".
- `EngineEmployee` gains `locationId` and `entityId`; `jurisdiction` keeps its
  meaning but is now *derived* by the resolver rather than read off a column.
- **Fix the pinning bug.** `loadRunContext` stops pinning against one
  jurisdiction. It resolves the distinct jurisdictions present in the run and
  pins **per jurisdiction**: `rule_set_ids` becomes
  `{ "IN-TN": { pt: …, lwf: … }, "IN-KA": { … }, "IN": { pf: …, esi: …, tds: … } }`.
  `pinnedRulesFor` then reads from that pinned map instead of re-resolving, so
  what the engine used and what the run recorded are the same object by
  construction. This is worth doing even if multi-location ships without any
  second office.

### Rule-set seed

`payroll_v3_seed_states.sql` — PT slabs and LWF for the states the school
actually operates in, sourced and dated, one rule set per `(domain,
jurisdiction)`. Tamil Nadu already exists from Round A. Add Karnataka,
Maharashtra, Telangana, Andhra Pradesh, West Bengal, Gujarat, Kerala as the
common set, each with `source_note` naming the notification.

### Statutory returns per registration

`src/lib/statutory.ts` moves `StatutoryConfig` from one `site_settings` row to
per-location columns, keeping the existing builders intact. The ECR and ESIC
generators take a `locationId`, filter the run's lines to that location, and
stamp that location's establishment id / employer code. A run covering three
locations produces three ECR files and three ESIC files, each individually
filable. The Round 0 golden-file tests must stay byte-identical for the
single-location case.

### Exceptions

New codes for the run's exceptions board: `NO_LOCATION` (block — we cannot know
which state's PT applies), `LOCATION_MISSING_PF_CODE` /
`LOCATION_MISSING_ESI_CODE` (warn until filing, block at file generation),
`NO_PT_RULE_FOR_STATE` (block), `MULTI_STATE_UNPINNED` (block — a jurisdiction in
the run has no pinned rule set).

### UI

- `/more/payroll/locations` — entities and their locations, with the four
  registration numbers per location, a state picker that shows which PT/LWF rule
  set will apply and from when, and a **coverage check** in the same spirit as
  the policy-group one: every employee, which location wins, and why. Flags
  anyone unassigned.
- Bulk-assign employees to a location, effective-dated, from the same screen.
- The run register gains a location column and a location filter; the run header
  shows the states in scope and the rule set pinned for each.
- Compliance screen groups rule sets by jurisdiction, with a "which of our
  locations does this affect" line under each.

**Done when** an employee transferred from Chennai to Bengaluru on 1 August pays
Tamil Nadu PT in the half-year that closes in August and Karnataka PT thereafter,
both explained in the Why? panel, and the August run produces two ECR files with
two different establishment ids.

---

## C2 — Taxes and Forms

**Goal.** The TDS the engine already computes becomes a return that can be
filed and a certificate that can be issued.

### Schema — `supabase-migrations/payroll_v3_tax_forms.sql`

```
payroll_tds_liabilities   entity_id, period (YYYY-MM), employee_id, run_id,
                          section ('192'), amount, deducted_on, deposited_challan_id,
                          status (pending | linked | paid)
                          -- generated at run lock from payroll_line_components
                          -- where component_code = 'TDS'. Append-only, like the
                          -- lines it comes from.
payroll_tds_challans      entity_id, challan_no (BSR + serial), bsr_code,
                          deposit_date, amount, tds, surcharge, cess, interest, fee,
                          mode (net_banking | transfer_voucher), quarter, fy,
                          attachment_path, created_by
payroll_challan_links     challan_id, liability_id, amount
                          -- many-to-many, because one challan settles many
                          -- employees and one employee's month can be split
                          -- across challans. The sum is constrained to the
                          -- challan amount by trigger.
payroll_tax_filings       entity_id, form ('24Q' | '16'), fy, quarter,
                          status (draft | generated | signed | filed | published),
                          file_path, token_no, generated_by, filed_at, published_at
```

### Engine / builders — `src/lib/payroll/tax/`

- `liabilities.ts` — build and reconcile: liabilities for a quarter, what is
  linked to a challan, what is short, what is excess. An excess on one challan is
  redistributable across employees, as Zoho does, and the redistribution is
  recorded rather than recomputed.
- `form24q.ts` — the FVU-format text file: file header, batch header, challan
  detail records (per challan, per quarter) and deductee detail records (per
  employee per challan), plus **Annexure II** in Q4 carrying the whole-year
  salary breakup, chapter VI-A deductions and the regime. Built from
  `payroll_line_components` and the challan links — never recomputed from current
  master data, so a locked year cannot shift.
- `form16.ts` — **Part A** (deductor TAN, deductee PAN, quarterly TDS deducted
  and deposited with challan references — issued from the traces, and flagged as
  "TRACES-generated Part A required for statutory issue" because Part A is
  legally downloaded from TRACES, not self-generated; ours is the working copy
  and the reconciliation input) and **Part B** (the full salary annexure: gross
  salary section-wise, exemptions under section 10, standard deduction,
  perquisites — including the C3 loan perquisite — other income declared,
  Chapter VI-A with allowed vs claimed, rebate, cess, tax payable, TDS deducted).
  Rendered through the existing `@react-pdf/renderer` stack.
- The existing `documents.tsx` "Form 16" statement is renamed **Salary
  Statement** so the real one is unambiguous.

### Workflow

`generate → sign → publish`, matching Zoho and, more importantly, matching how a
school actually works: the accountant generates, the correspondent signs, and
nobody sees it until the trust says so. Signing supports an uploaded DSC-signed
PDF (offline) as the realistic first cut; digital signing in-app is out of scope
for this round and stated as such.

### API

```
POST /api/payroll/tax/liabilities/build     (quarter → generate from locked runs)
POST /api/payroll/tax/challans              (record a challan)
POST /api/payroll/tax/challans/[id]/link    (attach liabilities, auto-suggest)
GET  /api/payroll/tax/24q?fy=&q=            (download the FVU text file)
POST /api/payroll/tax/form16/generate       (fy, employee scope)
POST /api/payroll/tax/form16/publish
```

### UI — `/more/payroll/taxes`

Four tabs mirroring the artefacts: **TDS Liabilities** (by quarter, with
linked/unlinked totals and the shortfall in red), **Challans** (record, attach
receipt, auto-suggest links, show the residue), **Form 24Q** (per quarter:
readiness checklist — every liability linked, every PAN present, every challan
dated — then generate, then download), **Form 16** (per employee, generate/sign/
publish with a bulk action and a per-employee status grid).

ESS gets the real declaration form (`/payroll/me/declaration`, currently a stub):
section-wise entry, live "this changes your monthly TDS by ₹X" using the existing
projection, regime comparison, proof upload, submission, and the published Form
16 when it lands. Admin gets the verification queue.

**Done when** a quarter's liabilities reconcile to the challans to the rupee, the
24Q text file passes the FVU, and a mid-year joiner's Form 16 Part B includes the
previous employer's income from their declaration.

---

## C3 — Loan management

**Goal.** Turn the existing ledger into a managed product, and close the
perquisite gap.

### Schema — `supabase-migrations/payroll_v3_loans.sql`

```
payroll_loan_types        name, code, max_principal, max_tenure_months,
                          interest_rate, interest_type, perquisite_rate,
                          perquisite_exempt (bool), eligibility JSONB
                          (min_service_months, categories, policy_group_ids),
                          requires_approval_by, is_active
payroll_loans      ADD    loan_type_id, disbursement_date, perquisite_rate,
                          perquisite_exempt, exempt_reason,
                          source ('sanctioned' | 'prior_payroll'),
                          opening_outstanding, opening_as_of_period
payroll_loan_requests     employee_id, loan_type_id, amount, tenure_months,
                          reason, status (draft|submitted|recommended|approved|
                          rejected|disbursed), requested_at, decided_by,
                          decision_note, loan_id
payroll_loan_events       loan_id, kind (hold|resume|foreclose|part_payment|
                          reschedule|write_off), effective_period, amount,
                          actor, note   -- append-only; the schedule is rebuilt
                                        -- forward from an event, never edited
```

### Engine — `engine/recoveries.ts` extensions and `engine/perquisite.ts`

- **Perquisite on concessional loans.** Monthly value = (benchmark rate −
  charged rate) × the **maximum outstanding balance on the last day of each
  month**, which is the method the rule prescribes; exempt when the loan is
  flagged medical or when the employee's aggregate original loan does not exceed
  ₹20,000. Emitted as an `informational` component `LOAN_PERQ` — it adds to
  taxable income and therefore to TDS, but never to net pay. Fully traced: rate
  used, balance used, why exempt if exempt. This flows straight into C2's Form 16
  Part B perquisite section.
- **Foreclosure and part-prepayment.** A repayment outside the schedule closes or
  re-amortises the remainder; the schedule rows from the effective period forward
  are regenerated and the superseded ones marked, never deleted.
- **Hold and resume** as events, with the held months' EMIs either extending the
  tenure or increasing the later EMIs — a choice on the event, not a hardcoded
  rule.
- **Prior-payroll loans.** `opening_outstanding` + `opening_as_of_period` let a
  loan that started before EduBerry be recovered correctly without inventing a
  repayment history it does not have. The schedule is generated from the opening
  balance forward, and the trace says the opening figure was imported.
- **F&F integration** already recovers outstanding in full (`engine/ff.ts`); it
  gains foreclosure interest handling and a written-off path for the shortfall.

### UI

- `/more/payroll/money` gains a **Loan Types** tab (the policy: caps, rates,
  perquisite rate, eligibility, who approves) and a **Requests** queue.
- The loan detail view gains: perquisite this year, the event history, and
  foreclose / part-pay / hold actions with a preview of the re-amortised
  schedule before committing.
- ESS `/payroll/me` gains loans: outstanding, next EMI, full schedule, repayment
  history, the perquisite added to their taxable income and why, and a request
  form.

**Done when** a ₹3,00,000 interest-free staff loan sanctioned in June produces
the right monthly perquisite, that perquisite appears in the employee's TDS
projection and their Form 16 Part B, a part-prepayment in November re-amortises
correctly, and a prior-payroll loan imported at ₹80,000 outstanding recovers to
zero without a fabricated history.

---

## C4 — Bulk disbursal and bank connections

**Goal.** A v2 run can pay people — which it cannot today — with per-location
funding accounts, honest asynchronous status, and partial retry.

### First, the missing route

`POST /api/payroll/runs/[runId]/payout` does not exist. Build it as a thin
adapter over the existing `payoutProvider.ts`, reading `payroll_run_lines`
instead of `salary_records`. This alone unblocks v2 payroll; everything else
below is on top.

### Schema — `supabase-migrations/payroll_v3_disbursal.sql`

```
payroll_bank_accounts      entity_id, location_id, label, account_number, ifsc,
                           bank_name, is_default, transfer_mode_default,
                           daily_limit, secret_ref  -- credentials stay in
                                                    -- payment_secrets, never here
payroll_payout_batches     run_id, source_account_id, mode (manual|bank_file|bank_api),
                           status (draft|awaiting_bank_approval|submitted|
                           partially_settled|settled|failed|cancelled),
                           total_amount, line_count, transfer_mode,
                           bank_batch_ref, file_path, initiated_by, initiated_at,
                           value_date
payroll_payout_items       batch_id, line_id, employee_id, amount,
                           beneficiary snapshot (name, account, ifsc — snapshotted,
                           because a bank detail edited next week must not change
                           what we sent), status (queued|sent|paid|failed|returned),
                           bank_reference, utr, failure_code, failure_reason,
                           attempt INT
payroll_payout_events      batch_id, item_id, kind, payload JSONB, at
                           -- every webhook, poll and manual mark, append-only
```

Beneficiary snapshotting and `attempt` are what make retry safe: a retry creates
a new item row for the same line rather than mutating the old one, so a
double-credit is visible instead of invisible.

### Behaviour

- **Per-location funding.** The batch's source account defaults from the
  location's `bank_account_id` (C1), so a run covering two offices produces two
  batches from two accounts — matching how a multi-entity trust actually banks.
- **Selective and partial payment**, as Zoho does: choose lines by status
  (unpaid / all), pay the rest later, each batch tracked separately. The run
  moves to `paid` only when every line is settled or explicitly excluded, and to
  `reconciled` when every item has a UTR.
- **Asynchronous by design.** `submitted` is not `paid`. A poll route
  (`GET /api/payroll/runs/[runId]/payout/status`) plus the existing webhook path
  updates items; the UI shows "status expected in ~30 minutes" rather than
  spinning. This mirrors ICICI's actual behaviour and is correct for every bank
  channel we might add.
- **Bank-side approval is represented.** `awaiting_bank_approval` is a real
  state, with the message naming what the admin must do in their bank portal.
  Without this the admin sees "submitted" and assumes done.
- **Banking window and holiday guard.** A pre-flight check warns before
  initiating outside business hours or on a bank holiday, and before an RTGS
  below its floor (the floor check already exists in `payoutProvider.ts`).
- **Pre-flight validation**, blocking, reusing the exceptions board: missing or
  invalid IFSC, duplicate account numbers across employees, name-mismatch
  warnings, zero or negative net, amount above the account's daily limit,
  beneficiary not registered (for banks that require pre-registration).
- **Bank advice file stays first-class.** It is not the fallback — for most
  Indian schools it is the path. Add per-bank presets for the common corporate
  formats alongside the existing configurable one, and a **Record Payment**
  action (select lines, set value date, mark paid, attach the bank's
  confirmation) so the file route reconciles as cleanly as the API route.
- **Maker-checker on our side too.** Initiating a batch is a separate permission
  from approving the run, so the person who approves payroll is not automatically
  the person who releases the money. This is a control Zoho leaves to the bank;
  it costs us one column and one permission check.

### UI — the run's **Disbursal** tab

Batch list with source account, mode, totals and status; the pre-flight
validation panel; initiate with a confirmation showing account, mode, value date
and total; per-line status grid with failure reasons and a **Retry failed**
action; the bank advice download; and the reconciliation view matching UTRs to
lines.

**Done when** a two-location run disburses from two accounts in one flow, a
partial failure retries only the failed lines without double-crediting anyone,
and the run reaches `reconciled` only when every line carries a UTR.

---

## Deployment order

```
payroll_v3_locations.sql       -- C1 schema
payroll_v3_seed_states.sql     -- C1 PT/LWF rule sets per state
payroll_v3_tax_forms.sql       -- C2
payroll_v3_loans.sql           -- C3
payroll_v3_disbursal.sql       -- C4
payroll_v3_backfill.sql        -- default entity + default location; every
                               -- existing employee assigned to it from their
                               -- date of joining; existing StatutoryConfig
                               -- copied onto that location. Nothing moves.
```

The backfill is the safety property: on the day this ships, a single-state school
has exactly one location holding exactly the registration numbers it had before,
every employee is assigned to it, and every number in every run is unchanged.
Assert that with a test that recalculates a fixture run before and after.

Suggested sequencing: **C1 → C4 → C2 → C3**. C1 unblocks the other three; C4 is
the shortest path to something that does not work today at all (a v2 run cannot
pay anyone); C2 is the largest; C3 is the most self-contained and can move if
another priority appears.

## Testing

- The Round 0 golden ECR/ESIC fixtures must stay byte-identical for the
  single-location case, and gain a two-location fixture producing two files.
- A pinning test: a run with employees in two states records both jurisdictions'
  rule sets and the engine uses exactly the ones recorded.
- A transfer test: employee moves state mid-half-year; PT lands in the right
  state's cycle in both halves.
- A 24Q fixture asserting the serialised text file, in the same style as the ECR
  golden test.
- A perquisite fixture across a full loan life, asserting the taxable addition
  and its absence from net pay.
- A payout test: partial failure, retry, no double-credit, `reconciled` only on
  full UTR coverage.

## Risks

- **The pinning bug is live.** It is invisible only because nobody has a
  non-default `pt_jurisdiction`. If any part of C1 ships incrementally, fix
  `loadRunContext` first, not last.
- **State rule data is a maintenance commitment.** Zoho updates PT and LWF
  centrally as part of the subscription. Every state we seed is a rule set
  somebody must revise when that state changes its slabs. Seed only the states
  the school actually operates in, and put the `source_note` and a review date on
  each one.
- **Form 16 Part A is legally a TRACES download.** Generating our own is a
  working copy and a reconciliation aid, and must be labelled as such on the
  document itself. Claiming otherwise is a compliance problem, not a UX one.
- **24Q's FVU format is fussy and versioned.** Budget for a validation round
  against the current FVU rather than assuming first-pass acceptance.
- **A bank API integration is a relationship, not a sprint.** ICICI's own flow
  requires an offline RM verification with a possible fee. Ship `bank_file` +
  Record Payment as the default path and treat any `bank_api` connection as a
  per-deployment onboarding exercise. This is not a weakness relative to Zoho —
  Zoho hands every bank but two the same file.
- **Money movement deserves its own review.** C4 touches payouts; the retry and
  snapshot design exists specifically to make double-credits impossible by
  construction, and the implementation should be reviewed against that claim
  rather than assumed to meet it.

## Explicitly out of scope

In-app digital signing of Form 16 (DSC upload only); TRACES API integration;
ITR filing for employees; foreign-currency or non-India payroll; per-campus cost
analytics (still needs the schema work Round 10 flagged, now unblocked by
`payroll_work_locations` — worth revisiting after C1).

---

## Sources

- [Zoho Payroll — Work Locations](https://www.zoho.com/us/payroll/help/employer/settings/work-locations.html)
- [Zoho Payroll — Compliance in Zoho Payroll (PF, PT, LWF, ESI)](https://www.zoho.com/in/payroll/academy/taxes-and-compliance/compliance-in-zoho-payroll.html)
- [Zoho Payroll — Multi-state payroll](https://www.zoho.com/blog/payroll/multi-state-payroll.html)
- [Zoho Payroll — Taxes and Forms knowledge base](https://www.zoho.com/in/payroll/kb/employer/taxes-and-forms/)
- [Zoho Payroll — Form 24Q](https://www.zoho.com/in/payroll/help/employer/taxes-and-forms/form-24q.html)
- [Zoho Payroll — Challans for TDS liabilities](https://www.zoho.com/in/payroll/help/employer/taxes-and-forms/challans.html)
- [Zoho Payroll — Guide to Form 16](https://www.zoho.com/in/payroll/academy/taxes-and-compliance/guide-to-form-16.html)
- [Zoho Payroll — Loans](https://www.zoho.com/en-in/erp/help/payroll/loans.html)
- [Zoho Payroll — Perquisite rates for employer-provided loans](https://www.zoho.com/in/payroll/kb/employer/loans/what-is-perquisite.html)
- [Zoho Payroll — Handling prior payroll loans](https://www.zoho.com/in/payroll/kb/employer/loans/prior-payroll-loan.html)
- [Zoho Payroll — Direct Deposit, ICICI Bank integration](https://www.zoho.com/in/payroll/help/employer/direct-deposit/direct-deposit-icici.html)
- [Zoho Payroll — Direct Deposit overview](https://www.zoho.com/in/payroll/kb/employer/direct-deposit/direct-payment.html)
- [Zoho Payroll — YES Bank integration](https://www.zoho.com/blog/payroll/yes-bank-integration-in-zoho-payroll.html)
- [Zoho Payroll — Pay Runs (bank advice, record payment)](https://www.zoho.com/in/payroll/help/pay-runs.html)
