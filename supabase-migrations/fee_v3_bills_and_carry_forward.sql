-- ============================================================================
-- fee_v3_bills_and_carry_forward — the Bills register, collection by fee head,
-- and a carry-forward that moves a debt instead of copying it
-- ============================================================================
-- Run after fee_v2_optional_and_months.sql. Safe to re-run.
--
-- 1. fee_refresh_invoice: a bill's gross is what it billed. A negative
--    carry_forward line (the balance moved to the next session) lowers what is
--    still owed on the bill, not what the bill was for.
--
-- 2. fee_carry_forward: the old version copied each family's unpaid total into
--    fee_opening_balances and posted a ledger debit every time it ran. Run it
--    twice and the ledger owed twice; meanwhile the old bills stayed open, so
--    the same money could be collected in the old session and again from the
--    opening balance in the new one. Neither balance was a bill, so the new
--    session could not collect it at all.
--
--    Now the debt moves. Each unpaid bill gets a negative line "Carried forward
--    to 2027-28 — <new bill>", which closes it, and the student gets one bill in
--    the new session made of matching "Brought forward" lines. A bill that has
--    been carried has nothing left to carry, so a second run finds nothing; a
--    bill that reopens later (a reversed payment) carries only what reopened.
--
-- 3. fee_bill_register: the Bills tab, filtered in the database. Payment state,
--    overdue / paid late, payment mode, fee head, term, month, a date range and
--    a search, one round trip, amounts masked the usual way.
--
-- 4. fee_collection_by_head: what each fee head brought in, month by month.

-- ── 1. Gross counts what was billed ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_refresh_invoice(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_gross NUMERIC(12,2); v_discount NUMERIC(12,2); v_late NUMERIC(12,2);
  v_fine NUMERIC(12,2); v_tax NUMERIC(12,2); v_net NUMERIC(12,2); v_paid NUMERIC(12,2);
  v_status TEXT; v_current TEXT; v_due DATE; v_grace INT;
BEGIN
  SELECT status, due_date INTO v_current, v_due FROM public.fee_invoices WHERE id = p_invoice;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE kind = 'fee' OR (kind = 'carry_forward' AND amount > 0)), 0),
    COALESCE(-SUM(amount) FILTER (WHERE kind IN ('discount','scholarship','waiver')), 0),
    COALESCE(SUM(amount) FILTER (WHERE kind = 'late_fee'), 0),
    COALESCE(SUM(amount) FILTER (WHERE kind = 'fine'), 0),
    COALESCE(SUM(tax_amount), 0)
  INTO v_gross, v_discount, v_late, v_fine, v_tax
  FROM public.fee_invoice_lines WHERE invoice_id = p_invoice;

  SELECT COALESCE(SUM(amount), 0) INTO v_net
    FROM public.fee_invoice_lines WHERE invoice_id = p_invoice;

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
END $function$;

-- ── 2. Carry forward: move the debt, once ────────────────────────────────
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
  v_from     public.academic_years%ROWTYPE;
  v_to       public.academic_years%ROWTYPE;
  v_due      DATE;
  v_students INT := 0;
  v_bills    INT := 0;
  v_held     INT := 0;
  v_total    NUMERIC := 0;
  v_stu      RECORD;
  v_bill     RECORD;
  v_line     JSONB;
  v_lines    JSONB;
  v_profile  UUID;
  v_seq      BIGINT;
  v_number   TEXT;
  v_invoice  UUID;
  v_sort     INT;
  v_moved    NUMERIC;
