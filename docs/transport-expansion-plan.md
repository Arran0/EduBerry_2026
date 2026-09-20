# Transport Expansion — Round-by-Round Plan

A staged plan to grow the existing bus module into a student-centric transport
platform: live trip tracking, boarding attendance, exception handling, safety,
and vendor-neutral GPS hardware support — all inside the ERP that already holds
the students, the parents, the leave records and the messaging.

Each round is independently shippable and builds on the last.

## Where we start (current state)

**The module is switched off.** `/more/bus` renders `UnderConstruction`
(`src/app/more/bus/page.tsx:31-41`) while `/more` still advertises the tile as
*"Track your bus live, see ETA, and pay bus fees"*. The real implementation sits
below it as the unreferenced `BusPageOriginal()`.

**Schema** (`supabase-migrations/add_bus_manager.sql`): `bus_trips`,
`trip_passengers`, `trip_driver_overrides`, `trip_attendance`, `bus_locations`,
plus the fee/payroll side (`bus_fees`, `bus_payments`, `bus_fee_heads`,
`bus_fee_drafts`, `driver_payroll_*`). All are essentially unused — `bus_trips`
holds one route somebody created to try the feature out, and everything else is
empty — which is what makes the re-architecture below safe.

(Supabase's table listing reports *estimated* row counts, and reported zero for
`bus_trips`. It was one. That single row is the reason Round 1 renames rather
than drops: a drop-and-recreate would have destroyed real, if trivial, data on
the strength of a number that was never exact.)

**What `bus_trips` actually is**: a route *template* — one name, one free-text
`route_description`, one `pickup_time`, one `drop_time`, one default driver.
There is no vehicle, no ordered stop, no coordinate, no direction, and no
per-day run. `bus_locations` hangs off that template rather than off a run, and
is deleted after 24 hours.

**Types / data layer**: `src/lib/bus.ts` (1245 lines — trips, rosters,
attendance, fees, payments, drafts, payroll config), `src/lib/driverSalary.ts`,
`src/hooks/useBusLocation.ts` (realtime consumer),
`src/hooks/useDriverLocationStream.ts` (8s-throttled `watchPosition` producer).

**UI**: `TripsSection.tsx` + `TripFormModal.tsx` (five fields) for admin;
`/more/bus/trips/[tripId]` for roster and substitute drivers;
`/driver/trip/[tripId]` for the driver (a GPS toggle and a three-state tap ring);
`PassengerTripMap.tsx` for parents — the only Leaflet component in the repo.

**What is missing** (this plan delivers all of it): vehicles, ordered stops with
coordinates and geofences, route geometry, schedules and direction, per-day trip
runs, an attendant/crew concept, stop arrival/departure detection, a real
ETA-to-my-stop, delay tracking, boarding lifecycle, exception detection and
triage, notifications of any kind, SOS and incident handling, GPS hardware
support, trip replay, and reporting.

## Design commitments

These hold for every round.

1. **The subject is the child, not the bus.** Parent-facing copy, queries and
   notifications are about a named child.
2. **A trip is an instance, not a template.** Telemetry, stop events, boarding,
   delay and incidents all hang off a `transport_trip_runs` row, so history and
   replay come free.
3. **The client supplies sensor readings; the server decides outcomes** — the
   rule `gps_attendance_rebuild.sql:524-533` already sets for attendance.
4. **A GPS reading is a disc, not a point.** Stop geofences reuse
   `evaluateGeofence()` (`src/lib/geofence.ts:228`) and keep its three-way
   `inside | outside | uncertain` verdict.
5. **Position source is a detail, not an architecture.** Driver phone and
   AIS-140 hardware write the same normalized row through the same path.
6. **Exceptions are rows with a lifecycle**, not a colour computed in a
   component.
7. **Degrade, don't fail.** No GPS still gives manual attendance; no WhatsApp
   still gives push; no hardware still gives the driver's phone.
8. **No PostGIS.** A local equirectangular projection is accurate to well under
   a metre at city scale, keeps migrations free of an extension prerequisite,
   and — decisively — the geometry rules are already mirrored between
   `src/lib/geofence.ts` and SQL (`attendance_haversine_m`,
   `attendance_polygon_signed_distance_m`). `ST_` functions would fork that
   mirror for no gain at a fleet of tens.

