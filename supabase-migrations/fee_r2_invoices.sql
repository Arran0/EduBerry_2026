-- ============================================================================
-- fee_r2_invoices — the bill, and the number series behind it
-- ============================================================================
-- Round 2 of docs/fee-upgrade-plan.md. Run after fee_r2_profiles.sql.
-- Safe to re-run.
--
-- `school_fees` was one charge for one head. A real bill groups several heads
-- under one number, one due date and one payment, and everything downstream —
-- a receipt against a bill, a discount off a bill, a late fee on a bill —
-- is unbuildable until that exists. This is it.
--
-- The totals on the header (gross, discount_total, net, paid, balance) are
-- maintained by trigger from the lines and the allocations, never written by a
-- client. A bill whose header disagrees with its own lines is the defect that
-- destroys trust in a fee system, so it is made impossible rather than tested
-- for.

-- ── Number series ───────────────────────────────────────────────────────
-- One row per (key, year). fee_next_number takes a transaction-level advisory
-- lock before incrementing, so two clerks pressing Collect in the same second
-- get consecutive receipt numbers rather than the same one. A duplicated
-- receipt number is not a cosmetic bug: it makes both receipts unprovable.
CREATE TABLE IF NOT EXISTS public.fee_number_series (
  key              TEXT NOT NULL,                -- 'invoice' | 'receipt'
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  next_seq         BIGINT NOT NULL DEFAULT 1,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, academic_year_id)
);

