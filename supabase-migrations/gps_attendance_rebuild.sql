-- ============================================================================
-- Migration: staff attendance GPS rebuild
--
-- Problem this addresses
-- ----------------------
-- Around 5% of staff were being refused check-in while physically on campus.
-- The cause was the geofence rule itself, not the hardware: a check-in passed
-- only when `distance <= radius + LEAST(accuracy, 75)`. That treats the device's
-- reported accuracy as a small courtesy tolerance, capped at 75m. But accuracy
-- is not a courtesy — it is the radius of the disc the true position lies in.
-- When a phone falls back to Wi-Fi or cell positioning it reports accuracy in
-- the hundreds of metres and its reported point can land that far from where the
-- person is standing. Compensating for a 400m error with 75m of slack fails
-- people who are stood in the middle of the campus, every single time, on every
-- attempt — which is why it looked like a stable ~5% cohort rather than random
-- noise.
--
-- What changes
-- ------------
--   1. The verdict becomes three-way. `inside` and `outside` keep their meaning;
--      the new `uncertain` covers a reading too coarse to tell the difference.
--      Previously there was nowhere to put "don't know", so it was scored as
--      "not here" and the staff member was blocked.
--   2. `uncertain` no longer blocks. It is accepted the same as `inside` — the
--      reading failed to disprove presence just as much as it failed to prove
--      it, so nobody loses attendance because of their phone. The verdict is
--      still recorded for the diagnostics panel.
--   3. The verdict is computed here, on the server, from the raw coordinates.
--      It used to be computed in the browser, which meant the client both
--      decided whether it passed and reported that decision — as did the
--      minimum-gap enforcement and the late/half-day cutoffs.
--   4. Every attempt is logged, accepted or not, so the accuracy threshold can
--      be tuned against real data instead of guesswork.
--   5. Fences may be a campus outline, not only a circle. A circle big enough to
--      cover an L-shaped site necessarily also covers the road outside it.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- ── 0. Geofence zone tables, in case add_geofence_zones.sql was never run ────
-- This migration's group-zone support builds on attendance_geofence_zones,
-- which was added in a separate, optional migration (schools that never used
-- named zones — a second campus, an annexe — never had a reason to run it). It
-- is created here too, identically and idempotently, so this migration doesn't
-- depend on knowing whether that one was applied.

CREATE TABLE IF NOT EXISTS public.attendance_geofence_zones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL DEFAULT 'Zone',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 200,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.attendance_geofence_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view geofence zones" ON public.attendance_geofence_zones;
CREATE POLICY "Anyone can view geofence zones"
  ON public.attendance_geofence_zones FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin can manage geofence zones" ON public.attendance_geofence_zones;
CREATE POLICY "Admin can manage geofence zones"
  ON public.attendance_geofence_zones FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE TABLE IF NOT EXISTS public.attendance_geofence_zone_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  zone_id UUID NOT NULL REFERENCES public.attendance_geofence_zones(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (zone_id, staff_id)
);

-- One zone per staff member — a staff member can't be checked against two
-- centre points at once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_geofence_zone_members_one_zone
  ON public.attendance_geofence_zone_members(staff_id);

CREATE INDEX IF NOT EXISTS idx_attendance_geofence_zone_members_zone
  ON public.attendance_geofence_zone_members(zone_id);

ALTER TABLE public.attendance_geofence_zone_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view geofence zone members" ON public.attendance_geofence_zone_members;
CREATE POLICY "Anyone can view geofence zone members"
  ON public.attendance_geofence_zone_members FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin can manage geofence zone members" ON public.attendance_geofence_zone_members;
CREATE POLICY "Admin can manage geofence zone members"
  ON public.attendance_geofence_zone_members FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── 1. Fence shape: campus outlines alongside circles ────────────────────────

