-- ============================================================================
-- fee_r2_bus_merge — transport joins the one ledger
-- ============================================================================
-- Round 2 of docs/fee-upgrade-plan.md. Run after fee_r2_autogen_cron.sql.
-- Safe to re-run.
--
-- Transport fees were a copy-paste fork: bus_fee_heads / bus_fees /
-- bus_payments are the same three tables again, with their own screens, their
-- own reference prefix and no academic year at all. The cost is not the
-- duplicated code — it is that a family gets two bills for one child, and the
-- Collection Center under-reports by whatever the buses take.
--
-- What this migration does:
--
--   1. Makes transport a first-class part of the price list: the Transport
--      category is already seeded, and every bus_fee_heads row becomes a
--      fee_heads row flagged is_transport, per academic year.
--   2. Provides fee_import_bus_ledger(), which brings any existing bus_fees and
--      bus_payments across into fee_invoices / fee_payments so a school that
--      has been using the bus module does not lose its history.
--   3. Adds fee_collection_all, the view reporting reads, so headline numbers
--      cover both systems from today whether or not the import has been run.
--
-- What it deliberately does NOT do: replace bus_fees and bus_payments with
-- views. src/lib/bus.ts writes to those tables in fifteen places — drafts,
-- trips, statements, the passenger picker — and a view is not updatable without
-- INSTEAD OF triggers that would have to reproduce all of it. Breaking a
-- working module to save a table is a bad trade. The legacy tables stay,
-- stop being written to as the bus screens are ported, and the import brings
-- their contents across when they are.

