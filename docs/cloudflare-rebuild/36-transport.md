# Transport

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). Design history: `docs/transport-expansion-plan.md` (rounds 1 to 5b applied) and `docs/transport-round-4-checklist.md`. GPS gateway status: `docs/gps-system-status.md`. Related docs:

- Bus fees are fee bills: [33-fees.md](33-fees.md).
- Driver payroll: [34-payroll-and-salary.md](34-payroll-and-salary.md).
- The notification outbox: [14-jobs-messaging-realtime.md](14-jobs-messaging-realtime.md).

## 1. Summary

The school bus system has these parts:

- **Setup:** a fleet (vehicles with document expiry dates), crew (drivers and attendants with licence details), routes with ordered geofenced stops, route paths, and weekly schedules. Each student is assigned to a pickup and a drop stop.
- **Daily runs:** each day's bus trips are created from the schedules.
- **Driver app:** starts and ends a run, sends GPS fixes from the phone, and marks boarding by hand, RFID/NFC card or QR.
- **Derivation engine:** for every fix it decides stop arrivals and departures, ETAs, delay, distance along and off the route, and alerts.
- **Parent view:** "where is my child's bus" and an ETA to the child's stop.
- **Admin:** a live operations board, alerts with a lifecycle, SOS and incidents, push and WhatsApp notifications, replay of past runs, nightly metrics with five reports, GTFS static and realtime exports, and GPS hardware ingest through a shared Traccar gateway.

Almost all of the logic is in the database: 53 functions (about 2,100 lines of PL/pgSQL, 7 of them trigger functions) and 8 cron jobs. That makes transport the largest move from SQL to TypeScript in the rebuild after fees.

Live data:

| Area | Live |
| --- | --- |
| Routes and stops | 4 routes, 22 stops, 4 route paths |
| Fleet and crew | 3 vehicles, 1 crew member |
| Assignments and schedules | 39 student assignments, 0 schedules |
| Runs | 3, all from 22 Sep, all closed as `abandoned` |
| Alerts | 6,805 (6,788 `no_gps`) |
| Telemetry | 1 telemetry source, 1 boarding credential; 0 raw fixes (cleared after 7 days) |
| Notifications | Push: 68 sent, 19 skipped. WhatsApp: 27 failed (shared outbox) |

The 6,788 alerts all came from those 3 runs. Two defects combined:

1. Passengers were left marked `boarded`, so the runs could never auto-complete and stayed `in_progress` for 24 days.
2. The `no_gps` dedupe key included a 15-minute bucket, so each quarter hour opened a new alert.

Both were fixed by `transport_bounded_alert_lifecycle.sql`: stable keys, plus a 6-hour abandon backstop. The rebuild must keep both fixes.

The GPS gateway is built but not live. The device-link API and the Traccar client exist only on branch `claude/quirky-feynman-jxi3p0`, which is not merged into main.

What changes:

1. **The derivation engine moves into TypeScript** in the school object. It runs once per fix, as today, with no trigger chain.
2. **Positions stop being database rows.**
   - Each bus's live state is kept in memory and persisted as one summary row on each event, and at most every 30 seconds.
   - The trail is written as one chunk row per minute, then saved to R2 as one file per run.
   - This removes about 90% of transport's write cost ([02-cost-study.md](02-cost-study.md)).
3. **Live updates use the school object's WebSockets** (hibernation API), tagged by run. They replace Supabase Realtime on four tables.
4. **The minute tick becomes a school alarm** that runs only during the school's transport window, in the school's time zone.
5. **The Traccar admin token becomes one platform secret** that no school deployment can read. This closes the shared-token gap in `docs/gps-system-status.md`.

## 2. Users and screens