ALTER TABLE public.attendance_geofence_zones
  ADD COLUMN IF NOT EXISTS shape TEXT NOT NULL DEFAULT 'circle'
    CHECK (shape IN ('circle', 'polygon')),
  -- [{"lat": .., "lng": ..}, ...] in order around the campus outline. When
  -- shape='polygon', radius_m is reused as an outward buffer on that outline, so
  -- an outline traced along the buildings still admits someone at the door.
  ADD COLUMN IF NOT EXISTS polygon JSONB,
  -- Per-zone override of the accuracy above which a reading stops being trusted
  -- on its own. NULL falls back to the school-wide setting.
  ADD COLUMN IF NOT EXISTS trusted_accuracy_m INTEGER;

-- The school-wide fence lives in site_settings->'geofence' as JSON and needs no
-- DDL. It gains the same optional keys:
--   shape: 'circle' | 'polygon'
--   polygon: [{lat,lng}, ...]
--   trusted_accuracy_m: integer, default 100 — internal only, not admin-
--     configurable; used purely to label a reading 'inside' vs 'uncertain'
--     in the diagnostics panel. Both are accepted either way (see §6).

-- ── 2. Verdict on the attendance record ───────────────────────────────────────
-- Recorded per punch for the diagnostics panel. There is no coordinator review
-- queue: an 'uncertain' verdict is accepted the same as 'inside' (see §6), so
-- these columns are informational only and never gate anything.

ALTER TABLE public.staff_attendance_records
  ADD COLUMN IF NOT EXISTS check_in_verdict    TEXT CHECK (check_in_verdict    IN ('inside','outside','uncertain','no_fix','exempt','no_fence')),
  ADD COLUMN IF NOT EXISTS check_out_verdict   TEXT CHECK (check_out_verdict   IN ('inside','outside','uncertain','no_fix','exempt','no_fence')),
  ADD COLUMN IF NOT EXISTS check_in_verdict_2  TEXT CHECK (check_in_verdict_2  IN ('inside','outside','uncertain','no_fix','exempt','no_fence')),
  ADD COLUMN IF NOT EXISTS check_out_verdict_2 TEXT CHECK (check_out_verdict_2 IN ('inside','outside','uncertain','no_fix','exempt','no_fence'));

-- A coordinator-review queue was dropped from the design before it saw any
-- real data — drop the columns it needed, if an earlier version of this
-- migration already created them.
DROP INDEX IF EXISTS idx_staff_attendance_pending_review;
ALTER TABLE public.staff_attendance_records
  DROP COLUMN IF EXISTS review_state,
  DROP COLUMN IF EXISTS review_note,
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS reviewed_at;

-- ── 3. Attempt telemetry ─────────────────────────────────────────────────────
-- Every acquisition attempt lands here, accepted or refused. Without this there
-- is no way to answer "who is failing, how often, and at what accuracy" — which
-- is the question that should have driven the original threshold and didn't.

CREATE TABLE IF NOT EXISTS public.attendance_location_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('checkin','checkout')),

  -- What the device reported (fused across the sample stream).
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  accuracy_m DOUBLE PRECISION,
  -- Cross-checks on the reported accuracy: how many samples arrived, how many
  -- agreed with each other, the best single accuracy, and how far apart the
  -- agreeing samples were. A tight reported accuracy with a wide spread is a
  -- device overstating its confidence.
  sample_count INTEGER,
  agreeing_count INTEGER,
  best_accuracy_m DOUBLE PRECISION,
  spread_m DOUBLE PRECISION,
  acquisition_ms INTEGER,
  coarse_lock BOOLEAN NOT NULL DEFAULT false,

  -- What the server decided, and the numbers behind it.
  verdict TEXT NOT NULL CHECK (verdict IN ('inside','outside','uncertain','no_fix','exempt','no_fence')),
  distance_m DOUBLE PRECISION,
  signed_distance_m DOUBLE PRECISION,
  margin_m DOUBLE PRECISION,
  zone_id UUID REFERENCES public.attendance_geofence_zones(id) ON DELETE SET NULL,
  trusted_accuracy_m INTEGER,

  -- Whether the punch was written, and how the attempt was resolved.
  accepted BOOLEAN NOT NULL DEFAULT false,
  failure TEXT,
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_location_attempts_staff_date
  ON public.attendance_location_attempts(staff_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_location_attempts_date
  ON public.attendance_location_attempts(date DESC);
CREATE INDEX IF NOT EXISTS idx_location_attempts_verdict
  ON public.attendance_location_attempts(verdict, date DESC);

ALTER TABLE public.attendance_location_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view own location attempts" ON public.attendance_location_attempts;
CREATE POLICY "Staff can view own location attempts"
  ON public.attendance_location_attempts FOR SELECT
  USING (staff_id = auth.uid() OR public.get_user_role() IN ('admin','principal','coordinator'));

-- Rows are written only by the SECURITY DEFINER punch function below, never by
-- clients directly — otherwise the telemetry could be authored by the same party
-- it exists to audit.
DROP POLICY IF EXISTS "No direct writes to location attempts" ON public.attendance_location_attempts;
CREATE POLICY "No direct writes to location attempts"
  ON public.attendance_location_attempts FOR INSERT
  WITH CHECK (false);

-- ── 4. Geometry ──────────────────────────────────────────────────────────────
-- Mirrors src/lib/geofence.ts exactly. Kept in plain PL/pgSQL rather than
-- PostGIS so the migration has no extension prerequisite; at campus scale a
-- local equirectangular projection is accurate to well under a metre, which is
-- two orders of magnitude below the GPS error being reasoned about.

CREATE OR REPLACE FUNCTION public.attendance_haversine_m(
  lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
      sin(radians(lat2 - lat1) / 2) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  ));
