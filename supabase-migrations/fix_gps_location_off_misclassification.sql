-- ============================================================================
-- Migration: stop recording "location access was switched off" against staff
--            who never switched anything off
--
-- What was observed
-- -----------------
-- On the morning of 2026-09-21, ten staff were recorded with the `location_off`
-- verdict between 08:43 and 08:51 IST. Two things about those rows rule out the
-- verdict being true:
--
--   * `sample_count`, `acquisition_ms` and `failure` are all NULL on every one
--     of them. The client never ran a GPS acquisition at all — so nothing about
--     the device's location settings was ever discovered, let alone reported.
--   * They fall inside the window (03:13–03:21 UTC) in which the REST API was
--     shedding requests under connection-pool exhaustion. The PostgREST log for
--     those minutes contains, verbatim,
--         GET /site_settings?select=value&key=eq.geofence  ... 504
--     which is the fence read the punch screen makes before deciding whether to
--     take a reading.
--
-- The same signature appears on 2026-09-17 (five staff, 08:43–08:47 IST) and on
-- a scattering of single days before that. Every one of these rows is a punch
-- made while the app could not reach the server, and every one was written to
-- the report in red, sorted to the top of the day, under the words "location
-- access was off on this device".
--
-- The chain
-- ---------
--   1. fetchGeofenceConfig() returned `null` both when there was no fence and
--      when the read failed. A 504 therefore presented to the punch screen as
--      "geofencing is switched off school-wide".
--   2. So the screen took no reading and sent the punch with no coordinates and
--      no failure code — correct behaviour for a school with no fence.
--   3. The server, which could read the fence perfectly well, saw a fence that
--      was enabled, no coordinates, and no stated reason. The ELSE branch below
--      turned that silence into `location_off`.
--
-- Steps 1 and 2 are fixed in the client (src/lib/attendance.ts,
-- src/components/attendance/StaffCheckIn.tsx): a fence that cannot be read is
-- now distinguished from a fence that is off, the staff member is offered a
-- retry, and a punch that goes ahead anyway carries the explicit code
-- `fence_unreadable`. This migration fixes step 3, so that no future client bug
-- or serving failure can be laundered into an accusation.
--
-- Run this in the Supabase SQL Editor, after attendance_device_problem_warning.sql
-- and attendance_allow_off_campus_flagged.sql.
-- ============================================================================

