-- ============================================================================
-- Transport simulation — a believable school day, end to end
--
-- Why this exists: every interesting behaviour in this module is timing- or
-- geometry-dependent (a geofence arrival, a delay, a did-not-board, a stale
-- GPS feed), and none of it can be exercised by staring at an empty database.
-- This drives the *real* engine — it inserts telemetry and lets the AFTER
-- INSERT trigger derive everything — rather than writing derived state
-- directly. A simulation that writes the answers proves nothing; this one can
-- actually fail.
--
--   SELECT public.transport_simulate_day();   -- seed + run a day
--   SELECT public.transport_simulation_clear(); -- remove every trace
--
-- Everything it creates is tagged 'SIM-' in registration_no / route code, and
-- the clear function keys off exactly that, so it can never take real data
-- with it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.transport_simulation_clear()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE n INT := 0;
BEGIN
  IF public.get_user_role() <> 'admin' THEN RETURN 'Not permitted'; END IF;
  -- Routes cascade to stops, runs, run_stops, run_passengers, telemetry,
  -- boarding events and alerts, so deleting the routes is the whole cleanup.
  DELETE FROM public.transport_routes WHERE code LIKE 'SIM-%';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.transport_vehicles WHERE registration_no LIKE 'SIM-%';
  DELETE FROM public.transport_alerts WHERE dedupe_key LIKE 'sim:%';
  RETURN format('cleared %s simulated route(s)', n);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_simulation_clear() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_simulation_clear() TO authenticated;