$$;

/**
 * Signed distance from a point to a polygon boundary, in metres.
 * Negative inside the outline, positive outside.
 */
CREATE OR REPLACE FUNCTION public.attendance_polygon_signed_distance_m(
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_polygon JSONB
) RETURNS DOUBLE PRECISION
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n INTEGER;
  ref_lat DOUBLE PRECISION;
  ref_lng DOUBLE PRECISION;
  xs DOUBLE PRECISION[];
  ys DOUBLE PRECISION[];
  px DOUBLE PRECISION;
  py DOUBLE PRECISION;
  i INTEGER;
  j INTEGER;
  -- Named prev_/cur_ rather than a/b: `by` is a reserved word and cannot be
  -- used as a PL/pgSQL variable.
  prev_x DOUBLE PRECISION; prev_y DOUBLE PRECISION;
  cur_x DOUBLE PRECISION;  cur_y DOUBLE PRECISION;
  dx DOUBLE PRECISION; dy DOUBLE PRECISION;
  len_sq DOUBLE PRECISION;
  t DOUBLE PRECISION;
  d DOUBLE PRECISION;
  nearest DOUBLE PRECISION := 1e18;
  inside BOOLEAN := false;
BEGIN
  n := jsonb_array_length(p_polygon);
  IF n IS NULL OR n < 3 THEN RETURN NULL; END IF;

  SELECT avg((v->>'lat')::DOUBLE PRECISION), avg((v->>'lng')::DOUBLE PRECISION)
    INTO ref_lat, ref_lng
  FROM jsonb_array_elements(p_polygon) v;

  -- Project vertices to metres east/north of the outline's centroid.
  SELECT array_agg(radians((v->>'lng')::DOUBLE PRECISION - ref_lng)
                   * cos(radians(((v->>'lat')::DOUBLE PRECISION + ref_lat) / 2)) * 6371000
                   ORDER BY ord),
         array_agg(radians((v->>'lat')::DOUBLE PRECISION - ref_lat) * 6371000
                   ORDER BY ord)
    INTO xs, ys
  -- Aliased `elem` rather than `t`, which is already a local variable here and
  -- would make any reference to it ambiguous.
  FROM jsonb_array_elements(p_polygon) WITH ORDINALITY AS elem(v, ord);

  px := radians(p_lng - ref_lng) * cos(radians((p_lat + ref_lat) / 2)) * 6371000;
  py := radians(p_lat - ref_lat) * 6371000;

  j := n;
  FOR i IN 1..n LOOP
    prev_x := xs[j]; prev_y := ys[j];
    cur_x  := xs[i]; cur_y  := ys[i];

    -- Nearest distance to this edge.
    dx := cur_x - prev_x; dy := cur_y - prev_y;
    len_sq := dx * dx + dy * dy;
    IF len_sq = 0 THEN
      d := sqrt((px - prev_x) ^ 2 + (py - prev_y) ^ 2);
    ELSE
      t := ((px - prev_x) * dx + (py - prev_y) * dy) / len_sq;
      t := greatest(0, least(1, t));
      d := sqrt((px - (prev_x + t * dx)) ^ 2 + (py - (prev_y + t * dy)) ^ 2);
    END IF;
    nearest := least(nearest, d);

    -- Ray cast for containment.
    IF ((cur_y > py) <> (prev_y > py))
       AND (px < (prev_x - cur_x) * (py - cur_y) / (prev_y - cur_y) + cur_x) THEN
      inside := NOT inside;
    END IF;

    j := i;
  END LOOP;

  RETURN CASE WHEN inside THEN -nearest ELSE nearest END;
