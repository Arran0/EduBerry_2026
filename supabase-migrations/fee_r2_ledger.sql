-- ============================================================================
-- fee_r2_ledger — the append-only money story, and the operations that write it
-- ============================================================================
-- Round 2 of docs/fee-upgrade-plan.md. Run after fee_r2_payments.sql.
-- Safe to re-run.
--
-- Reports read the ledger, not a SUM over mutable rows. That is what makes
-- "the money always adds up" a property of the database rather than a claim a
-- report makes about itself: a bill, a payment, a reversal and a credit all
-- land here as ordered entries with a running balance, and nothing can edit one
-- afterwards.
--
-- The three operations below — collect, reverse, bounce — are RPCs rather than
-- a sequence of client writes because each has to be all-or-nothing. A payment
-- that got a receipt number but no allocation, or an allocation with no ledger
-- entry, is a discrepancy nobody can later explain.

CREATE TABLE IF NOT EXISTS public.fee_ledger_entries (
  id               BIGSERIAL PRIMARY KEY,
  student_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  entry_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  kind             TEXT NOT NULL
                   CHECK (kind IN ('invoice','payment','reversal','credit','credit_used',
                                   'opening_balance','refund','adjustment','bounce_charge')),
  ref_table        TEXT,
  ref_id           UUID,
  -- Debit increases what the family owes; credit reduces it. Exactly one of the
  -- two is non-zero on any entry.
  debit            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  balance_after    NUMERIC(12,2) NOT NULL,
  note             TEXT,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((debit = 0) <> (credit = 0) OR (debit = 0 AND credit = 0))
);

CREATE INDEX IF NOT EXISTS idx_fee_ledger_student
  ON public.fee_ledger_entries(student_id, academic_year_id, id);
CREATE INDEX IF NOT EXISTS idx_fee_ledger_date ON public.fee_ledger_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_fee_ledger_ref  ON public.fee_ledger_entries(ref_table, ref_id);

-- Same rule as fee_audit_log: never editable, deletable only past the
-- seven-year statutory window and only from a service context.
CREATE OR REPLACE FUNCTION public.fee_ledger_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'The fee ledger is append-only. Post a correcting entry instead.';
  END IF;
  IF NOT public.fee_is_service_context() THEN
    RAISE EXCEPTION 'The fee ledger cannot be deleted from';
  END IF;
  IF OLD.created_at > NOW() - INTERVAL '7 years' THEN
    RAISE EXCEPTION 'Ledger entries are kept for seven years; this one is from %', OLD.created_at::DATE;
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS fee_ledger_no_edit ON public.fee_ledger_entries;
CREATE TRIGGER fee_ledger_no_edit BEFORE UPDATE OR DELETE ON public.fee_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.fee_ledger_append_only();

