-- ============================================================================
-- add_payroll_record_overrides  —  per-record manual overrides of the
-- automatically derived pay cycle columns.
-- ============================================================================
-- Run this in the Supabase SQL Editor, after add_payroll_calibration.sql.
-- Safe to re-run.
--
-- Working days, leave count, late count, PF and ESI are normally derived
-- (from the calendar, the attendance records, and the per-staff PF/ESI
-- config). The payroll office still needs the final say on any given row —
-- attendance gets corrected late, someone is on approved duty the system
-- doesn't know about, a PF figure is agreed by hand. These columns hold that
-- override.
--
-- NULL means "no override — use the derived value". A value means the office
-- typed it, and it wins. Because the override is stored separately from the
-- derived inputs, clearing it restores the automatic figure; nothing is lost.

ALTER TABLE public.salary_records
  ADD COLUMN IF NOT EXISTS working_days_override  INT,
  ADD COLUMN IF NOT EXISTS leave_override         NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS late_override          NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS pf_amount_override     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS esi_amount_override    NUMERIC(10,2);

ALTER TABLE public.driver_payroll_records
  ADD COLUMN IF NOT EXISTS working_days_override  INT,
  ADD COLUMN IF NOT EXISTS leave_override         NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS late_override          NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS pf_amount_override     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS esi_amount_override    NUMERIC(10,2);

NOTIFY pgrst, 'reload schema';