END;
$$;

-- ── 5. Effective fence and cutoffs for one staff member ──────────────────────

/**
 * The fence a given staff member is checked against: their zone if they are in
 * one, otherwise the school-wide centre. `enabled` always comes from the
 * school-wide config so the master switch keeps working for everyone.
 */
-- Postgres refuses CREATE OR REPLACE across a changed return type, and an
-- earlier version of this migration returned an extra review_uncertain
-- column — drop it first so re-running this file on a database that already
-- has that version doesn't fail.
DROP FUNCTION IF EXISTS public.attendance_effective_fence(UUID);

CREATE OR REPLACE FUNCTION public.attendance_effective_fence(p_staff_id UUID)
RETURNS TABLE (
  enabled BOOLEAN,
  shape TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  radius_m INTEGER,
  polygon JSONB,
  trusted_accuracy_m INTEGER,
  zone_id UUID,
  zone_label TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg JSONB;
  z RECORD;
  site_trusted INTEGER;
BEGIN
  SELECT value INTO cfg FROM public.site_settings WHERE key = 'geofence';
  cfg := COALESCE(cfg, '{}'::JSONB);
  site_trusted := COALESCE((cfg->>'trusted_accuracy_m')::INTEGER, 100);

  SELECT gz.* INTO z
  FROM public.attendance_geofence_zone_members m
  JOIN public.attendance_geofence_zones gz ON gz.id = m.zone_id
  WHERE m.staff_id = p_staff_id
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      COALESCE((cfg->>'enabled')::BOOLEAN, false),
      z.shape,
      z.lat,
      z.lng,
      z.radius_m,
      z.polygon,
      COALESCE(z.trusted_accuracy_m, site_trusted),
      z.id,
      z.label;
  ELSE
    RETURN QUERY SELECT
      COALESCE((cfg->>'enabled')::BOOLEAN, false),
      COALESCE(cfg->>'shape', 'circle'),
      (cfg->>'lat')::DOUBLE PRECISION,
      (cfg->>'lng')::DOUBLE PRECISION,
      COALESCE((cfg->>'radius_m')::INTEGER, 200),
      cfg->'polygon',
      site_trusted,
      NULL::UUID,
      NULL::TEXT;
  END IF;
END;
$$;

/**
 * The verdict, computed server-side from raw coordinates.
 *
 * The rules, and why each exists:
 *   signed - accuracy >  0  the accuracy disc cannot reach the fence at all, so
 *                           the staff member is genuinely elsewhere. True even
 *                           for a very coarse reading — a disc whose nearest
 *                           edge is still kilometres away proves absence
 *                           regardless of how imprecise it is.
 *   signed + accuracy <= 0  the disc lies wholly inside the fence; the reading
 *                           is not consistent with being anywhere else.
 *   overlapping, precise    accept — this is the ordinary case.
 *   overlapping, coarse     genuinely unknown. A 900m disc overlaps half the
 *                           town, so the overlap carries almost no information.
 *                           This is the case that used to be scored as absence.
 */
CREATE OR REPLACE FUNCTION public.attendance_location_verdict(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_accuracy DOUBLE PRECISION,
  p_shape TEXT,
  p_fence_lat DOUBLE PRECISION,
  p_fence_lng DOUBLE PRECISION,
  p_radius_m INTEGER,
  p_polygon JSONB,
  p_trusted_accuracy_m INTEGER
) RETURNS TABLE (
  verdict TEXT,
  signed_distance_m DOUBLE PRECISION,
  distance_m DOUBLE PRECISION,
  margin_m DOUBLE PRECISION
)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  signed DOUBLE PRECISION;
  acc DOUBLE PRECISION := GREATEST(0, COALESCE(p_accuracy, 0));
  trusted INTEGER := COALESCE(p_trusted_accuracy_m, 100);
BEGIN
  IF p_shape = 'polygon' AND p_polygon IS NOT NULL AND jsonb_array_length(p_polygon) >= 3 THEN
    signed := public.attendance_polygon_signed_distance_m(p_lat, p_lng, p_polygon) - COALESCE(p_radius_m, 0);
  ELSIF p_fence_lat IS NOT NULL AND p_fence_lng IS NOT NULL THEN
    signed := public.attendance_haversine_m(p_lat, p_lng, p_fence_lat, p_fence_lng) - COALESCE(p_radius_m, 200);
  ELSE
    RETURN QUERY SELECT 'no_fence'::TEXT, NULL::DOUBLE PRECISION, NULL::DOUBLE PRECISION, NULL::DOUBLE PRECISION;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    CASE
      WHEN signed > acc            THEN 'outside'
      WHEN signed + acc <= 0       THEN 'inside'
      WHEN acc <= trusted          THEN 'inside'
      ELSE                              'uncertain'
    END::TEXT,
    signed,
    abs(signed),
    acc - signed;
END;
$$;

/**
 * Effective late / checkout cutoffs for one staff member on one date.
 * Priority mirrors fetchEffectiveCutoffsForStaff():
 *   exact-date team override > exact-date everyone > weekday team > weekday
 *   everyone > the school-wide attendance_config.
 *
 * This moved server-side along with the verdict: the cutoffs decide whether a
 * check-in is Late and whether a checkout is a Half Day, so leaving them on the
 * client left the client scoring its own punctuality.
 */
CREATE OR REPLACE FUNCTION public.attendance_effective_cutoffs(
  p_staff_id UUID, p_date DATE
) RETURNS TABLE (late_cutoff TIME, checkout_cutoff TIME)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  dow INTEGER := EXTRACT(DOW FROM p_date)::INTEGER;
  r RECORD;
  cfg JSONB;
BEGIN
  SELECT t.late_cutoff, t.checkout_cutoff INTO r
  FROM public.attendance_day_timings t
  WHERE NOT t.is_default
    AND ((t.scope_type = 'date'    AND t.scope_date    = p_date)
      OR (t.scope_type = 'weekday' AND t.scope_weekday = dow))
    AND EXISTS (
      SELECT 1 FROM public.attendance_day_timing_members m
      WHERE m.timing_id = t.id AND m.staff_id = p_staff_id
    )
  -- Exact-date rules outrank recurring weekday rules.
  ORDER BY (t.scope_type = 'date') DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT t.late_cutoff, t.checkout_cutoff INTO r
    FROM public.attendance_day_timings t
    WHERE t.is_default
      AND ((t.scope_type = 'date'    AND t.scope_date    = p_date)
        OR (t.scope_type = 'weekday' AND t.scope_weekday = dow))
    ORDER BY (t.scope_type = 'date') DESC
    LIMIT 1;
  END IF;

  IF FOUND THEN
    RETURN QUERY SELECT r.late_cutoff::TIME, r.checkout_cutoff::TIME;
    RETURN;
  END IF;

  SELECT value INTO cfg FROM public.site_settings WHERE key = 'attendance_config';
  RETURN QUERY SELECT
    NULLIF(COALESCE(cfg, '{}'::JSONB)->>'late_cutoff', '')::TIME,
    NULLIF(COALESCE(cfg, '{}'::JSONB)->>'checkout_cutoff', '')::TIME;
END;
$$;

/**
 * The school's local timezone, used for the date a punch belongs to and for
 * comparing against the late / checkout cutoffs.
 *
 * Previously the date came from `serverNow.toISOString().split('T')[0]` — a UTC
 * date — while the cutoff comparison used the *browser's* local hours. Those two
 * disagree with each other, and the second is device-controlled. Both now read
 * this one setting. Override it with:
 *   UPDATE site_settings SET value = value || '{"timezone":"Asia/Kolkata"}'
 *   WHERE key = 'attendance_config';
 */
CREATE OR REPLACE FUNCTION public.attendance_timezone()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF((SELECT value->>'timezone' FROM public.site_settings WHERE key = 'attendance_config'), ''),
    'Asia/Kolkata'
  );
