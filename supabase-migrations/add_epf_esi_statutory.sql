-- ============================================================================
-- add_epf_esi_statutory  —  per-person statutory identifiers needed to file
-- the monthly EPF (ECR) and ESI (Monthly Contribution) returns.
-- ============================================================================
-- Run this in the Supabase SQL Editor. Safe to re-run.
--
-- The pay cycle already knows what PF/ESI was deducted (see
-- add_payroll_calibration.sql). What it cannot know is *who* each person is to
-- the EPFO and the ESIC — those portals key every row on an identifier issued
-- by them, not by the school:
--
--   uan            The 12-digit Universal Account Number. Column 1 of every
--                  ECR line; a member without one cannot be filed for.
--   esi_ip_number  The 10-digit Insured Person number. Column 1 of the ESIC
--                  Monthly Contribution template.
--   eps_applicable Whether the member is in the Employees' Pension Scheme.
--                  Members excluded from EPS (typically those who first joined
--                  EPF on wages above the pension ceiling) get zero EPS wages,
--                  and the employer's whole 12% goes to EPF instead of being
--                  split 8.33% / 3.67% — so filing them as pensionable would
--                  put the money under the wrong account head.
--
-- These live on the base-salary config tables rather than staff_details
-- because that is what the payroll math already reads, and because drivers
-- need the same fields from their own table.

ALTER TABLE public.staff_salary_base
  ADD COLUMN IF NOT EXISTS uan            TEXT,
  ADD COLUMN IF NOT EXISTS esi_ip_number  TEXT,
  ADD COLUMN IF NOT EXISTS eps_applicable BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.driver_payroll_base
  ADD COLUMN IF NOT EXISTS uan            TEXT,
  ADD COLUMN IF NOT EXISTS esi_ip_number  TEXT,
  ADD COLUMN IF NOT EXISTS eps_applicable BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.staff_salary_base.uan            IS 'EPFO Universal Account Number (12 digits) — column 1 of the ECR';
COMMENT ON COLUMN public.staff_salary_base.esi_ip_number  IS 'ESIC Insured Person number (10 digits) — column 1 of the MC template';
COMMENT ON COLUMN public.staff_salary_base.eps_applicable IS 'Member is in the Employees Pension Scheme (8.33% of the employer share goes to EPS)';

COMMENT ON COLUMN public.driver_payroll_base.uan            IS 'EPFO Universal Account Number (12 digits) — column 1 of the ECR';
COMMENT ON COLUMN public.driver_payroll_base.esi_ip_number  IS 'ESIC Insured Person number (10 digits) — column 1 of the MC template';
COMMENT ON COLUMN public.driver_payroll_base.eps_applicable IS 'Member is in the Employees Pension Scheme (8.33% of the employer share goes to EPS)';

NOTIFY pgrst, 'reload schema';
