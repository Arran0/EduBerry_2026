-- ============================================================================
-- add_payroll_half_day_override — manual override for the derived half-day
-- count on a salary record, mirroring late_override
-- (add_payroll_record_overrides.sql). Needed because half-day is now a real,
-- configurable LOP category (with a grace-minutes excuse) instead of having
-- zero payroll impact.
--
-- Added to driver_payroll_records too, purely to keep the shared SalaryRecord
-- type whole (driver payroll code casts its rows into it) — the half-day/
-- grace feature itself is staff-only for now; driver rows always compute a
-- fixed halfDayCount of 0, so this column is unused there in practice.
-- ============================================================================
-- Run this in the Supabase SQL Editor, after add_payroll_record_overrides.sql.
-- Safe to re-run.

ALTER TABLE public.salary_records
  ADD COLUMN IF NOT EXISTS half_day_override NUMERIC(5,2);

ALTER TABLE public.driver_payroll_records
  ADD COLUMN IF NOT EXISTS half_day_override NUMERIC(5,2);

NOTIFY pgrst, 'reload schema';
