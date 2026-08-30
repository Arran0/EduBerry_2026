# Fee module — data protection and audit posture

What the fee module does about DPDP and CERT-In, and why. Written for whoever
has to answer a question about it, not as a compliance certificate — none of
this is legal advice, and a school still needs its own privacy notice and
consent record outside this system.

---

## 1. What the module holds about a child

| Data | Where | Why it is needed |
|---|---|---|
| Name, class, section | `profiles`, `homerooms` | Identifies whose fee it is; class drives the fee structure |
| Admission number | `student_details` | Printed on receipts, which schools are asked to reissue years later |
| Fee category, transport zone, sibling rank, staff-ward flag | `student_details`, `fee_family_members` | The engine's inputs. Without these a concession is typed by hand and cannot be explained |
| Amounts billed, paid, refunded | `school_fees`, `fee_transactions` | The point of the module |
| Payer identity and contact | `fee_families`, `profiles` | Who may pay, and who to tell about an unpaid fee |

The module does **not** hold, and does not ask for: card numbers, UPI PINs, bank
account numbers of parents, or any payment instrument detail. Card and UPI
credentials never touch this system — Razorpay Checkout collects them on its own
origin and returns a token. The only bank references stored are the school's own
account settings and the gateway's opaque payment ids.

Aadhaar sits in `student_details.aadhaar_no` from the certificates module, which
predates this work. It is **not read by anything in the fee module**, and it
should not be: nothing about billing a fee requires it.

## 2. Data minimisation, where it actually bites

**Notifications.** A push notification renders on a lock screen that anyone
standing nearby can read. So a fee reminder carries the child's **first name**,
an amount, and a link — never the full name, class, admission number, or fee
breakdown. Composing that is `src/lib/fees/notify/templates.ts`, and the
first-name reduction happens in the scheduler
(`api/fees/reminders/schedule/route.ts`, `firstNames()`) rather than being left
to each template to remember.

**The audit log.** `fee_audit_log` records the **changed fields only**, never the
whole row — `diffFields()` in `src/lib/fees/audit.ts` and the SQL trigger in
`fees_v2_rbac_audit.sql` both compute a diff. An audit log that copies every
column of every write becomes a second, less-protected copy of the student
database, and it is a copy nobody remembers to protect.

**The accounting export.** It leaves the building with names and amounts in it,
so producing one is itself an audited action (`accounting.export`). It carries
names and amounts and nothing else — no contact details, no category, no
admission number.

## 3. Parental consent

`fee_families.consent_given_at` and `consent_by` record that a parent consented
to processing for fee purposes, and when. **Absence of a row is not consent** and
the schema does not default it to anything.

This is a hook, not a complete consent-management implementation. What is
deliberately not built here:

- a consent-notice UI, or versioned notice text a parent agreed to
- withdrawal of consent and what the module should then stop doing
- a Consent Manager integration under the DPDP Act's framework

Those are a product decision about how the school communicates with parents, not
something to guess at inside a fee module. What is here is the column to write
to and the RLS to read it, so adding the flow later does not need a migration.

**Notification opt-out is implemented** (`fee_notification_prefs`): a family that
has opted out is skipped by the scheduler, and the absence of a preference row
defaults to the conservative pair (push and in-app) rather than every channel.

## 4. Who can see what

RLS is on every fee table. The pattern throughout:

- **Admins** manage everything, via `public.get_user_role() = 'admin'`.
- **Students and linked payers** read their own fees, payments, receipts,
  approved concessions, refunds and mandates — and nothing else. A parent must
  be able to verify their own money without asking the office, and a discount
  they cannot see is one they cannot check.
- **The ledger has no INSERT/UPDATE/DELETE policy for any role.** Every write
  goes through a service-role route that has already decided the money is real.
- **The audit log has no INSERT policy for any role.** A log its own subject can
  write is not evidence.

`requirePayerFor()` in `src/lib/fees/serverGuard.ts` is the one place that
decides whether a caller may act on a given fee: the student, an admin, or a
profile recorded as a **payer** on the same family. A sibling is in the family
too and is deliberately not a payer.

## 5. Retention

| Table | Kept | Reason |
|---|---|---|
| `fee_audit_log` | **180 days** | CERT-In's direction on log retention |
| `fee_webhook_events` | 90 days, processed only | Exists to replay a failed match and answer "did the provider send it" — both have a short useful life |
| `fee_notifications` | 365 days, terminal states only | Queued rows are **never** pruned: a message stuck in the queue is a bug somebody needs to see |
| `fee_transactions` | **Never pruned** | Financial record, not a log. Governed by much longer statutory retention, and the module's whole design rests on it being permanent |
| `fee_refunds`, `fee_refund_events`, `fee_approvals`, `fee_receipts` | Never pruned | The story of a decision about money |

Scheduled by pg_cron in `fees_v2_rbac_audit.sql`, following the pattern
`enable_pg_cron_and_schedule_retention.sql` already established. The jobs are
unscheduled before being re-created so re-running the migration does not stack
duplicates.

## 6. Integrity

- **`fee_transactions` cannot be updated or deleted.** A `BEFORE UPDATE OR
  DELETE` trigger raises unconditionally. A correction is a compensating row,
  which leaves both the error and the correction on the record.
- **`fee_audit_log` and `fee_refund_events` are append-only** by the same
  mechanism.
- **Published fee structures and issued receipts are frozen.** Changing one
  means a new version or a reissue, both of which keep the original findable.
- **Maker–checker is enforced by database triggers**, not by the API: the person
  who requests a concession or a refund cannot approve it, and a compromised
  session cannot route around a trigger.
- **Audit triggers are a backstop, not the primary record.** The API routes
  write their own audit entries with the real actor; the triggers catch a direct
  SQL correction, a Supabase-dashboard edit, or a code path added later that
  forgets. Under the service role `auth.uid()` is NULL, and the trigger records
  that honestly rather than inventing an actor.

## 7. Secrets

No credential is committed. Razorpay keys, bank signing secrets and VAPID keys
are read through `getPaymentSecrets()` from the `payment_secrets` table (per
tenant, admin-configured) with an environment-variable fallback for single-tenant
deployments.

Places a real secret is required, none of which have been exercised in this work:

| Needs | For |
|---|---|
| `RAZORPAY_KEY_ID` / key secret | Orders, QR codes, refunds |
| Razorpay webhook secret | Signature verification |
| A subscription-enabled Razorpay account | UPI Autopay — **untested**, see `docs/fees/deferred.md` |
| Bank collection signing secret | NEFT/IMPS reconciliation |
| `FEE_CRON_SECRET` | Letting pg_cron call the reminder routes |
| A WhatsApp BSP, SMS gateway or email provider | Any channel other than push — **none configured** |

## 8. What a security review should look at first

1. `src/lib/fees/webhook.ts` — signature verification over the raw body, and the
   two idempotency layers.
2. `src/lib/fees/serverGuard.ts` — `requirePayerFor` and `requireCapability`.
3. The RLS policies in `fees_v2_ledger.sql` — specifically the absence of a
   write policy on `fee_transactions`.
4. `supabase-migrations/fees_v2_refunds_audit.sql` — the over-refund cap and the
   maker–checker triggers.
