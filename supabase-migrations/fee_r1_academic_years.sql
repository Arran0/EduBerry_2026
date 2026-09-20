-- ============================================================================
-- fee_r1_academic_years — a stored academic year, replacing three guesses
-- ============================================================================
-- Round 1 of docs/fee-upgrade-plan.md. Safe to re-run.
--
-- Before this migration the "current academic year" was computed on the client,
-- three incompatible ways:
--
--   src/lib/fees.ts:94              academicYearOf()   Apr-Mar
--   src/lib/homeroomAutoManage.ts:10 getAcademicYear() Jan-Dec  <- disagrees
--   src/lib/classrooms.ts:1435       start_date.split('-')[0]
--
-- Between January and March those three return different years, so a fee issued
-- in February and the homeroom it was issued against could disagree about which
-- session they belong to. Fees, promotion, carry-forward balances and
-- "collect for a previous year" all need one answer, stored, with explicit
-- start and end dates rather than a rule baked into three different functions.
--
-- The existing TEXT `academic_year` columns are deliberately left in place and
-- still written. This migration only adds an `academic_year_id` FK beside them
-- and backfills it, so nothing outside the fee module changes behaviour until
-- it is ported deliberately.

-- ── academic_years ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academic_years (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,              -- canonical 'YYYY-YY'
  starts_on   DATE NOT NULL,
  ends_on     DATE NOT NULL,
  -- Exactly one year is "the one the app defaults to". Kept as a flag rather
  -- than derived from today's date so a school can close the books late, or
  -- open next year early, without the app arguing with them.
  is_active   BOOLEAN NOT NULL DEFAULT false,
  status      TEXT NOT NULL DEFAULT 'planning'
              CHECK (status IN ('planning', 'active', 'closed')),
  -- Stamped when students were promoted out of this year and opening balances
  -- were carried forward. Round 4 reads it; Round 1 only records it.
  promoted_at TIMESTAMPTZ,
  notes       TEXT,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on > starts_on)
);

-- Two sessions may not cover the same day. Without this a mistyped end date
-- silently makes academic_year_id_for(date) ambiguous.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academic_years_no_overlap'
  ) THEN
    ALTER TABLE public.academic_years
      ADD CONSTRAINT academic_years_no_overlap
      EXCLUDE USING gist (daterange(starts_on, ends_on, '[]') WITH &&);
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_years_one_active
  ON public.academic_years(is_active) WHERE is_active;

DROP TRIGGER IF EXISTS academic_years_touch ON public.academic_years;
CREATE TRIGGER academic_years_touch BEFORE UPDATE ON public.academic_years
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Code normalisation ──────────────────────────────────────────────────
-- The database already holds two spellings of the same session: homerooms say
-- '2026-27', one timetable_configs row says '2026-2027'. Everything that joins
-- on a year code goes through this first.
CREATE OR REPLACE FUNCTION public.normalize_academic_year_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_code IS NULL THEN NULL
    -- 'YYYY-YY' already canonical
    WHEN p_code ~ '^\d{4}-\d{2}$'   THEN p_code
    -- 'YYYY-YYYY' -> 'YYYY-YY'
    WHEN p_code ~ '^\d{4}-\d{4}$'   THEN left(p_code, 5) || right(p_code, 2)
    -- 'YYYY' -> 'YYYY-YY' (assume the session starting that April)
    WHEN p_code ~ '^\d{4}$'         THEN p_code || '-' ||
         lpad(((substring(p_code, 1, 4)::INT + 1) % 100)::TEXT, 2, '0')
    ELSE p_code
  END;
$$;

-- The Apr-Mar rule, in one place, as the *fallback* for a date with no stored
-- year covering it. A stored academic_years row always wins over this.
CREATE OR REPLACE FUNCTION public.academic_year_code_for(p_date DATE)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN EXTRACT(MONTH FROM p_date) >= 4
              THEN EXTRACT(YEAR FROM p_date)::INT
              ELSE EXTRACT(YEAR FROM p_date)::INT - 1
         END::TEXT
      || '-'
      || lpad(((CASE WHEN EXTRACT(MONTH FROM p_date) >= 4
                     THEN EXTRACT(YEAR FROM p_date)::INT
                     ELSE EXTRACT(YEAR FROM p_date)::INT - 1
                END + 1) % 100)::TEXT, 2, '0');
$$;

-- ── Resolution ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_academic_year()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (SELECT code FROM public.academic_years WHERE is_active LIMIT 1),
    public.academic_year_code_for(CURRENT_DATE)
  );
$$;

CREATE OR REPLACE FUNCTION public.current_academic_year_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT id FROM public.academic_years WHERE is_active LIMIT 1;
$$;

-- Which stored session contains this date. Falls back to a code match so a
-- date outside every stored range still resolves if that year exists.
CREATE OR REPLACE FUNCTION public.academic_year_id_for(p_date DATE)
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (SELECT id FROM public.academic_years
      WHERE p_date BETWEEN starts_on AND ends_on LIMIT 1),
    (SELECT id FROM public.academic_years
      WHERE code = public.academic_year_code_for(p_date) LIMIT 1)
  );
$$;

