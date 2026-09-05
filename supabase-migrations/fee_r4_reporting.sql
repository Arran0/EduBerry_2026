-- ─────────────────────────────────────────────────────────────────────────────
-- Round 4 — reporting.
--
-- Six views. Every one of them reads the same base tables the counter writes,
-- and the money ones go through fee_visible_amount(), so a user without
-- `fees.view_amounts` gets NULL from the database rather than a number the
-- interface promises to hide. security_invoker = true is what makes that work:
-- the view runs as the caller, so their permission decides, not the owner's.
--
-- Plain views rather than materialised ones. A school of a thousand students
-- has a few thousand invoices and tens of thousands of ledger rows a year;
-- that is a few milliseconds of aggregate, and a materialised view would buy
-- nothing but the chance for a report to be quietly stale — which in a fee
-- office is worse than slow.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Daily collection ────────────────────────────────────────────────────
-- What came in, per day, per method. The calendar heatmap and the "today"
-- figure both read this.
CREATE OR REPLACE VIEW public.fee_collection_daily
WITH (security_invoker = true) AS
SELECT
  p.academic_year_id,
  p.paid_on                                       AS day,
  p.method,
  COUNT(*)                                        AS receipts,
  public.fee_visible_amount(SUM(p.amount))        AS collected
FROM public.fee_payments p
WHERE p.status <> 'reversed'
GROUP BY p.academic_year_id, p.paid_on, p.method;

-- ── The aging cliff ─────────────────────────────────────────────────────
-- Dues stacked by how late they are. The buckets are the ones a fee office
-- already speaks in; "0" means due but not yet late.
CREATE OR REPLACE VIEW public.fee_outstanding_aging
WITH (security_invoker = true) AS
SELECT
  i.academic_year_id,
  CASE
    WHEN i.due_date >= CURRENT_DATE                     THEN 'not_yet_due'
    WHEN CURRENT_DATE - i.due_date <= 7                 THEN 'd1_7'
    WHEN CURRENT_DATE - i.due_date <= 30                THEN 'd8_30'
    WHEN CURRENT_DATE - i.due_date <= 60                THEN 'd31_60'
    WHEN CURRENT_DATE - i.due_date <= 90                THEN 'd61_90'
    ELSE 'd90_plus'
  END                                              AS bucket,
  COUNT(*)                                         AS bills,
  COUNT(DISTINCT i.student_id)                     AS students,
  public.fee_visible_amount(SUM(i.balance))        AS outstanding
FROM public.fee_invoices i
WHERE i.status <> 'cancelled' AND i.balance > 0
GROUP BY i.academic_year_id, 2;

-- ── Defaulters by class ─────────────────────────────────────────────────
-- Not just how much, but where. The heatmap on the Outstanding tab is this
-- view drawn as a grid, and every cell clicks through to a Remind action.
CREATE OR REPLACE VIEW public.fee_defaulters_by_class
WITH (security_invoker = true) AS
SELECT
  i.academic_year_id,
  pr.grade,
  pr.section,
  COUNT(DISTINCT i.student_id)                            AS students_owing,
  COUNT(*)                                                AS bills,
  MAX(CURRENT_DATE - i.due_date)                          AS worst_days_late,
  public.fee_visible_amount(SUM(i.balance))               AS outstanding,
  public.fee_visible_amount(
    SUM(i.balance) FILTER (WHERE i.due_date < CURRENT_DATE)) AS overdue
FROM public.fee_invoices i
JOIN public.profiles pr ON pr.id = i.student_id
WHERE i.status <> 'cancelled' AND i.balance > 0
GROUP BY i.academic_year_id, pr.grade, pr.section;

-- ── Concessions given, charges recovered ────────────────────────────────
-- Everything given away on purpose, next to what fines and late fees brought
-- back. A school that discounts more than it charges should see that.
CREATE OR REPLACE VIEW public.fee_concession_summary
WITH (security_invoker = true) AS
WITH given AS (
  SELECT c.academic_year_id, c.kind, COUNT(*) AS n,
         COUNT(DISTINCT c.student_id) AS students, SUM(c.amount) AS amount
    FROM public.fee_concessions c
   WHERE c.status = 'applied'
   GROUP BY c.academic_year_id, c.kind
), fines AS (
  SELECT f.academic_year_id,
         SUM(f.amount) FILTER (WHERE f.status = 'applied') AS charged,
         SUM(COALESCE(f.waived_amount, 0))                 AS waived
    FROM public.fee_fines f
   GROUP BY f.academic_year_id
), late AS (
  SELECT i.academic_year_id,
         SUM(lc.amount) FILTER (WHERE lc.status = 'charged') AS charged,
         SUM(lc.amount) FILTER (WHERE lc.status = 'waived')  AS waived
    FROM public.fee_late_fee_charges lc
    JOIN public.fee_invoices i ON i.id = lc.invoice_id
   GROUP BY i.academic_year_id
)
SELECT
  g.academic_year_id,
  g.kind,
  g.n                                            AS grants,
  g.students,
  public.fee_visible_amount(g.amount)            AS given_up,
  public.fee_visible_amount(f.charged)           AS fines_charged,
  public.fee_visible_amount(f.waived)            AS fines_waived,
  public.fee_visible_amount(l.charged)           AS late_fees_charged,
  public.fee_visible_amount(l.waived)            AS late_fees_waived
