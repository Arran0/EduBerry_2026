# School Fee Engine — Round-by-Round Upgrade Plan

A staged plan to grow the shelved Fee Manager into a fee system built for
schools, benchmarked against Inkwell and aimed at what MyClassBoard / Entab /
Fedena fee modules do badly: a single all-or-nothing "Fees" permission, bills
that are really just rows, discounts that float free of any invoice, late fees
nobody dares switch on, and a collection report that cannot say *why* a number
moved. Each round is independently shippable, builds on the last, and ends with
a paste-ready prompt.

Four rounds. Round 1 is foundations, Round 2 is money in, Round 3 is money
adjusted and money chased, Round 4 is money explained.

---

### Status

**All four rounds are delivered.**

Round 1 — migrations `fee_r1_academic_years.sql`, `fee_r1_permissions.sql`,
`fee_r1_config.sql`, `fee_r1_settings_audit.sql`; the engine in
`src/lib/fees/engine/` (`money`, `words`, `dates`, `structure`, `proration`,
`schedule`); `src/lib/academicYear.ts`, `src/contexts/AcademicYearContext.tsx`,
`src/lib/fees/{permissions,config,settings,serverGuard}.ts`,
`src/hooks/useFeePermissions.ts`; `FeeSettingsPanel` with six tabs at
`/admin/fee-settings`, the price-list builder at `/more/fees/config`, and
`/more/fees/settings` reduced to a redirect.

Round 2 — migrations `fee_r2_profiles.sql`, `fee_r2_invoices.sql`,
`fee_r2_payments.sql`, `fee_r2_ledger.sql`, `fee_r2_generate.sql`,
`fee_r2_autogen_cron.sql`, `fee_r2_bus_merge.sql`, `fee_r2_harden_grants.sql`;
`engine/allocate.ts`; six API routes under `src/app/api/fees/`;
`src/lib/fees/invoices.ts`; the counter, students, profile, bills and hub
screens, the invoice and A4/58 mm receipt documents, and the public
`/verify/receipt/[token]`.

231 tests pass (87 of them new), build clean. The acceptance scenario was run
against real data and then cleaned up: 74 grade-5 bills at 40% of ₹27,000;
₹4,000 cash leaves ₹6,800 partly paid; the QR scans VALID; reversal with a
reason restores ₹10,800 and flips the QR to CANCELLED; ₹12,000 against a
₹10,800 bill banks ₹1,200 as a credit; a post-dated cheque leaves the bill
unpaid until it clears, then bounces it with a ₹350 charge added as a line.

Three things inside these rounds were deliberately not finished, and are called
out here rather than left to be discovered:

- **The bus tables were not replaced by views.** The plan said transport would
  fold in by swapping `bus_fees` / `bus_payments` for compatibility views. It
  does not: `src/lib/bus.ts` writes to those tables in fifteen places and a view
  is not updatable without INSTEAD OF triggers reproducing all of it. What
  shipped instead is the ledger-level fold — transport heads in the price list,
  an idempotent `fee_import_bus_ledger()`, and `fee_collection_all` so the
  headline numbers already cover both. Porting the bus fee screens onto
  invoices is outstanding, and until it happens a school using both gets two
  bills.
- **Online payment is not wired to the new invoices.** The four Razorpay and
  UPI routes still target `school_fees`. Round 3's tokenised pay links replace
  them; the student view says so rather than showing a Pay button that fails.
- **A security defect Round 1 shipped and Round 2 fixed.** `REVOKE EXECUTE …
  FROM anon, authenticated` does nothing while PostgreSQL's default grant to
  PUBLIC stands, so every fee function was reachable over `/rest/v1/rpc` —
  including `fee_post_ledger`, which has no internal permission check because it
  is only ever called from inside `fee_collect`. `fee_r2_harden_grants.sql`
  revokes from PUBLIC first, then grants to exactly the roles that need it. Any
  later round adding a function must follow that order.

Round 3 — migrations `fee_r3_concessions.sql`, `fee_r3_charges.sql`,
`fee_r3_actor_attribution.sql`, `fee_r3_messaging.sql`; `engine/latefee.ts`;
`src/lib/whatsapp/{provider,metaCloud,secrets}.ts`, `src/lib/fees/charges.ts`;
the WhatsApp webhook, the outbox drain, the reminder send and the tokenised
`/pay/[token]`; and the three screens `/more/fees/{concessions,charges,collections}`,
including the late-fee rule builder, which runs `computeLateFee` itself on every
keystroke against a real bill from the school and blocks Save on
`validateRule`'s errors.

Round 4 — migrations `fee_r4_edge.sql` and `fee_r4_reporting.sql`;
`src/lib/fees/reports.ts` with its whitelisted question builder; four API routes
for refunds and carry-forward; the Collection Center at `/more/fees/reports`
with its six tabs, the efficiency bar's session marker, the aging cliff, the
defaulter heatmap and the year calendar; global search; the refund queue, the
RTE register and the refund request on a student's own profile.

Two defects were found and fixed while building these rounds, both worth
naming because the shape of each recurs:

- **Round 2 attributed nothing.** Every RPC read `auth.uid()` for the actor,
  but the API routes hold a service-role client with no JWT, so `auth.uid()`
  was NULL: every payment taken through `/api/fees/collect` recorded
  `collected_by = NULL`. The same hole let a route call pass
  `fee_requires('fees.discount.approve')` — true for service context by design
  — and silently auto-approve every concession.
  `fee_r3_actor_attribution.sql` threads an explicit `p_actor` through six
  functions and drops the old signatures so PostgREST cannot pick the
  unattributed overload. The rule: `fee_requires(key)` asks *may this call
  proceed*; `fee_actor_can(actor, key)` asks *does this named human hold it*,
  and only the second may gate an approval.
- **That migration then shipped without grants.** DROP and CREATE reset each
  function to PostgreSQL's default of EXECUTE to PUBLIC, so a deploy from the
  migration files alone would have re-opened exactly the hole
  `fee_r2_harden_grants.sql` closed. The live database was correct only because
  the grants had been issued by hand. They are in the file now. Any migration
  that recreates a function must re-issue its grants in the same file.

269 tests pass, build clean, and every round's acceptance scenario was run
against real data and then cleaned up — including the append-only tables, whose
guards were suspended for that one deletion and put straight back.

---

## Where we start (current state)

**The module is switched off.** `src/app/more/fees/page.tsx:44` exports a
`FeesPage` that renders only `<UnderConstruction title="Fees" />`. The real
1,330-line implementation sits below it as `FeesPageOriginal()` and is never
called. Everything under it — data layer, API routes, PDFs, admin settings —
is live and working, and unreachable.

