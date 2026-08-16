-- ============================================================
-- Migration: Multi-team staff attendance visibility
--   * The staff attendance surfaces now aggregate every team a
--     teacher or coordinator belongs to — the ones they are a
--     member of (team_members) AND the ones they coordinate
--     (teams.coordinator_id) — see fetchMyTeamRosters() in
--     src/lib/teams.ts.
--   * The existing coordinator policies only matched teammates
--     through team_members, so a coordinator who owns a team
--     without being listed as one of its members had every
--     member's record silently stripped by RLS (they then showed
--     up as "Absent"/"Not marked" in the report).
--   * These policies replace the team_members-only check with a
--     union of both routes. Teams created through the app add the
--     coordinator as a member, so for most teams this is a no-op.
-- Run this in the Supabase SQL Editor.
-- (Safe to run after upgrade_staff_attendance.sql and
--  coordinator_attendance_marking.sql.)
-- ============================================================

-- Staff who share at least one team with `viewer`, counting both
-- team membership and team coordination on either side.
CREATE OR REPLACE FUNCTION public.shares_team_with(viewer UUID, target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH viewer_teams AS (
    SELECT team_id FROM public.team_members WHERE user_id = viewer
    UNION
    SELECT id AS team_id FROM public.teams WHERE coordinator_id = viewer
  ),
  target_teams AS (
    SELECT team_id FROM public.team_members WHERE user_id = target
    UNION
    SELECT id AS team_id FROM public.teams WHERE coordinator_id = target
  )
  SELECT EXISTS (
    SELECT 1 FROM viewer_teams v JOIN target_teams t ON v.team_id = t.team_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.shares_team_with(UUID, UUID) TO anon, authenticated;

-- ── Coordinators: view attendance across every team they're on ──
DROP POLICY IF EXISTS "Coordinators can view team staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Coordinators can view team staff attendance"
  ON public.staff_attendance_records FOR SELECT
  USING (
    public.get_user_role() = 'coordinator'
    AND public.shares_team_with(auth.uid(), staff_attendance_records.staff_id)
  );

-- ── Coordinators: insert attendance for those same staff ────────
DROP POLICY IF EXISTS "Coordinators can insert team staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Coordinators can insert team staff attendance"
  ON public.staff_attendance_records FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'coordinator'
    AND public.shares_team_with(auth.uid(), staff_attendance_records.staff_id)
  );

-- ── Coordinators: update attendance for those same staff ────────
DROP POLICY IF EXISTS "Coordinators can update team staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Coordinators can update team staff attendance"
  ON public.staff_attendance_records FOR UPDATE
  USING (
    public.get_user_role() = 'coordinator'
    AND public.shares_team_with(auth.uid(), staff_attendance_records.staff_id)
  );

-- ── Teachers: view attendance across every team they're on ──────
-- (fix_teacher_team_attendance_rls.sql, widened the same way.)
DROP POLICY IF EXISTS "Teachers can view team staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Teachers can view team staff attendance"
  ON public.staff_attendance_records FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND public.shares_team_with(auth.uid(), staff_attendance_records.staff_id)
  );

NOTIFY pgrst, 'reload schema';
