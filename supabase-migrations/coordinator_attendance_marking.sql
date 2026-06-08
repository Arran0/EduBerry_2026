-- ============================================================
-- Migration: Manager attendance marking
--   * Principal / admin can INSERT attendance for any staff
--     (the base schema only allowed them to UPDATE existing rows,
--      so marking a staff member with no record yet failed).
--   * Coordinators can INSERT/UPDATE attendance for staff who
--     share a team with them (team roster + calendar editing).
-- Run this in the Supabase SQL Editor.
-- (Safe to run after upgrade_staff_attendance.sql.)
-- ============================================================

-- ── Principal / admin: insert attendance for anyone ──────────
DROP POLICY IF EXISTS "Principal and admin can insert staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Principal and admin can insert staff attendance"
  ON public.staff_attendance_records FOR INSERT
  WITH CHECK (public.get_user_role() IN ('principal', 'admin'));

-- ── Coordinators: insert attendance for team members ─────────
DROP POLICY IF EXISTS "Coordinators can insert team staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Coordinators can insert team staff attendance"
  ON public.staff_attendance_records FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'coordinator'
    AND EXISTS (
      SELECT 1
      FROM public.team_members tm_self
      JOIN public.team_members tm_target ON tm_self.team_id = tm_target.team_id
      WHERE tm_self.user_id = auth.uid()
        AND tm_target.user_id = staff_attendance_records.staff_id
    )
  );

-- ── Coordinators: update attendance for team members ─────────
DROP POLICY IF EXISTS "Coordinators can update team staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Coordinators can update team staff attendance"
  ON public.staff_attendance_records FOR UPDATE
  USING (
    public.get_user_role() = 'coordinator'
    AND EXISTS (
      SELECT 1
      FROM public.team_members tm_self
      JOIN public.team_members tm_target ON tm_self.team_id = tm_target.team_id
      WHERE tm_self.user_id = auth.uid()
        AND tm_target.user_id = staff_attendance_records.staff_id
    )
  );

NOTIFY pgrst, 'reload schema';
