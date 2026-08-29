-- ============================================================================
-- payroll_v2_tax_ff — tax declarations and full & final settlements
-- ============================================================================
-- Run after payroll_v2_money.sql. Safe to re-run.

-- ── payroll_tax_declarations ────────────────────────────────────────────
-- One per employee per financial year. `sections` is section code → amount
-- ({"80C": 150000, "80D": 25000}); which of them actually reduce tax depends on
-- the regime, and the engine shows a disallowed claim rather than dropping it,
-- so an employee can see why the new regime ignored their 80C.
CREATE TABLE IF NOT EXISTS public.payroll_tax_declarations (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  regime         TEXT NOT NULL DEFAULT 'new' CHECK (regime IN ('old', 'new')),
  sections       JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_employer JSONB,
  proofs         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'verified', 'rejected')),
  verified_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at    TIMESTAMPTZ,
  rejection_note TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, financial_year)
);

CREATE INDEX IF NOT EXISTS idx_payroll_tax_declarations_fy ON public.payroll_tax_declarations(financial_year, status);

-- ── payroll_ff_settlements ──────────────────────────────────────────────
-- An F&F is a run of run_type = 'ff', so it inherits exceptions, approval, lock
-- and trace like any other. This row holds the exit facts the engine needs.
CREATE TABLE IF NOT EXISTS public.payroll_ff_settlements (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  resignation_date     DATE,
  last_working_day     DATE NOT NULL,
  notice_days_required INT NOT NULL DEFAULT 0,
  notice_days_served   INT NOT NULL DEFAULT 0,
  encashable_leave_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  service_years        NUMERIC(6,2) NOT NULL DEFAULT 0,
  service_days_in_final_year INT NOT NULL DEFAULT 0,
  bonus_eligible_days  INT NOT NULL DEFAULT 0,
  bonus_year_wages     NUMERIC(12,2) NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'computed', 'approved', 'settled', 'cancelled')),
  run_id               UUID REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  computed             JSONB,
  approved_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at          TIMESTAMPTZ,
  notes                TEXT,
  created_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, last_working_day)
);

-- ── payroll_scenarios — saved simulations ───────────────────────────────
-- "What happens if we give all teachers 5%?" run against the real engine and
-- kept so it can be shown to a trust or board without re-running it.
CREATE TABLE IF NOT EXISTS public.payroll_scenarios (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  period_month SMALLINT NOT NULL,
  period_year  SMALLINT NOT NULL,
  scope       JSONB NOT NULL DEFAULT '{}'::jsonb,
  change      JSONB NOT NULL,
  result      JSONB,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_tax_declarations','payroll_ff_settlements','payroll_scenarios'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_task_updated_at()', t, t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin manage %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "Admin manage %s" ON public.%I FOR ALL USING (public.get_user_role() = ''admin'') WITH CHECK (public.get_user_role() = ''admin'')',
      t, t);
  END LOOP;
END$$;

-- The tax declaration is the one payroll object an employee writes themselves —
-- but only while it is still a draft. Once submitted it is the payroll office's
-- to verify, and letting it change underneath them would make verification
-- meaningless.
DROP POLICY IF EXISTS "Staff read own declaration" ON public.payroll_tax_declarations;
CREATE POLICY "Staff read own declaration" ON public.payroll_tax_declarations FOR SELECT
  USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "Staff create own declaration" ON public.payroll_tax_declarations;
CREATE POLICY "Staff create own declaration" ON public.payroll_tax_declarations FOR INSERT
  WITH CHECK (employee_id = auth.uid() AND status IN ('draft', 'submitted'));

DROP POLICY IF EXISTS "Staff update own draft declaration" ON public.payroll_tax_declarations;
CREATE POLICY "Staff update own draft declaration" ON public.payroll_tax_declarations FOR UPDATE
  USING (employee_id = auth.uid() AND status = 'draft')
  WITH CHECK (employee_id = auth.uid() AND status IN ('draft', 'submitted'));

DROP POLICY IF EXISTS "Staff read own settlement" ON public.payroll_ff_settlements;
CREATE POLICY "Staff read own settlement" ON public.payroll_ff_settlements FOR SELECT
  USING (employee_id = auth.uid() AND status IN ('approved', 'settled'));

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
