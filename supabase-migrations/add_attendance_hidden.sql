-- ============================================================
-- Migration: Per-staff attendance visibility toggle
--   Admins are no longer blanket-excluded from staff attendance
--   lists/counts. Instead, any individual staff member (any role,
--   including admin) can be hidden from attendance tracking via
--   this flag, managed from Settings → Attendance → Attendance
--   Visibility (mirrors the existing geofence_exempt toggle).
-- Run this in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS attendance_hidden BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
