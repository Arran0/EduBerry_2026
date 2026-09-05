-- ============================================================================
-- fee_r3_concessions — discounts, scholarships and waivers
-- ============================================================================
-- Round 3 of docs/fee-upgrade-plan.md. Run after fee_r2_harden_grants.sql.
-- Safe to re-run.
--
-- The rule that shapes everything here: a concession always names an invoice.
-- There is no student-level floating adjustment, because a figure subtracted
-- somewhere a family cannot see is indistinguishable from an error, and six
-- months later nobody can say what it was for. Every concession lands as a
-- negative `fee_invoice_lines` row with its own label, on the bill it comes off.
--
-- The invoice header totals are maintained by the trigger Round 2 installed, so
-- applying a concession needs no separate bookkeeping — insert the line and the
-- bill re-totals itself.

-- ── Discount types ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_discount_types (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id   UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  code               TEXT NOT NULL,
  mode               TEXT NOT NULL DEFAULT 'fixed' CHECK (mode IN ('fixed', 'percent')),
  value              NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  -- 'all' takes the discount off the whole bill; 'heads' only off the listed
  -- fee heads, which is how "10% off tuition only" is expressed.
  scope              TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'heads')),
  head_ids           UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  -- Whether this may be combined with another discount on the same bill.
  stackable          BOOLEAN NOT NULL DEFAULT true,
  -- Automatic application. `none` means a person applies it by hand.
  auto_rule          TEXT NOT NULL DEFAULT 'none'
                     CHECK (auto_rule IN ('none', 'sibling', 'staff_ward', 'early_payment')),
  auto_config        JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Above this the concession waits for someone holding fees.discount.approve.
  -- NULL falls back to the school-wide threshold in fee_settings.
  approval_threshold NUMERIC(12,2),
  active             BOOLEAN NOT NULL DEFAULT true,
  notes              TEXT,
  created_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (academic_year_id, code)
);

-- ── Scholarships ────────────────────────────────────────────────────────
-- A scholarship differs from a discount in that somebody is funding it and the
-- money is finite. Tracking the funder and the budget is what stops a school
-- awarding more than it has.
CREATE TABLE IF NOT EXISTS public.fee_scholarships (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  code             TEXT NOT NULL,
  funder           TEXT,
  annual_budget    NUMERIC(12,2),
  seats            INT,
  notes            TEXT,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (academic_year_id, code)
);

-- ── The concessions themselves ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_concessions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year_id    UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('discount', 'scholarship', 'waiver')),
  type_id             UUID REFERENCES public.fee_discount_types(id) ON DELETE SET NULL,
  scholarship_id      UUID REFERENCES public.fee_scholarships(id) ON DELETE SET NULL,
  -- The bill it comes off. Required once applied; nullable only while a request
  -- is still pending a decision.
  invoice_id          UUID REFERENCES public.fee_invoices(id) ON DELETE CASCADE,
  fee_head_id         UUID REFERENCES public.fee_heads(id) ON DELETE SET NULL,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason              TEXT,
  status              TEXT NOT NULL DEFAULT 'applied'
                      CHECK (status IN ('pending', 'approved', 'declined', 'applied', 'removed')),
  -- The invoice line this produced, so removing the concession removes the
  -- line and nothing has to be matched up by label.
  line_id             UUID REFERENCES public.fee_invoice_lines(id) ON DELETE SET NULL,
  -- Set when a concession was moved from one bill to another, so the history
  -- of "it was on the wrong invoice" survives.
  moved_from_invoice_id UUID REFERENCES public.fee_invoices(id) ON DELETE SET NULL,
  auto_applied        BOOLEAN NOT NULL DEFAULT false,
  requested_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  decline_reason      TEXT,
  removed_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  removed_at          TIMESTAMPTZ,
  removal_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Removing a concession restores money to a family's bill. Saying why is not
  -- optional, for the same reason a payment reversal needs a reason.
  CONSTRAINT fee_concessions_removal_needs_reason
    CHECK (status <> 'removed' OR (removal_reason IS NOT NULL AND length(btrim(removal_reason)) >= 3))
);