**Schema** (`supabase-migrations/`): `add_fee_manager.sql`,
`add_fee_statements.sql`, `add_bus_fee_heads.sql`, `add_payment_secrets.sql`,
`add_bank_connection_settings.sql`, `fix_student_fee_payment_visibility.sql`.

- `fee_heads` — `name`, `description`, `default_amount`, `active`. A flat
  catalogue. No category, no tax, no year.
- `school_fees` — one issued line per student: `fee_head_id`, `amount`,
  `due_date`, `status` (`unpaid|partial|paid|cancelled`), `upi_reference`,
  `academic_year TEXT`. This is the whole billing model.
- `school_fee_payments` — `method`, `amount`, `status`
  (`pending|verified|failed`), Razorpay/UPI/Smart-Collect columns, `utr` with a
  unique partial index, `verified_by`.
- `bus_fee_heads` / `bus_fees` / `bus_payments` — the same three tables again,
  for transport, with no `academic_year` at all.

**Data layer**: `src/lib/fees.ts` (669 lines) — one flat module holding types,
academic-year helpers, fee-head CRUD, bulk issue, cancel/uncancel, payments,
dashboard KPIs, the collection report and the student ledger. No engine, no
tests.

**API**: `src/app/api/fees/razorpay/{create-order,webhook}` and
`src/app/api/fees/upi/{create-collect,webhook}`. All four are sound and stay.

**UI**: `src/app/more/fees/page.tsx` (1,391 lines, shelved),
`/more/fees/downloads` (live), `/more/fees/settings` (orphaned),
`/admin/fee-settings` (43 lines, mounts only `BankCollectSettings ctx="fees"`),
and 14 components under `src/components/fees/**` — of which
`ReportsSection.tsx` (309 lines: fee-head breakdown, defaulter list) is written
and imported nowhere.

**Documents**: `src/components/fees/statements/**` — seven `@react-pdf/renderer`
documents (receipt, payment certificate, transcript, ledger, outstanding dues,
no-due certificate, annual statement) with a shared letterhead shell. Genuinely
good; it stays and grows.

**Live data**: `school_fees`, `school_fee_payments`, `fee_heads`, `bus_fees`
and `bus_payments` all hold **zero rows**. 930 students, 44 homerooms, 1,157
profiles. Nothing to migrate — every schema decision below is free.

### What is actually wrong

1. **There is no invoice.** A `school_fees` row is a single charge for a single
   head. A real bill groups several heads under one number, one due date and
   one payment. Everything downstream — receipts against a bill, discounts off
   a bill, late fees on a bill, "which bill does this come off?" — is
   unbuildable until the invoice exists.
2. **There is no fee structure and no installment plan.** `fee_heads` has one
   `default_amount` for the whole school. A Grade 1 and a Grade 12 tuition are
   the same number, and there is no way to say "three terms, due 10 Apr, 10 Aug,
   10 Dec". `/more/page.tsx:154` calls it "fee structure"; nothing backs that.
3. **Permissions are one boolean.** `get_user_role() = 'admin'` gates the whole
   module, in RLS and in the UI. There is no way to give the front desk "take a
   payment, print a receipt" without also giving them the price list and the
   power to reverse a completed payment. A school will not put this on a
   counter machine, and it is right not to.
4. **Zero concessions, fines, late fees or reminders.** Not partially built —
   the words do not appear in the codebase. Overdue is a display colour.
5. **Nothing is auditable.** `setFeeStatus` and `cancelFee` overwrite. There is
   no record of who discounted what, who reversed a payment, or what the value
   was before. A staff member accused of pocketing counter cash has nothing to
   point at.
6. **Academic year is guessed on the client, three different ways.**
   `academicYearOf` (`src/lib/fees.ts:94`) says Apr–Mar. `getAcademicYear`
   (`src/lib/homeroomAutoManage.ts:10`) says Jan–Dec and is explicitly
   documented as "any date in 2026 → 2026-27". `fetchAvailableAcademicYearsForStudent`
   (`src/lib/classrooms.ts:1435`) parses `start_date.split('-')[0]`. Between
   January and March the three disagree. There is no `academic_years` table, no
   stored current year, and five independent `useState` year pickers.
7. **Receipts are not receipts.** There is no receipt number series — the PDF
   prints a `shortId()` sliced out of a UUID. Two clerks can produce the same
   document. Nothing verifies one after the fact.
8. **Transport fees are a copy-paste fork.** Every feature below would have to
   be built twice, and a family already gets two bills for one child.
9. **No test file in the fee module.** Payroll learned this the hard way and now
   has 144 tests; money code without tests is not survivable twice.

### What is worth keeping

- `src/components/fees/statements/**` — the whole four-file PDF folder, near
  intact. It grows an invoice document and a thermal receipt.
- The four payment API routes. HMAC verification, UTR idempotency and the
  "return 200 for unknown orders" behaviour are all correct.
- `src/components/settings/BankCollectSettings.tsx` and the
  `payment_secrets` / `site_settings` split — credentials in the admin-only
  table, non-secrets in the world-readable one. That split is load-bearing and
  the new settings follow it.
- `ReportsSection.tsx` — written, tested by hand, never mounted. It becomes two
  tabs of the Collection Center.
- `FeeCollectionSummary.tsx`, `FeeStatusBadge.tsx`, `formatINR`,
  `src/lib/feeExports.ts`.
- **The notification substrate that already exists in the database and is used
  by nothing in this repo**: `notification_outbox` (25 columns — dedupe key,
  priority, not-before, attempts, provider message id, sent/delivered/failed
  timestamps), `message_templates` (channel, locale, `provider_template_name`,
  `provider_template_lang`, `variable_order` — the exact shape Meta's Cloud API
  wants), the `notification_channel` enum which **already contains `whatsapp`**,
  and a pg_cron + pg_net drain pattern (`transport_kick_drain`) that only fires
  an HTTP request when there is something to send. WhatsApp does not need a new
  messaging stack. It needs a provider adapter and a worker.
- `student_details.guardian_phone`, `guardian_phone_alt` and
  **`whatsapp_opt_in_at`** — already there, already populated.
- The payroll v2 module as a template for everything structural: `serverGuard.ts`,
  the pure engine + vitest layout, the append-only event log, the state machine
  with a `canTransition` guard enforced in three layers, versioned rule sets
  frozen on publish, and the priority-resolved policy-group pattern.
