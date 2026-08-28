-- ============================================================================
-- Migration: Transport — Round 2c, scheduling, the tick, and retirement
--
-- Round 2b handles everything a new position implies. This handles everything
-- an ABSENCE implies — no telemetry, no boarding, no departure — which is
-- precisely the class of problem an event-driven design cannot see, and
-- precisely the class parents care most about.
--
-- Applied to the live project as:
--   transport_r2_c1_materialise_runs, transport_r2_c1b_materialise_guard,
--   transport_r2_c2_tick_and_alerts, transport_r2_c3_schedule_realtime_retire.
--
-- Prereq: transport_r2_b_derivation.sql. Run this in the Supabase SQL Editor.
-- ============================================================================

-- ── Materialising runs ──────────────────────────────────────────────────────
--
-- Builds the runs for one service date: the run itself, its stop plan with
-- scheduled arrival times resolved from each stop's offset, and its roster.
--
-- The roster is where transport meets the rest of the ERP. A student with an
-- approved leave covering the date is created as 'excused', which suppresses
-- the not-boarded exception entirely. Without that, every Monday produces a
-- wall of false alarms and parents learn to ignore the channel — the failure
-- mode that kills this class of product. A standalone bus tracker cannot do
-- this, because it has no idea leave exists.
--
-- EXECUTE is granted to `authenticated` so an admin can press "generate runs"
-- in the UI, which means the authorisation check has to live in the body.
-- auth.uid() is NULL when pg_cron calls it, which is how the scheduled path is
-- distinguished from a user request.

