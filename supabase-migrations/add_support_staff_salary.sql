-- ============================================================================
-- add_support_staff_salary — fold ground-level support staff into payroll.
-- ============================================================================
-- Run after add_support_staff.sql and add_salary_admin_eligibility.sql.
-- Safe to re-run.
--
-- Support staff have no profiles row at all (see add_support_staff.sql for
-- why — no auth account, no login), so they can never be the `staff_id` on
-- salary_records, staff_salary_base or staff_bank_accounts: all three
-- reference public.profiles(id). Rather than fabricating an account just to
-- satisfy that foreign key, this migration:
--
--   * gives support staff their own base-salary and bank-account tables,
--     mirroring staff_salary_base / staff_bank_accounts exactly (same PF/ESI/
--     UAN/EPS columns, so the existing Base Salaries and Bank Accounts sheets
--     need only a third `kind`, not a redesign);
--   * makes salary_records.staff_id nullable and adds a sibling
--     support_staff_id column, with a CHECK that exactly one of the two is
--     set — the standard way to let one table belong to either of two
--     unrelated parents without sacrificing referential integrity;
--   * extends generate_salary_cycle to create a record for active support
--     staff the same way it already does for staff and drivers.
--
-- The app layer treats `staff_id ?? support_staff_id` as "the person this
-- record is about" wherever it looks one up (base salary, bank account,
-- attendance) — see recordPersonId in src/lib/salary.ts.

-- ── support_staff_salary_base ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.support_staff_salary_base (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  support_staff_id UUID REFERENCES public.support_staff(id) ON DELETE CASCADE NOT NULL UNIQUE,
  base_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  pf_basic NUMERIC(10,2),
  pf_applicable BOOLEAN NOT NULL DEFAULT false,
  esi_override BOOLEAN,
  uan TEXT,
  esi_ip_number TEXT,
  eps_applicable BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.support_staff_salary_base ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_support_staff_salary_base_staff ON public.support_staff_salary_base(support_staff_id);

DROP TRIGGER IF EXISTS support_staff_salary_base_updated_at ON public.support_staff_salary_base;
CREATE TRIGGER support_staff_salary_base_updated_at
  BEFORE UPDATE ON public.support_staff_salary_base
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

DROP POLICY IF EXISTS "Admin manage support staff salary base" ON public.support_staff_salary_base;
CREATE POLICY "Admin manage support staff salary base"
  ON public.support_staff_salary_base FOR ALL TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── support_staff_bank_accounts ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.support_staff_bank_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  support_staff_id UUID REFERENCES public.support_staff(id) ON DELETE CASCADE NOT NULL UNIQUE,
  account_holder_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  ifsc TEXT NOT NULL,
  bank_name TEXT,
  payout_fund_account_id TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.support_staff_bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_support_staff_bank_accounts_staff ON public.support_staff_bank_accounts(support_staff_id);

DROP TRIGGER IF EXISTS support_staff_bank_accounts_updated_at ON public.support_staff_bank_accounts;
CREATE TRIGGER support_staff_bank_accounts_updated_at
  BEFORE UPDATE ON public.support_staff_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

DROP POLICY IF EXISTS "Admin manage support staff bank accounts" ON public.support_staff_bank_accounts;
CREATE POLICY "Admin manage support staff bank accounts"
  ON public.support_staff_bank_accounts FOR ALL TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── salary_records: polymorphic person reference ─────────────

ALTER TABLE public.salary_records ALTER COLUMN staff_id DROP NOT NULL;

ALTER TABLE public.salary_records
  ADD COLUMN IF NOT EXISTS support_staff_id UUID REFERENCES public.support_staff(id) ON DELETE CASCADE;

ALTER TABLE public.salary_records DROP CONSTRAINT IF EXISTS salary_records_person_check;
ALTER TABLE public.salary_records ADD CONSTRAINT salary_records_person_check
  CHECK ((staff_id IS NOT NULL) <> (support_staff_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_salary_records_support_staff ON public.salary_records(support_staff_id);

-- The original UNIQUE(cycle_id, staff_id) already leaves support-staff rows
-- alone (every one of them has staff_id NULL, and Postgres treats each NULL
-- as distinct), so it needs no change — but nothing yet stops two records for
-- the same support staff member in one cycle, hence this second index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_records_cycle_support_staff
  ON public.salary_records(cycle_id, support_staff_id) WHERE support_staff_id IS NOT NULL;

-- RLS is untouched: "Admin manage salary records" (FOR ALL) checks the
-- caller's role only, never staff_id, so it already covers support-staff
-- rows. "Staff views own salary record" (staff_id = auth.uid()) simply never
-- matches a support-staff row, which is correct — they have no login to view
-- it from.

-- ── generate_salary_cycle: include support staff ─────────────

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

  WITH candidates AS (
    -- Profile-backed staff, drivers and admins.
    SELECT p.id AS staff_id, NULL::uuid AS support_staff_id,
           COALESCE(sb.base_amount, db.base_amount, 0) AS base_amount
    FROM public.profiles p
    LEFT JOIN public.staff_salary_base   sb ON sb.staff_id  = p.id
    LEFT JOIN public.driver_payroll_base db ON db.driver_id = p.id
    WHERE p.role IN ('teacher', 'coordinator', 'principal', 'admin', 'driver')
      AND (sb.id IS NULL OR sb.active = true)
      AND (db.id IS NULL OR db.active = true)

    UNION ALL

    -- Ground-level support staff — cleaning, maintenance, grounds. No
    -- profile, no login; a base row that is explicitly inactive keeps them
    -- off payroll the same way it does for staff and drivers.
    SELECT NULL::uuid AS staff_id, s.id AS support_staff_id,
           COALESCE(ssb.base_amount, 0) AS base_amount
    FROM public.support_staff s
    LEFT JOIN public.support_staff_salary_base ssb ON ssb.support_staff_id = s.id
    WHERE s.is_active = true
      AND (ssb.id IS NULL OR ssb.active = true)
  ),
  inserted AS (
    INSERT INTO public.salary_records (cycle_id, staff_id, support_staff_id, base_amount, created_by)
    SELECT v_cycle_id, c.staff_id, c.support_staff_id, c.base_amount, auth.uid()
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.salary_records r
      WHERE r.cycle_id = v_cycle_id
        AND r.staff_id IS NOT DISTINCT FROM c.staff_id
        AND r.support_staff_id IS NOT DISTINCT FROM c.support_staff_id
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created FROM inserted;

  RETURN QUERY SELECT v_cycle_id, v_created;
END;
$$;

-- ── Grant access / reload ─────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