-- The only way anything reaches the ledger. Computes the running balance under
-- a per-student lock so two concurrent collections cannot interleave and
-- produce two entries claiming the same balance_after.
CREATE OR REPLACE FUNCTION public.fee_post_ledger(
  p_student UUID, p_year UUID, p_kind TEXT,
  p_debit NUMERIC DEFAULT 0, p_credit NUMERIC DEFAULT 0,
  p_ref_table TEXT DEFAULT NULL, p_ref_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL, p_date DATE DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC(12,2);
  v_id      BIGINT;
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
          COALESCE(p_debit, 0), COALESCE(p_credit, 0), v_balance, p_note, (SELECT auth.uid()))
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- ── Collect ─────────────────────────────────────────────────────────────
-- Everything a counter payment must do, in one transaction: number it, allocate
-- it across the bills, seal the receipt, post the ledger, bank any overpayment
-- as a credit, and log it. Any failure rolls the whole thing back, so there is
-- never a receipt number without a payment behind it.
CREATE OR REPLACE FUNCTION public.fee_collect(
  p_student      UUID,
  p_year         UUID,
  p_amount       NUMERIC,
  p_method       TEXT,
  p_allocations  JSONB DEFAULT NULL,   -- [{invoice_id, amount}]; null = automatic
  p_paid_on      DATE DEFAULT NULL,
  p_reference    TEXT DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL,
  p_instrument   JSONB DEFAULT NULL,   -- cheque/DD details
  p_status       TEXT DEFAULT NULL     -- 'verified' by default; 'pending' for a PDC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules      JSONB := COALESCE(public.fee_setting('payment_rules', p_year), '{}'::JSONB);
  v_paid_on    DATE  := COALESCE(p_paid_on, CURRENT_DATE);
  v_status     TEXT  := COALESCE(p_status, 'verified');
  v_payment    UUID;
  v_seq        BIGINT;
  v_number     TEXT;
  v_instrument UUID;
  v_left       NUMERIC(12,2) := p_amount;
  v_take       NUMERIC(12,2);
  v_alloc      JSONB;
  v_inv        RECORD;
  v_hash       TEXT;
  v_backdays   INT := COALESCE((v_rules ->> 'allow_backdated_days')::INT, 30);
BEGIN
  IF NOT public.fee_requires('fees.collect') THEN
    RAISE EXCEPTION 'You do not have permission to take a payment';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A payment must be for more than zero';
  END IF;

  IF v_paid_on < CURRENT_DATE THEN
    IF NOT public.fee_requires('fees.collect.backdate') THEN
      RAISE EXCEPTION 'You do not have permission to backdate a payment';
    END IF;
    IF v_paid_on < CURRENT_DATE - v_backdays THEN
      RAISE EXCEPTION 'A payment cannot be dated more than % days back', v_backdays;
    END IF;
  END IF;
  IF v_paid_on > CURRENT_DATE THEN
    RAISE EXCEPTION 'A payment cannot be dated in the future';
  END IF;

  -- Cheque or DD: record the instrument first so the payment can point at it.
  IF p_instrument IS NOT NULL AND p_instrument <> 'null'::JSONB THEN
    INSERT INTO public.fee_instruments (
      student_id, kind, number, bank, branch, account_holder, amount,
      instrument_date, is_postdated, present_on, created_by, timeline)
    VALUES (
      p_student,
      COALESCE(p_instrument ->> 'kind', 'cheque'),
      p_instrument ->> 'number',
      p_instrument ->> 'bank',
      p_instrument ->> 'branch',
      p_instrument ->> 'account_holder',
      p_amount,
      NULLIF(p_instrument ->> 'instrument_date', '')::DATE,
      COALESCE((p_instrument ->> 'is_postdated')::BOOLEAN, false),
      NULLIF(p_instrument ->> 'present_on', '')::DATE,
      (SELECT auth.uid()),
      jsonb_build_array(jsonb_build_object(
        'at', NOW(), 'to', 'received', 'by', (SELECT auth.uid())))
    )
    RETURNING id INTO v_instrument;

    -- An uncleared instrument has not settled anything. Leaving the payment
    -- pending is what stops a bill reading "paid" on the strength of a cheque
    -- that has not been presented yet.
    IF COALESCE((p_instrument ->> 'is_postdated')::BOOLEAN, false) THEN
      v_status := 'pending';
    END IF;
  END IF;

  SELECT seq, formatted INTO v_seq, v_number FROM public.fee_next_number('receipt', p_year);

  INSERT INTO public.fee_payments (
    student_id, academic_year_id, receipt_no, seq, paid_on, method, amount,
    reference, notes, instrument_id, status, collected_by,
    verified_by, verified_at)
  VALUES (
    p_student, p_year, v_number, v_seq, v_paid_on, p_method, p_amount,
    p_reference, p_notes, v_instrument, v_status, (SELECT auth.uid()),
    CASE WHEN v_status = 'verified' THEN (SELECT auth.uid()) END,
    CASE WHEN v_status = 'verified' THEN NOW() END)
  RETURNING id INTO v_payment;

  -- Allocate. An explicit list from the clerk wins; otherwise fill the bills in
  -- the order the school configured.
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

  -- Anything left over is a credit against the next bill, not a rounding error
  -- and not money quietly kept.
  IF v_left > 0 THEN
    IF NOT COALESCE((v_rules ->> 'allow_overpayment')::BOOLEAN, true) THEN
      RAISE EXCEPTION 'This payment is % more than is outstanding, and overpayment is switched off', v_left;
    END IF;
    INSERT INTO public.fee_credits (student_id, academic_year_id, source_payment_id, amount, note)
    VALUES (p_student, p_year, v_payment, v_left, 'Paid more than was outstanding');
  END IF;

  IF v_status = 'verified' THEN
    PERFORM public.fee_post_ledger(
      p_student, p_year, 'payment', 0, p_amount,
      'fee_payments', v_payment,
      format('Receipt %s (%s)', v_number, p_method), v_paid_on);
  END IF;

  v_hash := public.fee_seal_receipt(v_payment);

  PERFORM public.fee_log('payment.collect', 'fee_payments', v_payment, p_student, p_year,
                         NULL, jsonb_build_object('receipt_no', v_number, 'method', p_method,
                                                  'status', v_status),
                         NULL, p_amount);

  RETURN jsonb_build_object(
    'payment_id', v_payment, 'receipt_no', v_number, 'seq', v_seq,
    'status', v_status, 'receipt_hash', v_hash,
    'allocated', p_amount - v_left, 'credited', v_left,
    'instrument_id', v_instrument);
END $$;

-- ── Reverse ─────────────────────────────────────────────────────────────
-- Never a delete. The row keeps its number and gains a reason, an actor and a
-- timestamp; the bills it paid reopen; the ledger takes a contra entry; and the
-- receipt's QR starts answering REVERSED.
CREATE OR REPLACE FUNCTION public.fee_reverse_payment(p_payment UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_p public.fee_payments%ROWTYPE;
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
     SET status = 'reversed', reversed_by = (SELECT auth.uid()),
         reversed_at = NOW(), reversal_reason = btrim(p_reason)
   WHERE id = p_payment;

  -- Any credit the overpayment created goes with it; otherwise the family would
  -- keep a credit for money that has been taken back.
  DELETE FROM public.fee_credits
   WHERE source_payment_id = p_payment AND consumed = 0;

  IF v_p.status = 'verified' THEN
    PERFORM public.fee_post_ledger(
      v_p.student_id, v_p.academic_year_id, 'reversal', v_p.amount, 0,
      'fee_payments', p_payment,
      format('Reversal of receipt %s — %s', v_p.receipt_no, btrim(p_reason)));
  END IF;

  PERFORM public.fee_log('payment.reverse', 'fee_payments', p_payment,
                         v_p.student_id, v_p.academic_year_id,
                         jsonb_build_object('status', v_p.status, 'receipt_no', v_p.receipt_no),
                         jsonb_build_object('status', 'reversed'),
                         btrim(p_reason), v_p.amount);

  RETURN jsonb_build_object('payment_id', p_payment, 'receipt_no', v_p.receipt_no,
                            'reopened', (SELECT count(*) FROM public.fee_payment_allocations
                                          WHERE payment_id = p_payment));
END $$;

-- ── Cheque lifecycle ────────────────────────────────────────────────────
-- A bounce is the case that matters. It must reopen the bill and add the bank's
-- charge, and doing that by hand is how schools lose the money.
CREATE OR REPLACE FUNCTION public.fee_instrument_transition(
  p_instrument UUID, p_to TEXT, p_note TEXT DEFAULT NULL, p_bounce_charge NUMERIC DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i       public.fee_instruments%ROWTYPE;
  v_payment public.fee_payments%ROWTYPE;
  v_invoice UUID;
BEGIN
  IF NOT public.fee_requires('fees.instrument.manage') THEN
    RAISE EXCEPTION 'You do not have permission to handle cheques';
  END IF;

  SELECT * INTO v_i FROM public.fee_instruments WHERE id = p_instrument FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such instrument'; END IF;

  IF p_to NOT IN ('received','deposited','cleared','bounced','cancelled') THEN
    RAISE EXCEPTION 'Unknown instrument state: %', p_to;
  END IF;
  IF v_i.status IN ('cleared','bounced') AND p_to <> v_i.status THEN
    RAISE EXCEPTION 'A % cheque cannot be moved again', v_i.status;
  END IF;

  SELECT * INTO v_payment FROM public.fee_payments WHERE instrument_id = p_instrument LIMIT 1;

  UPDATE public.fee_instruments
     SET status = p_to,
         bounce_charge = CASE WHEN p_to = 'bounced' THEN p_bounce_charge ELSE bounce_charge END,
         bounce_reason = CASE WHEN p_to = 'bounced' THEN p_note ELSE bounce_reason END,
         timeline = timeline || jsonb_build_object(
           'at', NOW(), 'from', v_i.status, 'to', p_to,
           'by', (SELECT auth.uid()), 'note', p_note)
   WHERE id = p_instrument;

  IF v_payment.id IS NOT NULL THEN
    IF p_to = 'cleared' AND v_payment.status = 'pending' THEN
      UPDATE public.fee_payments
         SET status = 'verified', verified_by = (SELECT auth.uid()), verified_at = NOW()
       WHERE id = v_payment.id;
      PERFORM public.fee_post_ledger(
        v_payment.student_id, v_payment.academic_year_id, 'payment', 0, v_payment.amount,
        'fee_payments', v_payment.id,
        format('Cheque %s cleared (receipt %s)', v_i.number, v_payment.receipt_no));

    ELSIF p_to = 'bounced' THEN
      -- The bill reopens because the payment stops counting; that happens
      -- automatically through fee_refresh_invoice when the status changes.
      IF v_payment.status <> 'reversed' THEN
        UPDATE public.fee_payments
           SET status = 'reversed', reversed_by = (SELECT auth.uid()), reversed_at = NOW(),
               reversal_reason = COALESCE(NULLIF(btrim(p_note), ''),
                                          format('Cheque %s bounced', v_i.number))
         WHERE id = v_payment.id;

        IF v_payment.status = 'verified' THEN
          PERFORM public.fee_post_ledger(
            v_payment.student_id, v_payment.academic_year_id, 'reversal', v_payment.amount, 0,
            'fee_payments', v_payment.id,
            format('Cheque %s bounced — receipt %s reversed', v_i.number, v_payment.receipt_no));
        END IF;
      END IF;

      -- The bank's charge is passed on as a line on the bill the cheque was
      -- paying, so it is visible where the family will look for it.
      IF p_bounce_charge IS NOT NULL AND p_bounce_charge > 0 THEN
        SELECT invoice_id INTO v_invoice FROM public.fee_payment_allocations
         WHERE payment_id = v_payment.id ORDER BY amount DESC LIMIT 1;
        IF v_invoice IS NOT NULL THEN
          INSERT INTO public.fee_invoice_lines (invoice_id, kind, label, amount, sort, note)
          VALUES (v_invoice, 'fine',
                  format('Cheque return charge (%s)', v_i.number),
                  p_bounce_charge, 900, p_note);
        END IF;
        PERFORM public.fee_post_ledger(
          v_payment.student_id, v_payment.academic_year_id, 'bounce_charge',
          p_bounce_charge, 0, 'fee_instruments', p_instrument,
          format('Bank charge on returned cheque %s', v_i.number));
      END IF;
    END IF;
  END IF;

  PERFORM public.fee_log('instrument.' || p_to, 'fee_instruments', p_instrument,
                         v_i.student_id, NULL,
                         jsonb_build_object('status', v_i.status),
                         jsonb_build_object('status', p_to), p_note, v_i.amount);

  RETURN jsonb_build_object('instrument_id', p_instrument, 'status', p_to,
                            'payment_id', v_payment.id);
END $$;

-- ── Public verification ─────────────────────────────────────────────────
-- No login. Anyone holding the printed slip can check it — that is the point of
-- the QR, and it is the strongest anti-fraud measure in the module. It returns
-- only what is already on the paper, and re-computes the hash rather than
-- trusting the stored one, so an altered row shows as tampered.
CREATE OR REPLACE FUNCTION public.fee_verify_document(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_inv     RECORD;
  v_pay     RECORD;
  v_school  TEXT;
  v_recomputed TEXT;
BEGIN
  SELECT COALESCE(value ->> 'name', 'The school') INTO v_school
    FROM public.site_settings WHERE key = 'branding';

  SELECT i.number, i.issue_date, i.due_date, i.net, i.paid, i.balance, i.status,
         i.cancelled_reason, p.full_name
    INTO v_inv
    FROM public.fee_invoices i
    JOIN public.profiles p ON p.id = i.student_id
   WHERE i.verify_token = p_token;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'invoice',
      'valid', v_inv.status <> 'cancelled',
      'state', CASE WHEN v_inv.status = 'cancelled' THEN 'CANCELLED' ELSE 'VALID' END,
      'number', v_inv.number, 'student', v_inv.full_name,
      'issued_on', v_inv.issue_date, 'due_on', v_inv.due_date,
      'amount', v_inv.net, 'paid', v_inv.paid, 'balance', v_inv.balance,
      'status', v_inv.status, 'reason', v_inv.cancelled_reason, 'school', v_school);
  END IF;

  SELECT pay.id, pay.receipt_no, pay.paid_on, pay.amount, pay.method, pay.status,
         pay.reversal_reason, pay.receipt_hash, pr.full_name
    INTO v_pay
    FROM public.fee_payments pay
    JOIN public.profiles pr ON pr.id = pay.student_id
   WHERE pay.receipt_hash = p_token OR pay.id::TEXT = p_token;

  IF FOUND THEN
    v_recomputed := encode(digest(public.fee_receipt_payload(v_pay.id), 'sha256'), 'hex');
    RETURN jsonb_build_object(
      'kind', 'receipt',
      'valid', v_pay.status = 'verified' AND v_recomputed = v_pay.receipt_hash,
      'state', CASE
        WHEN v_pay.status = 'reversed' THEN 'CANCELLED'
        WHEN v_recomputed <> v_pay.receipt_hash THEN 'ALTERED'
        WHEN v_pay.status = 'pending' THEN 'NOT YET CLEARED'
        WHEN v_pay.status = 'verified' THEN 'VALID'
        ELSE 'NOT VALID' END,
      'number', v_pay.receipt_no, 'student', v_pay.full_name,
      'paid_on', v_pay.paid_on, 'amount', v_pay.amount, 'method', v_pay.method,
      'status', v_pay.status, 'reason', v_pay.reversal_reason, 'school', v_school);
  END IF;

  RETURN jsonb_build_object('kind', 'unknown', 'valid', false, 'state', 'NOT FOUND');
END $$;

-- ── Masking views ───────────────────────────────────────────────────────
-- Round 1 promised that a user without `fees.view_amounts` never receives an
-- amount. These are where that is kept: the money columns come back NULL, from
-- the database, so the figure is not in the response body at all.
CREATE OR REPLACE VIEW public.fee_invoices_v
WITH (security_invoker = true) AS
SELECT
  i.id, i.profile_id, i.student_id, i.academic_year_id, i.installment_id,
  i.number, i.seq, i.issue_date, i.due_date, i.status, i.autogen, i.verify_token,
  i.cancelled_reason, i.cancelled_by, i.cancelled_at, i.created_at, i.updated_at,
  public.fee_visible_amount(i.gross)          AS gross,
  public.fee_visible_amount(i.discount_total) AS discount_total,
  public.fee_visible_amount(i.tax_total)      AS tax_total,
  public.fee_visible_amount(i.late_fee_total) AS late_fee_total,
  public.fee_visible_amount(i.fine_total)     AS fine_total,
  public.fee_visible_amount(i.net)            AS net,
  public.fee_visible_amount(i.paid)           AS paid,
  public.fee_visible_amount(i.balance)        AS balance
FROM public.fee_invoices i;

CREATE OR REPLACE VIEW public.fee_payments_v
WITH (security_invoker = true) AS
SELECT
  p.id, p.student_id, p.academic_year_id, p.receipt_no, p.seq, p.paid_on,
  p.method, p.reference, p.notes, p.instrument_id, p.status,
  p.collected_by, p.verified_by, p.verified_at,
  p.reversed_by, p.reversed_at, p.reversal_reason, p.receipt_hash,
  p.created_at, p.updated_at,
  public.fee_visible_amount(p.amount) AS amount
FROM public.fee_payments p;

CREATE OR REPLACE VIEW public.fee_ledger_v
WITH (security_invoker = true) AS
SELECT
  l.id, l.student_id, l.academic_year_id, l.entry_date, l.kind,
  l.ref_table, l.ref_id, l.note, l.created_by, l.created_at,
  public.fee_visible_amount(l.debit)         AS debit,
  public.fee_visible_amount(l.credit)        AS credit,
  public.fee_visible_amount(l.balance_after) AS balance_after
FROM public.fee_ledger_entries l;

CREATE OR REPLACE VIEW public.fee_profiles_v
WITH (security_invoker = true) AS
SELECT
  f.id, f.student_id, f.academic_year_id, f.fee_group_id, f.structure_id,
  f.structure_source, f.status, f.prorate_from, f.is_rte, f.notes,
  f.created_by, f.created_at, f.updated_at,
  public.fee_visible_amount(f.opening_balance) AS opening_balance
FROM public.fee_profiles f;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.fee_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read fee ledger" ON public.fee_ledger_entries;
CREATE POLICY "Read fee ledger" ON public.fee_ledger_entries
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'));

-- No INSERT policy: everything posts through fee_post_ledger(), which is
-- SECURITY DEFINER, so a client cannot forge an entry or a balance.

GRANT SELECT ON public.fee_ledger_entries TO authenticated;
GRANT SELECT ON public.fee_invoices_v, public.fee_payments_v,
                public.fee_ledger_v, public.fee_profiles_v TO authenticated;

GRANT EXECUTE ON FUNCTION public.fee_verify_document(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fee_collect(UUID, UUID, NUMERIC, TEXT, JSONB, DATE, TEXT, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_reverse_payment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_instrument_transition(UUID, TEXT, TEXT, NUMERIC) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fee_post_ledger(UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, UUID, TEXT, DATE) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