## Round map & dependencies

| Round | Theme | Depends on |
|---|---|---|
| **1** | **Foundation — fleet, crew, routes, geofenced stops, schedules, student→stop assignments, admin management** | — |
| 2 | Live operations — trip runs, telemetry pipeline, derivation engine, driver app, parent view, fleet map & exceptions | 1 |
| 3 | Communication, safety & interop — notifications (push + WhatsApp), SOS & incidents, GPS hardware ingest | 2 |
| 4 | History & openness — telemetry archive and replay, nightly metrics and reports, card/QR boarding, GTFS export | 3 |

Three rounds, each independently shippable:

- **Round 1 is the model.** Nothing can be tracked until there is something to
  track *against* — a vehicle, an ordered list of geofenced stops, a schedule,
  and a child attached to a specific stop. It ships with the admin screens to
  manage all of it, so a school can be fully configured before any live feature
  exists.
- **Round 2 is the product.** Runs, telemetry, and everything derived from a
  position — where the bus is, which stop it has reached, how late it is, who
  boarded — plus the three surfaces that consume it: driver, parent, admin.
- **Round 3 is the reach.** Getting facts *out* (push, WhatsApp), handling
  emergencies, accepting positions from hardware EdZee doesn't own, and the
  history that makes the whole thing auditable and reportable.

The split is by dependency, not by size: Round 2 cannot be written before the
Round 1 tables exist, and Round 3's notifications have nothing to notify about
before Round 2's derivation engine produces events.

## Interoperability posture

**GTFS as vocabulary, not dependency.** Route / stop / `stop_sequence` / trip /
scheduled arrival deliberately mirror `routes.txt`, `stops.txt` and
`stop_times.txt`, and live state maps onto GTFS-Realtime's `VehiclePosition`
(position, bearing, `current_stop_sequence`) and `TripUpdate` (per-stop arrival
delay). Round 3 can therefore export a feed as a view rather than a migration.

**AIS-140 as a compatibility target, not an assumption.** Devices push
comma-delimited ASCII over raw TCP/UDP to configured backend IPs — which Vercel
cannot terminate — and the standard mandates *dual-server* push. So a school
points the device's second server slot at a gateway (Traccar or flespi) that
parses the protocol and forwards JSON to our ingest endpoint, while its
statutory feed to the state backend stays untouched. Each device row stores a
`provider` key and the raw payload, so a vendor whose fields differ is a new
adapter module, not a schema change.

---

## Round 1 — Foundation  ✅ DONE

Shipped: migration `transport_r1_foundation.sql`; `src/lib/transport/`
(`types.ts`, `vehicles.ts`, `staff.ts`, `routes.ts`, `stops.ts`,
`schedules.ts`, `assignments.ts`); `src/components/transport/TransportMap.tsx`
plus the Routes & Stops, Fleet & Crew and Assignments admin sections; the
`UnderConstruction` gate lifted off `/more/bus`.

**Goal.** Replace the template-shaped model with a real one: vehicles, transport
staff (driver *and* attendant), routes carrying an ordered list of geofenced
stops and a driven path, schedules with direction and days-of-week, and
student→stop assignments. Give the transport admin the screens to manage all of
it, including a map-based stop editor.

**Schema** — `supabase-migrations/transport_r1_foundation.sql`:

- **Rename rather than replace.** `bus_trips` → `transport_routes` and
  `trip_passengers` → `transport_student_assignments`. Postgres foreign keys
  bind to the table OID, so `bus_fees.trip_id` keeps pointing at the renamed
  table and the whole fee/draft/payroll module keeps working through the
  rename. Only the *column* is renamed (`trip_id` → `route_id`) for clarity.
  This is strictly safer than drop-and-recreate, and the tables were always
  route-shaped anyway.
- `trip_driver_overrides` is dropped — a per-date substitute driver is a
  degenerate case of a run instance, which Round 2 introduces properly.
  `trip_attendance` and `bus_locations` survive Round 1 untouched so the
  existing driver screen keeps working, and are retired in Round 2 when their
  replacements exist.
- `transport_vehicles` — registration (uniquely indexed on a
  space-and-case-normalised expression, because plates are written
  "KL07AB1234" and "KL 07 AB 1234" interchangeably), display name, capacity,
  status, and the four compliance expiry dates Indian school transport is
  audited on.
