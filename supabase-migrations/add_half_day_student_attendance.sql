-- Add half_day to student attendance_status enum
ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'half_day';
NOTIFY pgrst, 'reload schema';
