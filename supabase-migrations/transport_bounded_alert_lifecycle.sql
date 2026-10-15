-- Stop the alert rail filling up with one run's bad afternoon.
--
-- The Operations rail held 6,766 open alerts. 6,758 of them were `no_gps`, and they
-- came from THREE runs — 2,252 alerts each. Two separate defects combined:
--
-- 1. A run that can never finish.
--    transport_tick's auto-complete refuses to close a run while anyone is still
--    marked 'boarded' — sensible on its face, nobody wants a trip quietly closed with
--    a child aboard. But there was no other way out, so three runs from 2026-09-22
--    with passengers left in 'boarded' simply stayed in_progress. For 24 days. Every
--    minute the tick processed them as live buses.
--
-- 2. A dedupe key that is not a dedupe key.
--    The no_gps key was format('no_gps:%s:%s', run, gap_seconds / 900) — the elapsed
--    silence, bucketed to fifteen minutes, baked into the key. Each bucket is a new
--    key, so each quarter hour minted a brand new alert row instead of updating the
--    existing one. 24 days of silence = 2,304 buckets. Observed: 2,252-2,257 per run.
--    `delay` had the same shape with a ten-minute bucket.
--
--    The same mechanism drove the write amplification behind Realtime's load: the
--    student_not_dropped alerts, which DO use a stable key, reached occurrences
--    counts of 33,901 — once a minute for 24 days — and every one of those was a row
--    update decoded by the WAL reader.
--
-- The fixes:
--
--   * Stable keys. `no_gps:<run>` and `delay:<run>`. One row carries the whole
--     episode; first_seen_at says when it started and the detail is rewritten on each
--     upsert so it always reads as of now. Coarsening the bucket would have helped,
--     but it still mints a row per bucket — a stable key mints exactly one, ever.
--     Re-raising after a person resolves one still works, because the live-unique
--     index only covers open and acknowledged rows.
--
--   * Durations in human units (transport_humanise_gap). Nobody triaging a bus needs
--     "No fix for 34,560 minutes"; they need "No fix for 3 weeks".
--
--   * An abandon backstop. A run more than six hours past its window is over,
--     whatever its passenger rows say. It is closed as 'abandoned' (new run status),
--     or 'missed' if the driver never worked it, or 'completed' if nobody is aboard.
--     student_not_dropped is raised once on the way out, so the record stays in front
--     of a person after the run is closed.
--
--   * Alerts about a trip in motion are auto-resolved when the trip stops running.
--     The exceptions are the three that are about a child rather than a bus —
--     student_not_boarded, student_not_dropped and sos — which stay open for a person
--     to close.
--
--   * No no_gps at all for a run the driver never worked. A trip where nobody was
--     marked and no stop was reached did not happen; trip_not_started already says so,
--     and a stream of GPS alerts about a bus that never left is noise.
--
-- Applied against production in three parts, because ALTER TYPE ... ADD VALUE cannot
-- be used in the same transaction that commits it. On the first tick after the tick
-- rewrite landed: the three runs went to 'abandoned', 6,759 no_gps and 3 delay alerts
-- auto-resolved, and the rail went from 6,766 open to 5 — the 3 student_not_dropped
-- and 2 student_not_boarded that a person should actually look at.

-- ── Part 1: must commit before anything references the new value ──────────────
ALTER TYPE public.transport_run_status ADD VALUE IF NOT EXISTS 'abandoned';

-- ── Part 2: helpers ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transport_humanise_gap(p_gap interval)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_gap < interval '2 minutes' THEN 'under a minute'
    WHEN p_gap < interval '1 hour'    THEN (EXTRACT(EPOCH FROM p_gap)::int / 60)      || ' minutes'
    WHEN p_gap < interval '2 hours'   THEN 'about an hour'
    WHEN p_gap < interval '1 day'     THEN (EXTRACT(EPOCH FROM p_gap)::int / 3600)    || ' hours'
    WHEN p_gap < interval '2 days'    THEN 'a day'
    WHEN p_gap < interval '14 days'   THEN (EXTRACT(EPOCH FROM p_gap)::int / 86400)   || ' days'
    WHEN p_gap < interval '60 days'   THEN (EXTRACT(EPOCH FROM p_gap)::int / 604800)  || ' weeks'
    ELSE                                   (EXTRACT(EPOCH FROM p_gap)::int / 2592000) || ' months'
  END;