- `src/components/salary/adminUi.ts` and `src/components/payroll/ui.ts` — the
  zinc + honey-gold tokens. Both files already name the Fee Manager as sharing
  the design system. New fee screens import them.

---

## Target architecture

Three decisions settled up front.

### 1. The invoice is the unit of money, and the ledger is the truth

`fee_invoices` + `fee_invoice_lines` replace `school_fees`. Every charge,
discount, scholarship, waiver, fine and late fee is a **line on a named
invoice**, never a floating figure for the year. Alongside it,
`fee_ledger_entries` is an append-only double-entry log: every debit and credit
against a student, in order, with a running balance. Reports read the ledger,
not a sum over mutable rows, so "the money story always adds up" is a database
invariant rather than a claim a report makes.

### 2. Permissions are data, and masking happens on the server

A `fee_permissions` catalogue of 28 keys, a role default grant table, and a
per-user tri-state override. One `has_fee_permission(key)` SQL function, used
in RLS policies, in `SECURITY DEFINER` RPCs, and in a `requireFeePermission`
server guard for API routes. Amount masking is not CSS: reads go through views
that emit `NULL` for money columns when the caller lacks `fees.view_amounts`,
so the number never leaves the database.

### 3. One engine, called from three places, so preview cannot lie

`src/lib/fees/engine/**` is pure TypeScript — no Supabase import, no DOM, all
of it under vitest. The late-fee rule builder's live preview, the sweep's
confirmation screen and the nightly job all call the same `computeLateFee`. The
invoice generation preview and the actual generation call the same
`buildSchedule`. A preview that disagrees with what happens next is the single
fastest way to lose a school's trust.

---

## Six invariants

1. **Nothing that touched money is ever deleted or edited in place.** Reversal,
   removal, waiver and recalculation all write a new contra row with a reason
   and an actor. `fee_ledger_entries` and `fee_audit_log` have no UPDATE or
   DELETE policy at all.
2. **Every receipt and invoice number comes from a series, under a lock.** Two
   clerks pressing Collect at the same second get consecutive numbers, never the
   same one.
3. **Every concession, fine and late fee names an invoice.** There is no
   student-level floating adjustment. If it reduces what a family owes, it is a
   line on a bill, visible on that bill months later.
4. **Automatic charges start the day they are switched on.** Enabling a late-fee
   rule stamps `enabled_from = today`. No rule ever reaches backwards and
   invents a debt.
5. **A bulk action shows its consequences before it commits.** Invoice
   generation, the late-fee sweep and a reminder blast each have a preview that
   counts what will happen and what will be skipped, and why.
6. **A user without `fees.view_amounts` never receives an amount.** Not hidden,
   not blurred — absent from the response body.

---

## Schema map

```
YEAR + ACCESS (R1)
  academic_years ─────────────────────── every fee table's year_id
  fee_permissions · fee_role_grants · fee_user_grants
  fee_settings (versioned, frozen on publish)
  fee_audit_log (append-only)

PRICE LIST (R1)
  fee_categories
  fee_heads (upgraded: category, code, tax, transport flag, year)
  fee_groups ──── fee_structures ──── fee_structure_items
                        └──────────── fee_installments ── fee_installment_items
  fee_group_assignments (student → group, per year)

THE MONEY (R2)
  fee_profiles (student × year)
       └── fee_invoices ── fee_invoice_lines
                 ↑
       fee_payments ── fee_payment_allocations
             └── fee_instruments (cheque/DD lifecycle)
       fee_credits · fee_number_series
       fee_ledger_entries (append-only, running balance)

ADJUSTMENTS (R3)
  fee_discount_types · fee_scholarships · fee_concessions
  fee_fine_categories · fee_fines
  fee_late_fee_rules · fee_late_fee_charges · fee_late_fee_exemptions

MESSAGING (R3)  — rides the existing notification_outbox + message_templates
  fee_message_links (tokenised, expiring, revocable pay links)
  fee_reminder_schedules · fee_reminder_log
  whatsapp_numbers (opt-in / opt-out ledger)

EDGES + INSIGHT (R4)
  fee_refunds · fee_opening_balances · fee_rte_register
  reporting views: collection_daily · outstanding_aging · defaulters_by_class
                   concession_summary · instrument_pipeline · staff_collection
```

---

## Round map & dependencies

| Round | Theme | Inkwell modules covered | Depends on |
|---|---|---|---|
| 1 | Academic years, 28-key permissions, price list, settings, engine + tests | M1, M10 (permissions/audit half) | — |
| 2 | Fee profiles, invoices, auto-gen, the counter, receipts, reversal, QR verify, bus merge | M2, M3, M5, M4 (student half), M9 (credits/opening balance), M10 (audit/reversal half) | 1 |
| 3 | Concessions, fines, late fees, WhatsApp, reminders, public pay links | M6, M7, M8, M4 (WhatsApp half) | 2 |
| 4 | Collection Center, global search, refunds, RTE register, previous-year collection | M11, M9 (rest) | 3 |

**Deliberately out of scope, at your instruction:** the parent module and parent
app, the multi-child dashboard, and the escalating reminder tone (reminders keep
a single respectful template; only frequency and timing are configurable).

### Deployment order

```
fee_r1_academic_years.sql
fee_r1_permissions.sql
fee_r1_config.sql
fee_r1_settings_audit.sql
fee_r1_seed.sql
fee_r2_profiles.sql
fee_r2_invoices.sql
fee_r2_payments.sql
fee_r2_ledger.sql
fee_r2_autogen_cron.sql
fee_r2_bus_merge.sql
fee_r3_concessions.sql
fee_r3_charges.sql
fee_r3_messaging.sql
fee_r3_whatsapp_templates.sql
fee_r4_reporting.sql
fee_r4_edge.sql
```

Each is applied with the Supabase MCP `apply_migration` **and** committed to
`supabase-migrations/` as a file, matching how `payroll_v3_*` was done. Every
file is idempotent and safe to re-run.

---

## Round 1 — Years, access, the price list

**Goal.** Make the two things every later round leans on real: a stored academic
year, and a permission system with more than one switch. Then rebuild the fee
configuration into a price list a school can actually set up once a year and
clone forward.

### Schema — `fee_r1_academic_years.sql`