$$;

-- ── 6. The authoritative punch ───────────────────────────────────────────────

/**
 * Records a check-in or check-out.
 *
 * Everything that decides the outcome now happens here: the caller's identity
 * (auth.uid(), never a client-supplied id), the clock, the geofence verdict, the
 * minimum gap between actions, and the late / half-day derivation. The client
 * supplies only raw sensor readings, which is the one thing it is actually the
 * authority on.
 *
 * Returns a single row describing what happened, so the UI can explain the
 * outcome without recomputing any of it.
 */
-- Same reasoning as attendance_effective_fence above: an earlier version of
-- this function returned an extra review_state column, and Postgres won't
-- CREATE OR REPLACE across a changed return type.
DROP FUNCTION IF EXISTS public.staff_attendance_punch(
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER,
  DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, BOOLEAN, TEXT, TEXT
);

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
  -- off) rather than a misleading true/false.
  v_passed BOOLEAN;
  v_slot TEXT;
  v_gap_ms INTEGER := 0;
  v_prev TIMESTAMPTZ;
  -- Typed as the real enum, not TEXT: staff_attendance_records.status is
  -- `public.staff_attendance_status`, and a plain text value has no implicit
  -- assignment cast onto an enum column — assigning through a same-typed
  -- variable here does that conversion once, correctly, instead of failing
  -- at the INSERT/UPDATE with "column is of type ... but expression is of
  -- type text".
  v_status public.staff_attendance_status;
  v_half_day BOOLEAN := false;
  v_attempt UUID;
  MIN_GAP_MS CONSTANT INTEGER := 5 * 60 * 1000;
