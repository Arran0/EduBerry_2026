-- ============================================================================
-- Migration: allow a punch through a genuine device problem, flagged
--
-- Problem this addresses
-- ----------------------
-- gps_attendance_rebuild.sql fixed the case where a *coarse* fix was scored as
-- absence. It left one case still blocked outright: the device that produces no
-- fix at all. A phone sat indoors with a cold GNSS receiver streams nothing for
-- the whole 20s budget and the staff member is refused, having done nothing
-- wrong and having nothing they can do about it in the next two minutes. They
-- then go and ask an admin to mark them by hand, which is the same outcome with
-- more steps and no record of why.
--
-- What changes
-- ------------
--   1. A no-fix punch is accepted when the failure is a *device* problem — the
--      receiver never produced a position within the time budget. It is written
--      as a normal punch with the new verdict `device_issue`, and the record
--      carries geofence_passed = NULL (no location check happened, rather than
--      a location check that passed).
--
--   2. A no-fix punch is still refused when the failure is location access
--      being switched off — permission blocked for the site, OS location
--      services off, or a browser with no geolocation at all. That is a choice
--      (or a setting), not a device fault, and the fix for it takes ten seconds
--      in settings. New verdict `location_off` records the refusal so the
--      difference is visible in telemetry rather than collapsed into `no_fix`.
--
--   3. Accepted-but-unverified punches are surfaced as a warning to the staff
--      member and to admins on the attendance report, instead of passing
--      silently. Two verdicts carry that warning:
--        `device_issue`  no position at all — nothing was checked.
--        `uncertain`     a position, too coarse to place them on campus. This
--                        was already accepted (see §6 of the rebuild); it just
--                        was not shown to anybody.
--
-- The honest framing of the new verdict: it does not say the staff member was
-- on campus. It says they asked to be marked present, their device could not
-- answer the question, and that is now on the record where a human can see it.
--
-- Run this in the Supabase SQL Editor, after gps_attendance_rebuild.sql.
-- ============================================================================

-- ── 1. Widen the verdict vocabulary ──────────────────────────────────────────
-- The verdict CHECK constraints were created inline in the rebuild migration,
-- so their names are server-generated. Drop whatever check constraint mentions
-- a verdict column and re-add named ones, so this file is idempotent and does
-- not depend on the generated names.

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN (
        'public.staff_attendance_records'::regclass,
        'public.attendance_location_attempts'::regclass
      )
      AND pg_get_constraintdef(oid) ILIKE '%verdict%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

ALTER TABLE public.staff_attendance_records
  ADD CONSTRAINT staff_attendance_check_in_verdict_valid
    CHECK (check_in_verdict    IN ('inside','outside','uncertain','no_fix','device_issue','location_off','exempt','no_fence')),
  ADD CONSTRAINT staff_attendance_check_out_verdict_valid
    CHECK (check_out_verdict   IN ('inside','outside','uncertain','no_fix','device_issue','location_off','exempt','no_fence')),
  ADD CONSTRAINT staff_attendance_check_in_verdict_2_valid
    CHECK (check_in_verdict_2  IN ('inside','outside','uncertain','no_fix','device_issue','location_off','exempt','no_fence')),
  ADD CONSTRAINT staff_attendance_check_out_verdict_2_valid
    CHECK (check_out_verdict_2 IN ('inside','outside','uncertain','no_fix','device_issue','location_off','exempt','no_fence'));

ALTER TABLE public.attendance_location_attempts
  ADD CONSTRAINT attendance_location_attempts_verdict_valid
    CHECK (verdict IN ('inside','outside','uncertain','no_fix','device_issue','location_off','exempt','no_fence'));

