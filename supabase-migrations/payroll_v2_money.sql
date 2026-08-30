-- ============================================================================
-- payroll_v2_money — arrears, advances, loans, repayments, leave balances
-- ============================================================================
-- Run after payroll_v2_runs.sql. Safe to re-run.
--
-- One rule shapes every table here: an outstanding balance is NEVER a stored
-- column. It is principal less the sum of recorded repayments, exposed as a
-- view. A stored balance and its repayment history will eventually disagree —
-- a failed run, a manual correction, a double-click — and when they do, nobody
-- can tell which one is lying. Deriving it makes that impossible by
-- construction.

-- ── payroll_arrears ─────────────────────────────────────────────────────
-- Created when a revision is backdated past a locked run. The locked run is
-- never touched; the difference is paid here, with a per-month breakdown.
CREATE TABLE IF NOT EXISTS public.payroll_arrears (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  revision_id UUID REFERENCES public.payroll_revisions(id) ON DELETE SET NULL,
  label       TEXT NOT NULL,
  from_period TEXT NOT NULL,
  to_period   TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL,
  -- [{period, componentCode, was, now, delta}] — what changed, month by month.
  breakdown   JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'paid', 'cancelled')),
  run_id      UUID REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_arrears_emp ON public.payroll_arrears(employee_id, status);

-- ── payroll_advances ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_advances (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason        TEXT,
  recovery_mode TEXT NOT NULL DEFAULT 'single' CHECK (recovery_mode IN ('single', 'emi')),
  emi_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  start_period  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'closed', 'cancelled')),
  sanctioned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sanctioned_on DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── payroll_loans ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_loans (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  principal      NUMERIC(12,2) NOT NULL CHECK (principal > 0),
  interest_rate  NUMERIC(6,3) NOT NULL DEFAULT 0,
  interest_type  TEXT NOT NULL DEFAULT 'none' CHECK (interest_type IN ('none', 'flat', 'reducing')),
  emi_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  tenure_months  INT NOT NULL DEFAULT 12,
  start_period   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'closed', 'written_off')),
  sanctioned_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sanctioned_on  DATE,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_loans_emp ON public.payroll_loans(employee_id, status);

CREATE TABLE IF NOT EXISTS public.payroll_loan_schedule (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id        UUID NOT NULL REFERENCES public.payroll_loans(id) ON DELETE CASCADE,
  period         TEXT NOT NULL,
  emi_due        NUMERIC(12,2) NOT NULL,
  principal_part NUMERIC(12,2) NOT NULL,
  interest_part  NUMERIC(12,2) NOT NULL,
  balance_after  NUMERIC(12,2) NOT NULL,
  UNIQUE (loan_id, period)
);

