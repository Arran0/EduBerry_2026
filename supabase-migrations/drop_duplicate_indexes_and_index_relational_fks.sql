-- Two findings from the performance advisor, handled differently.
--
-- 1. Duplicate indexes (pure write overhead). Fifteen tables carry a plain
--    idx_* index whose column list is byte-identical to the index already
--    backing a UNIQUE constraint on the same table. The constraint index cannot
--    be dropped (it enforces the constraint) and serves every lookup the plain
--    one did, including leading-column prefix scans, so the plain duplicate is
--    dead weight on every INSERT and UPDATE. Verified per pair that the kept
--    index is the constraint-backed one and the dropped index is neither unique
--    nor constraint-backed.
--
-- 2. Unindexed foreign keys: 68 reported, but 66 are pure audit-trail actor
--    columns (created_by on 38 tables, plus approved_by / requested_by /
--    published_by / sanctioned_by / verified_by / waived_by / locked_by /
--    granted_by / removed_by / resolved_by / reversed_by / sent_by / updated_by
--    / cancelled_by / enabled_by / actor_id / variance_acknowledged_by). The app
--    displays those names, it never filters by them — grep for .eq('created_by')
--    and friends finds hits only on `tasks` and `exams`, both already indexed.
--    Indexing 66 columns nobody queries would cost write throughput on every fee
--    and payroll insert for no read benefit, so they are deliberately skipped.
--    Only the two genuinely relational FKs get an index.

DROP INDEX IF EXISTS public.idx_certificates_cert_no;
DROP INDEX IF EXISTS public.idx_driver_bank_accounts_driver;
DROP INDEX IF EXISTS public.idx_driver_payroll_base_driver;
DROP INDEX IF EXISTS public.idx_fee_invoices_token;
DROP INDEX IF EXISTS public.idx_payroll_attendance_corrections_emp;
DROP INDEX IF EXISTS public.idx_staff_attendance_staff_date;
DROP INDEX IF EXISTS public.idx_staff_bank_accounts_staff;
DROP INDEX IF EXISTS public.idx_staff_details_staff;
DROP INDEX IF EXISTS public.idx_staff_salary_base_staff;
DROP INDEX IF EXISTS public.idx_student_details_student;
DROP INDEX IF EXISTS public.idx_support_staff_attendance_staff_date;
DROP INDEX IF EXISTS public.idx_support_staff_bank_accounts_staff;
DROP INDEX IF EXISTS public.idx_support_staff_salary_base_staff;
DROP INDEX IF EXISTS public.idx_transport_route_stops_route;
DROP INDEX IF EXISTS public.idx_transport_run_stops_run;

-- The two relational FKs: both are join targets, not actor columns.
CREATE INDEX IF NOT EXISTS idx_fee_concessions_moved_from_invoice
  ON public.fee_concessions (moved_from_invoice_id)
  WHERE moved_from_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fee_late_fee_charges_delta_of
  ON public.fee_late_fee_charges (delta_of)
  WHERE delta_of IS NOT NULL;