CREATE INDEX IF NOT EXISTS idx_fee_concessions_student ON public.fee_concessions(student_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_concessions_invoice ON public.fee_concessions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_fee_concessions_pending
  ON public.fee_concessions(academic_year_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_fee_concessions_scholarship ON public.fee_concessions(scholarship_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_discount_types','fee_scholarships','fee_concessions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END$$;

-- How much of a scholarship's budget is committed. A view, not a column,
-- because a stored total drifts the moment a concession is removed.
CREATE OR REPLACE VIEW public.fee_scholarship_budgets
WITH (security_invoker = true) AS
SELECT
  s.id, s.academic_year_id, s.name, s.code, s.funder,
  s.annual_budget, s.seats, s.active,
  COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'applied'), 0) AS awarded,
  COUNT(DISTINCT c.student_id) FILTER (WHERE c.status = 'applied') AS recipients,
  CASE WHEN s.annual_budget IS NULL THEN NULL
       ELSE s.annual_budget - COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'applied'), 0)
  END AS remaining
FROM public.fee_scholarships s
LEFT JOIN public.fee_concessions c ON c.scholarship_id = s.id
GROUP BY s.id;

-- ── Applying a concession ───────────────────────────────────────────────
-- One RPC: decide whether it needs approval, write the row, and — if it is
-- live — put the negative line on the invoice so the bill re-totals itself.
CREATE OR REPLACE FUNCTION public.fee_apply_concession(
  p_invoice   UUID,
  p_kind      TEXT,
  p_amount    NUMERIC,
  p_type      UUID DEFAULT NULL,
  p_scholarship UUID DEFAULT NULL,
  p_head      UUID DEFAULT NULL,
  p_reason    TEXT DEFAULT NULL,
  p_label     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv       public.fee_invoices%ROWTYPE;
  v_type      public.fee_discount_types%ROWTYPE;
  v_threshold NUMERIC;
  v_needs     BOOLEAN;
  v_status    TEXT;
  v_label     TEXT;
  v_id        UUID;
  v_line      UUID;
  v_existing  NUMERIC;
BEGIN
  IF p_kind = 'waiver' THEN
    IF NOT public.fee_requires('fees.waiver.approve')
       AND NOT public.fee_requires('fees.discount.apply') THEN
      RAISE EXCEPTION 'You do not have permission to record a waiver';
    END IF;
  ELSIF NOT public.fee_requires('fees.discount.apply')
        AND NOT public.fee_requires('fees.scholarship.manage') THEN
    RAISE EXCEPTION 'You do not have permission to apply a concession';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A concession must be for more than zero';
  END IF;

  SELECT * INTO v_inv FROM public.fee_invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such bill'; END IF;
  IF v_inv.status = 'cancelled' THEN
    RAISE EXCEPTION 'That bill is cancelled. Apply the concession to a live bill instead.';
  END IF;

  -- A concession cannot take a bill below zero. Without this a mistyped amount
  -- silently turns a bill into a credit the school then owes.
  SELECT COALESCE(-SUM(amount), 0) INTO v_existing
    FROM public.fee_invoice_lines
   WHERE invoice_id = p_invoice AND kind IN ('discount', 'scholarship', 'waiver');

  IF p_amount > v_inv.net THEN
    RAISE EXCEPTION
      'That is more than the % left on this bill. A concession cannot make a bill negative.',
      to_char(v_inv.net, 'FM999999990.00');
  END IF;

  IF p_type IS NOT NULL THEN
    SELECT * INTO v_type FROM public.fee_discount_types WHERE id = p_type;
    IF FOUND AND NOT v_type.stackable AND v_existing > 0 THEN
      RAISE EXCEPTION
        'The % discount cannot be combined with another concession already on this bill.',
        v_type.name;
    END IF;
  END IF;

  v_threshold := COALESCE(
    v_type.approval_threshold,
    (public.fee_setting('approval_thresholds', v_inv.academic_year_id) ->>
      CASE WHEN p_kind = 'waiver' THEN 'waiver' ELSE 'discount' END)::NUMERIC,
    0);

  -- A threshold of 0 means everything needs approval, which is the safe reading
  -- of "0" for money given away.
  v_needs := p_amount > v_threshold OR v_threshold = 0;

  IF v_needs AND (
       (p_kind = 'waiver'  AND public.fee_requires('fees.waiver.approve')) OR
       (p_kind <> 'waiver' AND public.fee_requires('fees.discount.approve'))) THEN
    -- The approver applied it themselves; no point making them queue for
    -- their own signature.
    v_needs := false;
  END IF;

  v_status := CASE WHEN v_needs THEN 'pending' ELSE 'applied' END;
  v_label := COALESCE(NULLIF(btrim(p_label), ''),
                      v_type.name,
                      (SELECT name FROM public.fee_scholarships WHERE id = p_scholarship),
                      initcap(p_kind));

  INSERT INTO public.fee_concessions (
    student_id, academic_year_id, kind, type_id, scholarship_id, invoice_id,
    fee_head_id, amount, reason, status, requested_by,
    approved_by, approved_at)
  VALUES (
    v_inv.student_id, v_inv.academic_year_id, p_kind, p_type, p_scholarship, p_invoice,
    p_head, p_amount, p_reason, v_status, (SELECT auth.uid()),
    CASE WHEN NOT v_needs THEN (SELECT auth.uid()) END,
    CASE WHEN NOT v_needs THEN NOW() END)
  RETURNING id INTO v_id;

  IF NOT v_needs THEN
    INSERT INTO public.fee_invoice_lines (
      invoice_id, kind, fee_head_id, label, amount, source_id, note, sort)
    VALUES (p_invoice, p_kind, p_head, v_label, -p_amount, v_id, p_reason, 700)
    RETURNING id INTO v_line;

    UPDATE public.fee_concessions SET line_id = v_line WHERE id = v_id;

    PERFORM public.fee_post_ledger(
      v_inv.student_id, v_inv.academic_year_id, 'adjustment', 0, p_amount,
      'fee_concessions', v_id, format('%s on %s — %s', v_label, v_inv.number,
                                      COALESCE(p_reason, 'no reason given')));
  END IF;

  PERFORM public.fee_log(
    CASE WHEN v_needs THEN 'concession.request' ELSE 'concession.apply' END,
    'fee_concessions', v_id, v_inv.student_id, v_inv.academic_year_id,
    NULL, jsonb_build_object('kind', p_kind, 'invoice', v_inv.number, 'label', v_label),
    p_reason, p_amount);

  RETURN jsonb_build_object(
    'concession_id', v_id, 'status', v_status, 'line_id', v_line,
    'needs_approval', v_needs, 'label', v_label);
END $$;

-- ── Approving or declining ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_decide_concession(
  p_concession UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c    public.fee_concessions%ROWTYPE;
  v_inv  public.fee_invoices%ROWTYPE;
  v_line UUID;
  v_label TEXT;
BEGIN
  SELECT * INTO v_c FROM public.fee_concessions WHERE id = p_concession FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such concession'; END IF;
  IF v_c.status <> 'pending' THEN
    RAISE EXCEPTION 'That concession has already been decided';
  END IF;

  IF v_c.kind = 'waiver' THEN
    IF NOT public.fee_requires('fees.waiver.approve') THEN
      RAISE EXCEPTION 'You do not have permission to approve a waiver';
    END IF;
  ELSIF NOT public.fee_requires('fees.discount.approve') THEN
    RAISE EXCEPTION 'You do not have permission to approve a concession';
  END IF;

  IF NOT p_approve THEN
    UPDATE public.fee_concessions
       SET status = 'declined', approved_by = (SELECT auth.uid()),
           approved_at = NOW(), decline_reason = p_note
     WHERE id = p_concession;

    PERFORM public.fee_log('concession.decline', 'fee_concessions', p_concession,
                           v_c.student_id, v_c.academic_year_id, NULL, NULL, p_note, v_c.amount);
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  SELECT * INTO v_inv FROM public.fee_invoices WHERE id = v_c.invoice_id;
  IF v_inv.status = 'cancelled' THEN
    RAISE EXCEPTION 'The bill this was for has been cancelled since it was requested.';
  END IF;

  v_label := COALESCE(
    (SELECT name FROM public.fee_discount_types WHERE id = v_c.type_id),
    (SELECT name FROM public.fee_scholarships WHERE id = v_c.scholarship_id),
    initcap(v_c.kind));

  INSERT INTO public.fee_invoice_lines (
    invoice_id, kind, fee_head_id, label, amount, source_id, note, sort)
  VALUES (v_c.invoice_id, v_c.kind, v_c.fee_head_id, v_label, -v_c.amount,
          p_concession, v_c.reason, 700)
  RETURNING id INTO v_line;

  UPDATE public.fee_concessions
     SET status = 'applied', line_id = v_line,
         approved_by = (SELECT auth.uid()), approved_at = NOW()
   WHERE id = p_concession;

  PERFORM public.fee_post_ledger(
    v_c.student_id, v_c.academic_year_id, 'adjustment', 0, v_c.amount,
    'fee_concessions', p_concession,
    format('%s approved on %s', v_label, v_inv.number));

  PERFORM public.fee_log('concession.approve', 'fee_concessions', p_concession,
                         v_c.student_id, v_c.academic_year_id, NULL,
                         jsonb_build_object('invoice', v_inv.number), p_note, v_c.amount);

  RETURN jsonb_build_object('status', 'applied', 'line_id', v_line);
END $$;

-- ── Removing or moving ──────────────────────────────────────────────────
-- Removing puts money back on a family's bill, so it is as consequential as a
-- payment reversal and is treated the same way: a reason, an actor, a ledger
-- entry, and the original row kept.
CREATE OR REPLACE FUNCTION public.fee_remove_concession(
  p_concession UUID, p_reason TEXT, p_move_to UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c     public.fee_concessions%ROWTYPE;
  v_from  public.fee_invoices%ROWTYPE;
  v_to    public.fee_invoices%ROWTYPE;
  v_label TEXT;
  v_line  UUID;
BEGIN
  IF NOT public.fee_requires('fees.discount.apply') THEN
    RAISE EXCEPTION 'You do not have permission to change a concession';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Say why this concession is being removed or moved';
  END IF;

  SELECT * INTO v_c FROM public.fee_concessions WHERE id = p_concession FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such concession'; END IF;
  IF v_c.status NOT IN ('applied', 'pending') THEN
    RAISE EXCEPTION 'That concession is already %', v_c.status;
  END IF;

  SELECT * INTO v_from FROM public.fee_invoices WHERE id = v_c.invoice_id;

  -- Taking the line off re-totals the old bill through Round 2's trigger.
  IF v_c.line_id IS NOT NULL THEN
    DELETE FROM public.fee_invoice_lines WHERE id = v_c.line_id;
  END IF;

  IF p_move_to IS NOT NULL THEN
    SELECT * INTO v_to FROM public.fee_invoices WHERE id = p_move_to;
    IF NOT FOUND THEN RAISE EXCEPTION 'No such bill to move it to'; END IF;
    IF v_to.student_id <> v_c.student_id THEN
      RAISE EXCEPTION 'A concession cannot be moved to another student''s bill';
    END IF;
    IF v_c.amount > v_to.net THEN
      RAISE EXCEPTION 'That is more than the bill it would move to.';
    END IF;

    v_label := COALESCE(
      (SELECT name FROM public.fee_discount_types WHERE id = v_c.type_id),
      (SELECT name FROM public.fee_scholarships WHERE id = v_c.scholarship_id),
      initcap(v_c.kind));

    INSERT INTO public.fee_invoice_lines (
      invoice_id, kind, fee_head_id, label, amount, source_id, note, sort)
    VALUES (p_move_to, v_c.kind, v_c.fee_head_id, v_label, -v_c.amount,
            p_concession, v_c.reason, 700)
    RETURNING id INTO v_line;

    UPDATE public.fee_concessions
       SET invoice_id = p_move_to, line_id = v_line,
           moved_from_invoice_id = v_c.invoice_id
     WHERE id = p_concession;

    PERFORM public.fee_log('concession.move', 'fee_concessions', p_concession,
                           v_c.student_id, v_c.academic_year_id,
                           jsonb_build_object('invoice', v_from.number),
                           jsonb_build_object('invoice', v_to.number),
                           btrim(p_reason), v_c.amount);

    RETURN jsonb_build_object('status', 'moved', 'line_id', v_line,
                              'from', v_from.number, 'to', v_to.number);
  END IF;

  UPDATE public.fee_concessions
     SET status = 'removed', line_id = NULL, removed_by = (SELECT auth.uid()),
         removed_at = NOW(), removal_reason = btrim(p_reason)
   WHERE id = p_concession;

  IF v_c.status = 'applied' THEN
    PERFORM public.fee_post_ledger(
      v_c.student_id, v_c.academic_year_id, 'adjustment', v_c.amount, 0,
      'fee_concessions', p_concession,
      format('Concession removed from %s — %s', v_from.number, btrim(p_reason)));
  END IF;

  PERFORM public.fee_log('concession.remove', 'fee_concessions', p_concession,
                         v_c.student_id, v_c.academic_year_id,
                         jsonb_build_object('status', v_c.status),
                         jsonb_build_object('status', 'removed'),
                         btrim(p_reason), v_c.amount);

  RETURN jsonb_build_object('status', 'removed', 'invoice', v_from.number);
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.fee_discount_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_scholarships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_concessions    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read fee discount types" ON public.fee_discount_types;
CREATE POLICY "Read fee discount types" ON public.fee_discount_types
  FOR SELECT TO authenticated USING (public.has_fee_permission('fees.view'));
DROP POLICY IF EXISTS "Manage fee discount types" ON public.fee_discount_types;
CREATE POLICY "Manage fee discount types" ON public.fee_discount_types
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.config.manage'))
  WITH CHECK (public.has_fee_permission('fees.config.manage'));

DROP POLICY IF EXISTS "Read fee scholarships" ON public.fee_scholarships;
CREATE POLICY "Read fee scholarships" ON public.fee_scholarships
  FOR SELECT TO authenticated USING (public.has_fee_permission('fees.view'));
DROP POLICY IF EXISTS "Manage fee scholarships" ON public.fee_scholarships;
CREATE POLICY "Manage fee scholarships" ON public.fee_scholarships
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.scholarship.manage'))
  WITH CHECK (public.has_fee_permission('fees.scholarship.manage'));

-- A student sees their own concessions. That is the whole point of showing a
-- family what the school has given them rather than a smaller number with no
-- explanation.
DROP POLICY IF EXISTS "Read fee concessions" ON public.fee_concessions;
CREATE POLICY "Read fee concessions" ON public.fee_concessions
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'));

-- No client INSERT/UPDATE policy: everything goes through the RPCs above, which
-- decide approval, write the invoice line and post the ledger in one transaction.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_discount_types, public.fee_scholarships TO authenticated;
GRANT SELECT ON public.fee_concessions, public.fee_scholarship_budgets TO authenticated;

REVOKE ALL ON FUNCTION public.fee_apply_concession(UUID, TEXT, NUMERIC, UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fee_decide_concession(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fee_remove_concession(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fee_apply_concession(UUID, TEXT, NUMERIC, UUID, UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_decide_concession(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_remove_concession(UUID, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