FROM given g
LEFT JOIN fines f ON f.academic_year_id = g.academic_year_id
LEFT JOIN late  l ON l.academic_year_id = g.academic_year_id;

-- ── The cheque pipeline ─────────────────────────────────────────────────
-- Where instrument money is stuck. `at_risk` is the count that has been
-- sitting in one state past the day it was meant to be presented.
CREATE OR REPLACE VIEW public.fee_instrument_pipeline
WITH (security_invoker = true) AS
SELECT
  p.academic_year_id,
  ins.kind,
  ins.status,
  COUNT(*)                                   AS instruments,
  public.fee_visible_amount(SUM(ins.amount)) AS amount,
  COUNT(*) FILTER (
    WHERE ins.status IN ('received','deposited')
      AND ins.present_on IS NOT NULL
      AND ins.present_on < CURRENT_DATE)     AS overdue_to_present
FROM public.fee_instruments ins
JOIN public.fee_payments p ON p.instrument_id = ins.id
GROUP BY p.academic_year_id, ins.kind, ins.status;

-- ── Who collected what ──────────────────────────────────────────────────
-- Per staff member, per month. This is a reconciliation tool, not a league
-- table: the question it answers is "whose cash box should hold what".
CREATE OR REPLACE VIEW public.fee_staff_collection
WITH (security_invoker = true) AS
SELECT
  p.academic_year_id,
  p.collected_by                                  AS staff_id,
  pr.full_name                                    AS staff_name,
  date_trunc('month', p.paid_on)::date            AS month,
  COUNT(*)                                        AS receipts,
  public.fee_visible_amount(SUM(p.amount))        AS collected,
  public.fee_visible_amount(
    SUM(p.amount) FILTER (WHERE p.method = 'cash')) AS cash,
  COUNT(*) FILTER (WHERE p.status = 'reversed')   AS reversed
FROM public.fee_payments p
LEFT JOIN public.profiles pr ON pr.id = p.collected_by
GROUP BY p.academic_year_id, p.collected_by, pr.full_name, 4;

-- ── The money equation ──────────────────────────────────────────────────
-- One row per session, stating plainly what the Overview tab shows:
--   (gross + late fees + fines + opening balances)
--     − (discounts + scholarships + waivers) = true payable
-- collected against it, and what is left. Every figure comes from the same
-- tables the counter writes to, so no two reports can disagree.
CREATE OR REPLACE VIEW public.fee_year_summary
WITH (security_invoker = true) AS
WITH bills AS (
  SELECT academic_year_id,
         COUNT(*)                  AS bills,
         COUNT(DISTINCT student_id) AS students,
         SUM(gross)                AS gross,
         SUM(late_fee_total)       AS late_fees,
         SUM(fine_total)           AS fines,
         SUM(discount_total)       AS discounts,
         SUM(tax_total)            AS tax,
         SUM(net)                  AS payable,
         SUM(paid)                 AS paid,
         SUM(balance)              AS outstanding,
         COUNT(*) FILTER (WHERE balance > 0 AND due_date < CURRENT_DATE) AS overdue_bills
    FROM public.fee_invoices
   WHERE status <> 'cancelled'
   GROUP BY academic_year_id
), opening AS (
  SELECT academic_year_id, SUM(amount) AS opening
    FROM public.fee_opening_balances GROUP BY academic_year_id
), refunded AS (
  SELECT academic_year_id, SUM(amount) AS refunded
    FROM public.fee_refunds WHERE status = 'paid_out' GROUP BY academic_year_id
), rte AS (
  SELECT academic_year_id,
         SUM(claimed_amount)     AS rte_claimed,
         SUM(reimbursed_amount)  AS rte_reimbursed
    FROM public.fee_rte_register GROUP BY academic_year_id
)
SELECT
  y.id                                              AS academic_year_id,
  y.code,
  y.starts_on,
  y.ends_on,
  -- How far through the session we are. 62% collected means nothing until you
  -- can see the year is half gone, so the number travels with the money.
  CASE WHEN y.ends_on > y.starts_on THEN
    GREATEST(0, LEAST(100, ROUND(
      (CURRENT_DATE - y.starts_on)::numeric * 100 / (y.ends_on - y.starts_on), 1)))
  END                                               AS session_progress,
  COALESCE(b.students, 0)                           AS students,
  COALESCE(b.bills, 0)                              AS bills,
  COALESCE(b.overdue_bills, 0)                      AS overdue_bills,
  public.fee_visible_amount(COALESCE(b.gross, 0))      AS gross,
  public.fee_visible_amount(COALESCE(b.late_fees, 0))  AS late_fees,
  public.fee_visible_amount(COALESCE(b.fines, 0))      AS fines,
  public.fee_visible_amount(COALESCE(b.discounts, 0))  AS concessions,
  public.fee_visible_amount(COALESCE(b.tax, 0))        AS tax,
  public.fee_visible_amount(COALESCE(o.opening, 0))    AS opening_balances,
  public.fee_visible_amount(COALESCE(b.payable, 0) + COALESCE(o.opening, 0)) AS payable,
  public.fee_visible_amount(COALESCE(b.paid, 0))       AS collected,
  public.fee_visible_amount(COALESCE(b.outstanding, 0) + COALESCE(o.opening, 0)) AS outstanding,
  public.fee_visible_amount(COALESCE(r.refunded, 0))   AS refunded,
  public.fee_visible_amount(COALESCE(t.rte_claimed, 0))    AS rte_claimed,
  public.fee_visible_amount(COALESCE(t.rte_reimbursed, 0)) AS rte_reimbursed,
  -- Collection efficiency, which is the one number a principal asks for.
  -- Computed inside the view rather than in the browser so every caller —
  -- the dashboard, an export, a future API — gets the same definition.
  CASE WHEN COALESCE(b.payable, 0) + COALESCE(o.opening, 0) > 0
       THEN ROUND(COALESCE(b.paid, 0) * 100
                  / (COALESCE(b.payable, 0) + COALESCE(o.opening, 0)), 1)
       ELSE NULL END                                 AS efficiency
