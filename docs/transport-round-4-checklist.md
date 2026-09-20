# Transport — what's left for you

Everything in the transport module is built and pushed. This is the list of
things that need a human, either because they need a credential this session
didn't have or because they involve a third party.

Ordered so that each step makes the next one possible. **Steps 1–3 are
load-bearing: until they're done, Round 4 is inert code.** Everything from
step 5 down is improvement, not repair.

---

## 1. Re-authorise the Supabase connector — *blocks everything below*

The Supabase connector was disconnected for this work, and there's no database
password or connection string on disk, so the four Round 4 migrations could not
be applied the way Rounds 1–3 were. Nothing else here can happen first.

- claude.ai → **Settings → Connectors → Supabase → Connect**, or run `/mcp` in
  an interactive Claude Code session.

Once it's connected, I can run step 2 for you and verify it against the live
schema — that's the better path, because I can check the result rather than
hand you SQL and hope.

## 2. Run the four Round 4 migrations — *in this order*

In the Supabase SQL Editor (the house method — every migration header says so,
and they're written idempotent, so re-running one is safe):

1. `supabase-migrations/transport_r4_a_archive_and_replay.sql`
2. `supabase-migrations/transport_r4_b_metrics_and_reports.sql`
3. `supabase-migrations/transport_r4_c_scan_boarding.sql`
4. `supabase-migrations/transport_r4_d_gtfs.sql`

Order matters: `b` reads tables `a` creates, and both schedule pg_cron jobs that
have to interleave correctly with the existing telemetry purge.

**Until these run**, the History tab, the Reports tab, the Cards & QR tab, the
Open data tab and the driver's scan field will all load and then fail with a
missing-function error. That's expected, not a bug.

### Then check three things

- **`get_advisors` for `security` and `performance`.** The project already
  tracks the `auth_rls_initplan` and unindexed-FK lints; the new tables must not
  regress them.
- **Function grants.** Re-run `optimize_rls_scope_to_authenticated.sql` and
  `optimize_rls_wrap_auth_calls.sql` — both are written to be re-runnable and
  will catch any policy authored without `TO authenticated` or with a bare
  `auth.uid()`. Then confirm `anon` has **no** EXECUTE on anything named
  `cleanup_*`, `transport_tick`, `transport_archive_telemetry`,
  `transport_rollup_metrics` — an earlier round found a blanket
  `GRANT ALL ON ALL ROUTINES` had quietly re-granted those.
- **The cron jobs exist.** `SELECT jobname, schedule FROM cron.job ORDER BY jobname;`
  should include `transport-archive-telemetry` (02:30 UTC),
  `cleanup-transport-archive` (03:15) and `transport-rollup-metrics` (03:45),
  alongside the existing `transport-tick`, `transport-materialise-runs` and
  `cleanup-transport-telemetry` (03:00).

  The 02:30 → 03:00 ordering is the important one: **the archiver has to run
  before the purge deletes the fixes it archives.** If you move either job,
  keep that gap.

## 3. Fill in `transport_runtime_config` — *notifications are silent without it*

Two rows, and nothing sends until both exist:

```sql
INSERT INTO public.transport_runtime_config (key, value) VALUES
  ('drain_url',   'https://YOUR-DOMAIN/api/transport/notify/drain'),
  ('cron_secret', 'a long random string you generate')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

- `drain_url` must be the **deployed** URL. pg_net calls it from Supabase's
  network, so `localhost` will fail silently.
- `cron_secret` is compared in constant time by the drain endpoint. Generate it
  with `openssl rand -hex 32` — don't pick something memorable.

**Verify it works** rather than assuming: enqueue a test row and watch it leave.

```sql
SELECT public.transport_kick_drain();
-- then, a few seconds later:
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

If you only do one thing: **step 1, then let me run step 2.** Everything else
can wait, and verifying a migration against the live schema is worth more than
verifying it by reading.

Steps 3 and 4 are what turn a tracking screen into a product a parent notices —
a school running without them has GPS, but no one is being told anything.

*(An earlier draft of this list had a step about `npm run lint` being broken by
an ESLint 8/9 config mismatch. That was fixed on `main` while this work was in
progress — lint, typecheck, build and all 284 tests are green, with no warnings
left in any transport file.)*
