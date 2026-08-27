-- ============================================================================
-- Migration: allow marking attendance off campus, flagged — the last refusal
-- ============================================================================
--
-- Where this leaves the geofence
-- -------------------------------
-- After gps_attendance_rebuild.sql and attendance_device_problem_warning.sql,
-- 'outside' was the one location verdict still refused: every other outcome
-- (a coarse fix, no fix, location switched off) was already accepted. That
-- made 'outside' an odd one out, and a punishing one — a teacher fifteen
-- metres past the gate with a precise fix was blocked, while a colleague who
-- denied the location permission outright got waved through with a warning.
-- Better evidence was punished harder than no evidence at all.
--
-- This migration removes that last refusal. From here, the geofence decides
-- nothing about whether a punch is written — only whether the row carries a
-- "location not verified" flag. Every location-based outcome is now advisory.
-- What used to be enforcement is now reporting, in full, on every row.
--
-- That is a real trade, and it should be named rather than discovered later:
-- there is no longer any location signal that blocks a punch, at any distance.
-- The entire weight of "was this person actually on campus" now rests on the
-- flag being visible on the report — which is also true of location_off, and
-- has held up the same way since that migration.
--
-- What changes
-- ------------
--   1. The refusal branch for v_verdict = 'outside' is removed from
--      staff_attendance_punch(). An off-campus reading is written like any
--      other, carrying verdict 'outside' on the row.
--
--   2. 'outside' joins the flagged set, alongside 'location_off' and
--      'device_issue'. Unlike those two, this is a case where a location WAS
--      measured — precisely, in many cases — and it placed the person away
--      from campus. That is the strongest evidence of the three that
--      something is wrong, so it is flagged strict (red, sorted first) same
--      as location_off, ahead of the merely unmeasured device_issue.
--
--   3. geofence_passed on the row can now be genuinely false, not only NULL.
--      Previously the column only ever recorded true (a check passed) or NULL
--      (no check happened, because none was possible or one was waived) —
--      false was never reachable, since a failing check was always refused
--      before it could be written. Now it means exactly what its name says: a
--      check happened, and it did not pass.
--
--   4. The exemption path is unchanged and still matters: an exempt staff
--      member reading as 'outside' still becomes verdict 'exempt', not
--      'outside'. Their being off campus is what the exemption is for, not a
--      thing to flag.
--
-- Run this in the Supabase SQL Editor, after attendance_device_problem_warning.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.staff_attendance_punch(
  p_action TEXT,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_accuracy DOUBLE PRECISION DEFAULT NULL,
  p_sample_count INTEGER DEFAULT NULL,
  p_agreeing_count INTEGER DEFAULT NULL,
  p_best_accuracy_m DOUBLE PRECISION DEFAULT NULL,
  p_spread_m DOUBLE PRECISION DEFAULT NULL,
  p_acquisition_ms INTEGER DEFAULT NULL,
  p_coarse_lock BOOLEAN DEFAULT false,
  p_failure TEXT DEFAULT NULL,
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
  f RECORD;
  vd RECORD;
  c RECORD;
  rec RECORD;
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
    v_verdict := CASE
      WHEN public.attendance_failure_class(p_failure) = 'device_problem' THEN 'device_issue'
      ELSE 'location_off'
    END;
  ELSE
    SELECT * INTO vd FROM public.attendance_location_verdict(
      p_lat, p_lng, p_accuracy, f.shape, f.lat, f.lng, f.radius_m, f.polygon, f.trusted_accuracy_m
    );
    v_verdict  := vd.verdict;
    v_distance := vd.distance_m;
    v_signed   := vd.signed_distance_m;
    v_margin   := vd.margin_m;
    -- An exemption still overrides both a coarse reading and an off-campus
    -- one. Being away from campus is exactly what the exemption waives, so it
    -- is not something to record as unverified on an exempt staff member's row.
    IF v_exempt AND v_verdict IN ('outside','uncertain') THEN
      v_verdict := 'exempt';
    END IF;
  END IF;

  -- ── Every verdict is written ──────────────────────────────────────────────
  -- Nothing about location refuses the punch any more. 'outside' — the last
  -- verdict that did — is now accepted and flagged the same way 'location_off'
  -- and 'device_issue' already are, and for the same reason: refusing someone
  -- outright, on evidence a device produced, moved the problem to an admin's
  -- desk instead of solving it, and did so invisibly. The flag on the row is
  -- what makes this accountable instead of silent — see the migration header.
  --
  --   'inside'        the ordinary case. geofence_passed = true.
  --   'uncertain'     too coarse to place them in or out. Accepted, not
  --                   flagged — it failed to disprove presence as much as it
  --                   failed to prove it. geofence_passed = true.
  --   'outside'       a reading that placed them away from campus. Accepted,
  --                   flagged strict. geofence_passed = false — a check
  --                   happened and did not pass, which the column can now say
  --                   for the first time.
  --   'device_issue'  no reading at all; the device could not produce one.
  --                   Accepted, flagged. geofence_passed = NULL: no check
  --                   happened.
  --   'location_off'  no reading, because nothing was allowed to measure.
  --                   Accepted, flagged strict. geofence_passed = NULL.
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
      check_in_accuracy, geofence_passed, check_in_verdict
    ) VALUES (
      v_staff, v_date, v_status, v_now, p_lat, p_lng, p_accuracy, v_passed, v_verdict
    )
    ON CONFLICT (staff_id, date) DO UPDATE SET
      status = EXCLUDED.status,
      check_in_time = EXCLUDED.check_in_time,
      check_in_lat = EXCLUDED.check_in_lat,
      check_in_lng = EXCLUDED.check_in_lng,
      check_in_accuracy = EXCLUDED.check_in_accuracy,
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
      check_in_verdict_2 = v_verdict
    WHERE r.staff_id = v_staff AND r.date = v_date
    RETURNING r.status INTO v_status;

  ELSE -- 'out2'
    UPDATE public.staff_attendance_records AS r SET
      check_out_time_2 = v_now,
      check_out_lat_2 = p_lat,
      check_out_lng_2 = p_lng,
      check_out_accuracy_2 = p_accuracy,
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

REVOKE ALL ON FUNCTION public.staff_attendance_punch(
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER,
  DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, BOOLEAN, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_attendance_punch(
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER,
  DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, BOOLEAN, TEXT, TEXT
) TO authenticated;

-- ── Index the newly-flagged verdict too ──────────────────────────────────────
-- Predicate mirrors LOCATION_WARNING_VERDICTS in src/lib/attendance.ts.
DROP INDEX IF EXISTS idx_staff_attendance_location_warning;
CREATE INDEX idx_staff_attendance_location_warning
  ON public.staff_attendance_records (date DESC, staff_id)
  WHERE check_in_verdict    IN ('location_off','device_issue','outside')
     OR check_out_verdict   IN ('location_off','device_issue','outside')
     OR check_in_verdict_2  IN ('location_off','device_issue','outside')
     OR check_out_verdict_2 IN ('location_off','device_issue','outside');
