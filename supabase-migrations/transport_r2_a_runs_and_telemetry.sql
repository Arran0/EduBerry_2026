-- ============================================================================
-- Migration: Transport — Round 2a, trip runs and telemetry
--
-- Round 1 gave the module a real shape: vehicles, routes, ordered geofenced
-- stops, schedules, and student -> stop assignments. This makes a trip a
-- running thing.
--
-- The centre of gravity is `transport_trip_runs` — one row per route, per
-- direction, per service date. It is the single row a parent subscribes to over
-- Realtime, and it carries a denormalised live summary written only by the
-- derivation path in Round 2b, so a parent screen is two indexed reads rather
-- than an aggregate over the telemetry firehose.
--
-- Prereq: transport_r1_foundation.sql. Run this in the Supabase SQL Editor.
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_run_status') THEN
    CREATE TYPE public.transport_run_status AS ENUM
      ('scheduled', 'boarding', 'in_progress', 'completed', 'cancelled', 'missed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_telemetry_state') THEN
    CREATE TYPE public.transport_telemetry_state AS ENUM ('unknown', 'live', 'stale', 'offline');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_source_kind') THEN
    CREATE TYPE public.transport_source_kind AS ENUM ('driver_app', 'gps_device', 'vendor_api');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_fix_source') THEN
    CREATE TYPE public.transport_fix_source AS ENUM
      ('driver_app', 'device_push', 'device_poll', 'manual', 'simulated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_event_source') THEN
    CREATE TYPE public.transport_event_source AS ENUM ('geofence', 'manual', 'device', 'scheduled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_stop_event_type') THEN
    CREATE TYPE public.transport_stop_event_type AS ENUM ('arrival', 'departure', 'skip');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_boarding_state') THEN
    CREATE TYPE public.transport_boarding_state AS ENUM
      ('expected', 'boarded', 'absent', 'dropped', 'no_show', 'excused');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_boarding_event') THEN
    CREATE TYPE public.transport_boarding_event AS ENUM
      ('board', 'alight', 'mark_absent', 'mark_excused', 'undo');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_scan_method') THEN
    -- rfid/nfc/qr are carried from the start so Round 3 adds a reader, not a schema.
    CREATE TYPE public.transport_scan_method AS ENUM ('manual', 'rfid', 'nfc', 'qr', 'auto');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_alert_severity') THEN
    CREATE TYPE public.transport_alert_severity AS ENUM ('info', 'warning', 'critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_alert_status') THEN
    CREATE TYPE public.transport_alert_status AS ENUM
      ('open', 'acknowledged', 'resolved', 'auto_resolved');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_alert_type') THEN
    CREATE TYPE public.transport_alert_type AS ENUM
      ('delay', 'deviation', 'long_stop', 'wrong_direction', 'overspeed', 'no_gps',
       'device_offline', 'trip_not_started', 'stop_skipped', 'student_not_boarded',
       'student_not_dropped', 'capacity_exceeded', 'sos');
  END IF;
END $$;

