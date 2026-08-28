-- ============================================================================
-- Migration: Transport — Round 1 foundation
--
-- Turns the route *template* the bus module has always had into a real
-- transport model: vehicles, transport staff (driver AND attendant), routes
-- carrying an ordered list of geofenced stops and a driven path, schedules with
-- direction and days-of-week, and student -> stop assignments.
--
-- Follows the conventions in add_bus_manager.sql and gps_attendance_rebuild.sql.
-- Prereq: add_bus_manager.sql, add_trip_passenger_fee_location.sql,
--         transport_r1_payment_method_enum.sql.
-- Run this in the Supabase SQL Editor.
--
-- Applied to the live project in these parts (ALTER TYPE ... ADD VALUE cannot
-- share a transaction with DDL that uses the new value):
--   transport_r1_payment_method_enum, transport_r1_foundation_a_renames,
--   transport_r1_foundation_b_tables, transport_r1_foundation_c_rls,
--   transport_r1_restore_function_lockdown, transport_r1_helper_grants_v2.
--
-- ── Why rename rather than replace ──────────────────────────────────────────
-- `bus_trips` was always route-shaped (a name, a description, a default driver)
-- and `trip_passengers` was always an assignment. Postgres foreign keys bind to
-- the table OID, so renaming carries `bus_fees.trip_id`, `bus_fee_drafts`,
-- `trip_attendance`, `bus_locations` and `trip_driver_overrides` along with it
-- and the whole fee/draft/payroll module keeps working untouched. That is
-- strictly safer than drop-and-recreate, which would have to rebuild five
-- foreign keys by hand.
--
-- ── What this migration deliberately does NOT retire ────────────────────────
-- `trip_driver_overrides`, `trip_attendance` and `bus_locations` are left
-- exactly as they are. The current driver screen still reads all three, and a
-- round that breaks a working screen before its replacement exists is not
-- independently shippable. They are retired in Round 2 by trip runs, boarding
-- events and the telemetry pipeline respectively. For the same reason
-- `transport_routes.pickup_time` / `drop_time` survive here even though
-- `transport_route_schedules` supersedes them.
--
-- ── Geofences ───────────────────────────────────────────────────────────────
-- Stop geofence columns mirror `attendance_geofence_zones` exactly (shape,
-- polygon, radius_m, trusted_accuracy_m) so `fenceFromConfig()` in
-- src/lib/geofence.ts consumes a stop row unchanged, and so Round 2's arrival
-- detection can call the existing `attendance_location_verdict()` verbatim
-- rather than forking the rules.
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_direction') THEN
    -- inbound = towards school, outbound = away from school. Named by
    -- destination rather than "pickup/drop" because a single stop is a pickup
    -- in the morning and a drop in the afternoon.
    CREATE TYPE public.transport_direction AS ENUM ('inbound', 'outbound');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_vehicle_status') THEN
    CREATE TYPE public.transport_vehicle_status AS ENUM ('active', 'maintenance', 'retired');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_stop_kind') THEN
    CREATE TYPE public.transport_stop_kind AS ENUM ('stop', 'school', 'depot');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_staff_kind') THEN
    CREATE TYPE public.transport_staff_kind AS ENUM ('driver', 'attendant');
  END IF;
END $$;

-- ── Rename: bus_trips -> transport_routes ───────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bus_trips')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'transport_routes')
  THEN
    ALTER TABLE public.bus_trips RENAME TO transport_routes;
    ALTER TABLE public.transport_routes RENAME COLUMN route_description TO description;

    ALTER INDEX public.bus_trips_pkey                RENAME TO transport_routes_pkey;
    ALTER INDEX public.idx_bus_trips_active          RENAME TO idx_transport_routes_active;
    ALTER INDEX public.idx_bus_trips_created_by      RENAME TO idx_transport_routes_created_by;
    ALTER INDEX public.idx_bus_trips_default_driver  RENAME TO idx_transport_routes_default_driver;

    ALTER TABLE public.transport_routes
      RENAME CONSTRAINT bus_trips_created_by_fkey TO transport_routes_created_by_fkey;
    ALTER TABLE public.transport_routes
      RENAME CONSTRAINT bus_trips_default_driver_id_fkey TO transport_routes_default_driver_id_fkey;
  END IF;
END $$;

