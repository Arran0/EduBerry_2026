# External Integrations and Secrets

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). Feature-level detail stays in the existing docs: `docs/account-email-system.md`, `docs/whatsapp-system-status.md`, `docs/gps-system-status.md`, `docs/fee-upgrade-plan.md`, `docs/payroll-upgrade-plan.md` and the README's Banking section.

## Summary

- **Every integration keeps working on Cloudflare; one needs a design change.** Banks that require a client certificate (mutual TLS) cannot be called from a Worker with a certificate typed into the app: Workers present client certificates only through bindings uploaded ahead of time. The fix is a small bank gateway container used only for those calls.
- **Secrets split cleanly into two kinds.** Platform secrets (one value for every school: email token, VAPID keys, encryption key, solver) become Workers Secrets. School secrets (bank, Razorpay, WhatsApp, GPS device keys) stay in each school's own database, encrypted with a platform key.
- **The environment-variable fallbacks for school secrets go away.** They exist today so a single-school deployment could run without the settings screens; with one deployment for every school they would apply one school's bank to all.
- **Webhooks move to `/hooks/<schoolId>/<provider>`**, so a school changing its domain no longer breaks bank, Razorpay or Meta callbacks.

## Inventory

| Integration | Used for | Code today | Credentials today |
| --- | --- | --- | --- |
| Bank APIs (collect) | Fee and bus fee collection: reference matching, virtual UPI ids, virtual accounts | `bankClient.ts`, `bankConfig.ts`, `smartCollect.ts`, `collectSetup.ts`, `/api/fees/upi/*`, `/api/bus/upi/*` | `payment_secrets.bank_collect` (API key, OAuth client, HMAC secret, client certificate + key + passphrase, webhook secret); `BANK_COLLECT_*` env fallback (11 variables) |
| Bank APIs (payout) | Salary and driver payroll payouts by bank file or bank API | `payoutProvider.ts`, `payoutClaim.ts`, `payoutWebhook.ts`, `/api/salary/payout/*`, `/api/bus/payroll/payout/*` | `payment_secrets.payout`; `BANK_PAYOUT_*` env fallback (12 variables); legacy RazorpayX / Cashfree keys |
| Razorpay | Optional card and netbanking for fees and bus fees | `fees/razorpayKeys.ts`, `fees/online.ts`, `onlineSettle.ts`, `/api/fees/razorpay/*`, `/api/bus/razorpay/*`, checkout script in the browser | `site_settings.razorpay_config` + secret in `payment_secrets`; `RAZORPAY_*` env fallback |
| Smart Collect (legacy) | Older UPI collect flow | `smartCollect.ts` | `SMART_COLLECT_*` env |
| WhatsApp (Meta Cloud API) | Fee reminders, bus alerts, (branch) attendance/announcement/bus reminders | `src/lib/whatsapp/*`, `src/lib/notifications/whatsapp/*`, `/api/whatsapp/webhook` | `fee_settings.whatsapp` (phone number id, WABA id), `integration_secrets` (access token, app secret, verify token); `WHATSAPP_*` env fallback |
| Web push | Announcement and leave notifications | `src/lib/notifications/push.ts`, `src/lib/push.ts`, `public/sw.js` | `VAPID_*` env per deployment |
| Email (Cloudflare Email Service) | Invites, password links, forgot password | `src/lib/email/*` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, `EMAIL_FROM_ADDRESS` (platform-wide) |
| GPS gateway (Traccar) | AIS-140 bus devices | `/api/transport/ingest`, branch `claude/quirky-feynman-jxi3p0` (link API, Traccar client) | Per-device key and secret in `integration_secrets` (`telemetry:<sourceId>`); gateway token per Vercel project |
| Timetable solver | Prove a week impossible, improve a week | `/api/timetable/solve`, `services/solver` (Python OR-Tools on Vercel) | `SOLVER_INTERNAL_URL`, `SOLVER_SHARED_SECRET` |
| Maps | Route and stop maps, live bus | Leaflet with map tiles; `NEXT_PUBLIC_MAPBOX_*` (4 spellings) | Public token per deployment |

## Secrets in the target

### Platform secrets (Workers Secrets)

| Secret | Purpose |
| --- | --- |
| `SESSION_PEPPER` | Mixed into session token hashes |
| `DATA_ENCRYPTION_KEY` (versioned, e.g. `DEK_V1`, `DEK_V2`) | Encrypts school secrets at rest (AES-256-GCM) |
| `FILE_LINK_SIGNING_KEY` | Signs short-lived file links ([15](15-files-and-media.md)) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push for every school |
| Email Service binding | Replaces `CLOUDFLARE_EMAIL_API_TOKEN` (the binding needs no token) |
| `TRACCAR_ADMIN_TOKEN` (or one per school, see GPS doc) | Linking devices on the shared gateway |
| `MAP_TILES_TOKEN` | One map key for all schools; a school can override it in settings |
| Cloudflare API token (narrow scope) | Creating custom hostnames and uploading certificates during provisioning |

### School secrets (encrypted in the school database)

One table, `integration_secrets`, replaces today's `payment_secrets` and `integration_secrets`:

| Column | Meaning |
| --- | --- |
| `key` | `bank_collect`, `bank_payout`, `razorpay`, `whatsapp`, `gps_device:<sourceId>`, ... |
| `ciphertext` | AES-256-GCM of the JSON secret |
| `key_version` | Which `DATA_ENCRYPTION_KEY` encrypted it, so keys can be rotated |
| `updated_by`, `updated_at` | Audit |