BEGIN
  IF NOT public.fee_requires('fees.config.clone_year') THEN
    RAISE EXCEPTION 'You cannot carry balances between sessions.';
  END IF;
  IF p_from = p_to THEN
    RAISE EXCEPTION 'A session cannot carry forward into itself.';
  END IF;

  SELECT * INTO v_from FROM public.academic_years WHERE id = p_from;
  SELECT * INTO v_to   FROM public.academic_years WHERE id = p_to;
  IF v_from.id IS NULL OR v_to.id IS NULL THEN
    RAISE EXCEPTION 'That session does not exist.';
  END IF;
  IF v_to.starts_on <= v_from.starts_on THEN
    RAISE EXCEPTION 'Dues can only be carried into a later session.';
  END IF;

  -- Two people pressing the button at once must not both move the same debt.
  PERFORM pg_advisory_xact_lock(hashtext('fee_carry_forward'), hashtext(p_from::TEXT));

  v_due := GREATEST(v_to.starts_on, CURRENT_DATE);

  -- A bill with a cheque still in the bank stays where it is: if the cheque
  -- clears, the old bill is settled; if it bounces, a later run carries it.
  -- Moving it now would leave the family owing in both places once it cleared.
  SELECT COUNT(*) INTO v_held
    FROM public.fee_invoices i
   WHERE i.academic_year_id = p_from
     AND i.status NOT IN ('cancelled', 'draft')
     AND i.balance > 0
     AND EXISTS (SELECT 1 FROM public.fee_payment_allocations a
                   JOIN public.fee_payments p ON p.id = a.payment_id
                  WHERE a.invoice_id = i.id AND p.status = 'pending');

  FOR v_stu IN
    SELECT i.student_id, SUM(i.balance) AS owed, COUNT(*) AS bills
      FROM public.fee_invoices i
     WHERE i.academic_year_id = p_from
       AND i.status NOT IN ('cancelled', 'draft')
       AND i.balance > 0
       AND NOT EXISTS (SELECT 1 FROM public.fee_payment_allocations a
                         JOIN public.fee_payments p ON p.id = a.payment_id
                        WHERE a.invoice_id = i.id AND p.status = 'pending')
     GROUP BY i.student_id
     ORDER BY i.student_id
  LOOP
    IF NOT p_commit THEN
      v_students := v_students + 1;
      v_bills := v_bills + v_stu.bills;
      v_total := v_total + v_stu.owed;
      CONTINUE;
    END IF;

    -- Re-read under a row lock: the balances above were read without one.
    v_lines := '[]'::JSONB;
    v_moved := 0;
    FOR v_bill IN
      SELECT i.id, i.number, i.balance
        FROM public.fee_invoices i
       WHERE i.academic_year_id = p_from
         AND i.student_id = v_stu.student_id
         AND i.status NOT IN ('cancelled', 'draft')
         AND i.balance > 0
         AND NOT EXISTS (SELECT 1 FROM public.fee_payment_allocations a
                           JOIN public.fee_payments p ON p.id = a.payment_id
                          WHERE a.invoice_id = i.id AND p.status = 'pending')
       ORDER BY i.due_date, i.seq
       FOR UPDATE
    LOOP
      v_lines := v_lines || jsonb_build_object('id', v_bill.id, 'number', v_bill.number,
                                               'balance', v_bill.balance);
      v_moved := v_moved + v_bill.balance;
    END LOOP;

    -- Paid off between the two reads: nothing to bring forward, and no bill
    -- number is spent on an empty bill.
    CONTINUE WHEN v_moved <= 0;

    v_profile := public.fee_ensure_profile(v_stu.student_id, p_to);
    SELECT seq, formatted INTO v_seq, v_number FROM public.fee_next_number('invoice', p_to);
    INSERT INTO public.fee_invoices (profile_id, student_id, academic_year_id, number, seq,
                                     issue_date, due_date, created_by, status)
    VALUES (v_profile, v_stu.student_id, p_to, v_number, v_seq, CURRENT_DATE, v_due, v_actor, 'pending')
    RETURNING id INTO v_invoice;

    v_sort := 0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
      v_sort := v_sort + 1;
      v_bills := v_bills + 1;

      INSERT INTO public.fee_invoice_lines (invoice_id, kind, label, amount, source_id, sort)
      VALUES (v_invoice, 'carry_forward',
              format('Brought forward from %s — %s', v_from.code, v_line ->> 'number'),
              (v_line ->> 'balance')::NUMERIC, (v_line ->> 'id')::UUID, v_sort);

      INSERT INTO public.fee_invoice_lines (invoice_id, kind, label, amount, source_id, sort)
      VALUES ((v_line ->> 'id')::UUID, 'carry_forward',
              format('Carried forward to %s — %s', v_to.code, v_number),
              -(v_line ->> 'balance')::NUMERIC, v_invoice, 1000);
    END LOOP;

    v_students := v_students + 1;
    v_total := v_total + v_moved;

    PERFORM public.fee_post_ledger(v_stu.student_id, p_from, 'adjustment', 0, v_moved,
      'fee_invoices', v_invoice, format('Carried forward to %s as %s', v_to.code, v_number),
      CURRENT_DATE, v_actor);
    PERFORM public.fee_post_ledger(v_stu.student_id, p_to, 'opening_balance', v_moved, 0,
      'fee_invoices', v_invoice, format('Bill %s — brought forward from %s', v_number, v_from.code),
      CURRENT_DATE, v_actor);
  END LOOP;

  IF p_commit THEN
    PERFORM public.fee_log('year.carry_forward', 'academic_years', p_to, NULL, p_to,
                           jsonb_build_object('from', p_from),
                           jsonb_build_object('students', v_students, 'bills', v_bills),
                           NULL, v_total, v_actor);
  END IF;

  RETURN jsonb_build_object(
    'committed', p_commit, 'students', v_students, 'bills', v_bills, 'total', v_total,
    'held', v_held);
