-- ============================================================================
-- Migration: Transport — Round 4d, GTFS static and GTFS-Realtime
--
-- Round 1 adopted GTFS's vocabulary — route, stop, stop_sequence, trip,
-- scheduled arrival — on the argument that doing so would make an export a
-- view rather than a migration. This is the receipt on that argument: every
-- function below is a SELECT over tables that already exist, and not one
-- column was added to produce it.
--
-- Why a school wants this at all: a municipal transport authority, a parent's
-- third-party map app, a safety audit, or simply the school's next vendor. An
-- export in an open format is the difference between data the school owns and
-- data that happens to live in EdZee.
--
-- Scope, honestly stated: these emit the six required GTFS files plus
-- shapes.txt, and a GTFS-Realtime VehiclePosition/TripUpdate payload in JSON
-- rather than protobuf. Protobuf encoding belongs in the API route, not in
-- PL/pgSQL — this produces the message, the route serialises it.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- ── Static ──────────────────────────────────────────────────────────────────

/**
 * agency.txt / routes.txt / stops.txt / calendar.txt / trips.txt /
 * stop_times.txt / shapes.txt, as one JSON object of arrays.
 *
 * The caller writes the CSV. Doing the quoting here would mean implementing
 * RFC 4180 escaping in PL/pgSQL against school-entered stop names, which is
 * precisely the sort of thing that works until a stop is called
 * `St. Mary"s, Gate 2`.
 *
 * GTFS ids are the UUIDs. They are ugly and they are stable, and a feed whose
 * ids change when somebody renames a route is a feed that breaks every
 * consumer downstream of it.
 */
