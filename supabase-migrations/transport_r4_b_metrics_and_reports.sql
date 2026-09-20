-- ============================================================================
-- Migration: Transport — Round 4b, nightly metrics rollup and reports
--
-- Reports are computed once, at night, and read from a table. The alternative —
-- aggregating transport_run_stops and transport_run_passengers live whenever an
-- admin opens the Reports tab — is fine for one term and quietly becomes a
-- thirty-second page load in the third year, at which point the fix is a
-- migration nobody has time for. Roll it up now, while the tables are small.
--
-- The rollup is idempotent by primary key, so re-running it over a date that
-- was already rolled up corrects the numbers rather than doubling them. That
-- matters more than it sounds: a run reconciled by an admin the next morning
-- has to be able to change yesterday's figures.
--
-- Also adds transport_route_counts(), which replaces two client queries that
-- pulled every assignment row and every stop row to the browser purely in order
-- to count them.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- ── Per-run metrics ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transport_run_metrics (
  run_id             UUID PRIMARY KEY REFERENCES public.transport_trip_runs(id) ON DELETE CASCADE,
  route_id           UUID REFERENCES public.transport_routes(id) ON DELETE CASCADE,
  vehicle_id         UUID REFERENCES public.transport_vehicles(id) ON DELETE SET NULL,
  driver_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  service_date       DATE NOT NULL,
  direction          public.transport_direction NOT NULL,

  stops_total        INTEGER NOT NULL DEFAULT 0,
  stops_arrived      INTEGER NOT NULL DEFAULT 0,
  stops_on_time      INTEGER NOT NULL DEFAULT 0,
  stops_late         INTEGER NOT NULL DEFAULT 0,
  stops_skipped      INTEGER NOT NULL DEFAULT 0,
  avg_delay_seconds  INTEGER,
  max_delay_seconds  INTEGER,

  expected_riders    INTEGER NOT NULL DEFAULT 0,
  boarded_riders     INTEGER NOT NULL DEFAULT 0,
  excused_riders     INTEGER NOT NULL DEFAULT 0,
  no_show_riders     INTEGER NOT NULL DEFAULT 0,
  capacity           INTEGER,

  -- GPS health, which is the number that decides whether any of the rest can
  -- be believed. A run with 30% coverage did not have "no delays"; it had no
  -- data about delays.
  fix_count          INTEGER NOT NULL DEFAULT 0,
  coverage_pct       SMALLINT,
  longest_gap_seconds INTEGER,

  alerts_opened      INTEGER NOT NULL DEFAULT 0,
  started_late_seconds INTEGER,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transport_run_metrics_date ON public.transport_run_metrics (service_date DESC);
CREATE INDEX IF NOT EXISTS idx_transport_run_metrics_route ON public.transport_run_metrics (route_id, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_transport_run_metrics_vehicle ON public.transport_run_metrics (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_transport_run_metrics_driver ON public.transport_run_metrics (driver_id);

ALTER TABLE public.transport_run_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reads transport_run_metrics" ON public.transport_run_metrics;
CREATE POLICY "Reads transport_run_metrics" ON public.transport_run_metrics
  FOR SELECT TO authenticated
  USING (
    (select public.get_user_role()) = 'admin'
    OR (select public.transport_is_crew(run_id))
  );

-- ── Per-stop metrics ────────────────────────────────────────────────────────
-- "Which stop is always late?" is the single most actionable question in the
-- reports, because the answer is usually a timetable that was never true.

CREATE TABLE IF NOT EXISTS public.transport_stop_metrics (
  stop_id           UUID NOT NULL REFERENCES public.transport_route_stops(id) ON DELETE CASCADE,
  direction         public.transport_direction NOT NULL,
  service_date      DATE NOT NULL,
  route_id          UUID REFERENCES public.transport_routes(id) ON DELETE CASCADE,
  arrivals          INTEGER NOT NULL DEFAULT 0,
  on_time           INTEGER NOT NULL DEFAULT 0,
  avg_delay_seconds INTEGER,
  max_delay_seconds INTEGER,
  expected_riders   INTEGER NOT NULL DEFAULT 0,
  boarded_riders    INTEGER NOT NULL DEFAULT 0,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (stop_id, direction, service_date)
);
CREATE INDEX IF NOT EXISTS idx_transport_stop_metrics_route ON public.transport_stop_metrics (route_id, service_date DESC);

ALTER TABLE public.transport_stop_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reads transport_stop_metrics" ON public.transport_stop_metrics;
CREATE POLICY "Reads transport_stop_metrics" ON public.transport_stop_metrics
  FOR SELECT TO authenticated
  USING ((select public.get_user_role()) = 'admin');

-- ── The rollup ──────────────────────────────────────────────────────────────

/**
 * Roll up one service date.
 *
 * `p_on_time_grace` is what "on time" means, in seconds, and it is a parameter
 * rather than a constant because a school that calls three minutes late is
 * running a different service from one that calls ten, and both are entitled to
 * measure themselves honestly.
 *
 * Coverage is measured against the run's own elapsed time rather than a
 * nominal duration: a run that ended early was not offline for the remainder.
 */
CREATE OR REPLACE FUNCTION public.transport_rollup_metrics(
  p_date DATE DEFAULT NULL,
  p_on_time_grace INTEGER DEFAULT 300
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_date DATE := COALESCE(p_date, ((NOW() AT TIME ZONE public.attendance_timezone())::DATE) - 1);
  v_rows INTEGER;
BEGIN
  INSERT INTO public.transport_run_metrics AS m (
    run_id, route_id, vehicle_id, driver_id, service_date, direction,
    stops_total, stops_arrived, stops_on_time, stops_late, stops_skipped,
    avg_delay_seconds, max_delay_seconds,
    expected_riders, boarded_riders, excused_riders, no_show_riders, capacity,
    fix_count, coverage_pct, longest_gap_seconds,
    alerts_opened, started_late_seconds, computed_at
  )
  SELECT
    r.id, r.route_id, r.vehicle_id, r.driver_id, r.service_date, r.direction,
    s.total, s.arrived, s.on_time, s.late, s.skipped, s.avg_delay, s.max_delay,
    p.expected, p.boarded, p.excused, p.no_show, v.capacity,
    g.fixes, g.coverage_pct, g.longest_gap,
    a.alerts,
    CASE WHEN r.started_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (r.started_at - r.scheduled_start_at))::INTEGER END,
    NOW()
  FROM public.transport_trip_runs r
  LEFT JOIN public.transport_vehicles v ON v.id = r.vehicle_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::INTEGER AS total,
      COUNT(*) FILTER (WHERE rs.arrived_at IS NOT NULL)::INTEGER AS arrived,
      COUNT(*) FILTER (WHERE rs.delay_seconds IS NOT NULL
                         AND rs.delay_seconds <= p_on_time_grace)::INTEGER AS on_time,
      COUNT(*) FILTER (WHERE rs.delay_seconds > p_on_time_grace)::INTEGER AS late,
      COUNT(*) FILTER (WHERE rs.skipped)::INTEGER AS skipped,
      AVG(rs.delay_seconds)::INTEGER AS avg_delay,
      MAX(rs.delay_seconds)::INTEGER AS max_delay
    FROM public.transport_run_stops rs WHERE rs.run_id = r.id
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::INTEGER AS expected,
      COUNT(*) FILTER (WHERE rp.state IN ('boarded', 'dropped'))::INTEGER AS boarded,
      COUNT(*) FILTER (WHERE rp.state = 'excused')::INTEGER AS excused,
      COUNT(*) FILTER (WHERE rp.state IN ('no_show', 'absent'))::INTEGER AS no_show
    FROM public.transport_run_passengers rp WHERE rp.run_id = r.id
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::INTEGER AS fixes,
      -- Fixes are expected roughly every 10 s; more than 120 s between two is a
      -- gap worth naming rather than a slow sample.
      LEAST(100, GREATEST(0, ROUND(
        100.0 * COUNT(*) / NULLIF(
          EXTRACT(EPOCH FROM (COALESCE(r.ended_at, r.scheduled_end_at, r.scheduled_start_at)
                              - COALESCE(r.started_at, r.scheduled_start_at))) / 10.0, 0)
      )))::SMALLINT AS coverage_pct,
      MAX(gap)::INTEGER AS longest_gap
    FROM (
      SELECT EXTRACT(EPOCH FROM (t.recorded_at - LAG(t.recorded_at)
             OVER (ORDER BY t.recorded_at))) AS gap
      FROM public.transport_telemetry t
      WHERE t.run_id = r.id AND NOT t.suspect
    ) gaps
  ) g ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS alerts
    FROM public.transport_alerts al WHERE al.run_id = r.id
  ) a ON true
  WHERE r.service_date = v_date
    AND r.status IN ('completed', 'cancelled', 'missed')
  ON CONFLICT (run_id) DO UPDATE SET
    route_id = EXCLUDED.route_id, vehicle_id = EXCLUDED.vehicle_id,
    driver_id = EXCLUDED.driver_id, direction = EXCLUDED.direction,
    stops_total = EXCLUDED.stops_total, stops_arrived = EXCLUDED.stops_arrived,
    stops_on_time = EXCLUDED.stops_on_time, stops_late = EXCLUDED.stops_late,
    stops_skipped = EXCLUDED.stops_skipped,
    avg_delay_seconds = EXCLUDED.avg_delay_seconds,
    max_delay_seconds = EXCLUDED.max_delay_seconds,
    expected_riders = EXCLUDED.expected_riders, boarded_riders = EXCLUDED.boarded_riders,
    excused_riders = EXCLUDED.excused_riders, no_show_riders = EXCLUDED.no_show_riders,
    capacity = EXCLUDED.capacity,
    fix_count = EXCLUDED.fix_count, coverage_pct = EXCLUDED.coverage_pct,
    longest_gap_seconds = EXCLUDED.longest_gap_seconds,
    alerts_opened = EXCLUDED.alerts_opened,
    started_late_seconds = EXCLUDED.started_late_seconds,
    computed_at = NOW();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.transport_stop_metrics AS sm (
    stop_id, direction, service_date, route_id,
    arrivals, on_time, avg_delay_seconds, max_delay_seconds,
    expected_riders, boarded_riders, computed_at
  )
  SELECT
    rs.stop_id, r.direction, r.service_date, r.route_id,
    COUNT(*) FILTER (WHERE rs.arrived_at IS NOT NULL)::INTEGER,
    COUNT(*) FILTER (WHERE rs.delay_seconds IS NOT NULL
                       AND rs.delay_seconds <= p_on_time_grace)::INTEGER,
    AVG(rs.delay_seconds)::INTEGER,
    MAX(rs.delay_seconds)::INTEGER,
    SUM(rs.expected_boardings)::INTEGER,
    SUM(rs.actual_boardings)::INTEGER,
    NOW()
  FROM public.transport_run_stops rs
  JOIN public.transport_trip_runs r ON r.id = rs.run_id
  WHERE r.service_date = v_date AND r.status IN ('completed', 'cancelled', 'missed')
  GROUP BY rs.stop_id, r.direction, r.service_date, r.route_id
  ON CONFLICT (stop_id, direction, service_date) DO UPDATE SET
    route_id = EXCLUDED.route_id,
    arrivals = EXCLUDED.arrivals, on_time = EXCLUDED.on_time,
    avg_delay_seconds = EXCLUDED.avg_delay_seconds,
    max_delay_seconds = EXCLUDED.max_delay_seconds,
    expected_riders = EXCLUDED.expected_riders,
    boarded_riders = EXCLUDED.boarded_riders,
    computed_at = NOW();

  RETURN v_rows;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_rollup_metrics(DATE, INTEGER) FROM PUBLIC, anon, authenticated;

-- ── Report readers ──────────────────────────────────────────────────────────

/**
 * On-time performance per route over a window.
 *
 * Every report reader checks the admin role explicitly rather than leaning on
 * the table policy: these are SECURITY DEFINER because they aggregate across
 * every route, which no non-admin has the right to see even in summary.
 */
CREATE OR REPLACE FUNCTION public.transport_report_ontime(p_from DATE, p_to DATE)
RETURNS TABLE (
  route_id UUID, route_name TEXT, direction public.transport_direction,
  runs INTEGER, stops_arrived INTEGER, stops_on_time INTEGER,
  on_time_pct NUMERIC, avg_delay_seconds INTEGER, max_delay_seconds INTEGER
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF public.get_user_role() <> 'admin' THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    m.route_id, r.name, m.direction,
    COUNT(*)::INTEGER,
    SUM(m.stops_arrived)::INTEGER,
    SUM(m.stops_on_time)::INTEGER,
    ROUND(100.0 * SUM(m.stops_on_time) / NULLIF(SUM(m.stops_arrived), 0), 1),
    AVG(m.avg_delay_seconds)::INTEGER,
    MAX(m.max_delay_seconds)::INTEGER
  FROM public.transport_run_metrics m
  JOIN public.transport_routes r ON r.id = m.route_id
  WHERE m.service_date BETWEEN p_from AND p_to
  GROUP BY m.route_id, r.name, m.direction
  ORDER BY r.name, m.direction;
END $fn$;

/** Seats bought vs seats used — the number that justifies or kills a route. */
CREATE OR REPLACE FUNCTION public.transport_report_utilisation(p_from DATE, p_to DATE)
RETURNS TABLE (
  route_id UUID, route_name TEXT, capacity INTEGER,
  avg_expected NUMERIC, avg_boarded NUMERIC,
  utilisation_pct NUMERIC, no_show_pct NUMERIC,
  -- Absolute totals as well as averages: the averages answer "is this route
  -- the right size", the totals answer "what happened to the children", and
  -- the summary panel is asking the second question.
  total_boarded BIGINT, total_excused BIGINT, total_no_show BIGINT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF public.get_user_role() <> 'admin' THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    m.route_id, r.name, MAX(m.capacity)::INTEGER,
    ROUND(AVG(m.expected_riders), 1),
    ROUND(AVG(m.boarded_riders), 1),
    ROUND(100.0 * AVG(m.boarded_riders) / NULLIF(MAX(m.capacity), 0), 1),
    -- Excused absences are not no-shows: a child on approved leave was never
    -- expected, and counting them as waste would make every Monday look broken.
    ROUND(100.0 * SUM(m.no_show_riders)
          / NULLIF(SUM(m.expected_riders) - SUM(m.excused_riders), 0), 1),
    SUM(m.boarded_riders)::BIGINT,
    SUM(m.excused_riders)::BIGINT,
    SUM(m.no_show_riders)::BIGINT
  FROM public.transport_run_metrics m
  JOIN public.transport_routes r ON r.id = m.route_id
  WHERE m.service_date BETWEEN p_from AND p_to
  GROUP BY m.route_id, r.name
  ORDER BY r.name;
END $fn$;

/** Delay by stop: where the published timetable stopped being true. */
CREATE OR REPLACE FUNCTION public.transport_report_delay_by_stop(p_from DATE, p_to DATE)
RETURNS TABLE (
  stop_id UUID, stop_name TEXT, route_id UUID, route_name TEXT,
  direction public.transport_direction, arrivals INTEGER,
  on_time_pct NUMERIC, avg_delay_seconds INTEGER, max_delay_seconds INTEGER
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF public.get_user_role() <> 'admin' THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    sm.stop_id, s.name, sm.route_id, r.name, sm.direction,
    SUM(sm.arrivals)::INTEGER,
    ROUND(100.0 * SUM(sm.on_time) / NULLIF(SUM(sm.arrivals), 0), 1),
    AVG(sm.avg_delay_seconds)::INTEGER,
    MAX(sm.max_delay_seconds)::INTEGER
  FROM public.transport_stop_metrics sm
  JOIN public.transport_route_stops s ON s.id = sm.stop_id
  LEFT JOIN public.transport_routes r ON r.id = sm.route_id
  WHERE sm.service_date BETWEEN p_from AND p_to
  GROUP BY sm.stop_id, s.name, sm.route_id, r.name, sm.direction
  ORDER BY AVG(sm.avg_delay_seconds) DESC NULLS LAST;
END $fn$;

/** GPS health per vehicle. A vehicle at the bottom of this list is the reason
 *  some parent was told nothing all week. */
CREATE OR REPLACE FUNCTION public.transport_report_gps_health(p_from DATE, p_to DATE)
RETURNS TABLE (
  vehicle_id UUID, registration_no TEXT, display_name TEXT,
  runs INTEGER, avg_coverage_pct NUMERIC,
  worst_coverage_pct INTEGER, longest_gap_seconds INTEGER, total_fixes BIGINT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF public.get_user_role() <> 'admin' THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    m.vehicle_id, v.registration_no, v.display_name,
    COUNT(*)::INTEGER,
    ROUND(AVG(m.coverage_pct), 1),
    MIN(m.coverage_pct)::INTEGER,
    MAX(m.longest_gap_seconds)::INTEGER,
    SUM(m.fix_count)::BIGINT
  FROM public.transport_run_metrics m
  JOIN public.transport_vehicles v ON v.id = m.vehicle_id
  WHERE m.service_date BETWEEN p_from AND p_to
  GROUP BY m.vehicle_id, v.registration_no, v.display_name
  ORDER BY AVG(m.coverage_pct) NULLS FIRST;
END $fn$;

/**
 * Boardings that disagree with class attendance.
 *
 * The one report a standalone bus tracker structurally cannot produce: a child
 * who boarded the morning bus and was then marked absent in class is a child
 * worth finding, and only a system holding both facts can ask the question.
 */
CREATE OR REPLACE FUNCTION public.transport_report_attendance_mismatch(p_from DATE, p_to DATE)
RETURNS TABLE (
  service_date DATE, student_id UUID, student_name TEXT,
  route_name TEXT, boarding_state TEXT, class_status TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF public.get_user_role() <> 'admin' THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    r.service_date, rp.student_id, p.full_name, rt.name,
    rp.state::TEXT, ar.status::TEXT
  FROM public.transport_run_passengers rp
  JOIN public.transport_trip_runs r ON r.id = rp.run_id
  JOIN public.transport_routes rt ON rt.id = r.route_id
  JOIN public.profiles p ON p.id = rp.student_id
  JOIN public.attendance_records ar
    ON ar.student_id = rp.student_id AND ar.date = r.service_date
  WHERE r.service_date BETWEEN p_from AND p_to
    AND r.direction = 'inbound'
    AND rp.state IN ('boarded', 'dropped')
    AND ar.status = 'absent'
    AND ar.leave_application_id IS NULL
  ORDER BY r.service_date DESC, p.full_name;
END $fn$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'transport_report_ontime', 'transport_report_utilisation',
    'transport_report_delay_by_stop', 'transport_report_gps_health',
    'transport_report_attendance_mismatch'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(DATE, DATE) FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(DATE, DATE) TO authenticated', f);
  END LOOP;
END $$;

-- ── Route counts ────────────────────────────────────────────────────────────
-- Replaces fetchRouteStopCounts + fetchRouteStudentCounts, which each selected
-- every row of a table so the browser could call it .length.

CREATE OR REPLACE FUNCTION public.transport_route_counts()
RETURNS TABLE (route_id UUID, stops INTEGER, students INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
  SELECT
    r.id,
    (SELECT COUNT(*)::INTEGER FROM public.transport_route_stops s
      WHERE s.route_id = r.id AND s.active),
    (SELECT COUNT(*)::INTEGER FROM public.transport_student_assignments a
      WHERE a.route_id = r.id AND a.ended_on IS NULL)
  FROM public.transport_routes r;
$fn$;
REVOKE EXECUTE ON FUNCTION public.transport_route_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_route_counts() TO authenticated;

-- ── Schedule ────────────────────────────────────────────────────────────────
-- 03:45 UTC, after the archiver and the purges, so a rollup reads a settled day.

DO $$ BEGIN PERFORM cron.unschedule('transport-rollup-metrics'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('transport-rollup-metrics', '45 3 * * *',
  $$SELECT public.transport_rollup_metrics();$$);

GRANT SELECT ON public.transport_run_metrics, public.transport_stop_metrics TO authenticated;

NOTIFY pgrst, 'reload schema';