- `transport_staff` — driver and attendant details as a row, **not** a new
  `profiles.role`. Adding a role literal would mean auditing ~130 role checks
  across ~30 SQL files, a cost `add_non_teaching_staff_flag.sql:5-14` documents
  refusing to pay. Carries the fields parents and auditors actually ask for:
  phone, licence number and expiry, badge, blood group, photo, and
  `verified_at` for background verification.
- `transport_route_stops` — ordered `seq`, name, landmark, coordinates, and
  geofence columns mirroring `attendance_geofence_zones` so
  `fenceFromConfig()` consumes a stop row unchanged. Arrival/departure offsets
  are stored **per stop as minutes from the schedule's anchor**, not as clock
  times, so one stop list serves an 07:10 and an 07:40 departure without
  duplication. `UNIQUE (route_id, seq)` is `DEFERRABLE INITIALLY DEFERRED` —
  load-bearing, because drag-to-reorder rewrites every `seq` in one
  transaction and would otherwise trip the constraint mid-statement.
- `transport_route_paths` — the driven polyline per direction, with a cached
  cumulative prefix-sum array so Round 2's progress-along-route is a single
  scan rather than a re-derivation every tick.
- `transport_route_schedules` — direction, `days_of_week SMALLINT[]`, start
  time, and the vehicle/driver/attendant that seed each run.
- `transport_student_assignments` gains `pickup_stop_id`, `drop_stop_id`,
  `rides_inbound` / `rides_outbound`, validity dates and a guardian phone
  override; the old free-text `location` is kept as `location_label` so
  nothing is lost.
- RLS helpers `transport_is_transport_staff()`, `transport_route_is_mine()`,
  `transport_route_has_crew()`, `transport_stop_is_mine()` — all
  `SECURITY DEFINER STABLE SET search_path = public`, following the house
  pattern that exists to break recursive policy evaluation.
- Stops are **not** world-readable. A full stop list is a map of where
  identified children stand each morning, so a student sees only stops on a
  route they are assigned to. The `USING (true)` pattern used elsewhere in the
  codebase is deliberately not copied into this module.
- Widen the `bus_payment_method` enum. `src/lib/bus.ts:23` offers
  `card | bank | cheque` in `BUS_OFFLINE_METHODS`, but
  `add_bus_manager.sql:14` only ever created `razorpay | upi_qr | cash`, so
  `recordBusOfflinePayment()` fails on those three — a live bug found while
  surveying, fixed here.

**Data layer** — new `src/lib/transport/`, following the house
`fetchX`/`createX`/`updateX` pattern that logs and returns `[]` / `null` /
`{success, error}` rather than throwing. Honour the README conventions: never
`select('*')` on `profiles` in a join, and batch with `.in()` rather than
looping — `fetchTripPassengerCounts` (`src/lib/bus.ts:236`) fetches every
membership row to count them in JS and is the anti-pattern not to repeat.
`src/lib/bus.ts` is updated for the renamed table and column, including its
four PostgREST embed strings, which are not type-checked and fail only at
runtime.

**UI**:
- `src/components/transport/TransportMap.tsx` — the shared map extracted from
  `PassengerTripMap.tsx` (CARTO Voyager tiles, `L.divIcon` markers, still
  `dynamic({ ssr: false })` because Leaflet touches `window` at import time).
  Renders any combination of bus, stops, path and school, and supports
  click-to-place editing.
- **Routes & Stops** — route list, then a split map/list stop editor: click the
  map to add a stop, drag to move, slider for the geofence radius, drag to
  reorder, and a use-my-location capture reusing `FenceEditor.tsx`'s rule that
  refuses fixes worse than 30 m.
- **Fleet & Crew** — vehicles with compliance expiries surfaced as warnings,
  and driver/attendant records.
- **Assignments** — pick a route, assign students to a pickup and a drop stop,
  with seats-used shown against the vehicle's capacity.
- The `UnderConstruction` gate comes off `/more/bus`.

**Acceptance.** An admin can create a vehicle, draw a route with ≥3 geofenced
stops on a map, attach morning and afternoon schedules, record a driver and an
attendant, and assign students to their stops — and issuing a bus fee, creating
a monthly draft and running a payroll cycle all still work against the renamed
table.

