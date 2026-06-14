-- ============================================================
-- Migration: Driver Payroll — monthly cycles (mirror of Salary Manager)
-- Rebuilds the bus driver payroll to match the staff Salary
-- Manager: per-driver base salary, monthly cycles that snapshot
-- a draft record per active driver, line items (bonus/deduction),
-- and provider bank disbursement reconciled by webhook.
--
-- Reuses the existing public.payroll_status ('draft','approved',
-- 'paid') and public.salary_cycle_status ('open','processing',
-- 'completed') enums, the update_task_updated_at() trigger and
-- public.get_user_role() helper. Driver bank accounts live in
-- public.driver_bank_accounts (add_bus_payroll_payouts.sql).
--
-- The earlier per-period public.driver_payroll / driver_payroll_items
-- tables are superseded by these cycle tables and are no longer used
-- by the app. They are left in place (non-destructive); you may drop
-- them once you've confirmed nothing depends on them:
--   -- DROP TABLE IF EXISTS public.driver_payroll_items;
--   -- DROP TABLE IF EXISTS public.driver_payroll;
--
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- Ensure the shared cycle-status enum exists (created by add_salary_manager.sql).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'salary_cycle_status') THEN
    CREATE TYPE public.salary_cycle_status AS ENUM ('open', 'processing', 'completed');
  END IF;
END$$;

-- ── driver_payroll_base ──────────────────────────────────────
-- One row per driver: their standing monthly base salary. `active`
-- controls whether they are included when a cycle is generated.

CREATE TABLE IF NOT EXISTS public.driver_payroll_base (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  base_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.driver_payroll_base ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_driver_payroll_base_driver ON public.driver_payroll_base(driver_id);

DROP TRIGGER IF EXISTS driver_payroll_base_updated_at ON public.driver_payroll_base;
CREATE TRIGGER driver_payroll_base_updated_at
  BEFORE UPDATE ON public.driver_payroll_base
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage driver base"
  ON public.driver_payroll_base FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Driver views own base"
  ON public.driver_payroll_base FOR SELECT
  USING (driver_id = auth.uid());

-- ── driver_payroll_cycles ────────────────────────────────────
-- One row per disbursement month.

CREATE TABLE IF NOT EXISTS public.driver_payroll_cycles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  period_month SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year SMALLINT NOT NULL,
  status public.salary_cycle_status NOT NULL DEFAULT 'open',
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(period_year, period_month)
);

ALTER TABLE public.driver_payroll_cycles ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS driver_payroll_cycles_updated_at ON public.driver_payroll_cycles;
CREATE TRIGGER driver_payroll_cycles_updated_at
  BEFORE UPDATE ON public.driver_payroll_cycles
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage driver cycles"
  ON public.driver_payroll_cycles FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── driver_payroll_records ───────────────────────────────────
-- One row per driver per cycle. base_amount is snapshotted at generation.

CREATE TABLE IF NOT EXISTS public.driver_payroll_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_id UUID REFERENCES public.driver_payroll_cycles(id) ON DELETE CASCADE NOT NULL,
  driver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  base_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status public.payroll_status NOT NULL DEFAULT 'draft',
  payout_status TEXT,      -- null | 'initiated' | 'processed' | 'failed'
  payout_reference TEXT,   -- provider payout id
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cycle_id, driver_id)
);

ALTER TABLE public.driver_payroll_records ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_driver_payroll_records_driver ON public.driver_payroll_records(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_records_cycle ON public.driver_payroll_records(cycle_id);

DROP TRIGGER IF EXISTS driver_payroll_records_updated_at ON public.driver_payroll_records;
CREATE TRIGGER driver_payroll_records_updated_at
  BEFORE UPDATE ON public.driver_payroll_records
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage driver records"
  ON public.driver_payroll_records FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Driver views own record"
  ON public.driver_payroll_records FOR SELECT
  USING (driver_id = auth.uid());

-- Drivers need to read the cycle header (month/year) for their own records.
CREATE POLICY "Driver views own cycles"
  ON public.driver_payroll_cycles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.driver_payroll_records r
    WHERE r.cycle_id = id AND r.driver_id = auth.uid()
  ));

-- Does this record belong to the current user? Used by the items SELECT policy.
CREATE OR REPLACE FUNCTION public.driver_payroll_record_belongs_to_me(p_record UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.driver_payroll_records r
    WHERE r.id = p_record AND r.driver_id = auth.uid()
  );
$$;

-- ── driver_payroll_record_items ──────────────────────────────
-- Positive amount = earning/bonus, negative = deduction/penalty.

CREATE TABLE IF NOT EXISTS public.driver_payroll_record_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id UUID REFERENCES public.driver_payroll_records(id) ON DELETE CASCADE NOT NULL,
  label TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.driver_payroll_record_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_driver_payroll_record_items_record ON public.driver_payroll_record_items(record_id);

CREATE POLICY "Admin manage driver items"
  ON public.driver_payroll_record_items FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Driver views own items"
  ON public.driver_payroll_record_items FOR SELECT
  USING (public.driver_payroll_record_belongs_to_me(record_id));

-- ── generate_driver_payroll_cycle ────────────────────────────
-- Ensure a cycle exists for (month, year) and create a draft record for every
-- active driver who does not yet have one, snapshotting their current base.
-- Admin-only. Idempotent. Returns the cycle id and the number of records made.

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
    SELECT v_cycle_id, b.driver_id, b.base_amount, auth.uid()
    FROM public.driver_payroll_base b
    JOIN public.profiles p ON p.id = b.driver_id
    WHERE b.active = true
      AND p.role = 'driver'
      AND NOT EXISTS (
        SELECT 1 FROM public.driver_payroll_records r
        WHERE r.cycle_id = v_cycle_id AND r.driver_id = b.driver_id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created FROM inserted;

  RETURN QUERY SELECT v_cycle_id, v_created;
END;
$$;

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
