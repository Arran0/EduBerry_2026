-- ============================================================================
-- Migration: Transport — Round 2b, the derivation engine
--
-- All per-fix derivation hangs off an AFTER INSERT trigger on
-- transport_telemetry. That is the load-bearing choice of the whole design:
-- the driver's phone and (in Round 3) an AIS-140 device write the same row
-- through the same path, so stop detection, progress and delay behave
-- identically for both and no adapter can skip a rule.
--
-- Geometry is reused, not reinvented. `attendance_haversine_m` and
-- `attendance_location_verdict` are called verbatim for stop arrival, so a bus
-- stop obeys exactly the rules the attendance module already argues for at
-- length — including that an `uncertain` verdict is recorded but does NOT fire
-- an arrival. One new function is added, `transport_point_to_path_m`, which is
-- the same local-equirectangular trick applied to an open polyline.
--
-- Prereq: transport_r2_a_runs_and_telemetry.sql.
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- ── Geometry ────────────────────────────────────────────────────────────────

/**
 * Distance from a point to a route polyline, plus how far along it the point is.
 *
 * Mirrored in TypeScript by src/lib/transport/path.ts, which imports
 * `distanceToSegment` from src/lib/geofence.ts rather than copying it. If you
 * change a rule here, change it there too — the same standing instruction the
 * geofence module carries.
 *
 * No PostGIS: a local equirectangular projection is accurate to well under a
 * metre at route scale, two orders of magnitude below GPS error, and it keeps
 * this migration free of an extension prerequisite.
 */
CREATE OR REPLACE FUNCTION public.transport_point_to_path_m(
  p_lat        DOUBLE PRECISION,
  p_lng        DOUBLE PRECISION,
  p_polyline   JSONB,
  p_cumulative JSONB DEFAULT NULL
)
RETURNS TABLE (distance_m DOUBLE PRECISION, segment_index INTEGER, progress_m DOUBLE PRECISION)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = public AS $fn$
DECLARE
  metres_per_degree CONSTANT DOUBLE PRECISION := 111320.0;
  n INTEGER;
  i INTEGER;
  ref_lat DOUBLE PRECISION;
  kx DOUBLE PRECISION;
  mx DOUBLE PRECISION; my DOUBLE PRECISION;
  ax DOUBLE PRECISION; ay DOUBLE PRECISION;
  b_x DOUBLE PRECISION; b_y DOUBLE PRECISION;
  vx DOUBLE PRECISION; vy DOUBLE PRECISION;
  wx DOUBLE PRECISION; wy DOUBLE PRECISION;
  seg_len2 DOUBLE PRECISION; t DOUBLE PRECISION;
  px DOUBLE PRECISION; py DOUBLE PRECISION; d DOUBLE PRECISION;
  best_d DOUBLE PRECISION := NULL;
  best_i INTEGER := 0;
  best_t DOUBLE PRECISION := 0;
  base DOUBLE PRECISION := 0;
  seg_len DOUBLE PRECISION := 0;
BEGIN
  n := jsonb_array_length(COALESCE(p_polyline, '[]'::jsonb));
  IF n < 2 THEN RETURN; END IF;

  -- One reference latitude for the whole path: a school route spans a few km,
  -- over which the longitude scale factor is effectively constant.
  ref_lat := (p_polyline -> 0 ->> 'lat')::DOUBLE PRECISION;
  kx := metres_per_degree * cos(radians(ref_lat));

  mx := p_lng * kx;
  my := p_lat * metres_per_degree;

  FOR i IN 0 .. (n - 2) LOOP
    ax := (p_polyline -> i ->> 'lng')::DOUBLE PRECISION * kx;
    ay := (p_polyline -> i ->> 'lat')::DOUBLE PRECISION * metres_per_degree;
    b_x := (p_polyline -> (i + 1) ->> 'lng')::DOUBLE PRECISION * kx;
    b_y := (p_polyline -> (i + 1) ->> 'lat')::DOUBLE PRECISION * metres_per_degree;

    vx := b_x - ax; vy := b_y - ay;
    wx := mx - ax; wy := my - ay;
    seg_len2 := vx * vx + vy * vy;

    IF seg_len2 = 0 THEN
      t := 0;
    ELSE
      t := GREATEST(0, LEAST(1, (wx * vx + wy * vy) / seg_len2));
    END IF;

    px := ax + t * vx;
    py := ay + t * vy;
    d := sqrt((mx - px) * (mx - px) + (my - py) * (my - py));

    IF best_d IS NULL OR d < best_d THEN
      best_d := d; best_i := i; best_t := t;
    END IF;
  END LOOP;

  IF p_cumulative IS NOT NULL AND jsonb_array_length(p_cumulative) >= best_i + 2 THEN
    base := (p_cumulative ->> best_i)::DOUBLE PRECISION;
    seg_len := (p_cumulative ->> (best_i + 1))::DOUBLE PRECISION - base;
  END IF;

  distance_m := best_d;
  segment_index := best_i;
  progress_m := base + best_t * seg_len;
  RETURN NEXT;
