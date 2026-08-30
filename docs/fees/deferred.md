# Fee module — what is deliberately not built

Gaps left open on purpose, with why, so a future round starts from a decision
rather than a rediscovery. Split into "shipped but unverified", "the next
obvious round", and "deliberately out of scope".

---

## 1. Shipped but not verified end to end

These exist in the codebase and typecheck, but could not be exercised. Nobody
should assume they work until somebody runs them against a live account.

### UPI Autopay / eMandate — the significant one
`supabase-migrations/fees_v2_mandates.sql`, `src/app/api/fees/mandate/route.ts`.

Schema, consent posture and route are complete. The registration path **cannot
be tested without live Razorpay credentials**: UPI Autopay needs a
subscription-enabled account and there is no sandbox that mints a real mandate.

What *is* already proven is the half that matters most: a successful debit
arrives as an ordinary `payment.captured` webhook, so it reconciles through the
same idempotent path and the same immutable ledger as every other payment. The
money side is not mandate-specific. What remains unproven is plan/subscription
creation, the authorisation link, and the pre-debit notification NPCI requires.

Before relying on it: create one mandate on a test account, confirm the
`subscription.authenticated` and `subscription.charged` webhook events (neither
is currently handled — they need adding to `dispatchRazorpayEvent`), and check
that a debit lands on the right fee.

### Razorpay dynamic QR
`api/fees/pay/intent` calls `razorpay.qrCode.create`. QR codes are a
per-account feature and may be off. The route treats a QR failure as
non-fatal — checkout still works and the parent is simply not offered a QR — so
a school without it degrades rather than breaks. Untested against a live
account.

### Gateway refunds
`api/fees/refunds/[refundId]/decide` calls `razorpay.payments.refund` and moves
to `processing`, with the ledger debit written by the `refund.processed` webhook.
The manual path (cash, cheque, bank transfer) is fully exercised by the
arithmetic tests; the gateway path is not.

### The migrations themselves
Six SQL files, written against the existing schema and its conventions but **not
executed** — no Supabase project was touched. Run them on a branch and check, in
particular:

- the `btree_gist` exclusion constraint on `fee_structure_assignments`
- the `days_past_grace` function being created before the views that use it
- the backfill in `fees_v2_ledger.sql`, which re-derives every fee's status from
  the ledger and will correct rows the partial-payment bug mislabelled — worth
  eyeballing the diff before running it on production data

### The reminder cron
`fees_v2_rbac_audit.sql` schedules the retention jobs, but the reminder
scheduler and sender are HTTP routes and pg_cron has to reach them via
`FEE_CRON_SECRET`. That wiring is not in a migration because the deployment URL
is environment-specific. Until it is set up, reminders run from the button on
the Arrears tab.

---

## 2. The next obvious round

### Notification channels
Push is implemented; WhatsApp, SMS and email are adapters that report themselves
unconfigured. For an Indian school WhatsApp is the channel that actually
collects money, and it needs: a BSP account, a verified sender, and **approved
utility templates** — a fee reminder cannot be free text. The template strings in
`src/lib/fees/notify/templates.ts` were written with that approval in mind
(short, factual, no marketing) but have not been through it.

SMS additionally needs DLT registration of both sender id and template under
TRAI rules. Neither is a code problem.

### Bus fees are still a separate demand model
Bus and school post into the same ledger, share the webhook layer, refunds and
audit, and the dashboard covers both. But `bus_fees` keeps its own issuance UI
and is not driven by the rule engine — a transport fee banded by zone exists as
a `transport` fee head in the engine *and* as a bus fee, and a school could
double-bill by using both. Worth resolving; a full merge was scoped and
deliberately deferred as too much Round 1 risk.

### The demand run has no UI
`api/fees/demand-runs` (create, calculate, publish) is complete and enforces the
review gate, but nothing calls it yet. Fees are still issued through
`IssueFeeModal`, which bypasses the engine entirely. The engine's value is not
realised until a school can build a structure and run a term from it — this is
the single biggest gap between what is built and what is usable.

Needs: a structure editor (heads, slabs, formulas, instalment plans), a policy
group editor, and a run screen showing the computed lines with their exceptions
before publishing.

### Concession approval queue
The schema, the maker–checker trigger and the request path exist.
`requestConcession()` writes a pending row; nothing surfaces the queue or calls
an approve route. A concession therefore currently has to be approved in SQL.

### Receipt PDF
`api/fees/receipts` issues a numbered receipt with a frozen snapshot, but
rendering it uses the existing `@react-pdf/renderer` statement machinery in
`src/components/fees/statements/`, which has not been pointed at the new
snapshot shape.

---

## 3. Deliberately out of scope

### Live Tally / Zoho API integration
Both need per-school credentials — Tally's HTTP listener on the school's own
network, Zoho's OAuth — so this produces a file the accountant imports. The
builders in `src/lib/fees/accounting/tally.ts` are pure and would serve a push
integration unchanged when those credentials exist.

### Board- and state-specific fee workflows
Not attempted, and each is a real body of rules rather than a setting:

- **RTE 25% quota reimbursement** — state-level claim formats and timelines, and
  a reconciliation against what the state actually pays. The `rte` concession
  category exists; the claim process does not.
- **Fee Regulatory Committee filings** — several states require prior approval
  of a fee structure and a filing in a prescribed format. `fee_structures` is
  versioned and dated in a way that would support this; nothing generates a
  filing.
- **CBSE/state audit formats** — the export is Tally/Zoho-shaped, not
  board-shaped.

### Pricing and packaging
Nothing in this module knows about tiers, per-student pricing, or a transaction
fee the school passes on to parents. Convenience-fee pass-through in particular
would change what `pay/intent` charges and what the receipt says, and it has
regulatory constraints worth deciding deliberately rather than inheriting.

### Multi-branch / trust-level consolidation
A trust running four schools sees four separate installations. The ledger's
`source` column would generalise, but nothing else does — RLS is school-wide
throughout, and there is no tenant column.

### Instalment-level part payment
A parent can pay part of a fee where the structure allows it, but cannot choose
*which instalment* to pay when several are outstanding — the oldest is not
automatically prioritised, and the UI does not offer a choice. For a school
billing three terms this will come up in the first year.
