-- ============================================================================
-- add_salary_record_pay_by_cash  —  per-record "paid in cash" flag.
-- ============================================================================
-- Run this after add_support_staff_salary.sql. Safe to re-run.
--
-- Not everyone on a cycle is paid by bank transfer — some staff, drivers or
-- support staff are settled in cash instead. Ticking this on the pay-cycle
-- sheet takes that one person out of the bank disbursement file (CSV and
-- automated payout) for the month without touching their pay figures, status,
-- or anything else about the record.

ALTER TABLE public.salary_records
  ADD COLUMN IF NOT EXISTS pay_by_cash BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
