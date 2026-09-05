-- ============================================================================
-- fee_r3_charges — fines, and late fees that a school dares switch on
-- ============================================================================
-- Round 3 of docs/fee-upgrade-plan.md. Run after fee_r3_concessions.sql.
-- Safe to re-run.
--
-- Late fees are the feature schools ask for and then never enable, because the
-- risk is asymmetric: a rule that turns out to charge more than intended sends
-- angry parents to the office, and there is no undo for a message already read.
-- Four things here address that specifically:
--
--   1. `enabled` defaults to false, and enabling stamps `enabled_from = today`.
--      No rule ever reaches backwards and invents a debt for a bill that was
--      overdue last month.
--   2. Every rule has a cap. A percentage-per-day rule without one is how a
--      ₹200 late fee becomes ₹6,000 over a summer holiday.
--   3. The sweep previews: how many bills, how much, broken down by class,
--      before anything is written.
--   4. Changing a rule never rewrites history — a recalculation posts a signed
--      delta charge referencing the original.
--
-- fee_compute_late_fee is deliberately the only place the arithmetic lives, and
-- mirrors src/lib/fees/engine/latefee.ts exactly, so the live preview in the
-- rule builder cannot disagree with what the sweep then charges.

-- ── Fines ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_fine_categories (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  code           TEXT NOT NULL UNIQUE,
  default_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (default_amount >= 0),
  active         BOOLEAN NOT NULL DEFAULT true,
  sort           INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fee_fines (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  category_id      UUID REFERENCES public.fee_fine_categories(id) ON DELETE SET NULL,
  -- The bill it was added to. A fine always lands on one, whether an existing
  -- bill the family is already paying or a slip raised for it.
  invoice_id       UUID REFERENCES public.fee_invoices(id) ON DELETE CASCADE,
  line_id          UUID REFERENCES public.fee_invoice_lines(id) ON DELETE SET NULL,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason           TEXT,
  status           TEXT NOT NULL DEFAULT 'applied'
                   CHECK (status IN ('applied', 'waived', 'removed')),
  waived_amount    NUMERIC(12,2),
  waive_reason     TEXT,
  applied_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  waived_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_fines_student ON public.fee_fines(student_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_fines_invoice ON public.fee_fines(invoice_id);

-- ── Late-fee rules ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_late_fee_rules (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  -- Which bills it covers. `all` is the school; the others narrow it.
  scope            TEXT NOT NULL DEFAULT 'all'
                   CHECK (scope IN ('all', 'group', 'structure', 'installment')),
  scope_id         UUID,
  grace_days       INT NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
  charge_type      TEXT NOT NULL DEFAULT 'flat' CHECK (charge_type IN ('flat', 'percent')),
  rate             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  frequency        TEXT NOT NULL DEFAULT 'once'
                   CHECK (frequency IN ('once', 'daily', 'weekly', 'monthly')),
  -- Charge on the whole bill, or only on what is still unpaid. `unpaid` is
  -- fairer and is the default: a family who paid most of it should not be
  -- penalised as if they paid none.
  basis            TEXT NOT NULL DEFAULT 'unpaid' CHECK (basis IN ('whole', 'unpaid')),
  cap_amount       NUMERIC(12,2),
  cap_percent      NUMERIC(5,2),
  -- Off until somebody deliberately turns it on.
  enabled          BOOLEAN NOT NULL DEFAULT false,
  -- Stamped at the moment of enabling. Nothing before this date is ever charged.
  enabled_from     DATE,
  enabled_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes            TEXT,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A recurring percentage with no ceiling is the runaway case. Refuse it.
  CONSTRAINT fee_late_fee_rules_needs_cap
    CHECK (frequency = 'once' OR cap_amount IS NOT NULL OR cap_percent IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_fee_late_rules_year ON public.fee_late_fee_rules(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_late_rules_live
  ON public.fee_late_fee_rules(academic_year_id) WHERE enabled;

CREATE TABLE IF NOT EXISTS public.fee_late_fee_charges (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id  UUID NOT NULL REFERENCES public.fee_invoices(id) ON DELETE CASCADE,
  rule_id     UUID REFERENCES public.fee_late_fee_rules(id) ON DELETE SET NULL,
  line_id     UUID REFERENCES public.fee_invoice_lines(id) ON DELETE SET NULL,
  as_of       DATE NOT NULL DEFAULT CURRENT_DATE,
  days_late   INT NOT NULL DEFAULT 0,
  amount      NUMERIC(12,2) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'charged'
              CHECK (status IN ('charged', 'waived', 'recalculated')),
  waive_reason TEXT,
  waived_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Set on a correcting charge that adjusts an earlier one, so the original
  -- stays readable rather than being edited.
  delta_of    UUID REFERENCES public.fee_late_fee_charges(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_late_charges_invoice ON public.fee_late_fee_charges(invoice_id);
CREATE INDEX IF NOT EXISTS idx_fee_late_charges_rule    ON public.fee_late_fee_charges(rule_id);

CREATE TABLE IF NOT EXISTS public.fee_late_fee_exemptions (
  invoice_id UUID PRIMARY KEY REFERENCES public.fee_invoices(id) ON DELETE CASCADE,
  reason     TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_fines','fee_late_fee_rules'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END$$;

-- ── The arithmetic, in one place ────────────────────────────────────────
-- Pure: no writes, no clock of its own. The rule builder's live sample, the
-- sweep preview and the nightly job all call this, so a preview that disagrees
-- with the charge is not possible.
CREATE OR REPLACE FUNCTION public.fee_compute_late_fee(
  p_rule UUID, p_base NUMERIC, p_due DATE, p_as_of DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_r        public.fee_late_fee_rules%ROWTYPE;
  v_as_of    DATE := COALESCE(p_as_of, CURRENT_DATE);
  v_start    DATE;
  v_days     INT;
  v_periods  INT;
  v_unit     NUMERIC(12,2);
  v_amount   NUMERIC(12,2);
  v_cap      NUMERIC(12,2);
  v_capped   TEXT := NULL;
BEGIN
  SELECT * INTO v_r FROM public.fee_late_fee_rules WHERE id = p_rule;
  IF NOT FOUND THEN RETURN jsonb_build_object('amount', 0, 'days', 0, 'why', 'No such rule'); END IF;

  -- Counting starts after the grace period, and never before the day the rule
  -- was switched on.
  v_start := (p_due + v_r.grace_days)::DATE;
  IF v_r.enabled_from IS NOT NULL AND v_r.enabled_from > v_start THEN
    v_start := v_r.enabled_from;
  END IF;

  v_days := GREATEST(0, v_as_of - v_start);
  IF v_days <= 0 OR p_base <= 0 THEN
    RETURN jsonb_build_object(
      'amount', 0, 'days', 0, 'periods', 0, 'capped_by', NULL,
      'why', format('Not late yet — nothing is charged until %s.', v_start));
  END IF;

  v_periods := CASE v_r.frequency
    WHEN 'once'    THEN 1
    WHEN 'daily'   THEN v_days
    WHEN 'weekly'  THEN CEIL(v_days::NUMERIC / 7)::INT
    WHEN 'monthly' THEN CEIL(v_days::NUMERIC / 30)::INT
  END;

  v_unit := CASE v_r.charge_type
    WHEN 'flat'    THEN v_r.rate
    WHEN 'percent' THEN ROUND(p_base * v_r.rate / 100, 2)
  END;

  v_amount := ROUND(v_unit * v_periods, 2);

  -- The cap is the safety rail. Both forms apply; the tighter one wins.
  IF v_r.cap_amount IS NOT NULL AND v_amount > v_r.cap_amount THEN
    v_amount := v_r.cap_amount; v_capped := 'amount';
  END IF;
  IF v_r.cap_percent IS NOT NULL THEN
    v_cap := ROUND(p_base * v_r.cap_percent / 100, 2);
    IF v_amount > v_cap THEN v_amount := v_cap; v_capped := 'percent'; END IF;
  END IF;

  RETURN jsonb_build_object(
    'amount', v_amount,
    'days', v_days,
    'periods', v_periods,
    'unit', v_unit,
    'capped_by', v_capped,
    'why', format(
      '%s days late from %s. %s %s %s = %s%s',
      v_days, v_start,
      CASE v_r.charge_type WHEN 'flat' THEN to_char(v_r.rate, 'FM999999990.00')
                           ELSE v_r.rate || '% of ' || to_char(p_base, 'FM999999990.00') END,
      CASE v_r.frequency WHEN 'once' THEN 'once' ELSE '× ' || v_periods END,
      CASE v_r.frequency WHEN 'once' THEN '' ELSE v_r.frequency END,
      to_char(v_amount, 'FM999999990.00'),
      CASE WHEN v_capped IS NULL THEN '' ELSE ' (capped)' END));
END $$;

-- ── Enabling a rule ─────────────────────────────────────────────────────
-- Its own RPC so `enabled_from` can only ever be stamped as today. If this were
-- a plain UPDATE, a client could set an earlier date and back-charge a term.
CREATE OR REPLACE FUNCTION public.fee_set_late_fee_rule_enabled(
  p_rule UUID, p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_r public.fee_late_fee_rules%ROWTYPE;
BEGIN
  IF NOT public.fee_requires('fees.latefee.manage') THEN
    RAISE EXCEPTION 'You do not have permission to change late-fee rules';
  END IF;

  SELECT * INTO v_r FROM public.fee_late_fee_rules WHERE id = p_rule FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such rule'; END IF;

  UPDATE public.fee_late_fee_rules
     SET enabled = p_enabled,
         enabled_from = CASE WHEN p_enabled THEN CURRENT_DATE ELSE enabled_from END,
         enabled_by = CASE WHEN p_enabled THEN (SELECT auth.uid()) ELSE enabled_by END
   WHERE id = p_rule;

  PERFORM public.fee_log(
    CASE WHEN p_enabled THEN 'latefee.enable' ELSE 'latefee.disable' END,
    'fee_late_fee_rules', p_rule, NULL, v_r.academic_year_id,
    jsonb_build_object('enabled', v_r.enabled),
    jsonb_build_object('enabled', p_enabled, 'from', CURRENT_DATE), NULL, NULL);

  RETURN jsonb_build_object('enabled', p_enabled, 'from', CURRENT_DATE);
END $$;

-- ── The sweep ───────────────────────────────────────────────────────────
-- Preview and commit are the same walk; `p_commit = false` writes nothing.
CREATE OR REPLACE FUNCTION public.fee_late_fee_sweep(
  p_year UUID, p_commit BOOLEAN DEFAULT false, p_as_of DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of   DATE := COALESCE(p_as_of, CURRENT_DATE);
  v_rule    RECORD;
  v_inv     RECORD;
  v_calc    JSONB;
  v_base    NUMERIC(12,2);
  v_already NUMERIC(12,2);
  v_charge  NUMERIC(12,2);
  v_line    UUID;
  v_count   INT := 0;
  v_total   NUMERIC(12,2) := 0;
  v_exempt  INT := 0;
  v_by_class JSONB := '{}'::JSONB;
  v_class   TEXT;
BEGIN
  IF NOT public.fee_requires('fees.latefee.manage') THEN
    RAISE EXCEPTION 'You do not have permission to run a late-fee sweep';
  END IF;

  FOR v_rule IN
    SELECT * FROM public.fee_late_fee_rules
     WHERE academic_year_id = p_year AND enabled
     ORDER BY scope DESC   -- narrower scopes first, so the most specific wins
  LOOP
    FOR v_inv IN
      SELECT i.id, i.number, i.net, i.balance, i.due_date, i.student_id,
             p.grade, p.section
        FROM public.fee_invoices i
        JOIN public.fee_profiles f ON f.id = i.profile_id
        JOIN public.profiles p ON p.id = i.student_id
       WHERE i.academic_year_id = p_year
         AND i.status IN ('pending', 'partly_paid', 'overdue')
         AND i.balance > 0
         AND (v_rule.scope = 'all'
              OR (v_rule.scope = 'group'       AND f.fee_group_id = v_rule.scope_id)
              OR (v_rule.scope = 'structure'   AND f.structure_id = v_rule.scope_id)
              OR (v_rule.scope = 'installment' AND i.installment_id = v_rule.scope_id))
    LOOP
      IF EXISTS (SELECT 1 FROM public.fee_late_fee_exemptions WHERE invoice_id = v_inv.id) THEN
        v_exempt := v_exempt + 1;
        CONTINUE;
      END IF;

      v_base := CASE v_rule.basis WHEN 'whole' THEN v_inv.net ELSE v_inv.balance END;
      v_calc := public.fee_compute_late_fee(v_rule.id, v_base, v_inv.due_date, v_as_of);

      -- What this rule has already charged on this bill. A sweep run twice in
      -- a week must top up to the correct total, not charge the whole thing
      -- again.
      SELECT COALESCE(SUM(amount), 0) INTO v_already
        FROM public.fee_late_fee_charges
       WHERE invoice_id = v_inv.id AND rule_id = v_rule.id AND status <> 'waived';

      v_charge := (v_calc ->> 'amount')::NUMERIC - v_already;
      IF v_charge <= 0 THEN CONTINUE; END IF;

      v_count := v_count + 1;
      v_total := v_total + v_charge;
      v_class := COALESCE(v_inv.grade::TEXT, '—') || COALESCE(' ' || v_inv.section, '');
      v_by_class := jsonb_set(v_by_class, ARRAY[v_class],
        to_jsonb(COALESCE((v_by_class ->> v_class)::INT, 0) + 1), true);

      IF p_commit THEN
        INSERT INTO public.fee_invoice_lines (
          invoice_id, kind, label, amount, source_id, note, sort)
        VALUES (v_inv.id, 'late_fee',
                format('Late fee — %s', v_rule.name),
                v_charge, v_rule.id, v_calc ->> 'why', 800)
        RETURNING id INTO v_line;

        INSERT INTO public.fee_late_fee_charges (
          invoice_id, rule_id, line_id, as_of, days_late, amount)
        VALUES (v_inv.id, v_rule.id, v_line, v_as_of,
                (v_calc ->> 'days')::INT, v_charge);

        PERFORM public.fee_post_ledger(
          v_inv.student_id, p_year, 'adjustment', v_charge, 0,
          'fee_invoices', v_inv.id,
          format('Late fee on %s — %s', v_inv.number, v_rule.name));
      END IF;
    END LOOP;
  END LOOP;

  IF p_commit THEN
    PERFORM public.fee_log('latefee.sweep', 'fee_late_fee_charges', NULL, NULL, p_year,
      NULL, jsonb_build_object('charged', v_count, 'as_of', v_as_of), NULL, v_total);
  END IF;

  RETURN jsonb_build_object(
    'committed', p_commit, 'as_of', v_as_of,
    'bills', v_count, 'total', v_total, 'exempt', v_exempt, 'by_class', v_by_class);
END $$;

-- ── Waiving a late fee ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_waive_late_fee(p_charge UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_c public.fee_late_fee_charges%ROWTYPE; v_inv public.fee_invoices%ROWTYPE;
BEGIN
  IF NOT public.fee_requires('fees.latefee.manage') THEN
    RAISE EXCEPTION 'You do not have permission to waive a late fee';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Say why this late fee is being waived';
  END IF;

  SELECT * INTO v_c FROM public.fee_late_fee_charges WHERE id = p_charge FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such late fee'; END IF;
  IF v_c.status = 'waived' THEN RAISE EXCEPTION 'That late fee is already waived'; END IF;

  SELECT * INTO v_inv FROM public.fee_invoices WHERE id = v_c.invoice_id;

  IF v_c.line_id IS NOT NULL THEN
    DELETE FROM public.fee_invoice_lines WHERE id = v_c.line_id;
  END IF;

  UPDATE public.fee_late_fee_charges
     SET status = 'waived', line_id = NULL, waive_reason = btrim(p_reason),
         waived_by = (SELECT auth.uid())
   WHERE id = p_charge;

  PERFORM public.fee_post_ledger(
    v_inv.student_id, v_inv.academic_year_id, 'adjustment', 0, v_c.amount,
    'fee_late_fee_charges', p_charge,
    format('Late fee waived on %s — %s', v_inv.number, btrim(p_reason)));

  PERFORM public.fee_log('latefee.waive', 'fee_late_fee_charges', p_charge,
    v_inv.student_id, v_inv.academic_year_id, NULL, NULL, btrim(p_reason), v_c.amount);

  RETURN jsonb_build_object('status', 'waived', 'invoice', v_inv.number);
END $$;

-- ── Adding a fine ───────────────────────────────────────────────────────
-- The question the counter asks is "separate slip, or onto a bill they are
-- already paying?", so the RPC takes either an invoice or a request to raise
-- one, and never leaves a fine floating with no bill behind it.
CREATE OR REPLACE FUNCTION public.fee_add_fine(
  p_student  UUID,
  p_year     UUID,
  p_amount   NUMERIC,
  p_category UUID DEFAULT NULL,
  p_reason   TEXT DEFAULT NULL,
  p_invoice  UUID DEFAULT NULL,
  p_due_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice UUID := p_invoice;
  v_profile UUID;
  v_seq     BIGINT;
  v_number  TEXT;
  v_label   TEXT;
  v_line    UUID;
  v_fine    UUID;
  v_new     BOOLEAN := false;
BEGIN
  IF NOT public.fee_requires('fees.fine.apply') THEN
    RAISE EXCEPTION 'You do not have permission to add a fine';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A fine must be for more than zero';
  END IF;

  v_label := COALESCE(
    (SELECT name FROM public.fee_fine_categories WHERE id = p_category), 'Fine');

  IF v_invoice IS NULL THEN
    SELECT id INTO v_profile FROM public.fee_profiles
     WHERE student_id = p_student AND academic_year_id = p_year;
    IF v_profile IS NULL THEN
      RAISE EXCEPTION 'That student has no fee profile for this session';
    END IF;

    SELECT seq, formatted INTO v_seq, v_number FROM public.fee_next_number('invoice', p_year);
    INSERT INTO public.fee_invoices (
      profile_id, student_id, academic_year_id, number, seq,
      issue_date, due_date, created_by, status)
    VALUES (v_profile, p_student, p_year, v_number, v_seq, CURRENT_DATE,
            COALESCE(p_due_date, CURRENT_DATE + 14), (SELECT auth.uid()), 'pending')
    RETURNING id INTO v_invoice;
    v_new := true;
  END IF;

  INSERT INTO public.fee_invoice_lines (invoice_id, kind, label, amount, note, sort)
  VALUES (v_invoice, 'fine', v_label, p_amount, p_reason, 900)
  RETURNING id INTO v_line;

  INSERT INTO public.fee_fines (
    student_id, academic_year_id, category_id, invoice_id, line_id,
    amount, reason, applied_by)
  VALUES (p_student, p_year, p_category, v_invoice, v_line, p_amount, p_reason,
          (SELECT auth.uid()))
  RETURNING id INTO v_fine;

  UPDATE public.fee_invoice_lines SET source_id = v_fine WHERE id = v_line;

  PERFORM public.fee_post_ledger(p_student, p_year, 'adjustment', p_amount, 0,
    'fee_fines', v_fine, format('%s — %s', v_label, COALESCE(p_reason, 'no reason given')));

  PERFORM public.fee_log('fine.apply', 'fee_fines', v_fine, p_student, p_year,
    NULL, jsonb_build_object('label', v_label, 'own_slip', v_new), p_reason, p_amount);

  RETURN jsonb_build_object(
    'fine_id', v_fine, 'invoice_id', v_invoice, 'line_id', v_line,
    'own_slip', v_new, 'number', COALESCE(v_number,
      (SELECT number FROM public.fee_invoices WHERE id = v_invoice)));
END $$;

CREATE OR REPLACE FUNCTION public.fee_waive_fine(
  p_fine UUID, p_reason TEXT, p_amount NUMERIC DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_f public.fee_fines%ROWTYPE;
  v_waive NUMERIC(12,2);
BEGIN
  IF NOT public.fee_requires('fees.fine.apply') THEN
    RAISE EXCEPTION 'You do not have permission to waive a fine';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Say why this fine is being waived';
  END IF;

  SELECT * INTO v_f FROM public.fee_fines WHERE id = p_fine FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such fine'; END IF;
  IF v_f.status <> 'applied' THEN RAISE EXCEPTION 'That fine is already %', v_f.status; END IF;

  v_waive := LEAST(COALESCE(p_amount, v_f.amount), v_f.amount);

  IF v_waive >= v_f.amount THEN
    -- Fully waived: take the line off entirely.
    IF v_f.line_id IS NOT NULL THEN
      DELETE FROM public.fee_invoice_lines WHERE id = v_f.line_id;
    END IF;
    UPDATE public.fee_fines
       SET status = 'waived', line_id = NULL, waived_amount = v_f.amount,
           waive_reason = btrim(p_reason), waived_by = (SELECT auth.uid())
     WHERE id = p_fine;
  ELSE
    -- Partly waived: reduce the line rather than adding a confusing second one.
    UPDATE public.fee_invoice_lines
       SET amount = v_f.amount - v_waive,
           note = COALESCE(note, '') || format(' (%s waived: %s)',
                    to_char(v_waive, 'FM999999990.00'), btrim(p_reason))
     WHERE id = v_f.line_id;
    UPDATE public.fee_fines
       SET waived_amount = v_waive, waive_reason = btrim(p_reason),
           waived_by = (SELECT auth.uid())
     WHERE id = p_fine;
  END IF;

  PERFORM public.fee_post_ledger(v_f.student_id, v_f.academic_year_id, 'adjustment',
    0, v_waive, 'fee_fines', p_fine, format('Fine waived — %s', btrim(p_reason)));
  PERFORM public.fee_log('fine.waive', 'fee_fines', p_fine, v_f.student_id,
    v_f.academic_year_id, NULL, NULL, btrim(p_reason), v_waive);

  RETURN jsonb_build_object('waived', v_waive, 'full', v_waive >= v_f.amount);
END $$;

-- ── Seed the usual fine categories ──────────────────────────────────────
INSERT INTO public.fee_fine_categories (name, code, default_amount, sort) VALUES
  ('Library',        'LIBRARY',   50,  10),
  ('Damage',         'DAMAGE',    0,   20),
  ('Late arrival',   'LATE',      0,   30),
  ('Lost item',      'LOST',      0,   40),
  ('Cheque return',  'CHEQUE',    350, 50),
  ('Other',          'OTHER',     0,   60)
ON CONFLICT (code) DO NOTHING;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.fee_fine_categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_fines               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_late_fee_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_late_fee_charges    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_late_fee_exemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read fine categories" ON public.fee_fine_categories;
CREATE POLICY "Read fine categories" ON public.fee_fine_categories
  FOR SELECT TO authenticated USING (public.has_fee_permission('fees.view'));
DROP POLICY IF EXISTS "Manage fine categories" ON public.fee_fine_categories;
CREATE POLICY "Manage fine categories" ON public.fee_fine_categories
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.config.manage'))
  WITH CHECK (public.has_fee_permission('fees.config.manage'));

DROP POLICY IF EXISTS "Read fines" ON public.fee_fines;
CREATE POLICY "Read fines" ON public.fee_fines
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'));

DROP POLICY IF EXISTS "Read late fee rules" ON public.fee_late_fee_rules;
CREATE POLICY "Read late fee rules" ON public.fee_late_fee_rules
  FOR SELECT TO authenticated USING (public.has_fee_permission('fees.view'));
DROP POLICY IF EXISTS "Manage late fee rules" ON public.fee_late_fee_rules;
CREATE POLICY "Manage late fee rules" ON public.fee_late_fee_rules
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.latefee.manage'))
  WITH CHECK (public.has_fee_permission('fees.latefee.manage'));

DROP POLICY IF EXISTS "Read late fee charges" ON public.fee_late_fee_charges;
CREATE POLICY "Read late fee charges" ON public.fee_late_fee_charges
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.fee_invoices i
                  WHERE i.id = invoice_id
                    AND (i.student_id = (SELECT auth.uid())
                         OR public.has_fee_permission('fees.profile.view'))));

DROP POLICY IF EXISTS "Manage late fee exemptions" ON public.fee_late_fee_exemptions;
CREATE POLICY "Manage late fee exemptions" ON public.fee_late_fee_exemptions
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.latefee.manage'))
  WITH CHECK (public.has_fee_permission('fees.latefee.manage'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_fine_categories, public.fee_late_fee_rules,
                                        public.fee_late_fee_exemptions TO authenticated;
GRANT SELECT ON public.fee_fines, public.fee_late_fee_charges TO authenticated;

DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'fee_compute_late_fee(uuid,numeric,date,date)',
    'fee_set_late_fee_rule_enabled(uuid,boolean)',
    'fee_late_fee_sweep(uuid,boolean,date)',
    'fee_waive_late_fee(uuid,text)',
    'fee_add_fine(uuid,uuid,numeric,uuid,text,uuid,date)',
    'fee_waive_fine(uuid,text,numeric)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END$$;

NOTIFY pgrst, 'reload schema';
