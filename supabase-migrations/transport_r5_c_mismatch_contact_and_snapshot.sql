-- ============================================================================
-- Migration: Transport — Round 5c/5d, a report you can act on and a screen
-- that reads one row
--
-- Two changes, both in service of merging Live and Insights into one page.
--
-- 1. transport_report_attendance_mismatch now returns the guardian's phone.
--    The report answers "which child boarded the bus and was then marked
--    absent in class", and until now it named the child and stopped there —
--    leaving the one person who can resolve it a search away. The whole point
--    of that report is the phone call it should cause.
--
--    The number resolves exactly as the notification path resolves it
--    (assignment override -> guardian -> student), so an admin rings the same
--    number the system would have messaged. This function is gated to admins
--    on its first line, which is why it may return a number while
--    transport_student_contact (revoked in r5_a) may not: there, any signed-in
--    account could ask about any child; here an admin asks about the handful
--    who triggered a genuine discrepancy.
--
-- 2. transport_today_snapshot() — fleet state, ridership, seat efficiency, GPS
--    health and the fee position, as one JSON row. The merged screen wants all
--    of it at once, and every value is a scalar aggregate the database can
--    compute without sending a single row to the browser. Eight round trips
--    for eight numbers is what makes a dashboard feel slow.
--
-- Applied to the live project on 2026-09-22.
-- ============================================================================

DROP FUNCTION IF EXISTS public.transport_report_attendance_mismatch(DATE, DATE);

CREATE OR REPLACE FUNCTION public.transport_report_attendance_mismatch(p_from DATE, p_to DATE)
RETURNS TABLE (
  service_date DATE, student_id UUID, student_name TEXT,
  route_name TEXT, boarding_state TEXT, class_status TEXT,
  guardian_phone TEXT, whatsapp_opted_in BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF public.get_user_role() <> 'admin' THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    r.service_date, rp.student_id, p.full_name, rt.name,
    rp.state::TEXT, ar.status::TEXT,
    COALESCE(asg.guardian_phone, sd.guardian_phone, sd.phone),
    sd.whatsapp_opt_in_at IS NOT NULL
  FROM public.transport_run_passengers rp
  JOIN public.transport_trip_runs r ON r.id = rp.run_id
  JOIN public.transport_routes rt ON rt.id = r.route_id
  JOIN public.profiles p ON p.id = rp.student_id
  JOIN public.attendance_records ar
    ON ar.student_id = rp.student_id AND ar.date = r.service_date
  LEFT JOIN public.student_details sd ON sd.student_id = rp.student_id
  LEFT JOIN public.transport_student_assignments asg
    ON asg.student_id = rp.student_id AND asg.ended_on IS NULL
  WHERE r.service_date BETWEEN p_from AND p_to
    AND r.direction = 'inbound'
    AND rp.state IN ('boarded', 'dropped')
    AND ar.status = 'absent'
    AND ar.leave_application_id IS NULL
  ORDER BY r.service_date DESC, p.full_name;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_report_attendance_mismatch(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_report_attendance_mismatch(DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.transport_today_snapshot()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE public.attendance_timezone())::DATE;
  v JSONB;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not permitted');
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'service_date', v_today,
    'runs_total',   COUNT(*),
    'runs_on_road', COUNT(*) FILTER (WHERE status IN ('boarding','in_progress')),
    'runs_done',    COUNT(*) FILTER (WHERE status = 'completed'),
    'runs_late',    COUNT(*) FILTER (WHERE COALESCE(delay_seconds,0) > 300),
    -- "Reporting" is the honest denominator for everything else on the screen:
    -- a run that is not live has no position, no ETA and no verdict worth
    -- printing, so the screen says how many it is actually speaking for.
    'runs_live',    COUNT(*) FILTER (WHERE telemetry_state = 'live'),
    'runs_stale',   COUNT(*) FILTER (WHERE status IN ('boarding','in_progress')
                                       AND telemetry_state IS DISTINCT FROM 'live')
  ) INTO v
  FROM public.transport_trip_runs WHERE service_date = v_today;

  SELECT v || jsonb_build_object(
      'riders_expected', COALESCE(COUNT(*), 0),
      'riders_boarded',  COALESCE(COUNT(*) FILTER (WHERE rp.state IN ('boarded','dropped')), 0),
      'riders_dropped',  COALESCE(COUNT(*) FILTER (WHERE rp.state = 'dropped'), 0),
      'riders_excused',  COALESCE(COUNT(*) FILTER (WHERE rp.state = 'excused'), 0),
      'riders_no_show',  COALESCE(COUNT(*) FILTER (WHERE rp.state IN ('no_show','absent')), 0)
    ) INTO v
  FROM public.transport_run_passengers rp
  JOIN public.transport_trip_runs r ON r.id = rp.run_id
  WHERE r.service_date = v_today;

  SELECT v || jsonb_build_object('seats_capacity', COALESCE(SUM(vh.capacity), 0))
    INTO v
  FROM public.transport_trip_runs r
  JOIN public.transport_vehicles vh ON vh.id = r.vehicle_id
  WHERE r.service_date = v_today AND r.status IN ('boarding','in_progress','completed');

  -- Fee position. Not today's — fees are a term-long story, and "collected so
  -- far" is the number a transport admin is actually asked about.
  SELECT v || jsonb_build_object(
      'fees_billed',      COALESCE(SUM(amount), 0),
      'fees_collected',   COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0),
      'fees_outstanding', COALESCE(SUM(amount) FILTER (WHERE status NOT IN ('paid','cancelled')), 0),
      'fees_overdue',     COALESCE(SUM(amount) FILTER (WHERE status NOT IN ('paid','cancelled')
                                                         AND due_date < CURRENT_DATE), 0)
    ) INTO v
  FROM public.bus_fees;

  SELECT v || jsonb_build_object(
      'gps_avg_coverage_pct', ROUND(AVG(coverage_pct)),
      'gps_days', COUNT(DISTINCT service_date)
    ) INTO v
  FROM public.transport_run_metrics
  WHERE service_date >= v_today - 7;

  RETURN v;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_today_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_today_snapshot() TO authenticated;

NOTIFY pgrst, 'reload schema';
