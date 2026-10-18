-- ============================================================================
-- transport_r7_academic_year — every transport record belongs to a session
-- ============================================================================
-- Safe to re-run. Run after transport_r6_c_bus_fee_in_fee_app.sql and
-- fee_r1_academic_years.sql.
--
-- The bus app gets the same academic-year toggle as the fee app (on its
-- banner), so every record it shows has to say which session it belongs to.
-- `academic_year_id` is added to the tables that are a session's own data:
--
--   transport_routes               a route network is set up per session
--   transport_student_assignments  riders, from their route
--   transport_route_schedules      timetables, from their route
--   transport_trip_runs            trips, from their route (else their date)
--   transport_alerts               from their trip (else when first seen)
--   transport_incidents            from their trip (else when they happened)
--   bus_fees / bus_payments        the old ledger, by billing month / its fee
--   bus_fee_drafts                 by when they were drafted
--
-- Everything else hangs off one of those by a foreign key and so is already
-- in exactly one session: a route's stops, stop fees and path; a trip's stops,
-- passengers, boarding and stop events and metrics; an incident's updates.
-- Buses, crew, scan cards and the connection settings are the school's, not a
-- session's — a bus does not stop existing on 1 April — so they stay shared.
--
-- The column is filled by triggers when the writer leaves it out, so the
-- driver app, the nightly jobs and the GPS ingest keep working unchanged. The
-- admin screens pass the session chosen on the banner when they create a
-- route; everything under a route follows it.
--
-- A new session starts empty. transport_copy_year() carries the running
-- network (routes, stops, stop fees, paths, schedules and current riders)
-- from one session into another, which is what the Configuration tab offers
-- when a session has no routes yet.
-- ============================================================================

-- ── Which session a date falls in ───────────────────────────────────────
-- The stored session covering the date; failing that the active one, so a
-- date outside every stored session still lands somewhere sensible.
CREATE OR REPLACE FUNCTION public.transport_academic_year_for(p_date DATE)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM public.academic_years
      WHERE p_date BETWEEN starts_on AND ends_on
      ORDER BY starts_on DESC LIMIT 1),
    (SELECT id FROM public.academic_years WHERE is_active LIMIT 1)
  );
$$;

GRANT EXECUTE ON FUNCTION public.transport_academic_year_for(DATE) TO authenticated;

-- ── The columns ─────────────────────────────────────────────────────────
ALTER TABLE public.transport_routes
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE RESTRICT;
ALTER TABLE public.transport_student_assignments
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE RESTRICT;
ALTER TABLE public.transport_route_schedules
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE RESTRICT;
ALTER TABLE public.transport_trip_runs
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE RESTRICT;
ALTER TABLE public.transport_alerts
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE RESTRICT;
ALTER TABLE public.transport_incidents
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE RESTRICT;
ALTER TABLE public.bus_fees
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE RESTRICT;
ALTER TABLE public.bus_payments
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE RESTRICT;
ALTER TABLE public.bus_fee_drafts
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE RESTRICT;

-- ── Backfill ────────────────────────────────────────────────────────────
-- With triggers off, so filling in a new column does not bump every row's
-- updated_at or look like an edit to the notification triggers.
SET session_replication_role = replica;

-- Routes still running belong to today's session; archived ones to the
-- session they were archived in.
UPDATE public.transport_routes
   SET academic_year_id = public.transport_academic_year_for(COALESCE(archived_at, now())::DATE)
 WHERE academic_year_id IS NULL;

UPDATE public.transport_student_assignments a
   SET academic_year_id = r.academic_year_id
  FROM public.transport_routes r
 WHERE r.id = a.route_id AND a.academic_year_id IS NULL;

UPDATE public.transport_route_schedules s
   SET academic_year_id = r.academic_year_id
  FROM public.transport_routes r
 WHERE r.id = s.route_id AND s.academic_year_id IS NULL;

-- Trips by the day they ran: a trip from March belongs to that March's
-- session even though its route is carried on today.
UPDATE public.transport_trip_runs
   SET academic_year_id = public.transport_academic_year_for(service_date)
 WHERE academic_year_id IS NULL;

UPDATE public.transport_alerts al
   SET academic_year_id = COALESCE(
         (SELECT tr.academic_year_id FROM public.transport_trip_runs tr WHERE tr.id = al.run_id),
         public.transport_academic_year_for(al.first_seen_at::DATE))
 WHERE al.academic_year_id IS NULL;

UPDATE public.transport_incidents i
   SET academic_year_id = COALESCE(
         (SELECT tr.academic_year_id FROM public.transport_trip_runs tr WHERE tr.id = i.run_id),
         public.transport_academic_year_for(i.occurred_at::DATE))
 WHERE i.academic_year_id IS NULL;

