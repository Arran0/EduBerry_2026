-- ============================================================
-- Migration: Smart board can read its homeroom's announcements
--
-- The smart board dashboard shows the latest announcements meant for its
-- homeroom (matching grade/section) plus school-wide all_students notices.
-- The existing student RLS keys off a 'student' JWT role, so a board (role
-- 'smartboard') was excluded. This policy grants a board SELECT on the
-- student/both announcements that target its homeroom — using homeroom
-- ownership (smartboard_id = auth.uid()), so it needs no role assumption.
--
-- Run in the Supabase SQL Editor (after announcements-migration.sql).
-- ============================================================

DROP POLICY IF EXISTS "smartboard_view_student_announcements" ON public.announcements;
CREATE POLICY "smartboard_view_student_announcements"
  ON public.announcements FOR SELECT
  USING (
    type IN ('student', 'both')
    AND EXISTS (
      SELECT 1 FROM public.announcement_audiences aa
      WHERE aa.announcement_id = announcements.id
      AND (
        (aa.all_students = true AND EXISTS (
          SELECT 1 FROM public.homerooms h WHERE h.smartboard_id = auth.uid()
        ))
        OR EXISTS (
          SELECT 1 FROM public.homerooms h
          WHERE h.smartboard_id = auth.uid()
            AND aa.grade = h.grade
            AND (aa.section IS NULL OR aa.section = h.section)
        )
      )
    )
  );

NOTIFY pgrst, 'reload schema';