BEGIN
  -- Marks this transaction as an authorised write so the column guard in §8
  -- allows the location and verdict columns to be set. Transaction-local, and
  -- not reachable from a client request.
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
    -- No fix at all. Exempt staff proceed; everyone else is refused, since a
    -- missing reading is not evidence of anything.
    v_verdict := CASE WHEN v_exempt THEN 'exempt' ELSE 'no_fix' END;
  ELSE
    SELECT * INTO vd FROM public.attendance_location_verdict(
      p_lat, p_lng, p_accuracy, f.shape, f.lat, f.lng, f.radius_m, f.polygon, f.trusted_accuracy_m
    );
    v_verdict  := vd.verdict;
    v_distance := vd.distance_m;
    v_signed   := vd.signed_distance_m;
    v_margin   := vd.margin_m;
    -- An exemption overrides a refusal, but the real verdict is still recorded
    -- in telemetry above, so an exemption never hides where someone actually was.
    IF v_exempt AND v_verdict IN ('outside','uncertain') THEN
      v_verdict := 'exempt';
    END IF;
  END IF;

  -- ── Decide whether the punch is written ───────────────────────────────────
  -- Only 'outside' and 'no_fix' are refusals. 'uncertain' — a reading too
  -- coarse to place the disc wholly in or wholly out — is accepted the same
  -- as 'inside': there is no coordinator queue here, so a reading that fails
  -- to disprove presence is treated as presence. The verdict is still
  -- recorded on the row and in telemetry, so this remains visible in the
  -- diagnostics panel even though it no longer blocks or escalates anyone.
  IF v_verdict = 'outside' OR v_verdict = 'no_fix' THEN
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
      CASE WHEN v_verdict = 'no_fix' THEN 'no_fix' ELSE 'outside_zone' END,
      0, v_verdict, v_distance, p_accuracy, NULL::TEXT, NULL::TEXT,
      false, f.zone_label, f.radius_m, v_attempt;
    RETURN;
  END IF;

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
  -- undo the previous punch. Enforced here rather than in the UI, where it was
  -- only ever a disabled button.
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
  -- `status` through it. `status` is also one of this function's RETURNS TABLE
  -- columns, which PL/pgSQL exposes as a variable of the same name — so a bare
  -- `status` in an expression or a RETURNING list is ambiguous and Postgres
  -- refuses the statement outright ("column reference "status" is ambiguous").
  -- That is a runtime error raised when the branch first executes, not at
  -- creation time, which is why check-in (whose only `status` reads are a SET
  -- target and a qualified EXCLUDED.status) worked while every checkout and
  -- permission-break punch failed.
  IF v_slot = 'in' THEN
    v_status := CASE
      WHEN c.late_cutoff IS NOT NULL AND v_local::TIME > c.late_cutoff THEN 'late'
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
    v_half_day := c.checkout_cutoff IS NOT NULL AND v_local::TIME < c.checkout_cutoff;
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