---

## Round 2 — Live operations  ✅ DONE

Shipped: migrations `transport_r2_a_runs_and_telemetry.sql`,
`transport_r2_b_derivation.sql`, `transport_r2_c_schedule_and_retire.sql`;
`src/lib/transport/{runs,path}.ts`; `src/hooks/{useTransportStream,useRunLive,useChildTransport}.ts`;
the rewritten driver app at `/driver` and `/driver/run/[runId]`; the parent
`ChildTransportView`; and the admin `LiveSection`. `bus_locations`,
`trip_attendance` and `trip_driver_overrides` are retired.

**Goal.** Make a trip a real, running thing, and put it in front of the three
people who need it. One normalized write path that driver phones and (in Round
3) GPS hardware both use, with all per-fix derivation hanging off the telemetry
insert so no source can skip a rule.

**Schema** — `transport_r2_live.sql`:
- `transport_trip_runs` — the instance, and the single row a parent subscribes
  to. Vehicle, driver and attendant are snapshotted onto it, so a replacement
  bus or a substitute driver is just a different value and the history stays
  truthful. Carries a denormalised live summary (`last_lat`, `last_fix_at`,
  `telemetry_state`, `current_stop_id`, `next_stop_eta_at`, `delay_minutes`,
  `progress_m`) written only by the derivation path.
- `transport_run_stops` — the per-run stop plan: scheduled arrival, rolling
  ETA, actual arrival and departure, and a **generated** `delay_minutes`
  column, which gives the on-time report for free.
- `transport_run_passengers` (state) + `transport_boarding_events` (audit), and
  a `transport_mark_boarding()` RPC that authorises, appends, upserts and
  counts in one transaction — which is what makes "child boarded" a single
  atomic, idempotent, notifiable fact. Retires `trip_attendance`.
- `transport_telemetry_sources` + `transport_telemetry`, retiring
  `bus_locations`. `BIGSERIAL` key rather than UUID: this is the
  highest-write table in the schema and a monotonic key gives free insertion
  ordering, a cheap replay cursor, and roughly half the index footprint.
  `UNIQUE (source_id, recorded_at)` makes a device redelivery and an offline
  queue flush both free. `recorded_at` (device clock) and `received_at`
  (server clock) are separate columns precisely so a queue flushed after a
  ten-minute dead zone is correct by construction.
- `transport_apply_fix()` — an `AFTER INSERT` trigger on telemetry doing the
  per-fix work: advance the run summary (guarded so an out-of-order fix is
  stored but never rewinds the live position), and evaluate the next two stops'
  geofences. **This trigger is the load-bearing choice of the design** —
  hardware and phone get identical stop detection for free, and no adapter can
  skip it.
- `transport_tick()` on pg_cron, doing the work that must happen when *nothing*
  is happening: offline detection, ETA and delay recomputation, deviation, long
  stop, wrong direction, auto-start and auto-complete. Guarded by
  `pg_try_advisory_lock` so a slow tick can never overlap itself, and followed
  by `REVOKE EXECUTE … FROM anon, authenticated` — not optional, or any signed-in
  user could drive the state machine over PostgREST.
- `transport_alerts`, with a partial unique index on `dedupe_key WHERE status IN
  ('open','acknowledged')` so a forty-minute deviation is one row with an
  occurrence count, not forty rows.
- Nightly run materialisation from schedules, skipping `attendance_holidays`
  and creating students with approved leave as `excused` — see below.
- Telemetry retention at 7 days live (Round 3 adds the downsampled archive).

**Geometry.** Reuse, don't reinvent: `attendance_haversine_m` and
`attendance_location_verdict` are called verbatim for stop arrival, so the stop
geofence obeys exactly the rules the attendance module already argues for —
including that an `uncertain` verdict is *recorded* but does **not** fire an
arrival. One new function, `transport_point_to_path_m`, returns distance to the
route corridor plus progress along it; its TypeScript mirror imports
`distanceToSegment` from `src/lib/geofence.ts` rather than copying it, and that
file's "if you change a rule here, change it there too" note is extended to
name it.

