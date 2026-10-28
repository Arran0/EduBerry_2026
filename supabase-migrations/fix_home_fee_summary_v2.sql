-- The home dashboard's fee figures, read from the fee app's own tables.
--
-- The admin home's School Overview and fee tiles were still totalling the
-- first-generation tables (school_fees, school_fee_payments, bus_fees,
-- bus_payments). Billing moved to fee_invoices / fee_payments with the fee_v2
-- migrations, so those tables are empty and the tiles showed nothing collected
-- and nothing owed. Bus fees are now ordinary bills under the transport head
-- (fee_heads.is_transport), so they come out of the same tables.
--
-- One call returns everything the home needs, in place of the five queries it
-- used to fire:
--   total      every bill in the session
--   school     the share of each bill that is not the transport head
--   transport  the transport head's share
--   heads      one entry per fee head (plus late fee, fines, brought forward
--              and other), largest first
-- each with collected, outstanding, today (collected on p_today) and
-- students_with_dues.
--
-- A payment is shared across the charges on the bill it paid in proportion to
-- their size, and so is a bill's outstanding balance: the same rule
-- fee_collection_by_head uses, so the two never disagree.
--
-- SECURITY INVOKER: row-level security on the fee tables decides what the caller
-- can see, and fee_visible_amount() blanks the figures for anyone without
-- fees.view_amounts, exactly as the fee reports do.
--
-- SAFE TO RE-RUN.

CREATE OR REPLACE FUNCTION public.fee_home_summary(p_today DATE, p_year UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH yr AS (
  SELECT COALESCE(p_year, (SELECT id FROM public.academic_years WHERE is_active ORDER BY starts_on DESC LIMIT 1)) AS id
),
inv AS (
  SELECT i.id, i.student_id, GREATEST(COALESCE(i.balance, 0), 0) AS balance
    FROM public.fee_invoices i, yr
   WHERE i.academic_year_id = yr.id AND i.status NOT IN ('cancelled', 'draft')
),
ln AS (
  SELECT l.invoice_id,
         CASE WHEN l.kind = 'late_fee'       THEN 'late_fee'
              WHEN l.kind = 'fine'           THEN 'fine'
              WHEN l.kind = 'carry_forward'  THEN 'carry_forward'
              WHEN l.fee_head_id IS NOT NULL THEN l.fee_head_id::TEXT
              ELSE 'other' END AS head,
         l.amount
    FROM public.fee_invoice_lines l
    JOIN inv ON inv.id = l.invoice_id
   WHERE l.amount > 0 AND l.kind IN ('fee', 'late_fee', 'fine', 'carry_forward')
),
tot AS (SELECT invoice_id, SUM(amount) AS pos FROM ln GROUP BY invoice_id),
share AS (
  SELECT ln.invoice_id, ln.head, ln.amount / tot.pos AS w
    FROM ln JOIN tot ON tot.invoice_id = ln.invoice_id
   WHERE tot.pos > 0
),
alloc AS (
  SELECT a.invoice_id,
         SUM(a.amount) AS amount,
         COALESCE(SUM(a.amount) FILTER (WHERE p.paid_on = p_today), 0) AS today
    FROM public.fee_payment_allocations a
    JOIN public.fee_payments p ON p.id = a.payment_id
    JOIN inv ON inv.id = a.invoice_id
   WHERE p.status = 'verified'
   GROUP BY a.invoice_id
),
per_head AS (
  SELECT s.head,
         SUM(COALESCE(al.amount, 0) * s.w) AS collected,
         SUM(COALESCE(al.today, 0) * s.w)  AS today,
         SUM(i.balance * s.w)              AS outstanding,
         COUNT(DISTINCT i.student_id) FILTER (WHERE i.balance > 0) AS students_with_dues
    FROM share s
    JOIN inv i ON i.id = s.invoice_id
    LEFT JOIN alloc al ON al.invoice_id = s.invoice_id
   GROUP BY s.head
),
heads AS (
  SELECT ph.*,
         CASE ph.head WHEN 'late_fee'      THEN 'Late fee'
                      WHEN 'fine'          THEN 'Fines'
                      WHEN 'carry_forward' THEN 'Brought forward'
                      WHEN 'other'         THEN 'Other fees'
                      ELSE COALESCE(h.name, 'Fee') END AS name,
         COALESCE(h.is_transport, false) AS is_transport,
         COALESCE(h.sort, 900) AS sort
    FROM per_head ph
    LEFT JOIN public.fee_heads h ON h.id::TEXT = ph.head
),
-- Each bill split once into its transport and non-transport parts, so a
-- student owing both is counted once in each group and once in the total.
part AS (
  SELECT s.invoice_id, COALESCE(h.is_transport, false) AS is_transport, SUM(s.w) AS w
    FROM share s
    LEFT JOIN public.fee_heads h ON h.id::TEXT = s.head
   GROUP BY s.invoice_id, COALESCE(h.is_transport, false)
),
grp AS (
  SELECT p.is_transport,
         SUM(COALESCE(al.amount, 0) * p.w) AS collected,
         SUM(COALESCE(al.today, 0) * p.w)  AS today,
         SUM(i.balance * p.w)              AS outstanding,
         COUNT(DISTINCT i.student_id) FILTER (WHERE i.balance > 0) AS students_with_dues
    FROM part p
    JOIN inv i ON i.id = p.invoice_id
    LEFT JOIN alloc al ON al.invoice_id = p.invoice_id
   GROUP BY p.is_transport
),
total AS (
  SELECT COALESCE(SUM(al.amount), 0) AS collected,
         COALESCE(SUM(al.today), 0)  AS today,
         COALESCE(SUM(i.balance), 0) AS outstanding,
         COUNT(DISTINCT i.student_id) FILTER (WHERE i.balance > 0) AS students_with_dues
    FROM inv i
    LEFT JOIN alloc al ON al.invoice_id = i.id
)
SELECT jsonb_build_object(
  'total', (SELECT jsonb_build_object(
              'collected',   public.fee_visible_amount(ROUND(collected, 2)),
              'outstanding', public.fee_visible_amount(ROUND(outstanding, 2)),
              'today',       public.fee_visible_amount(ROUND(today, 2)),
              'students_with_dues', students_with_dues)
            FROM total),
  'school', COALESCE((SELECT jsonb_build_object(
              'collected',   public.fee_visible_amount(ROUND(collected, 2)),
              'outstanding', public.fee_visible_amount(ROUND(outstanding, 2)),
              'today',       public.fee_visible_amount(ROUND(today, 2)),
              'students_with_dues', students_with_dues)
            FROM grp WHERE NOT is_transport), jsonb_build_object(
              'collected', 0, 'outstanding', 0, 'today', 0, 'students_with_dues', 0)),
  'transport', COALESCE((SELECT jsonb_build_object(
              'collected',   public.fee_visible_amount(ROUND(collected, 2)),
              'outstanding', public.fee_visible_amount(ROUND(outstanding, 2)),
              'today',       public.fee_visible_amount(ROUND(today, 2)),
              'students_with_dues', students_with_dues)
            FROM grp WHERE is_transport), jsonb_build_object(
              'collected', 0, 'outstanding', 0, 'today', 0, 'students_with_dues', 0)),
  'heads', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'key', head, 'name', name, 'is_transport', is_transport,
             'collected',   public.fee_visible_amount(ROUND(collected, 2)),
             'outstanding', public.fee_visible_amount(ROUND(outstanding, 2)),
             'today',       public.fee_visible_amount(ROUND(today, 2)),
             'students_with_dues', students_with_dues)
           ORDER BY collected + outstanding DESC, sort, name)
      FROM heads), '[]'::JSONB)
);
$$;