| Route or component | Who | Purpose |
| --- | --- | --- |
| `/more/bus` (315 lines) | Admin, transport managers | Hub with the tabs Live (operations board, map, alerts, insights), Configuration (routes and stops, fleet and crew, schedules, assignments), Bus fees, and Driver payroll. Behind a **Manage** pop-up: devices, WhatsApp, scan, replay, incidents, school location and map provider. Old `?tab=` links still resolve |
| `/more/bus/routes/[routeId]` | Admin | Route workspace: stop editor on the map, path, fees per stop |
| `/more/bus/fees` | Admin | Redirects to the Bus fees tab (issued through the fee module) |
| `/more/bus/payroll/*` | Admin | Driver payroll cycles, base, bank, settings ([34](34-payroll-and-salary.md)) |
| `/driver` (211 lines), `/driver/run/[runId]` (425 lines) | Drivers, attendants | Today's runs; start and end a run; GPS stream; passenger list with boarding; card or QR scan; SOS |
| `/driver/salary` | Drivers | Own pay |
| `ChildTransportView` (on `/more/bus` for students and parents) | Students, parents | The child's bus live: position, next stop, ETA to the child's stop, boarded or dropped |
| `BusFeeReminder` | Students, parents | Outstanding bus fee notice |

Code:

- `src/lib/transport/*`: about 3,400 lines, with modules for assignments, credentials, devices, fees, gtfs, mapTiles, path, replay, reports, routes, runs, schedules, settings, snapshot, staff, stops, types and vehicles, plus `adapters/` for generic, Traccar and flespi.
- `src/lib/gpsAcquisition.ts`: phone GPS sampling, accuracy filtering and an IndexedDB buffer.
- `src/lib/bus.ts`: legacy bus fees and driver records.
- The hooks `useTransportStream`, `useRunLive` and `useChildTransport`.
- About 8,500 lines of components under `src/components/transport`, including `TransportMap` (Leaflet, OSM or Mapbox tiles) and `ReplayPlayer`.

## 3. How it works today

1. **Setup.**
   - Routes carry a direction, colour, defaults (vehicle, driver, attendant), a school stop, settings, and a fee mode.
   - Stops have a position, a circle or polygon geofence, a trusted accuracy, inbound and outbound offsets, a dwell time, and a kind (stop, school, depot).
   - Paths are stored as a polyline with cumulative distances and a corridor width.
   - Assignments link a student to a route with pickup and drop stops and inbound and outbound flags.
   - `transport_route_year_cascade` and `transport_fill_academic_year` stamp the academic year. `transport_copy_year` clones a year's setup.
2. **Runs.**
   - `transport_materialise_runs(date)` runs at 21:30 UTC (03:00 IST). It creates tomorrow's runs from active schedules, snapshotting the vehicle, driver and attendant, and creates the run stops (scheduled arrival from the stop offsets) and run passengers (expected riders).
   - Admins can create replacement runs, cancel runs, and add change notes.
3. **Driving.**
   - The driver taps start (`transport_start_run`).
   - The phone samples GPS (`gpsAcquisition.ts`: every 5 s while moving, every 20 s while parked, dropping poor accuracy) and inserts rows into `transport_telemetry` straight from the browser. Row-level security checks that the caller is the run's crew. Offline fixes are buffered in IndexedDB and pushed in a batch later.
4. **Derivation.** The trigger `transport_apply_fix` calls `transport_process_fix` on every fix, which:
   - projects the fix onto the path (`transport_point_to_path_m`) to get progress and off-route distance;
   - evaluates the stop geofences with the inside / outside / uncertain verdict (mirrors `src/lib/geofence.ts`);
   - writes arrival and departure stop events;
   - recomputes ETAs (`transport_recompute_eta`);
   - updates the run's live summary (last position, telemetry state, current and next stop, delay, progress);
   - raises or clears alerts (`transport_raise_alert`, `transport_clear_alert`) for deviation, wrong direction, overspeed and long stops.

   Fixes flagged suspect (an impossible jump) are kept but not used for derivation.
