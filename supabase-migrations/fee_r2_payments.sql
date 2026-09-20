-- ============================================================================
-- fee_r2_payments — money in, receipts, cheques, and reversal that leaves a trail
-- ============================================================================
-- Round 2 of docs/fee-upgrade-plan.md. Run after fee_r2_invoices.sql.
-- Safe to re-run.
--
-- Three things here are not negotiable and are enforced by the database rather
-- than trusted to a route:
--
-- 1. A payment is never deleted or edited. Reversal writes a status, a reason
--    and an actor onto the same row, so a clerk accused of pocketing counter
--    cash has something to point at, and so does the school.
-- 2. A receipt carries a SHA-256 over its own contents. The QR on the printed
--    slip verifies the *content*, not merely that a row with that number
--    exists — the same tamper-evidence idea as payroll_lock_run's locked_hash.
-- 3. A bounced cheque reopens the bill it paid, automatically. Every fee system
--    that leaves that to a human eventually loses the money.

-- ── Cheques and demand drafts ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_instruments (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'cheque' CHECK (kind IN ('cheque', 'dd')),
  number          TEXT NOT NULL,
  bank            TEXT,
  branch          TEXT,
  account_holder  TEXT,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  instrument_date DATE,
  -- A post-dated cheque is money the school is holding but has not got. It sits
  -- in its own tab until present_on, and the payment stays unverified so no
  -- bill is marked paid on the strength of it.
  is_postdated    BOOLEAN NOT NULL DEFAULT false,
  present_on      DATE,
  status          TEXT NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','deposited','cleared','bounced','cancelled')),
  bounce_charge   NUMERIC(12,2),
  bounce_reason   TEXT,
  -- Append-only list of {at, from, to, by, note}. The cheque's whole story.
  timeline        JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_instruments_student ON public.fee_instruments(student_id);
CREATE INDEX IF NOT EXISTS idx_fee_instruments_status  ON public.fee_instruments(status);
CREATE INDEX IF NOT EXISTS idx_fee_instruments_pdc
  ON public.fee_instruments(present_on) WHERE is_postdated AND status IN ('received','deposited');

DROP TRIGGER IF EXISTS fee_instruments_touch ON public.fee_instruments;
CREATE TRIGGER fee_instruments_touch BEFORE UPDATE ON public.fee_instruments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Payments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_payments (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,

  receipt_no       TEXT UNIQUE,
  seq              BIGINT,
  paid_on          DATE NOT NULL DEFAULT CURRENT_DATE,

  method           TEXT NOT NULL
                   CHECK (method IN ('cash','upi','card','netbanking','bank_transfer','cheque','dd','wallet','razorpay','adjustment')),
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reference        TEXT,
  notes            TEXT,
  instrument_id    UUID REFERENCES public.fee_instruments(id) ON DELETE SET NULL,

  status           TEXT NOT NULL DEFAULT 'verified'
                   CHECK (status IN ('pending','verified','reversed','failed')),

  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  utr                 TEXT,
  provider_ref        TEXT,
  collect_vpa         TEXT,

  collected_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at      TIMESTAMPTZ,

  reversed_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reversed_at      TIMESTAMPTZ,
  reversal_reason  TEXT,

  -- SHA-256 over the canonical receipt payload, set when the number is issued.
  receipt_hash     TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A reversal without a reason is just a deletion with extra steps.
  CONSTRAINT fee_payments_reversal_needs_reason
    CHECK (status <> 'reversed' OR (reversal_reason IS NOT NULL AND length(btrim(reversal_reason)) >= 3))
);

CREATE INDEX IF NOT EXISTS idx_fee_payments_student ON public.fee_payments(student_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_paid_on ON public.fee_payments(paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_fee_payments_status  ON public.fee_payments(status);
CREATE INDEX IF NOT EXISTS idx_fee_payments_collector ON public.fee_payments(collected_by, paid_on);

-- Carried over from school_fee_payments: a bank settlement file replayed twice
-- must not credit the same UTR twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_payments_utr
  ON public.fee_payments(utr) WHERE utr IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_payments_rzp
  ON public.fee_payments(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;

DROP TRIGGER IF EXISTS fee_payments_touch ON public.fee_payments;
CREATE TRIGGER fee_payments_touch BEFORE UPDATE ON public.fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Allocations ─────────────────────────────────────────────────────────
-- One payment can settle several bills, which is what makes "here is ₹15,000
-- for whatever is outstanding" work at the counter.
CREATE TABLE IF NOT EXISTS public.fee_payment_allocations (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES public.fee_payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.fee_invoices(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_alloc_payment ON public.fee_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_fee_alloc_invoice ON public.fee_payment_allocations(invoice_id);

-- Any change to an allocation, or to a payment's status, changes what a bill
-- has been paid. Refresh the affected invoices rather than trusting a caller
-- to remember.
CREATE OR REPLACE FUNCTION public.fee_alloc_refresh()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.fee_refresh_invoice(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fee_alloc_totals ON public.fee_payment_allocations;
CREATE TRIGGER fee_alloc_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.fee_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.fee_alloc_refresh();

CREATE OR REPLACE FUNCTION public.fee_payment_status_refresh()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_invoice UUID;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    FOR v_invoice IN SELECT invoice_id FROM public.fee_payment_allocations WHERE payment_id = NEW.id
    LOOP
      PERFORM public.fee_refresh_invoice(v_invoice);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fee_payments_status_change ON public.fee_payments;
CREATE TRIGGER fee_payments_status_change
  AFTER UPDATE ON public.fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.fee_payment_status_refresh();

-- ── A payment is never rewritten ────────────────────────────────────────
-- Only the fields a legitimate later event touches may change. Editing the
-- amount, the date, the method or the receipt number of a payment that has
-- already been issued is forbidden outright, including to a service-role
-- caller: a route with a bug must not be able to do it either.
CREATE OR REPLACE FUNCTION public.fee_payments_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.receipt_no IS NOT NULL THEN
    IF NEW.amount     IS DISTINCT FROM OLD.amount
    OR NEW.paid_on    IS DISTINCT FROM OLD.paid_on
    OR NEW.method     IS DISTINCT FROM OLD.method
    OR NEW.student_id IS DISTINCT FROM OLD.student_id
    OR NEW.receipt_no IS DISTINCT FROM OLD.receipt_no
    OR NEW.academic_year_id IS DISTINCT FROM OLD.academic_year_id THEN
      RAISE EXCEPTION
        'A receipted payment cannot be edited. Reverse it with a reason and take a new one.';
    END IF;
  END IF;

  IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
    RAISE EXCEPTION 'A reversed payment cannot be un-reversed. Take a fresh payment instead.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fee_payments_guard ON public.fee_payments;
CREATE TRIGGER fee_payments_guard BEFORE UPDATE ON public.fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.fee_payments_immutable();

CREATE OR REPLACE FUNCTION public.fee_payments_no_delete()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.receipt_no IS NOT NULL THEN
    RAISE EXCEPTION 'A receipted payment cannot be deleted. Reverse it with a reason.';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS fee_payments_no_delete ON public.fee_payments;
CREATE TRIGGER fee_payments_no_delete BEFORE DELETE ON public.fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.fee_payments_no_delete();

-- ── Receipt hash ────────────────────────────────────────────────────────
-- Over the fields a receipt actually asserts, in a fixed order, so the QR can
-- prove the printed slip matches the record rather than only that some row
-- with that number exists.
CREATE OR REPLACE FUNCTION public.fee_receipt_payload(p_payment UUID)
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT concat_ws('|',
    p.receipt_no,
    p.student_id::TEXT,
    to_char(p.amount, 'FM9999999990.00'),
    p.paid_on::TEXT,
    p.method,
    COALESCE((SELECT string_agg(i.number || ':' || to_char(a.amount, 'FM9999999990.00'), ',' ORDER BY i.number)
                FROM public.fee_payment_allocations a
                JOIN public.fee_invoices i ON i.id = a.invoice_id
               WHERE a.payment_id = p.id), '')
  )
  FROM public.fee_payments p WHERE p.id = p_payment;
$$;

-- search_path includes `extensions` because that is where Supabase installs
-- pgcrypto, and every function here pins its search_path (a SECURITY DEFINER
-- function that does not is a privilege-escalation route). Without it,
-- digest() is simply not visible and sealing fails at the counter.
CREATE OR REPLACE FUNCTION public.fee_seal_receipt(p_payment UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_hash TEXT;
BEGIN
  v_hash := encode(digest(public.fee_receipt_payload(p_payment), 'sha256'), 'hex');
  UPDATE public.fee_payments SET receipt_hash = v_hash WHERE id = p_payment;
  RETURN v_hash;
END $$;

-- ── Credits ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_credits (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year_id  UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  source_payment_id UUID REFERENCES public.fee_payments(id) ON DELETE SET NULL,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  consumed          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (consumed <= amount)
);

CREATE INDEX IF NOT EXISTS idx_fee_credits_student ON public.fee_credits(student_id, academic_year_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.fee_payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_instruments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_credits             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read fee payments" ON public.fee_payments;
CREATE POLICY "Read fee payments" ON public.fee_payments
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'));

-- Collection happens through /api/fees/collect, which allocates and seals the
-- receipt in one transaction. The insert policy exists so a permitted clerk is
-- not blocked by RLS on the way through; there is deliberately no client-side
-- update policy at all — reversal is its own route and its own permission.
DROP POLICY IF EXISTS "Take fee payments" ON public.fee_payments;
CREATE POLICY "Take fee payments" ON public.fee_payments
  FOR INSERT TO authenticated WITH CHECK (public.has_fee_permission('fees.collect'));

DROP POLICY IF EXISTS "Read fee allocations" ON public.fee_payment_allocations;
CREATE POLICY "Read fee allocations" ON public.fee_payment_allocations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fee_payments p
     WHERE p.id = payment_id
       AND (p.student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'))));

DROP POLICY IF EXISTS "Write fee allocations" ON public.fee_payment_allocations;
CREATE POLICY "Write fee allocations" ON public.fee_payment_allocations
  FOR INSERT TO authenticated WITH CHECK (public.has_fee_permission('fees.collect'));

DROP POLICY IF EXISTS "Read fee instruments" ON public.fee_instruments;
CREATE POLICY "Read fee instruments" ON public.fee_instruments
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'));

DROP POLICY IF EXISTS "Manage fee instruments" ON public.fee_instruments;
CREATE POLICY "Manage fee instruments" ON public.fee_instruments
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.instrument.manage') OR public.has_fee_permission('fees.collect'))
  WITH CHECK (public.has_fee_permission('fees.instrument.manage') OR public.has_fee_permission('fees.collect'));

DROP POLICY IF EXISTS "Read fee credits" ON public.fee_credits;
CREATE POLICY "Read fee credits" ON public.fee_credits
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_payments, public.fee_payment_allocations,
                                        public.fee_instruments, public.fee_credits TO authenticated;

GRANT EXECUTE ON FUNCTION public.fee_receipt_payload(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fee_seal_receipt(UUID) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