CREATE OR REPLACE FUNCTION public.transport_simulate_day()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_driver     UUID;
  v_students   UUID[];
  v_route      UUID;
  v_veh        UUID;
  v_run        UUID;
  v_stop       UUID;
  v_stop_ids   UUID[];
  v_today      DATE := (NOW() AT TIME ZONE public.attendance_timezone())::DATE;
  v_base_lat   DOUBLE PRECISION := 12.9716;
  v_base_lng   DOUBLE PRECISION := 77.5946;
  r            RECORD;
  i            INT;
  s            INT;
  v_late_min   INT;
  v_fixes      INT := 0;
  v_result     JSONB;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not permitted');
  END IF;

  PERFORM public.transport_simulation_clear();

  SELECT id INTO v_driver FROM public.profiles WHERE role = 'driver' LIMIT 1;
  IF v_driver IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No driver profile to crew the buses');
  END IF;
  INSERT INTO public.transport_staff (profile_id, kind, active)
    VALUES (v_driver, 'driver', true) ON CONFLICT DO NOTHING;

  SELECT array_agg(id) INTO v_students
    FROM (SELECT id FROM public.profiles WHERE role = 'student' ORDER BY created_at LIMIT 24) q;
  IF v_students IS NULL OR array_length(v_students, 1) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Need at least 6 student profiles');
  END IF;

  -- Three routes: one punctual, one running late, one whose GPS died mid-trip.
  FOR i IN 1..3 LOOP
    INSERT INTO public.transport_vehicles (registration_no, display_name, capacity)
    VALUES (format('SIM-KA01-%s', 1000 + i), format('Bus %s', i), 40)
    RETURNING id INTO v_veh;

    INSERT INTO public.transport_routes (name, code, active)
    VALUES (format('Simulated Route %s', i), format('SIM-R%s', i), true)
    RETURNING id INTO v_route;

    -- Five stops on a straight line east of the school, ~600 m apart. A real
    -- route bends; a straight one is enough to make arrival geometry testable
    -- and keeps the expected results hand-checkable.
    v_stop_ids := ARRAY[]::UUID[];
    FOR s IN 1..5 LOOP
      INSERT INTO public.transport_route_stops
        (route_id, seq, name, lat, lng, radius_m, dwell_seconds,
         inbound_offset_min, active)
      VALUES (v_route, s, format('Route %s · Stop %s', i, s),
              v_base_lat, v_base_lng + (s - 1) * 0.0055, 120, 45, (s - 1) * 6, true)
      RETURNING id INTO v_stop;
      v_stop_ids := v_stop_ids || v_stop;
    END LOOP;

    -- Route 2 is the late one; route 3 is the one that goes quiet.
    v_late_min := CASE i WHEN 2 THEN 14 ELSE 1 END;

    INSERT INTO public.transport_trip_runs
      (route_id, vehicle_id, driver_id, service_date, direction, status,
       scheduled_start_at, started_at)
    VALUES (v_route, v_veh, v_driver, v_today, 'inbound', 'in_progress',
            NOW() - INTERVAL '50 minutes',
            NOW() - INTERVAL '50 minutes' + make_interval(mins => v_late_min))
    RETURNING id INTO v_run;

    -- Per-stop rows, with the scheduled arrival the timetable promised.
    FOR s IN 1..5 LOOP
      INSERT INTO public.transport_run_stops
        (run_id, stop_id, seq, scheduled_arrival_at)
      VALUES (v_run, v_stop_ids[s], s,
              NOW() - INTERVAL '50 minutes' + make_interval(mins => (s - 1) * 6));
    END LOOP;

    -- Eight riders per bus, each boarding at one of the five stops.
    FOR s IN 1..8 LOOP
      INSERT INTO public.transport_student_assignments
        (student_id, route_id, pickup_stop_id, drop_stop_id, started_on)
      VALUES (v_students[((i - 1) * 8 + s - 1) % array_length(v_students, 1) + 1],
              v_route, v_stop_ids[(s % 5) + 1], v_stop_ids[(s % 5) + 1], v_today)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.transport_run_passengers
        (run_id, student_id, board_stop_id, alight_stop_id, state)
      VALUES (v_run, v_students[((i - 1) * 8 + s - 1) % array_length(v_students, 1) + 1],
              v_stop_ids[(s % 5) + 1], v_stop_ids[(s % 5) + 1], 'expected')
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- Drive it. Each fix is a real INSERT, so transport_process_fix runs and
    -- derives arrivals, departures, progress, delay and ETA exactly as it
    -- would for a phone on a bus. Route 3 stops transmitting after stop 2,
    -- which is what a dead battery looks like to the rest of the system.
    FOR s IN 1..5 LOOP
      EXIT WHEN i = 3 AND s > 2;
      -- Approach, sit at the stop, then leave: three fixes per stop is the
      -- minimum that produces a distinct arrival and departure.
      INSERT INTO public.transport_telemetry
        (run_id, source, reported_by, lat, lng, accuracy_m, speed_kmh, recorded_at)
      VALUES
        (v_run, 'simulated', v_driver, v_base_lat,
         v_base_lng + (s - 1) * 0.0055 - 0.0030, 12, 34,
         NOW() - INTERVAL '50 minutes' + make_interval(mins => (s - 1) * 6 + v_late_min - 1)),
        (v_run, 'simulated', v_driver, v_base_lat,
         v_base_lng + (s - 1) * 0.0055, 10, 0,
         NOW() - INTERVAL '50 minutes' + make_interval(mins => (s - 1) * 6 + v_late_min)),
        (v_run, 'simulated', v_driver, v_base_lat,
         v_base_lng + (s - 1) * 0.0055 + 0.0030, 12, 30,
         NOW() - INTERVAL '50 minutes' + make_interval(mins => (s - 1) * 6 + v_late_min) + INTERVAL '90 seconds');
      v_fixes := v_fixes + 3;

      -- Board everyone due at this stop, through the real RPC path, except one
      -- child on route 1 who never shows up — that is the did-not-board case
      -- the whole alerting design exists for.
      FOR r IN
        SELECT rp.student_id
          FROM public.transport_run_passengers rp
         WHERE rp.run_id = v_run AND rp.board_stop_id = v_stop_ids[s]
      LOOP
        CONTINUE WHEN i = 1 AND s = 3;
        UPDATE public.transport_run_passengers
           SET state = 'boarded', boarded_at = NOW() - INTERVAL '50 minutes'
                       + make_interval(mins => (s - 1) * 6 + v_late_min)
         WHERE run_id = v_run AND student_id = r.student_id;
      END LOOP;
    END LOOP;

    -- Route 3's silence should read as stale, not as a bus parked at stop 2.
    IF i = 3 THEN
      UPDATE public.transport_trip_runs
         SET telemetry_state = 'stale', last_fix_at = NOW() - INTERVAL '22 minutes'
       WHERE id = v_run;
      PERFORM public.transport_raise_alert(
        format('sim:offline:%s', v_run), 'no_gps', 'critical',
        'Bus 3 has stopped reporting',
        'No GPS fix for 22 minutes. Last seen near Route 3 · Stop 2.',
        v_run, v_route, v_veh, NULL, NULL, '{"minutes": 22}'::JSONB);
    END IF;

    IF i = 2 THEN
      PERFORM public.transport_raise_alert(
        format('sim:delay:%s', v_run), 'delay', 'warning',
        'Bus 2 is running 14 minutes late',
        'Delay picked up before the first stop and has not recovered.',
        v_run, v_route, v_veh, NULL, NULL, '{"minutes": 14}'::JSONB);
    END IF;
  END LOOP;

  -- Aliases here deliberately avoid `r`: this function declares `r` as a
  -- RECORD, and PL/pgSQL resolves a bare `r.col` to the variable rather than
  -- the table, which fails at runtime and not at CREATE time.
  SELECT jsonb_build_object(
    'ok', true,
    'routes', (SELECT count(*) FROM public.transport_routes WHERE code LIKE 'SIM-%'),
    'runs', (SELECT count(*) FROM public.transport_trip_runs run
               JOIN public.transport_routes rte ON rte.id = run.route_id
              WHERE rte.code LIKE 'SIM-%'),
    'fixes_inserted', v_fixes,
    'arrivals_derived', (SELECT count(*) FROM public.transport_run_stops rs
                           JOIN public.transport_trip_runs run ON run.id = rs.run_id
                           JOIN public.transport_routes rte ON rte.id = run.route_id
                          WHERE rte.code LIKE 'SIM-%' AND rs.arrived_at IS NOT NULL),
    'departures_derived', (SELECT count(*) FROM public.transport_run_stops rs
                           JOIN public.transport_trip_runs run ON run.id = rs.run_id
                           JOIN public.transport_routes rte ON rte.id = run.route_id
                          WHERE rte.code LIKE 'SIM-%' AND rs.departed_at IS NOT NULL),
    'delay_seconds_seen', (SELECT COALESCE(max(run.delay_seconds), 0)
                             FROM public.transport_trip_runs run
                             JOIN public.transport_routes rte ON rte.id = run.route_id
                            WHERE rte.code LIKE 'SIM-%'),
    'boarded', (SELECT count(*) FROM public.transport_run_passengers rp
                  JOIN public.transport_trip_runs run ON run.id = rp.run_id
                  JOIN public.transport_routes rte ON rte.id = run.route_id
                 WHERE rte.code LIKE 'SIM-%' AND rp.state = 'boarded'),
    'still_expected', (SELECT count(*) FROM public.transport_run_passengers rp
                  JOIN public.transport_trip_runs run ON run.id = rp.run_id
                  JOIN public.transport_routes rte ON rte.id = run.route_id
                 WHERE rte.code LIKE 'SIM-%' AND rp.state = 'expected')
  ) INTO v_result;

  RETURN v_result;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_simulate_day() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_simulate_day() TO authenticated;

NOTIFY pgrst, 'reload schema';
