-- ============================================================================
-- Migration: Transport — Round 5b, a route without a drawn path must not kill
-- its own GPS stream
--
-- transport_process_fix projects each fix onto the route polyline to get
-- progress along the route and metres off it. A route that has no polyline yet
-- has nothing to project onto, and the function correctly skips the projection:
--
--     IF path.polyline IS NOT NULL THEN
--       SELECT * INTO proj FROM public.transport_point_to_path_m(...);
--     END IF;
--
-- and then, unconditionally:
--
--     SET progress_m  = COALESCE(proj.progress_m, progress_m),
--         off_route_m = proj.distance_m
--
-- `proj` is a RECORD. When the branch above does not run, it is never assigned,
-- and PL/pgSQL raises 55000 "record proj is not assigned yet" rather than
-- yielding NULL — the tuple structure of an unassigned record is indeterminate,
-- so it cannot even be read as empty. The COALESCE looks like it is handling
-- the missing case and does not: it is evaluated after the record is already
-- dereferenced.
--
-- The consequence is not a null column, it is a thrown exception inside an
-- AFTER INSERT trigger, which aborts the INSERT that fired it. So **every GPS
-- fix on a route with no drawn path is rejected**: the driver's phone streams
-- into a wall, the bus never appears on the live map, no stop arrival is ever
-- detected, and no parent is told anything. The failure is total and it is
-- silent from the admin's side — the route looks fine, because the route IS
-- fine; the polyline is simply a separate thing someone draws later.
--
-- This was reachable on day one: at the time of writing the live project has
-- one route and zero route paths, so the school's first trip would have hit it.
--
-- The fix is to stop using a RECORD for a value that is legitimately absent.
-- Two scalars default to NULL, so the COALESCE finally means what it always
-- looked like it meant, and `off_route_m` becomes NULL — which is the honest
-- answer: with no path to measure against, how far off it the bus is, is not a
-- number anyone knows. Everything downstream of the projection (stop geofence
-- detection, arrivals, departures, ETA) never needed the path and now runs
-- normally on a pathless route.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.transport_process_fix(p_telemetry_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD;
  r RECORD;
  path RECORD;
  rs RECORD;
  v RECORD;
  -- Scalars, not a RECORD: these are genuinely absent when the route has no
  -- polyline, and a NULL scalar can be read whereas an unassigned record
  -- cannot. See this migration's header.
  v_progress_m  DOUBLE PRECISION;
  v_off_route_m DOUBLE PRECISION;
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
    SELECT p.progress_m, p.distance_m
      INTO v_progress_m, v_off_route_m
      FROM public.transport_point_to_path_m(t.lat, t.lng, path.polyline, path.cumulative) p;
  END IF;

  UPDATE public.transport_trip_runs
     SET last_fix_at      = t.recorded_at,
         last_lat         = t.lat,
         last_lng         = t.lng,
         last_heading_deg = t.heading_deg,
         last_speed_kmh   = t.speed_kmh,
         telemetry_state  = 'live',
         progress_m       = COALESCE(v_progress_m, progress_m),
         off_route_m      = v_off_route_m
   WHERE id = t.run_id;

  IF r.status NOT IN ('boarding', 'in_progress') THEN RETURN; END IF;

  -- Stop detection, limited to the next few unvisited stops. Evaluating the
  -- whole route on every fix would let a bus "arrive" at a stop it has not
  -- reached, because the road doubles back near it later on.
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
      -- `uncertain` deliberately does not fire an arrival. It is still recorded
      -- on the stop event, so a coarse fix is visible rather than silently
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
END $function$;

-- The grant lockdown from transport_r5_a applies to the replaced function too:
-- CREATE OR REPLACE keeps existing grants, but a future CREATE would not, so
-- state it here rather than rely on that.
REVOKE EXECUTE ON FUNCTION public.transport_process_fix(bigint) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
