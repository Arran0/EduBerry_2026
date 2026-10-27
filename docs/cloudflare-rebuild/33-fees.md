# Fees

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). The business design, invariants and round history are in `docs/fee-upgrade-plan.md` (rounds 1–4 delivered, then the `fee_v2`–`fee_v5` migrations); this doc covers what has to move and how. Bank collection, UPI, Razorpay settlement and webhooks shared with payroll are in [35-bank-collections-and-payouts.md](35-bank-collections-and-payouts.md).

## 1. Summary

The fee app bills students and collects money: a price grid (terms and monthly heads × grade or grade group × gender), one-off charges and fines, optional fees with opt-ins, concessions and scholarships with approval thresholds, late-fee rules, issuing bills in bulk with a lock and an undo, a collection counter (cash, cheque, DD, card, bank, UPI), online payment by Razorpay (bank UPI collection exists but settles only into the empty first-generation tables, see [35](35-bank-collections-and-payouts.md)), receipts with a QR that verifies publicly, refunds, credits, cheque life-cycles, RTE reimbursement register, carry-forward between sessions, WhatsApp reminders with expiring pay links, a bills register, reports and exports. Bus fees are billed as ordinary fee bills under a transport head.

It is the module with the strictest rules, and the one where Postgres features carry the most weight today: 83 functions, 14 reporting views, append-only triggers, row locks for receipt numbers, and amount masking inside views.

What changes: every rule stays, but it moves from PL/pgSQL into one TypeScript fee module whose methods each run as a single transaction in the school object, so the locking that numbering and allocation need comes for free. Money becomes integer paise everywhere. Masking happens in the module's response shaping. The existing pure engine (`src/lib/fees/engine/`: allocation, late fee, schedule, proration, money, words; with tests) moves unchanged into `packages/shared` and is called by the object.

