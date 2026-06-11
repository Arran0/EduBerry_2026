-- ============================================================
-- Migration: Add On Duty (OD) leave type and attendance status
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- 1. Add 'on_duty' to the leave_type enum
ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'on_duty';

-- 2. Add 'on_duty' to the attendance_status enum for students
ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'on_duty';

-- 3. Allow any staff member to view student leave applications
--    (so staff can see OD/OL applications in student calendars)
DROP POLICY IF EXISTS "Staff can view student leave applications" ON public.leave_applications;
CREATE POLICY "Staff can view student leave applications"
  ON public.leave_applications FOR SELECT
  USING (
    public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = leave_applications.applicant_id
        AND profiles.role = 'student'
    )
  );

NOTIFY pgrst, 'reload schema';