$$;

CREATE OR REPLACE FUNCTION public.transport_resolve_moot_alerts(p_run uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH closed AS (
    UPDATE public.transport_alerts
       SET status = 'auto_resolved',
           resolved_at = NOW(),
           resolution_note = 'Trip is no longer running'
     WHERE run_id = p_run
       AND status IN ('open', 'acknowledged')
       AND type NOT IN ('student_not_boarded', 'student_not_dropped', 'sos')
    RETURNING 1
  )
  SELECT count(*)::int FROM closed;
$$;

REVOKE ALL ON FUNCTION public.transport_resolve_moot_alerts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transport_humanise_gap(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transport_humanise_gap(interval) TO authenticated;

-- ── Part 3: the tick itself ───────────────────────────────────────────────────
-- Full body lives in the applied migration `transport_tick_bounded_alerts`; it is
-- reproduced here so this file alone rebuilds the behaviour on a fresh environment.

CREATE OR REPLACE FUNCTION public.transport_tick()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  p RECORD;
  gap INTERVAL;
  new_state public.transport_telemetry_state;
  best_source UUID;
  corridor INTEGER;
  touched INTEGER := 0;
  tz TEXT := public.attendance_timezone();
  today DATE;
  window_end TIMESTAMPTZ;
  driver_acted BOOLEAN;
  -- How long past its window a run may sit before it is closed out regardless of
  -- what its passenger rows say. Without this a run with somebody still marked
  -- aboard can never reach a terminal status, and every tick forever after raises
  -- fresh alerts against it.
  abandon_grace CONSTANT INTERVAL := INTERVAL '6 hours';
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('transport_tick')) THEN
    RETURN 0;
  END IF;

  today := ((NOW() AT TIME ZONE tz)::DATE);

  -- 1. Runs that should have started and have not.
  FOR r IN
    SELECT * FROM public.transport_trip_runs
     WHERE status = 'scheduled'
       AND service_date = today
       AND NOW() > scheduled_start_at + INTERVAL '10 minutes'
  LOOP
    IF r.last_fix_at IS NULL THEN
      PERFORM public.transport_raise_alert(
        format('trip_not_started:%s', r.id), 'trip_not_started', 'warning',
        'Trip has not started', 'Scheduled departure has passed with no movement and no driver tap.',
        r.id, r.route_id, r.vehicle_id, NULL, NULL,
        jsonb_build_object('minutes_late', EXTRACT(EPOCH FROM (NOW() - r.scheduled_start_at))::INTEGER / 60));
    END IF;

    IF NOW() > COALESCE(r.scheduled_end_at, r.scheduled_start_at + INTERVAL '3 hours') + INTERVAL '1 hour'
       AND r.last_fix_at IS NULL THEN
      UPDATE public.transport_trip_runs SET status = 'missed' WHERE id = r.id;
      PERFORM public.transport_resolve_moot_alerts(r.id);
    END IF;
  END LOOP;

  -- 2. Live runs.
  FOR r IN
    SELECT * FROM public.transport_trip_runs
     WHERE status IN ('boarding', 'in_progress')
  LOOP
    window_end := COALESCE(r.scheduled_end_at, r.scheduled_start_at + INTERVAL '3 hours');

    -- Did the driver ever work this run? A trip where nobody was marked and no stop
    -- was reached did not happen; treating it as live produces a stream of alerts
    -- about a bus that never left.
    SELECT EXISTS (SELECT 1 FROM public.transport_run_passengers
                    WHERE run_id = r.id AND state <> 'expected')
        OR EXISTS (SELECT 1 FROM public.transport_run_stops
                    WHERE run_id = r.id AND arrived_at IS NOT NULL)
      INTO driver_acted;

    -- 2.0 A run well past its window is over, whatever its rows say. Close it out,
    -- clear the alerts that only described a trip in motion, and stop touching it.
    IF NOW() > window_end + abandon_grace THEN
      IF NOT driver_acted THEN
        UPDATE public.transport_trip_runs
           SET status = 'missed', ended_at = NOW(), next_stop_eta_at = NULL
         WHERE id = r.id;
      ELSIF EXISTS (SELECT 1 FROM public.transport_run_passengers
                     WHERE run_id = r.id AND state = 'boarded') THEN
        -- Raised once on a stable key, and it survives the sweep below, so the
        -- record stays in front of a person after the run itself is closed.
        PERFORM public.transport_raise_alert(
          format('not_dropped:%s', r.id), 'student_not_dropped', 'critical',
          'A student is still marked on board',
          'The run was closed with somebody never marked as dropped off.',
          r.id, r.route_id, r.vehicle_id, NULL, NULL,
          jsonb_build_object('still_aboard', (
            SELECT count(*) FROM public.transport_run_passengers
             WHERE run_id = r.id AND state = 'boarded')));
        UPDATE public.transport_trip_runs
           SET status = 'abandoned', ended_at = NOW(), next_stop_eta_at = NULL
         WHERE id = r.id;
      ELSE
        UPDATE public.transport_trip_runs
           SET status = 'completed', ended_at = NOW(), next_stop_eta_at = NULL
         WHERE id = r.id;
      END IF;
      PERFORM public.transport_resolve_moot_alerts(r.id);
      CONTINUE;
    END IF;

    touched := touched + 1;

    -- 2a. Which source is driving the map?
    SELECT s.id INTO best_source
      FROM public.transport_telemetry_sources s
      JOIN public.transport_telemetry t ON t.source_id = s.id AND t.run_id = r.id
     WHERE s.active AND t.recorded_at > NOW() - INTERVAL '90 seconds'
     ORDER BY s.priority ASC, t.recorded_at DESC
     LIMIT 1;

    IF best_source IS DISTINCT FROM r.active_source_id THEN
      UPDATE public.transport_trip_runs SET active_source_id = best_source WHERE id = r.id;
    END IF;

    -- 2b. Telemetry health.
    gap := NOW() - COALESCE(r.last_fix_at, r.started_at, r.scheduled_start_at);
    new_state := CASE
      WHEN r.last_fix_at IS NULL THEN 'unknown'
      WHEN gap < INTERVAL '60 seconds'  THEN 'live'
      WHEN gap < INTERVAL '5 minutes'   THEN 'stale'
      ELSE 'offline'
    END;

    IF new_state IS DISTINCT FROM r.telemetry_state THEN
      UPDATE public.transport_trip_runs SET telemetry_state = new_state WHERE id = r.id;
    END IF;

    -- The dedupe key is per run, not per run and fifteen-minute bucket. The bucketed
    -- key minted a brand new alert row every quarter of an hour for as long as the
    -- bus stayed quiet -- 2,252 rows from a single run before this was fixed. One row
    -- now carries the whole episode: first_seen_at is when it went quiet, and the
    -- detail below is rewritten on each upsert so it always reads as of now.
    IF new_state = 'offline' AND driver_acted THEN
      PERFORM public.transport_raise_alert(
        format('no_gps:%s', r.id),
        'no_gps', 'critical',
        'Bus is not reporting its position',
        format('No fix for %s.', public.transport_humanise_gap(gap)),
        r.id, r.route_id, r.vehicle_id, NULL, NULL,
        jsonb_build_object('gap_seconds', EXTRACT(EPOCH FROM gap)::INTEGER));
    ELSIF new_state = 'live' THEN
      PERFORM public.transport_clear_alert(format('no_gps:%s', r.id));
    END IF;

    -- 2c. ETAs.
    PERFORM public.transport_recompute_eta(r.id);

    -- 2d. Delay against the next stop. Stable key for the same reason as no_gps:
    -- the ten-minute bucket turned a lengthening delay into a new row per step.
    IF COALESCE(r.delay_seconds, 0) > 600 THEN
      PERFORM public.transport_raise_alert(
        format('delay:%s', r.id), 'delay', 'warning',
        'Bus is running late',
        format('%s behind schedule.', public.transport_humanise_gap(make_interval(secs => r.delay_seconds))),
        r.id, r.route_id, r.vehicle_id, r.next_stop_id, NULL,
        jsonb_build_object('delay_minutes', r.delay_seconds / 60));
    ELSE
      PERFORM public.transport_clear_alert(format('delay:%s', r.id));
    END IF;

    -- 2e. Route deviation.
    SELECT corridor_m INTO corridor
      FROM public.transport_route_paths
     WHERE route_id = r.route_id AND direction = r.direction;

    IF corridor IS NOT NULL AND r.off_route_m IS NOT NULL AND new_state = 'live' THEN
      IF r.off_route_m > corridor THEN
        PERFORM public.transport_raise_alert(
          format('deviation:%s', r.id), 'deviation', 'warning',
          'Bus is off its route',
          format('%s m from the route corridor.', round(r.off_route_m)),
          r.id, r.route_id, r.vehicle_id, NULL, NULL,
          jsonb_build_object('off_route_m', round(r.off_route_m)));
      ELSE
        PERFORM public.transport_clear_alert(format('deviation:%s', r.id));
      END IF;
    END IF;

    -- 2f. A child the bus has already driven away from.
    FOR p IN
      SELECT rp.student_id, rp.board_stop_id, rs.departed_at, pr.full_name
        FROM public.transport_run_passengers rp
        JOIN public.transport_run_stops rs
          ON rs.run_id = rp.run_id AND rs.stop_id = rp.board_stop_id
        JOIN public.profiles pr ON pr.id = rp.student_id
       WHERE rp.run_id = r.id
         AND rp.state = 'expected'
         AND rs.departed_at IS NOT NULL
    LOOP
      PERFORM public.transport_raise_alert(
        format('not_boarded:%s:%s', r.id, p.student_id), 'student_not_boarded', 'critical',
        format('%s did not board', p.full_name),
        'The bus has left their stop and they were not marked on board.',
        r.id, r.route_id, r.vehicle_id, p.board_stop_id, p.student_id,
        jsonb_build_object('departed_at', p.departed_at));
    END LOOP;

    -- 2g. Auto-complete a run that has reached its last stop, or has run an hour
    -- past its window. The abandon backstop at 2.0 guarantees this cannot spin
    -- forever when somebody is still marked aboard.
    IF NOT EXISTS (
      SELECT 1 FROM public.transport_run_stops
       WHERE run_id = r.id AND arrived_at IS NULL AND NOT skipped
    ) OR NOW() > window_end + INTERVAL '1 hour'
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.transport_run_passengers WHERE run_id = r.id AND state = 'boarded'
      ) THEN
        UPDATE public.transport_trip_runs
           SET status = 'completed', ended_at = NOW(), next_stop_eta_at = NULL
         WHERE id = r.id;
        PERFORM public.transport_resolve_moot_alerts(r.id);
      ELSE
        PERFORM public.transport_raise_alert(
          format('not_dropped:%s', r.id), 'student_not_dropped', 'critical',
          'A student is still marked on board',
          'The run has reached the end of its stops but somebody has not been dropped off.',
          r.id, r.route_id, r.vehicle_id, NULL, NULL,
          jsonb_build_object('still_aboard', (
            SELECT count(*) FROM public.transport_run_passengers WHERE run_id = r.id AND state = 'boarded')));
      END IF;
    END IF;
  END LOOP;

  -- 3. Keep the badge count on each run honest.
  UPDATE public.transport_trip_runs r2
     SET open_alert_count = COALESCE(a.n, 0)
    FROM (
      SELECT run_id, count(*) AS n FROM public.transport_alerts
       WHERE status = 'open' GROUP BY run_id
    ) a
   WHERE a.run_id = r2.id AND r2.open_alert_count IS DISTINCT FROM a.n;

  PERFORM pg_advisory_unlock(hashtext('transport_tick'));
  RETURN touched;
END $function$;