-- ── Creation ────────────────────────────────────────────────────────────
-- Derives Apr 1 -> Mar 31 from the code when dates are not supplied. A school
-- on a different calendar edits the dates afterwards; the constraint above
-- stops them overlapping something else when they do.
CREATE OR REPLACE FUNCTION public.ensure_academic_year(
  p_code      TEXT,
  p_starts_on DATE DEFAULT NULL,
  p_ends_on   DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code  TEXT := public.normalize_academic_year_code(p_code);
  v_start DATE;
  v_end   DATE;
  v_id    UUID;
BEGIN
  IF v_code IS NULL OR v_code !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Unrecognised academic year code: %', p_code;
  END IF;

  SELECT id INTO v_id FROM public.academic_years WHERE code = v_code;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  v_start := COALESCE(p_starts_on, make_date(left(v_code, 4)::INT, 4, 1));
  v_end   := COALESCE(p_ends_on,   make_date(left(v_code, 4)::INT + 1, 3, 31));

  INSERT INTO public.academic_years (code, starts_on, ends_on, status)
  VALUES (v_code, v_start, v_end, 'planning')
  ON CONFLICT (code) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.academic_years WHERE code = v_code;
  END IF;
  RETURN v_id;
END $$;

-- Switching the active year has to clear the old one in the same statement or
-- the partial unique index rejects it. That is the whole reason this is an RPC
-- and not an UPDATE from the client.
CREATE OR REPLACE FUNCTION public.set_active_academic_year(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can change the active academic year';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.academic_years WHERE id = p_id) THEN
    RAISE EXCEPTION 'No such academic year';
  END IF;

  UPDATE public.academic_years
     SET is_active = false,
         status    = CASE WHEN status = 'active' THEN 'closed' ELSE status END
   WHERE is_active AND id <> p_id;

  UPDATE public.academic_years
     SET is_active = true, status = 'active'
   WHERE id = p_id;
END $$;

-- ── Backfill ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_code TEXT;
BEGIN
  -- Every year code already in use anywhere in the database.
  FOR v_code IN
    SELECT DISTINCT public.normalize_academic_year_code(y) AS y FROM (
      SELECT academic_year AS y FROM public.homerooms         WHERE academic_year IS NOT NULL
      UNION SELECT academic_year FROM public.certificates      WHERE academic_year IS NOT NULL
      UNION SELECT academic_year FROM public.timetable_configs WHERE academic_year IS NOT NULL
      UNION SELECT academic_year FROM public.school_fees       WHERE academic_year IS NOT NULL
    ) s
    WHERE public.normalize_academic_year_code(y) ~ '^\d{4}-\d{2}$'
  LOOP
    PERFORM public.ensure_academic_year(v_code);
  END LOOP;

  -- Plus last year, this year and next year, so the pickers are never empty
  -- and "collect for a previous year" has somewhere to land on day one.
  PERFORM public.ensure_academic_year(
    public.academic_year_code_for((CURRENT_DATE - INTERVAL '1 year')::DATE));
  PERFORM public.ensure_academic_year(public.academic_year_code_for(CURRENT_DATE));
  PERFORM public.ensure_academic_year(
    public.academic_year_code_for((CURRENT_DATE + INTERVAL '1 year')::DATE));

  -- Make today's session active if nothing is.
  IF NOT EXISTS (SELECT 1 FROM public.academic_years WHERE is_active) THEN
    UPDATE public.academic_years
       SET is_active = true, status = 'active'
     WHERE code = public.academic_year_code_for(CURRENT_DATE);
  END IF;
END$$;

-- ── FK columns beside the existing TEXT ones ────────────────────────────
ALTER TABLE public.homerooms         ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE SET NULL;
ALTER TABLE public.certificates      ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE SET NULL;
ALTER TABLE public.timetable_configs ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE SET NULL;
ALTER TABLE public.school_fees       ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_homerooms_academic_year_id         ON public.homerooms(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_certificates_academic_year_id      ON public.certificates(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_timetable_configs_academic_year_id ON public.timetable_configs(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_school_fees_academic_year_id       ON public.school_fees(academic_year_id);

UPDATE public.homerooms h SET academic_year_id = y.id
  FROM public.academic_years y
 WHERE h.academic_year_id IS NULL
   AND y.code = public.normalize_academic_year_code(h.academic_year);

UPDATE public.certificates c SET academic_year_id = y.id
  FROM public.academic_years y
 WHERE c.academic_year_id IS NULL
   AND y.code = public.normalize_academic_year_code(c.academic_year);

UPDATE public.timetable_configs t SET academic_year_id = y.id
  FROM public.academic_years y
 WHERE t.academic_year_id IS NULL
   AND y.code = public.normalize_academic_year_code(t.academic_year);

UPDATE public.school_fees f SET academic_year_id = y.id
  FROM public.academic_years y
 WHERE f.academic_year_id IS NULL
   AND y.code = public.normalize_academic_year_code(f.academic_year);

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Every signed-in user reads the year list (the fee card, report cards and the
-- timetable all need to name a session). Only an admin edits it.
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read academic years" ON public.academic_years;
CREATE POLICY "Authenticated read academic years" ON public.academic_years
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin manage academic years" ON public.academic_years;
CREATE POLICY "Admin manage academic years" ON public.academic_years
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── Grants ──────────────────────────────────────────────────────────────
GRANT SELECT ON public.academic_years TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.academic_years TO authenticated;

GRANT EXECUTE ON FUNCTION public.normalize_academic_year_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.academic_year_code_for(DATE)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_academic_year()            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_academic_year_id()         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.academic_year_id_for(DATE)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_academic_year(UUID)     TO authenticated;

-- ensure_academic_year is SECURITY DEFINER and creates rows: server-side and
-- admin RPC only, never reachable from an anonymous PostgREST call.
REVOKE EXECUTE ON FUNCTION public.ensure_academic_year(TEXT, DATE, DATE) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