```sql
academic_years
  id uuid pk, code text unique          -- '2026-27'
  starts_on date, ends_on date          -- explicit, not derived
  is_active boolean                     -- partial unique index: exactly one
  status text                           -- planning | active | closed
  promoted_at timestamptz
  EXCLUDE USING gist (daterange(starts_on, ends_on, '[]') WITH &&)
```
Plus `current_academic_year()` and `academic_year_for(date)` as STABLE SQL
functions, backfilled from `DISTINCT homerooms.academic_year`, and a
`homerooms.academic_year_id` / `certificates.academic_year_id` /
`timetable_configs.academic_year_id` FK added alongside the existing text
columns (text stays, so nothing breaks mid-round).

### Schema — `fee_r1_permissions.sql`

`fee_permissions` (catalogue), `fee_role_grants` (role → key → granted),
`fee_user_grants` (user → key → granted, NULL = inherit role), and:

```sql
has_fee_permission(p_key text) RETURNS boolean
  -- user grant wins; else role grant; else false.
  -- STABLE SECURITY DEFINER, search_path = public,
  -- REVOKE EXECUTE FROM anon (matches the repo's cron-function convention)
```

**The 28 keys**, grouped as they appear in the settings matrix:

| Group | Keys |
|---|---|
| Access | `fees.view`, `fees.view_amounts` |
| Configuration | `fees.config.manage`, `fees.config.clone_year`, `fees.settings.manage`, `fees.permissions.manage` |
| Students | `fees.profile.view`, `fees.profile.create` |
| Invoicing | `fees.invoice.generate`, `fees.invoice.autogen`, `fees.invoice.cancel`, `fees.invoice.send` |
| Collection | `fees.collect`, `fees.collect.backdate`, `fees.receipt.print`, `fees.payment.reverse`, `fees.instrument.manage` |
| Concessions | `fees.discount.apply`, `fees.discount.approve`, `fees.scholarship.manage`, `fees.waiver.approve` |
| Charges | `fees.fine.apply`, `fees.latefee.manage` |
| Collections | `fees.reminder.send` |
| Money out | `fees.refund.approve` |
| Oversight | `fees.reports.view`, `fees.audit.view`, `fees.rte.manage` |

Seeded role defaults: `admin` gets all 28 (each individually revocable — that is
how "the accountant has 13 but not reversal" works); `principal` gets all except
`fees.config.manage` and `fees.permissions.manage`; `teacher`/`coordinator` get
none; a new **Fee Clerk** preset grants exactly `fees.view`, `fees.profile.view`,
`fees.collect`, `fees.receipt.print` and nothing else.

**Amount masking.** Views `fee_invoices_v`, `fee_payments_v`, `fee_profiles_v`,
`fee_ledger_v` (created in R2, declared here) wrap every money column as
`CASE WHEN has_fee_permission('fees.view_amounts') THEN amount END`. Client code
reads the views; RLS on the base tables allows SELECT only where
`has_fee_permission('fees.view')`.

### Schema — `fee_r1_config.sql`

```sql
fee_categories        (id, name, sort, active)
fee_heads   ALTER     + category_id, code, tax_rate, tax_inclusive,
                        is_refundable, is_transport, academic_year_id, sort
fee_groups            (id, academic_year_id, name, code, is_default, is_rte, description)
fee_structures        (id, academic_year_id, fee_group_id, grade smallint null,
                       name, status draft|published|archived, total_cached)
fee_structure_items   (id, structure_id, fee_head_id, amount, tax_rate, sort)
fee_installments      (id, structure_id, seq, name, due_date,
                       amount numeric null, percent numeric null,
                       autogen_enabled bool default false, autogen_days_before int,
                       sort)                       -- sort is drag-ordered on the bill
fee_installment_items (id, installment_id, fee_head_id, amount)
fee_group_assignments (id, academic_year_id, student_id, fee_group_id,
                       is_rte, prorate_from date, unique(student_id, academic_year_id))
```

`fee_clone_year(p_from uuid, p_to uuid)` — SECURITY DEFINER, guarded by
`fees.config.clone_year`, copies categories, heads, groups, structures, items and
installments with due dates shifted by the year delta; skips anything already
present; returns per-table counts. Idempotent.

### Schema — `fee_r1_settings_audit.sql`

`fee_settings` as **versioned rows**, not a JSON blob in `site_settings` —
`(academic_year_id null = global, key, value jsonb, effective_from, effective_to,
version, status draft|published|superseded, published_by, published_at)` with a
`freeze_published` trigger copied from `payroll_rule_sets_freeze_published()`.
Keys: `numbering`, `payment_rules`, `grace`, `approval_thresholds`, `reminders`,
`whatsapp`, `masking`.

Why versioned: a school that changes "partial payments allowed" in October must
not silently rewrite what a September receipt claims the rules were.

`fee_audit_log` — `(actor_id, action, entity, entity_id, student_id,
academic_year_id, before jsonb, after jsonb, reason, amount, created_at)`,
append-only trigger, readable with `fees.audit.view`.

### Engine — `src/lib/fees/engine/`

`money.ts` (paise integers, Indian rounding), `words.ts` (amount in words,
lakh/crore), `proration.ts` (mid-year join, charges only from date of joining),
`structure.ts` (resolve a student's structure: explicit assignment > group >
grade > default, returning a mandatory `{ source, why }` like payroll's
`resolvePolicy`), `schedule.ts` (structure + installments → a per-student
billing schedule), `types.ts`, `index.ts`. All under
`src/lib/fees/engine/*.test.ts` with fixtures in `__fixtures__/`.

### Data layer & API

`src/lib/academicYear.ts` — the one canonical year module, replacing
`academicYearOf` in `fees.ts` and `getAcademicYear` in `homeroomAutoManage.ts`
(this alone fixes the Jan–March disagreement).
`src/contexts/AcademicYearContext.tsx` — `useAcademicYear()`, one shared scope.
`src/lib/fees/config.ts`, `src/lib/fees/permissions.ts` (+ a `useFeePermissions()`
hook), `src/lib/fees/serverGuard.ts` — `requireFeePermission(request, key)`,
modelled line-for-line on `src/lib/payroll/serverGuard.ts`.

### UI

- `/admin/fee-settings` rebuilt as a tabbed page (the shell stays; the body
  becomes `FeeSettingsPanel`, a component, so the Fee Manager's own settings
  button can mount the same thing — the `PayrollSettingsPanel` precedent):
  **Permissions** (the 28-key matrix by role, per-user overrides, and a
  *coverage check*: pick a permission, see exactly who has it and why),
  **Policies**, **Numbering** (with a live "next receipt will be MPS/26-27/0001"
  preview), **Academic Years**, **Collection** (the existing
  `BankCollectSettings`, untouched), **WhatsApp** (built now, disabled until you
  finish the setup guide below), **Reminders** (R3 placeholder).