UPDATE public.bus_fees
   SET academic_year_id = public.transport_academic_year_for(
         CASE WHEN billing_period ~ '^\d{4}-\d{2}$' THEN (billing_period || '-01')::DATE
              ELSE COALESCE(due_date, created_at::DATE) END)
 WHERE academic_year_id IS NULL;

UPDATE public.bus_payments p
   SET academic_year_id = COALESCE(
         (SELECT f.academic_year_id FROM public.bus_fees f WHERE f.id = p.fee_id),
         public.transport_academic_year_for(p.created_at::DATE))
 WHERE p.academic_year_id IS NULL;

UPDATE public.bus_fee_drafts
   SET academic_year_id = public.transport_academic_year_for(created_at::DATE)
 WHERE academic_year_id IS NULL;

SET session_replication_role = origin;

-- ── Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS transport_routes_year_idx              ON public.transport_routes (academic_year_id);
CREATE INDEX IF NOT EXISTS transport_student_assignments_year_idx ON public.transport_student_assignments (academic_year_id);
CREATE INDEX IF NOT EXISTS transport_route_schedules_year_idx     ON public.transport_route_schedules (academic_year_id);
CREATE INDEX IF NOT EXISTS transport_trip_runs_year_date_idx      ON public.transport_trip_runs (academic_year_id, service_date);
CREATE INDEX IF NOT EXISTS transport_alerts_year_idx              ON public.transport_alerts (academic_year_id);
CREATE INDEX IF NOT EXISTS transport_incidents_year_idx           ON public.transport_incidents (academic_year_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS bus_fees_year_idx                      ON public.bus_fees (academic_year_id);
CREATE INDEX IF NOT EXISTS bus_payments_year_idx                  ON public.bus_payments (academic_year_id);
CREATE INDEX IF NOT EXISTS bus_fee_drafts_year_idx                ON public.bus_fee_drafts (academic_year_id);

-- A route code is unique within a session, so next session's copy of "R1"
-- can keep its code.
DROP INDEX IF EXISTS public.transport_routes_code_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS transport_routes_year_code_uniq
  ON public.transport_routes (academic_year_id, upper(code)) WHERE code IS NOT NULL;

-- ── Filling the column on write ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transport_fill_academic_year()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'transport_routes' THEN
      IF NEW.academic_year_id IS NULL THEN
        NEW.academic_year_id := public.transport_academic_year_for(CURRENT_DATE);
      END IF;

    -- Riders and timetables always follow their route, including when they
    -- are moved to another one.
    WHEN 'transport_student_assignments', 'transport_route_schedules' THEN
      NEW.academic_year_id := COALESCE(
        (SELECT academic_year_id FROM public.transport_routes WHERE id = NEW.route_id),
        NEW.academic_year_id,
        public.transport_academic_year_for(CURRENT_DATE));

    WHEN 'transport_trip_runs' THEN
      IF NEW.academic_year_id IS NULL THEN
        NEW.academic_year_id := COALESCE(
          (SELECT academic_year_id FROM public.transport_routes WHERE id = NEW.route_id),
          public.transport_academic_year_for(NEW.service_date));
      END IF;

    WHEN 'transport_alerts' THEN
      IF NEW.academic_year_id IS NULL THEN
        NEW.academic_year_id := COALESCE(
          (SELECT academic_year_id FROM public.transport_trip_runs WHERE id = NEW.run_id),
          (SELECT academic_year_id FROM public.transport_routes WHERE id = NEW.route_id),
          public.transport_academic_year_for(COALESCE(NEW.first_seen_at, now())::DATE));
      END IF;

    WHEN 'transport_incidents' THEN
      IF NEW.academic_year_id IS NULL THEN
        NEW.academic_year_id := COALESCE(
          (SELECT academic_year_id FROM public.transport_trip_runs WHERE id = NEW.run_id),
          public.transport_academic_year_for(COALESCE(NEW.occurred_at, now())::DATE));
      END IF;

    WHEN 'bus_fees' THEN
      IF NEW.academic_year_id IS NULL THEN
        NEW.academic_year_id := public.transport_academic_year_for(
          CASE WHEN NEW.billing_period ~ '^\d{4}-\d{2}$' THEN (NEW.billing_period || '-01')::DATE
               ELSE COALESCE(NEW.due_date, COALESCE(NEW.created_at, now())::DATE) END);
      END IF;

    WHEN 'bus_payments' THEN
      IF NEW.academic_year_id IS NULL THEN
        NEW.academic_year_id := COALESCE(
          (SELECT academic_year_id FROM public.bus_fees WHERE id = NEW.fee_id),
          public.transport_academic_year_for(CURRENT_DATE));
      END IF;

    WHEN 'bus_fee_drafts' THEN
      IF NEW.academic_year_id IS NULL THEN
        NEW.academic_year_id := public.transport_academic_year_for(COALESCE(NEW.created_at, now())::DATE);
      END IF;

    ELSE NULL;
  END CASE;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.transport_fill_academic_year() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transport_routes', 'transport_trip_runs', 'transport_alerts',
    'transport_incidents', 'bus_fees', 'bus_payments', 'bus_fee_drafts'
  ] LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER %I BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.transport_fill_academic_year()',
      t || '_academic_year', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['transport_student_assignments', 'transport_route_schedules'] LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER %I BEFORE INSERT OR UPDATE OF route_id ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.transport_fill_academic_year()',
      t || '_academic_year', t);
  END LOOP;
