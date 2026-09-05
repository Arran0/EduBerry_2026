-- ============================================================================
-- fee_r3_actor_attribution — who actually did it
-- ============================================================================
-- Round 3 of docs/fee-upgrade-plan.md. Run after fee_r3_charges.sql.
-- Safe to re-run.
--
-- A defect Round 2 shipped, found while testing the concession approval path.
--
-- Every fee RPC attributed its work to `auth.uid()`. That is right when the
-- browser calls the RPC directly, but the API routes build a *service-role*
-- client — there is no JWT, so auth.uid() is NULL. The consequence: every
-- payment taken through /api/fees/collect recorded `collected_by = NULL`, and
-- every audit entry it wrote had no actor. "Who took this money" is the first
-- question anyone asks of a fee system, and the answer was blank.
--
-- The second half of the same defect: `fee_requires()` returns true for a
-- service-role caller by design, because the route has already checked the
-- permission. But the concession RPC also used it to ask a *different*
-- question — "does this person hold the approve permission, so we can skip the
-- queue?" — and a service-role caller passed that too. Every concession
-- submitted through a route would have auto-approved itself, silently
-- defeating the approval workflow.
--
-- The fix separates the two questions, which were never the same:
--
--   fee_requires(key)              may this call proceed at all
--                                  (service role yes — the route checked)
--   fee_actor_can(actor, key)      does this *person* hold the permission
--                                  (never blanket-true for service role)
--
-- and threads an explicit actor through every write, defaulting to auth.uid()
-- so direct browser calls are unchanged. `p_actor` is the last parameter
-- everywhere, so existing callers keep working while they are updated.

