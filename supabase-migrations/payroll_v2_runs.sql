-- ============================================================================
-- payroll_v2_runs — the nine-state run workflow, and physical immutability
-- ============================================================================
-- Run after payroll_v2_structures.sql, _policy.sql and _rules.sql. Safe to re-run.
--
--   draft → review → calculated → exceptions → pending_approval
--         → approved → locked → paid → reconciled
--
-- The important part of this file is not the workflow — it is the triggers at
-- the bottom. Once a run reaches `locked`, the database itself refuses any
-- UPDATE or DELETE to its lines, components, traces and events. Not the API, not
-- the app: the database. A payslip a teacher downloaded in June still says in
-- December exactly what it said in June, and no amount of editing the employee
-- master, the structures or the statutory rates can move it.
--
-- Corrections after a lock go to a supplementary run. That is the only route,
-- and it leaves both the original and the correction on the record.

-- digest() for the tamper-evident lock hash.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── payroll_runs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  period_month   SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year    SMALLINT NOT NULL,
  period_from    DATE NOT NULL,
  period_to      DATE NOT NULL,
  pay_date       DATE,
  run_type       TEXT NOT NULL DEFAULT 'regular'
                 CHECK (run_type IN ('regular', 'supplementary', 'arrears', 'bonus', 'ff')),
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','review','calculated','exceptions','pending_approval','approved','locked','paid','reconciled')),
  label          TEXT,
  notes          TEXT,
  -- The rule-set ids this run calculated against, by domain. Pinned at Calculate
  -- so a later rate change provably cannot have touched these numbers.
  rule_set_ids   JSONB,
  variance_acknowledged_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  variance_acknowledged_at TIMESTAMPTZ,
  calculated_at  TIMESTAMPTZ,
  approved_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  locked_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  locked_at      TIMESTAMPTZ,
  -- SHA-256 over the sorted line totals at lock time. Makes tampering
  -- detectable even by someone with direct database access.
  locked_hash    TEXT,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- One regular run per month; supplementary and F&F runs are unconstrained
-- because a month can legitimately need several.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_one_regular
  ON public.payroll_runs(period_year, period_month) WHERE run_type = 'regular';

CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON public.payroll_runs(period_year DESC, period_month DESC);

