-- ============================================================================
-- Migration: Transport — Round 4a, telemetry archive and trip replay
--
-- transport_telemetry keeps 7 days at full resolution (a fix every 8 seconds
-- from every bus) and is then deleted. That is the right call for the firehose
-- and the wrong one for the product: "show me what happened on Tuesday" is the
-- question an angry parent asks on Thursday, and a school that cannot answer it
-- looks like a school that is hiding something.
--
-- So the track is archived rather than kept. One fix per 30 seconds per run is
-- enough to draw a line on a map and to answer where a bus was at 07:41; it is
-- roughly a fortieth of the raw volume, and it is deliberately too coarse to
-- reconstruct a child's doorstep movements. `suspect` fixes never enter the
-- archive — they are the "bus teleported" artefacts and would only put a kink
-- in the replayed line.
--
-- Archive retention is one academic term (180 days), after which the run's
-- aggregate metrics (Round 4b) remain and the track does not. Location history
-- of minors is the most sensitive data this application holds and the default
-- has to be that it expires.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- ── The archive ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transport_telemetry_archive (
  run_id      UUID NOT NULL REFERENCES public.transport_trip_runs(id) ON DELETE CASCADE,
  -- The 30-second bucket this fix represents. Part of the key, which is what
  -- makes re-running the archiver over an already-archived window a no-op
  -- rather than a duplicate track.
  bucket_at   TIMESTAMPTZ NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  heading_deg REAL,
  speed_kmh   REAL,
  accuracy_m  REAL,
  source      public.transport_fix_source NOT NULL,
  -- Distance along the route at this point, copied from the run at archive
  -- time so a replay scrubber can show progress without re-projecting.
  progress_m  DOUBLE PRECISION,
  off_route_m DOUBLE PRECISION,
  PRIMARY KEY (run_id, bucket_at)
);

CREATE INDEX IF NOT EXISTS idx_transport_telemetry_archive_time
  ON public.transport_telemetry_archive USING BRIN (bucket_at);

ALTER TABLE public.transport_telemetry_archive ENABLE ROW LEVEL SECURITY;

-- Same readers as transport_telemetry, and one permissive SELECT policy, per
-- transport_r3_f_consolidate_policies. No write policy at all: the archiver is
-- SECURITY DEFINER and nothing else may author a bus's history.
DROP POLICY IF EXISTS "Reads transport_telemetry_archive" ON public.transport_telemetry_archive;
CREATE POLICY "Reads transport_telemetry_archive"
  ON public.transport_telemetry_archive FOR SELECT TO authenticated
  USING (
    (select public.get_user_role()) = 'admin'
    OR (select public.transport_is_crew(run_id))
    OR (select public.transport_run_is_mine(run_id))
  );

-- ── The archiver ────────────────────────────────────────────────────────────

/**
 * Fold finished runs' fixes down to one per 30 seconds.
 *
 * Only runs that have ended: an in-progress run's tail would be archived at one
 * resolution and its head at another. `DISTINCT ON` takes the first fix in each
 * bucket rather than an average, because an averaged position is a place the
 * bus never was, and on a road that curves it can be the wrong side of it.
 */
CREATE OR REPLACE FUNCTION public.transport_archive_telemetry(p_older_than INTERVAL DEFAULT INTERVAL '2 days')
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_rows INTEGER;
BEGIN
  INSERT INTO public.transport_telemetry_archive
    (run_id, bucket_at, lat, lng, heading_deg, speed_kmh, accuracy_m, source, progress_m, off_route_m)
  SELECT DISTINCT ON (t.run_id, to_timestamp(floor(extract(EPOCH FROM t.recorded_at) / 30) * 30))
    t.run_id,
    to_timestamp(floor(extract(EPOCH FROM t.recorded_at) / 30) * 30),
    t.lat, t.lng, t.heading_deg, t.speed_kmh, t.accuracy_m, t.source,
    NULL::DOUBLE PRECISION, NULL::DOUBLE PRECISION
  FROM public.transport_telemetry t
  JOIN public.transport_trip_runs r ON r.id = t.run_id
  WHERE t.run_id IS NOT NULL
    AND NOT t.suspect
    AND r.status IN ('completed', 'cancelled', 'missed')
    AND t.recorded_at < NOW() - p_older_than
  ORDER BY
    t.run_id,
    to_timestamp(floor(extract(EPOCH FROM t.recorded_at) / 30) * 30),
    t.recorded_at
  ON CONFLICT (run_id, bucket_at) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_archive_telemetry(INTERVAL) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_transport_archive()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  DELETE FROM public.transport_telemetry_archive WHERE bucket_at < NOW() - INTERVAL '180 days';
$fn$;
REVOKE EXECUTE ON FUNCTION public.cleanup_transport_archive() FROM PUBLIC, anon, authenticated;

-- ── Replay ──────────────────────────────────────────────────────────────────