ALTER TABLE public.transport_routes
  ADD COLUMN IF NOT EXISTS code                 TEXT,
  ADD COLUMN IF NOT EXISTS color                TEXT NOT NULL DEFAULT '#F97316',
  ADD COLUMN IF NOT EXISTS default_vehicle_id   UUID,
  ADD COLUMN IF NOT EXISTS default_attendant_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS school_stop_id       UUID,
  -- Per-route overrides for the Round 2 detection thresholds (corridor width,
  -- delay minutes, overspeed limit). School-wide defaults live in site_settings.
  ADD COLUMN IF NOT EXISTS settings             JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS archived_at          TIMESTAMPTZ;

COMMENT ON COLUMN public.transport_routes.pickup_time IS
  'Deprecated: superseded by transport_route_schedules. Retained until the Round 2 driver app lands.';
COMMENT ON COLUMN public.transport_routes.drop_time IS
  'Deprecated: superseded by transport_route_schedules. Retained until the Round 2 driver app lands.';

CREATE UNIQUE INDEX IF NOT EXISTS transport_routes_code_uniq
  ON public.transport_routes (upper(code)) WHERE code IS NOT NULL;

-- ── Rename: trip_passengers -> transport_student_assignments ────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'trip_passengers')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'transport_student_assignments')
  THEN
    ALTER TABLE public.trip_passengers RENAME TO transport_student_assignments;
    ALTER TABLE public.transport_student_assignments RENAME COLUMN trip_id      TO route_id;
    ALTER TABLE public.transport_student_assignments RENAME COLUMN passenger_id TO student_id;
    -- The old free-text pickup label. Kept as a display fallback and as the
    -- source an admin reads while assigning real stops; nothing is lost.
    ALTER TABLE public.transport_student_assignments RENAME COLUMN location     TO location_label;

    ALTER INDEX public.trip_passengers_pkey       RENAME TO transport_student_assignments_pkey;
    ALTER INDEX public.idx_trip_passengers_trip      RENAME TO idx_transport_assignments_route;
    ALTER INDEX public.idx_trip_passengers_passenger RENAME TO idx_transport_assignments_student;
    ALTER INDEX public.trip_passengers_trip_id_passenger_id_key
      RENAME TO transport_student_assignments_route_student_key;

    ALTER TABLE public.transport_student_assignments
      RENAME CONSTRAINT trip_passengers_trip_id_fkey TO transport_student_assignments_route_id_fkey;
    ALTER TABLE public.transport_student_assignments
      RENAME CONSTRAINT trip_passengers_passenger_id_fkey TO transport_student_assignments_student_id_fkey;
  END IF;
END $$;

ALTER TABLE public.transport_student_assignments
  ADD COLUMN IF NOT EXISTS pickup_stop_id UUID,
  ADD COLUMN IF NOT EXISTS drop_stop_id   UUID,
  -- A child may ride in only one direction (walks home, collected by a parent).
  ADD COLUMN IF NOT EXISTS rides_inbound  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rides_outbound BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS started_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS ended_on       DATE,
  -- WhatsApp-capable override; falls back to student_details.phone in Round 3.
  ADD COLUMN IF NOT EXISTS guardian_phone TEXT,
  ADD COLUMN IF NOT EXISTS notes          TEXT,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_transport_assignments_active
  ON public.transport_student_assignments (student_id) WHERE ended_on IS NULL;

-- ── Repoint the fee columns ─────────────────────────────────────────────────
-- The FK constraints already follow the renamed table; only the column name is
-- now misleading.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='bus_fees' AND column_name='trip_id') THEN
    ALTER TABLE public.bus_fees RENAME COLUMN trip_id TO route_id;
    ALTER TABLE public.bus_fees RENAME CONSTRAINT bus_fees_trip_id_fkey TO bus_fees_route_id_fkey;
    ALTER INDEX public.idx_bus_fees_trip RENAME TO idx_bus_fees_route;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='bus_fee_drafts' AND column_name='trip_id') THEN
    ALTER TABLE public.bus_fee_drafts RENAME COLUMN trip_id TO route_id;
    ALTER TABLE public.bus_fee_drafts RENAME CONSTRAINT bus_fee_drafts_trip_id_fkey TO bus_fee_drafts_route_id_fkey;
    ALTER INDEX public.idx_bus_fee_drafts_trip RENAME TO idx_bus_fee_drafts_route;
  END IF;
END $$;

