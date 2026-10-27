# Bank Collections and Payouts

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). Fee billing is in [33-fees.md](33-fees.md), salary and payroll in [34-payroll-and-salary.md](34-payroll-and-salary.md), secrets and the bank gateway container in [17-integrations-and-secrets.md](17-integrations-and-secrets.md). The planned payout batches (round C4) are in `docs/payroll-multi-location-plan.md`.

## 1. Summary

EduBerry moves money in two directions, and both go through the school's own bank (no aggregator takes a cut):

- **Collections (money in):** parents pay fees and bus fees online. There are two ways.
  - **Razorpay checkout:** an order is created, then confirmed by the browser and by a webhook.
  - **The school's bank collection programme** ("Smart Collect", "virtual account", "eCollect"). It works in one of three modes:
    - reference matching: one school UPI id, with a unique reference per bill;
    - a virtual UPI id per bill;
    - a virtual account number and IFSC per bill.

    The bank calls a signed webhook when money lands, and the payment is matched to its bill.
- **Payouts (money out):** salaries and driver pay leave the school's current account in one of three modes:
  - **Manual:** pay from the bank portal and mark records paid.
  - **Bank file:** EduBerry writes the bank's bulk-transfer file and the admin uploads it.
  - **Bank API:** EduBerry calls the bank's bulk transfer endpoint, and the bank calls back with each transfer's result.

  RazorpayX and Cashfree remain only so that older settings still load.

The bank connection is configuration, not code. Base URL, auth scheme (API key, Basic, OAuth2 client credentials, HMAC, or client certificate only), headers, paths, field-name maps, signature header and encoding, and mutual TLS are all entered in Settings. Onboarding a new bank needs no deploy.

Live state at the one school:

| Item | Live |
| --- | --- |
| Payout mode | Manual |
| Razorpay | Enabled |
| `payment_secrets` rows | 2 (`bank_collect`, `payout`), both empty |
| Online payments | No Razorpay orders yet |
| Bank-collect credits | None |
| Bank accounts on file | 81 staff, 5 drivers |
| Salary records sent to a bank | 0 of 225 |

So the whole money-movement path is built and tested, but unused in production. That makes the move low-risk, as long as it keeps parity.

What changes:

- The provider-agnostic TypeScript (`bankClient.ts`, `bankConfig.ts`, `smartCollect.ts`, `payoutProvider.ts`, `payoutClaim.ts`, `payoutWebhook.ts`) moves into the school's payments module almost unchanged.
- Webhooks move to `/hooks/<schoolId>/<provider>` and are made idempotent through `webhook_events`.
- Calls that need a client certificate go through the bank gateway container.
- Secrets come only from the school's encrypted secrets; every environment-variable fallback is removed.

## 2. Users and screens

| Route or component | Who | Purpose |
| --- | --- | --- |
| Settings → Fees → Bank collection (`BankCollectSettings`, 308 lines) | Admin | Mode (reference, virtual UPI id, virtual account), connection fields, allocation path, request field map, callback URLs with copy buttons, Razorpay keys |
| Settings → Salary → Bank payout (`BankPayoutSettings`, 308 lines) | Admin | Payout mode, transfer rail (NEFT, RTGS, IMPS, INTRA), RTGS floor, batch size, transfer and status paths, field map, bank file layout (columns, delimiter, header row), callback URL |
| `BankConnectionFields` (197 lines) | Admin | Shared connection editor: base URL, auth mode, key header, OAuth token URL, custom headers, signature header, encoding and prefix, mutual TLS switch, certificate upload, bank presets, onboarding checklist |
| Student and parent fee pages, `/pay/[token]` | Students, parents | Pay online (Razorpay checkout or UPI or virtual-account details), then poll until confirmed |
| Salary roster → Pay (`/more/salary/manage/[cycleId]`) | Admin | Send approved records to the bank, or download the bank file |
| Bus → Payroll → Pay | Admin | Same, for drivers |
| Salary and driver bank-account sections (`BankAccountsSection`, `DriverBankAccountsSection`) | Admin | Account holder, number, IFSC, bank name per person |

The bus module has its own settings tab using the same components (`isBus` / `isDriver` props), so both modules share one bank arrangement and one set of secrets.

## 3. How it works today

### Secrets and configuration