- `/more/fees/config` — Fee Configuration: Categories · Heads · Groups ·
  Structures · Installments (drag to order), and one **Clone from 2026-27**
  button.
- `/more/fees/settings` reduced to a `redirect('/admin/fee-settings')`, matching
  what `more/salary/manage/settings/page.tsx` already does.

**Done when** an admin builds 2026-27's entire price list, clones it to 2027-28
in one click with due dates shifted a year, and a Fee Clerk account opens
`/more/fees` to find the counter and nothing else — with every rupee figure
absent from the network response, not merely hidden in CSS.

---

## Round 2 — Profiles, invoices, the counter, receipts

**Goal.** Bills that are real documents, a counter that is faster than a
register, receipts that can be verified by a stranger, and a reversal trail that
protects the clerk as much as the school.

### Schema — `fee_r2_profiles.sql` / `fee_r2_invoices.sql` / `fee_r2_payments.sql` / `fee_r2_ledger.sql`

```sql
fee_profiles      (student_id, academic_year_id, fee_group_id, structure_id,
                   status active|withdrawn|transferred, prorate_from,
                   opening_balance, is_rte, unique(student_id, academic_year_id))

fee_invoices      (profile_id, student_id, academic_year_id, installment_id,
                   number text unique, series, seq, issue_date, due_date,
                   gross, discount_total, tax_total, late_fee_total, fine_total,
                   net, paid, balance,
                   status draft|pending|partly_paid|paid|overdue|cancelled,
                   autogen bool, verify_token text unique,
                   cancelled_reason, cancelled_by, cancelled_at)
fee_invoice_lines (invoice_id, kind fee|discount|scholarship|waiver|fine|late_fee|carry_forward,
                   fee_head_id, label, amount, tax_rate, tax_amount, source_id, sort)

fee_payments      (student_id, academic_year_id, receipt_no unique, series, seq,
                   paid_on, method, amount, reference, notes, instrument_id,
                   status pending|verified|reversed|failed,
                   razorpay_*, utr, provider_ref, collect_vpa,
                   collected_by, verified_by, verified_at,
                   reversed_by, reversed_at, reversal_reason,
                   receipt_hash text)     -- sha256 over the canonical payload
fee_payment_allocations (payment_id, invoice_id, amount)   -- one payment, several bills
fee_instruments   (student_id, kind cheque|dd, number, bank, branch, account_holder,
                   amount, instrument_date, is_postdated, present_on,
                   status received|deposited|cleared|bounced|cancelled,
                   bounce_charge, bounce_reason, timeline jsonb)
fee_credits       (student_id, academic_year_id, source_payment_id, amount, consumed)
fee_number_series (key, academic_year_id, prefix, width, next_seq)
fee_ledger_entries(student_id, academic_year_id, entry_date, kind, ref_table, ref_id,
                   debit, credit, balance_after, note)      -- append-only
```

- `fee_next_number(p_key, p_year)` takes a transaction-level advisory lock on the
  series before incrementing. Concurrent Collect presses get consecutive numbers.
- `receipt_hash` = SHA-256 over `(receipt_no, student, amount, paid_on, allocations)`
  via `pgcrypto`, the same tamper-evidence idea as `payroll_lock_run`'s
  `locked_hash`. `fee_verify_receipt(token)` re-computes it.
- **Reversal never deletes.** Payment → `reversed`, allocations reversed, invoice
  reopens, a contra pair lands in `fee_ledger_entries`, the receipt's QR flips to
  CANCELLED, and `fee_audit_log` takes a row with a mandatory written reason.
  Gated on `fees.payment.reverse`.
- **Cheque lifecycle**: received → deposited → cleared, or → bounced, which adds
  a bank-charge fine line and reopens the original invoice automatically.

### Schema — `fee_r2_autogen_cron.sql`

`fee_autogen_tick()` at 02:00 IST, a direct copy of `transport_kick_drain`:
count eligible installments first, and only then `net.http_post` to
`/api/fees/cron/autogen` with `x-cron-secret`. No pending work, no HTTP request.
The same endpoint in preview mode powers the generation screen's counts, so the
preview cannot disagree with the job.

### Schema — `fee_r2_bus_merge.sql`

Transport becomes a `fee_categories` row and `is_transport` fee heads inside the
unified system. `bus_fees` / `bus_payments` / `bus_fee_heads` are replaced by
compatibility **views** over the new tables so `src/lib/bus.ts` and the bus
screens keep working while they are ported. All three tables hold zero rows
today, so this is a cutover, not a migration. A family gets one bill, one receipt
series and one outstanding number.

### Engine

`invoice.ts` (schedule + concessions + fines → lines), `allocate.ts` (a payment
across invoices: oldest-first by default, clerk-overridable),
`numbering.ts`, `hash.ts`, `credit.ts`. Tests for each.

### API

`POST /api/fees/invoices/generate` (`?preview=1` returns counts and skip reasons
without writing), `POST /api/fees/collect`, `POST /api/fees/payments/[id]/reverse`,
`POST /api/fees/instruments/[id]/transition`, `POST /api/fees/cron/autogen`,
`GET /api/fees/verify/[token]`. Every one behind `requireFeePermission`.

### UI

- `/more/fees` — the module un-shelved: a hub, not the old 1,391-line page.
- `/more/fees/students` — profile list with instant search by name or admission
  number and class browse; **Bulk create profiles**: pick classes (or the whole
  school) and a fee group, preview *"will create 412 · skip 38 (already have a
  profile) · skip 6 (RTE) · skip 2 (withdrawn)"*, then commit.
- `/more/fees/students/[id]` — the Fee Profile. Summary strip (Total · Concessions
  · Paid · Pending · Credit) over ten tabs: Invoices, Payments, Receipts, Cheques,
  Concessions, Fines, Late fees, Ledger, Documents, Activity.
- `/more/fees/invoices` — every bill, filterable; and the generation screen
  showing each installment, how much is already billed, the auto-gen switch and
  its days-before setting, and the per-fee-group preview breakdown.
- `/more/fees/counter` — the Fee Counter. Sidebar search, the student's unpaid
  bills the moment they are selected, a Collect sheet with full/partial, every
  method (cash, UPI, card, net banking, bank transfer, DD, wallet, cheque),
  cheque fields including post-dated with a presentation date, reference and
  notes. Receipt the instant Collect is pressed. A4 and 58 mm thermal layouts. A
  dedicated post-dated-cheque tab.
- Invoice PDF: school logo, name and address, line-item breakdown, amount in
  words, and a **verification QR** anyone can scan without logging in.
