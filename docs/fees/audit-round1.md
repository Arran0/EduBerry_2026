# Fee module audit — Round 1 baseline

What the fee module is before the Revenue OS work starts, what it gets wrong, and why
each table in `fees_v2_*.sql` exists. Everything below is cited to a file and line at the
commit this document was written against (`355d332`, branch `payroll-v2-engine`).

---

## 1. Current schema

Three tables, all created by `supabase-migrations/add_fee_manager.sql`, extended by
`add_fee_statements.sql` and `fix_student_fee_payment_visibility.sql`.

### `fee_heads` — the catalogue
`id, name, description, default_amount NUMERIC(10,2), active, created_by, created_at, updated_at`

A flat list of labels with a default amount. No code, no kind, no frequency, no
refundability, no ledger account. It cannot express "Tuition is billed per term, Transport
depends on zone, the Caution Deposit is refundable on exit".

### `school_fees` — the demand line
`id, fee_head_id, student_id, amount, description, due_date, status, academic_year,
upi_reference, created_by, timestamps`

One row per student per fee, `status ∈ {unpaid, partial, paid, cancelled}`. `upi_reference`
defaults to `'SCHFEE-' || gen_random_uuid()` so each row has a unique payment reference.
`academic_year` ('YYYY-YY', Apr–Mar) was added later and backfilled.

### `school_fee_payments` — everything else
`id, fee_id, payer_id, method, amount, status ∈ {pending, verified, failed},
razorpay_order_id, razorpay_payment_id, razorpay_signature, upi_txn_ref,
provider, collect_vpa, provider_ref, utr, verified_by, verified_at, timestamps`

A unique partial index on `utr` prevents double-crediting the same bank settlement — the
only idempotency guarantee anywhere in the module today.

### The bus mirror
`bus_fees` and `bus_payments` (`add_bus_manager.sql:210,247`) plus `bus_fee_heads`
(`add_bus_fee_heads.sql`) duplicate this structure almost line for line, with their own
copies of the same API routes and the same defects.

---

## 2. Current payment integration

