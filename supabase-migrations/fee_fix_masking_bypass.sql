-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY FIX — amount masking was bypassable by reading the base table.
--
-- The module's promise, in its own words: "the views wrap every money column
-- in fee_visible_amount(), so a user without `fees.view_amounts` gets NULL
-- from the database and the figure is not in the response at all — this is not
-- a CSS blur and cannot be undone in devtools."
--
-- That holds for the `_v` views. It did not hold for the tables underneath
-- them. Proven against the live database with an account holding
-- `fees.view`, `fees.profile.view` and `fees.collect` but NOT
-- `fees.view_amounts`:
--
--   select net from fee_invoices_v where number = 'MASKPROBE/0001'  ->  null
--   select net from fee_invoices   where number = 'MASKPROBE/0001'  ->  7777
--
-- `GRANT SELECT ON public.fee_invoices TO authenticated` plus an RLS policy
-- that admits anyone with `fees.profile.view` means the masked account only
-- has to ask for the table instead of the view. One line in a browser console.
--
-- The fix has two halves, and both are needed:
--
--   1. The money columns are revoked from `authenticated` at the column level,
--      so the base table cannot answer for them at all. The rest of each row
--      stays readable, because a masked clerk is meant to see the list, the
--      count and the dates — that is the point of the feature.
--
--   2. The views stop being `security_invoker`. A security_invoker view reads
--      as the caller, so it would lose the columns too. Running them as the
--      owner restores the read — and means they must now apply the row filter
--      themselves, because the base table's RLS is no longer consulted. Each
--      WHERE below is a verbatim copy of the policy it replaces.
--
-- APPLY WITH THE SMOKE TEST BELOW. Getting the WHERE wrong here would show one
-- family another family's bills, which is worse than the bug being fixed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Take the money columns away from direct readers ──────────────────
REVOKE SELECT (gross, discount_total, tax_total, late_fee_total, fine_total,
               net, paid, balance)
  ON public.fee_invoices FROM authenticated;

REVOKE SELECT (amount) ON public.fee_payments        FROM authenticated;
REVOKE SELECT (debit, credit, balance_after)
  ON public.fee_ledger_entries                       FROM authenticated;
REVOKE SELECT (opening_balance) ON public.fee_profiles FROM authenticated;

-- ── 2. The views become the only way to those figures ───────────────────
-- Each WHERE is the base table's own "Read …" policy, copied exactly:
--   student_id = auth.uid() OR has_fee_permission('fees.profile.view')

CREATE OR REPLACE VIEW public.fee_invoices_v
WITH (security_invoker = false) AS
SELECT
  i.id, i.profile_id, i.student_id, i.academic_year_id, i.installment_id,
  i.number, i.seq, i.issue_date, i.due_date, i.status, i.autogen, i.verify_token,
  i.cancelled_reason, i.cancelled_by, i.cancelled_at, i.created_at, i.updated_at,
  public.fee_visible_amount(i.gross)          AS gross,
  public.fee_visible_amount(i.discount_total) AS discount_total,
  public.fee_visible_amount(i.tax_total)      AS tax_total,
  public.fee_visible_amount(i.late_fee_total) AS late_fee_total,
  public.fee_visible_amount(i.fine_total)     AS fine_total,
  public.fee_visible_amount(i.net)            AS net,
  public.fee_visible_amount(i.paid)           AS paid,
  public.fee_visible_amount(i.balance)        AS balance
FROM public.fee_invoices i
WHERE i.student_id = (SELECT auth.uid())
   OR public.has_fee_permission('fees.profile.view');

CREATE OR REPLACE VIEW public.fee_payments_v
WITH (security_invoker = false) AS
SELECT
  p.id, p.student_id, p.academic_year_id, p.receipt_no, p.seq, p.paid_on,
  p.method, p.reference, p.notes, p.instrument_id, p.status, p.collected_by,
  p.reversed_at, p.reversal_reason, p.receipt_hash,
  public.fee_visible_amount(p.amount) AS amount
FROM public.fee_payments p
WHERE p.student_id = (SELECT auth.uid())
   OR public.has_fee_permission('fees.profile.view');

CREATE OR REPLACE VIEW public.fee_ledger_v
WITH (security_invoker = false) AS
SELECT
  l.id, l.student_id, l.academic_year_id, l.entry_date, l.kind,
  l.ref_table, l.ref_id, l.note,
  public.fee_visible_amount(l.debit)         AS debit,
  public.fee_visible_amount(l.credit)        AS credit,
  public.fee_visible_amount(l.balance_after) AS balance_after
FROM public.fee_ledger_entries l
WHERE l.student_id = (SELECT auth.uid())
   OR public.has_fee_permission('fees.profile.view');

CREATE OR REPLACE VIEW public.fee_profiles_v
WITH (security_invoker = false) AS
SELECT
  f.id, f.student_id, f.academic_year_id, f.fee_group_id, f.structure_id,
  f.structure_source, f.status, f.prorate_from, f.is_rte, f.notes,
  public.fee_visible_amount(f.opening_balance) AS opening_balance
FROM public.fee_profiles f
WHERE f.student_id = (SELECT auth.uid())
   OR public.has_fee_permission('fees.profile.view');

GRANT SELECT ON public.fee_invoices_v, public.fee_payments_v,
                public.fee_ledger_v, public.fee_profiles_v TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- Smoke test. Run each as the named user, not as the service role — the
-- service role bypasses every check here and will tell you nothing.
--
--   As a student:
--     select count(*) from fee_invoices_v;         -- only their own
--     select net from fee_invoices;                -- ERROR: permission denied
--
--   As a clerk WITHOUT fees.view_amounts:
--     select number, net from fee_invoices_v;      -- every row, net NULL
--     select net from fee_invoices;                -- ERROR: permission denied
--
--   As a clerk WITH fees.view_amounts:
--     select number, net from fee_invoices_v;      -- every row, real figures
--
--   As another student:
--     select count(*) from fee_invoices_v;         -- 0 for someone else's bill
-- ─────────────────────────────────────────────────────────────────────────────
