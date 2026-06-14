-- ============================================================
-- Migration: Salary Manager
-- Monthly salary cycles for teaching staff (teacher / coordinator
-- / principal). Generalizes the bus driver payroll pattern:
--   • per-staff base salary config
--   • admin-managed bank accounts
--   • monthly cycle header → one record per staff → line items
--     (positive = bonus/earning, negative = penalty/deduction)
-- Reuses the existing public.payroll_status enum and the
-- update_task_updated_at() trigger + public.get_user_role() helper.
-- Follows the conventions in add_bus_manager.sql.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────
-- Per-staff record status reuses public.payroll_status ('draft','approved','paid').
-- Cycle header gets its own lifecycle.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'salary_cycle_status') THEN
    CREATE TYPE public.salary_cycle_status AS ENUM ('open', 'processing', 'completed');
  END IF;
END$$;

-- ── staff_salary_base ────────────────────────────────────────
-- One row per staff member: their standing monthly base salary.
-- `active` controls whether they are included when a cycle is generated.

CREATE TABLE IF NOT EXISTS public.staff_salary_base (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  base_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.staff_salary_base ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_staff_salary_base_staff ON public.staff_salary_base(staff_id);

DROP TRIGGER IF EXISTS staff_salary_base_updated_at ON public.staff_salary_base;
CREATE TRIGGER staff_salary_base_updated_at
  BEFORE UPDATE ON public.staff_salary_base
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage salary base"
  ON public.staff_salary_base FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Staff views own salary base"
  ON public.staff_salary_base FOR SELECT
  USING (staff_id = auth.uid());

-- ── staff_bank_accounts ──────────────────────────────────────
-- Admin-managed. Staff may read their own row but never write it.

CREATE TABLE IF NOT EXISTS public.staff_bank_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  account_holder_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  ifsc TEXT NOT NULL,
  bank_name TEXT,
  payout_fund_account_id TEXT,  -- provider-side handle (e.g. RazorpayX fund_account); set by integration
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.staff_bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_staff_bank_accounts_staff ON public.staff_bank_accounts(staff_id);

DROP TRIGGER IF EXISTS staff_bank_accounts_updated_at ON public.staff_bank_accounts;
CREATE TRIGGER staff_bank_accounts_updated_at
  BEFORE UPDATE ON public.staff_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage bank accounts"
  ON public.staff_bank_accounts FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Staff views own bank account"
  ON public.staff_bank_accounts FOR SELECT
  USING (staff_id = auth.uid());

-- ── salary_cycles ────────────────────────────────────────────
-- One row per disbursement month.

CREATE TABLE IF NOT EXISTS public.salary_cycles (
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

ALTER TABLE public.salary_cycles ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS salary_cycles_updated_at ON public.salary_cycles;
CREATE TRIGGER salary_cycles_updated_at
  BEFORE UPDATE ON public.salary_cycles
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage salary cycles"
  ON public.salary_cycles FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── salary_records ───────────────────────────────────────────
-- One row per staff member per cycle (generalizes driver_payroll).
-- base_amount is a snapshot of the staff member's base at generation time.

CREATE TABLE IF NOT EXISTS public.salary_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_id UUID REFERENCES public.salary_cycles(id) ON DELETE CASCADE NOT NULL,
  staff_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  base_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status public.payroll_status NOT NULL DEFAULT 'draft',
  payout_status TEXT,      -- null | 'initiated' | 'processed' | 'failed' (provider reconciliation)
  payout_reference TEXT,   -- provider payout id
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cycle_id, staff_id)
);

ALTER TABLE public.salary_records ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_salary_records_staff ON public.salary_records(staff_id);
CREATE INDEX IF NOT EXISTS idx_salary_records_cycle ON public.salary_records(cycle_id);

DROP TRIGGER IF EXISTS salary_records_updated_at ON public.salary_records;
CREATE TRIGGER salary_records_updated_at
  BEFORE UPDATE ON public.salary_records
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage salary records"
  ON public.salary_records FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Staff views own salary record"
  ON public.salary_records FOR SELECT
  USING (staff_id = auth.uid());

-- Staff need to read the cycle header (month/year) for their own records.
-- Scoped: a staff member can see only cycles in which they have a record.
CREATE POLICY "Staff views own cycles"
  ON public.salary_cycles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.salary_records sr
    WHERE sr.cycle_id = id AND sr.staff_id = auth.uid()
  ));

-- Does this salary record belong to the current user? Defined after
-- salary_records exists so the function body validates. Used by the
-- line-items SELECT policy. (Mirrors payroll_belongs_to_me.)
CREATE OR REPLACE FUNCTION public.salary_record_belongs_to_me(p_record UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.salary_records sr
    WHERE sr.id = p_record AND sr.staff_id = auth.uid()
  );
$$;

-- ── salary_record_items ──────────────────────────────────────
-- Positive amount = bonus/earning, negative = penalty/deduction.

CREATE TABLE IF NOT EXISTS public.salary_record_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id UUID REFERENCES public.salary_records(id) ON DELETE CASCADE NOT NULL,
  label TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.salary_record_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_salary_record_items_record ON public.salary_record_items(record_id);

CREATE POLICY "Admin manage salary items"
  ON public.salary_record_items FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Staff views own salary items"
  ON public.salary_record_items FOR SELECT
  USING (public.salary_record_belongs_to_me(record_id));

-- ── generate_salary_cycle ────────────────────────────────────
-- Atomically ensure a cycle exists for (month, year) and create a draft
-- salary_record for every active staff member who does not yet have one,
-- snapshotting their current base_amount. Admin-only. Idempotent: re-running
-- adds records only for newly-active staff. Returns the cycle id and the
-- number of records created.

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
    SELECT v_cycle_id, b.staff_id, b.base_amount, auth.uid()
    FROM public.staff_salary_base b
    JOIN public.profiles p ON p.id = b.staff_id
    WHERE b.active = true
      AND p.role IN ('teacher', 'coordinator', 'principal')
      AND NOT EXISTS (
        SELECT 1 FROM public.salary_records r
        WHERE r.cycle_id = v_cycle_id AND r.staff_id = b.staff_id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created FROM inserted;

  RETURN QUERY SELECT v_cycle_id, v_created;
END;
$$;
