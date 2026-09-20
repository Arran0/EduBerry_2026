-- ============================================================
-- Migration: Classrooms holding a homeroom's students
--
-- The class teacher's School Work Calendar maps homework onto the
-- classrooms its homeroom students attend. Working that set out from the
-- client is impossible under RLS: `classroom_members` is only selectable
-- for classrooms you are a member of, created, or coordinate (see
-- cleanup-and-fix-rls.sql), and `classrooms` is gated the same way. A
-- class teacher is neither for the classrooms their students attend with
-- other teachers, so the lookup came back empty and the calendar always
-- reported "no classroom holds a student from this homeroom".
--
-- This SECURITY DEFINER function does the join server-side, after
-- checking the caller actually owns the homeroom (or is senior staff).
--
-- Run in the Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_homeroom_classrooms(p_homeroom_id UUID)
RETURNS TABLE (
  id            UUID,
  title         TEXT,
  student_count INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the homeroom's own class teacher, or staff senior enough to see
  -- every classroom anyway, may enumerate this.
  IF NOT EXISTS (
        SELECT 1 FROM homerooms h
        WHERE h.id = p_homeroom_id AND h.class_teacher_id = auth.uid()
      )
     AND public.get_user_role() NOT IN ('coordinator', 'principal', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT c.id,
         c.title,
         COUNT(DISTINCT cm.user_id)::INTEGER AS student_count
  FROM homeroom_members hm
  JOIN classroom_members cm
    ON cm.user_id = hm.student_id
   AND cm.role = 'student'
  JOIN classrooms c
    ON c.id = cm.classroom_id
  WHERE hm.homeroom_id = p_homeroom_id
  GROUP BY c.id, c.title
  ORDER BY c.title;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_homeroom_classrooms(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