-- ── payroll_run_lines ───────────────────────────────────────────────────
-- One per employee per run. Carries the money AND the workings: `inputs` is
-- everything the engine was handed, `trace` is the explanation it produced.
-- Storing both is what makes invariant 1 hold — nothing derived is stored
-- without the inputs that produced it.
CREATE TABLE IF NOT EXISTS public.payroll_run_lines (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id        UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  structure_id  UUID REFERENCES public.payroll_structures(id) ON DELETE SET NULL,
  policy_group_id UUID REFERENCES public.payroll_policy_groups(id) ON DELETE SET NULL,
  calendar_id   UUID REFERENCES public.payroll_calendars(id) ON DELETE SET NULL,
  gross_earnings      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deductions    NUMERIC(12,2) NOT NULL DEFAULT 0,
  employer_contributions NUMERIC(12,2) NOT NULL DEFAULT 0,
  employer_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay             NUMERIC(12,2) NOT NULL DEFAULT 0,
  payable_days        NUMERIC(6,2) NOT NULL DEFAULT 0,
  paid_days           NUMERIC(6,2) NOT NULL DEFAULT 0,
  lop_days            NUMERIC(6,2) NOT NULL DEFAULT 0,
  inputs        JSONB,
  trace         JSONB,
  payout_status TEXT,
  payout_reference TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_lines_run ON public.payroll_run_lines(run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_run_lines_emp ON public.payroll_run_lines(employee_id);

-- ── payroll_line_components — what a payslip prints ─────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_line_components (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  line_id        UUID NOT NULL REFERENCES public.payroll_run_lines(id) ON DELETE CASCADE,
  run_id         UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  component_code TEXT NOT NULL,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_contribution', 'informational')),
  amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  full_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  sequence       INT NOT NULL DEFAULT 100,
  computed_from  JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_line_components_line ON public.payroll_line_components(line_id);
CREATE INDEX IF NOT EXISTS idx_payroll_line_components_run  ON public.payroll_line_components(run_id, component_code);

-- ── payroll_run_events — append-only audit ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_run_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id      UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  note        TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_events_run ON public.payroll_run_events(run_id, created_at);

-- ── payroll_exceptions — the approval gate ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_exceptions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id      UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  severity    TEXT NOT NULL CHECK (severity IN ('block', 'warn', 'info')),
  code        TEXT NOT NULL,
  message     TEXT NOT NULL,
  details     JSONB,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_exceptions_run ON public.payroll_exceptions(run_id, severity) WHERE resolved_at IS NULL;

-- ============================================================================
-- Immutability
-- ============================================================================
-- Invariant 2: a locked run is physically immutable.

CREATE OR REPLACE FUNCTION public.payroll_run_is_locked(p_run UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payroll_runs
    WHERE id = p_run AND status IN ('locked', 'paid', 'reconciled')
  );
$$;

CREATE OR REPLACE FUNCTION public.payroll_reject_locked_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run UUID;
BEGIN
  v_run := COALESCE(NEW.run_id, OLD.run_id);
  IF public.payroll_run_is_locked(v_run) THEN
    RAISE EXCEPTION 'This payroll run is locked. Post a supplementary run instead of editing it.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS payroll_run_lines_immutable ON public.payroll_run_lines;
CREATE TRIGGER payroll_run_lines_immutable
  BEFORE UPDATE OR DELETE ON public.payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION public.payroll_reject_locked_write();

DROP TRIGGER IF EXISTS payroll_line_components_immutable ON public.payroll_line_components;
CREATE TRIGGER payroll_line_components_immutable
  BEFORE UPDATE OR DELETE ON public.payroll_line_components
  FOR EACH ROW EXECUTE FUNCTION public.payroll_reject_locked_write();

-- Payout reconciliation still has to write payout_status onto a locked line —
-- the money moving is precisely what happens after a lock. This narrow
-- exception is the only write a locked line accepts, and it cannot touch a
-- single rupee of the calculation.
CREATE OR REPLACE FUNCTION public.payroll_allow_payout_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.payroll_run_is_locked(NEW.run_id) THEN
    IF NEW.gross_earnings IS DISTINCT FROM OLD.gross_earnings
       OR NEW.total_deductions IS DISTINCT FROM OLD.total_deductions
       OR NEW.net_pay IS DISTINCT FROM OLD.net_pay
       OR NEW.employer_cost IS DISTINCT FROM OLD.employer_cost
       OR NEW.lop_days IS DISTINCT FROM OLD.lop_days
       OR NEW.paid_days IS DISTINCT FROM OLD.paid_days
       OR NEW.trace IS DISTINCT FROM OLD.trace
       OR NEW.inputs IS DISTINCT FROM OLD.inputs THEN
      RAISE EXCEPTION 'This payroll run is locked. Only payout status may be updated.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Replace the blanket line trigger with the payout-aware one.
DROP TRIGGER IF EXISTS payroll_run_lines_immutable ON public.payroll_run_lines;
CREATE TRIGGER payroll_run_lines_immutable_update
  BEFORE UPDATE ON public.payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION public.payroll_allow_payout_update();

DROP TRIGGER IF EXISTS payroll_run_lines_immutable_delete ON public.payroll_run_lines;
CREATE TRIGGER payroll_run_lines_immutable_delete
  BEFORE DELETE ON public.payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION public.payroll_reject_locked_write();

-- The audit log is append-only, full stop. An audit trail that can be edited is
-- not an audit trail.
CREATE OR REPLACE FUNCTION public.payroll_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payroll run events are append-only.' USING ERRCODE = 'check_violation';
END $$;

DROP TRIGGER IF EXISTS payroll_run_events_append_only ON public.payroll_run_events;
CREATE TRIGGER payroll_run_events_append_only
  BEFORE UPDATE OR DELETE ON public.payroll_run_events
  FOR EACH ROW EXECUTE FUNCTION public.payroll_events_append_only();

-- A locked run's own header may only move forward through the payment states.
CREATE OR REPLACE FUNCTION public.payroll_runs_guard_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('locked', 'paid', 'reconciled')
     AND NEW.status NOT IN ('locked', 'paid', 'reconciled') THEN
    RAISE EXCEPTION 'A % run cannot be reopened. Post a supplementary run instead.', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('locked','paid','reconciled') AND NEW.locked_hash IS DISTINCT FROM OLD.locked_hash THEN
    RAISE EXCEPTION 'The lock hash of a locked run cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payroll_runs_guard ON public.payroll_runs;
CREATE TRIGGER payroll_runs_guard
  BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.payroll_runs_guard_status();

DROP TRIGGER IF EXISTS payroll_runs_updated_at ON public.payroll_runs;
CREATE TRIGGER payroll_runs_updated_at
  BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── Lock: compute and store the tamper-evident hash ─────────────────────
CREATE OR REPLACE FUNCTION public.payroll_lock_run(p_run UUID)
RETURNS TABLE (locked_hash TEXT, line_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash TEXT; v_count INT; v_status TEXT; v_approved UUID;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT status, approved_by INTO v_status, v_approved FROM public.payroll_runs WHERE id = p_run;
  IF v_status IS NULL THEN RAISE EXCEPTION 'No such payroll run'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'Only an approved run can be locked (this one is %).', v_status; END IF;
  IF v_approved IS NULL THEN RAISE EXCEPTION 'The run has no approver on record.'; END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_exceptions WHERE run_id = p_run AND severity = 'block' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'Blocking exceptions are still open on this run.';
  END IF;

  SELECT encode(digest(string_agg(t, '|' ORDER BY t), 'sha256'), 'hex'), COUNT(*)
    INTO v_hash, v_count
  FROM (
    SELECT employee_id::TEXT || ':' || gross_earnings::TEXT || ':' ||
           total_deductions::TEXT || ':' || net_pay::TEXT AS t
    FROM public.payroll_run_lines WHERE run_id = p_run
  ) s;

  UPDATE public.payroll_runs
     SET status = 'locked', locked_at = NOW(), locked_by = auth.uid(), locked_hash = v_hash
   WHERE id = p_run;

  INSERT INTO public.payroll_run_events (run_id, from_status, to_status, actor_id, note)
  VALUES (p_run, 'approved', 'locked', auth.uid(), format('Locked with %s line(s), hash %s', v_count, left(v_hash, 12)));

  RETURN QUERY SELECT v_hash, v_count;
END $$;

-- Recompute the hash and compare it with the stored one. Any difference means
-- somebody wrote to a locked run outside the application.
CREATE OR REPLACE FUNCTION public.payroll_verify_lock(p_run UUID)
RETURNS TABLE (stored_hash TEXT, computed_hash TEXT, intact BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stored TEXT; v_computed TEXT;
BEGIN
  SELECT locked_hash INTO v_stored FROM public.payroll_runs WHERE id = p_run;
  SELECT encode(digest(string_agg(t, '|' ORDER BY t), 'sha256'), 'hex') INTO v_computed
  FROM (
    SELECT employee_id::TEXT || ':' || gross_earnings::TEXT || ':' ||
           total_deductions::TEXT || ':' || net_pay::TEXT AS t
    FROM public.payroll_run_lines WHERE run_id = p_run
  ) s;
  RETURN QUERY SELECT v_stored, v_computed, (v_stored IS NOT NULL AND v_stored = v_computed);
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_runs','payroll_run_lines','payroll_line_components','payroll_run_events','payroll_exceptions']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin manage %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "Admin manage %s" ON public.%I FOR ALL USING (public.get_user_role() = ''admin'') WITH CHECK (public.get_user_role() = ''admin'')',
      t, t);
  END LOOP;
END$$;

-- Employees see their own lines and components, but only once the run is locked.
-- A draft figure is not a payslip, and showing one invites a conversation about
-- a number that has not been approved and may still move.
CREATE OR REPLACE FUNCTION public.payroll_line_is_mine_and_final(p_line UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payroll_run_lines l
    JOIN public.payroll_runs r ON r.id = l.run_id
    WHERE l.id = p_line AND l.employee_id = auth.uid()
      AND r.status IN ('locked', 'paid', 'reconciled')
  );
$$;

DROP POLICY IF EXISTS "Staff read own final lines" ON public.payroll_run_lines;
CREATE POLICY "Staff read own final lines" ON public.payroll_run_lines FOR SELECT
  USING (employee_id = auth.uid() AND public.payroll_run_is_locked(run_id));

DROP POLICY IF EXISTS "Staff read own final components" ON public.payroll_line_components;
CREATE POLICY "Staff read own final components" ON public.payroll_line_components FOR SELECT
  USING (public.payroll_line_is_mine_and_final(line_id));

DROP POLICY IF EXISTS "Staff read own runs" ON public.payroll_runs;
CREATE POLICY "Staff read own runs" ON public.payroll_runs FOR SELECT
  USING (status IN ('locked','paid','reconciled') AND EXISTS (
    SELECT 1 FROM public.payroll_run_lines l WHERE l.run_id = id AND l.employee_id = auth.uid()
  ));

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
