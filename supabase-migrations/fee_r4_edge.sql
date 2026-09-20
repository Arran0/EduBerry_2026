-- ─────────────────────────────────────────────────────────────────────────────
-- Round 4 — the edges.
--
-- Refunds, opening balances carried from a previous year, and the RTE register.
-- These are the cases that break simpler software: money going out rather than
-- in, a debt that predates the session it is being collected in, and a fee the
-- government is meant to reimburse rather than a family.
--
-- Everything here posts to fee_ledger_entries like everything else, so no
-- report has to know these exist to be right about the totals.
-- ─────────────────────────────────────────────────────────────────────────────

-- An RTE reimbursement is money in from the state rather than from a family,
-- and reports want it apart from a parent's payment. Extending the ledger's
-- kind list is part of this migration rather than a later patch, because
-- fee_record_rte below posts one.
ALTER TABLE public.fee_ledger_entries DROP CONSTRAINT IF EXISTS fee_ledger_entries_kind_check;
ALTER TABLE public.fee_ledger_entries ADD CONSTRAINT fee_ledger_entries_kind_check
  CHECK (kind IN ('invoice','payment','reversal','credit','credit_used',
                  'opening_balance','refund','adjustment','bounce_charge',
                  'rte_reimbursement'));

-- ── Refunds ─────────────────────────────────────────────────────────────
-- Money leaving the school. Request, approve, pay out — three states with
-- three different people, because a single-step refund is how a fee office
-- loses money quietly.
CREATE TABLE IF NOT EXISTS public.fee_refunds (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year_id  UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason            TEXT NOT NULL,
  -- The receipt the money originally came in on, when there is one. A refund
  -- of a specific payment can be checked against it; a goodwill refund cannot.
  source_payment_id UUID REFERENCES public.fee_payments(id) ON DELETE SET NULL,
  -- A credit balance can be refunded instead of carried. This is the credit
  -- row it consumes, so the same rupee cannot both be refunded and applied.
  source_credit_id  UUID REFERENCES public.fee_credits(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested','approved','declined','paid_out','cancelled')),
  method            TEXT CHECK (method IN ('cash','bank_transfer','cheque','upi','adjustment')),
  reference         TEXT,
  requested_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  decline_reason    TEXT,
  paid_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  paid_at           TIMESTAMPTZ,
  paid_on           DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_refunds_student ON public.fee_refunds(student_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_refunds_status  ON public.fee_refunds(status) WHERE status IN ('requested','approved');

DROP TRIGGER IF EXISTS fee_refunds_touch ON public.fee_refunds;
CREATE TRIGGER fee_refunds_touch BEFORE UPDATE ON public.fee_refunds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Opening balances ────────────────────────────────────────────────────
-- What a family already owed when a session began. Its own table rather than
-- only the column on fee_profiles, because the carry-forward has to name the
-- year the debt came from — "₹4,200 outstanding" is unanswerable, "₹4,200 from
-- 2025-26, term 3" is a conversation.
CREATE TABLE IF NOT EXISTS public.fee_opening_balances (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year_id  UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  amount            NUMERIC(12,2) NOT NULL,
  source_year_id    UUID REFERENCES public.academic_years(id) ON DELETE SET NULL,
  note              TEXT,
  posted            BOOLEAN NOT NULL DEFAULT false,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, academic_year_id)
);

-- ── The RTE register ────────────────────────────────────────────────────
-- Section 12(1)(c) seats. The school does not bill the family; it claims from
-- the state, and the gap between claimed and reimbursed is real money the
-- reports must not treat as a defaulting parent.
CREATE TABLE IF NOT EXISTS public.fee_rte_register (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year_id   UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  category           TEXT NOT NULL DEFAULT 'rte_25'
                       CHECK (category IN ('rte_25','ews','dg','staff_ward','other')),
  claim_period       TEXT,
  claimed_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  reimbursed_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  reimbursed_on      DATE,
  government_ref     TEXT,
  status             TEXT NOT NULL DEFAULT 'enrolled'
                       CHECK (status IN ('enrolled','claimed','part_reimbursed','reimbursed','rejected')),
  notes              TEXT,
  created_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, academic_year_id, claim_period)
);

CREATE INDEX IF NOT EXISTS idx_fee_rte_year ON public.fee_rte_register(academic_year_id, status);

DROP TRIGGER IF EXISTS fee_rte_touch ON public.fee_rte_register;
CREATE TRIGGER fee_rte_touch BEFORE UPDATE ON public.fee_rte_register
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Requesting a refund ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_request_refund(
  p_student  UUID,
  p_year     UUID,
  p_amount   NUMERIC,
  p_reason   TEXT,
  p_payment  UUID DEFAULT NULL,
  p_credit   UUID DEFAULT NULL,
  p_actor    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID := public.fee_actor(p_actor);
  v_id       UUID;
  v_credit   NUMERIC;
  v_balance  NUMERIC;
BEGIN
  IF NOT public.fee_requires('fees.refund.approve')
     AND NOT public.fee_actor_can(p_actor, 'fees.collect') THEN
    RAISE EXCEPTION 'You cannot request a refund.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A refund needs an amount.';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A refund needs a reason. It is money leaving the school.';
  END IF;

  -- A refund against a credit cannot exceed what is left of it.
  IF p_credit IS NOT NULL THEN
    SELECT amount - COALESCE(consumed, 0) INTO v_credit
      FROM public.fee_credits WHERE id = p_credit FOR UPDATE;
    IF v_credit IS NULL THEN
      RAISE EXCEPTION 'That credit does not exist.';
    END IF;
    IF p_amount > v_credit THEN
      RAISE EXCEPTION 'Only % is left on that credit.', v_credit;
    END IF;
  END IF;

  -- Refunding a family that still owes money is almost always a mistake, so
  -- say so rather than discovering it in a reconciliation next month.
  SELECT COALESCE(SUM(balance), 0) INTO v_balance
    FROM public.fee_invoices
   WHERE student_id = p_student AND academic_year_id = p_year
     AND status <> 'cancelled';

  INSERT INTO public.fee_refunds (
    student_id, academic_year_id, amount, reason, source_payment_id,
    source_credit_id, requested_by)
  VALUES (p_student, p_year, p_amount, btrim(p_reason), p_payment, p_credit, v_actor)
  RETURNING id INTO v_id;

  PERFORM public.fee_log('refund.request', 'fee_refunds', v_id, p_student, p_year,
                         NULL, NULL, btrim(p_reason), p_amount, v_actor);

  RETURN jsonb_build_object(
    'refund_id', v_id,
    'status', 'requested',
    'still_owing', v_balance,
    'warning', CASE WHEN v_balance > 0
                    THEN format('This family still owes %s on other bills.', v_balance)
               END);
END $$;

-- ── Approving or declining ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_decide_refund(
  p_refund   UUID,
  p_approve  BOOLEAN,
  p_note     TEXT DEFAULT NULL,
  p_actor    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.fee_actor(p_actor);
  v_r     public.fee_refunds%ROWTYPE;
BEGIN
  IF NOT public.fee_actor_can(p_actor, 'fees.refund.approve') THEN
    RAISE EXCEPTION 'You cannot approve refunds.';
  END IF;

  SELECT * INTO v_r FROM public.fee_refunds WHERE id = p_refund FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'No such refund.'; END IF;
  IF v_r.status <> 'requested' THEN
    RAISE EXCEPTION 'That refund has already been decided (%).', v_r.status;
  END IF;
  -- The same rule as concessions: nobody signs off their own request.
  IF v_r.requested_by IS NOT NULL AND v_r.requested_by = v_actor THEN
    RAISE EXCEPTION 'You cannot approve a refund you requested yourself.';
  END IF;

  UPDATE public.fee_refunds
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
         approved_by = v_actor, approved_at = NOW(),
         decline_reason = CASE WHEN p_approve THEN NULL ELSE p_note END
   WHERE id = p_refund;

  PERFORM public.fee_log(
    CASE WHEN p_approve THEN 'refund.approve' ELSE 'refund.decline' END,
    'fee_refunds', p_refund, v_r.student_id, v_r.academic_year_id,
    NULL, NULL, p_note, v_r.amount, v_actor);

  RETURN jsonb_build_object('status', CASE WHEN p_approve THEN 'approved' ELSE 'declined' END);
END $$;

-- ── Paying it out ───────────────────────────────────────────────────────
-- The only step that moves money. It posts a debit to the ledger, because a
-- refund makes the family owe more than they did a moment ago — that is what
-- "we gave it back" means in double entry.
CREATE OR REPLACE FUNCTION public.fee_pay_refund(
  p_refund     UUID,
  p_method     TEXT,
  p_reference  TEXT DEFAULT NULL,
  p_paid_on    DATE DEFAULT NULL,
  p_actor      UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := public.fee_actor(p_actor);
  v_r     public.fee_refunds%ROWTYPE;
  v_on    DATE := COALESCE(p_paid_on, CURRENT_DATE);
BEGIN
  IF NOT public.fee_actor_can(p_actor, 'fees.refund.approve') THEN
    RAISE EXCEPTION 'You cannot pay out refunds.';
  END IF;

  SELECT * INTO v_r FROM public.fee_refunds WHERE id = p_refund FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'No such refund.'; END IF;
  IF v_r.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved refund can be paid out (this one is %).', v_r.status;
  END IF;

  -- Consume the credit it came from, so the same money cannot also be applied
  -- to the next bill.
  IF v_r.source_credit_id IS NOT NULL THEN
    UPDATE public.fee_credits
       SET consumed = COALESCE(consumed, 0) + v_r.amount
     WHERE id = v_r.source_credit_id;
  END IF;

  UPDATE public.fee_refunds
     SET status = 'paid_out', method = p_method, reference = p_reference,
         paid_by = v_actor, paid_at = NOW(), paid_on = v_on
   WHERE id = p_refund;

  PERFORM public.fee_post_ledger(
    v_r.student_id, v_r.academic_year_id, 'refund', v_r.amount, 0,
    'fee_refunds', p_refund,
    format('Refund paid out by %s%s', p_method,
           CASE WHEN p_reference IS NULL THEN '' ELSE ' · ' || p_reference END),
    v_on, v_actor);

  PERFORM public.fee_log('refund.pay', 'fee_refunds', p_refund, v_r.student_id,
                         v_r.academic_year_id, NULL,
                         jsonb_build_object('method', p_method, 'reference', p_reference),
                         v_r.reason, v_r.amount, v_actor);

  RETURN jsonb_build_object('status', 'paid_out', 'paid_on', v_on);
END $$;

-- ── Carrying dues forward on promotion ──────────────────────────────────
-- What a student still owed at the end of one session becomes their opening
-- balance in the next. Preview first (p_commit false) — this writes a debt
-- against real families and the number should be looked at before it lands.
CREATE OR REPLACE FUNCTION public.fee_carry_forward(
  p_from    UUID,
  p_to      UUID,
  p_commit  BOOLEAN DEFAULT false,
  p_actor   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID := public.fee_actor(p_actor);
  v_students INT := 0;
  v_total    NUMERIC := 0;
  v_row      RECORD;
BEGIN
  IF NOT public.fee_requires('fees.config.clone_year') THEN
    RAISE EXCEPTION 'You cannot carry balances between sessions.';
  END IF;
  IF p_from = p_to THEN
    RAISE EXCEPTION 'A session cannot carry forward into itself.';
  END IF;

  FOR v_row IN
    SELECT i.student_id, SUM(i.balance) AS owed
      FROM public.fee_invoices i
     WHERE i.academic_year_id = p_from
       AND i.status <> 'cancelled'
       AND i.balance > 0
     GROUP BY i.student_id
     HAVING SUM(i.balance) > 0
  LOOP
    v_students := v_students + 1;
    v_total := v_total + v_row.owed;

    IF p_commit THEN
      INSERT INTO public.fee_opening_balances (
        student_id, academic_year_id, amount, source_year_id, note, posted, created_by)
      VALUES (v_row.student_id, p_to, v_row.owed, p_from,
              format('Carried forward from %s',
                     (SELECT code FROM public.academic_years WHERE id = p_from)),
              true, v_actor)
      ON CONFLICT (student_id, academic_year_id) DO UPDATE
        SET amount = EXCLUDED.amount, source_year_id = EXCLUDED.source_year_id,
            note = EXCLUDED.note;

      -- Mirror it onto the profile, which is what the invoice engine reads.
      UPDATE public.fee_profiles
         SET opening_balance = v_row.owed
       WHERE student_id = v_row.student_id AND academic_year_id = p_to;

      PERFORM public.fee_post_ledger(
        v_row.student_id, p_to, 'opening_balance', v_row.owed, 0,
        'fee_opening_balances', NULL,
        format('Brought forward from %s',
               (SELECT code FROM public.academic_years WHERE id = p_from)),
        (SELECT starts_on FROM public.academic_years WHERE id = p_to), v_actor);
    END IF;
  END LOOP;

  IF p_commit THEN
    PERFORM public.fee_log('year.carry_forward', 'academic_years', p_to, NULL, p_to,
                           jsonb_build_object('from', p_from),
                           jsonb_build_object('students', v_students), NULL, v_total, v_actor);
  END IF;

  RETURN jsonb_build_object(
    'committed', p_commit, 'students', v_students, 'total', v_total);
END $$;

-- ── RTE claims ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_record_rte(
  p_student     UUID,
  p_year        UUID,
  p_claimed     NUMERIC DEFAULT NULL,
  p_reimbursed  NUMERIC DEFAULT NULL,
  p_period      TEXT DEFAULT NULL,
  p_ref         TEXT DEFAULT NULL,
  p_on          DATE DEFAULT NULL,
  p_actor       UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  UUID := public.fee_actor(p_actor);
  v_id     UUID;
  v_status TEXT;
  v_claim  NUMERIC;
  v_reimb  NUMERIC;
BEGIN
  IF NOT public.fee_actor_can(p_actor, 'fees.rte.manage')
     AND NOT public.fee_requires('fees.rte.manage') THEN
    RAISE EXCEPTION 'You cannot manage the RTE register.';
  END IF;

  INSERT INTO public.fee_rte_register (
    student_id, academic_year_id, claim_period, claimed_amount,
    reimbursed_amount, reimbursed_on, government_ref, created_by)
  VALUES (p_student, p_year, p_period, COALESCE(p_claimed, 0),
          COALESCE(p_reimbursed, 0), p_on, p_ref, v_actor)
  ON CONFLICT (student_id, academic_year_id, claim_period) DO UPDATE
    SET claimed_amount    = COALESCE(p_claimed, public.fee_rte_register.claimed_amount),
        reimbursed_amount = COALESCE(p_reimbursed, public.fee_rte_register.reimbursed_amount),
        reimbursed_on     = COALESCE(p_on, public.fee_rte_register.reimbursed_on),
        government_ref    = COALESCE(p_ref, public.fee_rte_register.government_ref)
  RETURNING id, claimed_amount, reimbursed_amount INTO v_id, v_claim, v_reimb;

  v_status := CASE
    WHEN v_reimb <= 0 AND v_claim <= 0 THEN 'enrolled'
    WHEN v_reimb <= 0                  THEN 'claimed'
    WHEN v_reimb >= v_claim            THEN 'reimbursed'
    ELSE 'part_reimbursed'
  END;
  UPDATE public.fee_rte_register SET status = v_status WHERE id = v_id;

  -- A reimbursement is money in, against a student the family was never
  -- billed for. It belongs on the ledger like any other receipt.
  IF COALESCE(p_reimbursed, 0) > 0 THEN
    PERFORM public.fee_post_ledger(
      p_student, p_year, 'rte_reimbursement', 0, p_reimbursed,
      'fee_rte_register', v_id,
      format('RTE reimbursement%s', CASE WHEN p_ref IS NULL THEN '' ELSE ' · ' || p_ref END),
      COALESCE(p_on, CURRENT_DATE), v_actor);
  END IF;

  PERFORM public.fee_log('rte.record', 'fee_rte_register', v_id, p_student, p_year,
                         NULL, jsonb_build_object('status', v_status), p_ref,
                         COALESCE(p_reimbursed, p_claimed), v_actor);

  RETURN jsonb_build_object('id', v_id, 'status', v_status,
                            'claimed', v_claim, 'reimbursed', v_reimb);
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.fee_refunds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_rte_register     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read refunds" ON public.fee_refunds;
CREATE POLICY "Read refunds" ON public.fee_refunds
  FOR SELECT TO authenticated
  USING (public.has_fee_permission_for(auth.uid(), 'fees.profile.view')
         OR student_id = auth.uid());

DROP POLICY IF EXISTS "Read opening balances" ON public.fee_opening_balances;
CREATE POLICY "Read opening balances" ON public.fee_opening_balances
  FOR SELECT TO authenticated
  USING (public.has_fee_permission_for(auth.uid(), 'fees.profile.view')
         OR student_id = auth.uid());

DROP POLICY IF EXISTS "Read RTE register" ON public.fee_rte_register;
CREATE POLICY "Read RTE register" ON public.fee_rte_register
  FOR SELECT TO authenticated
  USING (public.has_fee_permission_for(auth.uid(), 'fees.rte.manage')
         OR public.has_fee_permission_for(auth.uid(), 'fees.reports.view'));

-- Writes go through the RPCs above, which check the permission themselves and
-- run as SECURITY DEFINER. No table-level INSERT/UPDATE policy exists on
-- purpose: a client that could write these directly could pay itself a refund.

GRANT SELECT ON public.fee_refunds, public.fee_opening_balances,
                public.fee_rte_register TO authenticated;

-- ── Grants ──────────────────────────────────────────────────────────────
-- REVOKE FROM PUBLIC first; revoking from anon and authenticated alone is a
-- no-op while PostgreSQL's default PUBLIC grant still stands.
REVOKE ALL ON FUNCTION public.fee_request_refund(UUID, UUID, NUMERIC, TEXT, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fee_decide_refund(UUID, BOOLEAN, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fee_pay_refund(UUID, TEXT, TEXT, DATE, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fee_carry_forward(UUID, UUID, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fee_record_rte(UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, DATE, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fee_request_refund(UUID, UUID, NUMERIC, TEXT, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_decide_refund(UUID, BOOLEAN, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_pay_refund(UUID, TEXT, TEXT, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_carry_forward(UUID, UUID, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_record_rte(UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, DATE, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
