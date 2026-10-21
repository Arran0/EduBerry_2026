-- transport_materialise_runs() has failed on every call since 2026-08-31.
--
-- add_attendance_holiday_weekday_scope.sql renamed attendance_holidays.date to
-- scope_date (and added recurring weekday holidays via scope_type /
-- scope_weekday), but this function still filtered on `date`:
--
--   ERROR 42703: column "date" does not exist
--
-- The Transport page calls it on every load to create today's trip runs, so
-- since then no runs have been materialised from it — the call just logs
-- "materialiseRuns failed" in the browser console. Found while testing the
-- live app on 2026-10-21.
--
-- Re-created verbatim from transport_r2_c_schedule_and_retire.sql except for
-- the holiday check, which now matches a dated or a recurring-weekday
-- school-wide holiday the same way attendance_day_off_kind() does.

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
  -- Same date-or-weekday match as attendance_day_off_kind().
  IF EXISTS (
    SELECT 1 FROM public.attendance_holidays h
     WHERE h.is_default
       AND ((h.scope_type = 'date'    AND h.scope_date    = d)
         OR (h.scope_type = 'weekday' AND h.scope_weekday = dow))
  ) THEN
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