CREATE OR REPLACE FUNCTION public.transport_gtfs_static()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_school_name TEXT;
  v_tz          TEXT := public.attendance_timezone();
  v_url         TEXT;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not permitted');
  END IF;

  -- site_settings.value is JSONB and the school's name lives under 'branding'
  -- alongside the logo and the colours; there is no flat school_name key.
  SELECT value->>'schoolName', value->>'siteUrl'
    INTO v_school_name, v_url
  FROM public.site_settings WHERE key = 'branding';

  RETURN jsonb_build_object(
    'ok', true,
    'generated_at', NOW(),

    'agency', jsonb_build_array(jsonb_build_object(
      'agency_id', 'edzee-school',
      'agency_name', COALESCE(v_school_name, 'School'),
      'agency_url', COALESCE(v_url, 'https://example.invalid'),
      'agency_timezone', v_tz
    )),

    -- route_type 3 is "bus". There is no school-bus type in GTFS and inventing
    -- an extended one would put the feed outside the spec for no gain.
    'routes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'route_id', r.id,
        'agency_id', 'edzee-school',
        'route_short_name', COALESCE(r.code, ''),
        'route_long_name', r.name,
        'route_desc', COALESCE(r.description, ''),
        'route_type', 3,
        'route_color', COALESCE(ltrim(r.color, '#'), '')
      ) ORDER BY r.name)
      FROM public.transport_routes r
      WHERE r.active AND r.archived_at IS NULL
    ), '[]'::JSONB),

    'stops', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stop_id', s.id,
        'stop_name', s.name,
        'stop_desc', COALESCE(s.landmark, ''),
        'stop_lat', s.lat,
        'stop_lng', s.lng,
        'location_type', 0
      ) ORDER BY s.name)
      FROM public.transport_route_stops s
      JOIN public.transport_routes r ON r.id = s.route_id
      WHERE s.active AND r.active AND r.archived_at IS NULL
    ), '[]'::JSONB),

    -- One calendar per schedule, and active_from/active_to are already
    -- start_date/end_date. days_of_week is Postgres EXTRACT(DOW) — 0 = Sunday
    -- through 6 = Saturday — NOT ISO, so Sunday is 0 here and not 7.
    'calendar', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'service_id', sc.id,
        'monday',    (1 = ANY(sc.days_of_week))::INTEGER,
        'tuesday',   (2 = ANY(sc.days_of_week))::INTEGER,
        'wednesday', (3 = ANY(sc.days_of_week))::INTEGER,
        'thursday',  (4 = ANY(sc.days_of_week))::INTEGER,
        'friday',    (5 = ANY(sc.days_of_week))::INTEGER,
        'saturday',  (6 = ANY(sc.days_of_week))::INTEGER,
        'sunday',    (0 = ANY(sc.days_of_week))::INTEGER,
        'start_date', to_char(COALESCE(sc.active_from, CURRENT_DATE), 'YYYYMMDD'),
        'end_date',   to_char(COALESCE(sc.active_to, CURRENT_DATE + 365), 'YYYYMMDD')
      ))
      FROM public.transport_route_schedules sc WHERE sc.active
    ), '[]'::JSONB),

    -- A holiday the school already declared is a calendar_dates exception of
    -- type 2 (service removed), which is the whole point of holding both.
    -- Only scope_type='date' holidays: a recurring weekday holiday is already
    -- expressed by that weekday being absent from days_of_week in calendar.
    'calendar_dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'service_id', sc.id,
        'date', to_char(h.scope_date, 'YYYYMMDD'),
        'exception_type', 2
      ))
      FROM public.transport_route_schedules sc
      CROSS JOIN public.attendance_holidays h
      WHERE sc.active
        AND h.scope_type = 'date'
        AND h.scope_date IS NOT NULL
        AND h.scope_date >= CURRENT_DATE
    ), '[]'::JSONB),

    -- direction_id 0 = inbound (towards school), 1 = outbound. GTFS leaves the
    -- meaning to the agency and asks only that it be consistent.
    'trips', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'route_id', sc.route_id,
        'service_id', sc.id,
        'trip_id', sc.id,
        'trip_headsign', COALESCE(sc.label, r.name),
        'direction_id', CASE WHEN sc.direction = 'inbound' THEN 0 ELSE 1 END,
        'shape_id', sc.route_id::TEXT || ':' || sc.direction::TEXT
      ))
      FROM public.transport_route_schedules sc
      JOIN public.transport_routes r ON r.id = sc.route_id
      WHERE sc.active
    ), '[]'::JSONB),

    -- Offsets become clock times here, which is the one real transformation in
    -- this feed: EdZee stores minutes-from-departure so one stop list serves an
    -- 07:10 and an 07:40 run, and GTFS wants the wall clock.
    'stop_times', COALESCE((
      SELECT jsonb_agg(t ORDER BY t->>'trip_id', (t->>'stop_sequence')::INTEGER)
      FROM (
        SELECT jsonb_build_object(
          'trip_id', sc.id,
          'stop_id', s.id,
          'stop_sequence', ROW_NUMBER() OVER (
            PARTITION BY sc.id
            ORDER BY CASE WHEN sc.direction = 'inbound'
                          THEN COALESCE(s.inbound_offset_min, s.seq)
                          ELSE COALESCE(s.outbound_offset_min, -s.seq) END, s.seq),
          'arrival_time', to_char(
            sc.start_time + make_interval(mins => COALESCE(
              CASE WHEN sc.direction = 'inbound' THEN s.inbound_offset_min
                   ELSE s.outbound_offset_min END, 0)), 'HH24:MI:SS'),
          'departure_time', to_char(
            sc.start_time
            + make_interval(mins => COALESCE(
                CASE WHEN sc.direction = 'inbound' THEN s.inbound_offset_min
                     ELSE s.outbound_offset_min END, 0))
            + make_interval(secs => s.dwell_seconds), 'HH24:MI:SS')
        ) AS t
        FROM public.transport_route_schedules sc
        JOIN public.transport_route_stops s ON s.route_id = sc.route_id AND s.active
        WHERE sc.active
      ) rows
    ), '[]'::JSONB),

    'shapes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'shape_id', p.route_id::TEXT || ':' || p.direction::TEXT,
        'points', p.polyline
      ))
      FROM public.transport_route_paths p
    ), '[]'::JSONB)
  );
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_gtfs_static() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_gtfs_static() TO authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────

/**
 * A GTFS-Realtime FeedMessage, in JSON.
 *
 * Two entity kinds: a VehiclePosition per bus that is actually reporting, and
 * a TripUpdate carrying per-stop arrival predictions.
 *
 * The honesty rule from transport_recompute_eta carries into the feed: a run
 * whose telemetry is not live emits NO VehiclePosition at all, rather than its
 * last known position with a fresh timestamp. A stale position in a realtime
 * feed is worse than a missing one, because a consumer cannot tell the
 * difference and will draw the bus somewhere it is not.
 */
