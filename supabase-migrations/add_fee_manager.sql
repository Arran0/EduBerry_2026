-- ============================================================
-- Migration: Fee Manager
-- A reusable fee-head catalogue, per-student issued fees, and
-- fee payments — all with RLS. Mirrors the conventions in
-- add_bus_manager.sql (get_user_role() admin checks,
-- update_task_updated_at trigger, per-row unique UPI reference).
--
-- Payment configuration (Razorpay / UPI / Smart Collect) is shared
-- site-wide with the Bus module via site_settings, so nothing new is
-- stored here. Each issued fee carries a unique upi_reference so a
-- student's payment QR is unambiguous to reconcile.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────

CREATE TYPE public.fee_status         AS ENUM ('unpaid', 'partial', 'paid', 'cancelled');
CREATE TYPE public.fee_payment_method AS ENUM ('razorpay', 'upi_qr', 'cash');
CREATE TYPE public.fee_payment_status AS ENUM ('pending', 'verified', 'failed');

-- ── fee_heads ────────────────────────────────────────────────
-- Reusable catalogue of fee types (Tuition, Exam, Lab, …) with a
-- default amount the admin can override when issuing.

CREATE TABLE public.fee_heads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  default_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.fee_heads ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_fee_heads_active ON public.fee_heads(active);

CREATE TRIGGER fee_heads_updated_at
  BEFORE UPDATE ON public.fee_heads
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage fee heads"
  ON public.fee_heads FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- Any signed-in user may read the catalogue (so students see the label
-- on a fee issued to them).
CREATE POLICY "Authenticated read fee heads"
  ON public.fee_heads FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── school_fees ──────────────────────────────────────────────
-- One issued fee per student. The defaulted upi_reference is embedded
-- in the UPI note (tn=...) so manual / webhook reconciliation of a
-- UPI-QR payment is unambiguous — and gives each student a unique QR.

CREATE TABLE public.school_fees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fee_head_id UUID REFERENCES public.fee_heads(id) ON DELETE SET NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  description TEXT,
  due_date DATE,
  status public.fee_status NOT NULL DEFAULT 'unpaid',
  upi_reference TEXT NOT NULL DEFAULT ('SCHFEE-' || replace(gen_random_uuid()::text, '-', '')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.school_fees ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_school_fees_student ON public.school_fees(student_id);
CREATE INDEX IF NOT EXISTS idx_school_fees_fee_head ON public.school_fees(fee_head_id);
CREATE INDEX IF NOT EXISTS idx_school_fees_status ON public.school_fees(status);

CREATE TRIGGER school_fees_updated_at
  BEFORE UPDATE ON public.school_fees
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage school fees"
  ON public.school_fees FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Student views own fees"
  ON public.school_fees FOR SELECT
  USING (student_id = auth.uid());

-- ── school_fee_payments ──────────────────────────────────────
-- Mirrors bus_payments: a payment intent/claim against a fee. The
-- Razorpay webhook (service role) or an admin flips status to
-- 'verified' and the fee to 'paid'.

CREATE TABLE public.school_fee_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fee_id UUID REFERENCES public.school_fees(id) ON DELETE CASCADE NOT NULL,
  payer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  method public.fee_payment_method NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  status public.fee_payment_status NOT NULL DEFAULT 'pending',
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  upi_txn_ref TEXT,
  -- Smart Collect (bank/PSP auto-reconciliation) columns, matching the bus
  -- module's add_bus_smart_collect.sql so the UPI webhook can match a
  -- settlement back to a fee automatically.
  provider TEXT,              -- e.g. 'smart_collect'
  collect_vpa TEXT,           -- per-fee virtual VPA (vpa mode)
  provider_ref TEXT,          -- unique reference matched by the webhook
  utr TEXT,                   -- bank UTR / RRN from the settlement
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.school_fee_payments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_school_fee_payments_fee ON public.school_fee_payments(fee_id);
CREATE INDEX IF NOT EXISTS idx_school_fee_payments_order ON public.school_fee_payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_school_fee_payments_provider_ref ON public.school_fee_payments(provider_ref);
CREATE INDEX IF NOT EXISTS idx_school_fee_payments_collect_vpa ON public.school_fee_payments(collect_vpa);
-- Prevent double-crediting the same bank settlement.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_school_fee_payments_utr ON public.school_fee_payments(utr) WHERE utr IS NOT NULL;

CREATE TRIGGER school_fee_payments_updated_at
  BEFORE UPDATE ON public.school_fee_payments
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage school fee payments"
  ON public.school_fee_payments FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Payer views own school fee payments"
  ON public.school_fee_payments FOR SELECT
  USING (payer_id = auth.uid());

-- Students may LOG a payment intent/claim for their own fee. Verification
-- (status -> verified) is done server-side via the service role (Razorpay
-- webhook) or by an admin — there is deliberately no student UPDATE policy.
CREATE POLICY "Payer records own school fee payment"
  ON public.school_fee_payments FOR INSERT
  WITH CHECK (payer_id = auth.uid());

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
