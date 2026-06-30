-- Add 'e' (exception / permission-break) status to the attendance enum.
ALTER TYPE staff_attendance_status ADD VALUE IF NOT EXISTS 'e';

-- Add second check-in and second check-out columns so a teacher who leaves on
-- a 1-hour permission and returns can record the full journey without losing
-- the original check-in time.
ALTER TABLE public.staff_attendance_records
  ADD COLUMN IF NOT EXISTS check_in_time_2     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_in_lat_2      DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS check_in_lng_2      DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS check_in_accuracy_2 REAL,
  ADD COLUMN IF NOT EXISTS check_out_time_2    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_out_lat_2     DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS check_out_lng_2     DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS check_out_accuracy_2 REAL;