- Public, non-secret configuration is stored in world-readable `site_settings` rows: `bank_collect_config`, `smart_collect_config` (legacy), `payout_config`, `razorpay_config`, `upi_config`.
- Credentials, certificates, private keys and the school's debit account number are stored in admin-only `payment_secrets` rows (`razorpay`, `smart_collect`, `bank_collect`, `payout`).
- `serverSecrets.getPaymentSecrets(admin, scope)` overlays the stored row on an environment-variable fallback for each scope. Blank stored fields fall through to the environment.
- Write-only keys are never echoed back to the browser (`WRITE_ONLY_SECRET_KEYS`).

### Collections

1. **Start.**
   - `/api/fees/upi/create-collect` and `/api/bus/upi/create-collect` return what the payer needs:
     - reference mode: the school UPI id and the bill's reference (`SCHFEE-...` for school fees, a bus prefix for bus fees);
     - virtual UPI id or virtual account mode: the bank is called through `allocateCollectTarget` to allot the handle.
   - A pending payment row stores the handle in `collect_vpa` and the reference in `provider_ref`.
2. **Callback.**
   - `collectSetup.verifyCollectCallback` reads the raw body and verifies the HMAC signature.
     - The configured header is tried first, then common header names.
     - It uses the direct bank config when enabled, otherwise the legacy Smart Collect config.
     - The legacy webhook secret is used as a fallback, so a school that switches keeps verifying callbacks.
   - `normalizeCollectEvent` extracts the reference, handle, amount, UTR and status, trying the field names banks use.
3. **Match and settle.**
   - Idempotency: a UTR already credited is ignored.
   - Matching tries the pending payment by handle, then by reference, then the fee by `upi_reference`. In the last case a pending row is created only if a UTR and a positive amount are present.
   - The payment is marked verified with the amount that actually arrived. A UPI push lets the payer choose the amount.
   - The bill is re-settled from verified payments (`settleWebhook.ts`): `paid` only when covered, otherwise `partial`.
   - Callbacks the route does not track (such as a bus settlement arriving at the fee route) return 200 so the bank stops retrying.
4. **Razorpay.**
   - The v2 fee app creates an order through `/api/fees/online/order`. The amount is computed on the server from the chosen bills, never taken from the browser, and stored in `fee_online_orders`.
   - Checkout returns a signed payment id. `/api/fees/online/verify` checks the signature, asks Razorpay what was captured, and settles.
   - `/api/fees/razorpay/webhook` (HMAC over the raw body) settles the same order independently. Whichever arrives first makes the receipt (`onlineSettle.ts` claims the order before settling).
   - The bus module has the equivalent routes under `/api/bus/razorpay/*`.

**Gap found while writing this doc.** Bank UPI and virtual-account collection is wired only to the first-generation `school_fees` / `school_fee_payments` tables and to the bus module's `bus_fees` / `bus_payments`. On live, `school_fee_payments` has no `utr`, `collect_vpa`, `provider` or `provider_ref` columns, although the route reads and writes them. The v2 fee app (`fee_payments` already has `utr`, `collect_vpa` and `provider_ref`) has no bank-collect start or settlement path: it collects online through Razorpay only. The rebuild should settle bank credits into the v2 tables (§9).

### Payouts

1. **Initiate.** `/api/salary/payout/initiate` (staff) and `/api/bus/payroll/payout/initiate` (drivers), admin only.
   - Records are eligible only if all of these hold:
     - the record is `approved`;
     - it is not paid by cash;
     - the person has not resigned (banned) and is not hidden from the salary roster;
     - it has never been sent, or its last attempt failed (`isSent`);
     - the person has a bank account on file.
   - Net pay is the base plus the item amounts.
2. **Claim.**
   - A conditional update sets `payout_status = 'initiated'`. It matches only rows still `approved` with a null or `failed` payout status.
   - Two racing requests (a double click, two admins) therefore never send the same record twice.
   - The audit log entry is written before the bank call, at the point of no return.
3. **Send.** `getPayoutProvider(config, creds)` returns an implementation:
   - **Bank API:** posts batches of `batch_size` to `transfer_path` through `callBank`.
     - Request fields are renamed by `request_map`.
     - The rail is chosen per item: RTGS above `rtgs_min_amount`, otherwise the configured rail.
     - Each item's result is read through `flatten` and `pickString`.
   - **Bank file:** builds the file from the configured column tokens and returns it to the browser with `requiresUpload`. Money moves only when the admin uploads the file.
   - **Legacy RazorpayX / Cashfree:** aggregator calls, kept only so old settings still load.
