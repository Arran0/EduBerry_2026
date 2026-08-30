-- ============================================================================
-- fees_v2_ledger — the immutable money record and the idempotent webhook edge
-- ============================================================================
-- Run this in the Supabase SQL Editor. Safe to re-run.
--
-- Today `school_fee_payments` is three things at once: the payment intent, the
-- state machine, and the record that money arrived. Every transition is an
-- in-place UPDATE, so there is no row anywhere that says "₹4,500 arrived at
-- 14:32, Razorpay pay_XYZ, UTR 123456789012" and cannot be altered afterwards.
--
-- This file separates those three jobs:
--
--   • school_fee_payments / bus_payments stay as the payment ATTEMPT. An
--     attempt legitimately changes state — order created, pending, captured,
--     failed — so it stays mutable and every existing read path keeps working.
--
--   • fee_transactions is the LEDGER. One row per money event, append-only,
--     enforced by a trigger rather than by convention. A mistake is corrected
--     with a compensating row, which leaves both the error and the correction
--     on the record. That is what an auditor actually wants, and it is the same
--     rule payroll_v2_runs.sql applies to a locked run.
--
--   • fee_webhook_events is the raw provider event, written BEFORE any business
--     logic runs. A parse failure is then replayable instead of lost.
--
-- Idempotency is keyed twice on purpose, at different layers:
--   fee_webhook_events.event_id       stops a duplicate DELIVERY
--   fee_transactions.idempotency_key  stops a duplicate CREDIT, however it arises
-- Under concurrency the second writer loses on a unique constraint rather than
-- on a SELECT it has already passed — which is exactly how the current
-- `if (payment.status === 'verified')` guard fails.

-- ── fee_webhook_events — raw provider events ────────────────────────────────
-- Insert first, process second. The payload is durable before anything reads
-- it, including when the signature fails: a forged or misconfigured caller is
-- worth a forensic record, so those land here too with signature_verified
-- false and are never processed.