END $$;

REVOKE ALL ON FUNCTION public.fee_carry_forward(UUID, UUID, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fee_carry_forward(UUID, UUID, BOOLEAN, UUID) TO authenticated;

-- ── 3. The Bills register ───────────────────────────────────────────────
-- Payment state:  unpaid · partial · paid · carried · cancelled
-- Timing:         overdue (past due, money still owed — partly paid included)
--                 late    (fully paid, the last payment after the due date)
--                 on_time (everything else that is not cancelled)
-- Mode:           cash · cheque (cheque, DD) · bank_transfer (incl. net
--                 banking) · upi · other
-- Head:           a fee head id, or late_fee · fine · carry_forward · other
-- Date range:     the bill was issued, paid against or cancelled in it.
CREATE OR REPLACE FUNCTION public.fee_bill_register(
  p_year    UUID,
  p_from    DATE    DEFAULT NULL,
  p_to      DATE    DEFAULT NULL,
  p_pay     TEXT[]  DEFAULT NULL,
  p_timing  TEXT[]  DEFAULT NULL,
  p_modes   TEXT[]  DEFAULT NULL,
  p_heads   TEXT[]  DEFAULT NULL,
  p_terms   UUID[]  DEFAULT NULL,
  p_months  DATE[]  DEFAULT NULL,
  p_search  TEXT    DEFAULT NULL,
  p_limit   INT     DEFAULT 200,
  p_offset  INT     DEFAULT 0
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH inv AS (
  SELECT i.*
    FROM public.fee_invoices i
   WHERE i.academic_year_id = p_year AND i.status <> 'draft'
),
pay AS (
  SELECT a.invoice_id,
         MAX(p.paid_on) FILTER (WHERE p.status = 'verified') AS last_paid_on,
         array_agg(DISTINCT CASE
           WHEN p.method = 'cash'                           THEN 'cash'
           WHEN p.method IN ('cheque', 'dd')                THEN 'cheque'
           WHEN p.method IN ('bank_transfer', 'netbanking') THEN 'bank_transfer'
           WHEN p.method = 'upi'                            THEN 'upi'
           ELSE 'other' END) AS modes,
         array_agg(DISTINCT p.paid_on) AS paid_dates
    FROM public.fee_payment_allocations a
    JOIN public.fee_payments p ON p.id = a.payment_id
    JOIN inv ON inv.id = a.invoice_id
   WHERE p.status IN ('verified', 'pending')
   GROUP BY a.invoice_id
),
ln AS (
  SELECT l.invoice_id,
         array_remove(array_agg(DISTINCT CASE
           WHEN l.kind = 'late_fee'                         THEN 'late_fee'
           WHEN l.kind = 'fine'                             THEN 'fine'
           WHEN l.kind = 'carry_forward' AND l.amount > 0   THEN 'carry_forward'
           WHEN l.kind = 'fee' AND l.fee_head_id IS NOT NULL THEN l.fee_head_id::TEXT
           WHEN l.kind = 'fee'                              THEN 'other'
         END), NULL) AS heads,
         COALESCE(-SUM(l.amount) FILTER (WHERE l.kind = 'carry_forward' AND l.amount < 0), 0) AS carried_out
    FROM public.fee_invoice_lines l
    JOIN inv ON inv.id = l.invoice_id
   GROUP BY l.invoice_id
),
b AS (
  SELECT inv.id, inv.student_id, inv.number, inv.seq, inv.issue_date, inv.due_date, inv.status,
         inv.cancelled_reason, (inv.cancelled_at AT TIME ZONE 'Asia/Kolkata')::DATE AS cancelled_on,
         inv.net, inv.paid, inv.balance,
         s.title AS issue_title, s.term_id, t.name AS term_name,
         COALESCE(s.bill_month, date_trunc('month', inv.due_date)::DATE) AS bill_month,
         pay.last_paid_on, COALESCE(pay.modes, '{}') AS modes, COALESCE(pay.paid_dates, '{}') AS paid_dates,
         COALESCE(ln.heads, '{}') AS heads, COALESCE(ln.carried_out, 0) AS carried_out,
         pr.full_name, pr.grade, pr.section, sd.admission_no,
         CASE WHEN inv.status = 'cancelled'                              THEN 'cancelled'
              WHEN COALESCE(ln.carried_out, 0) > 0 AND inv.balance <= 0 THEN 'carried'
              WHEN inv.balance <= 0                                     THEN 'paid'
              WHEN inv.paid > 0                                         THEN 'partial'
              ELSE 'unpaid' END AS pay_state,
         CASE WHEN inv.status = 'cancelled'                                      THEN 'none'
              WHEN COALESCE(ln.carried_out, 0) > 0 AND inv.balance <= 0           THEN 'none'
              WHEN inv.balance > 0 AND inv.due_date < CURRENT_DATE                THEN 'overdue'
              WHEN inv.balance <= 0 AND pay.last_paid_on > inv.due_date           THEN 'late'
              ELSE 'on_time' END AS timing,
         GREATEST(inv.issue_date, pay.last_paid_on,
                  (inv.cancelled_at AT TIME ZONE 'Asia/Kolkata')::DATE) AS activity_on
    FROM inv
    LEFT JOIN public.fee_issues s       ON s.id = inv.issue_id
    LEFT JOIN public.fee_terms t        ON t.id = s.term_id
    LEFT JOIN pay                       ON pay.invoice_id = inv.id
    LEFT JOIN ln                        ON ln.invoice_id = inv.id
    LEFT JOIN public.profiles pr        ON pr.id = inv.student_id
    LEFT JOIN public.student_details sd ON sd.student_id = inv.student_id
),
f AS (
  SELECT *
    FROM b
   WHERE (p_pay    IS NULL OR cardinality(p_pay)    = 0 OR pay_state = ANY (p_pay))
     AND (p_timing IS NULL OR cardinality(p_timing) = 0 OR timing = ANY (p_timing))
     AND (p_modes  IS NULL OR cardinality(p_modes)  = 0 OR modes && p_modes)
     AND (p_heads  IS NULL OR cardinality(p_heads)  = 0 OR heads && p_heads)
     AND (p_terms  IS NULL OR cardinality(p_terms)  = 0 OR term_id = ANY (p_terms))
     AND (p_months IS NULL OR cardinality(p_months) = 0 OR bill_month = ANY (p_months))
     AND (p_from IS NULL
          OR issue_date BETWEEN p_from AND COALESCE(p_to, p_from)
          OR cancelled_on BETWEEN p_from AND COALESCE(p_to, p_from)
          OR EXISTS (SELECT 1 FROM unnest(paid_dates) d
                      WHERE d BETWEEN p_from AND COALESCE(p_to, p_from)))
     AND (p_search IS NULL OR btrim(p_search) = ''
          OR number ILIKE '%' || btrim(p_search) || '%'
          OR full_name ILIKE '%' || btrim(p_search) || '%'
          OR admission_no ILIKE '%' || btrim(p_search) || '%')
),
page AS (
  SELECT *
    FROM f
   ORDER BY activity_on DESC NULLS LAST, seq DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
  OFFSET GREATEST(0, COALESCE(p_offset, 0))
)
SELECT jsonb_build_object(
  'total',   (SELECT COUNT(*) FROM f),
  'net',     public.fee_visible_amount((SELECT COALESCE(SUM(net), 0)     FROM f WHERE pay_state <> 'cancelled')),
  'paid',    public.fee_visible_amount((SELECT COALESCE(SUM(paid), 0)    FROM f WHERE pay_state <> 'cancelled')),
  'balance', public.fee_visible_amount((SELECT COALESCE(SUM(balance), 0) FROM f WHERE pay_state <> 'cancelled')),
  'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', id, 'student_id', student_id, 'full_name', full_name, 'grade', grade,
             'section', section, 'admission_no', admission_no, 'number', number, 'seq', seq,
             'issue_date', issue_date, 'due_date', due_date, 'status', status,
             'pay_state', pay_state, 'timing', timing, 'last_paid_on', last_paid_on,
             'activity_on', activity_on, 'modes', modes, 'heads', heads,
             'term_name', term_name, 'bill_month', bill_month, 'issue_title', issue_title,
             'cancelled_reason', cancelled_reason,
             'carried_out', public.fee_visible_amount(carried_out),
             'net', public.fee_visible_amount(net),
             'paid', public.fee_visible_amount(paid),
             'balance', public.fee_visible_amount(balance))
           ORDER BY activity_on DESC NULLS LAST, seq DESC)
      FROM page), '[]'::JSONB)
);
$$;

