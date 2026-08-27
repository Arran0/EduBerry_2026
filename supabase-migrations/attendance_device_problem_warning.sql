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
--   2. A no-fix punch is ALSO accepted when location access was switched off —
--      site permission blocked, OS location services off, or a browser with no
--      geolocation. New verdict `location_off`.
--
--      This one is a deliberate trade, made with its cost understood, and the
--      cost should be written down rather than discovered later: accepting it
--      makes the geofence opt-out. A staff member who denies the location
--      permission once is never fenced again, and no amount of server logic can
--      distinguish them from a colleague whose browser genuinely refuses. What
--      is bought in return is that the refusal stopped sending people to an
--      admin to be marked by hand — an outcome that was equally unverified and
--      left no trace at all.
--
--      So the whole weight of this rests on the flag being loud. `location_off`
--      is rendered in red, sorted to the top of the day's report, and the staff
--      member is told at the moment they use it that it is reported. If that
--      reporting is ever weakened, this acceptance should be reverted with it.
--
--   3. `uncertain` — a position too coarse to place someone in or out of the
--      fence — stays accepted and is deliberately NOT flagged. It placed the
--      staff member on campus as well as it placed them anywhere, and marking
--      it would put a warning on the record of everyone with a mediocre phone.
--      The flag is reserved for punches where nothing was measured at all.
--
--   4. An exemption no longer masks a missing position. It used to overwrite
--      the verdict with `exempt` whenever there was no fix, which meant an
--      exempt admin checking in with location off recorded no location, no
--      warning, and no trace of why — invisible on the report. Exemption now
--      does what it is for: it overrides the `outside` refusal. It does not
--      pretend a location was checked.
--
-- The honest framing of both new verdicts: neither says the staff member was on
-- campus. They say the staff member asked to be marked present, the question of
-- where they were went unanswered, and that is now on the record in front of a
-- human.
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
-- Both classes are accepted; they differ in how loudly the record says so.
--
--   device_problem  the receiver was asked and could not answer in time. The
--                   staff member cannot fix this from where they are standing,
--                   so this is flagged plainly, not accusingly.
--   access_off      location was never asked, because the site permission is
--                   blocked, OS location services are off, or the browser has
--                   no geolocation API. Each is a setting someone chose, so the
--                   record says so in red and sorts to the top of the report.
--   unknown         an unrecognised code. Treated as access_off — the stricter
--                   of the two — because a client that can invent the code
--                   would otherwise pick its own severity, and an unknown
--                   failure is not evidence of a device problem.
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
    -- No fix at all. Which of the two this is depends entirely on *why* there
    -- was no fix — see attendance_failure_class above.
    --
    -- Note what is deliberately absent: an exemption check. An exemption exists
    -- to waive the fence, and there is no fence result here to waive. Writing
    -- 'exempt' over a missing position (as this used to) recorded an exempt
    -- admin's location-off check-in as if a location had been considered and
    -- excused, which put it on the report as an ordinary punch. Both verdicts
    -- below are accepted anyway, so exempt staff lose nothing by being told the
    -- truth about their own row.
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
    -- An exemption overrides a refusal, but the real verdict is still recorded
    -- in telemetry below, so an exemption never hides where someone actually was.
    IF v_exempt AND v_verdict IN ('outside','uncertain') THEN
      v_verdict := 'exempt';
    END IF;
  END IF;

  -- ── Decide whether the punch is written ───────────────────────────────────
  -- One refusal remains, and it is the only one the evidence actually supports:
  -- 'outside', where the accuracy disc cannot reach the campus at any point, so
  -- the staff member is demonstrably somewhere else. Nothing overrides that but
  -- an explicit exemption, handled above.
  --
  -- Everything else is written:
  --   'inside'        the ordinary case.
  --   'uncertain'     a reading too coarse to place them in or out. It failed
  --                   to disprove presence exactly as much as it failed to
  --                   prove it, so it is accepted — and not flagged.
  --   'device_issue'  no reading, because the receiver could not produce one.
  --                   Accepted, flagged.
  --   'location_off'  no reading, because nothing was allowed to measure.
  --                   Accepted, flagged strictly. See the header.
  -- The verdict is recorded on the row and in telemetry either way, which is
  -- what makes the flag on the report possible.
  IF v_verdict = 'outside' THEN
    INSERT INTO public.attendance_location_attempts (
      staff_id, date, action, lat, lng, accuracy_m, sample_count, agreeing_count,
      best_accuracy_m, spread_m, acquisition_ms, coarse_lock, verdict, distance_m,
      signed_distance_m, margin_m, zone_id, trusted_accuracy_m, accepted, failure, user_agent
    ) VALUES (
      v_staff, v_date, p_action, p_lat, p_lng, p_accuracy, p_sample_count, p_agreeing_count,
      p_best_accuracy_m, p_spread_m, p_acquisition_ms, COALESCE(p_coarse_lock, false), v_verdict,
      v_distance, v_signed, v_margin, f.zone_id, f.trusted_accuracy_m, false, p_failure, p_user_agent
    ) RETURNING id INTO v_attempt;

    RETURN QUERY SELECT false, 'outside_zone',
      0, v_verdict, v_distance, p_accuracy, NULL::TEXT, NULL::TEXT,
      false, f.zone_label, f.radius_m, v_attempt;
    RETURN;
  END IF;

  -- true only when a location check actually happened and came out positive.
  -- 'device_issue' and 'location_off' get NULL, the same as an exemption: no
  -- check took place, and false would imply one did and failed.
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
-- Predicate mirrors LOCATION_WARNING_VERDICTS in src/lib/attendance.ts.
DROP INDEX IF EXISTS idx_staff_attendance_location_warning;
CREATE INDEX idx_staff_attendance_location_warning
  ON public.staff_attendance_records (date DESC, staff_id)
  WHERE check_in_verdict    IN ('location_off','device_issue')
     OR check_out_verdict   IN ('location_off','device_issue')
     OR check_in_verdict_2  IN ('location_off','device_issue')
     OR check_out_verdict_2 IN ('location_off','device_issue');