5. **Tick.** `transport_tick()` runs every minute, all day. It:
   - finds stale or offline telemetry (`no_gps`, `device_offline`);
   - finds runs not started, and delays;
   - finds skipped stops and children not boarded or not dropped;
   - auto-starts and auto-completes runs;
   - applies the 6-hour abandon backstop;
   - auto-resolves alerts that no longer apply (`transport_resolve_moot_alerts`).
6. **Boarding.** `transport_mark_boarding` (manual) and `transport_scan_boarding` (card or QR token, hashed, matched in `transport_student_credentials`) do four things in one transaction: authorise the caller, append to `transport_boarding_events`, upsert `transport_run_passengers`, and update counts. Undo is supported.
7. **Notifications.**
   - The triggers `transport_notify_run_started`, `transport_notify_stop_event`, `transport_notify_boarding` and `transport_notify_alert` enqueue rows in `notification_outbox`, keyed by a unique `dedupe_key`, with per-event channel routing and quiet hours.
   - `transport_kick_drain` (cron, every minute) calls `/api/transport/notify/drain` through `pg_net`. The drain claims rows with `FOR UPDATE SKIP LOCKED` and sends web push and WhatsApp (Meta Cloud).
   - `transport_watch_outbox` raises an alert if rows sit queued too long.
   - `transport_student_contact` returns the guardian's phone for WhatsApp. Its execute grant was revoked from users in round 5, after it was found to leak any family's number.
8. **SOS and incidents.** `transport_raise_incident` (from the driver app or `SosButton`) freezes a context snapshot (run, position, crew, riders) and alerts admins. `transport_incident_updates` keeps the response log.
9. **History.**
   - Nightly at 02:30, `transport_archive_telemetry` thins fixes older than 2 days into `transport_telemetry_archive` (one per time bucket, kept 180 days).
   - `cleanup_transport_telemetry` deletes raw fixes older than 7 days.
   - `transport_replay_run` serves the replay scrubber.
10. **Metrics and reports.** `transport_rollup_metrics` (nightly at 03:45) fills `transport_run_metrics` and `transport_stop_metrics`. Five reports read them: on-time, delay by stop, utilisation, GPS health, and attendance mismatch. Reports export to CSV.
11. **GTFS.** `transport_gtfs_static` returns GTFS-shaped arrays and `gtfs.ts` zips them in the browser. `transport_gtfs_realtime` returns vehicle positions and trip updates.
12. **Hardware ingest.**
    - An AIS-140 bus unit's second server slot points at the shared Traccar gateway (DigitalOcean). The gateway decodes positions, keeps one fix per 15 s, and forwards JSON to `/api/transport/ingest?key=...&secret=...` for each device.
    - The ingest route checks the source's key and secret (or an HMAC header with a timestamp, for the generic adapter), drops stale, future and inaccurate fixes, flags implied speeds over 150 km/h, and inserts into the same `transport_telemetry` table. Device fixes therefore go through exactly the same derivation as phone fixes.
    - Linking a device sets its Traccar forward URL and owner, using one Traccar admin token that every school deployment holds. This code is branch-only.
13. **Simulation.** `transport_simulate_day` and `transport_simulation_clear` generate a synthetic day for demos and tests (round 5b).
14. **Live screens.**
    - Supabase Realtime streams `transport_trip_runs`, `transport_run_stops`, `transport_run_passengers` and `transport_alerts` to the operations board, the driver app (`useRunLive`), and the parent view (`useChildTransport`, one channel per active run).
    - `transport_today_snapshot` loads the board in one call.

## 4. Data