- Only server code that uses a secret can decrypt it; no API action returns a secret to the browser. Settings screens show "saved" and the last four characters, as today.
- Rotation: a job re-encrypts every row with the newest key version, school by school.
- Non-secret configuration (endpoints, field maps, transfer modes, phone number id) stays in ordinary settings tables.

## Bank calls and mutual TLS

Today `bankClient.ts` uses Node's `https.request` because "a per-request client certificate cannot be attached to global fetch". The same limit applies on Workers: a Worker presents a client certificate only through an mTLS binding, created by uploading the certificate to the Cloudflare account and adding a binding to the Worker's configuration (and redeploying).

| Option | How | Verdict |
| --- | --- | --- |
| mTLS binding per school | When an admin saves a certificate, upload it through the Cloudflare API, add a binding `BANK_CERT_<schoolId>` and redeploy | Works but couples a school setting to a platform deploy, the same problem as D1 bindings |
| Bank gateway container | A tiny Node service in Cloudflare Containers that receives the request, the decrypted certificate and key, and makes the call with `https.request`, exactly as `bankClient.ts` does now | **Recommended.** Fully dynamic, reuses today's code, runs only for banks that need mTLS, costs fractions of a cent per call |
| Bank-side alternative | Ask the bank for an API-key or OAuth-only programme | Use where the bank offers it; then the call stays in the Worker |

Bank calls are infrequent (collect setup, payout batches, status checks), so a container cold start of a few seconds is acceptable. Calls that need no certificate stay as plain `fetch` in the Worker or school object.

Banks that allow-list caller IP addresses (the README's onboarding list mentions this) need fixed egress addresses. Workers and Containers do not have a fixed outbound IP address by default. If a bank insists on an allow-list, check Cloudflare's dedicated-egress offerings at that time, or route that bank's calls through a small fixed-IP relay. Confirm with the first bank onboarded; this is the one integration that could keep a non-Cloudflare piece.

## Webhooks

| Provider | Today | Target URL | Verification |
| --- | --- | --- | --- |
| Bank collect | `/api/fees/upi/webhook`, `/api/bus/upi/webhook` | `/hooks/<schoolId>/bank-collect` | HMAC with the school's callback secret, header name from the school's bank config |
| Bank payout | `/api/salary/payout/webhook`, `/api/bus/payroll/payout/webhook` | `/hooks/<schoolId>/bank-payout` | Same |
| Razorpay | `/api/fees/razorpay/webhook`, `/api/bus/razorpay/webhook` | `/hooks/<schoolId>/razorpay` | `X-Razorpay-Signature` with the school's webhook secret |
| Meta WhatsApp | `/api/whatsapp/webhook` (GET handshake + POST) | `/hooks/<schoolId>/whatsapp` | Verify token for the handshake; `X-Hub-Signature-256` with the school's app secret |
| GPS gateway | `/api/transport/ingest?key=...&secret=...` | `/hooks/<schoolId>/gps/<sourceId>` | Device secret (Traccar cannot sign; the secret stays in the URL, as today) |

Processing rules are in [14-jobs-messaging-realtime.md](14-jobs-messaging-realtime.md#inbound-webhooks). Old paths keep working on each school's host during the move.

## Per-integration notes

| Integration | Change for the target |
| --- | --- |
| Bank collect and payout | Move `bankClient.ts` logic into the school's payments module; mTLS calls through the bank gateway container; payout claims no longer need `FOR UPDATE SKIP LOCKED` (single-threaded object) |
| Razorpay | Order creation and signature checks run in the Worker with `fetch` and WebCrypto HMAC (no Node SDK needed); the checkout script stays allowed in the CSP |
| WhatsApp | One sender in the outbox consumer replaces the two libraries (`src/lib/whatsapp` and `src/lib/notifications/whatsapp`); per-school credentials and templates as today. The open decisions in `docs/whatsapp-system-status.md` still apply |
| Web push | Platform VAPID keys; sending from the outbox consumer; library choice confirmed in a spike (WebCrypto supports the needed ECDH, AES-GCM and ECDSA P-256) |
| Email | Switch from the REST API token to the Email Service binding (about 20 lines, as the email doc predicted) |
| GPS gateway | Forward URLs carry the school id instead of the domain; consider one Traccar user per school instead of a shared admin token (gap noted in `docs/gps-system-status.md`) |
| Solver | Package `services/solver` as a container image; `timetable.solve` starts it on demand with a budget of up to 60 s; no shared secret needed because only the Worker can reach it |
| Maps | One platform tile key; per-school override in settings |

## Parity checklist

- [ ] Each bank auth mode in `bankConfig.ts` (API key, Basic, OAuth2 client credentials, HMAC signing, client certificate only) completes a test call against the bank's sandbox.
- [ ] Bank file payouts produce byte-identical files to today's for the same inputs.
- [ ] Razorpay orders, payments and webhooks settle invoices exactly as today.
- [ ] WhatsApp sends, receipts and STOP replies behave as described in the WhatsApp doc.
- [ ] Push notifications arrive on Android Chrome, desktop Chrome and iOS home-screen apps.
- [ ] A GPS device's fixes arrive through the new hook URL and drive the run as today.
- [ ] No school secret is ever returned to a browser or written to logs.