CREATE OR REPLACE FUNCTION public.fee_next_number(p_key TEXT, p_year UUID)
RETURNS TABLE (seq BIGINT, formatted TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg       JSONB;
  v_series    JSONB;
  v_seq       BIGINT;
  v_code      TEXT;
  v_year_code TEXT;
  v_sep       TEXT;
  v_parts     TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Serialise everyone asking for a number in this series. Released at commit,
  -- so a failed Collect does not burn a number and leave a gap.
  PERFORM pg_advisory_xact_lock(hashtext('fee_number_series'), hashtext(p_key || p_year::TEXT));

  INSERT INTO public.fee_number_series (key, academic_year_id, next_seq)
  VALUES (p_key, p_year, 1)
  ON CONFLICT (key, academic_year_id) DO NOTHING;

  UPDATE public.fee_number_series
     SET next_seq = next_seq + 1, updated_at = NOW()
   WHERE key = p_key AND academic_year_id = p_year
  RETURNING next_seq - 1 INTO v_seq;

  v_cfg    := COALESCE(public.fee_setting('numbering', p_year), '{}'::JSONB);
  v_series := COALESCE(v_cfg -> p_key, '{}'::JSONB);
  v_code   := COALESCE(v_cfg ->> 'school_code', '');
  v_sep    := COALESCE(v_cfg ->> 'separator', '/');

  SELECT code INTO v_year_code FROM public.academic_years WHERE id = p_year;

  IF v_code <> '' THEN v_parts := v_parts || v_code; END IF;
  IF COALESCE(v_series ->> 'prefix', '') <> '' THEN
    v_parts := v_parts || (v_series ->> 'prefix');
  END IF;
  IF COALESCE((v_series ->> 'include_year')::BOOLEAN, true) THEN
    -- '2026-27' prints as '26-27': the century adds four characters to every
    -- receipt and tells a reader nothing.
    v_parts := v_parts || substring(v_year_code FROM 3);
  END IF;
  v_parts := v_parts ||
    lpad(v_seq::TEXT, GREATEST(1, COALESCE((v_series ->> 'width')::INT, 4)), '0');

  RETURN QUERY SELECT v_seq, array_to_string(v_parts, v_sep);
END $$;

-- ── Invoices ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_invoices (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id       UUID NOT NULL REFERENCES public.fee_profiles(id) ON DELETE CASCADE,
  student_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  installment_id   UUID REFERENCES public.fee_installments(id) ON DELETE SET NULL,

  number           TEXT NOT NULL UNIQUE,
  seq              BIGINT NOT NULL,
  issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE NOT NULL,

  -- Maintained by trigger from fee_invoice_lines and fee_payment_allocations.
  gross            NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  late_fee_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
  fine_total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  net              NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid             NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance          NUMERIC(12,2) NOT NULL DEFAULT 0,

  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('draft','pending','partly_paid','paid','overdue','cancelled')),
  autogen          BOOLEAN NOT NULL DEFAULT false,

  -- What the QR on the printed bill points at. Random and unguessable, so
  -- publishing it on a bill does not expose the invoice id or let anyone walk
  -- the series.
  verify_token     TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),

  cancelled_reason TEXT,
  cancelled_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at     TIMESTAMPTZ,

  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_invoices_student ON public.fee_invoices(student_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_invoices_profile ON public.fee_invoices(profile_id);
CREATE INDEX IF NOT EXISTS idx_fee_invoices_year    ON public.fee_invoices(academic_year_id, status);
CREATE INDEX IF NOT EXISTS idx_fee_invoices_due     ON public.fee_invoices(due_date) WHERE status IN ('pending','partly_paid','overdue');
CREATE INDEX IF NOT EXISTS idx_fee_invoices_token   ON public.fee_invoices(verify_token);

-- One invoice per student per installment. This is what makes generation
-- re-runnable: the second run finds the row already there and skips it rather
-- than billing the family twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_invoices_one_per_installment
  ON public.fee_invoices(profile_id, installment_id)
  WHERE installment_id IS NOT NULL AND status <> 'cancelled';

DROP TRIGGER IF EXISTS fee_invoices_touch ON public.fee_invoices;
CREATE TRIGGER fee_invoices_touch BEFORE UPDATE ON public.fee_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Lines ───────────────────────────────────────────────────────────────
-- `label` is denormalised on purpose. A bill has to stay legible years later
-- even if the fee head was renamed or deleted, and it lets a student read
-- their own invoice without being given read access to the price list.
CREATE TABLE IF NOT EXISTS public.fee_invoice_lines (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id  UUID NOT NULL REFERENCES public.fee_invoices(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'fee'
              CHECK (kind IN ('fee','discount','scholarship','waiver','fine','late_fee','carry_forward')),
  fee_head_id UUID REFERENCES public.fee_heads(id) ON DELETE SET NULL,
  label       TEXT NOT NULL,
  -- Positive adds to the bill; negative reduces it. A discount is a negative
  -- line, so it is visible on the bill it came off rather than being a figure
  -- subtracted somewhere the family cannot see.
  amount      NUMERIC(12,2) NOT NULL,
  tax_rate    NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- The concession, fine or late-fee charge this line came from (Round 3).
  source_id   UUID,
  note        TEXT,
  sort        INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_invoice_lines_invoice ON public.fee_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_fee_invoice_lines_source  ON public.fee_invoice_lines(source_id) WHERE source_id IS NOT NULL;

-- ── Header totals, kept honest ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_refresh_invoice(p_invoice UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gross    NUMERIC(12,2);
  v_discount NUMERIC(12,2);
  v_late     NUMERIC(12,2);
  v_fine     NUMERIC(12,2);
  v_tax      NUMERIC(12,2);
  v_net      NUMERIC(12,2);
  v_paid     NUMERIC(12,2);
  v_status   TEXT;
  v_current  TEXT;
  v_due      DATE;
  v_grace    INT;
BEGIN
  SELECT status, due_date INTO v_current, v_due FROM public.fee_invoices WHERE id = p_invoice;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE kind IN ('fee','carry_forward')), 0),
    COALESCE(-SUM(amount) FILTER (WHERE kind IN ('discount','scholarship','waiver')), 0),
    COALESCE(SUM(amount) FILTER (WHERE kind = 'late_fee'), 0),
    COALESCE(SUM(amount) FILTER (WHERE kind = 'fine'), 0),
    COALESCE(SUM(tax_amount), 0)
  INTO v_gross, v_discount, v_late, v_fine, v_tax
  FROM public.fee_invoice_lines WHERE invoice_id = p_invoice;

  -- Every line, whatever its sign, so the header can never drift from the body.
  SELECT COALESCE(SUM(amount), 0) INTO v_net
    FROM public.fee_invoice_lines WHERE invoice_id = p_invoice;

  -- Only verified money counts. A pending gateway payment or a cheque still in
  -- the bank has not settled anything yet.
  SELECT COALESCE(SUM(a.amount), 0) INTO v_paid
    FROM public.fee_payment_allocations a
    JOIN public.fee_payments p ON p.id = a.payment_id
   WHERE a.invoice_id = p_invoice AND p.status = 'verified';

  v_grace := COALESCE((public.fee_setting('grace') ->> 'days')::INT, 0);

  v_status := CASE
    WHEN v_current = 'cancelled' THEN 'cancelled'
    WHEN v_current = 'draft'     THEN 'draft'
    WHEN v_paid >= v_net AND v_net > 0 THEN 'paid'
    WHEN v_net <= 0                    THEN 'paid'
    WHEN v_paid > 0 THEN 'partly_paid'
    WHEN CURRENT_DATE > v_due + v_grace THEN 'overdue'
    ELSE 'pending'
  END;

  UPDATE public.fee_invoices
     SET gross = v_gross, discount_total = v_discount, tax_total = v_tax,
         late_fee_total = v_late, fine_total = v_fine,
         net = v_net, paid = v_paid, balance = GREATEST(v_net - v_paid, 0),
         status = v_status, updated_at = NOW()
   WHERE id = p_invoice;
END $$;

CREATE OR REPLACE FUNCTION public.fee_invoice_lines_refresh()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.fee_refresh_invoice(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fee_invoice_lines_totals ON public.fee_invoice_lines;
CREATE TRIGGER fee_invoice_lines_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.fee_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.fee_invoice_lines_refresh();

-- ── Overdue sweep ───────────────────────────────────────────────────────
-- A bill becomes overdue by the calendar moving, not by anyone touching it,
-- so nothing would otherwise change its status. Run nightly.
CREATE OR REPLACE FUNCTION public.fee_mark_overdue()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grace INT := COALESCE((public.fee_setting('grace') ->> 'days')::INT, 0);
  v_count INT;
BEGIN
  UPDATE public.fee_invoices
     SET status = 'overdue', updated_at = NOW()
   WHERE status IN ('pending', 'partly_paid')
     AND balance > 0
     AND CURRENT_DATE > due_date + v_grace;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.fee_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_number_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read fee invoices" ON public.fee_invoices;
CREATE POLICY "Read fee invoices" ON public.fee_invoices
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'));

DROP POLICY IF EXISTS "Generate fee invoices" ON public.fee_invoices;
CREATE POLICY "Generate fee invoices" ON public.fee_invoices
  FOR INSERT TO authenticated
  WITH CHECK (public.has_fee_permission('fees.invoice.generate'));

-- Cancelling is the only client-side update, and it is its own permission
-- because voiding a bill a family has already been sent is not the same act as
-- creating one.
DROP POLICY IF EXISTS "Cancel fee invoices" ON public.fee_invoices;
CREATE POLICY "Cancel fee invoices" ON public.fee_invoices
  FOR UPDATE TO authenticated
  USING (public.has_fee_permission('fees.invoice.cancel'))
  WITH CHECK (public.has_fee_permission('fees.invoice.cancel'));

DROP POLICY IF EXISTS "Read fee invoice lines" ON public.fee_invoice_lines;
CREATE POLICY "Read fee invoice lines" ON public.fee_invoice_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fee_invoices i
     WHERE i.id = invoice_id
       AND (i.student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'))));

DROP POLICY IF EXISTS "Write fee invoice lines" ON public.fee_invoice_lines;
CREATE POLICY "Write fee invoice lines" ON public.fee_invoice_lines
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.invoice.generate'))
  WITH CHECK (public.has_fee_permission('fees.invoice.generate'));

DROP POLICY IF EXISTS "Read fee number series" ON public.fee_number_series;
CREATE POLICY "Read fee number series" ON public.fee_number_series
  FOR SELECT TO authenticated USING (public.has_fee_permission('fees.view'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_invoices, public.fee_invoice_lines TO authenticated;
GRANT SELECT ON public.fee_number_series TO authenticated;

GRANT EXECUTE ON FUNCTION public.fee_refresh_invoice(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fee_next_number(TEXT, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fee_mark_overdue()         FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
