-- ============================================================
-- Migration: Classroom homework on smartboard_tasks
--
-- The classroom Homework tab is rebuilt on top of smartboard_tasks: a
-- classroom teacher (or the smart board) creates a homework task linked to a
-- classroom; it streams in the Homework tab AND reflects onto the calendars of
-- every student in that classroom. Smart-board tasks already carry classroom_id,
-- so a board task linked to a classroom shows in that classroom's Homework tab.
--
-- Changes:
--   • homeroom_id becomes nullable (a pure classroom task has no homeroom)
--   • helpers to test classroom membership / classroom-staff membership
--   • RLS widened so classroom members can read, and classroom staff (incl. the
--     board, which joins classrooms as a 'teacher' member) can write
--
-- Run in the Supabase SQL Editor (after add_smartboard_task_verification.sql).
-- ============================================================

-- A classroom-only homework task has no homeroom.
ALTER TABLE public.smartboard_tasks ALTER COLUMN homeroom_id DROP NOT NULL;

-- ── Helper: is the caller a member of this classroom? ──
CREATE OR REPLACE FUNCTION public.is_classroom_member(p_classroom_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM classroom_members
    WHERE classroom_id = p_classroom_id AND user_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_classroom_member(UUID) TO authenticated;

-- ── Helper: is the caller a teacher-level member of this classroom? ──
-- The smart board joins its classrooms with role = 'teacher', so this also
-- grants boards write access to their classrooms' homework.
CREATE OR REPLACE FUNCTION public.is_classroom_staff(p_classroom_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM classroom_members
    WHERE classroom_id = p_classroom_id
      AND user_id = auth.uid()
      AND role IN ('teacher', 'coordinator', 'principal', 'admin')
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_classroom_staff(UUID) TO authenticated;

-- ── RLS: smartboard_tasks — add classroom-based access ───────
DROP POLICY IF EXISTS smartboard_tasks_select ON public.smartboard_tasks;
CREATE POLICY smartboard_tasks_select ON public.smartboard_tasks
  FOR SELECT USING (
    public.is_homeroom_smartboard(homeroom_id)
    OR public.is_homeroom_member(homeroom_id)
    OR public.is_classroom_member(classroom_id)
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS smartboard_tasks_insert ON public.smartboard_tasks;
CREATE POLICY smartboard_tasks_insert ON public.smartboard_tasks
  FOR INSERT WITH CHECK (
    public.is_homeroom_smartboard(homeroom_id)
    OR public.is_classroom_staff(classroom_id)
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS smartboard_tasks_update ON public.smartboard_tasks;
CREATE POLICY smartboard_tasks_update ON public.smartboard_tasks
  FOR UPDATE USING (
    public.is_homeroom_smartboard(homeroom_id)
    OR public.is_classroom_staff(classroom_id)
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS smartboard_tasks_delete ON public.smartboard_tasks;
CREATE POLICY smartboard_tasks_delete ON public.smartboard_tasks
  FOR DELETE USING (
    public.is_homeroom_smartboard(homeroom_id)
    OR public.is_classroom_staff(classroom_id)
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
  );

-- ── RLS: completions — let classroom staff verify classroom homework ──
DROP POLICY IF EXISTS sb_completions_select ON public.smartboard_task_completions;
CREATE POLICY sb_completions_select ON public.smartboard_task_completions
  FOR SELECT USING (
    student_id = auth.uid()
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
    OR EXISTS (
      SELECT 1 FROM smartboard_tasks t
      WHERE t.id = task_id
        AND (public.is_homeroom_smartboard(t.homeroom_id) OR public.is_classroom_staff(t.classroom_id))
    )
  );

DROP POLICY IF EXISTS sb_completions_insert ON public.smartboard_task_completions;
CREATE POLICY sb_completions_insert ON public.smartboard_task_completions
  FOR INSERT WITH CHECK (
    student_id = auth.uid()
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
    OR EXISTS (
      SELECT 1 FROM smartboard_tasks t
      WHERE t.id = task_id
        AND (public.is_homeroom_smartboard(t.homeroom_id) OR public.is_classroom_staff(t.classroom_id))
    )
  );

DROP POLICY IF EXISTS sb_completions_update ON public.smartboard_task_completions;
CREATE POLICY sb_completions_update ON public.smartboard_task_completions
  FOR UPDATE USING (
    student_id = auth.uid()
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
    OR EXISTS (
      SELECT 1 FROM smartboard_tasks t
      WHERE t.id = task_id
        AND (public.is_homeroom_smartboard(t.homeroom_id) OR public.is_classroom_staff(t.classroom_id))
    )
  );

NOTIFY pgrst, 'reload schema';