4. **Reconcile.** `payoutClaim.reconcile` writes each result back: `initiated` with the bank's payout id, or `failed`.
5. **Callback.**
   - `/api/salary/payout/webhook` and `/api/bus/payroll/payout/webhook` verify the signature using the scheme, encoding and prefix from the saved connection.
   - `mapPayoutEvent` maps the bank's status words: settled, rejected, or ignore for informational states.
   - `applyPayoutCallback` applies the result:
     - Success is always recorded (`processed`, record `paid`), even late.
     - A failure counts only when a send is still outstanding and, if both sides carry a payout id, it names the same attempt (`failureApplies`). Bank callbacks carry no nonce, so a replayed failure for an earlier attempt could otherwise make a retried record eligible a third time and pay the person twice.
6. **Status polling.** `payout_config.status_path` can be configured, but no code uses it. A transfer the bank never calls back about stays `initiated` until someone marks it paid.

### Mutual TLS

`bankClient.ts` uses Node's `https.request` with the PEM certificate, key and passphrase from secrets when `use_client_cert` is on, because global `fetch` cannot attach a client certificate per request. Calls without a certificate use `fetch`. OAuth2 tokens are fetched with client credentials and cached in memory per process.

## 4. Data

| Table or setting | Rows | Purpose |
| --- | --- | --- |
| `payment_secrets` | 2 (empty values) | Per-scope secrets (`razorpay`, `smart_collect`, `bank_collect`, `payout`) |
| `site_settings.bank_collect_config`, `smart_collect_config`, `payout_config`, `razorpay_config`, `upi_config` | | Public configuration |
| `staff_bank_accounts` | 81 | Holder, number, IFSC, bank, legacy `payout_fund_account_id` |
| `driver_bank_accounts` | 5 | Same, for drivers |
| `salary_records.payout_status`, `payout_reference`, `pay_by_cash` | 225 records | Payout state per record |
| `driver_payroll_records` (same columns) | 0 | Driver payout state |
| `fee_online_orders` | 0 | Razorpay orders for v2 fee bills |
| `fee_payments.utr`, `collect_vpa`, `provider_ref` | 0 with a UTR | v2 payment columns ready for bank credits |
| `school_fees`, `school_fee_payments` | 0 / 0 | First-generation fee tables used by the bank-collect route |
| `bus_fees`, `bus_payments` | 2 / 0 | Bus fee bills and payments ([36](36-transport.md)) |

Planned in round C4 (not built): `payroll_bank_accounts`, `payroll_payout_batches` (draft, awaiting bank approval, submitted, partially settled, settled, failed, cancelled), `payroll_payout_items` (beneficiary snapshot, attempt number) and `payroll_payout_events` (append-only). The route `POST /api/payroll/runs/[runId]/payout` does not exist yet, so the v2 payroll engine has no payout.

## 5. Logic in the database

| Today | Target |
| --- | --- |
| Admin-only row-level security on `payment_secrets` | Secrets encrypted in the school object and readable only by server code ([17](17-integrations-and-secrets.md)); never returned to the browser |
| World-readable `site_settings` rows for public config | `settings.get` returns only non-secret keys; payment config is admin-read |
| Conditional update as the payout claim | A check and write inside one `transactionSync()` in the object (single-threaded, so no race between two admins) |
| `fee_pay_refund` (refund payout) | `fees.refunds.pay` ([33](33-fees.md)); today it records a manual refund only |

## 6. Server routes and integrations

| Route today | Target |
| --- | --- |
| `/api/fees/upi/create-collect`, `/api/bus/upi/create-collect` | `payments.collect.start(billIds)`: one method for fee and bus bills (bus fees are fee bills in v2, see [33](33-fees.md)) |
| `/api/fees/upi/webhook`, `/api/bus/upi/webhook` | `POST /hooks/<schoolId>/bank-collect`: one endpoint; the router passes the raw body and headers to `payments.collect.callback` |
| `/api/fees/online/order`, `/api/fees/online/verify`, `/api/fees/razorpay/create-order` | `fees.online.order`, `fees.online.verify` |
| `/api/fees/razorpay/webhook`, `/api/bus/razorpay/webhook` | `POST /hooks/<schoolId>/razorpay` |
| `/api/salary/payout/initiate`, `/api/bus/payroll/payout/initiate` | `payments.payout.initiate(source, id)`: source is a salary cycle, a driver cycle, or (later) a v2 payroll run |
| `/api/salary/payout/webhook`, `/api/bus/payroll/payout/webhook` | `POST /hooks/<schoolId>/bank-payout`: the reference prefix or a lookup decides staff or driver |
| (none) | `payments.payout.poll`: an alarm that uses `status_path` for sends still `initiated` after a set time |