-- ── transport_trip_runs ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transport_trip_runs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id            UUID REFERENCES public.transport_route_schedules(id) ON DELETE SET NULL,
  route_id               UUID NOT NULL REFERENCES public.transport_routes(id) ON DELETE CASCADE,
  direction              public.transport_direction NOT NULL,
  service_date           DATE NOT NULL,
  status                 public.transport_run_status NOT NULL DEFAULT 'scheduled',

  -- Crew and vehicle are snapshotted onto the run, so a replacement bus or a
  -- substitute driver is just a different value here and the history stays
  -- truthful about who actually drove.
  vehicle_id             UUID REFERENCES public.transport_vehicles(id) ON DELETE SET NULL,
  driver_id              UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  attendant_id           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  scheduled_start_at     TIMESTAMPTZ NOT NULL,
  scheduled_end_at       TIMESTAMPTZ,
  started_at             TIMESTAMPTZ,
  ended_at               TIMESTAMPTZ,

  -- Denormalised live summary, written only by transport_apply_fix() and
  -- transport_tick(). A parent screen reads this row plus one run-stop row;
  -- it never aggregates over transport_telemetry.
  last_fix_at            TIMESTAMPTZ,
  last_lat               DOUBLE PRECISION,
  last_lng               DOUBLE PRECISION,
  last_heading_deg       REAL,
  last_speed_kmh         REAL,
  telemetry_state        public.transport_telemetry_state NOT NULL DEFAULT 'unknown',
  active_source_id       UUID,

  current_stop_id        UUID REFERENCES public.transport_route_stops(id) ON DELETE SET NULL,
  next_stop_id           UUID REFERENCES public.transport_route_stops(id) ON DELETE SET NULL,
  next_stop_eta_at       TIMESTAMPTZ,
  delay_seconds          INTEGER,
  progress_m             DOUBLE PRECISION,
  off_route_m            DOUBLE PRECISION,
  open_alert_count       INTEGER NOT NULL DEFAULT 0,

  replacement_for_run_id UUID REFERENCES public.transport_trip_runs(id) ON DELETE SET NULL,
  change_note            TEXT,          -- "Bus 12 -> Bus 4 (breakdown)"; shown to parents
  cancel_reason          TEXT,
  created_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULLs are distinct in a UNIQUE, so an ad-hoc run (no schedule) is free of
  -- this constraint while a scheduled one can only be materialised once.
  UNIQUE (schedule_id, service_date)
);
CREATE INDEX IF NOT EXISTS idx_transport_runs_date_status ON public.transport_trip_runs (service_date, status);
CREATE INDEX IF NOT EXISTS idx_transport_runs_route_date  ON public.transport_trip_runs (route_id, service_date);
CREATE INDEX IF NOT EXISTS idx_transport_runs_driver_date ON public.transport_trip_runs (driver_id, service_date);
CREATE INDEX IF NOT EXISTS idx_transport_runs_attendant   ON public.transport_trip_runs (attendant_id, service_date);
CREATE INDEX IF NOT EXISTS idx_transport_runs_vehicle     ON public.transport_trip_runs (vehicle_id, service_date);
CREATE INDEX IF NOT EXISTS idx_transport_runs_schedule    ON public.transport_trip_runs (schedule_id);
CREATE INDEX IF NOT EXISTS idx_transport_runs_replacement ON public.transport_trip_runs (replacement_for_run_id);
CREATE INDEX IF NOT EXISTS idx_transport_runs_created_by  ON public.transport_trip_runs (created_by);
CREATE INDEX IF NOT EXISTS idx_transport_runs_current_stop ON public.transport_trip_runs (current_stop_id);
CREATE INDEX IF NOT EXISTS idx_transport_runs_next_stop   ON public.transport_trip_runs (next_stop_id);
CREATE INDEX IF NOT EXISTS idx_transport_runs_live
  ON public.transport_trip_runs (id) WHERE status IN ('boarding', 'in_progress');

-- ── transport_run_stops ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transport_run_stops (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               UUID NOT NULL REFERENCES public.transport_trip_runs(id) ON DELETE CASCADE,
  stop_id              UUID NOT NULL REFERENCES public.transport_route_stops(id) ON DELETE CASCADE,
  seq                  INTEGER NOT NULL,     -- direction-resolved order for THIS run
  scheduled_arrival_at TIMESTAMPTZ,
  eta_at               TIMESTAMPTZ,          -- rolling; NULL whenever telemetry is not live
  eta_updated_at       TIMESTAMPTZ,
  arrived_at           TIMESTAMPTZ,
  departed_at          TIMESTAMPTZ,
  arrival_source       public.transport_event_source,
  arrival_verdict      TEXT,                 -- inside | outside | uncertain — geofence audit
  skipped              BOOLEAN NOT NULL DEFAULT false,
  expected_boardings   INTEGER NOT NULL DEFAULT 0,
  actual_boardings     INTEGER NOT NULL DEFAULT 0,
  -- Generated, so on-time reporting needs no separate computation or backfill.
  delay_seconds        INTEGER GENERATED ALWAYS AS (
    CASE WHEN arrived_at IS NOT NULL AND scheduled_arrival_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (arrived_at - scheduled_arrival_at))::INTEGER END
  ) STORED,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, stop_id),
  CONSTRAINT transport_run_stops_seq_uniq UNIQUE (run_id, seq) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS idx_transport_run_stops_run ON public.transport_run_stops (run_id, seq);