- `/verify/receipt/[token]` and `/verify/invoice/[token]` — public, no login,
  reusing the existing `verify/[certNo]` route pattern. Returns VALID, CANCELLED
  or REVERSED.
- Student-facing view rebuilt against invoices: fee card, full breakdown with
  concessions itemised as savings, old dues, advance, live invoices, and a
  downloadable receipt for every payment.

**Done when** a clerk takes ₹4,000 cash against a ₹10,000 bill, a numbered
receipt prints on the thermal printer, its QR scans on a stranger's phone to a
page saying VALID, the bill reads Partly Paid and the student's app reads ₹6,000
pending — and when the principal reverses that payment with a written reason,
the same QR scans to CANCELLED, the bill is back to ₹10,000, and both events are
in the activity log with names and timestamps.

---

## Round 3 — Concessions, charges, WhatsApp, reminders

**Goal.** Bring the same rigour to money given away and money added on as to
money collected; then make the system talk to guardians on the channel they
actually read.

### Schema — `fee_r3_concessions.sql`

```sql
fee_discount_types (academic_year_id, name, code, mode fixed|percent, value,
                    scope all|heads, head_ids uuid[], stackable bool,
                    auto_rule none|sibling|staff_ward|early_payment, auto_config jsonb,
                    approval_threshold numeric, active)
fee_scholarships   (academic_year_id, name, funder, annual_budget, awarded_total,
                    seats, notes)
fee_concessions    (student_id, academic_year_id, kind discount|scholarship|waiver,
                    type_id, scholarship_id, invoice_id, fee_head_id,
                    amount, reason,
                    status pending|approved|declined|applied|removed,
                    requested_by, approved_by, approved_at,
                    removed_by, removal_reason, moved_from_invoice_id)
```

Every concession targets an invoice and lands as a named
`fee_invoice_lines` row, so its origin is legible on the bill months later. It
can be moved to the correct bill or removed, both with a reason on record. Above
the type's threshold it sits `pending` until someone with
`fees.discount.approve` clears it. Automatic rules: **sibling** (second child
onward, matched on shared guardian phone, with a review list before anything
applies), **staff ward** by staff category, and **early payment** (settle within
N days of issue → the line appears automatically). Waivers follow
request → approve/decline, on the record. Scholarships track funder, annual
budget and how much of it is committed.

### Schema — `fee_r3_charges.sql`

```sql
fee_fine_categories   (name, default_amount, active)
fee_fines             (student_id, category_id, amount, reason,
                       invoice_id | separate_invoice_id,      -- add to a bill, or its own slip
                       status applied|waived|removed, waived_amount, waive_reason)
fee_late_fee_rules    (academic_year_id, name, scope all|group|structure|installment, scope_id,
                       grace_days, charge_type flat|percent, rate,
                       frequency once|daily|weekly|monthly, basis whole|unpaid,
                       cap_amount, cap_percent,
                       enabled bool DEFAULT false, enabled_from date)
fee_late_fee_charges  (invoice_id, rule_id, as_of, days_late, amount,
                       status charged|waived|exempt|recalculated,
                       waive_reason, delta_of uuid)
fee_late_fee_exemptions (invoice_id, reason, created_by)
```

`engine/latefee.ts` — `computeLateFee(rule, invoice, asOf) → { amount, days,
cappedBy, trace }`, pure and tested. It backs three surfaces: the **interactive
rule builder** (as you type the rule, a sample bill recalculates beside it, with
a red warning box when the rule would produce an unreasonable charge), the
**sweep preview** (N bills, ₹X total, broken down by class, before confirming),
and the nightly job. Rules ship disabled; enabling stamps `enabled_from = today`
so nothing is retroactive. Individual bills can be exempted, charged fees can be
waived with a reason, and changing a rule issues a signed `delta_of` correction
rather than editing history.

### Schema — `fee_r3_messaging.sql` + `fee_r3_whatsapp_templates.sql`

```sql
whatsapp_numbers        (student_id, msisdn, opt_in_at, opt_out_at, verified_at, source)
fee_message_links       (token unique, kind invoice|receipt|statement,
                         invoice_id, student_id, expires_at, revoked_at,
                         opened_at, paid_at, created_by)
fee_reminder_schedules  (academic_year_id, name, enabled, offsets int[],   -- days rel. to due
                         send_at time, channels notification_channel[],
                         scope, quiet_days int[], skip_if_paid bool default true)
fee_reminder_log        (student_id, invoice_id, schedule_id, channel, template_key,
                         outbox_id, sent_at, delivered_at, read_at, paid_within_hours)
```

Messaging **reuses `notification_outbox` and `message_templates` as they stand** —
`module='fees'`, the existing `whatsapp` channel value, the existing
`dedupe_key` / `not_before` / `attempts` / `provider_message_id` columns, and the
existing `provider_template_name` + `variable_order` fields which are already
shaped for Meta's Cloud API. `fee_kick_drain()` is `transport_kick_drain` with a
`module = 'fees'` filter.

New code: `src/lib/whatsapp/provider.ts` (a `WhatsAppProvider` interface),
`src/lib/whatsapp/metaCloud.ts` (the Cloud API implementation), credentials in
the admin-only `integration_secrets` table under key `whatsapp` — **never** in
world-readable `site_settings`, following the `payment_secrets` precedent.

### API

`POST /api/fees/cron/drain` (claims a batch `FOR UPDATE SKIP LOCKED`, sends,
records provider message ids), `GET|POST /api/whatsapp/webhook` (Meta's hub
challenge on GET; delivery/read receipts and inbound STOP on POST, signature-
verified with the app secret), `POST /api/fees/reminders/send`,
`GET /pay/[token]` + `POST /api/fees/pay/[token]` — the public, no-login payment
page behind a tokenised, expiring, revocable link.

### UI

- **Concessions**: discount types with the rule builder, a per-invoice apply
  sheet, the approval queue, scholarship budgets, the waiver workflow.
- **Charges**: fine categories and the "separate slip or add to a bill the
  guardian is already paying?" choice; the late-fee rule builder with its live
  sample; the sweep with its preview; a central overdue view showing what has
  been charged, who is exempt, and a Nudge button.
- **Collections**: a dashboard of every family with dues, sorted by most
  overdue — days late, amount, last reminded. Remind one, a class, or everyone;
  or schedule it for a future date and time. Reminders skip anyone who has
  already paid. A reminder log shows, per message, who it went to and whether it
  was delivered and read; the whole "reminder story" for a family is one click.
  *Per your instruction there is no escalating tone* — one respectful template,
  with frequency and send time configurable.
