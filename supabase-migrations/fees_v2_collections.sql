-- ============================================================================
-- fees_v2_collections — outstanding views, families, advances, receipts, outbox
-- ============================================================================
-- Run after fees_v2_ledger.sql and fees_v2_structures.sql. Safe to re-run.
--
-- Round 2: turning a ledger into a collections operation. Five things:
--
--   1. Views that answer "who owes what, and for how long" in one query
--      instead of pulling every fee into the browser and summing there.
--   2. Advances and credit balances — a family-level credit that survives
--      until there is a demand to apply it to.
--   3. Receipts, with cancellation and reissue that leave both on the record.
--   4. Cheque particulars, so a bounce can be traced and reversed.
--   5. The reminder outbox.

-- ── Outstanding, per fee ────────────────────────────────────────────────────
-- The join every other view is built on. `paid` nets refunds out of payments,
-- so a fee that was paid and then refunded reads as outstanding again — which
-- is the truth, and which the old status column could not express.

CREATE OR REPLACE VIEW public.fee_outstanding AS
SELECT
  f.id                    AS fee_id,
  'school'::text          AS source,
  f.student_id,
  f.fee_head_id,
  f.academic_year,
  f.due_date,
  f.status,
  f.amount                AS billed,
  COALESCE(t.paid, 0)     AS paid,
  GREATEST(0, f.amount - COALESCE(t.paid, 0)) AS outstanding,
  s.grace_days,
  f.carried_from_year,
  f.installment_no
FROM public.school_fees f
LEFT JOIN public.fee_structures s ON s.id = f.structure_id
LEFT JOIN LATERAL (
  SELECT SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS paid
  FROM public.fee_transactions
  WHERE source = 'school' AND fee_id = f.id
) t ON true
WHERE f.status <> 'cancelled';