-- ── transport_vehicles ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transport_vehicles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_no  TEXT NOT NULL,
  display_name     TEXT,                                  -- "Bus 12" — what parents see
  make_model       TEXT,
  capacity         INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  fuel_type        TEXT,
  status           public.transport_vehicle_status NOT NULL DEFAULT 'active',
  -- The four documents Indian school transport is audited on. Surfaced as
  -- admin warnings as they approach expiry.
  insurance_expiry DATE,
  fitness_expiry   DATE,
  permit_expiry    DATE,
  puc_expiry       DATE,
  photo_url        TEXT,
  notes            TEXT,
  settings         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Plates are written "KL07AB1234" and "KL 07 AB 1234" interchangeably, so a
-- plain unique constraint would let the same bus be entered twice.
CREATE UNIQUE INDEX IF NOT EXISTS transport_vehicles_reg_uniq
  ON public.transport_vehicles (upper(replace(registration_no, ' ', '')));
CREATE INDEX IF NOT EXISTS idx_transport_vehicles_status ON public.transport_vehicles (status);
CREATE INDEX IF NOT EXISTS idx_transport_vehicles_created_by ON public.transport_vehicles (created_by);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'transport_vehicles_updated_at') THEN
    CREATE TRIGGER transport_vehicles_updated_at BEFORE UPDATE ON public.transport_vehicles
      FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();
  END IF;
END $$;

ALTER TABLE public.transport_routes
  DROP CONSTRAINT IF EXISTS transport_routes_default_vehicle_id_fkey;