CREATE INDEX IF NOT EXISTS idx_transport_run_stops_stop ON public.transport_run_stops (stop_id);
CREATE INDEX IF NOT EXISTS idx_transport_run_stops_pending
  ON public.transport_run_stops (run_id, seq) WHERE arrived_at IS NULL AND NOT skipped;

-- ── transport_run_passengers ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transport_run_passengers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES public.transport_trip_runs(id) ON DELETE CASCADE,
  student_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assignment_id  UUID REFERENCES public.transport_student_assignments(id) ON DELETE SET NULL,
  board_stop_id  UUID REFERENCES public.transport_route_stops(id) ON DELETE SET NULL,
  alight_stop_id UUID REFERENCES public.transport_route_stops(id) ON DELETE SET NULL,
  state          public.transport_boarding_state NOT NULL DEFAULT 'expected',
  boarded_at     TIMESTAMPTZ,
  alighted_at    TIMESTAMPTZ,
  method         public.transport_scan_method NOT NULL DEFAULT 'manual',
  -- 'leave' when the school already knows the child is away. Suppresses the
  -- not-boarded exception; without it every Monday is a wall of false alarms
  -- and parents learn to ignore the channel.
  excuse_reason  TEXT,
  marked_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_transport_run_passengers_student
  ON public.transport_run_passengers (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transport_run_passengers_run ON public.transport_run_passengers (run_id);
CREATE INDEX IF NOT EXISTS idx_transport_run_passengers_board_stop ON public.transport_run_passengers (board_stop_id);
CREATE INDEX IF NOT EXISTS idx_transport_run_passengers_alight_stop ON public.transport_run_passengers (alight_stop_id);
CREATE INDEX IF NOT EXISTS idx_transport_run_passengers_assignment ON public.transport_run_passengers (assignment_id);
CREATE INDEX IF NOT EXISTS idx_transport_run_passengers_marked_by ON public.transport_run_passengers (marked_by);
CREATE INDEX IF NOT EXISTS idx_transport_run_passengers_pending
  ON public.transport_run_passengers (run_id) WHERE state = 'expected';

CREATE TABLE IF NOT EXISTS public.transport_boarding_events (
  id          BIGSERIAL PRIMARY KEY,
  run_id      UUID NOT NULL REFERENCES public.transport_trip_runs(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event       public.transport_boarding_event NOT NULL,
  stop_id     UUID REFERENCES public.transport_route_stops(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method      public.transport_scan_method NOT NULL DEFAULT 'manual',
  actor_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transport_boarding_events_run ON public.transport_boarding_events (run_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_transport_boarding_events_student ON public.transport_boarding_events (student_id);
CREATE INDEX IF NOT EXISTS idx_transport_boarding_events_stop ON public.transport_boarding_events (stop_id);
CREATE INDEX IF NOT EXISTS idx_transport_boarding_events_actor ON public.transport_boarding_events (actor_id);

-- ── Telemetry ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transport_telemetry_sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              public.transport_source_kind NOT NULL,
  label             TEXT NOT NULL,
  vehicle_id        UUID REFERENCES public.transport_vehicles(id) ON DELETE CASCADE,
  vendor            TEXT,        -- adapter key: 'app' | 'traccar' | 'flespi' | 'generic'
  external_id       TEXT,        -- IMEI / vendor uniqueId
  -- Lower wins. gps_device defaults to 10 and driver_app to 50, so a
  -- mains-powered device outranks a phone that may be backgrounded or flat.
  priority          SMALLINT NOT NULL DEFAULT 100,
  ingest_key_prefix TEXT,        -- first 8 chars, so an admin can identify the key
  active            BOOLEAN NOT NULL DEFAULT true,
  last_seen_at      TIMESTAMPTZ,
  last_error        TEXT,
  health            JSONB,       -- battery, gsm, ignition, satellite count
  poll_config       JSONB,       -- { base_url, account, interval_s } — never secrets
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor, external_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS transport_sources_key_prefix_uniq
  ON public.transport_telemetry_sources (ingest_key_prefix) WHERE ingest_key_prefix IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transport_sources_vehicle
  ON public.transport_telemetry_sources (vehicle_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_transport_sources_created_by ON public.transport_telemetry_sources (created_by);

ALTER TABLE public.transport_trip_runs DROP CONSTRAINT IF EXISTS transport_trip_runs_active_source_fk;
ALTER TABLE public.transport_trip_runs
  ADD CONSTRAINT transport_trip_runs_active_source_fk
  FOREIGN KEY (active_source_id) REFERENCES public.transport_telemetry_sources(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transport_runs_active_source ON public.transport_trip_runs (active_source_id);

CREATE TABLE IF NOT EXISTS public.transport_telemetry (
  -- BIGSERIAL rather than UUID: this is the highest-write table in the schema
  -- and a monotonic key gives free insertion ordering, a cheap `id > cursor`
  -- replay cursor, and roughly half the index footprint of a random UUID.
  id           BIGSERIAL PRIMARY KEY,
  run_id       UUID REFERENCES public.transport_trip_runs(id) ON DELETE CASCADE,
  vehicle_id   UUID REFERENCES public.transport_vehicles(id) ON DELETE SET NULL,
  source_id    UUID REFERENCES public.transport_telemetry_sources(id) ON DELETE SET NULL,
  source       public.transport_fix_source NOT NULL,
  reported_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  lat          DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng          DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m   REAL,
  heading_deg  REAL,
  speed_kmh    REAL,             -- ALWAYS km/h; adapters convert from m/s or knots
  altitude_m   REAL,
  satellites   SMALLINT,
  ignition     BOOLEAN,
  odometer_km  DOUBLE PRECISION,
  battery_pct  SMALLINT,
  -- Failed the speed-jump / accuracy sanity gate. Kept for audit, excluded from
  -- every derivation — this is the filter against "the bus teleported".
  suspect      BOOLEAN NOT NULL DEFAULT false,
  -- Two clocks on purpose: `recorded_at` is the device's, so an offline queue
  -- flushed after a ten-minute dead zone replays as correct history rather than
  -- as ten minutes of the bus sitting still and then jumping.
  recorded_at  TIMESTAMPTZ NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw          JSONB,
  CONSTRAINT transport_telemetry_not_null_island CHECK (NOT (lat = 0 AND lng = 0)),
  CONSTRAINT transport_telemetry_app_self CHECK (source <> 'driver_app' OR reported_by IS NOT NULL)
);
-- Makes a vendor redelivery and an offline-queue flush both free.
CREATE UNIQUE INDEX IF NOT EXISTS transport_telemetry_dedupe
  ON public.transport_telemetry (source_id, recorded_at) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transport_telemetry_app_dedupe
  ON public.transport_telemetry (run_id, reported_by, recorded_at)
  WHERE source_id IS NULL AND run_id IS NOT NULL AND reported_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transport_telemetry_run ON public.transport_telemetry (run_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_transport_telemetry_vehicle ON public.transport_telemetry (vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_transport_telemetry_source ON public.transport_telemetry (source_id);
CREATE INDEX IF NOT EXISTS idx_transport_telemetry_reporter ON public.transport_telemetry (reported_by);
CREATE INDEX IF NOT EXISTS idx_transport_telemetry_recorded_brin
  ON public.transport_telemetry USING BRIN (recorded_at);

-- ── Stop events and alerts ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transport_stop_events (
  id           BIGSERIAL PRIMARY KEY,
  run_id       UUID NOT NULL REFERENCES public.transport_trip_runs(id) ON DELETE CASCADE,
  run_stop_id  UUID REFERENCES public.transport_run_stops(id) ON DELETE CASCADE,
  stop_id      UUID REFERENCES public.transport_route_stops(id) ON DELETE SET NULL,
  event_type   public.transport_stop_event_type NOT NULL,
  source       public.transport_event_source NOT NULL DEFAULT 'geofence',
  occurred_at  TIMESTAMPTZ NOT NULL,
  -- Deliberately unreferenced: an inbound FK would turn the nightly telemetry
  -- purge into a referential scan. The lat/lng is copied instead.
  telemetry_id BIGINT,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  distance_m   DOUBLE PRECISION,
  verdict      TEXT,
  actor_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Idempotency: the per-fix trigger fires many times inside one geofence.
CREATE UNIQUE INDEX IF NOT EXISTS transport_stop_events_once
  ON public.transport_stop_events (run_stop_id, event_type)
  WHERE event_type IN ('arrival', 'departure');
CREATE INDEX IF NOT EXISTS idx_transport_stop_events_run ON public.transport_stop_events (run_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_transport_stop_events_stop ON public.transport_stop_events (stop_id);
CREATE INDEX IF NOT EXISTS idx_transport_stop_events_actor ON public.transport_stop_events (actor_id);

CREATE TABLE IF NOT EXISTS public.transport_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID REFERENCES public.transport_trip_runs(id) ON DELETE CASCADE,
  route_id      UUID REFERENCES public.transport_routes(id) ON DELETE SET NULL,
  vehicle_id    UUID REFERENCES public.transport_vehicles(id) ON DELETE SET NULL,
  stop_id       UUID REFERENCES public.transport_route_stops(id) ON DELETE SET NULL,
  student_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  type          public.transport_alert_type NOT NULL,
  severity      public.transport_alert_severity NOT NULL DEFAULT 'warning',
  status        public.transport_alert_status NOT NULL DEFAULT 'open',
  -- One live alert per logical condition, so a forty-minute deviation is one
  -- row with an occurrence count rather than forty rows.
  dedupe_key    TEXT NOT NULL,
  title         TEXT NOT NULL,
  detail        TEXT,
  metrics       JSONB NOT NULL DEFAULT '{}'::jsonb,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  occurrences   INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  resolution_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS transport_alerts_live_uniq
  ON public.transport_alerts (dedupe_key) WHERE status IN ('open', 'acknowledged');
CREATE INDEX IF NOT EXISTS idx_transport_alerts_open
  ON public.transport_alerts (severity, last_seen_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_transport_alerts_run ON public.transport_alerts (run_id);
CREATE INDEX IF NOT EXISTS idx_transport_alerts_route ON public.transport_alerts (route_id);
CREATE INDEX IF NOT EXISTS idx_transport_alerts_vehicle ON public.transport_alerts (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_transport_alerts_stop ON public.transport_alerts (stop_id);
CREATE INDEX IF NOT EXISTS idx_transport_alerts_student ON public.transport_alerts (student_id);
CREATE INDEX IF NOT EXISTS idx_transport_alerts_ack_by ON public.transport_alerts (acknowledged_by);

-- ── updated_at triggers ─────────────────────────────────────────────────────

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transport_trip_runs', 'transport_run_stops', 'transport_run_passengers',
    'transport_telemetry_sources', 'transport_alerts'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_updated_at') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_task_updated_at()',
        t || '_updated_at', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