**ETA.** Remaining distance *along the route path* to the target stop, over an
EWMA of recent speed clamped to a sane band (a bus at a red light reports 0 km/h
and would otherwise yield an infinite ETA), plus dwell time for intervening
stops. **`eta_at` is set to NULL whenever telemetry is not live** — the UI
degrades to the scheduled time and "last seen 6 minutes ago". A confidently
wrong ETA is worse than an honest absence, and this rule belongs in the engine,
not the UI.

**UI**:
- **Driver** — today's runs with one Start button; then a stop-by-stop screen,
  current stop pinned with the students expected *there*, one tap per child.
  Geofence auto-advances the stop; the driver can override. Wake lock, an
  IndexedDB queue that survives signal loss, adaptive cadence (5s moving / 20s
  stationary), and resume-on-reload — the current stream silently dies when the
  tab is backgrounded, which for a bus app is total failure. End-of-run
  reconciliation refuses to close with a child still aboard.
- **Parent** — the child-centric screen: a one-sentence hero state, a map with
  bus, route, *their* stop and school, ETA to their stop with
  scheduled-vs-projected, current and next stop, the boarding timeline, and the
  crew card. Not-today states matter equally: holiday, "marked on leave so we
  won't expect him", "bus hasn't started yet".
- **Admin** — every active run on one map with a rail of open exceptions
  ordered by severity, and an exception inbox with acknowledge/resolve.

**Leave integration.** At run materialisation, a student with an approved leave
covering the service date is created as `excused`, which suppresses the
not-boarded exception entirely. Without this, every Monday produces a wall of
false alarms and parents learn to ignore the channel — the failure mode that
kills this class of product.

**Acceptance.** A driver starts a run and the bus appears live; arriving at a
stop raises an arrival and advances the current stop with nobody touching
anything; the parent sees the ETA to their own stop counting down and updating
without a reload; backgrounding the driver app does not kill the stream;
cutting telemetry flips the run offline, nulls every ETA and opens exactly one
alert; a run cannot be closed with a child unaccounted for.

---

## Round 3 — Communication, safety & interop  ✅ DONE

Shipped: migrations `transport_r3_a…f`; the notification outbox with per-event
channel routing and quiet hours; the extracted `src/lib/notifications/push.ts`
(with `announcements/notify` and `leave/notify` refactored onto it); the
WhatsApp adapter with Meta Cloud as its first driver; SOS with a frozen
context snapshot and the admin incident console; and `/api/transport/ingest`
with `generic`/`traccar`/`flespi` adapters plus the device registry.

The four items deferred from this round — the telemetry archive and replay,
the metrics rollup and reports, card/QR boarding, and the GTFS export — became
Round 4 rather than being half-built here.

**Goal.** Get the facts out, handle the emergencies, accept positions from
hardware EdZee doesn't own, and keep the history that makes it auditable.

**Notifications** — `notification_outbox` with a `UNIQUE dedupe_key`, which is
what makes "notify once" true no matter how many times the tick re-evaluates a
condition: enqueue is `INSERT … ON CONFLICT DO NOTHING` and the tick carries no
notification state at all. A pg_cron job drains it through `pg_net` into
`/api/transport/notify/drain`, claiming rows with `FOR UPDATE SKIP LOCKED` so
overlapping drains are safe. A Vercel Cron entry on the same idempotent
endpoint is a zero-cost backstop, and a watchdog raises a critical alert if
anything sits queued past its `not_before` — a queue that isn't draining must
itself be an alert, because a missing notification is indistinguishable from a
missing event.

`src/lib/notifications/push.ts` is extracted with
`sendPushToUsers(admin, userIds, payload)`, absorbing the send loop currently
copy-pasted into `announcements/notify/route.ts:161-184` and
`leave/notify/route.ts:195-218`, with chunked concurrency replacing their
unbounded `Promise.all`. **Both routes are refactored onto it in this round** —
extracting a helper and leaving the copies behind is how you get three copies.
`public/sw.js` needs no change; it is already payload-driven.

**WhatsApp** — a provider-agnostic `MessagingAdapter` with Meta Cloud API as
the first driver. The orphaned `whatsapp_secrets` table (which exists in the
live database with no migration and nothing reading it, in exactly the
`payment_secrets` shape) is adopted and generalised to `integration_secrets`,
read server-side through a `serverSecrets.ts`-style reader where a DB value
wins and an env var is the self-hosting fallback. WhatsApp is reserved for the
six events where a missed push has real consequence — child didn't board, child
not dropped off, delay, route/vehicle change, cancellation, emergency — which
is both the anti-fatigue rule and the cost control, since Meta charges per
conversation. Quiet hours defer or skip by priority; emergencies ignore them.
`student_details` gains `guardian_phone` and `whatsapp_opt_in_at`, the latter
being the opt-in evidence Meta requires and which the drain refuses to send
without.