-- ── Who is acting ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_actor(p_actor UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(p_actor, (SELECT auth.uid()));
$$;

-- Deliberately NOT fee_requires: this asks whether a named human holds a
-- permission, and a service-role caller must not answer yes on their behalf.
CREATE OR REPLACE FUNCTION public.fee_actor_can(p_actor UUID, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_fee_permission_for(public.fee_actor(p_actor), p_key);
$$;

-- ── fee_log and fee_post_ledger carry the actor ─────────────────────────
CREATE OR REPLACE FUNCTION public.fee_log(
  p_action TEXT, p_entity TEXT, p_entity_id UUID DEFAULT NULL, p_student UUID DEFAULT NULL,
  p_year UUID DEFAULT NULL, p_before JSONB DEFAULT NULL, p_after JSONB DEFAULT NULL,
  p_reason TEXT DEFAULT NULL, p_amount NUMERIC DEFAULT NULL, p_actor UUID DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO public.fee_audit_log (actor_id, action, entity, entity_id, student_id,
                                    academic_year_id, before, after, reason, amount)
  VALUES (public.fee_actor(p_actor), p_action, p_entity, p_entity_id, p_student,
          COALESCE(p_year, public.current_academic_year_id()),
          p_before, p_after, p_reason, p_amount)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.fee_post_ledger(
  p_student UUID, p_year UUID, p_kind TEXT,
  p_debit NUMERIC DEFAULT 0, p_credit NUMERIC DEFAULT 0,
  p_ref_table TEXT DEFAULT NULL, p_ref_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL, p_date DATE DEFAULT NULL, p_actor UUID DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance NUMERIC(12,2); v_id BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('fee_ledger'), hashtext(p_student::TEXT || p_year::TEXT));
  SELECT COALESCE(balance_after, 0) INTO v_balance
    FROM public.fee_ledger_entries
   WHERE student_id = p_student AND academic_year_id = p_year
   ORDER BY id DESC LIMIT 1;
  v_balance := COALESCE(v_balance, 0) + COALESCE(p_debit, 0) - COALESCE(p_credit, 0);
  INSERT INTO public.fee_ledger_entries (
    student_id, academic_year_id, entry_date, kind, ref_table, ref_id,
    debit, credit, balance_after, note, created_by)
  VALUES (p_student, p_year, COALESCE(p_date, CURRENT_DATE), p_kind, p_ref_table, p_ref_id,
          COALESCE(p_debit, 0), COALESCE(p_credit, 0), v_balance, p_note,
          public.fee_actor(p_actor))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ── Collection ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_collect(
  p_student UUID, p_year UUID, p_amount NUMERIC, p_method TEXT,
  p_allocations JSONB DEFAULT NULL, p_paid_on DATE DEFAULT NULL,
  p_reference TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL,
  p_instrument JSONB DEFAULT NULL, p_status TEXT DEFAULT NULL,
  p_actor UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := public.fee_actor(p_actor);
  v_rules JSONB := COALESCE(public.fee_setting('payment_rules', p_year), '{}'::JSONB);
  v_paid_on DATE := COALESCE(p_paid_on, CURRENT_DATE);
  v_status TEXT := COALESCE(p_status, 'verified');
  v_payment UUID; v_seq BIGINT; v_number TEXT; v_instrument UUID;
  v_left NUMERIC(12,2) := p_amount; v_take NUMERIC(12,2);
  v_alloc JSONB; v_inv RECORD; v_hash TEXT;
  v_backdays INT := COALESCE((v_rules ->> 'allow_backdated_days')::INT, 30);
BEGIN
  IF NOT public.fee_requires('fees.collect') THEN
    RAISE EXCEPTION 'You do not have permission to take a payment';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A payment must be for more than zero';
  END IF;

  IF v_paid_on < CURRENT_DATE THEN
    -- Backdating is asked of the person, not of the service role: a route that
    -- checked only `fees.collect` must not be able to backdate through this.
    IF NOT public.fee_actor_can(v_actor, 'fees.collect.backdate') THEN
      RAISE EXCEPTION 'You do not have permission to backdate a payment';
    END IF;
    IF v_paid_on < CURRENT_DATE - v_backdays THEN
      RAISE EXCEPTION 'A payment cannot be dated more than % days back', v_backdays;
    END IF;
  END IF;
  IF v_paid_on > CURRENT_DATE THEN
    RAISE EXCEPTION 'A payment cannot be dated in the future';
  END IF;

  IF p_instrument IS NOT NULL AND p_instrument <> 'null'::JSONB THEN
    INSERT INTO public.fee_instruments (
      student_id, kind, number, bank, branch, account_holder, amount,
      instrument_date, is_postdated, present_on, created_by, timeline)
    VALUES (
      p_student, COALESCE(p_instrument ->> 'kind', 'cheque'),
      p_instrument ->> 'number', p_instrument ->> 'bank', p_instrument ->> 'branch',
      p_instrument ->> 'account_holder', p_amount,
      NULLIF(p_instrument ->> 'instrument_date', '')::DATE,
      COALESCE((p_instrument ->> 'is_postdated')::BOOLEAN, false),
      NULLIF(p_instrument ->> 'present_on', '')::DATE,
      v_actor,
      jsonb_build_array(jsonb_build_object('at', NOW(), 'to', 'received', 'by', v_actor)))
    RETURNING id INTO v_instrument;
    IF COALESCE((p_instrument ->> 'is_postdated')::BOOLEAN, false) THEN
      v_status := 'pending';
    END IF;
  END IF;

  SELECT seq, formatted INTO v_seq, v_number FROM public.fee_next_number('receipt', p_year);

  INSERT INTO public.fee_payments (
    student_id, academic_year_id, receipt_no, seq, paid_on, method, amount,
    reference, notes, instrument_id, status, collected_by, verified_by, verified_at)
  VALUES (
    p_student, p_year, v_number, v_seq, v_paid_on, p_method, p_amount,
    p_reference, p_notes, v_instrument, v_status, v_actor,
    CASE WHEN v_status = 'verified' THEN v_actor END,
    CASE WHEN v_status = 'verified' THEN NOW() END)
  RETURNING id INTO v_payment;

  IF p_allocations IS NOT NULL AND jsonb_array_length(p_allocations) > 0 THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
      v_take := LEAST((v_alloc ->> 'amount')::NUMERIC, v_left);
      IF v_take > 0 THEN
        INSERT INTO public.fee_payment_allocations (payment_id, invoice_id, amount)
        VALUES (v_payment, (v_alloc ->> 'invoice_id')::UUID, v_take);
        v_left := v_left - v_take;
      END IF;
    END LOOP;
  ELSE
    FOR v_inv IN
      SELECT id, balance FROM public.fee_invoices
       WHERE student_id = p_student AND academic_year_id = p_year
         AND status IN ('pending','partly_paid','overdue') AND balance > 0
       ORDER BY CASE WHEN COALESCE(v_rules ->> 'allocation_order', 'oldest_due_first')
                          = 'newest_due_first' THEN due_date END DESC NULLS LAST,
                CASE WHEN COALESCE(v_rules ->> 'allocation_order', 'oldest_due_first')
                          <> 'newest_due_first' THEN due_date END ASC NULLS LAST,
                seq
    LOOP
      EXIT WHEN v_left <= 0;
      v_take := LEAST(v_inv.balance, v_left);
      IF v_take > 0 THEN
        INSERT INTO public.fee_payment_allocations (payment_id, invoice_id, amount)
        VALUES (v_payment, v_inv.id, v_take);
        v_left := v_left - v_take;
      END IF;
    END LOOP;
  END IF;

  IF v_left > 0 THEN
    IF NOT COALESCE((v_rules ->> 'allow_overpayment')::BOOLEAN, true) THEN
      RAISE EXCEPTION 'This payment is % more than is outstanding, and overpayment is switched off', v_left;
    END IF;
    INSERT INTO public.fee_credits (student_id, academic_year_id, source_payment_id, amount, note)
    VALUES (p_student, p_year, v_payment, v_left, 'Paid more than was outstanding');
  END IF;

  IF v_status = 'verified' THEN
    PERFORM public.fee_post_ledger(p_student, p_year, 'payment', 0, p_amount,
      'fee_payments', v_payment, format('Receipt %s (%s)', v_number, p_method),
      v_paid_on, v_actor);
  END IF;

  v_hash := public.fee_seal_receipt(v_payment);

  PERFORM public.fee_log('payment.collect', 'fee_payments', v_payment, p_student, p_year,
                         NULL, jsonb_build_object('receipt_no', v_number, 'method', p_method,
                                                  'status', v_status),
                         NULL, p_amount, v_actor);

  RETURN jsonb_build_object(
    'payment_id', v_payment, 'receipt_no', v_number, 'seq', v_seq,
    'status', v_status, 'receipt_hash', v_hash,
    'allocated', p_amount - v_left, 'credited', v_left, 'instrument_id', v_instrument);
END $$;

CREATE OR REPLACE FUNCTION public.fee_reverse_payment(
  p_payment UUID, p_reason TEXT, p_actor UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p public.fee_payments%ROWTYPE; v_actor UUID := public.fee_actor(p_actor);
BEGIN
  IF NOT public.fee_requires('fees.payment.reverse') THEN
    RAISE EXCEPTION 'You do not have permission to reverse a payment';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A reversal needs a written reason';
  END IF;
  SELECT * INTO v_p FROM public.fee_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such payment'; END IF;
  IF v_p.status = 'reversed' THEN RAISE EXCEPTION 'That payment is already reversed'; END IF;

  UPDATE public.fee_payments
     SET status = 'reversed', reversed_by = v_actor,
         reversed_at = NOW(), reversal_reason = btrim(p_reason)
   WHERE id = p_payment;

  DELETE FROM public.fee_credits WHERE source_payment_id = p_payment AND consumed = 0;

  IF v_p.status = 'verified' THEN
    PERFORM public.fee_post_ledger(v_p.student_id, v_p.academic_year_id, 'reversal',
      v_p.amount, 0, 'fee_payments', p_payment,
      format('Reversal of receipt %s — %s', v_p.receipt_no, btrim(p_reason)), NULL, v_actor);
  END IF;

  PERFORM public.fee_log('payment.reverse', 'fee_payments', p_payment,
                         v_p.student_id, v_p.academic_year_id,
                         jsonb_build_object('status', v_p.status, 'receipt_no', v_p.receipt_no),
                         jsonb_build_object('status', 'reversed'),
                         btrim(p_reason), v_p.amount, v_actor);

  RETURN jsonb_build_object('payment_id', p_payment, 'receipt_no', v_p.receipt_no,
                            'reopened', (SELECT count(*) FROM public.fee_payment_allocations
                                          WHERE payment_id = p_payment));
END $$;

-- ── Concessions: approval asks about the person, not the service role ───
CREATE OR REPLACE FUNCTION public.fee_apply_concession(
  p_invoice UUID, p_kind TEXT, p_amount NUMERIC, p_type UUID DEFAULT NULL,
  p_scholarship UUID DEFAULT NULL, p_head UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL, p_label TEXT DEFAULT NULL, p_actor UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := public.fee_actor(p_actor);
  v_inv public.fee_invoices%ROWTYPE; v_type public.fee_discount_types%ROWTYPE;
  v_threshold NUMERIC; v_needs BOOLEAN; v_status TEXT; v_label TEXT;
  v_id UUID; v_line UUID; v_existing NUMERIC;
BEGIN
  IF p_kind = 'waiver' THEN
    IF NOT public.fee_requires('fees.waiver.approve') AND NOT public.fee_requires('fees.discount.apply') THEN
      RAISE EXCEPTION 'You do not have permission to record a waiver';
    END IF;
  ELSIF NOT public.fee_requires('fees.discount.apply') AND NOT public.fee_requires('fees.scholarship.manage') THEN
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

  SELECT COALESCE(-SUM(amount), 0) INTO v_existing
    FROM public.fee_invoice_lines
   WHERE invoice_id = p_invoice AND kind IN ('discount', 'scholarship', 'waiver');

  IF p_amount > v_inv.net THEN
    RAISE EXCEPTION 'That is more than the % left on this bill. A concession cannot make a bill negative.',
      to_char(v_inv.net, 'FM999999990.00');
  END IF;

  IF p_type IS NOT NULL THEN
    SELECT * INTO v_type FROM public.fee_discount_types WHERE id = p_type;
    IF FOUND AND NOT v_type.stackable AND v_existing > 0 THEN
      RAISE EXCEPTION 'The % discount cannot be combined with another concession already on this bill.', v_type.name;
    END IF;
  END IF;

  v_threshold := COALESCE(
    v_type.approval_threshold,
    (public.fee_setting('approval_thresholds', v_inv.academic_year_id) ->>
      CASE WHEN p_kind = 'waiver' THEN 'waiver' ELSE 'discount' END)::NUMERIC, 0);
  v_needs := p_amount > v_threshold OR v_threshold = 0;

  -- The person applying it holds the approve permission, so there is no point
  -- queueing it for their own signature. fee_actor_can, not fee_requires:
  -- a service-role route must not auto-approve on a clerk's behalf.
  IF v_needs AND (
       (p_kind = 'waiver'  AND public.fee_actor_can(v_actor, 'fees.waiver.approve')) OR
       (p_kind <> 'waiver' AND public.fee_actor_can(v_actor, 'fees.discount.approve'))) THEN
    v_needs := false;
  END IF;

  v_status := CASE WHEN v_needs THEN 'pending' ELSE 'applied' END;
  v_label := COALESCE(NULLIF(btrim(p_label), ''), v_type.name,
                      (SELECT name FROM public.fee_scholarships WHERE id = p_scholarship),
                      initcap(p_kind));

  INSERT INTO public.fee_concessions (
    student_id, academic_year_id, kind, type_id, scholarship_id, invoice_id,
    fee_head_id, amount, reason, status, requested_by, approved_by, approved_at)
  VALUES (v_inv.student_id, v_inv.academic_year_id, p_kind, p_type, p_scholarship, p_invoice,
    p_head, p_amount, p_reason, v_status, v_actor,
    CASE WHEN NOT v_needs THEN v_actor END,
    CASE WHEN NOT v_needs THEN NOW() END)
  RETURNING id INTO v_id;

  IF NOT v_needs THEN
    INSERT INTO public.fee_invoice_lines (invoice_id, kind, fee_head_id, label, amount, source_id, note, sort)
    VALUES (p_invoice, p_kind, p_head, v_label, -p_amount, v_id, p_reason, 700)
    RETURNING id INTO v_line;
    UPDATE public.fee_concessions SET line_id = v_line WHERE id = v_id;
    PERFORM public.fee_post_ledger(v_inv.student_id, v_inv.academic_year_id, 'adjustment', 0, p_amount,
      'fee_concessions', v_id, format('%s on %s — %s', v_label, v_inv.number,
                                      COALESCE(p_reason, 'no reason given')), NULL, v_actor);
  END IF;

  PERFORM public.fee_log(
    CASE WHEN v_needs THEN 'concession.request' ELSE 'concession.apply' END,
    'fee_concessions', v_id, v_inv.student_id, v_inv.academic_year_id,
    NULL, jsonb_build_object('kind', p_kind, 'invoice', v_inv.number, 'label', v_label),
    p_reason, p_amount, v_actor);

  RETURN jsonb_build_object('concession_id', v_id, 'status', v_status, 'line_id', v_line,
                            'needs_approval', v_needs, 'label', v_label);
END $$;

CREATE OR REPLACE FUNCTION public.fee_decide_concession(
  p_concession UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL, p_actor UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := public.fee_actor(p_actor);
  v_c public.fee_concessions%ROWTYPE; v_inv public.fee_invoices%ROWTYPE;
  v_line UUID; v_label TEXT;
BEGIN
  SELECT * INTO v_c FROM public.fee_concessions WHERE id = p_concession FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such concession'; END IF;
  IF v_c.status <> 'pending' THEN RAISE EXCEPTION 'That concession has already been decided'; END IF;

  -- The named person must hold it. An approval is a signature, and a service
  -- role cannot sign for somebody.
  IF v_c.kind = 'waiver' THEN
    IF NOT public.fee_actor_can(v_actor, 'fees.waiver.approve') THEN
      RAISE EXCEPTION 'You do not have permission to approve a waiver';
    END IF;
  ELSIF NOT public.fee_actor_can(v_actor, 'fees.discount.approve') THEN
    RAISE EXCEPTION 'You do not have permission to approve a concession';
  END IF;

  -- Nobody signs off their own request.
  IF v_c.requested_by IS NOT NULL AND v_c.requested_by = v_actor AND p_approve THEN
    RAISE EXCEPTION 'You raised this concession, so somebody else has to approve it.';
  END IF;

  IF NOT p_approve THEN
    UPDATE public.fee_concessions
       SET status = 'declined', approved_by = v_actor, approved_at = NOW(), decline_reason = p_note
     WHERE id = p_concession;
    PERFORM public.fee_log('concession.decline', 'fee_concessions', p_concession,
                           v_c.student_id, v_c.academic_year_id, NULL, NULL, p_note,
                           v_c.amount, v_actor);
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

  INSERT INTO public.fee_invoice_lines (invoice_id, kind, fee_head_id, label, amount, source_id, note, sort)
  VALUES (v_c.invoice_id, v_c.kind, v_c.fee_head_id, v_label, -v_c.amount, p_concession, v_c.reason, 700)
  RETURNING id INTO v_line;

  UPDATE public.fee_concessions
     SET status = 'applied', line_id = v_line, approved_by = v_actor, approved_at = NOW()
   WHERE id = p_concession;

  PERFORM public.fee_post_ledger(v_c.student_id, v_c.academic_year_id, 'adjustment', 0, v_c.amount,
    'fee_concessions', p_concession, format('%s approved on %s', v_label, v_inv.number),
    NULL, v_actor);
  PERFORM public.fee_log('concession.approve', 'fee_concessions', p_concession,
                         v_c.student_id, v_c.academic_year_id, NULL,
                         jsonb_build_object('invoice', v_inv.number), p_note, v_c.amount, v_actor);

  RETURN jsonb_build_object('status', 'applied', 'line_id', v_line);
END $$;

NOTIFY pgrst, 'reload schema';