CREATE OR REPLACE FUNCTION public.transport_materialise_runs(p_date DATE DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  tz TEXT := public.attendance_timezone();
  d DATE := COALESCE(p_date, ((NOW() AT TIME ZONE tz)::DATE));
  dow SMALLINT;
  created INTEGER := 0;
  sch RECORD;
  v_run_id UUID;
  v_start TIMESTAMPTZ;
  v_school_stop UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin can materialise trip runs';
  END IF;

  dow := EXTRACT(DOW FROM d)::SMALLINT;

  -- A school-wide holiday means no runs at all. Team-scoped holidays are
  -- deliberately ignored: the bus runs for the school, not for one team.
  IF EXISTS (SELECT 1 FROM public.attendance_holidays WHERE date = d AND is_default) THEN
    RETURN 0;
  END IF;

  FOR sch IN
    SELECT s.id, s.route_id, s.direction, s.start_time, s.end_time,
           s.vehicle_id, s.driver_id, s.attendant_id, s.days_of_week,
           r.default_vehicle_id, r.default_driver_id, r.default_attendant_id, r.school_stop_id
      FROM public.transport_route_schedules s
      JOIN public.transport_routes r ON r.id = s.route_id
     WHERE s.active
       AND r.active
       AND r.archived_at IS NULL
       AND dow = ANY (s.days_of_week)
       AND (s.active_from IS NULL OR s.active_from <= d)
       AND (s.active_to   IS NULL OR s.active_to   >= d)
  LOOP
    v_start := (d + sch.start_time) AT TIME ZONE tz;
    v_school_stop := sch.school_stop_id;

    INSERT INTO public.transport_trip_runs (
      schedule_id, route_id, direction, service_date, status,
      vehicle_id, driver_id, attendant_id, scheduled_start_at, scheduled_end_at
    ) VALUES (
      sch.id, sch.route_id, sch.direction, d, 'scheduled',
      COALESCE(sch.vehicle_id,   sch.default_vehicle_id),
      COALESCE(sch.driver_id,    sch.default_driver_id),
      COALESCE(sch.attendant_id, sch.default_attendant_id),
      v_start,
      CASE WHEN sch.end_time IS NOT NULL THEN (d + sch.end_time) AT TIME ZONE tz END
    )
    ON CONFLICT (schedule_id, service_date) DO NOTHING
    RETURNING id INTO v_run_id;

    -- Already materialised on an earlier pass.
    IF v_run_id IS NULL THEN CONTINUE; END IF;
    created := created + 1;

    -- Stop plan. `seq` on the route is defined in the to-school direction, so
    -- an outbound run walks it in reverse.
    INSERT INTO public.transport_run_stops (run_id, stop_id, seq, scheduled_arrival_at)
    SELECT v_run_id,
           s.id,
           ROW_NUMBER() OVER (
             ORDER BY CASE WHEN sch.direction = 'inbound' THEN s.seq ELSE -s.seq END
           ),
           CASE
             WHEN sch.direction = 'inbound'  AND s.inbound_offset_min  IS NOT NULL
               THEN v_start + make_interval(mins => s.inbound_offset_min)
             WHEN sch.direction = 'outbound' AND s.outbound_offset_min IS NOT NULL
               THEN v_start + make_interval(mins => s.outbound_offset_min)
           END
      FROM public.transport_route_stops s
     WHERE s.route_id = sch.route_id AND s.active;

    -- Roster.
    INSERT INTO public.transport_run_passengers
      (run_id, student_id, assignment_id, board_stop_id, alight_stop_id, state, excuse_reason)
    SELECT v_run_id,
           a.student_id,
           a.id,
           CASE WHEN sch.direction = 'inbound' THEN a.pickup_stop_id ELSE v_school_stop END,
           CASE WHEN sch.direction = 'inbound' THEN v_school_stop ELSE COALESCE(a.drop_stop_id, a.pickup_stop_id) END,
           CASE WHEN lv.id IS NOT NULL THEN 'excused'::public.transport_boarding_state
                ELSE 'expected'::public.transport_boarding_state END,
           CASE WHEN lv.id IS NOT NULL THEN 'leave' END
      FROM public.transport_student_assignments a
      LEFT JOIN LATERAL (
        SELECT la.id
          FROM public.leave_applications la
         WHERE la.applicant_id = a.student_id
           AND la.status = 'approved'
           AND d BETWEEN la.start_date AND la.end_date
         LIMIT 1
      ) lv ON true
     WHERE a.route_id = sch.route_id
       AND a.ended_on IS NULL
       AND a.started_on <= d
       AND (
         (sch.direction = 'inbound'  AND a.rides_inbound)
         OR (sch.direction = 'outbound' AND a.rides_outbound)
       )
    ON CONFLICT (run_id, student_id) DO NOTHING;

    -- How many riders each stop should see, so the driver screen can show
    -- "3 of 5 boarded here" without counting on every render.
    UPDATE public.transport_run_stops rs
       SET expected_boardings = COALESCE(c.n, 0)
      FROM (
        SELECT board_stop_id AS stop_id, count(*) AS n
          FROM public.transport_run_passengers
         WHERE run_id = v_run_id AND state <> 'excused'
         GROUP BY board_stop_id
      ) c
     WHERE rs.run_id = v_run_id AND rs.stop_id = c.stop_id;
  END LOOP;

  RETURN created;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.transport_materialise_runs(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transport_materialise_runs(DATE) TO authenticated;

-- ── Alerts ──────────────────────────────────────────────────────────────────

-- Upsert-or-touch one alert. The partial unique index on dedupe_key means a
-- forty-minute deviation is one row with occurrences = 40, not forty rows.
CREATE OR REPLACE FUNCTION public.transport_raise_alert(
  p_dedupe   TEXT,
  p_type     public.transport_alert_type,
  p_severity public.transport_alert_severity,
  p_title    TEXT,
  p_detail   TEXT DEFAULT NULL,
  p_run      UUID DEFAULT NULL,
  p_route    UUID DEFAULT NULL,
  p_vehicle  UUID DEFAULT NULL,
  p_stop     UUID DEFAULT NULL,
  p_student  UUID DEFAULT NULL,
  p_metrics  JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  INSERT INTO public.transport_alerts
    (dedupe_key, type, severity, title, detail, run_id, route_id, vehicle_id, stop_id, student_id, metrics)
  VALUES
    (p_dedupe, p_type, p_severity, p_title, p_detail, p_run, p_route, p_vehicle, p_stop, p_student, p_metrics)
  ON CONFLICT (dedupe_key) WHERE status IN ('open', 'acknowledged')
  DO UPDATE SET last_seen_at = NOW(),
                occurrences  = public.transport_alerts.occurrences + 1,
                metrics      = EXCLUDED.metrics,
                detail       = EXCLUDED.detail;
$fn$;

CREATE OR REPLACE FUNCTION public.transport_clear_alert(p_dedupe TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  UPDATE public.transport_alerts
     SET status = 'auto_resolved', resolved_at = NOW(),
         resolution_note = 'Condition cleared'
   WHERE dedupe_key = p_dedupe AND status IN ('open', 'acknowledged');
$fn$;

-- ── The tick ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transport_tick()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
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
BEGIN
  -- A slow tick must never overlap itself; the next one simply skips.
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

    -- Long past its window with nothing at all: record it as missed rather
    -- than leaving it "scheduled" forever and polluting tomorrow's board.
    IF NOW() > COALESCE(r.scheduled_end_at, r.scheduled_start_at + INTERVAL '3 hours') + INTERVAL '1 hour'
       AND r.last_fix_at IS NULL THEN
      UPDATE public.transport_trip_runs SET status = 'missed' WHERE id = r.id;
    END IF;
  END LOOP;

  -- 2. Live runs.
  FOR r IN
    SELECT * FROM public.transport_trip_runs
     WHERE status IN ('boarding', 'in_progress')
  LOOP
    touched := touched + 1;

    -- 2a. Which source is driving the map? Lowest priority number with a fresh
    -- fix wins, so a mains-powered device outranks a phone that may be flat.
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

    IF new_state = 'offline' THEN
      PERFORM public.transport_raise_alert(
        format('no_gps:%s:%s', r.id, (EXTRACT(EPOCH FROM gap)::INTEGER / 900)),
        'no_gps', 'critical',
        'Bus is not reporting its position',
        format('No fix for %s minutes.', (EXTRACT(EPOCH FROM gap)::INTEGER / 60)),
        r.id, r.route_id, r.vehicle_id, NULL, NULL,
        jsonb_build_object('gap_seconds', EXTRACT(EPOCH FROM gap)::INTEGER));
    ELSIF new_state = 'live' THEN
      PERFORM public.transport_clear_alert(format('no_gps:%s:%s', r.id, (EXTRACT(EPOCH FROM gap)::INTEGER / 900)));
    END IF;

    -- 2c. ETAs and, with them, the honesty rule about non-live telemetry.
    PERFORM public.transport_recompute_eta(r.id);

    -- 2d. Delay against the next stop, re-notified in ten-minute steps rather
    -- than every minute.
    IF COALESCE(r.delay_seconds, 0) > 600 THEN
      PERFORM public.transport_raise_alert(
        format('delay:%s:%s', r.id, r.delay_seconds / 600), 'delay', 'warning',
        'Bus is running late',
        format('%s minutes behind schedule.', r.delay_seconds / 60),
        r.id, r.route_id, r.vehicle_id, r.next_stop_id, NULL,
        jsonb_build_object('delay_minutes', r.delay_seconds / 60));
    END IF;

    -- 2e. Route deviation. Needs the bus to be meaningfully outside the
    -- corridor; a single wide fix is not a detour.
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

    -- 2g. Auto-complete a run that has reached its last stop, or has run an
    -- hour past its window.
    IF NOT EXISTS (
      SELECT 1 FROM public.transport_run_stops
       WHERE run_id = r.id AND arrived_at IS NULL AND NOT skipped
    ) OR NOW() > COALESCE(r.scheduled_end_at, r.scheduled_start_at + INTERVAL '3 hours') + INTERVAL '1 hour'
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.transport_run_passengers WHERE run_id = r.id AND state = 'boarded'
      ) THEN
        UPDATE public.transport_trip_runs
           SET status = 'completed', ended_at = NOW(), next_stop_eta_at = NULL
         WHERE id = r.id;
      ELSE
        -- Someone is still aboard at the end of the line. This is the single
        -- most serious thing this module can detect.
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
END $fn$;

REVOKE EXECUTE ON FUNCTION
  public.transport_tick(),
  public.transport_raise_alert(TEXT, public.transport_alert_type, public.transport_alert_severity, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, JSONB),
  public.transport_clear_alert(TEXT)
  FROM PUBLIC, anon, authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────
-- The run row and its stop plan are published; transport_telemetry is NOT.
-- Publishing the firehose would put every GPS fix for every bus through the WAL
-- fan-out to every subscriber. A parent needs the summary, and the summary is
-- exactly what transport_apply_fix() maintains on the run row.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                    AND tablename = 'transport_trip_runs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transport_trip_runs;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                    AND tablename = 'transport_run_stops') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transport_run_stops;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                    AND tablename = 'transport_run_passengers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transport_run_passengers;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                    AND tablename = 'transport_alerts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transport_alerts;
  END IF;
END $$;

-- ── Retention ───────────────────────────────────────────────────────────────
-- 7 days of full-resolution fixes. Round 3 adds a 30-second archive for replay;
-- until then, keeping a year of every child's minute-by-minute location would
-- be a liability with no product value.

CREATE OR REPLACE FUNCTION public.cleanup_transport_telemetry()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  DELETE FROM public.transport_telemetry WHERE recorded_at < NOW() - INTERVAL '7 days';
$fn$;
REVOKE EXECUTE ON FUNCTION public.cleanup_transport_telemetry() FROM PUBLIC, anon, authenticated;

-- ── Schedule ────────────────────────────────────────────────────────────────

DO $$ BEGIN PERFORM cron.unschedule('transport-tick'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('transport-tick', '* * * * *', $$SELECT public.transport_tick();$$);

DO $$ BEGIN PERFORM cron.unschedule('transport-materialise-runs'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
-- 21:30 UTC = 03:00 IST, so tomorrow's runs exist well before the first
-- morning departure.
SELECT cron.schedule('transport-materialise-runs', '30 21 * * *',
  $$SELECT public.transport_materialise_runs((((NOW() AT TIME ZONE public.attendance_timezone())::DATE) + 1));$$);

DO $$ BEGIN PERFORM cron.unschedule('cleanup-transport-telemetry'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('cleanup-transport-telemetry', '0 3 * * *',
  $$SELECT public.cleanup_transport_telemetry();$$);

-- ── Retire the superseded tables ────────────────────────────────────────────
-- bus_locations        -> transport_telemetry (source attribution, dedupe, run linkage)
-- trip_attendance      -> transport_run_passengers + transport_boarding_events
-- trip_driver_overrides -> the driver recorded on each day's run
--
-- All three were zero-row, and Round 2 rewrote every screen that read them.

DO $$ BEGIN PERFORM cron.unschedule('cleanup-bus-locations'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

DROP FUNCTION IF EXISTS public.cleanup_bus_locations();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                AND tablename = 'bus_locations') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.bus_locations;
  END IF;
END $$;

DROP TABLE IF EXISTS public.bus_locations;
DROP TABLE IF EXISTS public.trip_attendance;
DROP TABLE IF EXISTS public.trip_driver_overrides;
DROP TYPE IF EXISTS public.trip_attendance_status;

-- effective_trip_driver and is_trip_driver both named trip_driver_overrides.
-- With per-date overrides gone, the driver of record for a route is simply its
-- default; the per-day answer now lives on transport_trip_runs.driver_id.
CREATE OR REPLACE FUNCTION public.is_trip_driver(p_trip UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.transport_routes t
    WHERE t.id = p_trip AND t.default_driver_id = auth.uid()
  );
$fn$;

DROP FUNCTION IF EXISTS public.effective_trip_driver(UUID, DATE);

NOTIFY pgrst, 'reload schema';