REVOKE ALL ON FUNCTION public.fee_bill_register(UUID, DATE, DATE, TEXT[], TEXT[], TEXT[], TEXT[], UUID[], DATE[], TEXT, INT, INT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fee_bill_register(UUID, DATE, DATE, TEXT[], TEXT[], TEXT[], TEXT[], UUID[], DATE[], TEXT, INT, INT)
  TO authenticated;

-- ── 4. Collection by fee head ───────────────────────────────────────────
-- A payment is put against a bill, not against a head, so each allocation is
-- shared across the bill's charges in proportion to their size. The shares
-- add up to the allocation, so the heads always add up to the month.
CREATE OR REPLACE FUNCTION public.fee_collection_by_head(p_year UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH inv AS (
  SELECT id FROM public.fee_invoices
   WHERE academic_year_id = p_year AND status NOT IN ('cancelled', 'draft')
),
ln AS (
  SELECT l.invoice_id,
         CASE WHEN l.kind = 'late_fee'          THEN 'late_fee'
              WHEN l.kind = 'fine'              THEN 'fine'
              WHEN l.kind = 'carry_forward'     THEN 'carry_forward'
              WHEN l.fee_head_id IS NOT NULL    THEN l.fee_head_id::TEXT
              ELSE 'other' END AS head,
         l.amount
    FROM public.fee_invoice_lines l
    JOIN inv ON inv.id = l.invoice_id
   WHERE l.amount > 0 AND l.kind IN ('fee', 'late_fee', 'fine', 'carry_forward')
),
tot AS (SELECT invoice_id, SUM(amount) AS pos FROM ln GROUP BY invoice_id),
alloc AS (
  SELECT a.invoice_id, date_trunc('month', p.paid_on)::DATE AS month, SUM(a.amount) AS amount
    FROM public.fee_payment_allocations a
    JOIN public.fee_payments p ON p.id = a.payment_id
    JOIN inv ON inv.id = a.invoice_id
   WHERE p.status = 'verified'
   GROUP BY a.invoice_id, date_trunc('month', p.paid_on)::DATE
),
by_month AS (
  SELECT ln.head, alloc.month, SUM(alloc.amount * ln.amount / tot.pos) AS collected
    FROM alloc
    JOIN tot ON tot.invoice_id = alloc.invoice_id AND tot.pos > 0
    JOIN ln  ON ln.invoice_id = alloc.invoice_id
   GROUP BY ln.head, alloc.month
),
billed AS (SELECT head, SUM(amount) AS billed FROM ln GROUP BY head),
heads AS (
  SELECT b.head,
         CASE b.head WHEN 'late_fee'      THEN 'Late fee'
                     WHEN 'fine'          THEN 'Fines'
                     WHEN 'carry_forward' THEN 'Brought forward'
                     WHEN 'other'         THEN 'Other fees'
                     ELSE COALESCE(h.name, 'Fee') END AS name,
         COALESCE(h.sort, 900) AS sort,
         b.billed,
         COALESCE((SELECT SUM(m.collected) FROM by_month m WHERE m.head = b.head), 0) AS collected
    FROM billed b
    LEFT JOIN public.fee_heads h ON h.id::TEXT = b.head
)
SELECT jsonb_build_object(
  'heads', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'key', head, 'name', name,
             'billed', public.fee_visible_amount(ROUND(billed, 2)),
             'collected', public.fee_visible_amount(ROUND(collected, 2)))
           ORDER BY collected DESC, sort, name)
      FROM heads), '[]'::JSONB),
  'months', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'month', month, 'head', head,
             'collected', public.fee_visible_amount(ROUND(collected, 2)))
           ORDER BY month, head)
      FROM by_month), '[]'::JSONB)
);
$$;

REVOKE ALL ON FUNCTION public.fee_collection_by_head(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fee_collection_by_head(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