-- ── 7. No coordinator review queue ────────────────────────────────────────────
-- An earlier version of this migration routed 'uncertain' readings to a
-- coordinator confirmation queue via this function. That step was dropped
-- before it ever saw real data — 'uncertain' is now accepted outright (§6) —
-- so this drops the function if an earlier run of this file created it.

DROP FUNCTION IF EXISTS public.resolve_attendance_review(UUID, DATE, BOOLEAN, TEXT);

-- ── 8. Stop the write path being bypassed ────────────────────────────────────
--
-- Moving the verdict into the database only helps if the database is the only
-- way in. It isn't yet: the "Staff can update own attendance" policy grants
-- UPDATE on the whole row, and that policy exists for a good reason — staff
-- correct their own status (present → half day, and so on). But the same grant
-- also lets a staff member PATCH their own row directly against the REST API
-- and set check_in_time, geofence_passed, or check_in_verdict by hand. The
-- anon key is in the client bundle, so this needs no special access — just curl.
--
-- Rather than withdraw the policy and break the legitimate edit, the columns
-- that record *what the sensors and the server concluded* are fenced off from
-- the person they describe. Staff keep full control of their own status; nobody
-- gets to author their own evidence.

CREATE OR REPLACE FUNCTION public.guard_attendance_location_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Set only by the SECURITY DEFINER functions above, and transaction-local, so
  -- it cannot be turned on from a client request.
  IF COALESCE(current_setting('app.attendance_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Managers editing someone else's record are already trusted to mark
  -- attendance outright; this guard is about self-authored evidence.
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
     OR NEW.check_out_lat   IS DISTINCT FROM OLD.check_out_lat
     OR NEW.check_out_lng   IS DISTINCT FROM OLD.check_out_lng
     OR NEW.check_out_accuracy IS DISTINCT FROM OLD.check_out_accuracy
     OR NEW.check_in_lat_2  IS DISTINCT FROM OLD.check_in_lat_2
     OR NEW.check_in_lng_2  IS DISTINCT FROM OLD.check_in_lng_2
     OR NEW.check_in_accuracy_2 IS DISTINCT FROM OLD.check_in_accuracy_2
     OR NEW.check_out_lat_2 IS DISTINCT FROM OLD.check_out_lat_2
     OR NEW.check_out_lng_2 IS DISTINCT FROM OLD.check_out_lng_2
     OR NEW.check_out_accuracy_2 IS DISTINCT FROM OLD.check_out_accuracy_2
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

DROP TRIGGER IF EXISTS guard_attendance_location_columns ON public.staff_attendance_records;
CREATE TRIGGER guard_attendance_location_columns
  BEFORE INSERT OR UPDATE ON public.staff_attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_location_columns();

-- ── 9. Grants / reload ───────────────────────────────────────────────────────

GRANT SELECT ON public.attendance_location_attempts TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_effective_fence(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_effective_cutoffs(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_timezone() TO authenticated;

NOTIFY pgrst, 'reload schema';