ALTER TABLE public.transport_routes
  ADD CONSTRAINT transport_routes_default_vehicle_id_fkey
  FOREIGN KEY (default_vehicle_id) REFERENCES public.transport_vehicles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transport_routes_default_vehicle
  ON public.transport_routes (default_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_transport_routes_default_attendant
  ON public.transport_routes (default_attendant_id);

-- ── transport_staff ─────────────────────────────────────────────────────────
-- Deliberately NOT a new profiles.role. add_non_teaching_staff_flag.sql:5-14
-- documents refusing to add a role literal because ~130 places across ~30 SQL
-- files already special-case the existing set. An attendant is a profile with
-- role='driver' whose capability comes from this row.

CREATE TABLE IF NOT EXISTS public.transport_staff (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind              public.transport_staff_kind NOT NULL,
  employee_code     TEXT,
  phone             TEXT,                    -- shown to parents on the crew card
  licence_no        TEXT,
  licence_expiry    DATE,
  badge_no          TEXT,
  blood_group       TEXT,
  photo_url         TEXT,
  address           TEXT,
  emergency_contact TEXT,
  verified_at       TIMESTAMPTZ,             -- background/police verification on file
  active            BOOLEAN NOT NULL DEFAULT true,
  notes             TEXT,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_transport_staff_profile ON public.transport_staff (profile_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_transport_staff_created_by ON public.transport_staff (created_by);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'transport_staff_updated_at') THEN
    CREATE TRIGGER transport_staff_updated_at BEFORE UPDATE ON public.transport_staff
      FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();
  END IF;
END $$;

-- ── transport_route_stops ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transport_route_stops (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id           UUID NOT NULL REFERENCES public.transport_routes(id) ON DELETE CASCADE,
  seq                INTEGER NOT NULL CHECK (seq > 0),   -- inbound (to-school) order
  name               TEXT NOT NULL,
  landmark           TEXT,
  lat                DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  -- Geofence, shaped exactly like attendance_geofence_zones so the same
  -- TypeScript fenceFromConfig() and the same SQL verdict function apply.
  radius_m           INTEGER NOT NULL DEFAULT 120 CHECK (radius_m BETWEEN 25 AND 1000),
  shape              TEXT NOT NULL DEFAULT 'circle' CHECK (shape IN ('circle', 'polygon')),
  polygon            JSONB,                   -- [{"lat":..,"lng":..}, ...]
  trusted_accuracy_m INTEGER,
  -- Offsets in minutes from the schedule's anchor time, NOT clock times, so one
  -- stop list serves an 07:10 and an 07:40 departure without duplication.
  inbound_offset_min  INTEGER,
  outbound_offset_min INTEGER,
  dwell_seconds      INTEGER NOT NULL DEFAULT 60 CHECK (dwell_seconds >= 0),
  kind               public.transport_stop_kind NOT NULL DEFAULT 'stop',
  active             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- DEFERRABLE is load-bearing: drag-to-reorder rewrites every seq on the route
  -- in one transaction and would otherwise collide mid-statement.
  CONSTRAINT transport_route_stops_seq_uniq UNIQUE (route_id, seq) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS idx_transport_route_stops_route
  ON public.transport_route_stops (route_id, seq);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'transport_route_stops_updated_at') THEN
    CREATE TRIGGER transport_route_stops_updated_at BEFORE UPDATE ON public.transport_route_stops
      FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();
  END IF;
END $$;

ALTER TABLE public.transport_routes DROP CONSTRAINT IF EXISTS transport_routes_school_stop_fk;
ALTER TABLE public.transport_routes
  ADD CONSTRAINT transport_routes_school_stop_fk
  FOREIGN KEY (school_stop_id) REFERENCES public.transport_route_stops(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transport_routes_school_stop
  ON public.transport_routes (school_stop_id);

ALTER TABLE public.transport_student_assignments
  DROP CONSTRAINT IF EXISTS transport_student_assignments_pickup_stop_fk;
ALTER TABLE public.transport_student_assignments
  ADD CONSTRAINT transport_student_assignments_pickup_stop_fk
  FOREIGN KEY (pickup_stop_id) REFERENCES public.transport_route_stops(id) ON DELETE SET NULL;
ALTER TABLE public.transport_student_assignments
  DROP CONSTRAINT IF EXISTS transport_student_assignments_drop_stop_fk;
ALTER TABLE public.transport_student_assignments
  ADD CONSTRAINT transport_student_assignments_drop_stop_fk
  FOREIGN KEY (drop_stop_id) REFERENCES public.transport_route_stops(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transport_assignments_pickup_stop
  ON public.transport_student_assignments (pickup_stop_id);
CREATE INDEX IF NOT EXISTS idx_transport_assignments_drop_stop
  ON public.transport_student_assignments (drop_stop_id);

-- ── transport_route_paths ───────────────────────────────────────────────────
-- The driven corridor centreline. `cumulative` caches the prefix sums of
-- segment lengths so Round 2's progress-along-route is one scan rather than a
-- full re-derivation on every fix.

CREATE TABLE IF NOT EXISTS public.transport_route_paths (
  route_id   UUID NOT NULL REFERENCES public.transport_routes(id) ON DELETE CASCADE,
  direction  public.transport_direction NOT NULL,
  polyline   JSONB NOT NULL,                       -- [{"lat":..,"lng":..}, ...]
  corridor_m INTEGER NOT NULL DEFAULT 150 CHECK (corridor_m BETWEEN 25 AND 2000),
  length_m   DOUBLE PRECISION,
  cumulative JSONB,                                -- [0, d1, d1+d2, ...]
  source     TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'stops', 'recorded')),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (route_id, direction)
);
CREATE INDEX IF NOT EXISTS idx_transport_route_paths_updated_by
  ON public.transport_route_paths (updated_by);

-- ── transport_route_schedules ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transport_route_schedules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id     UUID NOT NULL REFERENCES public.transport_routes(id) ON DELETE CASCADE,
  direction    public.transport_direction NOT NULL,
  label        TEXT,                                       -- "Morning pickup"
  -- Postgres EXTRACT(DOW): 0 = Sunday .. 6 = Saturday.
  days_of_week SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}'
               CHECK (days_of_week <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]),
  start_time   TIME NOT NULL,        -- departure from the first stop of this direction
  end_time     TIME,                 -- scheduled arrival at the terminus
  vehicle_id   UUID REFERENCES public.transport_vehicles(id) ON DELETE SET NULL,
  driver_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  attendant_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Whether a run starts on first movement or waits for the driver to tap.
  auto_start   BOOLEAN NOT NULL DEFAULT true,
  active_from  DATE,
  active_to    DATE,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS transport_route_schedules_slot_uniq
  ON public.transport_route_schedules (route_id, direction, start_time) WHERE active;
