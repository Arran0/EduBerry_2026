-- ============================================================
-- Migration: Teachers can view team staff attendance
--   * Teachers use the same "Team Attendance Report" UI as
--     coordinators (see fetchTeamMembers(userId, 'teacher') in
--     src/lib/tasks.ts), but there was no SELECT policy granting
--     them visibility into teammates' attendance records — only
--     coordinators had one (upgrade_staff_attendance.sql).
--   * Without this, every teammate's record is silently stripped
--     by RLS and the UI falls back to showing them as "Absent",
--     while the viewing teacher's own row (visible via the
--     "Staff can view own attendance" policy) shows correctly.
-- Run this in the Supabase SQL Editor.
-- (Safe to run after upgrade_staff_attendance.sql.)
-- ============================================================

DROP POLICY IF EXISTS "Teachers can view team staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Teachers can view team staff attendance"
  ON public.staff_attendance_records FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1
      FROM public.team_members tm_self
      JOIN public.team_members tm_target ON tm_self.team_id = tm_target.team_id
      WHERE tm_self.user_id = auth.uid()
        AND tm_target.user_id = staff_attendance_records.staff_id
    )
  );

NOTIFY pgrst, 'reload schema';