- **Fee Settings → WhatsApp** goes live: paste the five credentials, run a test
  send, watch it go sent → delivered → read in the panel.

**Done when** a guardian with no app receives their child's bill on WhatsApp,
taps Pay, pays by UPI, and the receipt arrives on the same thread within
seconds — while the reminder log shows sent → delivered → read → paid, and a
bill settled that morning got no message at all.

---

## Round 4 — The Collection Center, the edges, and search

**Goal.** One screen that answers "how are we doing, and where is the money
stuck?", and the awkward real-world cases that break simpler software.

### Schema — `fee_r4_edge.sql`

```sql
fee_refunds          (student_id, academic_year_id, amount, reason, source_payment_id,
                      status requested|approved|declined|paid_out, method, reference,
                      requested_by, approved_by, approved_at, paid_by, paid_at)
fee_opening_balances (student_id, academic_year_id, amount, source_year_id, note)
fee_rte_register     (student_id, academic_year_id, category, claim_period,
                      claimed_amount, reimbursed_amount, reimbursed_on,
                      government_ref, status)
```

### Schema — `fee_r4_reporting.sql`

Views (materialised where the cost justifies it, refreshed by pg_cron):
`fee_collection_daily`, `fee_outstanding_aging`, `fee_defaulters_by_class`,
`fee_concession_summary`, `fee_instrument_pipeline`, `fee_staff_collection`.
All of them read `fee_ledger_entries`, so no report can disagree with another.

### UI — `/more/fees/reports`

Four headline numbers always on screen: **Collected · Outstanding · Collection
Efficiency · Today's Collection**. The efficiency bar carries a **session-progress
marker** derived from `academic_years.starts_on/ends_on` — 62% collected means
nothing until you can see the year is 50% gone.

- **Overview** — the money equation stated plainly:
  `(Gross + Late fees + Fines + Opening balance) − (Discounts + Scholarships + Waivers) = True payable`,
  collected against it, what is left, and a Today Live feed of money landing.
- **Collections** — a year calendar heatmap: daily totals, best days, quiet weeks.
- **Outstanding** — the aging cliff (dues stacked by how late), and a
  class-by-class defaulter heatmap showing not just how much but *where*. Both
  click through to a Remind action.
- **Instruments** — the cheque pipeline by status, monthly collection by staff
  member, the refund queue, and reconciliation.
- **Concessions** — everything given away on purpose, against what fines
  recovered.
- **Operations** — the full audit trail and every message the system sent.