END $$;

-- A route moved to another session takes its riders and timetable with it.
CREATE OR REPLACE FUNCTION public.transport_route_year_cascade()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.transport_student_assignments SET academic_year_id = NEW.academic_year_id
   WHERE route_id = NEW.id AND academic_year_id IS DISTINCT FROM NEW.academic_year_id;
  UPDATE public.transport_route_schedules SET academic_year_id = NEW.academic_year_id
   WHERE route_id = NEW.id AND academic_year_id IS DISTINCT FROM NEW.academic_year_id;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.transport_route_year_cascade() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER transport_routes_year_cascade
  AFTER UPDATE OF academic_year_id ON public.transport_routes
  FOR EACH ROW WHEN (OLD.academic_year_id IS DISTINCT FROM NEW.academic_year_id)
  EXECUTE FUNCTION public.transport_route_year_cascade();

-- ── Trips and bus fee bills only come from the session's own routes ─────
-- Two existing functions pick routes without asking which session they are
-- in: the nightly trip builder and the fee app's bus-fee issue. Each gets one
-- extra condition. They are patched in place rather than restated here, so
-- this file cannot quietly undo a later change to either; a body that no
-- longer has the expected text stops the migration instead of being skipped.
DO $$
DECLARE
  v_def TEXT;
  v_new TEXT;
BEGIN
  v_def := pg_get_functiondef('public.transport_materialise_runs(date)'::regprocedure);
  IF position('r.academic_year_id' IN v_def) = 0 THEN
    v_new := replace(v_def,
      E'AND r.archived_at IS NULL\n       AND dow = ANY (s.days_of_week)',
      E'AND r.archived_at IS NULL\n       AND (r.academic_year_id IS NULL OR r.academic_year_id = public.transport_academic_year_for(d))\n       AND dow = ANY (s.days_of_week)');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'transport_materialise_runs has changed shape; add the academic year condition by hand';
    END IF;
    EXECUTE v_new;
  END IF;

  v_def := pg_get_functiondef('public.fee_issue_transport(uuid,date,date,uuid[],boolean)'::regprocedure);
  IF position('r.academic_year_id' IN v_def) = 0 THEN
    v_new := replace(v_def,
      E'AND r.active AND r.archived_at IS NULL\n',
      E'AND r.active AND r.archived_at IS NULL\n       AND (r.academic_year_id IS NULL OR r.academic_year_id = p_year)\n');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'fee_issue_transport has changed shape; add the academic year condition by hand';
    END IF;
    EXECUTE v_new;
  END IF;
END $$;