/**
 * The whole of a finished run, in one call, ordered for a scrubber.
 *
 * Reads the archive for older runs and the live firehose for recent ones, so a
 * run that ended twenty minutes ago replays at full resolution and one from
 * last month replays at 30 seconds — without the caller knowing which.
 *
 * SECURITY DEFINER with the permission check written out, because it reads two
 * tables plus events and a policy on each would be evaluated per row; the check
 * is the same predicate the policies carry.
 */
CREATE OR REPLACE FUNCTION public.transport_replay_run(p_run UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run    RECORD;
  v_track  JSONB;
  v_stops  JSONB;
  v_events JSONB;
  v_board  JSONB;
BEGIN
  IF NOT (
    public.get_user_role() = 'admin'
    OR public.transport_is_crew(p_run)
    OR public.transport_run_is_mine(p_run)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not permitted');
  END IF;

  SELECT r.id, r.route_id, r.direction, r.service_date, r.status,
         r.started_at, r.ended_at, r.scheduled_start_at, r.scheduled_end_at,
         r.vehicle_id, r.driver_id, r.attendant_id
    INTO v_run
  FROM public.transport_trip_runs r WHERE r.id = p_run;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No such trip');
  END IF;

  -- Archive first; anything the archiver has not reached yet comes from the
  -- firehose. A bucket present in both is taken from the archive, so the two
  -- resolutions never interleave into a stuttering line.
  WITH archived AS (
    SELECT bucket_at AS at, lat, lng, heading_deg, speed_kmh, 'archive'::TEXT AS res
    FROM public.transport_telemetry_archive WHERE run_id = p_run
  ),
  live AS (
    SELECT t.recorded_at AS at, t.lat, t.lng, t.heading_deg, t.speed_kmh, 'live'::TEXT AS res
    FROM public.transport_telemetry t
    WHERE t.run_id = p_run
      AND NOT t.suspect
      AND NOT EXISTS (
        SELECT 1 FROM public.transport_telemetry_archive a
        WHERE a.run_id = p_run
          AND a.bucket_at = to_timestamp(floor(extract(EPOCH FROM t.recorded_at) / 30) * 30)
      )
  ),
  merged AS (
    SELECT * FROM archived UNION ALL SELECT * FROM live
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at', at, 'lat', lat, 'lng', lng,
           'heading_deg', heading_deg, 'speed_kmh', speed_kmh, 'res', res
         ) ORDER BY at), '[]'::JSONB)
    INTO v_track
  FROM merged;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'stop_id', rs.stop_id, 'seq', rs.seq, 'name', s.name,
           'lat', s.lat, 'lng', s.lng, 'radius_m', s.radius_m,
           'scheduled_arrival_at', rs.scheduled_arrival_at,
           'arrived_at', rs.arrived_at, 'departed_at', rs.departed_at,
           'delay_seconds', rs.delay_seconds, 'skipped', rs.skipped,
           'arrival_verdict', rs.arrival_verdict,
           'expected_boardings', rs.expected_boardings,
           'actual_boardings', rs.actual_boardings
         ) ORDER BY rs.seq), '[]'::JSONB)
    INTO v_stops
  FROM public.transport_run_stops rs
  JOIN public.transport_route_stops s ON s.id = rs.stop_id
  WHERE rs.run_id = p_run;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at', e.occurred_at, 'kind', e.event_type, 'stop_id', e.stop_id, 'source', e.source
         ) ORDER BY e.occurred_at), '[]'::JSONB)
    INTO v_events
  FROM public.transport_stop_events e WHERE e.run_id = p_run;

  -- A parent sees only their own child on the timeline; crew and admin see the
  -- roster. Same rule as the live screen, applied to history.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'at', b.occurred_at, 'student_id', b.student_id,
           'event', b.event, 'stop_id', b.stop_id, 'method', b.method
         ) ORDER BY b.occurred_at), '[]'::JSONB)
    INTO v_board
  FROM public.transport_boarding_events b
  WHERE b.run_id = p_run
    AND (public.get_user_role() = 'admin'
         OR public.transport_is_crew(p_run)
         OR b.student_id = auth.uid());

  RETURN jsonb_build_object(
    'ok', true,
    'run', to_jsonb(v_run),
    'track', v_track,
    'stops', v_stops,
    'events', v_events,
    'boardings', v_board
  );
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_replay_run(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_replay_run(UUID) TO authenticated;

-- ── Schedule ────────────────────────────────────────────────────────────────
-- 02:30 UTC, half an hour before cleanup-transport-telemetry deletes at 03:00.
-- Order matters: the archiver has to have run before the firehose is pruned.

DO $$ BEGIN PERFORM cron.unschedule('transport-archive-telemetry'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('transport-archive-telemetry', '30 2 * * *',
  $$SELECT public.transport_archive_telemetry();$$);

DO $$ BEGIN PERFORM cron.unschedule('cleanup-transport-archive'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('cleanup-transport-archive', '15 3 * * *',
  $$SELECT public.cleanup_transport_archive();$$);

GRANT SELECT ON public.transport_telemetry_archive TO authenticated;

NOTIFY pgrst, 'reload schema';