-- Days past the end of the grace period. NULL due date → 0, i.e. never overdue:
-- a hand-issued fee with no date is owed but not late, and treating it as late
-- would put the whole school in the defaulter list on day one.
CREATE OR REPLACE FUNCTION public.days_past_grace(p_due DATE, p_grace INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_due IS NULL THEN 0
    ELSE (CURRENT_DATE - p_due) - COALESCE(GREATEST(p_grace, 0), 0)
  END;
$$;

-- ── Outstanding, per student ────────────────────────────────────────────────
-- Ageing buckets are computed here rather than in the app because the
-- defaulter list sorts and filters on them, and pulling every fee to the
-- browser to bucket it there does not survive a school of any size.
--
-- The bucket boundaries match src/lib/fees/engine/ageing.ts exactly, including
-- measuring from the END of the grace period rather than from the due date.
-- Two different answers to "is this 31 days overdue" would be worse than none.

CREATE OR REPLACE VIEW public.fee_outstanding_by_student AS
SELECT
  o.student_id,
  o.academic_year,
  COUNT(*) FILTER (WHERE o.outstanding > 0)                        AS open_fees,
  SUM(o.billed)                                                    AS billed,
  SUM(o.paid)                                                      AS paid,
  SUM(o.outstanding)                                               AS outstanding,
  MIN(o.due_date) FILTER (WHERE o.outstanding > 0)                 AS earliest_due,
  SUM(o.outstanding) FILTER (WHERE days_past_grace(o.due_date, o.grace_days) <= 0)              AS bucket_current,
  SUM(o.outstanding) FILTER (WHERE days_past_grace(o.due_date, o.grace_days) BETWEEN 1 AND 30)  AS bucket_1_30,
  SUM(o.outstanding) FILTER (WHERE days_past_grace(o.due_date, o.grace_days) BETWEEN 31 AND 60) AS bucket_31_60,
  SUM(o.outstanding) FILTER (WHERE days_past_grace(o.due_date, o.grace_days) BETWEEN 61 AND 90) AS bucket_61_90,
  SUM(o.outstanding) FILTER (WHERE days_past_grace(o.due_date, o.grace_days) > 90)              AS bucket_90_plus
FROM public.fee_outstanding o
GROUP BY o.student_id, o.academic_year;

-- ── Outstanding, per class and per head ─────────────────────────────────────

CREATE OR REPLACE VIEW public.fee_outstanding_by_class AS
SELECT
  h.id            AS homeroom_id,
  h.name          AS homeroom_name,
  h.grade,
  h.section,
  h.academic_year,
  COUNT(DISTINCT o.student_id) FILTER (WHERE o.outstanding > 0) AS students_with_dues,
  COUNT(DISTINCT o.student_id)                                  AS students_billed,
  SUM(o.billed)      AS billed,
  SUM(o.paid)        AS paid,
  SUM(o.outstanding) AS outstanding
FROM public.fee_outstanding o
JOIN public.homeroom_members m ON m.student_id = o.student_id
JOIN public.homerooms h ON h.id = m.homeroom_id
GROUP BY h.id, h.name, h.grade, h.section, h.academic_year;

CREATE OR REPLACE VIEW public.fee_outstanding_by_head AS
SELECT
  o.fee_head_id,
  fh.name    AS head_name,
  fh.kind,
  o.academic_year,
  COUNT(*)           AS fee_count,
  SUM(o.billed)      AS billed,
  SUM(o.paid)        AS paid,
  SUM(o.outstanding) AS outstanding
FROM public.fee_outstanding o
LEFT JOIN public.fee_heads fh ON fh.id = o.fee_head_id
GROUP BY o.fee_head_id, fh.name, fh.kind, o.academic_year;

-- ── Advances and credit balances ────────────────────────────────────────────
-- A family that overpays, or pays before a demand exists, holds a credit. It
-- lives at the family level rather than the student level so a parent's
-- overpayment on one child can settle another's fee — which is what a parent
-- means when they say "put it towards next term".
--
-- The balance is derived from the ledger, never stored: a stored balance and a
-- ledger that disagree is a reconciliation problem nobody can win.

CREATE OR REPLACE VIEW public.fee_credit_balance AS
SELECT
  family_id,
  SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS balance
FROM public.fee_transactions
WHERE family_id IS NOT NULL
  AND fee_id IS NULL           -- unapplied money only
  AND kind IN ('advance', 'carry_forward', 'adjustment', 'refund')
GROUP BY family_id;

-- Applying a credit is two ledger rows in one act: the family's unapplied
-- credit is spent (debit, no fee) and the fee is paid (credit, with fee). Both
-- carry the same idempotency stem so a retry cannot apply it twice.
CREATE OR REPLACE FUNCTION public.apply_fee_credit(
  p_family UUID,
  p_fee UUID,
  p_source TEXT,
  p_amount NUMERIC,
  p_actor UUID,
  p_key TEXT
) RETURNS TABLE (spent_txn UUID, paid_txn UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  available NUMERIC;
  student   UUID;
  v_spent   UUID;
  v_paid    UUID;
BEGIN
  SELECT COALESCE(balance, 0) INTO available FROM public.fee_credit_balance WHERE family_id = p_family;
  IF COALESCE(available, 0) < p_amount THEN
    RAISE EXCEPTION 'This family holds only % in credit; % was requested.', COALESCE(available, 0), p_amount;
  END IF;

  IF p_source = 'school' THEN
    SELECT student_id INTO student FROM public.school_fees WHERE id = p_fee;
  ELSE
    SELECT passenger_id INTO student FROM public.bus_fees WHERE id = p_fee;
  END IF;

  INSERT INTO public.fee_transactions
    (kind, direction, amount, source, fee_id, student_id, family_id, method,
     idempotency_key, actor_id, note)
  VALUES
    ('adjustment', 'debit', p_amount, p_source, NULL, student, p_family, 'credit_note',
     p_key || ':spend', p_actor, 'Credit balance applied to a fee')
  RETURNING id INTO v_spent;

  INSERT INTO public.fee_transactions
    (kind, direction, amount, source, fee_id, student_id, family_id, method,
     idempotency_key, actor_id, note)
  VALUES
    ('payment', 'credit', p_amount, p_source, p_fee, student, p_family, 'credit_note',
     p_key || ':apply', p_actor, 'Paid from the family credit balance')
  RETURNING id INTO v_paid;

  IF p_source = 'school' THEN
    PERFORM public.apply_ledger_to_school_fee(p_fee);
  ELSE
    PERFORM public.apply_ledger_to_bus_fee(p_fee);
  END IF;

  RETURN QUERY SELECT v_spent, v_paid;
END $$;

-- ── Receipts ────────────────────────────────────────────────────────────────
-- A receipt is a numbered document, not a rendering of a payment. It gets its
-- own table because the number must be gapless and stable, and because
-- cancelling one has to leave both the cancellation and the replacement on the
-- record — a school that can silently un-issue a receipt has no receipts.

CREATE SEQUENCE IF NOT EXISTS public.fee_receipt_seq;

CREATE TABLE IF NOT EXISTS public.fee_receipts (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_no     TEXT NOT NULL UNIQUE,
  transaction_id UUID NOT NULL REFERENCES public.fee_transactions(id) ON DELETE RESTRICT,
  source         TEXT NOT NULL DEFAULT 'school' CHECK (source IN ('school', 'bus')),
  fee_id         UUID,
  student_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  family_id      UUID REFERENCES public.fee_families(id) ON DELETE SET NULL,
  /* Who actually handed over the money — not always the student's own account. */
  paid_by_name   TEXT,
  paid_by_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  method         TEXT,
  academic_year  TEXT,
  issued_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  status         TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled')),
  cancelled_at   TIMESTAMPTZ,
  cancelled_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancel_reason  TEXT,
  /* A reissue points back at the receipt it replaces, so both are findable. */
  replaces_id    UUID REFERENCES public.fee_receipts(id) ON DELETE SET NULL,
  replaced_by_id UUID REFERENCES public.fee_receipts(id) ON DELETE SET NULL,

  snapshot       JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_receipts_student ON public.fee_receipts(student_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_txn     ON public.fee_receipts(transaction_id);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_year    ON public.fee_receipts(academic_year, issued_at DESC);

-- A receipt's terms are fixed at issue. Only the cancellation fields, and the
-- link to a replacement, may change afterwards.
CREATE OR REPLACE FUNCTION public.fee_receipts_freeze()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.receipt_no IS DISTINCT FROM OLD.receipt_no
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION
      'Receipt % is issued and cannot be altered. Cancel it and issue a replacement instead.',
      OLD.receipt_no;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fee_receipts_frozen ON public.fee_receipts;
CREATE TRIGGER fee_receipts_frozen
  BEFORE UPDATE ON public.fee_receipts
  FOR EACH ROW EXECUTE FUNCTION public.fee_receipts_freeze();

/* Allocated by the database, so two clerks saving at the same moment cannot
   land on the same number. Prefixed with the academic year for readability.
   NOT gapless: a sequence advances even when the surrounding transaction rolls
   back, and a cancelled receipt leaves its number spent. Both are what an
   auditor expects — a gap is evidence, a reused number is not. */
CREATE OR REPLACE FUNCTION public.next_receipt_no(p_year TEXT)
RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT COALESCE(p_year, to_char(CURRENT_DATE, 'YYYY')) || '/' ||
         lpad(nextval('public.fee_receipt_seq')::text, 6, '0');
$$;

-- ── Cheque particulars ──────────────────────────────────────────────────────
-- A cheque is a promise, not a payment, until it clears. The ledger row is
-- written when the office accepts it (that is when the school's books say it
-- has it) and reversed if it bounces — which is exactly what a compensating
-- entry is for.

CREATE TABLE IF NOT EXISTS public.fee_instruments (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES public.fee_transactions(id) ON DELETE RESTRICT,
  kind           TEXT NOT NULL CHECK (kind IN ('cheque', 'dd', 'neft', 'other')),
  instrument_no  TEXT,
  bank_name      TEXT,
  instrument_date DATE,
  status         TEXT NOT NULL DEFAULT 'received'
                 CHECK (status IN ('received', 'deposited', 'cleared', 'bounced', 'cancelled')),
  cleared_on     DATE,
  bounced_on     DATE,
  bounce_reason  TEXT,
  /* The compensating debit written when a cheque bounces. */
  reversal_txn_id UUID REFERENCES public.fee_transactions(id) ON DELETE SET NULL,
  bank_charge    NUMERIC(10,2),
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_instruments_status ON public.fee_instruments(status, instrument_date);
CREATE INDEX IF NOT EXISTS idx_fee_instruments_txn    ON public.fee_instruments(transaction_id);

DROP TRIGGER IF EXISTS fee_instruments_updated_at ON public.fee_instruments;
CREATE TRIGGER fee_instruments_updated_at
  BEFORE UPDATE ON public.fee_instruments
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── Reminder outbox ─────────────────────────────────────────────────────────
-- One row per message we intend to send. Written by the scheduler, consumed by
-- the sender, so a crash mid-send loses nothing and a retry cannot double-send.
--
-- `dedupe_key` is (fee, state) — never a date. A date-based key would re-send
-- the same "31-60 days overdue" notice every night the cron runs, which is the
-- fastest way to teach a school's parents to ignore fee messages entirely.

CREATE TABLE IF NOT EXISTS public.fee_notifications (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id    UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  family_id     UUID REFERENCES public.fee_families(id) ON DELETE SET NULL,
  recipient_id  UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  fee_id        UUID,
  source        TEXT NOT NULL DEFAULT 'school' CHECK (source IN ('school', 'bus')),

  channel       TEXT NOT NULL CHECK (channel IN ('push', 'whatsapp', 'sms', 'email', 'in_app')),
  trigger_state TEXT NOT NULL,
  template_key  TEXT NOT NULL,
  /* Rendered at schedule time, so what was sent is what is on the record. */
  title         TEXT,
  body          TEXT,
  payload       JSONB,

  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped', 'suppressed')),
  attempts      INT NOT NULL DEFAULT 0,
  sent_at       TIMESTAMPTZ,
  provider_ref  TEXT,
  failure_reason TEXT,

  dedupe_key    TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (dedupe_key, channel, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_notifications_due
  ON public.fee_notifications(scheduled_for) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_fee_notifications_student
  ON public.fee_notifications(student_id, created_at DESC);

-- Per-family quiet hours and channel opt-out. DPDP: a parent who has asked not
-- to be messaged on a channel must not be, and the school needs to be able to
-- show that the preference was recorded.
CREATE TABLE IF NOT EXISTS public.fee_notification_prefs (
  family_id     UUID PRIMARY KEY REFERENCES public.fee_families(id) ON DELETE CASCADE,
  channels      TEXT[] NOT NULL DEFAULT ARRAY['push', 'in_app'],
  quiet_from    TIME,
  quiet_to      TIME,
  opted_out_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Previous-year arrears carry-forward ─────────────────────────────────────
-- What a family still owes from last year becomes one opening fee this year,
-- tagged with where it came from so the ageing report can separate "owed since
-- last year" from "owed this term". The original fees stay exactly as they are:
-- rolling them forward by editing them would erase the history of when the debt
-- actually arose.

CREATE OR REPLACE FUNCTION public.carry_forward_arrears(
  p_from_year TEXT,
  p_to_year   TEXT,
  p_head      UUID,
  p_due       DATE,
  p_actor     UUID
) RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  moved INT := 0;
  r     RECORD;
BEGIN
  FOR r IN
    SELECT student_id, SUM(outstanding) AS owed
    FROM public.fee_outstanding
    WHERE academic_year = p_from_year AND outstanding > 0
    GROUP BY student_id
    HAVING SUM(outstanding) > 0
  LOOP
    -- Idempotent: a second run for the same pair of years does nothing.
    IF EXISTS (
      SELECT 1 FROM public.school_fees
      WHERE student_id = r.student_id
        AND academic_year = p_to_year
        AND carried_from_year = p_from_year
    ) THEN CONTINUE; END IF;

    INSERT INTO public.school_fees
      (fee_head_id, student_id, amount, gross_amount, description, due_date,
       academic_year, carried_from_year, created_by)
    VALUES
      (p_head, r.student_id, r.owed, r.owed,
       'Arrears carried forward from ' || p_from_year, p_due,
       p_to_year, p_from_year, p_actor);

    moved := moved + 1;
  END LOOP;
  RETURN moved;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.fee_receipts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_instruments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_notification_prefs   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manage fee receipts" ON public.fee_receipts;
CREATE POLICY "Admin manage fee receipts" ON public.fee_receipts FOR ALL
  USING (public.get_user_role() = 'admin') WITH CHECK (public.get_user_role() = 'admin');

-- A parent must be able to fetch their own receipt without asking the office.
DROP POLICY IF EXISTS "Student reads own receipts" ON public.fee_receipts;
CREATE POLICY "Student reads own receipts" ON public.fee_receipts FOR SELECT
  USING (
    student_id = auth.uid() OR paid_by_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.fee_family_members m
      WHERE m.family_id = fee_receipts.family_id AND m.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admin manage fee instruments" ON public.fee_instruments;
CREATE POLICY "Admin manage fee instruments" ON public.fee_instruments FOR ALL
  USING (public.get_user_role() = 'admin') WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin reads fee notifications" ON public.fee_notifications;
CREATE POLICY "Admin reads fee notifications" ON public.fee_notifications FOR SELECT
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Recipient reads own fee notifications" ON public.fee_notifications;
CREATE POLICY "Recipient reads own fee notifications" ON public.fee_notifications FOR SELECT
  USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "Family manages notification prefs" ON public.fee_notification_prefs;
CREATE POLICY "Family manages notification prefs" ON public.fee_notification_prefs FOR ALL
  USING (
    public.get_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.fee_family_members m
      WHERE m.family_id = fee_notification_prefs.family_id AND m.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    public.get_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.fee_family_members m
      WHERE m.family_id = fee_notification_prefs.family_id AND m.profile_id = auth.uid()
    )
  );

-- ── Grants ──────────────────────────────────────────────────────────────────

GRANT SELECT ON
  public.fee_outstanding, public.fee_outstanding_by_student,
  public.fee_outstanding_by_class, public.fee_outstanding_by_head,
  public.fee_credit_balance
TO authenticated;

GRANT SELECT ON public.fee_receipts, public.fee_notifications TO authenticated;
GRANT ALL    ON public.fee_notification_prefs TO authenticated;

NOTIFY pgrst, 'reload schema';
