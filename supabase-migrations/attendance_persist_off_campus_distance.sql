-- ============================================================================
-- Migration: persist the distance behind an off-campus flag
-- ============================================================================
--
-- Why this is needed
-- -------------------
-- The report can already say a punch was recorded "off campus" (verdict
-- 'outside', from attendance_allow_off_campus_flagged.sql), but not by how
-- much. That number existed only for the instant of the punch — in the
-- confirmation prompt the staff member saw, built from the live client-side
-- evaluation — and was then discarded. attendance_location_attempts keeps it
-- in telemetry, but that table is not what the report reads, and is not
-- something every admin has reason to go digging through for one row. The
-- distance is exactly the fact an admin reviewing a flagged day needs first:
-- fifteen metres past the gate reads completely differently from four
-- kilometres away, and the report could not previously tell those apart.
--
-- What changes
-- ------------
--   1. Four new columns on staff_attendance_records, mirroring the existing
--      accuracy columns one-for-one: check_in_distance_m, check_out_distance_m,
--      check_in_distance_m_2, check_out_distance_m_2. Each holds the unsigned
--      distance in metres from the fence boundary at that punch — the same
--      number attendance_location_verdict already computes and the confirm
--      dialog already showed, now written to the row instead of thrown away.
--      Populated whenever a location check actually ran (any verdict from
--      attendance_location_verdict, not only 'outside'); NULL wherever no
--      check happened at all (device_issue, location_off, exempt, no_fence).
--
--   2. staff_attendance_punch writes v_distance into the new column in each of
--      the four punch slots, alongside the accuracy and verdict it already
--      wrote. No change to the function's signature or return shape.
--
--   3. guard_attendance_location_columns() is extended to protect the four new
--      columns the same way it protects lat/lng/accuracy/verdict: a distance
--      is exactly the kind of self-authored evidence §8 of
--      gps_attendance_rebuild.sql was written to keep off the direct REST
--      path. A column that can carry "how far away you were" is a column a
--      dishonest client would love to set to zero.
--
-- On "fairly inside the boundary plus the predicted error, don't flag it" —
-- this migration does not change that: it was already the definition of
-- 'outside' before this file existed. attendance_location_verdict() only
-- returns 'outside' when `signed - accuracy > 0` — the accuracy disc's
-- *nearest* possible point is still past the fence boundary. A reading 5m past
-- the boundary with 50m of reported accuracy fails that test (5 - 50 < 0) and
-- comes back 'inside' or 'uncertain', not 'outside' — there is no code path
-- where a plausibly-on-campus reading reaches the flag. This migration only
-- adds a number to what was already a considered decision.
--
-- Run this in the Supabase SQL Editor, after attendance_allow_off_campus_flagged.sql.
-- ============================================================================

-- ── 1. New columns ────────────────────────────────────────────────────────────

ALTER TABLE public.staff_attendance_records
  ADD COLUMN IF NOT EXISTS check_in_distance_m    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_out_distance_m   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_in_distance_m_2  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_out_distance_m_2 DOUBLE PRECISION;

COMMENT ON COLUMN public.staff_attendance_records.check_in_distance_m IS
  'Unsigned metres from the fence boundary at check-in, when a location check ran. NULL when no check happened (device/location-off/exempt/no-fence).';
COMMENT ON COLUMN public.staff_attendance_records.check_out_distance_m IS
  'Same as check_in_distance_m, for check-out.';
COMMENT ON COLUMN public.staff_attendance_records.check_in_distance_m_2 IS
  'Same as check_in_distance_m, for the return check-in of a permission break.';
COMMENT ON COLUMN public.staff_attendance_records.check_out_distance_m_2 IS
  'Same as check_in_distance_m, for the final check-out of a permission break.';

-- ── 2. Guard the new columns the same way the existing ones are guarded ──────

CREATE OR REPLACE FUNCTION public.guard_attendance_location_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('app.attendance_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.staff_id <> auth.uid() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.check_in_time IS NOT NULL OR NEW.check_out_time IS NOT NULL
       OR NEW.check_in_time_2 IS NOT NULL OR NEW.check_out_time_2 IS NOT NULL
       OR NEW.geofence_passed IS NOT NULL THEN
      RAISE EXCEPTION 'Check-in times and location results can only be set by checking in';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.check_in_time      IS DISTINCT FROM OLD.check_in_time
     OR NEW.check_out_time  IS DISTINCT FROM OLD.check_out_time
     OR NEW.check_in_time_2 IS DISTINCT FROM OLD.check_in_time_2
     OR NEW.check_out_time_2 IS DISTINCT FROM OLD.check_out_time_2
     OR NEW.check_in_lat    IS DISTINCT FROM OLD.check_in_lat
     OR NEW.check_in_lng    IS DISTINCT FROM OLD.check_in_lng
     OR NEW.check_in_accuracy IS DISTINCT FROM OLD.check_in_accuracy
     OR NEW.check_in_distance_m IS DISTINCT FROM OLD.check_in_distance_m
     OR NEW.check_out_lat   IS DISTINCT FROM OLD.check_out_lat
     OR NEW.check_out_lng   IS DISTINCT FROM OLD.check_out_lng
     OR NEW.check_out_accuracy IS DISTINCT FROM OLD.check_out_accuracy
     OR NEW.check_out_distance_m IS DISTINCT FROM OLD.check_out_distance_m
     OR NEW.check_in_lat_2  IS DISTINCT FROM OLD.check_in_lat_2
     OR NEW.check_in_lng_2  IS DISTINCT FROM OLD.check_in_lng_2
     OR NEW.check_in_accuracy_2 IS DISTINCT FROM OLD.check_in_accuracy_2
     OR NEW.check_in_distance_m_2 IS DISTINCT FROM OLD.check_in_distance_m_2
     OR NEW.check_out_lat_2 IS DISTINCT FROM OLD.check_out_lat_2
     OR NEW.check_out_lng_2 IS DISTINCT FROM OLD.check_out_lng_2
     OR NEW.check_out_accuracy_2 IS DISTINCT FROM OLD.check_out_accuracy_2
     OR NEW.check_out_distance_m_2 IS DISTINCT FROM OLD.check_out_distance_m_2
     OR NEW.geofence_passed IS DISTINCT FROM OLD.geofence_passed
     OR NEW.check_in_verdict IS DISTINCT FROM OLD.check_in_verdict
     OR NEW.check_out_verdict IS DISTINCT FROM OLD.check_out_verdict
     OR NEW.check_in_verdict_2 IS DISTINCT FROM OLD.check_in_verdict_2
     OR NEW.check_out_verdict_2 IS DISTINCT FROM OLD.check_out_verdict_2 THEN
    RAISE EXCEPTION 'Location results cannot be changed on your own record';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Write the distance in each punch slot ──────────────────────────────────
-- Same signature and return shape as attendance_allow_off_campus_flagged.sql;
-- only the INSERT/UPDATE column lists gain the new distance column.

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

REVOKE ALL ON FUNCTION public.staff_attendance_punch(
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER,
  DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, BOOLEAN, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_attendance_punch(
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER,
  DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, BOOLEAN, TEXT, TEXT
) TO authenticated;