CREATE INDEX IF NOT EXISTS idx_transport_schedules_route  ON public.transport_route_schedules (route_id);
CREATE INDEX IF NOT EXISTS idx_transport_schedules_driver ON public.transport_route_schedules (driver_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_transport_schedules_attendant ON public.transport_route_schedules (attendant_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_transport_schedules_vehicle ON public.transport_route_schedules (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_transport_schedules_created_by ON public.transport_route_schedules (created_by);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'transport_route_schedules_updated_at') THEN
    CREATE TRIGGER transport_route_schedules_updated_at BEFORE UPDATE ON public.transport_route_schedules
      FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'transport_student_assignments_updated_at') THEN
    CREATE TRIGGER transport_student_assignments_updated_at BEFORE UPDATE ON public.transport_student_assignments
      FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();
  END IF;
END $$;

-- ── Helper functions ────────────────────────────────────────────────────────
-- SECURITY DEFINER + STABLE + fixed search_path, per the house pattern that
-- exists to stop policies recursing through each other.

-- Redefined: the old bodies name tables that this migration renamed. Function
-- bodies are stored as text and are NOT rewritten by ALTER TABLE ... RENAME.
CREATE OR REPLACE FUNCTION public.is_trip_passenger(p_trip UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.transport_student_assignments a
    WHERE a.route_id = p_trip AND a.student_id = auth.uid()
  );
$fn$;

CREATE OR REPLACE FUNCTION public.is_trip_driver(p_trip UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.transport_routes t
    WHERE t.id = p_trip AND t.default_driver_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.trip_driver_overrides o
    WHERE o.trip_id = p_trip AND o.driver_id = auth.uid()
  );
$fn$;

CREATE OR REPLACE FUNCTION public.effective_trip_driver(p_trip UUID, p_date DATE)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(
    (SELECT driver_id FROM public.trip_driver_overrides WHERE trip_id = p_trip AND date = p_date),
    (SELECT default_driver_id FROM public.transport_routes WHERE id = p_trip)
  );
$fn$;

-- New: is the caller a student (i.e. a parent on the shared account) riding
-- this route right now?
CREATE OR REPLACE FUNCTION public.transport_route_is_mine(p_route UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.transport_student_assignments a
    WHERE a.route_id = p_route
      AND a.student_id = auth.uid()
      AND a.ended_on IS NULL
  );
$fn$;

-- New: is the caller crew on this route, as its default driver/attendant or via
-- any active schedule?
CREATE OR REPLACE FUNCTION public.transport_route_has_crew(p_route UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.transport_routes r
    WHERE r.id = p_route
      AND (r.default_driver_id = auth.uid() OR r.default_attendant_id = auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM public.transport_route_schedules s
    WHERE s.route_id = p_route
      AND s.active
      AND (s.driver_id = auth.uid() OR s.attendant_id = auth.uid())
  );
$fn$;

CREATE OR REPLACE FUNCTION public.transport_stop_is_mine(p_stop UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.transport_route_stops s
    WHERE s.id = p_stop
      AND (public.transport_route_is_mine(s.route_id) OR public.transport_route_has_crew(s.route_id))
  );
$fn$;

CREATE OR REPLACE FUNCTION public.transport_is_transport_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT public.get_user_role() = 'driver'
     OR EXISTS (
       SELECT 1 FROM public.transport_staff ts
       WHERE ts.profile_id = auth.uid() AND ts.active
     );
$fn$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Note on posture: nothing in this module gets a USING (true) read policy. A
-- full stop list is a map of where identified children stand each morning, and
-- a crew record carries licence numbers and home addresses. Both are scoped.

ALTER TABLE public.transport_vehicles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_staff             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_route_stops       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_route_paths       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_route_schedules   ENABLE ROW LEVEL SECURITY;

-- transport_vehicles
DROP POLICY IF EXISTS "Admin manages vehicles" ON public.transport_vehicles;
CREATE POLICY "Admin manages vehicles" ON public.transport_vehicles FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

-- Staff and riders need the bus's identity (name, plate) to recognise it; the
-- compliance dates and notes are simply never selected by non-admin code.
DROP POLICY IF EXISTS "Riders and staff view vehicles" ON public.transport_vehicles;
CREATE POLICY "Riders and staff view vehicles" ON public.transport_vehicles FOR SELECT TO authenticated
  USING (
    (select public.get_user_role()) IN ('teacher', 'coordinator', 'principal', 'admin')
    OR (select public.transport_is_transport_staff())
    OR EXISTS (
      SELECT 1 FROM public.transport_routes r
      WHERE r.default_vehicle_id = transport_vehicles.id
        AND (select public.transport_route_is_mine(r.id))
    )
  );

-- transport_staff
DROP POLICY IF EXISTS "Admin manages transport staff" ON public.transport_staff;
CREATE POLICY "Admin manages transport staff" ON public.transport_staff FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Crew views own transport record" ON public.transport_staff;
CREATE POLICY "Crew views own transport record" ON public.transport_staff FOR SELECT TO authenticated
  USING (profile_id = (select auth.uid()));

-- transport_route_stops
DROP POLICY IF EXISTS "Admin manages route stops" ON public.transport_route_stops;
CREATE POLICY "Admin manages route stops" ON public.transport_route_stops FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Riders and crew view route stops" ON public.transport_route_stops;
CREATE POLICY "Riders and crew view route stops" ON public.transport_route_stops FOR SELECT TO authenticated
  USING (
    (select public.transport_route_is_mine(route_id))
    OR (select public.transport_route_has_crew(route_id))
  );

-- transport_route_paths
DROP POLICY IF EXISTS "Admin manages route paths" ON public.transport_route_paths;
CREATE POLICY "Admin manages route paths" ON public.transport_route_paths FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Riders and crew view route paths" ON public.transport_route_paths;
CREATE POLICY "Riders and crew view route paths" ON public.transport_route_paths FOR SELECT TO authenticated
  USING (
    (select public.transport_route_is_mine(route_id))
    OR (select public.transport_route_has_crew(route_id))
  );

-- transport_route_schedules
DROP POLICY IF EXISTS "Admin manages route schedules" ON public.transport_route_schedules;
CREATE POLICY "Admin manages route schedules" ON public.transport_route_schedules FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Riders and crew view route schedules" ON public.transport_route_schedules;
CREATE POLICY "Riders and crew view route schedules" ON public.transport_route_schedules FOR SELECT TO authenticated
  USING (
    (select public.transport_route_is_mine(route_id))
    OR driver_id = (select auth.uid())
    OR attendant_id = (select auth.uid())
  );

-- Policies carried over the rename keep working (they bind to column attnums,
-- not names), but their names still say "trip". Rename them for legibility.
DROP POLICY IF EXISTS "Admin manage trips" ON public.transport_routes;
DROP POLICY IF EXISTS "Driver views assigned trips" ON public.transport_routes;
DROP POLICY IF EXISTS "Passenger views own trips" ON public.transport_routes;
CREATE POLICY "Admin manages routes" ON public.transport_routes FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');
CREATE POLICY "Crew views assigned routes" ON public.transport_routes FOR SELECT TO authenticated
  USING ((select public.is_trip_driver(id)) OR (select public.transport_route_has_crew(id)));
CREATE POLICY "Rider views own routes" ON public.transport_routes FOR SELECT TO authenticated
  USING ((select public.is_trip_passenger(id)));

DROP POLICY IF EXISTS "Admin manage trip passengers" ON public.transport_student_assignments;
DROP POLICY IF EXISTS "Driver views roster of assigned trips" ON public.transport_student_assignments;
DROP POLICY IF EXISTS "Passenger views own trip membership" ON public.transport_student_assignments;
CREATE POLICY "Admin manages assignments" ON public.transport_student_assignments FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');
CREATE POLICY "Crew views roster of assigned routes" ON public.transport_student_assignments FOR SELECT TO authenticated
  USING ((select public.is_trip_driver(route_id)) OR (select public.transport_route_has_crew(route_id)));
CREATE POLICY "Rider views own assignment" ON public.transport_student_assignments FOR SELECT TO authenticated
  USING (student_id = (select auth.uid()));

-- ── Grants ──────────────────────────────────────────────────────────────────
-- NOT the blanket `GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon,
-- authenticated` that every earlier bus/attendance migration ends with. That
-- statement re-grants EXECUTE on the three cleanup_* functions which
-- lock_down_new_function_grants_v2 exists to revoke, so any migration following
-- the old convention silently re-opens /rest/v1/rpc/cleanup_bus_locations to
-- anonymous callers. Grant on this migration's own objects instead, and
-- re-assert the lockdown at the end.

GRANT ALL ON public.transport_vehicles,
             public.transport_staff,
             public.transport_routes,
             public.transport_route_stops,
             public.transport_route_paths,
             public.transport_route_schedules,
             public.transport_student_assignments
  TO anon, authenticated;

-- RLS helpers are evaluated as the querying role, so `authenticated` needs
-- EXECUTE. `anon` does not — no anon-scoped policy references them.
--
-- Revoking from `anon` alone is NOT enough: a new function is created with
-- EXECUTE granted to PUBLIC and anon inherits through it, so
-- has_function_privilege('anon', ...) stays true. This is the same two-step
-- lock_down_new_function_grants v1/v2 had to discover.
REVOKE EXECUTE ON FUNCTION
  public.transport_route_is_mine(UUID),
  public.transport_route_has_crew(UUID),
  public.transport_stop_is_mine(UUID),
  public.transport_is_transport_staff()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.transport_route_is_mine(UUID),
  public.transport_route_has_crew(UUID),
  public.transport_stop_is_mine(UUID),
  public.transport_is_transport_staff()
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cleanup_bus_locations() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_attendance_location_attempts() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_push_subscriptions() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_teammate_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_teammate_ids() TO authenticated;

NOTIFY pgrst, 'reload schema';