-- ── payroll_repayments — the only source of truth for what has been repaid ──
CREATE TABLE IF NOT EXISTS public.payroll_repayments (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id        UUID REFERENCES public.payroll_loans(id) ON DELETE CASCADE,
  advance_id     UUID REFERENCES public.payroll_advances(id) ON DELETE CASCADE,
  run_id         UUID REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  amount         NUMERIC(12,2) NOT NULL,
  principal_part NUMERIC(12,2) NOT NULL DEFAULT 0,
  interest_part  NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_on        DATE NOT NULL DEFAULT CURRENT_DATE,
  note           TEXT,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  -- Exactly one of the two, never both and never neither.
  CHECK ((loan_id IS NOT NULL) <> (advance_id IS NOT NULL)),
  -- A payroll run may take at most one instalment per loan. Without this a
  -- retried Calculate would double-recover.
  UNIQUE NULLS NOT DISTINCT (loan_id, run_id),
  UNIQUE NULLS NOT DISTINCT (advance_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_repayments_loan ON public.payroll_repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_payroll_repayments_adv  ON public.payroll_repayments(advance_id);

-- ── Derived outstanding balances ────────────────────────────────────────
CREATE OR REPLACE VIEW public.payroll_loan_balances AS
SELECT
  l.id AS loan_id, l.employee_id, l.label, l.principal, l.emi_amount,
  l.interest_type, l.interest_rate, l.tenure_months, l.start_period, l.status,
  COALESCE(SUM(r.principal_part), 0) AS principal_repaid,
  COALESCE(SUM(r.interest_part), 0)  AS interest_paid,
  l.principal - COALESCE(SUM(r.principal_part), 0) AS outstanding
FROM public.payroll_loans l
LEFT JOIN public.payroll_repayments r ON r.loan_id = l.id
GROUP BY l.id;

CREATE OR REPLACE VIEW public.payroll_advance_balances AS
SELECT
  a.id AS advance_id, a.employee_id, a.label, a.amount, a.emi_amount,
  a.recovery_mode, a.start_period, a.status,
  COALESCE(SUM(r.principal_part), 0) AS repaid,
  a.amount - COALESCE(SUM(r.principal_part), 0) AS outstanding
FROM public.payroll_advances a
LEFT JOIN public.payroll_repayments r ON r.advance_id = a.id
GROUP BY a.id;

-- ── payroll_leave_balances ──────────────────────────────────────────────
-- src/lib/leave.ts currently holds entitlement as two hardcoded constants
-- (casual 12, medical 15) with no carry-forward and no lapse. Leave encashment
-- at full & final cannot be computed from that, so the ledger lives here:
-- opening balance, accrual, used, carried forward, encashed.
CREATE TABLE IF NOT EXISTS public.payroll_leave_balances (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Academic/financial year this ledger covers, e.g. '2026-27'.
  year           TEXT NOT NULL,
  leave_type     TEXT NOT NULL,
  opening        NUMERIC(6,2) NOT NULL DEFAULT 0,
  accrued        NUMERIC(6,2) NOT NULL DEFAULT 0,
  used           NUMERIC(6,2) NOT NULL DEFAULT 0,
  encashed       NUMERIC(6,2) NOT NULL DEFAULT 0,
  lapsed         NUMERIC(6,2) NOT NULL DEFAULT 0,
  carry_forward_cap NUMERIC(6,2),
  encashable     BOOLEAN NOT NULL DEFAULT false,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, year, leave_type)
);

CREATE OR REPLACE VIEW public.payroll_leave_available AS
SELECT employee_id, year, leave_type,
       opening + accrued - used - encashed - lapsed AS available,
       encashable
FROM public.payroll_leave_balances;

-- ── Triggers ────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_arrears','payroll_advances','payroll_loans','payroll_leave_balances'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_task_updated_at()', t, t);
  END LOOP;
END$$;

-- A repayment attached to a locked run is history and cannot be edited away.
CREATE OR REPLACE FUNCTION public.payroll_repayments_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(OLD.run_id, NEW.run_id) IS NOT NULL
     AND public.payroll_run_is_locked(COALESCE(OLD.run_id, NEW.run_id)) THEN
    RAISE EXCEPTION 'This repayment belongs to a locked payroll run and cannot be changed.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS payroll_repayments_immutable ON public.payroll_repayments;
CREATE TRIGGER payroll_repayments_immutable
  BEFORE UPDATE OR DELETE ON public.payroll_repayments
  FOR EACH ROW EXECUTE FUNCTION public.payroll_repayments_guard();

-- ── RLS ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payroll_arrears','payroll_advances','payroll_loans','payroll_loan_schedule',
    'payroll_repayments','payroll_leave_balances'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin manage %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "Admin manage %s" ON public.%I FOR ALL USING (public.get_user_role() = ''admin'') WITH CHECK (public.get_user_role() = ''admin'')',
      t, t);
  END LOOP;
END$$;

-- Employees see their own money: what they owe, what has been recovered, what
-- leave they have. Self-service is most of the point of tracking it properly.
DROP POLICY IF EXISTS "Staff read own arrears" ON public.payroll_arrears;
CREATE POLICY "Staff read own arrears" ON public.payroll_arrears FOR SELECT USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "Staff read own advances" ON public.payroll_advances;
CREATE POLICY "Staff read own advances" ON public.payroll_advances FOR SELECT USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "Staff read own loans" ON public.payroll_loans;
CREATE POLICY "Staff read own loans" ON public.payroll_loans FOR SELECT USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "Staff read own leave balances" ON public.payroll_leave_balances;
CREATE POLICY "Staff read own leave balances" ON public.payroll_leave_balances FOR SELECT USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "Staff read own loan schedule" ON public.payroll_loan_schedule;
CREATE POLICY "Staff read own loan schedule" ON public.payroll_loan_schedule FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.payroll_loans l WHERE l.id = loan_id AND l.employee_id = auth.uid()));

DROP POLICY IF EXISTS "Staff read own repayments" ON public.payroll_repayments;
CREATE POLICY "Staff read own repayments" ON public.payroll_repayments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.payroll_loans l WHERE l.id = loan_id AND l.employee_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.payroll_advances a WHERE a.id = advance_id AND a.employee_id = auth.uid())
  );

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.payroll_loan_balances, public.payroll_advance_balances, public.payroll_leave_available TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
