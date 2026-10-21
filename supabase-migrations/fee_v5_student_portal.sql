-- ─────────────────────────────────────────────────────────────────────────────
-- The student side of the fee app: their own figures, and paying online.
--
-- 1. Students see their own amounts.
--
--    The `_v` views wrap every money column in fee_visible_amount(), which
--    answers only to `fees.view_amounts` — a permission only an administrator
--    can hold (fee_restrict_to_admin_and_students.sql). So a student reading
--    their own bill got NULL for every figure, and "what do I owe" came back
--    as nothing. The two-argument form below also answers for the row's own
--    student. Everyone else is masked exactly as before.
--
-- 2. fee_online_orders.
--
--    A Razorpay order is created before the money moves, and the receipt can
--    only be numbered after it has. This table holds the order in between:
--    which bills it was for, how much, and what became of it. It is written
--    only by the API routes (service role); a student can read their own, so
--    the page can say "we are confirming this with the bank".
--
--    The settle step claims a row by moving it out of 'created' in one UPDATE,
--    so the browser's confirmation and Razorpay's webhook arriving together
--    cannot both record the payment.
--
--    No foreign keys: adding one locks profiles and fee_payments, which the
--    live app holds constantly, and the migration could not get the lock.
--    The API routes are the only writers and always set both from real rows.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fee_visible_amount(p_amount NUMERIC, p_student UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_student IS NOT NULL AND p_student = (SELECT auth.uid()) THEN p_amount
    ELSE public.fee_visible_amount(p_amount)
  END;
$$;

GRANT EXECUTE ON FUNCTION public.fee_visible_amount(NUMERIC, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fee_visible_amount(NUMERIC, UUID) FROM anon;

CREATE OR REPLACE VIEW public.fee_invoices_v WITH (security_invoker = true) AS
SELECT
  i.id, i.profile_id, i.student_id, i.academic_year_id, i.installment_id, i.number, i.seq,
  i.issue_date, i.due_date, i.status, i.autogen, i.verify_token, i.cancelled_reason,
  i.cancelled_by, i.cancelled_at, i.created_at, i.updated_at,
  public.fee_visible_amount(i.gross, i.student_id)          AS gross,
  public.fee_visible_amount(i.discount_total, i.student_id) AS discount_total,
  public.fee_visible_amount(i.tax_total, i.student_id)      AS tax_total,
  public.fee_visible_amount(i.late_fee_total, i.student_id) AS late_fee_total,
  public.fee_visible_amount(i.fine_total, i.student_id)     AS fine_total,
  public.fee_visible_amount(i.net, i.student_id)            AS net,
  public.fee_visible_amount(i.paid, i.student_id)           AS paid,
  public.fee_visible_amount(i.balance, i.student_id)        AS balance
FROM public.fee_invoices i;

CREATE OR REPLACE VIEW public.fee_payments_v WITH (security_invoker = true) AS
SELECT
  p.id, p.student_id, p.academic_year_id, p.receipt_no, p.seq, p.paid_on, p.method,
  p.reference, p.notes, p.instrument_id, p.status, p.collected_by, p.verified_by,
  p.verified_at, p.reversed_by, p.reversed_at, p.reversal_reason, p.receipt_hash,
  p.created_at, p.updated_at,
  public.fee_visible_amount(p.amount, p.student_id) AS amount
FROM public.fee_payments p;

CREATE OR REPLACE VIEW public.fee_ledger_v WITH (security_invoker = true) AS
SELECT
  l.id, l.student_id, l.academic_year_id, l.entry_date, l.kind, l.ref_table, l.ref_id,
  l.note, l.created_by, l.created_at,
  public.fee_visible_amount(l.debit, l.student_id)         AS debit,
  public.fee_visible_amount(l.credit, l.student_id)        AS credit,
  public.fee_visible_amount(l.balance_after, l.student_id) AS balance_after
FROM public.fee_ledger_entries l;

-- ── Online orders ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_online_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          UUID NOT NULL,
  academic_year_id    UUID NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'razorpay',
  order_id            TEXT NOT NULL UNIQUE,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  -- [{ invoice_id, amount }] — what the student chose to pay, at order time.
  allocations         JSONB NOT NULL DEFAULT '[]'::JSONB,
  status              TEXT NOT NULL DEFAULT 'created'
                      CHECK (status IN ('created', 'processing', 'paid', 'failed', 'review')),
  provider_payment_id TEXT,
  payment_id          UUID,
  receipt_no          TEXT,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fee_online_orders_student_idx
  ON public.fee_online_orders (student_id, created_at DESC);

ALTER TABLE public.fee_online_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own online fee orders" ON public.fee_online_orders;
CREATE POLICY "Read own online fee orders" ON public.fee_online_orders
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'));

-- Writes come from the API routes only.
REVOKE ALL ON public.fee_online_orders FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.fee_online_orders FROM authenticated;
GRANT SELECT ON public.fee_online_orders TO authenticated;

NOTIFY pgrst, 'reload schema';