CREATE TABLE IF NOT EXISTS public.fee_webhook_events (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider           TEXT NOT NULL CHECK (provider IN ('razorpay', 'bank')),
  -- Razorpay's x-razorpay-event-id header, or the bank's own event id. Where a
  -- provider sends none we synthesise one from the payload's stable fields
  -- (see src/lib/fees/webhook.ts) so this column is never null and never a
  -- random value — a random one would defeat the whole purpose.
  event_id           TEXT NOT NULL,
  event_type         TEXT,
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  payload            JSONB NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at       TIMESTAMPTZ,
  result             JSONB,
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_webhook_events_unprocessed
  ON public.fee_webhook_events(received_at DESC) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fee_webhook_events_type
  ON public.fee_webhook_events(provider, event_type, received_at DESC);

ALTER TABLE public.fee_webhook_events ENABLE ROW LEVEL SECURITY;

-- Written only by the service role (webhooks have no user session). Admins may
-- read it to answer "did the provider ever send us that event".
DROP POLICY IF EXISTS "Admin read fee webhook events" ON public.fee_webhook_events;
CREATE POLICY "Admin read fee webhook events"
  ON public.fee_webhook_events FOR SELECT
  USING (public.get_user_role() = 'admin');

-- ── fee_transactions — the ledger ───────────────────────────────────────────
-- Every money event in the revenue system, school and bus alike. `source`
-- distinguishes them; the demand models stay separate but the money does not,
-- so reconciliation and the leadership dashboard have one table to read.
--
-- Amounts are always positive. `direction` carries the sign:
--   credit — money in  (a payment, an advance, an opening arrears balance)
--   debit  — money out or demand written down (a refund, a write-off)

CREATE TABLE IF NOT EXISTS public.fee_transactions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  kind                TEXT NOT NULL CHECK (kind IN (
                        'payment', 'refund', 'adjustment', 'write_off',
                        'advance', 'carry_forward', 'reversal')),
  direction           TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount              NUMERIC(10,2) NOT NULL CHECK (amount > 0),

  source              TEXT NOT NULL DEFAULT 'school' CHECK (source IN ('school', 'bus')),
  -- NULL for family-level money that is not yet applied to a specific demand
  -- line: an advance payment, or a credit balance carried from last year.
  fee_id              UUID,
  student_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  family_id           UUID,
  payer_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  method              TEXT,
  gateway             TEXT,
  gateway_order_id    TEXT,
  gateway_payment_id  TEXT,
  gateway_refund_id   TEXT,
  utr                 TEXT,

  -- The idempotency guarantee. Composed by the caller from stable provider
  -- facts (e.g. 'rzp:evt_123:pay_456'), never from a clock or a random value.
  idempotency_key     TEXT NOT NULL UNIQUE,

  -- The mutable attempt row this credit came from, where there was one.
  attempt_id          UUID,
  attempt_table       TEXT CHECK (attempt_table IN ('school_fee_payments', 'bus_payments')),
  webhook_event_id    UUID REFERENCES public.fee_webhook_events(id) ON DELETE SET NULL,
  -- For a refund or reversal: the credit it is undoing.
  reverses_txn_id     UUID REFERENCES public.fee_transactions(id) ON DELETE RESTRICT,

  -- Who caused this row. NULL for a webhook — the provider did, not a person.
  actor_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  note                TEXT,
  meta                JSONB,

  -- When the money actually moved, which is not when we heard about it.
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- fee_id is not a foreign key: it points at school_fees OR bus_fees depending
-- on `source`, and a ledger row must survive the deletion of either. The
-- integrity that matters here is that the row is never lost, not that the
-- demand line still exists.
CREATE INDEX IF NOT EXISTS idx_fee_transactions_fee        ON public.fee_transactions(source, fee_id);
CREATE INDEX IF NOT EXISTS idx_fee_transactions_student    ON public.fee_transactions(student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_transactions_family     ON public.fee_transactions(family_id) WHERE family_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fee_transactions_occurred   ON public.fee_transactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_transactions_gateway    ON public.fee_transactions(gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fee_transactions_reverses   ON public.fee_transactions(reverses_txn_id) WHERE reverses_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fee_transactions_kind       ON public.fee_transactions(kind, occurred_at DESC);

ALTER TABLE public.fee_transactions ENABLE ROW LEVEL SECURITY;

-- Admins read everything. Students read their own — a parent must be able to
-- prove what they paid without asking the office.
DROP POLICY IF EXISTS "Admin read fee transactions" ON public.fee_transactions;
CREATE POLICY "Admin read fee transactions"
  ON public.fee_transactions FOR SELECT
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Student reads own fee transactions" ON public.fee_transactions;
CREATE POLICY "Student reads own fee transactions"
  ON public.fee_transactions FOR SELECT
  USING (student_id = auth.uid() OR payer_id = auth.uid());

-- Deliberately NO insert/update/delete policy for any role. Every write goes
-- through the service role in an API route that has already decided the money
-- is real. A browser session with the anon key must not be the thing that
-- records a payment.

-- ── Immutability ────────────────────────────────────────────────────────────
-- Not "the API doesn't update it" — the database refuses. This is the same
-- guarantee payroll_v2_runs.sql gives a locked run, except the ledger has no
-- unlocked phase at all: money either arrived or it did not.

CREATE OR REPLACE FUNCTION public.fee_transactions_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'fee_transactions is append-only (attempted % on %). Correct a mistake by inserting a compensating row — a reversal or an adjustment — so both the error and the correction stay on the record.',
    TG_OP, COALESCE(OLD.id::text, '?');
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fee_transactions_no_update ON public.fee_transactions;
CREATE TRIGGER fee_transactions_no_update
  BEFORE UPDATE OR DELETE ON public.fee_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fee_transactions_immutable();

-- A reversal must point at something, and must not point at another reversal
-- (which would make "what is the net of this payment" a graph walk).
CREATE OR REPLACE FUNCTION public.fee_transactions_check_reversal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  original      public.fee_transactions%ROWTYPE;
  already_undone NUMERIC(10,2);
BEGIN
  IF NEW.kind IN ('refund', 'reversal') THEN
    IF NEW.reverses_txn_id IS NULL THEN
      RAISE EXCEPTION 'A % must name the transaction it reverses (reverses_txn_id).', NEW.kind;
    END IF;

    SELECT * INTO original FROM public.fee_transactions WHERE id = NEW.reverses_txn_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reverses_txn_id % does not exist.', NEW.reverses_txn_id;
    END IF;
    IF original.direction <> 'credit' THEN
      RAISE EXCEPTION 'Only a credit can be refunded or reversed; % is a %.', original.id, original.direction;
    END IF;

    -- Refunding more than came in is the failure mode that matters, and it is
    -- the one an application-level check loses under concurrency.
    SELECT COALESCE(SUM(amount), 0) INTO already_undone
      FROM public.fee_transactions
      WHERE reverses_txn_id = NEW.reverses_txn_id AND kind IN ('refund', 'reversal');

    IF already_undone + NEW.amount > original.amount THEN
      RAISE EXCEPTION
        'Refunding % would exceed the original payment: % received, % already returned.',
        NEW.amount, original.amount, already_undone;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fee_transactions_reversal_check ON public.fee_transactions;
CREATE TRIGGER fee_transactions_reversal_check
  BEFORE INSERT ON public.fee_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fee_transactions_check_reversal();

-- ── Attempt tables link to the ledger ───────────────────────────────────────

ALTER TABLE public.school_fee_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS ledger_txn_id   UUID REFERENCES public.fee_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS failure_reason  TEXT;

ALTER TABLE public.bus_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS ledger_txn_id   UUID REFERENCES public.fee_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS failure_reason  TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_school_fee_payments_idem
  ON public.school_fee_payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bus_payments_idem
  ON public.bus_payments(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- An order id must identify one attempt, or the webhook's lookup is ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_school_fee_payments_order
  ON public.school_fee_payments(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bus_payments_order
  ON public.bus_payments(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;

-- ── Balance helpers ─────────────────────────────────────────────────────────
-- One definition of "what has been paid against this fee", used by the app, the
-- webhooks and the reports alike. Six write paths each doing their own
-- arithmetic is how the partial-payment bug happened in the first place.

CREATE OR REPLACE FUNCTION public.fee_paid_amount(p_source TEXT, p_fee UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)
  FROM public.fee_transactions
  WHERE source = p_source AND fee_id = p_fee;
$$;

-- Recompute a school fee's status from the ledger. `cancelled` is a demand-side
-- decision and is never overwritten by money arithmetic.
CREATE OR REPLACE FUNCTION public.apply_ledger_to_school_fee(p_fee UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  billed  NUMERIC(10,2);
  paid    NUMERIC(10,2);
  current public.fee_status;
  next    public.fee_status;
BEGIN
  SELECT amount, status INTO billed, current FROM public.school_fees WHERE id = p_fee;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF current = 'cancelled' THEN RETURN current::text; END IF;

  paid := public.fee_paid_amount('school', p_fee);
  next := CASE
            WHEN paid <= 0            THEN 'unpaid'
            WHEN paid >= billed       THEN 'paid'
            ELSE                           'partial'
          END::public.fee_status;

  IF next IS DISTINCT FROM current THEN
    UPDATE public.school_fees SET status = next WHERE id = p_fee;
  END IF;
  RETURN next::text;
END $$;

CREATE OR REPLACE FUNCTION public.apply_ledger_to_bus_fee(p_fee UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  billed  NUMERIC(10,2);
  paid    NUMERIC(10,2);
  current public.bus_fee_status;
  next    public.bus_fee_status;
BEGIN
  SELECT amount, status INTO billed, current FROM public.bus_fees WHERE id = p_fee;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF current = 'cancelled' THEN RETURN current::text; END IF;

  paid := public.fee_paid_amount('bus', p_fee);
  next := CASE
            WHEN paid <= 0      THEN 'unpaid'
            WHEN paid >= billed THEN 'paid'
            ELSE                     'partial'
          END::public.bus_fee_status;

  IF next IS DISTINCT FROM current THEN
    UPDATE public.bus_fees SET status = next WHERE id = p_fee;
  END IF;
  RETURN next::text;
END $$;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Every payment already verified becomes a ledger credit, so balances computed
-- from the ledger match what the reports show today. Keyed on the attempt id so
-- re-running this migration cannot double-credit anyone.

INSERT INTO public.fee_transactions (
  kind, direction, amount, source, fee_id, student_id, payer_id,
  method, gateway, gateway_order_id, gateway_payment_id, utr,
  idempotency_key, attempt_id, attempt_table, actor_id, note, occurred_at, created_at
)
SELECT
  'payment', 'credit', p.amount, 'school', p.fee_id, f.student_id, p.payer_id,
  p.method::text,
  CASE WHEN p.razorpay_payment_id IS NOT NULL THEN 'razorpay'
       WHEN p.provider IS NOT NULL            THEN p.provider
       ELSE NULL END,
  p.razorpay_order_id, p.razorpay_payment_id, p.utr,
  'backfill:school:' || p.id::text, p.id, 'school_fee_payments', p.verified_by,
  'Backfilled from school_fee_payments by fees_v2_ledger.sql',
  COALESCE(p.verified_at, p.created_at), COALESCE(p.created_at, NOW())
FROM public.school_fee_payments p
JOIN public.school_fees f ON f.id = p.fee_id
WHERE p.status = 'verified' AND p.amount > 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.fee_transactions (
  kind, direction, amount, source, fee_id, student_id, payer_id,
  method, gateway, gateway_order_id, gateway_payment_id, utr,
  idempotency_key, attempt_id, attempt_table, actor_id, note, occurred_at, created_at
)
SELECT
  'payment', 'credit', p.amount, 'bus', p.fee_id, f.passenger_id, p.payer_id,
  p.method::text,
  CASE WHEN p.razorpay_payment_id IS NOT NULL THEN 'razorpay'
       WHEN p.provider IS NOT NULL            THEN p.provider
       ELSE NULL END,
  p.razorpay_order_id, p.razorpay_payment_id, p.utr,
  'backfill:bus:' || p.id::text, p.id, 'bus_payments', p.verified_by,
  'Backfilled from bus_payments by fees_v2_ledger.sql',
  COALESCE(p.verified_at, p.created_at), COALESCE(p.created_at, NOW())
FROM public.bus_payments p
JOIN public.bus_fees f ON f.id = p.fee_id
WHERE p.status = 'verified' AND p.amount > 0
ON CONFLICT (idempotency_key) DO NOTHING;

-- Link each backfilled attempt to the row it produced.
UPDATE public.school_fee_payments p
SET ledger_txn_id = t.id
FROM public.fee_transactions t
WHERE t.attempt_table = 'school_fee_payments' AND t.attempt_id = p.id
  AND p.ledger_txn_id IS NULL;

UPDATE public.bus_payments p
SET ledger_txn_id = t.id
FROM public.fee_transactions t
WHERE t.attempt_table = 'bus_payments' AND t.attempt_id = p.id
  AND p.ledger_txn_id IS NULL;

-- Now that the ledger is the source of truth, correct the demand rows the
-- partial-payment bug mislabelled: a fee marked 'paid' whose credits do not
-- cover it goes back to 'partial' (or 'unpaid').
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.school_fees WHERE status <> 'cancelled' LOOP
    PERFORM public.apply_ledger_to_school_fee(r.id);
  END LOOP;
  FOR r IN SELECT id FROM public.bus_fees WHERE status <> 'cancelled' LOOP
    PERFORM public.apply_ledger_to_bus_fee(r.id);
  END LOOP;
END $$;

-- ── Grants ──────────────────────────────────────────────────────────────────

GRANT SELECT ON public.fee_transactions, public.fee_webhook_events TO authenticated;

NOTIFY pgrst, 'reload schema';