-- ── 2. Which acquisition failures are the device's fault ─────────────────────
--
-- Mirrors FAILURE_CLASS in src/lib/gpsAcquisition.ts. Change one, change both.
--
--   device_problem  the receiver was asked and could not answer in time. The
--                   staff member cannot fix this from where they are standing,
--                   so refusing them punishes them for their hardware.
--   access_off      location was never asked, because the site permission is
--                   blocked, OS location services are off, or the browser has
--                   no geolocation API. Each is a setting, not a fault, and
--                   letting it through would make the geofence opt-out: deny
--                   the permission once and the fence never applies again.
--   unknown         an unrecognised code. Treated as access_off, because a
--                   client that can invent the code decides its own verdict
--                   otherwise, and an unknown failure is not evidence of a
--                   device problem.
CREATE OR REPLACE FUNCTION public.attendance_failure_class(p_failure TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE COALESCE(p_failure, '')
    WHEN 'timeout'           THEN 'device_problem'
    WHEN 'permission_denied' THEN 'access_off'
    WHEN 'unavailable'       THEN 'access_off'
    WHEN 'unsupported'       THEN 'access_off'
    ELSE                          'unknown'
  END;
$$;

-- ── 3. The punch, with the device-problem path ───────────────────────────────
-- Signature and return shape are unchanged from gps_attendance_rebuild.sql, so
-- this is a plain CREATE OR REPLACE; only the verdict branch and the refusal
-- condition differ. The rest is reproduced verbatim rather than patched, since
-- the whole decision needs to be readable in one place.

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
  -- Whether the location check itself came out positive, for the
  -- geofence_passed column. NULL when no check applies (exempt / geofencing
  -- off / no position to check) rather than a misleading true/false.
  v_passed BOOLEAN;
  v_slot TEXT;
  v_gap_ms INTEGER := 0;
  v_prev TIMESTAMPTZ;
  -- Typed as the real enum, not TEXT: staff_attendance_records.status is
  -- `public.staff_attendance_status`, and a plain text value has no implicit
  -- assignment cast onto an enum column.
  v_status public.staff_attendance_status;
  v_half_day BOOLEAN := false;
  v_attempt UUID;
  MIN_GAP_MS CONSTANT INTEGER := 5 * 60 * 1000;
BEGIN
  -- Marks this transaction as an authorised write so the column guard in §8 of
  -- the rebuild migration allows the location and verdict columns to be set.
  -- Transaction-local, and not reachable from a client request.
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
    -- No fix at all. Which of the three outcomes this is depends entirely on
    -- *why* there was no fix — see attendance_failure_class above.
    v_verdict := CASE
      WHEN v_exempt THEN 'exempt'
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
    -- An exemption overrides a refusal, but the real verdict is still recorded
    -- in telemetry below, so an exemption never hides where someone actually was.
    IF v_exempt AND v_verdict IN ('outside','uncertain') THEN
      v_verdict := 'exempt';
    END IF;
  END IF;

  -- ── Decide whether the punch is written ───────────────────────────────────
  -- Refusals are 'outside' (the accuracy disc cannot reach the campus, so the
  -- staff member is demonstrably elsewhere) and 'location_off' (nothing was
  -- measured, because nothing was allowed to measure).
  --
  -- Everything else is written:
  --   'inside'        the ordinary case.
  --   'uncertain'     a reading too coarse to place them in or out. It failed
  --                   to disprove presence exactly as much as it failed to
  --                   prove it, so it is accepted — and now flagged.
  --   'device_issue'  no reading at all, because the receiver could not
  --                   produce one in time. Accepted and flagged.
  -- The verdict is recorded on the row and in telemetry either way, which is
  -- what makes the flag on the report possible.
  IF v_verdict IN ('outside','location_off') THEN
    INSERT INTO public.attendance_location_attempts (
      staff_id, date, action, lat, lng, accuracy_m, sample_count, agreeing_count,
      best_accuracy_m, spread_m, acquisition_ms, coarse_lock, verdict, distance_m,
      signed_distance_m, margin_m, zone_id, trusted_accuracy_m, accepted, failure, user_agent
    ) VALUES (
      v_staff, v_date, p_action, p_lat, p_lng, p_accuracy, p_sample_count, p_agreeing_count,
      p_best_accuracy_m, p_spread_m, p_acquisition_ms, COALESCE(p_coarse_lock, false), v_verdict,
      v_distance, v_signed, v_margin, f.zone_id, f.trusted_accuracy_m, false, p_failure, p_user_agent
    ) RETURNING id INTO v_attempt;

    RETURN QUERY SELECT false,
      CASE WHEN v_verdict = 'location_off' THEN 'location_off' ELSE 'outside_zone' END,
      0, v_verdict, v_distance, p_accuracy, NULL::TEXT, NULL::TEXT,
      false, f.zone_label, f.radius_m, v_attempt;
    RETURN;
  END IF;

  -- true only when a location check actually happened and came out positive.
  -- 'device_issue' gets NULL, the same as an exemption: no check took place.
  v_passed := CASE WHEN v_verdict IN ('inside','uncertain') THEN true ELSE NULL END;

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
  -- Each UPDATE below aliases the table as `r` and qualifies every read of
  -- `status` through it: `status` is also one of this function's RETURNS TABLE
  -- columns, so a bare `status` in an expression or RETURNING list is ambiguous
  -- and Postgres refuses the statement at run time.
  IF v_slot = 'in' THEN
    -- Whole-minute comparison: the cutoff minute is still on time, so a cutoff
    -- of 08:45 marks Late from 08:46:00 onwards. v_local comes from the server
    -- clock in the school timezone — the device never gets a say in this.
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
    -- Mirrors the late comparison: leaving anywhere inside the cutoff minute is
    -- a full day, so only a checkout in an earlier minute is a Half Day.
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

-- ── 4. Finding the flagged days ──────────────────────────────────────────────
-- The report reads whole rows and derives the warning client-side (see
-- describeLocationWarning in src/lib/attendance.ts), but an admin auditing a
-- range wants the flagged rows only. A partial index keeps that scan cheap and
-- costs nothing on the ordinary path, since the great majority of rows carry
-- no warning verdict at all.
CREATE INDEX IF NOT EXISTS idx_staff_attendance_location_warning
  ON public.staff_attendance_records (date DESC, staff_id)
  WHERE check_in_verdict    IN ('uncertain','device_issue')
     OR check_out_verdict   IN ('uncertain','device_issue')
     OR check_in_verdict_2  IN ('uncertain','device_issue')
     OR check_out_verdict_2 IN ('uncertain','device_issue');