Webhook handling in the target:

1. The router finds the school from the path and passes the raw body and headers to the school object. There is no user session.
2. The object verifies the signature with the school's secret, stores the event in `webhook_events (provider, event_key, received_at, outcome)` with a unique key (the UTR, Razorpay payment id, or bank payout id plus status), and returns early on a duplicate.
3. Matching and settlement run in one transaction with the payment and bill updates.
4. The handler always returns 2xx for events it does not track, as today, so the bank stops retrying.

## 7. Jobs, files and live updates

- **Jobs:**
  - Payout batches larger than one call go through the `jobs` queue, one message per bank batch, each recording its result before the next.
  - A per-school alarm polls the status of unconfirmed sends when `status_path` is set.
  - Collection allocation is synchronous: the payer is waiting.
- **Files:** bank payout files are generated on demand and stored under `schools/<schoolId>/payouts/<batchId>/<filename>` for audit, so an uploaded file can always be shown later. Statutory files are covered in [34](34-payroll-and-salary.md).
- **Live updates:** the payer's page waits for confirmation. Today it polls `/api/fees/online/verify`. In the target, a WebSocket message on the student's channel can replace polling, with polling kept as a fallback.

## 8. Single-tenant assumptions

| Assumption | Where | Fix |
| --- | --- | --- |
| Environment fallbacks: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SMART_COLLECT_*` (3), `BANK_COLLECT_*` (10), `BANK_PAYOUT_*` (11), `PAYOUT_WEBHOOK_SECRET`, `RAZORPAYX_*`, `CASHFREE_*` | `serverSecrets.ts`, `razorpayKeys.ts`, create-order routes | Removed. A school with no stored secret has the feature off |
| Callback URLs are deployment-relative (`/api/fees/upi/webhook` and others, listed in the README and in Settings) | Settings components, README | `/hooks/<schoolId>/<provider>` on the platform host; Settings shows the full URL for that school |
| One bank arrangement per deployment for fees and bus | `collectSetup.ts` | One per school (unchanged within a school) |
| Bank-collect references are unique per deployment (`SCHFEE-...`) | create-collect routes | Unique per school; the school is already known from the webhook path, so references never cross schools |
| OAuth2 tokens cached per server process | `bankClient.ts` | Cached in the school object's memory, or in its storage with an expiry |
| Legacy `smart_collect_config` and its secret fallback | `collectSetup.ts` | Not carried over (no live school uses it); import any secret it holds into `bank_collect` |
| Legacy RazorpayX and Cashfree payout providers | `payoutProvider.ts` | Not carried over; no live school uses them |

## 9. Target design

### Module

A `payments` module in the school object owns:

- the bank connection configuration and secrets (through the secrets module);
- collection start and callbacks for every bill type;
- Razorpay orders and callbacks;
- payout initiate, claim, send, callback and poll for every payable source.

`fees` and `payroll` call it rather than each carrying their own copy, as they do today across the fee and bus routes.

### Collections into v2 fee bills

- `payments.collect.start(billIds)` does three things:
  - computes the amount on the server from the bills' balances;
  - allots a handle when the mode needs one;
  - stores a `fee_online_orders` row with `provider = 'bank_collect'`, carrying the handle, the reference and the bill allocations.

  This reuses the pattern the Razorpay path already has, so a credit settles against the bills the payer chose.
- A credit is matched by handle, then by reference, then by order. It is recorded as a `fee_payments` row with `method = 'upi'` or `'bank'`, plus `utr`, `collect_vpa` and `provider_ref`, and allocated with the fee engine.
- Short and over-payments follow the fee module's rules: a short payment leaves a balance, and an excess becomes a credit.
- A credit with no match goes to an "unmatched credits" list for the counter to assign. Today such credits are dropped with a 200.

### Payouts

- One `payout_batches` / `payout_items` / `payout_events` design, as planned for round C4, serves both salary cycles and v2 runs. The legacy `payout_status` columns are then derived from items.
- Claiming, eligibility and `failureApplies` move unchanged.
- The bank call happens after the claim is committed. A Durable Object lets other requests run while it awaits a `fetch`, so the commit-before-call order matters exactly as it does today.
- **Bank file mode:**
  - the batch moves to `awaiting_bank_approval` when the file is downloaded;
  - the admin confirms the upload;
  - callbacks, or a manual mark-paid, settle the items.

### Mutual TLS and egress

- Banks that require a client certificate are called through the bank gateway container ([17](17-integrations-and-secrets.md)).
  - The payments module sends the request, plus the certificate and key decrypted for that call only, over the container binding.
  - The container makes the call exactly as `bankClient.ts` does today.
- Banks without mutual TLS are called with `fetch` directly from the object.
- If a bank allow-lists caller IP addresses, the same container is the place to give it a fixed egress address (open question in [17](17-integrations-and-secrets.md)).

### Methods

| Method | Permission |
| --- | --- |
| `payments.config.get` / `save` (collect, payout, Razorpay) | `payments.configure` (admin) |
| `payments.secrets.save` (write-only), `payments.secrets.status` (which keys are set) | `payments.configure` |
| `payments.connection.test` (one authenticated call to the bank) | `payments.configure` |
| `payments.collect.start` | the student (own bills), a parent through a pay link, `fees.collect` |
| `payments.collect.unmatched`, `payments.collect.assign` | `fees.collect` |
| `fees.online.order`, `fees.online.verify` | the student (own bills), a pay link |
| `payments.payout.preview(source, id)` (eligible, missing bank, already sent) | `payroll.pay` |
| `payments.payout.initiate`, `payments.payout.markPaid`, `payments.payout.retryFailed` | `payroll.pay`; optionally a second approver (maker-checker) |
| `payments.payout.batches`, `payments.payout.file(batchId)` | `payroll.pay` |
| `payments.bankAccounts.*` (staff and drivers) | `payroll.manage`; the employee can view their own, masked |

Account numbers are shown masked everywhere except the bank-file download and the edit form.

## 10. Moving existing data

- Copy bank accounts (staff and drivers) and payout state on salary records as they are, converting money to paise.
- Copy `site_settings` payment configuration into the school's settings, and `payment_secrets` into encrypted school secrets. Both stored rows are empty at the live school today.
- Re-enter the Razorpay keys if they live only in environment variables (check before cutover).
- Re-register every webhook with the bank and with Razorpay at the new `/hooks/<schoolId>/...` URLs before switching DNS. Keep the old routes forwarding to the new ones for a week, in case a provider retries an old event.

## 11. Parity checklist

- [ ] Port and pass `payoutClaim.test.ts` and `settleWebhook.test.ts`, and the field-mapping and signature tests in the bank client.
- [ ] A double-clicked or concurrent payout sends each record exactly once.
- [ ] A replayed failure callback for an earlier attempt does not reopen a retried record. A late success always records.
- [ ] Records paid by cash, resigned staff, and staff hidden from the roster are never sent.
- [ ] The bank file for the same records and layout is byte-identical to today's.
- [ ] A signed Razorpay webhook and the browser verify call settle the same order only once.
- [ ] A bank-collect callback is matched in each of the three modes, credits the amount that arrived, and is idempotent on its UTR.
- [ ] Callbacks with a bad signature are rejected. Unknown events return 2xx and change nothing.
- [ ] A school's callback cannot settle another school's bill: the school comes from the path, and the secret is that school's.
- [ ] Secrets are never returned by any method. Write-only keys show only "configured".

## 12. Open questions

- [ ] Do the first banks onboarded require IP allow-listing? If so, does the gateway container need a fixed egress address?
- [ ] Maker-checker for payouts: should a second person approve before money leaves?
- [ ] Should bank-collect credits that match nothing appear in an "unmatched credits" list (recommended), or keep today's behaviour of dropping them with a 200?
- [ ] Is RTGS preferred over the configured rail above the floor, or only allowed?
- [ ] Keep Razorpay for new schools alongside bank collection, or bank collection only (also asked in [33](33-fees.md))?