-- ── Carrying a network into a new session ───────────────────────────────
-- Copies every unarchived route of p_from into p_to, with its stops, stop
-- fees, paths, schedules and current riders. A route whose code (or, without
-- a code, whose name) is already in p_to is skipped, so running it twice
-- copies nothing twice. Returns how many routes were copied.
CREATE OR REPLACE FUNCTION public.transport_copy_year(p_from UUID, p_to UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_starts  DATE;
  v_route   RECORD;
  v_stop    RECORD;
  v_new     UUID;
  v_new_stop UUID;
  v_map     JSONB;
  v_copied  INTEGER := 0;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin can copy routes between sessions';
  END IF;
  IF p_from = p_to THEN
    RAISE EXCEPTION 'Choose two different sessions';
  END IF;
  SELECT starts_on INTO v_starts FROM public.academic_years WHERE id = p_to;
  IF v_starts IS NULL THEN RAISE EXCEPTION 'That session does not exist'; END IF;

  FOR v_route IN
    SELECT * FROM public.transport_routes
     WHERE academic_year_id = p_from AND archived_at IS NULL
     ORDER BY name
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.transport_routes t
       WHERE t.academic_year_id = p_to
         AND CASE WHEN v_route.code IS NOT NULL THEN upper(t.code) = upper(v_route.code)
                  ELSE t.code IS NULL AND t.name = v_route.name END
    ) THEN
      CONTINUE;
    END IF;

    -- Where the old school-wide code index is still in place (see the index
    -- section above), the copy keeps its name and drops the code rather than
    -- failing the whole copy.
    BEGIN
      INSERT INTO public.transport_routes (
        name, description, pickup_time, drop_time, default_driver_id, active, created_by,
        code, color, default_vehicle_id, default_attendant_id, settings, direction, fee_mode,
        academic_year_id)
      VALUES (
        v_route.name, v_route.description, v_route.pickup_time, v_route.drop_time,
        v_route.default_driver_id, v_route.active, auth.uid(),
        v_route.code, v_route.color, v_route.default_vehicle_id, v_route.default_attendant_id,
        v_route.settings, v_route.direction, v_route.fee_mode, p_to)
      RETURNING id INTO v_new;
    EXCEPTION WHEN unique_violation THEN
      INSERT INTO public.transport_routes (
        name, description, pickup_time, drop_time, default_driver_id, active, created_by,
        code, color, default_vehicle_id, default_attendant_id, settings, direction, fee_mode,
        academic_year_id)
      VALUES (
        v_route.name, v_route.description, v_route.pickup_time, v_route.drop_time,
        v_route.default_driver_id, v_route.active, auth.uid(),
        NULL, v_route.color, v_route.default_vehicle_id, v_route.default_attendant_id,
        v_route.settings, v_route.direction, v_route.fee_mode, p_to)
      RETURNING id INTO v_new;
    END;

    -- Stops, remembering old id -> new id for everything that points at one.
    v_map := '{}'::JSONB;
    FOR v_stop IN SELECT * FROM public.transport_route_stops WHERE route_id = v_route.id ORDER BY seq LOOP
      INSERT INTO public.transport_route_stops (
        route_id, seq, name, landmark, lat, lng, radius_m, shape, polygon, trusted_accuracy_m,
        inbound_offset_min, outbound_offset_min, dwell_seconds, kind, active)
      VALUES (
        v_new, v_stop.seq, v_stop.name, v_stop.landmark, v_stop.lat, v_stop.lng, v_stop.radius_m,
        v_stop.shape, v_stop.polygon, v_stop.trusted_accuracy_m, v_stop.inbound_offset_min,
        v_stop.outbound_offset_min, v_stop.dwell_seconds, v_stop.kind, v_stop.active)
      RETURNING id INTO v_new_stop;
      v_map := v_map || jsonb_build_object(v_stop.id::TEXT, v_new_stop);
    END LOOP;

    IF v_route.school_stop_id IS NOT NULL THEN
      UPDATE public.transport_routes
         SET school_stop_id = (v_map ->> v_route.school_stop_id::TEXT)::UUID
       WHERE id = v_new;
    END IF;

    INSERT INTO public.transport_stop_fees (stop_id, route_id, amount, amount_one_way, updated_by, updated_at)
    SELECT (v_map ->> f.stop_id::TEXT)::UUID, v_new, f.amount, f.amount_one_way, auth.uid(), now()
      FROM public.transport_stop_fees f
     WHERE f.route_id = v_route.id AND v_map ? f.stop_id::TEXT;

    INSERT INTO public.transport_route_paths (route_id, direction, polyline, corridor_m, length_m, cumulative, source, updated_by, updated_at)
    SELECT v_new, p.direction, p.polyline, p.corridor_m, p.length_m, p.cumulative, p.source, auth.uid(), now()
      FROM public.transport_route_paths p
     WHERE p.route_id = v_route.id;

    -- Timetables run all of the new session: the old one's date limits
    -- belonged to the old session.
    INSERT INTO public.transport_route_schedules (
      route_id, direction, label, days_of_week, start_time, end_time, vehicle_id, driver_id,
      attendant_id, auto_start, active, created_by)
    SELECT v_new, s.direction, s.label, s.days_of_week, s.start_time, s.end_time, s.vehicle_id,
           s.driver_id, s.attendant_id, s.auto_start, s.active, auth.uid()
      FROM public.transport_route_schedules s
     WHERE s.route_id = v_route.id AND s.active;

    -- Riders still on the route, starting the day the new session starts.
    INSERT INTO public.transport_student_assignments (
      route_id, student_id, fee_amount, location_label, pickup_stop_id, drop_stop_id,
      rides_inbound, rides_outbound, started_on, guardian_phone, notes)
    SELECT v_new, a.student_id, a.fee_amount, a.location_label,
           (v_map ->> a.pickup_stop_id::TEXT)::UUID, (v_map ->> a.drop_stop_id::TEXT)::UUID,
           a.rides_inbound, a.rides_outbound, v_starts, a.guardian_phone, a.notes
      FROM public.transport_student_assignments a
     WHERE a.route_id = v_route.id AND a.ended_on IS NULL
    ON CONFLICT (route_id, student_id) DO NOTHING;

    v_copied := v_copied + 1;
  END LOOP;

  RETURN v_copied;
END $$;

REVOKE ALL ON FUNCTION public.transport_copy_year(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_copy_year(UUID, UUID) TO authenticated;