| Route | What it does |
|---|---|
| `POST /api/fees/razorpay/create-order` | Authenticates the caller, checks the fee is theirs, computes outstanding, creates a Razorpay order, inserts a `pending` payment row keyed by `razorpay_order_id`. |
| `POST /api/fees/razorpay/webhook` | Verifies the HMAC over the raw body, acts only on `payment.captured`, flips the payment to `verified` and the fee to `paid`. |
| `POST /api/fees/upi/create-collect` | Bank **Smart Collect**: allocates a per-fee virtual VPA / virtual account (or uses the school VPA + the fee's unique reference), inserts a `pending` payment row. |
| `POST /api/fees/upi/webhook` | Bank credit notification. Matches by `collect_vpa`, `provider_ref` or `upi_reference`; guards on `utr`; flips payment to `verified` and fee to `paid`. |

`src/app/api/bus/**` mirrors all four.

### A naming correction worth recording
`upi/create-collect` is **not** NPCI UPI Collect. UPI Collect is a *pull* — the payee
raises a collect request that lands in the payer's app for approval, and it is that flow
which is being withdrawn for most merchant use cases. What this route implements is a
*push* flow: the parent scans a QR or pays to a virtual VPA and the bank notifies us.
Virtual-account/virtual-VPA reconciliation is not deprecated.

What *is* the deprecated-shaped pattern here is the **manual fallback** in
`PaySchoolFeeModal.tsx:112` — when the bank connection is off, the modal renders a static
UPI intent QR pointing at the school's own VPA via `buildUpiLink`, with the office
confirming receipt by hand. That is a P2P handle doing merchant collection with no
gateway-side record, and it is what Round 1 removes.

---

## 3. Defects

Each of these is a present-tense bug in code that ships today, not a design preference.

### D1 — A partial online payment marks the whole fee paid
`src/app/api/fees/razorpay/webhook/route.ts:110` sets `school_fees.status = 'paid'`
unconditionally on capture.

`create-order` deliberately charges only the outstanding balance
(`razorpay/create-order/route.ts:74-84`), so a parent clearing ₹2,000 of a ₹10,000 fee
creates an order for ₹2,000 — and the webhook then marks the entire ₹10,000 fee paid. The
school loses ₹8,000 of demand with no error anywhere.

The same line exists in:
- `src/app/api/fees/upi/webhook/route.ts:96`
- `src/lib/fees.ts:421` (`verifyPayment`, admin confirming a UPI claim)
- and all three bus equivalents.

`recordOfflinePayment` (`src/lib/fees.ts:442`) is the *only* write path that does the
arithmetic correctly — it re-sums verified payments and picks `paid` vs `partial`. That
logic needs to be the one shared implementation, not the exception.

### D2 — Webhook idempotency is a status read, not a key
`razorpay/webhook/route.ts:104` guards with:

```ts
if (payment.status === 'verified') return NextResponse.json({ ok: true, already: true })
```

Razorpay retries on any non-2xx and can deliver the same event more than once regardless.
Two concurrent deliveries both `SELECT` the row while it is still `pending`, both pass the
guard, and both proceed. Today the second write is merely redundant because the update is
idempotent in shape — but the moment a webhook writes a ledger row or triggers a
notification, it double-counts. There is no unique key on the event and no unique key on
the credit.

The bank webhook's `utr` check (`upi/webhook/route.ts:66`) is the correct shape, and is
the only place that has it.

### D3 — The raw webhook event is discarded
Neither webhook persists the payload. Consequences:
- A parse or matching failure is unrecoverable — the event cannot be replayed.
- "Razorpay says they sent it, we have no record" is unanswerable.
- Signature-verification failures leave no forensic trace at all.

### D4 — There is no ledger, and status changes destroy history
`school_fee_payments` is three things at once: the payment *intent* (order created), the
*state machine* (`pending → verified`), and the *record that money arrived*. Every
transition is an in-place `UPDATE`.

So there is no row in the database that says *"₹4,500 arrived at 14:32 on 12 Aug, Razorpay
payment `pay_XYZ`, UTR `123456789012`"* and cannot be altered. An admin with table access —
or a bug — can move a verified payment back to `pending`, change its amount, or delete it,
and nothing anywhere records that it happened. Collection reports, receipts and statements
are all derived from this mutable row.

This is the single most important gap. Everything about reconciliation, refunds and
audit rests on fixing it.

### D5 — Refunds do not exist
No table, no route, no UI, no concept. `fee_status` has `cancelled`, which zeroes the
demand but says nothing about money that was already collected and must go back. A school
refunding a caution deposit or a withdrawn student's term fee has no way to record it
except deleting or editing rows — which D4 makes untraceable.

### D6 — Money decisions are made by the browser
`verifyPayment`, `rejectPayment` and `recordOfflinePayment` (`src/lib/fees.ts:421-478`)
run in the client against the anon key, relying entirely on the
`"Admin manage school fee payments"` RLS policy. RLS does correctly restrict *who* may
write, but it cannot enforce *what a valid state transition is*: a compromised or merely
buggy admin session can insert a `verified` payment for any amount against any fee, and
that write is indistinguishable from a legitimate one.

### D7 — No fee rules
`school_fees` rows are created by `createFeesBulk` (`src/lib/fees.ts:334`) iterating
homeroom members and inserting the same typed amount for each. Class, student category,
sibling rank, transport zone and concessions are not inputs to anything; an admin resolves
them mentally and types the result. Nothing records *why* a student owes what they owe, so
a disputed amount cannot be explained and a mid-year rule change cannot be applied without
editing rows by hand.

### D8 — No audit trail on fee-affecting actions
Fee heads, amounts, concessions (which don't exist yet), cancellations and verifications
are all plain `UPDATE`s. `created_by` and `verified_by` capture two moments; nothing
captures who changed an amount, when, or from what.

---

## 4. Gaps against the target design

| Requirement | Today | Round 1 |
|---|---|---|
| Immutable record of money received | none — mutable status row | `fee_transactions`, UPDATE/DELETE blocked by trigger |
| Idempotent webhook | status check, racy | `fee_webhook_events.event_id` UNIQUE + `fee_transactions.idempotency_key` UNIQUE |
| Raw event durability | discarded | insert-first, process-second |
| Correct partial handling | one of six write paths | one `applyLedgerToFee()`, called by all |
| Refunds | absent | `fee_refunds` + `fee_refund_events` + ledger debit |
| Fee rules | absent | structures, policy groups, concessions, `rule_trace` |
| Audit | absent | `fee_audit_log`, append-only |
| Server-authoritative money writes | client-side | routes behind `requireAdmin` |
| Parent UPI | static P2P QR to school VPA | Razorpay UPI Intent + dynamic QR |
| Bank/NEFT reconciliation | Smart Collect, conflated with initiation | `bank/webhook`, reconciliation-only |

---

## 5. Design decisions and their reasons

**The ledger is append-only with no unlock.** Payroll v2 makes a run immutable once
`locked` (`payroll_v2_runs.sql:211`). Money received has no equivalent of a draft state —
it either arrived or it did not — so `fee_transactions` has no unlocked phase at all. A
mistake is corrected by a compensating row, which leaves both the error and the correction
on the record. That is the property an auditor actually wants.

**`school_fee_payments` stays, and stays mutable.** It is the payment *attempt*: order
created, pending, captured, failed. Attempts legitimately change state. Separating the
attempt from the ledger entry is what lets the ledger be immutable without breaking the
gateway flow — and it means every existing read path in `fees.ts`, the collection report
and the statements keeps working untouched.

**Idempotency is keyed twice, at different layers.** `fee_webhook_events.event_id` stops
duplicate *deliveries*; `fee_transactions.idempotency_key` stops duplicate *credits*
however they arise (a replay, a retry, two routes racing). Under concurrency the second
writer loses on a unique constraint rather than on a `SELECT` it already passed.

**`school_fees` is extended, not replaced.** It becomes the generated demand line —
`gross_amount`, `concession_amount`, `net_amount` and a `rule_trace` explaining each — with
`amount` continuing to mean net payable. Existing invoices, receipts, statements and
reports need no migration.

**The engine is pure.** No Supabase import, no clock read, same rule as
`src/lib/payroll/engine/`. It is the only way the rules are testable without a database,
and the payroll engine's test suite is the proof that it works.

**Nothing is written twice that already exists.** The formula parser
(`payroll/engine/expr.ts` — deliberately not `eval`, because admins author formulas in a
web form), the rounding rules (`payroll/engine/money.ts`), the cohort-precedence resolver
(`payroll/engine/resolvePolicy.ts`), the admin route guard
(`payroll/serverGuard.ts`) and the xlsx writer (`feeExports.ts`) are all imported.