CREATE OR REPLACE FUNCTION public.transport_gtfs_realtime()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not permitted');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'header', jsonb_build_object(
      'gtfs_realtime_version', '2.0',
      'incrementality', 'FULL_DATASET',
      'timestamp', EXTRACT(EPOCH FROM v_now)::BIGINT
    ),
    'entity', COALESCE((
      SELECT jsonb_agg(e) FROM (
        SELECT jsonb_build_object(
          'id', 'vp:' || r.id::TEXT,
          'vehicle', jsonb_build_object(
            'trip', jsonb_build_object(
              'trip_id', COALESCE(r.schedule_id::TEXT, r.id::TEXT),
              'route_id', r.route_id,
              'start_date', to_char(r.service_date, 'YYYYMMDD'),
              'schedule_relationship',
                CASE WHEN r.schedule_id IS NULL THEN 'ADDED' ELSE 'SCHEDULED' END
            ),
            'vehicle', jsonb_build_object(
              'id', COALESCE(r.vehicle_id::TEXT, r.id::TEXT),
              'label', COALESCE(v.display_name, v.registration_no, '')
            ),
            'position', jsonb_build_object(
              'latitude', r.last_lat, 'longitude', r.last_lng,
              'bearing', r.last_heading_deg, 'speed', r.last_speed_kmh / 3.6
            ),
            'current_stop_sequence', cs.seq,
            'current_status', CASE
              WHEN cs.arrived_at IS NOT NULL AND cs.departed_at IS NULL THEN 'STOPPED_AT'
              ELSE 'IN_TRANSIT_TO' END,
            'timestamp', EXTRACT(EPOCH FROM r.last_fix_at)::BIGINT,
            'congestion_level', 'UNKNOWN_CONGESTION_LEVEL'
          )
        ) AS e
        FROM public.transport_trip_runs r
        LEFT JOIN public.transport_vehicles v ON v.id = r.vehicle_id
        LEFT JOIN public.transport_run_stops cs
          ON cs.run_id = r.id AND cs.stop_id = r.current_stop_id
        WHERE r.status IN ('boarding', 'in_progress')
          AND r.telemetry_state = 'live'
          AND r.last_lat IS NOT NULL AND r.last_lng IS NOT NULL

        UNION ALL

        SELECT jsonb_build_object(
          'id', 'tu:' || r.id::TEXT,
          'trip_update', jsonb_build_object(
            'trip', jsonb_build_object(
              'trip_id', COALESCE(r.schedule_id::TEXT, r.id::TEXT),
              'route_id', r.route_id,
              'start_date', to_char(r.service_date, 'YYYYMMDD'),
              'schedule_relationship',
                CASE WHEN r.status = 'cancelled' THEN 'CANCELED' ELSE 'SCHEDULED' END
            ),
            'timestamp', EXTRACT(EPOCH FROM COALESCE(r.last_fix_at, v_now))::BIGINT,
            'delay', r.delay_seconds,
            'stop_time_update', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'stop_sequence', rs.seq,
                'stop_id', rs.stop_id,
                'arrival', CASE WHEN rs.eta_at IS NOT NULL THEN jsonb_build_object(
                  'time', EXTRACT(EPOCH FROM rs.eta_at)::BIGINT,
                  'delay', CASE WHEN rs.scheduled_arrival_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (rs.eta_at - rs.scheduled_arrival_at))::INTEGER END
                ) END,
                'schedule_relationship',
                  CASE WHEN rs.skipped THEN 'SKIPPED' ELSE 'SCHEDULED' END
              ) ORDER BY rs.seq)
              FROM public.transport_run_stops rs
              WHERE rs.run_id = r.id AND rs.arrived_at IS NULL
            ), '[]'::JSONB)
          )
        ) AS e
        FROM public.transport_trip_runs r
        WHERE r.status IN ('scheduled', 'boarding', 'in_progress', 'cancelled')
          AND r.service_date = (NOW() AT TIME ZONE public.attendance_timezone())::DATE
      ) entities
    ), '[]'::JSONB)
  );
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_gtfs_realtime() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_gtfs_realtime() TO authenticated;

NOTIFY pgrst, 'reload schema';
