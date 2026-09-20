# Transport — what's left for you

Everything in the transport module is built, pushed, and — as of 2026-09-20 —
applied to the live database. **Steps 1–3 are done**; they are kept below,
struck through, because what they found and what they set is worth a record.

What is left genuinely needs a human: a third party (Meta), a decision only the
school can make, or physical hardware. Nothing below blocks the module from
working — a school could run it tomorrow on push notifications alone.

---

## 1. ~~Re-authorise the Supabase connector~~ — ✅ done

Connected on 2026-09-20. Everything in steps 2 and 3 was run and verified
against the live project rather than handed to you as SQL.

## 2. ~~Run the Round 4 migrations~~ — ✅ applied

Applied to `tgxxqzeaqxiwoqzopcku` in order:

1. `supabase-migrations/transport_r4_a_archive_and_replay.sql`
2. `supabase-migrations/transport_r4_b_metrics_and_reports.sql`
3. `supabase-migrations/transport_r4_c_scan_boarding.sql`
4. `supabase-migrations/transport_r4_d_gtfs.sql`
5. `supabase-migrations/transport_r4_e_revoke_tick_execute.sql` — written
   *after* the other four, because the audit below found a hole.

The History, Reports, Cards & QR and Open data tabs, and the driver's scan
field, are live now.

### What the post-migration checks found

- **Shape.** All four tables and all fifteen functions exist.
- **Cron.** `transport-archive-telemetry` 02:30 → `cleanup-transport-telemetry`
  03:00 → `cleanup-transport-archive` 03:15 → `transport-rollup-metrics` 03:45.
  The 02:30 → 03:00 gap is the one that matters: **the archiver has to run
  before the purge deletes the fixes it archives.** If you ever move either
  job, keep that ordering.
- **Advisors.** No ERROR-level lint. No new `auth_rls_initplan` and no
  duplicate-permissive-policy finding from the new tables. The only
  performance notes against them are "unused index" on indexes of tables that
  are still empty, which is expected.
- **Grants — one real hole, now closed.** `anon` has EXECUTE on nothing from
  Round 4. But `transport_tick()` had never been revoked from `PUBLIC`, which
  includes `authenticated`, so **any signed-in account could have driven the
  school's alerting pass** through `/rest/v1/rpc/transport_tick`. The tick is
  advisory-locked and idempotent, so nothing was corrupted, but an
  unprivileged caller controlling alert and notification timing is bad enough.
  `transport_r4_e` revokes it. The other four cron-only functions each carried
  their own REVOKE and were already correct.

## 3. ~~Fill in `transport_runtime_config`~~ — ✅ done and verified

Both rows existed but were `NULL`, so notifications were silent. Now set:

- `drain_url` → `https://mps-web-by-arran.vercel.app/api/transport/notify/drain`,
  taken from `NEXT_PUBLIC_SITE_URL` in `.env.local`. **If that is not the
  domain you actually serve from, change it** — pg_net calls it from
  Supabase's network, so it must be the deployed URL, and a wrong one fails
  silently.
- `cron_secret` → a freshly generated 64-hex-character value, minted
  server-side. It is only ever compared inside the database and the drain
  endpoint, both of which read this same row, so there is nothing to copy
  anywhere and nothing to keep in an env var.

**Verified end to end, not assumed.** A `net.http_post` to the drain with that
secret returned `200 {"success":true,"sent":0,"failed":0}` — pg_net reached the
deployed endpoint, the secret was accepted, and the outbox claim ran. `sent:0`
is correct: there are no runs yet, so nothing was queued, and no real parent
was messaged by the test.

To change the secret later:

```sql
UPDATE public.transport_runtime_config
   SET value = encode(gen_random_bytes(32), 'hex') WHERE key = 'cron_secret';
```

If messages ever stop, that is what to look at:

```sql
SELECT status, attempts, last_error, sent_at
FROM public.notification_outbox ORDER BY created_at DESC LIMIT 5;
```