END $fn$;

-- ── RLS helpers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transport_is_crew(p_run UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.transport_trip_runs r
    WHERE r.id = p_run
      AND (r.driver_id = auth.uid() OR r.attendant_id = auth.uid())
  );
$fn$;

/**
 * Is this run carrying the caller's child?
 *
 * Reads transport_run_passengers, which is materialised when the run is
 * created, so this is a single index lookup on (run_id, student_id) rather than
 * a join back through assignments. That matters: this predicate is evaluated on
 * every telemetry row a parent reads.
 */
CREATE OR REPLACE FUNCTION public.transport_run_is_mine(p_run UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.transport_run_passengers p
    WHERE p.run_id = p_run AND p.student_id = auth.uid()
  );
$fn$;

-- ── ETA ─────────────────────────────────────────────────────────────────────

/**
 * Recompute the rolling ETA for every stop a run has not reached yet.
 *
 * Remaining distance is measured ALONG the route path, not straight-line, over
 * a speed estimate clamped to a sane band — a bus at a red light reports 0 km/h
 * and would otherwise yield an infinite ETA. Dwell time is added for each
 * intervening stop.
 *
 * The honesty rule, and the most important line in this function: when
 * telemetry is not live, every ETA is set to NULL. The parent screen then shows
 * the scheduled time and "last seen N minutes ago". A confidently wrong ETA is
 * worse than an admitted absence, and that belongs here rather than in the UI.
 */
CREATE OR REPLACE FUNCTION public.transport_recompute_eta(p_run UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r RECORD;
  path RECORD;
  avg_kmh DOUBLE PRECISION;
  speed_ms DOUBLE PRECISION;
  rs RECORD;
  stop_progress DOUBLE PRECISION;
  remaining DOUBLE PRECISION;
  stops_between INTEGER := 0;
  dwell INTEGER;
  eta TIMESTAMPTZ;
BEGIN
  SELECT * INTO r FROM public.transport_trip_runs WHERE id = p_run;
  IF NOT FOUND THEN RETURN; END IF;

  IF r.telemetry_state <> 'live' OR r.progress_m IS NULL THEN
    UPDATE public.transport_run_stops
       SET eta_at = NULL, eta_updated_at = NOW()
     WHERE run_id = p_run AND arrived_at IS NULL AND eta_at IS NOT NULL;
    UPDATE public.transport_trip_runs SET next_stop_eta_at = NULL WHERE id = p_run;
    RETURN;
  END IF;

  SELECT * INTO path
    FROM public.transport_route_paths
   WHERE route_id = r.route_id AND direction = r.direction;

  -- Median of the last five minutes of movement, clamped. The clamp is what
  -- stops a bus waiting at a junction from projecting an ETA of never.
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY speed_kmh)
    INTO avg_kmh
    FROM public.transport_telemetry
   WHERE run_id = p_run
     AND NOT suspect
     AND speed_kmh IS NOT NULL
     AND recorded_at > NOW() - INTERVAL '5 minutes';

  avg_kmh := GREATEST(8, LEAST(45, COALESCE(avg_kmh, 22)));
  speed_ms := avg_kmh * 1000.0 / 3600.0;

  FOR rs IN
    SELECT rst.id, rst.seq, s.dwell_seconds, s.lat, s.lng
      FROM public.transport_run_stops rst
      JOIN public.transport_route_stops s ON s.id = rst.stop_id
     WHERE rst.run_id = p_run AND rst.arrived_at IS NULL AND NOT rst.skipped
     ORDER BY rst.seq
  LOOP
    stop_progress := NULL;
    IF path.polyline IS NOT NULL THEN
      SELECT progress_m INTO stop_progress
        FROM public.transport_point_to_path_m(rs.lat, rs.lng, path.polyline, path.cumulative);
    END IF;

    IF stop_progress IS NOT NULL THEN
      remaining := GREATEST(0, stop_progress - r.progress_m);
    ELSE
      -- No path drawn yet: fall back to straight-line from the last fix. Honest
      -- but coarse, and the stop editor nudges the admin to draw a path.
      remaining := public.attendance_haversine_m(r.last_lat, r.last_lng, rs.lat, rs.lng);
    END IF;

    dwell := COALESCE(rs.dwell_seconds, 60) * stops_between;
    eta := NOW() + make_interval(secs => (remaining / speed_ms) + dwell);

    UPDATE public.transport_run_stops
       SET eta_at = eta, eta_updated_at = NOW()
     WHERE id = rs.id;

    stops_between := stops_between + 1;
  END LOOP;

  UPDATE public.transport_trip_runs r2
     SET next_stop_eta_at = (
       SELECT eta_at FROM public.transport_run_stops
        WHERE run_id = p_run AND arrived_at IS NULL AND NOT skipped
        ORDER BY seq LIMIT 1
     )
   WHERE r2.id = p_run;