**Global search** — one box over students, invoice numbers, receipt numbers,
UTRs and cheque numbers. Natural-language queries ("which students of class 5
haven't paid?") compile to a **whitelisted query builder** over the reporting
views — never free-form SQL against the database — and every result exports to
Excel through the existing `exportRows` helper.

**Edges** — refunds request → approve → pay out with a configurable approver;
overpayments become credits applied automatically to the next bill; old dues
carried forward as an opening balance on promotion; **collecting for a previous
year** by switching the year scope, which lands the payment in the right year's
records (this is where Round 1's academic-year work pays for itself); and an RTE
register that prepares government claims and records reimbursements.

**Done when** on 1 October the Collection Center reads 62% collected with the
session marker at 50%, the Outstanding tab names the three classes carrying 40%
of the dues, one click reminds all of them, the Operations tab shows exactly who
sent it — and a masked user sees the same charts and counts with dots where the
rupees are, with nulls in the network response.

---

## Where this goes beyond the brief

Ten things worth adding that the source study does not have:

1. **A real academic-year entity.** Explicit start and end dates, an active flag,
   a closed state, and promotion carry-forward — replacing three disagreeing
   client-side guesses and five independent year pickers.
2. **An append-only double-entry ledger.** "The money story always adds up" as a
   database invariant, not a claim a report makes.
3. **Tamper-evident receipts.** A SHA-256 over the canonical receipt payload, the
   `payroll_lock_run` idea applied to a receipt. The QR verifies the content, not
   just the existence of a row.
4. **28 permissions, not 17**, with a coverage check that answers "who can
   reverse a payment?" in one screen — and masking enforced by database views,
   so the number genuinely never reaches the browser.
5. **One engine behind every preview.** The late-fee builder's live sample, the
   sweep preview and the nightly job are the same function. A preview that lies
   is worse than no preview.
6. **Tokenised pay links that expire and can be revoked**, with open and pay
   tracking, so a forwarded WhatsApp message is not a permanent payment portal.
7. **Bank reconciliation.** Import a bank statement, match against receipts,
   work an unmatched queue. Not in the source study, and the first thing an
   auditor asks for.
8. **An exception board for every bulk action** — missing guardian phone, no
   WhatsApp opt-in, duplicate admission number, negative balance, no fee group —
   surfaced before the run, not discovered after.
9. **Transport folded into the same ledger**, so a family gets one bill and the
   Collection Center is not silently under-reporting by whatever the buses take.
10. **Tests from Round 1.** The payroll module reached 144; the fee module starts
    with them rather than retrofitting.

---

## What you need to do — WhatsApp (Meta Cloud API)

I will build the adapter, the settings panel, the webhook route, the templates
and the outbox worker before you touch any of this. Until credentials exist the
system queues messages and the panel shows which of these steps is outstanding.
When you paste the credentials, the queue drains. Nothing below is blocking for
Rounds 1–2.

**Budget ~45 minutes of your time, plus 1–5 business days of Meta's.**

1. **Meta Business Account.** Go to `business.facebook.com`. Create a Business
   Portfolio for the school if you have none. Note the Business Portfolio ID.
2. **Business verification.** Business Settings → Security Centre → Start
   Verification. You will need the school's certificate of registration (or GST
   certificate), a document showing the legal name and address (a utility bill
   works), a business phone number and a website. This takes 1–5 business days
   and everything else waits on it, so start here.
3. **Create a Meta app.** `developers.facebook.com` → My Apps → Create App →
   type **Business** → link it to the portfolio from step 1. Note the **App ID**
   and, under Settings → Basic, the **App Secret**.
4. **Add the WhatsApp product** to the app. Meta gives you a test number —
   ignore it, it can only message five whitelisted contacts.
5. **Add the school's real number.** WhatsApp → API Setup → Add phone number.
   ⚠️ The number must **not** already be registered on WhatsApp or WhatsApp
   Business. If it is, delete that account in the WhatsApp app first and wait
   about 30 minutes. Verify by SMS or voice call. Set the **Display Name** to the
   school's actual name — Meta reviews it and rejects anything that is not the
   real business name.
6. **Copy two IDs** from the API Setup screen: the **Phone Number ID** and the
   **WhatsApp Business Account ID (WABA ID)**. These are not the phone number
   itself.
7. **Create a permanent token.** Business Settings → Users → System Users → Add →
   name it `eduberry-whatsapp`, role **Admin** → Generate New Token → select your
   app → tick **`whatsapp_business_messaging`** and **`whatsapp_business_management`**
   → set expiry to **Never** → Generate. **Copy it now**; Meta never shows it
   again. (A token from the API Setup screen expires in 24 hours — do not use
   that one.)
8. **Assign the WABA to the system user.** Business Settings → Accounts →
   WhatsApp Accounts → select your WABA → Add People → your system user → grant
   **Full control**. Skipping this is the single most common reason a valid
   token returns "object does not exist".
9. **Add a payment method.** Business Settings → WhatsApp Accounts → Payment
   Settings. Without it, sending stops once the free tier is used. Utility
   conversations in India are currently a fraction of a rupee each; a 900-student
   school sending bills, receipts and two reminders a term will not be a
   meaningful line item.
10. **Create six message templates.** WhatsApp Manager → Message Templates →
    Create. Set category to **Utility** for every one — not Marketing (utility is
    cheaper and is not subject to marketing opt-outs). Approval is usually under
    an hour. Names must match exactly:

    | Template name | Used for |
    |---|---|
    | `fee_invoice_issued` | A new bill, with a Pay button |
    | `fee_payment_receipt` | Receipt straight after a payment |
    | `fee_reminder_due` | Due date approaching |
    | `fee_reminder_overdue` | Past due |
    | `fee_cheque_bounced` | Cheque returned, bill reopened |
    | `fee_concession_applied` | A discount, scholarship or waiver was applied |

    I will give you the exact body text and the placeholder order for each, in a
    copy-paste block, when Round 3 starts — the placeholder order has to match
    `message_templates.variable_order` in the database, and I set both.

11. **Point the webhook at us.** In the app → WhatsApp → Configuration →
    Callback URL: `https://<your-domain>/api/whatsapp/webhook`. Verify Token:
    any random string you invent — save the same string in step 12. Subscribe to
    the **`messages`** field. The route will already be live and answering Meta's
    challenge, so this verifies first try.
12. **Paste five values into the app.** Admin Space → Fee Settings → WhatsApp:
    Phone Number ID, WABA ID, permanent token, verify token, app secret. These
    save to `integration_secrets` (admin-only, never world-readable).
13. **Send a test.** The same panel has a "Send test message" box. Enter your own
    number; you should see it move sent → delivered → read in the panel within a
    few seconds.

**A note on opt-in.** Guardians gave you their numbers at admission, which is a
legitimate business relationship under Meta's policy for utility messages. The
system still records `student_details.whatsapp_opt_in_at` (the column already
exists) and honours an inbound STOP by writing `whatsapp_numbers.opt_out_at` and
skipping that number thereafter. That is both the right thing and what keeps the
number's quality rating healthy.

## What else needs you (smaller)

- **Razorpay live keys.** You are on `rzp_test_Su2j3V3UArxOBq` today. Live keys
  go in Fee Settings → Collection; the secret lands in `payment_secrets`, never
  in `site_settings`. Not needed until Round 3's pay links.
- **A thermal printer**, if you want counter slips. Any 58 mm ESC/POS printer
  over USB or Bluetooth. Round 2 ships the layout; you only need to plug one in.
- **The school's legal name, address and logo** for the invoice letterhead —
  `site_settings.branding` already holds a logo URL; I will use it and ask for
  the rest when Round 2 starts.
- **Confirm the receipt number format** you want (default:
  `MPS/26-27/0001`, resetting each academic year).

---

## Which model for which round

Use **Opus for Round 1, and for the money-touching parts of Round 2**; use
**Sonnet for the bulk of Rounds 2–4**, with Opus reviewing each round before it
merges.

The split is not about difficulty, it is about blast radius:

- **Round 1 is Opus work.** The permission model, the masking views, the
  academic-year cutover and the engine contracts are decisions every later round
  inherits. Getting `has_fee_permission` or the year FK shape wrong is a rewrite,
  not a fix.
- **Round 2 splits.** The ledger invariants, payment allocation, numbering under
  concurrency and the reversal path are Opus; the ten profile tabs, the invoice
  list, the counter sheet and the PDF documents are Sonnet work once the schema
  and the engine signatures are frozen.
- **Rounds 3 and 4 are mostly Sonnet.** By then the contracts exist and the work
  is screens, CRUD and wiring against a settled engine — which is exactly what
  Sonnet is fast and reliable at. Keep Opus for `engine/latefee.ts` and the
  natural-language query compiler, where a subtle error is a wrong charge or an
  injection.
- **Review every round with Opus** against this document's "Done when" line
  before merging. That is cheap and catches drift.

---

## Risks and how they are handled

- **Four rounds is an honest map, not a short build.** Each round is several
  sessions of work. They are sized to be independently shippable, so the module
  is useful after Round 2 even if 3 and 4 slip.
- **The academic-year cutover touches homerooms, certificates, timetable and
  classrooms**, not just fees. Round 1 adds `academic_year_id` FKs *alongside*
  the existing text columns and leaves the text in place, so nothing outside
  fees changes behaviour until it is ported deliberately.
- **The bus merge could break the bus screens.** It ships behind compatibility
  views with the same names and columns, and both tables are empty today, so the
  worst case is a view definition to fix rather than data to recover.
- **Masking via views must not be routed around.** Round 1 sets base-table RLS to
  require `fees.view` and puts every client read through the `_v` views; any new
  query that reads a base table directly is the one way this leaks, so it is
  called out in the round's review checklist.
- **WhatsApp number quality rating.** Sending too much too fast to numbers that
  block you gets a number throttled or flagged. Reminders default to
  conservative frequency, honour STOP, skip anyone already paid, and the
  Collections dashboard shows the reminder history before a blast.
- **`SECURITY DEFINER` functions must not become a back door.** Every new one
  follows the repo's existing convention: `SET search_path = public`, an explicit
  permission check inside, and `REVOKE EXECUTE FROM anon, authenticated` where it
  is not meant to be callable over PostgREST.
- **The old fee page is dead code that still compiles.** It is deleted in Round 2
  when the new hub lands, not left as a second implementation to drift.

## Explicitly out of scope

The parent module and parent app; the multi-child parent dashboard; escalating
reminder tone. All three at your instruction.
