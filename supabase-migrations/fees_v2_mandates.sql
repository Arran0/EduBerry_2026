-- ============================================================================
-- fees_v2_mandates — UPI Autopay / eMandate for recurring fees
-- ============================================================================
-- Run after fees_v2_ledger.sql. Safe to re-run.
--
-- A monthly or term fee collected by hand every cycle is the single largest
-- source of arrears in an Indian school: nothing has gone wrong, the parent
-- simply has not got round to it. A mandate turns that into an authorisation
-- given once and debited on schedule.
--
-- ── Read this before relying on it ──────────────────────────────────────────
-- The schema and the route that fills it are complete, but the registration
-- path CANNOT be exercised without live Razorpay credentials: UPI Autopay
-- requires a subscription-enabled account, and there is no sandbox that
-- produces a real mandate. So this ships as scaffolding, and the round summary
-- says so rather than implying it has been proven end to end.
--
-- What IS load-bearing already: a debit that succeeds arrives as an ordinary
-- payment.captured webhook carrying the subscription id, so it reconciles
-- through the same idempotent path and the same immutable ledger as every
-- other payment. Nothing about the money side is mandate-specific.

CREATE TABLE IF NOT EXISTS public.fee_mandates (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  student_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payer_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  family_id           UUID REFERENCES public.fee_families(id) ON DELETE SET NULL,
  -- Which recurring head this mandate covers. NULL means every recurring head
  -- for this student.
  fee_head_id         UUID REFERENCES public.fee_heads(id) ON DELETE SET NULL,

  provider            TEXT NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay')),
  -- Razorpay subscription and plan ids. The subscription is the mandate.
  provider_plan_id    TEXT,
  provider_sub_id     TEXT,
  -- The parent's UPI handle, for display only. Never used to initiate anything.
  payer_vpa           TEXT,

  -- The ceiling the parent authorised, which is not the same as the amount
  -- charged. A fee revision within the cap needs no new mandate; one above it
  -- does, and that is exactly the protection a mandate is supposed to give.
  max_amount          NUMERIC(10,2) NOT NULL CHECK (max_amount > 0),
  frequency           TEXT NOT NULL DEFAULT 'monthly'
                      CHECK (frequency IN ('monthly', 'quarterly', 'term', 'annual')),
  start_date          DATE NOT NULL,
  end_date            DATE,

  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'active', 'paused', 'cancelled', 'expired', 'failed')),
  authorised_at       TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancelled_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancel_reason       TEXT,
  last_debit_at       TIMESTAMPTZ,
  next_debit_on       DATE,
  failure_reason      TEXT,

  created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_fee_mandates_student ON public.fee_mandates(student_id, status);
CREATE INDEX IF NOT EXISTS idx_fee_mandates_due
  ON public.fee_mandates(next_debit_on) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fee_mandates_sub
  ON public.fee_mandates(provider_sub_id) WHERE provider_sub_id IS NOT NULL;

-- One live mandate per student per head. Two would let the same fee be debited
-- twice a cycle, which is the failure a parent would never forgive.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fee_mandates_active
  ON public.fee_mandates(student_id, COALESCE(fee_head_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('pending', 'active');

DROP TRIGGER IF EXISTS fee_mandates_updated_at ON public.fee_mandates;
CREATE TRIGGER fee_mandates_updated_at
  BEFORE UPDATE ON public.fee_mandates
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── Debit attempts ──────────────────────────────────────────────────────────
-- One row per scheduled debit, whether or not it succeeded. A parent whose
-- mandate failed three months running needs the school to notice before the
-- arrears do the noticing for them.

CREATE TABLE IF NOT EXISTS public.fee_mandate_debits (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mandate_id     UUID NOT NULL REFERENCES public.fee_mandates(id) ON DELETE CASCADE,
  fee_id         UUID,
  amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  scheduled_on   DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled', 'notified', 'submitted', 'succeeded', 'failed', 'skipped')),
  -- UPI Autopay requires the payer be pre-notified (24h for most amounts).
  -- Recorded so a dispute can be answered.
  notified_at    TIMESTAMPTZ,
  submitted_at   TIMESTAMPTZ,
  settled_at     TIMESTAMPTZ,
  provider_payment_id TEXT,
  ledger_txn_id  UUID REFERENCES public.fee_transactions(id) ON DELETE SET NULL,
  failure_reason TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (mandate_id, scheduled_on)
);

CREATE INDEX IF NOT EXISTS idx_fee_mandate_debits_mandate
  ON public.fee_mandate_debits(mandate_id, scheduled_on DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.fee_mandates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_mandate_debits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manage fee mandates" ON public.fee_mandates;
CREATE POLICY "Admin manage fee mandates" ON public.fee_mandates FOR ALL
  USING (public.get_user_role() = 'admin') WITH CHECK (public.get_user_role() = 'admin');

-- A parent must be able to see, and to end, an authorisation they gave. A
-- standing debit the payer cannot inspect is not consent.
DROP POLICY IF EXISTS "Payer reads own mandates" ON public.fee_mandates;
CREATE POLICY "Payer reads own mandates" ON public.fee_mandates FOR SELECT
  USING (payer_id = auth.uid() OR student_id = auth.uid());

DROP POLICY IF EXISTS "Admin reads mandate debits" ON public.fee_mandate_debits;
CREATE POLICY "Admin reads mandate debits" ON public.fee_mandate_debits FOR SELECT
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Payer reads own mandate debits" ON public.fee_mandate_debits;
CREATE POLICY "Payer reads own mandate debits" ON public.fee_mandate_debits FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.fee_mandates m
    WHERE m.id = fee_mandate_debits.mandate_id
      AND (m.payer_id = auth.uid() OR m.student_id = auth.uid())
  ));

GRANT SELECT ON public.fee_mandates, public.fee_mandate_debits TO authenticated;

NOTIFY pgrst, 'reload schema';