-- ── 1. Transport heads in the unified price list ────────────────────────
CREATE OR REPLACE FUNCTION public.fee_sync_transport_heads(p_year UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat   UUID := (SELECT id FROM public.fee_categories WHERE code = 'TRANSPORT');
  v_count INT  := 0;
BEGIN
  IF NOT public.fee_requires('fees.config.manage') THEN
    RAISE EXCEPTION 'You do not have permission to edit the price list';
  END IF;

  INSERT INTO public.fee_heads (
    academic_year_id, category_id, name, code, description,
    default_amount, is_transport, active, sort)
  SELECT p_year, v_cat, b.name,
         'BUS_' || upper(regexp_replace(b.name, '[^a-zA-Z0-9]+', '_', 'g')),
         b.description, b.default_amount, true, b.active, 500
    FROM public.bus_fee_heads b
   WHERE NOT EXISTS (
     SELECT 1 FROM public.fee_heads h
      WHERE h.academic_year_id = p_year
        AND h.code = 'BUS_' || upper(regexp_replace(b.name, '[^a-zA-Z0-9]+', '_', 'g')));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- ── 2. Bringing existing transport money across ─────────────────────────
-- One invoice per bus fee, one payment per verified bus payment, each landing
-- on the ledger like anything else. Idempotent: a bus fee already imported is
-- recognised by its upi_reference, which is carried onto the invoice's note.
CREATE OR REPLACE FUNCTION public.fee_import_bus_ledger(
  p_year UUID, p_commit BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_f        RECORD;
  v_p        RECORD;
  v_profile  UUID;
  v_invoice  UUID;
  v_payment  UUID;
  v_seq      BIGINT;
  v_number   TEXT;
  v_head     UUID;
  v_invoices INT := 0;
  v_payments INT := 0;
  v_skipped  INT := 0;
  v_amount   NUMERIC(12,2) := 0;
BEGIN
  IF NOT public.fee_requires('fees.invoice.generate') THEN
    RAISE EXCEPTION 'You do not have permission to import transport bills';
  END IF;

  FOR v_f IN
    SELECT bf.*, bh.name AS head_name
      FROM public.bus_fees bf
      LEFT JOIN public.bus_fee_heads bh ON bh.id = bf.fee_head_id
     WHERE bf.status <> 'cancelled'
  LOOP
    SELECT id INTO v_profile FROM public.fee_profiles
     WHERE student_id = v_f.passenger_id AND academic_year_id = p_year;

    -- A passenger with no fee profile for this session cannot be billed here.
    -- Reported rather than silently dropped.
    IF v_profile IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.fee_invoices i
                JOIN public.fee_invoice_lines l ON l.invoice_id = i.id
               WHERE i.student_id = v_f.passenger_id
                 AND l.note = v_f.upi_reference) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT id INTO v_head FROM public.fee_heads
     WHERE academic_year_id = p_year AND is_transport
     ORDER BY sort LIMIT 1;

    v_invoices := v_invoices + 1;
    v_amount := v_amount + v_f.amount;

    IF p_commit THEN
      SELECT seq, formatted INTO v_seq, v_number FROM public.fee_next_number('invoice', p_year);

      INSERT INTO public.fee_invoices (
        profile_id, student_id, academic_year_id, number, seq,
        issue_date, due_date, created_by, status)
      VALUES (v_profile, v_f.passenger_id, p_year, v_number, v_seq,
              COALESCE(v_f.created_at::DATE, CURRENT_DATE),
              COALESCE(v_f.due_date, CURRENT_DATE), (SELECT auth.uid()), 'pending')
      RETURNING id INTO v_invoice;

      INSERT INTO public.fee_invoice_lines (invoice_id, kind, fee_head_id, label, amount, sort, note)
      VALUES (v_invoice, 'fee', v_head,
              COALESCE(v_f.head_name, v_f.description, 'Transport'),
              v_f.amount, 500, v_f.upi_reference);

      PERFORM public.fee_post_ledger(
        v_f.passenger_id, p_year, 'invoice', v_f.amount, 0,
        'fee_invoices', v_invoice,
        format('Transport bill %s (imported from %s)', v_number, v_f.upi_reference));

      FOR v_p IN
        SELECT * FROM public.bus_payments
         WHERE fee_id = v_f.id AND status = 'verified'
      LOOP
        SELECT seq, formatted INTO v_seq, v_number FROM public.fee_next_number('receipt', p_year);

        INSERT INTO public.fee_payments (
          student_id, academic_year_id, receipt_no, seq, paid_on, method, amount,
          reference, notes, status, collected_by, verified_by, verified_at,
          razorpay_order_id, razorpay_payment_id, utr)
        VALUES (
          v_f.passenger_id, p_year, v_number, v_seq,
          COALESCE(v_p.created_at::DATE, CURRENT_DATE),
          CASE v_p.method::TEXT
            WHEN 'upi_qr' THEN 'upi'
            WHEN 'bank'   THEN 'bank_transfer'
            ELSE v_p.method::TEXT END,
          v_p.amount, v_p.upi_txn_ref, 'Imported from the bus module', 'verified',
          v_p.payer_id, v_p.verified_by, v_p.verified_at,
          v_p.razorpay_order_id, v_p.razorpay_payment_id, NULL)
        RETURNING id INTO v_payment;

        INSERT INTO public.fee_payment_allocations (payment_id, invoice_id, amount)
        VALUES (v_payment, v_invoice, LEAST(v_p.amount, v_f.amount));

        PERFORM public.fee_post_ledger(
          v_f.passenger_id, p_year, 'payment', 0, v_p.amount,
          'fee_payments', v_payment, format('Transport receipt %s (imported)', v_number));

        PERFORM public.fee_seal_receipt(v_payment);
        v_payments := v_payments + 1;
      END LOOP;
    END IF;
  END LOOP;

  IF p_commit THEN
    PERFORM public.fee_log('bus.import', 'fee_invoices', NULL, NULL, p_year, NULL,
      jsonb_build_object('invoices', v_invoices, 'payments', v_payments), NULL, v_amount);
  END IF;

  RETURN jsonb_build_object(
    'committed', p_commit, 'invoices', v_invoices, 'payments', v_payments,
    'skipped', v_skipped, 'amount', v_amount);
END $$;

-- ── 3. One number for the Collection Center ─────────────────────────────
-- Reporting reads this rather than fee_invoices directly, so the headline
-- figures are right whether or not a school has run the import yet. Once the
-- bus screens are ported and the legacy tables stop being written to, the
-- second branch simply returns nothing.
CREATE OR REPLACE VIEW public.fee_collection_all
WITH (security_invoker = true) AS
SELECT
  'fee'::TEXT      AS source,
  p.id             AS payment_id,
  p.student_id,
  p.academic_year_id,
  p.paid_on,
  p.method::TEXT   AS method,
  p.amount,
  p.status,
  p.receipt_no
FROM public.fee_payments p
WHERE p.status = 'verified'

UNION ALL

SELECT
  'bus'::TEXT,
  bp.id,
  bf.passenger_id,
  public.academic_year_id_for(COALESCE(bp.created_at::DATE, CURRENT_DATE)),
  COALESCE(bp.created_at::DATE, CURRENT_DATE),
  bp.method::TEXT,
  bp.amount,
  'verified'::TEXT,
  NULL
FROM public.bus_payments bp
JOIN public.bus_fees bf ON bf.id = bp.fee_id
WHERE bp.status = 'verified'
  -- Anything already imported is a fee_payments row too; counting it here as
  -- well would double the school's collection figure.
  AND NOT EXISTS (
    SELECT 1 FROM public.fee_invoice_lines l WHERE l.note = bf.upi_reference);

GRANT SELECT ON public.fee_collection_all TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_sync_transport_heads(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_import_bus_ledger(UUID, BOOLEAN) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fee_sync_transport_heads(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fee_import_bus_ledger(UUID, BOOLEAN) FROM anon;

NOTIFY pgrst, 'reload schema';
