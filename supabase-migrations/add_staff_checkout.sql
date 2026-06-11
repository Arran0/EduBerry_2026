-- Add checkout columns to staff_attendance_records
-- Allows tracking when staff leave campus and auto-marking half_day for early checkouts.

ALTER TABLE staff_attendance_records
  ADD COLUMN IF NOT EXISTS check_out_time  timestamptz,
  ADD COLUMN IF NOT EXISTS check_out_lat   double precision,
  ADD COLUMN IF NOT EXISTS check_out_lng   double precision,
  ADD COLUMN IF NOT EXISTS check_out_accuracy double precision;