-- ── 1. Reclassify the failure codes ─────────────────────────────────────────
--
-- Mirrors FAILURE_CLASS in src/lib/gpsAcquisition.ts. Change one, change both.
--
-- Three changes from attendance_device_problem_warning.sql:
--
--   `unavailable` → device_problem.
--     This is the browser's POSITION_UNAVAILABLE. The previous classification
--     read it as "location services are off"; the Geolocation spec gives it
--     when the *positioning* fails — no GNSS lock, no network fix, receiver
--     error — which is the textbook device problem. A phone indoors with a cold
--     receiver emits it and frequently recovers a few seconds later. Nobody
--     chose it, so it is not flagged as though somebody had.
--
--   `fence_unreadable` → device_problem. New code, sent by the client when it
--     could not read the fence and so never asked for a position. Named rather
--     than left silent precisely so this case stops arriving as silence.
--
--   NULL → the new 'no_code' class, which is not access_off.
--     A NULL failure alongside a NULL position means the client did not say why
--     there was no reading. That is the app failing to report, not the staff
--     member refusing to be measured, and it is what produced the 2026-09-21
--     rows. The strict reading of silence is what has to go: the server cannot
--     distinguish a client that stayed quiet from a person who denied a
--     permission, and where it cannot tell, it must not pick the accusation.
--
-- What does NOT change: an unrecognised, *non-null* code is still access_off.
-- The reasoning from the original migration holds exactly where it was aimed —
-- a client that can invent a code must not be able to pick its own severity by
-- inventing one. Silence is not an invented code.
CREATE OR REPLACE FUNCTION public.attendance_failure_class(p_failure TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_failure IS NULL OR p_failure = '' THEN 'no_code'
    WHEN p_failure = 'timeout'           THEN 'device_problem'
    WHEN p_failure = 'unavailable'       THEN 'device_problem'
    WHEN p_failure = 'fence_unreadable'  THEN 'device_problem'
    WHEN p_failure = 'permission_denied' THEN 'access_off'
    WHEN p_failure = 'unsupported'       THEN 'access_off'
    ELSE                                      'unknown'
  END;
$$;

-- The verdict for a punch that arrived with no position, given why. Split out
-- of the punch so the rule has one home and can be tested on its own.
--
-- 'access_off' and 'unknown' are the two classes that say something about a
-- choice somebody made. Everything else — a device that could not answer, and
-- a client that did not say — is a device problem, flagged plainly.
CREATE OR REPLACE FUNCTION public.attendance_no_position_verdict(p_failure TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN public.attendance_failure_class(p_failure) IN ('access_off', 'unknown')
      THEN 'location_off'
    ELSE 'device_issue'
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.attendance_no_position_verdict(TEXT) FROM anon;

-- ── 2. The punch ────────────────────────────────────────────────────────────
-- Reproduced in full from the live definition (which is
-- attendance_device_problem_warning.sql §3 as amended by
-- attendance_allow_off_campus_flagged.sql), so the whole decision stays
-- readable in one place, as it was written to be. Exactly one thing differs:
-- the no-position branch now calls attendance_no_position_verdict() instead of
-- inlining a two-way CASE that treated anything not named 'device_problem' as
-- location access being off.

CREATE OR REPLACE FUNCTION public.staff_attendance_punch(
  p_action TEXT,                      -- 'checkin' | 'checkout'
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_accuracy DOUBLE PRECISION DEFAULT NULL,
  p_sample_count INTEGER DEFAULT NULL,
  p_agreeing_count INTEGER DEFAULT NULL,
  p_best_accuracy_m DOUBLE PRECISION DEFAULT NULL,
  p_spread_m DOUBLE PRECISION DEFAULT NULL,
  p_acquisition_ms INTEGER DEFAULT NULL,
  p_coarse_lock BOOLEAN DEFAULT false,
  p_failure TEXT DEFAULT NULL,        -- acquisition failure code, when no fix
  p_user_agent TEXT DEFAULT NULL
) RETURNS TABLE (
  success BOOLEAN,
  error_code TEXT,
  too_soon_ms INTEGER,
  verdict TEXT,
  distance_m DOUBLE PRECISION,
  accuracy_m DOUBLE PRECISION,
  status TEXT,
  punch_slot TEXT,
  marked_half_day BOOLEAN,
  zone_label TEXT,
  radius_m INTEGER,
  attempt_id UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff UUID := auth.uid();
  v_tz TEXT := public.attendance_timezone();
  v_now TIMESTAMPTZ := NOW();
  v_local TIMESTAMP := NOW() AT TIME ZONE v_tz;
  v_date DATE := (NOW() AT TIME ZONE v_tz)::DATE;
  v_exempt BOOLEAN;
  f RECORD;               -- effective fence
  vd RECORD;              -- verdict
  c RECORD;               -- cutoffs
  rec RECORD;             -- today's existing record
  v_verdict TEXT;
  v_distance DOUBLE PRECISION;
  v_signed DOUBLE PRECISION;
  v_margin DOUBLE PRECISION;
  v_passed BOOLEAN;
  v_slot TEXT;
  v_gap_ms INTEGER := 0;
  v_prev TIMESTAMPTZ;
  v_status public.staff_attendance_status;
  v_half_day BOOLEAN := false;
  v_attempt UUID;
  MIN_GAP_MS CONSTANT INTEGER := 5 * 60 * 1000;
BEGIN
  PERFORM set_config('app.attendance_write', 'on', true);

  IF v_staff IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated', 0, NULL::TEXT, NULL::DOUBLE PRECISION,
      NULL::DOUBLE PRECISION, NULL::TEXT, NULL::TEXT, false, NULL::TEXT, NULL::INTEGER, NULL::UUID;
    RETURN;
  END IF;

  IF p_action NOT IN ('checkin','checkout') THEN
    RETURN QUERY SELECT false, 'bad_action', 0, NULL::TEXT, NULL::DOUBLE PRECISION,
      NULL::DOUBLE PRECISION, NULL::TEXT, NULL::TEXT, false, NULL::TEXT, NULL::INTEGER, NULL::UUID;
    RETURN;
  END IF;

  SELECT COALESCE(geofence_exempt, false) INTO v_exempt FROM public.profiles WHERE id = v_staff;
  SELECT * INTO f FROM public.attendance_effective_fence(v_staff);

  -- ── Decide the verdict ────────────────────────────────────────────────────
  IF NOT f.enabled THEN
    v_verdict := 'no_fence';
  ELSIF p_lat IS NULL OR p_lng IS NULL THEN
    -- No fix at all. Which of the two this is depends entirely on *why* there
    -- was no fix — see attendance_no_position_verdict above. The rule that used
    -- to live here read "device_problem, or else location_off", which made
    -- location_off the destination for every answer the server did not
    -- recognise, silence included. Silence now lands on the device-problem side,
    -- because a client that says nothing is evidence about the client.
    --
    -- Note what is deliberately absent: an exemption check. An exemption exists
    -- to waive the fence, and there is no fence result here to waive.
    v_verdict := public.attendance_no_position_verdict(p_failure);
  ELSE
    SELECT * INTO vd FROM public.attendance_location_verdict(
      p_lat, p_lng, p_accuracy, f.shape, f.lat, f.lng, f.radius_m, f.polygon, f.trusted_accuracy_m
    );
    v_verdict  := vd.verdict;
    v_distance := vd.distance_m;
    v_signed   := vd.signed_distance_m;
    v_margin   := vd.margin_m;
    -- Exemption only still overrides 'uncertain' — see
    -- attendance_allow_off_campus_flagged.sql for why 'outside' no longer is.
    IF v_exempt AND v_verdict = 'uncertain' THEN
      v_verdict := 'exempt';
    END IF;
  END IF;

  -- ── Every verdict is written ──────────────────────────────────────────────
  v_passed := CASE
    WHEN v_verdict IN ('inside','uncertain') THEN true
    WHEN v_verdict = 'outside' THEN false
    ELSE NULL
  END;

  -- ── Work out which of the four punch slots this is ────────────────────────
  SELECT * INTO rec FROM public.staff_attendance_records
  WHERE staff_id = v_staff AND date = v_date;

  IF p_action = 'checkin' THEN
    IF rec.check_in_time_2 IS NOT NULL THEN
      RETURN QUERY SELECT false, 'already_complete', 0, v_verdict, v_distance, p_accuracy,
        NULL::TEXT, NULL::TEXT, false, f.zone_label, f.radius_m, NULL::UUID;
      RETURN;
    ELSIF rec.check_in_time IS NOT NULL AND rec.check_out_time IS NOT NULL THEN
      v_slot := 'in2'; v_prev := rec.check_out_time;
    ELSIF rec.check_in_time IS NOT NULL THEN
      RETURN QUERY SELECT false, 'already_checked_in', 0, v_verdict, v_distance, p_accuracy,
        NULL::TEXT, NULL::TEXT, false, f.zone_label, f.radius_m, NULL::UUID;
      RETURN;
    ELSE
      v_slot := 'in'; v_prev := NULL;
    END IF;
  ELSE
    IF rec.check_out_time_2 IS NOT NULL THEN
      RETURN QUERY SELECT false, 'already_complete', 0, v_verdict, v_distance, p_accuracy,
        NULL::TEXT, NULL::TEXT, false, f.zone_label, f.radius_m, NULL::UUID;
      RETURN;
    ELSIF rec.check_in_time_2 IS NOT NULL THEN
      v_slot := 'out2'; v_prev := rec.check_in_time_2;
    ELSIF rec.check_in_time IS NULL THEN
      RETURN QUERY SELECT false, 'not_checked_in', 0, v_verdict, v_distance, p_accuracy,
        NULL::TEXT, NULL::TEXT, false, f.zone_label, f.radius_m, NULL::UUID;
      RETURN;
    ELSIF rec.check_out_time IS NOT NULL THEN
      RETURN QUERY SELECT false, 'already_checked_out', 0, v_verdict, v_distance, p_accuracy,
        NULL::TEXT, NULL::TEXT, false, f.zone_label, f.radius_m, NULL::UUID;
      RETURN;
    ELSE
      v_slot := 'out'; v_prev := rec.check_in_time;
    END IF;
  END IF;

  -- Minimum gap between successive actions, so a misclick cannot immediately
  -- undo the previous punch.
  IF v_prev IS NOT NULL THEN
    v_gap_ms := GREATEST(0, MIN_GAP_MS - (EXTRACT(EPOCH FROM (v_now - v_prev)) * 1000)::INTEGER);
    IF v_gap_ms > 0 THEN
      RETURN QUERY SELECT false, 'too_soon', v_gap_ms, v_verdict, v_distance, p_accuracy,
        NULL::TEXT, v_slot, false, f.zone_label, f.radius_m, NULL::UUID;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO c FROM public.attendance_effective_cutoffs(v_staff, v_date);

  -- ── Write the punch ───────────────────────────────────────────────────────
  IF v_slot = 'in' THEN
    v_status := CASE
      WHEN c.late_cutoff IS NOT NULL
       AND public.attendance_minute_of_day(v_local::TIME)
             > public.attendance_minute_of_day(c.late_cutoff) THEN 'late'
      ELSE 'present'
    END;

    INSERT INTO public.staff_attendance_records (
      staff_id, date, status, check_in_time, check_in_lat, check_in_lng,
      check_in_accuracy, check_in_distance_m, geofence_passed, check_in_verdict
    ) VALUES (
      v_staff, v_date, v_status, v_now, p_lat, p_lng, p_accuracy, v_distance, v_passed, v_verdict
    )
    ON CONFLICT (staff_id, date) DO UPDATE SET
      status = EXCLUDED.status,
      check_in_time = EXCLUDED.check_in_time,
      check_in_lat = EXCLUDED.check_in_lat,
      check_in_lng = EXCLUDED.check_in_lng,
      check_in_accuracy = EXCLUDED.check_in_accuracy,
      check_in_distance_m = EXCLUDED.check_in_distance_m,
      geofence_passed = EXCLUDED.geofence_passed,
      check_in_verdict = EXCLUDED.check_in_verdict;

  ELSIF v_slot = 'out' THEN
    v_half_day := c.checkout_cutoff IS NOT NULL
      AND public.attendance_minute_of_day(v_local::TIME)
            < public.attendance_minute_of_day(c.checkout_cutoff);
    UPDATE public.staff_attendance_records AS r SET
      check_out_time = v_now,
      check_out_lat = p_lat,
      check_out_lng = p_lng,
      check_out_accuracy = p_accuracy,
      check_out_distance_m = v_distance,
      check_out_verdict = v_verdict,
      status = CASE WHEN v_half_day THEN 'half_day'::public.staff_attendance_status ELSE r.status END
    WHERE r.staff_id = v_staff AND r.date = v_date
    RETURNING r.status INTO v_status;

  ELSIF v_slot = 'in2' THEN
    UPDATE public.staff_attendance_records AS r SET
      status = 'e',
      check_in_time_2 = v_now,
      check_in_lat_2 = p_lat,
      check_in_lng_2 = p_lng,
      check_in_accuracy_2 = p_accuracy,
      check_in_distance_m_2 = v_distance,
      check_in_verdict_2 = v_verdict
    WHERE r.staff_id = v_staff AND r.date = v_date
    RETURNING r.status INTO v_status;

  ELSE -- 'out2'
    UPDATE public.staff_attendance_records AS r SET
      check_out_time_2 = v_now,
      check_out_lat_2 = p_lat,
      check_out_lng_2 = p_lng,
      check_out_accuracy_2 = p_accuracy,
      check_out_distance_m_2 = v_distance,
      check_out_verdict_2 = v_verdict
    WHERE r.staff_id = v_staff AND r.date = v_date
    RETURNING r.status INTO v_status;
  END IF;

  INSERT INTO public.attendance_location_attempts (
    staff_id, date, action, lat, lng, accuracy_m, sample_count, agreeing_count,
    best_accuracy_m, spread_m, acquisition_ms, coarse_lock, verdict, distance_m,
    signed_distance_m, margin_m, zone_id, trusted_accuracy_m, accepted, failure, user_agent
  ) VALUES (
    v_staff, v_date, p_action, p_lat, p_lng, p_accuracy, p_sample_count, p_agreeing_count,
    p_best_accuracy_m, p_spread_m, p_acquisition_ms, COALESCE(p_coarse_lock, false), v_verdict,
    v_distance, v_signed, v_margin, f.zone_id, f.trusted_accuracy_m, true, p_failure, p_user_agent
  ) RETURNING id INTO v_attempt;

  RETURN QUERY SELECT true, NULL::TEXT, 0, v_verdict, v_distance, p_accuracy,
    v_status::TEXT, v_slot, v_half_day, f.zone_label, f.radius_m, v_attempt;
END;
$$;

-- ── 3. Repair the records written under the old rule ────────────────────────
--
-- Scope, deliberately narrow: only punches whose telemetry row carries no
-- failure code at all. Those are the ones where nothing was measured and
-- nothing was claimed — the case this migration says must not read as access
-- being off. Rows carrying 'permission_denied' are left exactly as they are:
-- those were real, and several staff have both kinds on different days, so a
-- blanket rewrite of `location_off` would erase true records along with false
-- ones.
--
-- The attempts table is the only place the failure code is kept, so it drives
-- the repair. One attempt exists per (staff, date, action); the slot is matched
-- by which verdict column actually holds 'location_off', and the guard on the
-- count means an ambiguous day (both slots of the same action flagged) is left
-- alone for a human rather than guessed at.

-- 3a. The attendance rows. Done BEFORE the telemetry below, because the
-- telemetry is what identifies them — rewriting it first would erase the very
-- marker this statement selects on. The column guard from
-- gps_attendance_rebuild.sql §8 gates writes to the verdict columns, so this
-- transaction announces itself the same way the punch does.
SELECT set_config('app.attendance_write', 'on', true);

WITH unexplained AS (
  -- (staff, date, action) whose single attempt was a location_off carrying no
  -- failure code — a punch where nothing was measured and nothing was claimed.
  SELECT a.staff_id, a.date, a.action
  FROM public.attendance_location_attempts a
  WHERE a.failure IS NULL
    AND a.verdict = 'location_off'
  GROUP BY a.staff_id, a.date, a.action
  HAVING count(*) = 1
)
UPDATE public.staff_attendance_records r
SET
  check_in_verdict = CASE
    WHEN r.check_in_verdict = 'location_off'
     AND EXISTS (SELECT 1 FROM unexplained u
                 WHERE u.staff_id = r.staff_id AND u.date = r.date AND u.action = 'checkin')
     AND r.check_in_verdict_2 IS DISTINCT FROM 'location_off'
    THEN 'device_issue' ELSE r.check_in_verdict END,
  check_out_verdict = CASE
    WHEN r.check_out_verdict = 'location_off'
     AND EXISTS (SELECT 1 FROM unexplained u
                 WHERE u.staff_id = r.staff_id AND u.date = r.date AND u.action = 'checkout')
     AND r.check_out_verdict_2 IS DISTINCT FROM 'location_off'
    THEN 'device_issue' ELSE r.check_out_verdict END,
  check_in_verdict_2 = CASE
    WHEN r.check_in_verdict_2 = 'location_off'
     AND EXISTS (SELECT 1 FROM unexplained u
                 WHERE u.staff_id = r.staff_id AND u.date = r.date AND u.action = 'checkin')
     AND r.check_in_verdict IS DISTINCT FROM 'location_off'
    THEN 'device_issue' ELSE r.check_in_verdict_2 END,
  check_out_verdict_2 = CASE
    WHEN r.check_out_verdict_2 = 'location_off'
     AND EXISTS (SELECT 1 FROM unexplained u
                 WHERE u.staff_id = r.staff_id AND u.date = r.date AND u.action = 'checkout')
     AND r.check_out_verdict IS DISTINCT FROM 'location_off'
    THEN 'device_issue' ELSE r.check_out_verdict_2 END
WHERE 'location_off' IN (
  r.check_in_verdict, r.check_out_verdict, r.check_in_verdict_2, r.check_out_verdict_2
);

-- 3b. Telemetry, now that 3a has read what it needed from it.
UPDATE public.attendance_location_attempts
SET verdict = 'device_issue'
WHERE verdict = 'location_off'
  AND failure IS NULL;

NOTIFY pgrst, 'reload schema';