**Safety** — `transport_incidents` with a `transport_raise_incident()` RPC that
freezes a `snapshot JSONB` of crew, vehicle, the onboard roster, the last fix
and the trip context at the moment it fires, and never recomputes it. That is
the whole point: an incident is a legal and parental record, and reconstructing
"who was on the bus" three days later from live tables gives a different answer
than what the driver saw. Updates are appended to
`transport_incident_updates`, never overwritten. Parents receive a
notification, not the incident row — it names other people's children.

**Hardware** — `POST /api/transport/ingest`, HMAC-signed over
`${timestamp}.${body}` with a replay window, which is the same verification
shape the existing Razorpay and bank webhooks already use. It resolves
`externalId → source → vehicle → active run` and calls the same write path as
the driver phone. Adapters for `generic`, `traccar` and `flespi` normalise
vendor fields — including converting every speed to km/h, a small decision that
prevents an ETA wrong by a factor of 3.6. When a device and a phone both report
on one run, both are stored and the lower-priority-number source wins, with
hysteresis so a tunnel gap doesn't flap the map. Responses are always `202` with
a per-fix tally, because devices retry forever on error and one malformed field
must not wedge the stream.

Documented gateway recipe: point the device's *second* AIS-140 server slot at a
Traccar or flespi channel that parses the protocol and forwards JSON to the
ingest endpoint. The standard's dual-server mandate is what makes this clean —
the statutory feed to the state backend is untouched and no vendor is displaced.

**History, reports, interop** — telemetry downsampled into an archive at 30s
resolution for 90 days while the live table stays at 7; a replay scrubber; a
nightly rollup into `transport_run_metrics` feeding on-time performance,
utilization, delay-by-stop and GPS/device health (never a live aggregate over
the telemetry table); RFID/NFC/QR boarding, which the
`transport_scan_method` enum has carried since Round 2 precisely so this adds a
reader and not a schema; and GTFS static plus a GTFS-Realtime
`VehiclePosition`/`TripUpdate` feed as views over the existing model.

**Acceptance.** Every event fires exactly once per run; running the tick twice
sends nothing twice; a not-boarded event delivers a WhatsApp message and flips
to `delivered` on the status webhook, while an un-opted-in number is skipped
with a clear reason; an SOS produces an incident whose snapshot still names
everyone aboard after the route is later edited; a signed `curl` and a driver
phone can both feed one run and the device wins; a run from 60 days ago replays.

---

## Round 4 — History & openness  ✅ BUILT · ✅ APPLIED

Shipped in code: migrations `transport_r4_a…e`; the downsampled telemetry
archive with `transport_replay_run` and the admin History tab's replay
scrubber; the nightly metrics rollup with five reports and CSV export;
RFID/NFC/QR credentials with a driver-side scan field; and the GTFS static
(`.zip`) and GTFS-Realtime exports.

> **Applied to the live project (`tgxxqzeaqxiwoqzopcku`) on 2026-09-20**, in
> the order a → b → c → d, then `e`. Verified afterwards: all four tables and
> all fifteen functions exist; `transport-archive-telemetry` (02:30) sits
> before `cleanup-transport-telemetry` (03:00) with `cleanup-transport-archive`
> (03:15) and `transport-rollup-metrics` (03:45) after it; `get_advisors`
> returns no ERROR-level lint and no new `auth_rls_initplan` or duplicate-policy
> finding from the new tables.
>
> The audit that followed found one real hole, which `transport_r4_e` closes:
> `transport_tick()` had never been revoked from `PUBLIC`, so any signed-in
> account could drive the school's alerting pass through
> `/rest/v1/rpc/transport_tick`. See that migration's header.

**Goal.** Make the history answerable, the operation measurable, boarding
faster without making it less supervised, and the school's own timetable
portable.

