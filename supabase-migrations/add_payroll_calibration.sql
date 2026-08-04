-- ============================================================================
-- add_payroll_calibration  —  PF/ESI/LOP/bonus calibration + simplified cycle
-- status + "show everyone, even without a base salary yet" record generation.
-- ============================================================================
-- Run this in the Supabase SQL Editor. Safe to re-run.
--
-- 1. Cycle status simplification: 'open' / 'processing' / 'completed' becomes
--    just 'open' / 'closed'.
--
--    The status columns are converted from the salary_cycle_status ENUM to a
--    plain TEXT column with a CHECK constraint. Postgres refuses to *use* a
--    newly added enum value in the same transaction that adds it
--    ("unsafe use of new value ... New enum values must be committed before
--    they can be used"), which makes an ALTER TYPE ... ADD VALUE approach
--    impossible to run as one script. Text + CHECK has no such restriction,
--    is trivially re-runnable, and lets the value set change later without
--    another migration dance. The old enum type is left defined but unused.
--
-- 2. Per-cycle payroll settings override (JSONB; null = use the site-wide
--    default from site_settings key 'payroll_calibration').
-- 3. Per-staff/driver PF & ESI calibration on the base-salary config tables.
-- 4. generate_salary_cycle / generate_driver_payroll_cycle now include every
--    eligible staff/driver even if they have no base-salary row yet (base
--    defaults to 0, editable on the cycle page) — only an *existing* row with
--    active=false still excludes someone.

-- ── 1. Cycle status: enum → checked text, and migrate the old values ─────
ALTER TABLE public.salary_cycles          ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.driver_payroll_cycles  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.salary_cycles
  ALTER COLUMN status TYPE TEXT USING status::TEXT;
ALTER TABLE public.driver_payroll_cycles
  ALTER COLUMN status TYPE TEXT USING status::TEXT;

UPDATE public.salary_cycles          SET status = 'open'   WHERE status = 'processing';
UPDATE public.salary_cycles          SET status = 'closed' WHERE status = 'completed';
UPDATE public.driver_payroll_cycles  SET status = 'open'   WHERE status = 'processing';
UPDATE public.driver_payroll_cycles  SET status = 'closed' WHERE status = 'completed';

ALTER TABLE public.salary_cycles          ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE public.driver_payroll_cycles  ALTER COLUMN status SET DEFAULT 'open';

ALTER TABLE public.salary_cycles DROP CONSTRAINT IF EXISTS salary_cycles_status_check;
ALTER TABLE public.salary_cycles
  ADD CONSTRAINT salary_cycles_status_check CHECK (status IN ('open', 'closed'));

ALTER TABLE public.driver_payroll_cycles DROP CONSTRAINT IF EXISTS driver_payroll_cycles_status_check;
ALTER TABLE public.driver_payroll_cycles
  ADD CONSTRAINT driver_payroll_cycles_status_check CHECK (status IN ('open', 'closed'));

-- ── 2. Per-cycle settings override ──────────────────────────────────────
ALTER TABLE public.salary_cycles
  ADD COLUMN IF NOT EXISTS payroll_config JSONB;
ALTER TABLE public.driver_payroll_cycles
  ADD COLUMN IF NOT EXISTS payroll_config JSONB;

-- ── 3. Per-staff/driver PF & ESI calibration ────────────────────────────
-- pf_basic: the PF-wage amount (often lower than gross salary) that
--   employee PF is calculated against — 12% of this, not of gross.
-- pf_applicable: whether this person is enrolled in PF at all.
-- esi_override: null = auto-decide by the site-wide wage ceiling each
--   cycle; true/false = always/never apply ESI regardless of salary
--   (covers the "once enrolled, stays enrolled for the contribution
--   period even if salary later crosses the ceiling" ESI continuity rule).
ALTER TABLE public.staff_salary_base
  ADD COLUMN IF NOT EXISTS pf_basic NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS pf_applicable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS esi_override BOOLEAN;

ALTER TABLE public.driver_payroll_base
  ADD COLUMN IF NOT EXISTS pf_basic NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS pf_applicable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS esi_override BOOLEAN;

-- ── 4. Record generation: include everyone eligible, base defaults to 0 ─
CREATE OR REPLACE FUNCTION public.generate_salary_cycle(p_month SMALLINT, p_year SMALLINT)
RETURNS TABLE (cycle_id UUID, created_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cycle_id UUID;
  v_created INT;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  INSERT INTO public.salary_cycles (period_month, period_year, created_by)
  VALUES (p_month, p_year, auth.uid())
  ON CONFLICT (period_year, period_month) DO UPDATE SET period_month = EXCLUDED.period_month
  RETURNING id INTO v_cycle_id;

  WITH inserted AS (
    INSERT INTO public.salary_records (cycle_id, staff_id, base_amount, created_by)
    SELECT v_cycle_id, p.id, COALESCE(b.base_amount, 0), auth.uid()
    FROM public.profiles p
    LEFT JOIN public.staff_salary_base b ON b.staff_id = p.id
    WHERE p.role IN ('teacher', 'coordinator', 'principal')
      AND (b.id IS NULL OR b.active = true)
      AND NOT EXISTS (
        SELECT 1 FROM public.salary_records r
        WHERE r.cycle_id = v_cycle_id AND r.staff_id = p.id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created FROM inserted;

  RETURN QUERY SELECT v_cycle_id, v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_driver_payroll_cycle(p_month SMALLINT, p_year SMALLINT)
RETURNS TABLE (cycle_id UUID, created_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cycle_id UUID;
  v_created INT;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  INSERT INTO public.driver_payroll_cycles (period_month, period_year, created_by)
  VALUES (p_month, p_year, auth.uid())
  ON CONFLICT (period_year, period_month) DO UPDATE SET period_month = EXCLUDED.period_month
  RETURNING id INTO v_cycle_id;

  WITH inserted AS (
    INSERT INTO public.driver_payroll_records (cycle_id, driver_id, base_amount, created_by)
    SELECT v_cycle_id, p.id, COALESCE(b.base_amount, 0), auth.uid()
    FROM public.profiles p
    LEFT JOIN public.driver_payroll_base b ON b.driver_id = p.id
    WHERE p.role = 'driver'
      AND (b.id IS NULL OR b.active = true)
      AND NOT EXISTS (
        SELECT 1 FROM public.driver_payroll_records r
        WHERE r.cycle_id = v_cycle_id AND r.driver_id = p.id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created FROM inserted;

  RETURN QUERY SELECT v_cycle_id, v_created;
END;
$$;

NOTIFY pgrst, 'reload schema';