35 tables in [reference/live-schema.md §36](reference/live-schema.md#36--transport). Groups:

| Group | Tables (rows) |
| --- | --- |
| Setup | `transport_routes` (4), `transport_route_stops` (22), `transport_route_paths` (4), `transport_route_schedules` (0), `transport_vehicles` (3), `transport_staff` (1), `transport_student_assignments` (39), `transport_stop_fees` (0), `transport_student_credentials` (1), `transport_runtime_config` (2) |
| Runs | `transport_trip_runs` (3), `transport_run_stops` (15), `transport_run_passengers` (24), `transport_stop_events` (24), `transport_boarding_events` (0) |
| Positions | `transport_telemetry_sources` (1), `transport_telemetry` (0, kept 7 days), `transport_telemetry_archive` (0, kept 180 days) |
| Exceptions | `transport_alerts` (6,805), `transport_incidents` (0), `transport_incident_updates` (0) |
| Metrics | `transport_run_metrics` (0), `transport_stop_metrics` (0) |
| Legacy bus fees | `bus_fees` (2), `bus_payments`, `bus_fee_heads`, `bus_fee_drafts`, `bus_fee_draft_passengers` (0 each). Superseded by fee bills under the transport head; `fee_import_bus_ledger` imports them |
| Legacy driver payroll | `driver_payroll_base` (9), `driver_bank_accounts` (5), `driver_payroll_cycles`, `driver_payroll_records`, `driver_payroll_record_items`, `driver_payroll`, `driver_payroll_items` (0 each) |

Enums: 18 `transport_*` types (alert type, severity and status; boarding event and state; direction; event, fix and source kinds; incident type and status; run status; scan method; staff kind; stop event type; stop kind; telemetry state; vehicle status).

`integration_secrets` holds each device's ingest secret (`telemetry:<sourceId>`) and the WhatsApp credentials.

## 5. Logic in the database

| Function or trigger | Target |
| --- | --- |
| `transport_apply_fix` (trigger) → `transport_process_fix`, `transport_point_to_path_m`, `transport_recompute_eta` | `transport.live.ingestFix(runId, fix)`: TypeScript engine (`engine/derive.ts`), one call per fix or batch. `path.ts` and `geofence.ts` already hold the geometry; the SQL rules port next to them, with tests |
| `transport_tick`, `transport_resolve_moot_alerts`, `transport_humanise_gap` | `transport.tick()` from the school alarm, every minute during the transport window only |
| `transport_raise_alert`, `transport_clear_alert` | `alerts.raise(key, ...)` / `alerts.clear(key)` with the stable dedupe keys from the lifecycle fix |
| `transport_materialise_runs` | `transport.runs.materialise(date)` as a due job at 03:00 school time |
| `transport_start_run`, `transport_end_run` | `transport.runs.start` / `end` |
| `transport_mark_boarding`, `transport_scan_boarding`, `transport_issue_credential`, `transport_register_card` | `transport.boarding.mark` / `scan`, `transport.credentials.*` (each one transaction) |
| `transport_notify_*` (4 triggers), `transport_notify_student`, `transport_kick_drain`, `transport_watch_outbox` | Explicit `outbox.enqueue` calls in the methods that make the change; the outbox queue and watchdog ([14](14-jobs-messaging-realtime.md)) |
| `transport_student_contact` | Internal helper inside the outbox consumer; never a method |
| `transport_raise_incident` | `transport.incidents.raise` (the SOS path: written first, then fanned out) |
| `transport_archive_telemetry`, `cleanup_transport_telemetry`, `cleanup_transport_archive` | Replaced by trail files in R2 with a lifecycle rule (§9) |
| `transport_replay_run` | `transport.replay(runId)`: reads the run's trail file |
| `transport_rollup_metrics`, `transport_report_*` (5) | `transport.metrics.rollup(date)` at run end (not nightly), and `transport.reports.*` |
| `transport_gtfs_static`, `transport_gtfs_realtime` | `transport.gtfs.static` (zip built in the Worker) and `transport.gtfs.realtime`, public per school if enabled |
| `transport_today_snapshot`, `transport_route_counts` | `transport.board(date)` |
| `transport_copy_year`, `transport_route_year_cascade`, `transport_fill_academic_year`, `transport_academic_year_for` | `transport.copyYear`; the year is set explicitly on write |
| `transport_simulate_day`, `transport_simulation_clear` | `transport.simulate.*`, admin only, blocked on production schools unless enabled |
| `is_trip_driver`, `is_trip_passenger`, `transport_is_crew`, `transport_is_transport_staff`, `transport_route_is_mine`, `transport_run_is_mine`, `transport_stop_is_mine`, `transport_route_has_crew` | `authz` relationship helpers |

## 6. Server routes and integrations

| Route | Target |
| --- | --- |
| Browser inserts into `transport_telemetry` | `POST /api/transport/runs/<runId>/fixes` (batch of up to 50) → `transport.live.ingestFixes`; the crew is checked in the object |
| `/api/transport/ingest` | `POST /hooks/<schoolId>/gps/<sourceId>?key=...&secret=...` (Traccar cannot sign, so the secret stays in the URL). Also an HMAC header form for vendor APIs that can sign |
| `/api/transport/notify/drain` | Removed. The `outbox` queue consumer sends push and WhatsApp |
| Device link API (branch only) | `transport.devices.link` / `relink` / `rotate` / `remove`: the platform Worker calls Traccar with the platform's admin token, setting the forward URL to `/hooks/<schoolId>/gps/<sourceId>` |
| Supabase Realtime channels | WebSocket at `/api/live` with topics `transport:board`, `transport:run:<runId>` and `transport:child:<studentId>` ([14](14-jobs-messaging-realtime.md)) |
| Map tiles | Unchanged: OSM by default, Mapbox when the school sets a token (school setting, not a build variable) |

## 7. Jobs, files and live updates

- **Jobs:**
  - The school alarm runs `transport.tick` every minute from 30 minutes before the first scheduled start to 6 hours after the last scheduled end (the abandon backstop). Outside that window there is no tick, unless a run is still open.
  - Due jobs: `transport.runs.materialise` at 03:00 school time, and `transport.metrics.rollup` after each run ends.
  - The outbox goes through the `outbox` queue.
- **Files:**
  - Trails: `schools/<schoolId>/transport/trails/<serviceDate>/<runId>.ndjson.gz`, with an R2 lifecycle rule deleting them after 180 days (today's archive retention).
  - GTFS exports are built on demand.
  - Vehicle and crew photos go under `transport/photos/` ([15](15-files-and-media.md)).
- **Live updates:**
  - The board, driver and parent views subscribe to run and board topics.
  - Each fix that changes the visible state broadcasts a small message to sockets tagged with that run: position, next stop, ETA, delay.
  - Boarding events go to the driver, the board, and that child's parents.

## 8. Single-tenant assumptions

| Assumption | Where | Fix |
| --- | --- | --- |
| Drain URL and cron secret stored in `transport_runtime_config` | Drain route, `transport_kick_drain` | Removed. The queue consumer needs neither |
| Materialise at 21:30 UTC (03:00 IST) | cron job | Due job at 03:00 in the school's time zone |
| Tick every minute, all day, for one school | cron job | Per-school alarm, transport window only |
| One Traccar admin token copied into every school's Vercel project; nightly sync redeploys them | `provision.py`, workflow | One platform secret held by the platform Worker. Schools never see it. No per-school redeploy |
| Device ownership on the gateway recorded as the school's site URL | Link API | Recorded as the school id. Domain changes no longer orphan devices |
| Forward URL `https://<school-domain>/api/transport/ingest` | Link API | `https://<platform-host>/hooks/<schoolId>/gps/<sourceId>` |
| Mapbox token as `NEXT_PUBLIC_MAPBOX_*` build variables (4 spellings) | `mapTiles.ts` | School setting (public token) |
| VAPID keys per deployment | push | One platform key pair ([14](14-jobs-messaging-realtime.md)) |
| WhatsApp credentials per deployment | `integration_secrets` | Per school, encrypted ([17](17-integrations-and-secrets.md)) |

## 9. Target design

### Where the live state runs

The question left open in [10-target-architecture.md](10-target-architecture.md): should each live run get its own Durable Object (`RunLive`), or stay in the school object?

Load at a 10,000-user school, with the cost model's 50 buses:

| Item | Peak | Per day |
| --- | --- | --- |
| Phone fixes (5 s while moving) | 10 a second, all buses at once | About 90,000 (2 runs of 75 minutes per bus) |
| Device fixes (15 s, through the gateway) | 3.3 a second | About 30,000 |
| Parents watching | About 3,000 sockets in the morning peak | |
| Outgoing live messages | About 600 a second (10 fixes × about 60 watchers per bus) | |

Against the limits:

- A Durable Object handles about 1,000 requests a second.
- The hibernation API allows 32,768 WebSockets per object.
- Outgoing WebSocket messages are not billed as requests; incoming messages are billed at 20:1.
- Derivation for one fix (path projection over a few hundred points, geofence tests for about 20 stops, ETA) takes well under a millisecond of CPU.

So transport fits in the school object with large headroom.

**Decision: keep live transport in the school object at launch.**

- Put all live-run state behind one interface (`LiveRuns`: `ingestFix`, `state(runId)`, `subscribe`), so it can be moved later without touching callers.
- Move it to a `RunLive` object per run (`idFromName(schoolId + ':' + runId)`) only if measurement shows the school object's p95 latency for other calls rising above 200 ms during the bus peak, or its CPU above 50%.
  - The run object would then own fixes, derivation and parent sockets.
  - It would call the school object only for events: stop arrival, alert, end.
  - Boarding stays in the school object, because it writes student records and notifications.

### Write path for a fix

Today each fix inserts a telemetry row (8 indexes) and updates the run (15 indexes), plus stop events and alerts. In SQLite billing, each index entry written counts as a row written. The target:

1. Validate: crew or source, age, accuracy, implied speed. Suspect fixes are kept in the trail but not derived.
2. Derive against the run's in-memory model. The route path, stops and passengers are loaded once when the run starts and kept in memory; after an eviction they are rebuilt from SQL on the next fix.
3. Write to SQL **only when something changes:**
   - a stop event or alert, written in the same transaction as the outbox entry;
   - the run summary row, at most every 30 s and on every event.
4. Append the fix to the in-memory trail buffer. Once a minute, or on any event, flush the buffer as one row in `transport_trail_chunks (run_id, seq, fixes_json)`.
5. At run end:
   - write the chunks as one gzip NDJSON file to R2;
   - compute the run's metrics;
   - delete the chunks.
6. Broadcast the new visible state to the run's sockets.

An eviction loses at most the last minute of trail points, but no events or summary. That is acceptable for a replay trail. Rows written per fix fall from at least 10 today (the telemetry row and its 8 index entries, plus the run update) to well under 1 on average.

### Tables

- Setup, runs, boarding, alerts, incidents and metrics: carried over.
- `transport_telemetry` and `transport_telemetry_archive`: not carried over. Replaced by `transport_trail_chunks` plus R2 trails.
- Arrays (`days_of_week`) and JSON (`polyline`, `cumulative`, `polygon`, `settings`, `metrics`, `snapshot`) stored as JSON text.
- Coordinates as `REAL`. Distances in metres as `REAL`. Money (stop fees, legacy bus fees) in paise.
- Index review: `transport_trip_runs` has 15 indexes today. Keep `(service_date, status)`, `(route_id, service_date)`, `(driver_id, service_date)`, and `(schedule_id, service_date)` unique. The live summary columns must not be indexed.
- Alerts: unique index on `dedupe_key` where `status IN ('open','acknowledged')`. SQLite supports partial indexes.

### Methods (grouped)

| Group | Methods | Permission |
| --- | --- | --- |
| Setup | `transport.routes.*`, `stops.*`, `paths.*`, `schedules.*`, `vehicles.*`, `staff.*`, `assignments.*`, `stopFees.*`, `copyYear`, `settings.*` | `transport.manage` |
| Runs | `transport.board(date)`, `runs.materialise`, `runs.create` / `replace` / `cancel`, `runs.start` / `end` | `transport.manage`; start and end also by the run's crew |
| Driving | `transport.myRuns(date)`, `transport.live.ingestFixes` | the run's crew |
| Boarding | `transport.boarding.mark`, `boarding.scan`, `boarding.undo` | the run's crew; `transport.manage` |
| Credentials | `transport.credentials.issue` / `registerCard` / `revoke` | `transport.manage` |
| Alerts and incidents | `transport.alerts.list` / `acknowledge` / `resolve`; `incidents.raise` (crew, and parents from the child view if enabled); `incidents.update` / `resolve` | `transport.manage`; crew for raising |
| Parent view | `transport.child(studentId)`: assignment, today's runs, live state, ETA to the child's stop | the student and linked parents |
| History and reports | `transport.replay(runId)`, `reports.*`, `reports.csv` | `transport.manage` |
| Devices | `transport.devices.*` (link through the platform) | `transport.manage` |
| Exports | `transport.gtfs.static`, `transport.gtfs.realtime` | `transport.manage`; public per school only if switched on |
| Simulation | `transport.simulate.day` / `clear` | admin; disabled on live schools unless switched on |

### Gateway

- Traccar stays on DigitalOcean. Workers cannot accept raw TCP from devices, and Containers are reached only through a Worker over HTTP, so the gateway keeps its own reserved IP and ports.
- Its forward URLs point at the platform host. Its admin token is a platform secret.
- Device ownership is the school id, so the "first school to register an IMEI wins" and domain-change problems go away.
- The availability gaps listed in `docs/gps-system-status.md` still need an uptime alert and daily backups: there is still one server and no failover.

## 10. Moving existing data

- **Copy:** setup tables, runs, boarding, alerts (or only open and recent alerts: the 6,788 resolved `no_gps` rows have no value), incidents, metrics and credentials. Convert money to paise.
- **Positions:** none to move; raw telemetry is empty and the archive is empty.
- **Legacy bus fees:** import the 2 `bus_fees` rows through the existing `fee_import_bus_ledger` before cutover if that has not already been done. Then drop the `bus_*` fee tables.
- **Legacy driver payroll:** copy `driver_payroll_base` and `driver_bank_accounts` into the salary module with `person_kind = 'driver'` ([34](34-payroll-and-salary.md)).
- **Devices:** re-point any linked device's Traccar forward URL to the new hook URL during cutover. Today none are linked.

## 11. Parity checklist

- [ ] Replaying a recorded run's fixes through the TypeScript engine produces the same stop events, ETAs, delays and alerts as the SQL engine, fix for fix. Record fixtures from `transport_simulate_day` and from real runs before cutover.
- [ ] Geofence verdicts (inside, outside, uncertain) match `geofence.ts` and the SQL mirror for circles and polygons.
- [ ] A run with passengers still `boarded` is closed by the 6-hour backstop. Stable alert keys open one row per episode.
- [ ] Boarding by tap, card and QR is atomic and idempotent, and notifies each family once.
- [ ] Parents see only their own children's runs. Crew see only their runs. `transport_student_contact` is not reachable as a method.
- [ ] A fix from a source belonging to another school is rejected. A school's hook URL never accepts another school's source id.
- [ ] Phone fixes buffered offline and pushed later are accepted in order, and do not raise false `no_gps` alerts after they arrive.
- [ ] Replay, the five reports, CSV export, and GTFS static and realtime output match today's for the same runs.
- [ ] Materialise creates the same runs and run stops for the same schedules, at 03:00 school time.
- [ ] SOS reaches admins within one minute, with the frozen snapshot, even when WhatsApp is down.

## 12. Open questions

- [ ] Rebuild the Traccar gateway with a service token now (recommended in `docs/gps-system-status.md`), or wait for the Cloudflare cutover and link devices only from the platform?
- [ ] Should the GTFS realtime feed be public per school (for map apps) or admin-only?
- [ ] Can parents raise SOS from the child view, or only crew?
- [ ] Keep 180 days of trails, or less (the trail is personal location data about children)?
- [ ] Should simulation be available on live schools for training, or only on a demo school?