Live: 49 invoices, 4 payments, 80 ledger entries, 102 fee profiles, 196 role grants, 27 reminder log rows; the module is configured but early in real use.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/more/fees` (262 lines) | Admin; students | Fee hub with tabs and sections (collection, grid, charges, concessions, reports, settings); students see their own bills and pay |
| `/more/fees/students/[studentId]` (374 lines) | Admin | One family: bills, ledger, payments, concessions, credits, refunds, messages |
| `/more/fees/downloads` (193 lines) | Admin | Exports |
| `/more/fees/{charges,collections,concessions,config,counter,invoices,reports,settings,students}`, `/admin/fee-settings` | — | Old routes, now redirects into the hub |
| `/pay/[token]` (182 lines) | Parents, no sign-in | Pay link from WhatsApp: shows the bill, pays online |
| `/verify/receipt/[token]` (141 lines) | Anyone | Receipt QR verification (VALID / CANCELLED) |
| Settings (`FeeSettingsPanel`, `src/components/settings/fees/*`) | Admin | Academic years, numbering, payment rules, approval thresholds, reminders, WhatsApp, masking, grace, permissions, bank collection, Razorpay |

About 76 components under `src/components/fees` (grid, issue panel, counter, statements, student pages, reports, reminders) plus `src/lib/fees/*` (bills, charges, grid, invoices, online, onlineSettle, permissions, reports, settings, settleWebhook, serverGuard, razorpayKeys, cache, chunk, config) and the engine.

## 3. How it works today

The flows below are summarised; each is specified in the fee plan.

| Flow | Today |
| --- | --- |
| Price grid | `fee_terms`, `fee_heads` (term or monthly, gender split, optional, transport), `fee_grade_groups` (sections owned by a group), `fee_rates` (row × head × term or month × gender); `fee_rates_guard_lock` stops edits to a cell already issued |
| Issue | `fee_issue_grid` / `fee_issue_charge` / `fee_issue_transport` create one invoice per student for a term or month (or charge) with lines from the grid, inside a lock; `fee_issues` + `fee_issue_cells` record what was issued; `fee_undo_issue` reverses an issue if nothing was paid; `fee_issue_blockers` explains what blocks an undo |
| Invoice maths | `fee_refresh_invoice` recomputes gross, discount, tax, late fee, fine, net, paid, balance and status from lines and allocations (triggers `fee_invoice_lines_refresh`, `fee_alloc_refresh`) |
| Collect | `fee_collect`: allocate an amount across chosen invoices (engine `allocate.ts`), number the receipt from `fee_number_series` under a row lock, insert payment + allocations, post ledger entries, seal the receipt hash, audit |
| Reverse | `fee_reverse_payment`: contra entries, never delete (`fee_payments_immutable`, `fee_payments_no_delete`) |
| Concessions | Request, auto-apply by rule, approve above threshold, remove with reason; always a line on a named invoice |
| Late fees and fines | Rules with grace, rate, frequency, caps, start date; nightly `fee_late_fee_sweep`; waivers with reason |
| Refunds and credits | Request → decide → pay; overpayments become credits consumed later |
| Cheques and DDs | `fee_instruments` with a status timeline (`fee_instrument_transition`), bounce charges |
| Online | `/api/fees/online/order` creates a Razorpay order (`fee_online_orders`); `/api/fees/online/verify` and the Razorpay webhook settle it (`onlineSettle.ts`, `settleWebhook.ts`) |
| Bank UPI | Smart-collect references; `/api/fees/upi/webhook` settles credits into the first-generation `school_fees` tables only, not into `fee_payments` (gap; [35](35-bank-collections-and-payouts.md)) |
| Reminders | `fee_reminder_schedules` (offsets before/after due, send time, channels, quiet days); `fee_reminder_tick` daily at 10:00 IST queues WhatsApp through `notification_outbox`; `fee_message_links` tokens for `/pay/<token>`; `fee_reminder_log` with delivery status |
| Carry-forward | `fee_carry_forward` moves an unpaid balance into the new session as a bill line (v3 fixed double-counting) |
| Autogen and overdue | `fee_autogen_tick` 02:00 IST, `fee_overdue_tick` 02:30 IST |
| Permissions | 28 keys, role grants, user grants; since `fee_restrict_to_admin_and_students.sql` only `admin` resolves any fee permission; students see their own bills |
| Masking | `_v` views return `NULL` for amounts unless `fee_visible_amount()` allows (admin with `fees.view_amounts`, or the row's own student) |
| Reports | 14 views (daily collection, outstanding ageing, defaulters by class, concession summary, instrument pipeline, staff collection, year summary, search index...) |
| Documents | Invoice and receipt PDFs (A4 and 58 mm thermal) rendered in the browser |

## 4. Data

46 `fee_*` tables plus `school_fees`/`school_fee_payments` (first generation, empty) and the shared `academic_years`, `notification_outbox`, `message_templates`, `whatsapp_numbers`. Full columns in [reference/live-schema.md §33](reference/live-schema.md#33--fees). Groups:

| Group | Tables |
| --- | --- |
| Year, access, settings | `fee_permissions`, `fee_role_grants`, `fee_user_grants`, `fee_settings` (versioned, frozen when published), `fee_audit_log` |
| Price list | `fee_categories`, `fee_heads`, `fee_terms`, `fee_months`, `fee_grade_groups`, `fee_rates`, `fee_groups`, `fee_group_assignments`, `fee_structures`, `fee_structure_items`, `fee_installments`, `fee_installment_items` (the last four from the round-1 price list, superseded by the grid but still present) |
| Bills | `fee_profiles`, `fee_issues`, `fee_issue_cells`, `fee_invoices`, `fee_invoice_lines`, `fee_number_series` |
| Money | `fee_payments`, `fee_payment_allocations`, `fee_credits`, `fee_refunds`, `fee_instruments`, `fee_online_orders`, `fee_ledger_entries`, `fee_opening_balances` |
| Adjustments | `fee_discount_types`, `fee_scholarships`, `fee_concessions`, `fee_fine_categories`, `fee_fines`, `fee_late_fee_rules`, `fee_late_fee_charges`, `fee_late_fee_exemptions`, `fee_other_charges`, `fee_other_charge_students`, `fee_optins`, `fee_rte_register` |
| Messaging | `fee_reminder_schedules`, `fee_reminder_log`, `fee_message_links` |

## 5. Logic in the database

All 83 fee functions move into the fee module. The mapping by kind:

| Kind | Functions | Target |
| --- | --- | --- |
| Permission and actor | `fee_actor`, `fee_actor_can`, `has_fee_permission`, `has_fee_permission_for`, `my_fee_permissions`, `fee_requires`, `fee_is_service_context`, `apply_fee_permission_preset`, `fee_guard_permission_lockout` (trigger) | The shared permission module ([12](12-auth-and-permissions.md)); fee keys become ordinary permission keys; the lockout rule is checked in `permissions.save` |
| Masking | `fee_visible_amount` (2), the 14 `_v`/report views | One response-shaping function in the module: amounts removed unless the caller holds `fees.view_amounts` or is the row's own student |
| Issuing | `fee_issue_grid`, `fee_issue_charge`, `fee_issue_transport`, `fee_undo_issue`, `fee_issue_blockers`, `fee_generate_invoices`, `fee_create_profiles`, `fee_ensure_profile`, `fee_row_students`, `fee_clone_grid`, `fee_clone_year`, `fee_set_rates`, `fee_cell_locked`, `fee_rates_guard_lock`, `fee_v2_guard_issued_parent`, `fee_grade_groups_no_overlap`, `fee_months_guard`, `fee_save_charge`, `fee_delete_charge`, `fee_set_charge_optional`, `fee_sync_transport_heads`, `fee_transport_head` | Module methods; large issues (thousands of students) run as a batched job with a preview first |
| Invoice maths | `fee_refresh_invoice`, `fee_invoice_lines_refresh`, `fee_alloc_refresh`, `fee_payment_status_refresh`, `fee_refresh_structure_total` | One `recalcInvoice(id)` called by every method that changes lines or allocations |
| Money movement | `fee_collect`, `fee_reverse_payment`, `fee_post_ledger`, `fee_next_number`, `fee_seal_receipt`, `fee_receipt_payload`, `fee_verify_document`, `fee_instrument_transition`, `fee_request_refund`, `fee_decide_refund`, `fee_pay_refund`, `fee_carry_forward`, `fee_import_bus_ledger`, `fee_record_rte` | Module methods, each one transaction; numbering is a read-increment-write that cannot race inside the object |
| Adjustments | `fee_apply_concession`, `fee_decide_concession`, `fee_remove_concession`, `fee_add_fine`, `fee_waive_fine`, `fee_compute_late_fee`, `fee_late_fee_sweep`, `fee_waive_late_fee`, `fee_set_late_fee_rule_enabled` | Module methods; `computeLateFee` already lives in the engine |
| Settings and audit | `fee_setting`, `fee_save_setting`, `fee_settings_freeze_published` (trigger), `fee_log`, `fee_audit_append_only` (trigger), `fee_ledger_append_only` (trigger), `fee_payments_immutable`, `fee_payments_no_delete` | Settings methods; append-only and immutability guards kept as SQLite triggers as a second line of defence |
| Messaging | `fee_queue_reminder`, `fee_reminder_tick`, `fee_claim_outbox`, `fee_kick_drain`, `fee_contact_msisdn`, `fee_may_message`, `fee_students_by_msisdn`, `fee_resolve_pay_link`, `normalize_msisdn` | Reminder job + outbox ([14](14-jobs-messaging-realtime.md)); pay-link resolution as a public method |
| Scheduled | `fee_autogen_tick`, `fee_overdue_tick`, `fee_reminder_tick`, `fee_late_fee_sweep` | School jobs at the school's local time |
| Reports | `fee_bill_register`, `fee_collection_by_head`, report views | Report methods over summary tables (`fee_daily_collection`, `fee_student_balance`) kept current on every money movement |

## 6. Server routes and integrations

| Route today | Target |
| --- | --- |
| `/api/fees/collect` | `fees.collect` (with `Idempotency-Key`) |
| `/api/fees/invoices`, `/api/fees/invoices/generate` | `fees.invoices.*`, `fees.issue.*` |
| `/api/fees/payments/[id]`, `/api/fees/payments/[id]/reverse` | `fees.payments.get`, `fees.payments.reverse` |
| `/api/fees/refunds`, `/[id]/decide`, `/[id]/pay` | `fees.refunds.*` |
| `/api/fees/instruments`, `/[id]/transition` | `fees.instruments.*` |
| `/api/fees/profiles/create` | `fees.profiles.create` |
| `/api/fees/years/carry-forward` | `fees.carryForward` (job with preview) |
| `/api/fees/reminders/send` | `fees.reminders.send` |
| `/api/fees/online/order`, `/api/fees/online/verify` | `fees.online.order`, `fees.online.verify` |
| `/api/fees/razorpay/create-order`, `/api/fees/razorpay/webhook` | Razorpay order through the same `fees.online.order`; webhook at `/hooks/<schoolId>/razorpay` |
| `/api/fees/upi/create-collect`, `/api/fees/upi/webhook` | `fees.upi.createCollect`; webhook at `/hooks/<schoolId>/bank-collect` ([35](35-bank-collections-and-payouts.md)) |
| `/api/fees/pay/[token]`, `/api/fees/verify/[token]` | Public methods `fees.payLink.resolve`, `fees.receipt.verify` on the school host, rate-limited |
| `/api/fees/cron/drain` | Removed (outbox queue) |

## 7. Jobs, files and live updates

- **Jobs (school-local times, defaults as today):** autogen 02:00, overdue + late-fee sweep 02:30, reminders 10:00; bulk issue, carry-forward and reminder blasts as batched jobs with previews.
- **Messages:** WhatsApp reminders and receipts through the outbox; pay links in messages are signed and expiring (as today).
- **Files:** none stored (PDFs rendered in the browser). Optionally keep sealed receipt PDFs in R2.
- **Live updates:** none required.

## 8. Single-tenant assumptions

| Assumption | Where | Fix |
| --- | --- | --- |
| `Asia/Kolkata` hard-coded in the fee date engine and a v3 function | `src/lib/fees/engine/dates.ts`, `fee_v3_bills_and_carry_forward.sql` | School time zone |
| Cron at fixed UTC times for IST | `cron.job` | School-local job times |
| "Only admin resolves fee permissions" (`fee_restrict_to_admin_and_students.sql`) reflects one school's office | Resolver | A per-school setting: "fee office roles" (default admin only), so a school with an accountant role can grant keys through the matrix again |
| Months without a due date fall due on the 10th | `fee_v2_optional_and_months.sql` | School setting |
| Indian tax and receipt formats (amount in words in Indian numbering, ₹) | Engine `words.ts`, documents | Default; locale and currency from school settings |
| Drain URL and cron secret in `site_settings.fee_runtime` | Messaging | Removed |
| Razorpay, UPI and bank secrets fall back to env vars | `razorpayKeys.ts`, `serverSecrets.ts` | School secrets only ([17](17-integrations-and-secrets.md)) |

## 9. Target design

### Tables

All live `fee_*` tables carried over, with every money column as integer paise and every percentage as basis points ([13](13-data-layer.md)). Decide at import whether to drop the superseded round-1 price-list tables (`fee_structures`, `fee_structure_items`, `fee_installments`, `fee_installment_items`, `fee_groups`, `fee_group_assignments`) if no live invoice references them (`fee_invoices.installment_id`, `fee_profiles.structure_id`), and the empty first-generation `school_fees` tables.

New summary tables, written in the same call as the money they summarise: `fee_student_balance` (student, year, billed, discounted, paid, balance), `fee_daily_collection` (date, method, collector, head, amount). Every report view becomes a query over these and the base tables.

### Invariants, restated for the object

1. Nothing that touched money is updated in place or deleted: methods only insert contra rows; SQLite triggers reject `UPDATE`/`DELETE` on `fee_ledger_entries`, `fee_audit_log` and settled `fee_payments`.
2. Numbers come from `fee_number_series` inside the paying call; the object runs one call at a time, so two clerks always get consecutive numbers.
3. Every concession, fine and late fee is a line on a named invoice.
4. Automatic charges start the day they are enabled (`enabled_from = today`).
5. Every bulk action has a preview method returning exactly what the commit method will do (same engine call).
6. A caller without `fees.view_amounts` never receives an amount (except their own bills, as a student).

### Methods (grouped)

| Group | Methods | Permission |
| --- | --- | --- |
| Setup | `fees.years.*`, `fees.terms.*`, `fees.heads.*`, `fees.gradeGroups.*`, `fees.rates.save`, `fees.charges.*`, `fees.optins.*`, `fees.settings.*`, `fees.permissions.*` | `fees.configure` and finer keys from today's catalogue |
| Issue | `fees.issue.preview`, `fees.issue.commit` (job), `fees.issue.undo`, `fees.issue.blockers` | `fees.issue` |
| Counter | `fees.student.summary`, `fees.collect`, `fees.payments.reverse`, `fees.instruments.*`, `fees.receipt.get` | `fees.collect`, `fees.reverse` |
| Adjustments | `fees.concessions.*`, `fees.fines.*`, `fees.lateFees.*`, `fees.refunds.*`, `fees.credits.*`, `fees.rte.*` | finer keys |
| Online | `fees.online.order`, `fees.online.verify`, `fees.upi.createCollect` | the student (own bills); `fees.collect` |
| Messaging | `fees.reminders.preview`, `fees.reminders.send`, `fees.reminders.schedules.*`, `fees.payLink.create` | `fees.remind` |
| Year end | `fees.carryForward.preview`, `fees.carryForward.commit` | `fees.year_end` |
| Reports | `fees.reports.*`, `fees.billRegister`, `fees.export` | `fees.reports` |
| Public | `fees.payLink.resolve`, `fees.receipt.verify` | none (host-scoped, rate-limited) |
| Student | `fees.mine` | the student |

### Performance notes

Issuing a term for 9,000 students is about 9,000 invoices, 30,000 lines and 9,000 ledger rows, with index rows several times that: run it as a job in batches of a few hundred students per alarm tick, with progress on screen. A single collection is a handful of rows and well under the 20 ms call budget.

## 10. Moving existing data

- Money columns: rupees × 100 → paise, rejecting anything with more than two decimals; percentages × 100 → basis points.
- Recompute every invoice from its lines and allocations after import and compare with the imported totals; any difference stops the import.
- Recompute every student's ledger running balance and compare.
- Verify receipt hashes (`receipt_hash`) still validate with the same algorithm, so old QR codes verify.
- Keep `verify_token` and pay-link tokens unchanged so printed and sent links keep working.

## 11. Parity checklist

- [ ] Port and pass every engine test (`allocate`, `latefee`, `money`, `schedule`, reports, settle webhook).
- [ ] The fee plan's acceptance scenario (grade-5 bills, partial cash payment, QR VALID, reversal flips QR to CANCELLED, overpayment becomes credit) gives identical numbers.
- [ ] Two simultaneous collections never share a receipt number.
- [ ] Issue, undo and blockers behave as today, including issued-cell locks.
- [ ] Late-fee sweep, autogen and overdue produce the same lines on the same days.
- [ ] Masking: a non-permitted caller receives no amount from any method or report.
- [ ] Old receipt QR codes and pay links work after the move.
- [ ] Bus fees issued from transport appear as fee bills exactly as today.

## 12. Open questions

- [ ] Drop the superseded round-1 price-list tables at import, or keep them read-only?
- [ ] Should fee permissions be grantable to non-admin roles per school (reversing `fee_restrict_to_admin_and_students` as a default)?
- [ ] Keep Razorpay as an option for new schools, or bank UPI only?