END $fn$;

-- ── Per-fix derivation ──────────────────────────────────────────────────────

/**
 * Everything that can be decided from one new position.
 *
 * Touches one run row by primary key and at most the next two run-stop rows, so
 * at a fleet of tens reporting every ten seconds this is a couple of
 * evaluations a second — cheap enough to run on every fix, which is what gives
 * parents sub-second arrival detection while the heavier sweep stays on a
 * one-minute cadence in transport_tick().
 */
CREATE OR REPLACE FUNCTION public.transport_process_fix(p_telemetry_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  t RECORD;
  r RECORD;
  path RECORD;
  proj RECORD;
  rs RECORD;
  v RECORD;
  arrived_any BOOLEAN := false;
BEGIN
  SELECT * INTO t FROM public.transport_telemetry WHERE id = p_telemetry_id;
  IF NOT FOUND OR t.run_id IS NULL OR t.suspect THEN RETURN; END IF;

  SELECT * INTO r FROM public.transport_trip_runs WHERE id = t.run_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Out-of-order fixes are stored (a device flushing a tunnel buffer is
  -- emitting correct history) but never rewind the live position.
  IF r.last_fix_at IS NOT NULL AND t.recorded_at <= r.last_fix_at THEN RETURN; END IF;

  -- Only the active source drives the summary, so a run carrying both a device
  -- and a phone does not jitter between two points 200 m apart.
  IF r.active_source_id IS NOT NULL AND t.source_id IS DISTINCT FROM r.active_source_id THEN
    RETURN;
  END IF;

  SELECT * INTO path
    FROM public.transport_route_paths
   WHERE route_id = r.route_id AND direction = r.direction;

  IF path.polyline IS NOT NULL THEN
    SELECT * INTO proj
      FROM public.transport_point_to_path_m(t.lat, t.lng, path.polyline, path.cumulative);
  END IF;

  UPDATE public.transport_trip_runs
     SET last_fix_at      = t.recorded_at,
         last_lat         = t.lat,
         last_lng         = t.lng,
         last_heading_deg = t.heading_deg,
         last_speed_kmh   = t.speed_kmh,
         telemetry_state  = 'live',
         progress_m       = COALESCE(proj.progress_m, progress_m),
         off_route_m      = proj.distance_m
   WHERE id = t.run_id;

  IF r.status NOT IN ('boarding', 'in_progress') THEN RETURN; END IF;

  -- Stop detection, limited to the next two unvisited stops plus any stop the
  -- bus is currently sitting at. Evaluating the whole route on every fix would
  -- let a bus "arrive" at a stop it has not reached because the road doubles
  -- back near it.
  FOR rs IN
    SELECT rst.id AS run_stop_id, rst.seq, rst.arrived_at, rst.departed_at,
           s.id AS stop_id, s.lat, s.lng, s.radius_m, s.shape, s.polygon, s.trusted_accuracy_m
      FROM public.transport_run_stops rst
      JOIN public.transport_route_stops s ON s.id = rst.stop_id
     WHERE rst.run_id = t.run_id
       AND NOT rst.skipped
       AND (rst.arrived_at IS NULL OR rst.departed_at IS NULL)
     ORDER BY rst.seq
     LIMIT 3
  LOOP
    SELECT * INTO v FROM public.attendance_location_verdict(
      t.lat, t.lng, COALESCE(t.accuracy_m, 25)::DOUBLE PRECISION,
      rs.shape, rs.lat, rs.lng, rs.radius_m, rs.polygon, rs.trusted_accuracy_m
    );

    IF rs.arrived_at IS NULL THEN
      -- `uncertain` deliberately does not fire an arrival. It is recorded on
      -- the stop event so a coarse fix is visible rather than silently
      -- inventing or suppressing a stop.
      IF v.verdict = 'inside' THEN
        UPDATE public.transport_run_stops
           SET arrived_at = t.recorded_at,
               arrival_source = 'geofence',
               arrival_verdict = v.verdict
         WHERE id = rs.run_stop_id AND arrived_at IS NULL;

        INSERT INTO public.transport_stop_events
          (run_id, run_stop_id, stop_id, event_type, source, occurred_at,
           telemetry_id, lat, lng, distance_m, verdict)
        VALUES
          (t.run_id, rs.run_stop_id, rs.stop_id, 'arrival', 'geofence', t.recorded_at,
           t.id, t.lat, t.lng, v.distance_m, v.verdict)
        ON CONFLICT DO NOTHING;

        UPDATE public.transport_trip_runs SET current_stop_id = rs.stop_id WHERE id = t.run_id;
        arrived_any := true;
      END IF;

    ELSIF rs.departed_at IS NULL AND v.verdict = 'outside' THEN
      UPDATE public.transport_run_stops
         SET departed_at = t.recorded_at
       WHERE id = rs.run_stop_id AND departed_at IS NULL;

      INSERT INTO public.transport_stop_events
        (run_id, run_stop_id, stop_id, event_type, source, occurred_at,
         telemetry_id, lat, lng, distance_m, verdict)
      VALUES
        (t.run_id, rs.run_stop_id, rs.stop_id, 'departure', 'geofence', t.recorded_at,
         t.id, t.lat, t.lng, v.distance_m, v.verdict)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- Next stop and the delay against its schedule.
  UPDATE public.transport_trip_runs r2
     SET next_stop_id = ns.stop_id,
         delay_seconds = CASE
           WHEN ns.scheduled_arrival_at IS NULL THEN r2.delay_seconds
           ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - ns.scheduled_arrival_at))::INTEGER)
         END
    FROM (
      SELECT stop_id, scheduled_arrival_at
        FROM public.transport_run_stops
       WHERE run_id = t.run_id AND arrived_at IS NULL AND NOT skipped
       ORDER BY seq LIMIT 1
    ) ns
   WHERE r2.id = t.run_id;

  PERFORM public.transport_recompute_eta(t.run_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.transport_apply_fix()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  PERFORM public.transport_process_fix(NEW.id);
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS transport_telemetry_apply ON public.transport_telemetry;
CREATE TRIGGER transport_telemetry_apply
  AFTER INSERT ON public.transport_telemetry
  FOR EACH ROW EXECUTE FUNCTION public.transport_apply_fix();

-- ── Run lifecycle ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transport_start_run(p_run UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.transport_trip_runs WHERE id = p_run;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Run not found'); END IF;
  IF NOT (public.transport_is_crew(p_run) OR public.get_user_role() = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not your run');
  END IF;
  IF r.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This run has already finished');
  END IF;

  UPDATE public.transport_trip_runs
     SET status = 'in_progress', started_at = COALESCE(started_at, NOW())
   WHERE id = p_run;
  RETURN jsonb_build_object('ok', true);
END $fn$;

/**
 * Close a run — but not with a child unaccounted for.
 *
 * A driver who ends the trip while someone is still marked aboard is the exact
 * situation this module exists to prevent, so the refusal is in the database
 * rather than in a confirm() the UI could skip.
 */
CREATE OR REPLACE FUNCTION public.transport_end_run(p_run UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r RECORD;
  still_aboard INTEGER;
BEGIN
  SELECT * INTO r FROM public.transport_trip_runs WHERE id = p_run;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Run not found'); END IF;
  IF NOT (public.transport_is_crew(p_run) OR public.get_user_role() = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not your run');
  END IF;

  SELECT count(*) INTO still_aboard
    FROM public.transport_run_passengers
   WHERE run_id = p_run AND state = 'boarded';

  IF still_aboard > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('%s student(s) are still marked on board. Drop them off or mark what happened before ending the trip.', still_aboard),
      'still_aboard', still_aboard);
  END IF;

  UPDATE public.transport_trip_runs
     SET status = 'completed', ended_at = NOW(), next_stop_eta_at = NULL
   WHERE id = p_run;
  UPDATE public.transport_run_stops SET eta_at = NULL WHERE run_id = p_run AND eta_at IS NOT NULL;

  RETURN jsonb_build_object('ok', true);
END $fn$;

-- ── Boarding ────────────────────────────────────────────────────────────────

/**
 * The one write path for boarding state.
 *
 * Authorises, appends the audit event, upserts the passenger row and keeps the
 * stop's counter in step — in one transaction. Doing this as an RPC rather than
 * as client-side inserts is what makes "child boarded" a single atomic,
 * idempotent, notifiable fact.
 */
CREATE OR REPLACE FUNCTION public.transport_mark_boarding(
  p_run     UUID,
  p_student UUID,
  p_event   public.transport_boarding_event,
  p_stop    UUID DEFAULT NULL,
  p_method  public.transport_scan_method DEFAULT 'manual',
  p_note    TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  new_state public.transport_boarding_state;
  target_stop UUID;
  now_ts TIMESTAMPTZ := NOW();
BEGIN
  IF NOT (public.transport_is_crew(p_run) OR public.get_user_role() = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not your run');
  END IF;

  new_state := CASE p_event
    WHEN 'board'         THEN 'boarded'
    WHEN 'alight'        THEN 'dropped'
    WHEN 'mark_absent'   THEN 'absent'
    WHEN 'mark_excused'  THEN 'excused'
    WHEN 'undo'          THEN 'expected'
  END;

  target_stop := COALESCE(
    p_stop,
    (SELECT current_stop_id FROM public.transport_trip_runs WHERE id = p_run),
    CASE WHEN p_event = 'alight'
         THEN (SELECT alight_stop_id FROM public.transport_run_passengers WHERE run_id = p_run AND student_id = p_student)
         ELSE (SELECT board_stop_id  FROM public.transport_run_passengers WHERE run_id = p_run AND student_id = p_student)
    END
  );

  INSERT INTO public.transport_boarding_events
    (run_id, student_id, event, stop_id, occurred_at, method, actor_id, note)
  VALUES (p_run, p_student, p_event, target_stop, now_ts, p_method, auth.uid(), p_note);

  INSERT INTO public.transport_run_passengers (run_id, student_id, state, method, marked_by)
  VALUES (p_run, p_student, new_state, p_method, auth.uid())
  ON CONFLICT (run_id, student_id) DO UPDATE
    SET state       = EXCLUDED.state,
        method      = EXCLUDED.method,
        marked_by   = EXCLUDED.marked_by,
        boarded_at  = CASE WHEN p_event = 'board'  THEN now_ts
                           WHEN p_event = 'undo'   THEN NULL
                           ELSE public.transport_run_passengers.boarded_at END,
        alighted_at = CASE WHEN p_event = 'alight' THEN now_ts
                           WHEN p_event = 'undo'   THEN NULL
                           ELSE public.transport_run_passengers.alighted_at END,
        updated_at  = now_ts;

  IF target_stop IS NOT NULL THEN
    UPDATE public.transport_run_stops rs
       SET actual_boardings = (
         SELECT count(*) FROM public.transport_run_passengers p
          WHERE p.run_id = p_run AND p.board_stop_id = target_stop AND p.state IN ('boarded', 'dropped')
       )
     WHERE rs.run_id = p_run AND rs.stop_id = target_stop;
  END IF;

  RETURN jsonb_build_object('ok', true, 'state', new_state);
END $fn$;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.transport_trip_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_run_stops         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_run_passengers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_boarding_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_telemetry_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_telemetry         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_stop_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_alerts            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manages trip runs" ON public.transport_trip_runs;
CREATE POLICY "Admin manages trip runs" ON public.transport_trip_runs FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Crew views own runs" ON public.transport_trip_runs;
CREATE POLICY "Crew views own runs" ON public.transport_trip_runs FOR SELECT TO authenticated
  USING (driver_id = (select auth.uid()) OR attendant_id = (select auth.uid()));

DROP POLICY IF EXISTS "Rider views own runs" ON public.transport_trip_runs;
CREATE POLICY "Rider views own runs" ON public.transport_trip_runs FOR SELECT TO authenticated
  USING ((select public.transport_run_is_mine(id)));

-- Crew never UPDATE the run directly: status changes go through
-- transport_start_run / transport_end_run, which enforce the "nobody left
-- aboard" rule that a direct UPDATE would bypass.

DROP POLICY IF EXISTS "Admin manages run stops" ON public.transport_run_stops;
CREATE POLICY "Admin manages run stops" ON public.transport_run_stops FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Crew and riders view run stops" ON public.transport_run_stops;
CREATE POLICY "Crew and riders view run stops" ON public.transport_run_stops FOR SELECT TO authenticated
  USING ((select public.transport_is_crew(run_id)) OR (select public.transport_run_is_mine(run_id)));

DROP POLICY IF EXISTS "Admin manages run passengers" ON public.transport_run_passengers;
CREATE POLICY "Admin manages run passengers" ON public.transport_run_passengers FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Crew views run roster" ON public.transport_run_passengers;
CREATE POLICY "Crew views run roster" ON public.transport_run_passengers FOR SELECT TO authenticated
  USING ((select public.transport_is_crew(run_id)));

-- A parent sees only their own child's row, never the rest of the roster.
DROP POLICY IF EXISTS "Rider views own boarding" ON public.transport_run_passengers;
CREATE POLICY "Rider views own boarding" ON public.transport_run_passengers FOR SELECT TO authenticated
  USING (student_id = (select auth.uid()));

DROP POLICY IF EXISTS "Admin views boarding events" ON public.transport_boarding_events;
CREATE POLICY "Admin views boarding events" ON public.transport_boarding_events FOR SELECT TO authenticated
  USING ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Crew views own-run boarding events" ON public.transport_boarding_events;
CREATE POLICY "Crew views own-run boarding events" ON public.transport_boarding_events FOR SELECT TO authenticated
  USING ((select public.transport_is_crew(run_id)));

DROP POLICY IF EXISTS "Rider views own boarding events" ON public.transport_boarding_events;
CREATE POLICY "Rider views own boarding events" ON public.transport_boarding_events FOR SELECT TO authenticated
  USING (student_id = (select auth.uid()));

-- Boarding events are written only by transport_mark_boarding(), so the audit
-- trail cannot be authored by the party it exists to audit.
DROP POLICY IF EXISTS "No direct writes to boarding events" ON public.transport_boarding_events;
CREATE POLICY "No direct writes to boarding events" ON public.transport_boarding_events FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Admin manages telemetry sources" ON public.transport_telemetry_sources;
CREATE POLICY "Admin manages telemetry sources" ON public.transport_telemetry_sources FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Admin reads telemetry" ON public.transport_telemetry;
CREATE POLICY "Admin reads telemetry" ON public.transport_telemetry FOR SELECT TO authenticated
  USING ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Crew reads own-run telemetry" ON public.transport_telemetry;
CREATE POLICY "Crew reads own-run telemetry" ON public.transport_telemetry FOR SELECT TO authenticated
  USING ((select public.transport_is_crew(run_id)));

DROP POLICY IF EXISTS "Rider reads own-run telemetry" ON public.transport_telemetry;
CREATE POLICY "Rider reads own-run telemetry" ON public.transport_telemetry FOR SELECT TO authenticated
  USING ((select public.transport_run_is_mine(run_id)));

-- The driver's phone writes directly under RLS — no API hop, so the offline
-- queue can flush straight to Postgres. Hardware sources arrive through
-- /api/transport/ingest under the service role and never touch this policy.
DROP POLICY IF EXISTS "Driver streams own run" ON public.transport_telemetry;
CREATE POLICY "Driver streams own run" ON public.transport_telemetry FOR INSERT TO authenticated
  WITH CHECK (
    source = 'driver_app'
    AND reported_by = (select auth.uid())
    AND (select public.transport_is_crew(run_id))
  );

DROP POLICY IF EXISTS "Admin views stop events" ON public.transport_stop_events;
CREATE POLICY "Admin views stop events" ON public.transport_stop_events FOR SELECT TO authenticated
  USING ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Crew and riders view stop events" ON public.transport_stop_events;
CREATE POLICY "Crew and riders view stop events" ON public.transport_stop_events FOR SELECT TO authenticated
  USING ((select public.transport_is_crew(run_id)) OR (select public.transport_run_is_mine(run_id)));

DROP POLICY IF EXISTS "Admin manages alerts" ON public.transport_alerts;
CREATE POLICY "Admin manages alerts" ON public.transport_alerts FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Crew views own-run alerts" ON public.transport_alerts;
CREATE POLICY "Crew views own-run alerts" ON public.transport_alerts FOR SELECT TO authenticated
  USING ((select public.transport_is_crew(run_id)));

-- A parent sees an alert about their own child, or one about the bus their
-- child is on — never one naming another family.
DROP POLICY IF EXISTS "Rider views relevant alerts" ON public.transport_alerts;
CREATE POLICY "Rider views relevant alerts" ON public.transport_alerts FOR SELECT TO authenticated
  USING (
    student_id = (select auth.uid())
    OR (student_id IS NULL AND (select public.transport_run_is_mine(run_id)))
  );

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Deliberately not the blanket ALL ROUTINES grant the older migrations end
-- with; see the note in transport_r1_foundation.sql.

GRANT ALL ON public.transport_trip_runs,
             public.transport_run_stops,
             public.transport_run_passengers,
             public.transport_boarding_events,
             public.transport_telemetry_sources,
             public.transport_telemetry,
             public.transport_stop_events,
             public.transport_alerts
  TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE
  public.transport_telemetry_id_seq,
  public.transport_boarding_events_id_seq,
  public.transport_stop_events_id_seq
  TO anon, authenticated;

-- Callable RPCs.
REVOKE EXECUTE ON FUNCTION
  public.transport_start_run(UUID),
  public.transport_end_run(UUID),
  public.transport_mark_boarding(UUID, UUID, public.transport_boarding_event, UUID, public.transport_scan_method, TEXT),
  public.transport_is_crew(UUID),
  public.transport_run_is_mine(UUID),
  public.transport_point_to_path_m(DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.transport_start_run(UUID),
  public.transport_end_run(UUID),
  public.transport_mark_boarding(UUID, UUID, public.transport_boarding_event, UUID, public.transport_scan_method, TEXT),
  public.transport_is_crew(UUID),
  public.transport_run_is_mine(UUID),
  public.transport_point_to_path_m(DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB)
  TO authenticated;

-- Engine internals: never callable over PostgREST. Without this any signed-in
-- user could drive the state machine directly.
REVOKE EXECUTE ON FUNCTION
  public.transport_process_fix(BIGINT),
  public.transport_recompute_eta(UUID),
  public.transport_apply_fix()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