Rows stuck at `queued` with a rising `attempts` mean the URL or the secret is
wrong. Rows at `failed` with `last_error` tell you which.

## 4. Submit the six WhatsApp templates to Meta — *lead time, not a code task*

Meta requires every business-initiated message to use a template they've
approved, and approval takes days. The six EdZee sends are already seeded in
`message_templates` with suggested copy. Submit them at
**Meta Business → WhatsApp → Message templates**, then paste each approved
template name against its event in **Transport → Setup → WhatsApp**.

While you wait, nothing is lost: every event still delivers as a push
notification. The templates:

| Event | What it says |
|---|---|
| `student_not_boarded` | Child didn't board at their stop |
| `run_delayed` | Bus is running late |
| `run_changed` | Replacement bus or route change |
| `student_boarded` | Child is on the bus |
| `student_dropped` | Child was dropped off |
| `emergency` | SOS raised on the trip |

Also in that panel: the phone number ID, a **permanent system-user** access
token (not a temporary one — temporary tokens expire in 24 hours and the
failure looks like a Meta outage), the app secret, and a verify token.

**Consent is separate and mandatory.** A family must have opted in before
anything sends; the sender skips anyone without it rather than risking the
school's number being blocked. That's recorded per student in
`student_details.whatsapp_opt_in_at`, so you need a way to collect it — an
admission-form tick box is the usual answer.

---

## 5. Decide the retention numbers

The defaults are opinions, not physics, and this is the most sensitive data the
application holds:

| What | Default | Where |
|---|---|---|
| Full-resolution fixes | 7 days | `cleanup_transport_telemetry()` |
| 30-second archived track | 180 days | `cleanup_transport_archive()` |
| Rolled-up metrics | forever | no purge job |

The archive is the one worth a deliberate decision. 180 days is about an
academic term; a school with a records-retention policy, or one in a
jurisdiction with something to say about children's location data, should set
it to whatever that policy says rather than inheriting this number by accident.
The metrics have no location in them, which is why they're kept.

## 6. Register GPS hardware, if the school has any

**Transport → Setup → GPS devices.** Each device gets a **key id** (public,
stays visible in the list) and a **secret** (shown once, never again — rotate
rather than recover).

For an AIS-140 unit, don't try to point it at EdZee directly: it pushes
comma-delimited ASCII over a raw TCP socket, which Vercel cannot terminate. The
standard mandates dual-server push, so point the device's **second** server slot
at a Traccar or flespi channel and have that forward JSON to
`/api/transport/ingest`. The statutory feed to the state backend keeps working
untouched and nothing is reconfigured away from compliance.

## 7. Issue boarding cards, if you want them

**Transport → Setup → Cards & QR.** A QR is generated, displayed once and
printable; an RFID or NFC fob is registered by its UID.

A reader that behaves as a USB or Bluetooth keyboard needs no app, no driver and
no pairing — the driver screen's scan field just receives its keystrokes. Buy
that kind. The camera path works on Android Chrome and is the fallback
everywhere else.

Boarding by tap keeps working regardless; cards are a speed-up, not a
replacement.

---

## What I'd do first

**Step 4.** It is the only remaining item with a lead time you cannot compress:
Meta takes days to approve templates, and until they do, the six messages that
matter most — didn't board, delayed, replacement bus, SOS — reach a parent only
as a push notification they may have muted. Submitting the templates is twenty
minutes of form-filling that has to start before it is needed, not when.

Then **step 6 or 7**, depending on whether the school has GPS hardware or wants
cards. Step 5 is worth ten minutes of thought and no urgency.

One thing to confirm rather than assume: the drain URL in step 3 was taken from
`.env.local`. If the school serves from a different domain, change that row.

*(An earlier draft of this list had a step about `npm run lint` being broken by
an ESLint 8/9 config mismatch. That was fixed on `main` while this work was in
progress — lint, typecheck, build and all 284 tests are green, with no warnings
left in any transport file.)*