FROM public.academic_years y
LEFT JOIN bills    b ON b.academic_year_id = y.id
LEFT JOIN opening  o ON o.academic_year_id = y.id
LEFT JOIN refunded r ON r.academic_year_id = y.id
LEFT JOIN rte      t ON t.academic_year_id = y.id;

-- ── Search ──────────────────────────────────────────────────────────────
-- One box over students, bill numbers, receipt numbers, UTRs and cheque
-- numbers. A view rather than a function so the interface can filter it
-- further; a UNION of five typed sources rather than free text, so the
-- natural-language box in Round 4's UI compiles to a whitelisted filter over
-- known columns and never to SQL a user wrote.
CREATE OR REPLACE VIEW public.fee_search_index
WITH (security_invoker = true) AS
SELECT 'student'::text AS kind, pr.id AS id, pr.id AS student_id,
       NULL::uuid AS academic_year_id,
       pr.full_name AS title,
       COALESCE(d.admission_no, '') AS subtitle,
       lower(pr.full_name || ' ' || COALESCE(d.admission_no, '')) AS haystack
  FROM public.profiles pr
  LEFT JOIN public.student_details d ON d.student_id = pr.id
 WHERE pr.role = 'student'
UNION ALL
SELECT 'invoice', i.id, i.student_id, i.academic_year_id,
       i.number, to_char(i.due_date, 'DD Mon YYYY'),
       lower(i.number)
  FROM public.fee_invoices i
UNION ALL
SELECT 'receipt', p.id, p.student_id, p.academic_year_id,
       p.receipt_no, to_char(p.paid_on, 'DD Mon YYYY'),
       lower(COALESCE(p.receipt_no, '') || ' ' || COALESCE(p.utr, '') || ' ' ||
             COALESCE(p.reference, ''))
  FROM public.fee_payments p
 WHERE p.receipt_no IS NOT NULL
UNION ALL
SELECT 'cheque', ins.id, ins.student_id, NULL::uuid,
       ins.number, COALESCE(ins.bank, ''),
       lower(ins.number || ' ' || COALESCE(ins.bank, ''))
  FROM public.fee_instruments ins;

-- ── Grants ──────────────────────────────────────────────────────────────
-- SELECT to authenticated is safe here because every view is
-- security_invoker: RLS on the base tables still applies to the caller, and
-- the money columns are already masked by fee_visible_amount().
GRANT SELECT ON
  public.fee_collection_daily, public.fee_outstanding_aging,
  public.fee_defaulters_by_class, public.fee_concession_summary,
  public.fee_instrument_pipeline, public.fee_staff_collection,
  public.fee_year_summary, public.fee_search_index
TO authenticated;

NOTIFY pgrst, 'reload schema';