**Archive & replay.** `transport_telemetry` keeps 7 days at full resolution and
is then purged, which is right for the firehose and wrong for the product:
"show me what happened on Tuesday" is asked on Thursday. Finished runs are
folded to one fix per 30 seconds into `transport_telemetry_archive` and kept
180 days — enough to draw the line and say where the bus was at 07:41, and
deliberately too coarse to reconstruct a child's doorstep. `suspect` fixes
never enter it. `DISTINCT ON` takes the first fix in each bucket rather than an
average, because an averaged position is a place the bus never was and on a
curve can be the wrong side of the road. `transport_replay_run` merges archive
and firehose, so a run from this morning replays at full resolution and one
from last month replays coarsely without the caller knowing which. A parent
sees only their own child on the timeline; crew and admin see the roster.

**Metrics & reports.** `transport_run_metrics` and `transport_stop_metrics` are
written nightly, idempotently by primary key — a run an admin reconciles the
next morning must be able to change yesterday's figures. Reports read the
rollup and never aggregate live tables. Two judgements are in the numbers:
coverage is measured against the run's own elapsed time, so a run that ended
early was not offline for the remainder; and excused absences are not no-shows,
because a child on approved leave was never expected and counting them as waste
would make every Monday look broken. The screen leads with GPS coverage, which
decides whether the rest can be believed, and states that today is absent until
tomorrow's rollup. `transport_report_attendance_mismatch` — boarded the bus,
marked absent in class, leave already excluded — is the report a standalone
tracker structurally cannot produce.

**Card & QR boarding.** `transport_scan_method` has carried `rfid`/`nfc`/`qr`
since Round 2 on the promise that a reader would be a reader and not a schema
change; `transport_student_credentials` is that reader. Tokens are stored as
SHA-256 only. A scan resolves a token to a student and then goes through
`transport_mark_boarding` like every other boarding, so a card can do nothing a
tap could not — and the attendant still sees the name that comes back, which is
what catches a child holding a friend's card. A card whose owner is not on that
bus is a loud, specific answer rather than a failure. On the device: an RFID or
NFC reader behaves as a keyboard, so a focused text field is the whole
integration, and a printed QR goes through `BarcodeDetector` where it exists.

**GTFS.** The receipt on Round 1's bet that adopting the vocabulary would make
an export a view rather than a migration — not one column was added.
`transport_gtfs_static()` emits the six required files plus `shapes.txt`;
`transport_gtfs_realtime()` emits `VehiclePosition` and `TripUpdate` as JSON,
with protobuf encoding left to a route rather than to PL/pgSQL. The realtime
feed inherits the ETA engine's honesty rule: a run whose telemetry is not live
emits no `VehiclePosition` at all, because a consumer cannot tell a stale
position from a fresh one and will draw the bus somewhere it is not.

**Acceptance.** A run from 60 days ago replays with its stop times and
boardings; running the rollup twice over one date changes no number; a QR
issued to a child on route A is refused loudly when scanned on route B; the
GTFS `.zip` validates and contains a stop whose name has a comma and a quote
in it; a run whose telemetry went offline appears in `TripUpdate` and not in
`VehiclePosition`.

---

## Verification (every round)

**Static.** `npm run lint` and `npx tsc --noEmit` clean.

**Database.** Run the migration in the Supabase SQL editor — the house method;
every migration header says so and they are written idempotent — then check
`list_tables` for shape and the Supabase advisors for **security** and
**performance**. The project already tracks the `auth_rls_initplan` and
unindexed-FK lints, and new tables must not regress them. Re-run
`optimize_rls_scope_to_authenticated.sql` and `optimize_rls_wrap_auth_calls.sql`,
which are written to be re-runnable and will catch any policy authored without
`TO authenticated` or with a bare `auth.uid()`.

**End-to-end.** `scripts/simulate-trip.ts` drives a route's own `path` at a set
speed into `/api/transport/ingest`, which makes every timing-dependent
behaviour testable without driving a bus — and doubles as the demo. Against a
seeded route of four stops and six students: stop arrivals fire at the
geofences, `current_stop_seq` advances, the ETA to a chosen stop falls
monotonically, the parent screen updates live without a reload, the sixth
student raises a not-boarded alert unless first marked on leave, cutting
telemetry opens and closes a `bus_offline` alert, and a run refuses to close
with a child still onboard.
