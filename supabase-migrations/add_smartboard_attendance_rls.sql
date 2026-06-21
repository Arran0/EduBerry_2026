-- ============================================================
-- Migration: Smart Board read/mark access (Phase 2, Round 5)
--
-- A smart board is not a staff role, so the staff-scoped RLS doesn't
-- cover it. These policies give a homeroom's board exactly the access
-- it needs for its dashboard: read its homeroom, its members and their
-- profiles, and read/mark that homeroom's attendance.
--
-- Classrooms, classroom_members, folders, files, and the top-3 RPC are
-- already membership-based (the board is a classroom member) or run as
-- SECURITY DEFINER, so they need no extra policy.
--
-- Run AFTER add_smartboard_tasks.sql (uses is_homeroom_smartboard()).
-- ============================================================

-- Helper: is the caller the smart board of a homeroom that contains this student?
CREATE OR REPLACE FUNCTION public.is_smartboard_of_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM homeroom_members hm
    JOIN homerooms h ON h.id = hm.homeroom_id
    WHERE hm.student_id = p_student_id AND h.smartboard_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_smartboard_of_student(UUID) TO authenticated;

-- ── homerooms: a board can read its own homeroom ─────────────
DROP POLICY IF EXISTS "Smart board can view own homeroom" ON public.homerooms;
CREATE POLICY "Smart board can view own homeroom"
  ON public.homerooms FOR SELECT
  USING (smartboard_id = auth.uid());

-- ── homeroom_members: a board can read its homeroom's roster ─
DROP POLICY IF EXISTS "Smart board can view homeroom members" ON public.homeroom_members;
CREATE POLICY "Smart board can view homeroom members"
  ON public.homeroom_members FOR SELECT
  USING (public.is_homeroom_smartboard(homeroom_id));

-- ── profiles: a board can read its homeroom students' profiles ─
DROP POLICY IF EXISTS "Smart board can view homeroom student profiles" ON public.profiles;
CREATE POLICY "Smart board can view homeroom student profiles"
  ON public.profiles FOR SELECT
  USING (public.is_smartboard_of_student(id));

-- ── attendance_records: a board can read + mark its homeroom ──
DROP POLICY IF EXISTS "Smart board can view homeroom attendance" ON public.attendance_records;
CREATE POLICY "Smart board can view homeroom attendance"
  ON public.attendance_records FOR SELECT
  USING (public.is_homeroom_smartboard(homeroom_id));

DROP POLICY IF EXISTS "Smart board can insert homeroom attendance" ON public.attendance_records;
CREATE POLICY "Smart board can insert homeroom attendance"
  ON public.attendance_records FOR INSERT
  WITH CHECK (public.is_homeroom_smartboard(homeroom_id));

DROP POLICY IF EXISTS "Smart board can update homeroom attendance" ON public.attendance_records;
CREATE POLICY "Smart board can update homeroom attendance"
  ON public.attendance_records FOR UPDATE
  USING (public.is_homeroom_smartboard(homeroom_id));

-- ── homerooms: a board can update its own banner ─────────────
DROP POLICY IF EXISTS "Smart board can update own homeroom banner" ON public.homerooms;
CREATE POLICY "Smart board can update own homeroom banner"
  ON public.homerooms FOR UPDATE
  USING (smartboard_id = auth.uid());

NOTIFY pgrst, 'reload schema';