REVOKE EXECUTE ON FUNCTION public.fee_home_summary(DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fee_home_summary(DATE, UUID) TO authenticated;

-- The School Overview's monthly chart: what was collected in each month of one
-- calendar year, by fee head, plus the first year anything was collected (the
-- chart's year switcher starts there).
--
-- The chart spans academic years (January to March belongs to the previous
-- session), and fee heads are created per session, so a head is reported by its
-- name rather than its id: "Tuition" in two sessions is one series. Transport
-- heads are reported as '__bus', the chart's bus fee series. A payment against a
-- bill with no fee lines is counted as 'other'.
CREATE OR REPLACE FUNCTION public.fee_home_collections(p_year INT)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH pay AS (
  SELECT a.invoice_id, EXTRACT(MONTH FROM p.paid_on)::INT AS month, SUM(a.amount) AS amount
    FROM public.fee_payment_allocations a
    JOIN public.fee_payments p ON p.id = a.payment_id
   WHERE p.status = 'verified'
     AND p.paid_on >= make_date(p_year, 1, 1)
     AND p.paid_on <  make_date(p_year + 1, 1, 1)
   GROUP BY a.invoice_id, EXTRACT(MONTH FROM p.paid_on)
),
ln AS (
  SELECT l.invoice_id,
         CASE WHEN h.is_transport            THEN '__bus'
              WHEN l.kind = 'late_fee'       THEN 'late_fee'
              WHEN l.kind = 'fine'           THEN 'fine'
              WHEN l.kind = 'carry_forward'  THEN 'carry_forward'
              WHEN h.id IS NOT NULL          THEN h.name
              ELSE 'other' END AS head,
         l.amount
    FROM public.fee_invoice_lines l
    LEFT JOIN public.fee_heads h ON h.id = l.fee_head_id
   WHERE l.amount > 0 AND l.kind IN ('fee', 'late_fee', 'fine', 'carry_forward')
     AND l.invoice_id IN (SELECT invoice_id FROM pay)
),
tot AS (SELECT invoice_id, SUM(amount) AS pos FROM ln GROUP BY invoice_id HAVING SUM(amount) > 0),
by_month AS (
  SELECT pay.month,
         COALESCE(ln.head, 'other') AS head,
         SUM(pay.amount * COALESCE(ln.amount / tot.pos, 1)) AS collected
    FROM pay
    LEFT JOIN tot ON tot.invoice_id = pay.invoice_id
    LEFT JOIN ln  ON ln.invoice_id = tot.invoice_id
   GROUP BY pay.month, COALESCE(ln.head, 'other')
)
SELECT jsonb_build_object(
  'first_year', (SELECT EXTRACT(YEAR FROM MIN(paid_on))::INT FROM public.fee_payments WHERE status = 'verified'),
  'months', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'month', month, 'head', head,
             'collected', public.fee_visible_amount(ROUND(collected, 2)))
           ORDER BY month, head)
      FROM by_month), '[]'::JSONB)
);
$$;

REVOKE EXECUTE ON FUNCTION public.fee_home_collections(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fee_home_collections(INT) TO authenticated;
