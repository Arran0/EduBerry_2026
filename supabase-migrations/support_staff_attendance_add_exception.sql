-- ============================================================
-- Migration: Add 'e' (Exception) to support_staff_attendance.status
--
-- The support + driver attendance report now offers the same five manual
-- marks as the main staff report — Present / Absent / Late / Half Day /
-- Exception — in place of the previous On Leave button. 'on_leave' is left
-- in the constraint so existing rows keep validating.
-- Run this in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.support_staff_attendance DROP CONSTRAINT IF EXISTS support_staff_attendance_status_check;

ALTER TABLE public.support_staff_attendance
  ADD CONSTRAINT support_staff_attendance_status_check
  CHECK (status IN ('present', 'absent', 'late', 'half_day', 'on_leave', 'e'));

NOTIFY pgrst, 'reload schema';
