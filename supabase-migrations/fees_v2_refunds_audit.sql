-- ============================================================================
-- fees_v2_refunds_audit — auditable refunds, and the fee audit trail
-- ============================================================================
-- Run after fees_v2_ledger.sql and fees_v2_structures.sql. Safe to re-run.
--
-- Refunds do not exist in the current module at all. `fee_status` has
-- 'cancelled', which zeroes the demand but says nothing about money already
-- collected that has to go back. A school returning a caution deposit or a
-- withdrawn student's term fee has no way to record it except editing rows.
--
-- A refund here is a workflow, not a flag:
--   requested → approved → processing → processed
--                       ↘ rejected     ↘ failed
-- Every transition is a row in fee_refund_events. The processed refund writes
-- a DEBIT to fee_transactions linked to the original credit, so the ledger
-- nets out without either row ever being edited.
--
-- fee_audit_log lives here rather than in Round 3 because concessions and
-- refunds are the two things that most need auditing, and they exist from now.

-- ── fee_refunds ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fee_refunds (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- The ledger credit being returned. RESTRICT, not CASCADE: a refund must
  -- never outlive knowledge of what it refunded.
  transaction_id    UUID NOT NULL REFERENCES public.fee_transactions(id) ON DELETE RESTRICT,
  source            TEXT NOT NULL DEFAULT 'school' CHECK (source IN ('school', 'bus')),
  fee_id            UUID,
  student_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  amount            NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  kind              TEXT NOT NULL CHECK (kind IN ('full', 'partial')),
  -- Free text is not enough for a report; the category is what makes
  -- "why did we refund ₹2.4L last term" answerable.
  reason_category   TEXT NOT NULL DEFAULT 'other'
                    CHECK (reason_category IN ('withdrawal', 'transfer', 'overpayment',
                                               'duplicate_payment', 'fee_revision',
                                               'deposit_return', 'cancelled_service', 'other')),
  reason            TEXT NOT NULL,

  status            TEXT NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested', 'approved', 'rejected',
                                      'processing', 'processed', 'failed')),

  -- How the money goes back. A gateway refund returns to the original
  -- instrument; a manual one is a cheque or a bank transfer from the office.
  method            TEXT NOT NULL DEFAULT 'gateway'
                    CHECK (method IN ('gateway', 'cash', 'cheque', 'bank_transfer', 'adjustment')),
  gateway_refund_id TEXT,
  reference         TEXT,

  requested_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  processed_at      TIMESTAMPTZ,
  decision_note     TEXT,
  failure_reason    TEXT,

  -- The ledger debit this refund produced, once it actually settled.
  ledger_txn_id     UUID REFERENCES public.fee_transactions(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_refunds_txn     ON public.fee_refunds(transaction_id);
CREATE INDEX IF NOT EXISTS idx_fee_refunds_student ON public.fee_refunds(student_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_refunds_open
  ON public.fee_refunds(requested_at DESC)
  WHERE status IN ('requested', 'approved', 'processing');
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fee_refunds_gateway_id
  ON public.fee_refunds(gateway_refund_id) WHERE gateway_refund_id IS NOT NULL;

DROP TRIGGER IF EXISTS fee_refunds_updated_at ON public.fee_refunds;
CREATE TRIGGER fee_refunds_updated_at
  BEFORE UPDATE ON public.fee_refunds
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── fee_refund_events — append-only history ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fee_refund_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  refund_id   UUID NOT NULL REFERENCES public.fee_refunds(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  note        TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_refund_events_refund
  ON public.fee_refund_events(refund_id, created_at);

CREATE OR REPLACE FUNCTION public.fee_refund_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fee_refund_events is append-only. A history that can be edited is not a history.';
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fee_refund_events_no_update ON public.fee_refund_events;
CREATE TRIGGER fee_refund_events_no_update
  BEFORE UPDATE OR DELETE ON public.fee_refund_events
  FOR EACH ROW EXECUTE FUNCTION public.fee_refund_events_immutable();

-- ── Refund rules ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fee_refunds_validate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  original    public.fee_transactions%ROWTYPE;
  outstanding NUMERIC(10,2);
BEGIN
  SELECT * INTO original FROM public.fee_transactions WHERE id = NEW.transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund references a transaction that does not exist.';
  END IF;
  IF original.direction <> 'credit' THEN
    RAISE EXCEPTION 'Only a payment can be refunded; transaction % is a %.', original.id, original.direction;
  END IF;

  -- Everything already refunded or in flight against this payment. Counting
  -- in-flight requests is the point: two half-refunds approved in parallel
  -- would otherwise each look affordable on its own.
  SELECT COALESCE(SUM(amount), 0) INTO outstanding
    FROM public.fee_refunds
   WHERE transaction_id = NEW.transaction_id
     AND status IN ('requested', 'approved', 'processing', 'processed')
     AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF outstanding + NEW.amount > original.amount THEN
    RAISE EXCEPTION
      'Refund of % exceeds what is left of payment %: % received, % already refunded or pending.',
      NEW.amount, original.id, original.amount, outstanding;
  END IF;

  -- Maker–checker, same rule as concessions.
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status <> 'approved') THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'An approved refund must record who approved it.';
    END IF;
    IF NEW.approved_by = NEW.requested_by THEN
      RAISE EXCEPTION 'A refund cannot be approved by the person who requested it.';
    END IF;
  END IF;

  -- A settled refund is finished. Reversing one is a new payment, not an edit.
  IF TG_OP = 'UPDATE' AND OLD.status = 'processed' AND NEW.status <> 'processed' THEN
    RAISE EXCEPTION 'A processed refund cannot be reopened. Record a fresh payment instead.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fee_refunds_validate_trg ON public.fee_refunds;
CREATE TRIGGER fee_refunds_validate_trg
  BEFORE INSERT OR UPDATE ON public.fee_refunds
  FOR EACH ROW EXECUTE FUNCTION public.fee_refunds_validate();

-- Every status change writes its own history row, so a route that forgets to
-- cannot leave a gap.
CREATE OR REPLACE FUNCTION public.fee_refunds_log_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.fee_refund_events (refund_id, from_status, to_status, actor_id, note)
    VALUES (NEW.id, NULL, NEW.status, NEW.requested_by, NEW.reason);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.fee_refund_events (refund_id, from_status, to_status, actor_id, note)
    VALUES (NEW.id, OLD.status, NEW.status,
            COALESCE(NEW.approved_by, NEW.requested_by),
            COALESCE(NEW.decision_note, NEW.failure_reason));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fee_refunds_log ON public.fee_refunds;
CREATE TRIGGER fee_refunds_log
  AFTER INSERT OR UPDATE ON public.fee_refunds
  FOR EACH ROW EXECUTE FUNCTION public.fee_refunds_log_event();

-- ── fee_audit_log ───────────────────────────────────────────────────────────
-- Who changed which fee, concession, refund or structure, when, and from what.
-- Append-only. CERT-In's direction of travel on log retention is 180 days, so
-- that is the retention this table is built for (the pg_cron job lands in
-- fees_v2_rbac_audit.sql alongside the rest of the compliance work).
--
-- `before` / `after` hold the changed columns only, not the whole row: an audit
-- log that copies every field of every write is a second database, and under
-- DPDP the minimising choice is also the correct one.

CREATE TABLE IF NOT EXISTS public.fee_audit_log (
  -- Identity rather than a UUID: this is the highest-write table in the module
  -- and it is only ever read in time order.
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  -- Denormalised so a report can group by student without joining to a row
  -- that may since have been deleted.
  student_id  UUID,
  summary     TEXT,
  before      JSONB,
  after       JSONB,
  ip          INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_audit_log_created ON public.fee_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_audit_log_entity  ON public.fee_audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_audit_log_actor   ON public.fee_audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_audit_log_student ON public.fee_audit_log(student_id, created_at DESC) WHERE student_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fee_audit_log_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fee_audit_log is append-only. An audit trail that can be edited is not an audit trail.';
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fee_audit_log_no_update ON public.fee_audit_log;
CREATE TRIGGER fee_audit_log_no_update
  BEFORE UPDATE OR DELETE ON public.fee_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.fee_audit_log_immutable();

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.fee_refunds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_refund_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_audit_log      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manage fee refunds" ON public.fee_refunds;
CREATE POLICY "Admin manage fee refunds" ON public.fee_refunds FOR ALL
  USING (public.get_user_role() = 'admin') WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Student reads own refunds" ON public.fee_refunds;
CREATE POLICY "Student reads own refunds" ON public.fee_refunds FOR SELECT
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Admin reads refund events" ON public.fee_refund_events;
CREATE POLICY "Admin reads refund events" ON public.fee_refund_events FOR SELECT
  USING (public.get_user_role() = 'admin');

-- The audit log is readable by admins and written only by the service role.
-- Nobody, including an admin, may write it directly from a browser: a log its
-- subject can author is not evidence.
DROP POLICY IF EXISTS "Admin reads fee audit log" ON public.fee_audit_log;
CREATE POLICY "Admin reads fee audit log" ON public.fee_audit_log FOR SELECT
  USING (public.get_user_role() = 'admin');

-- ── Grants ──────────────────────────────────────────────────────────────────

GRANT SELECT ON public.fee_audit_log, public.fee_refund_events TO authenticated;
GRANT ALL    ON public.fee_refunds TO authenticated;

NOTIFY pgrst, 'reload schema';
