-- ============================================================
-- Migration: Allow smartboard users to manage classroom folders & files
--
-- The existing "Staff can manage folders/files" policies only check the
-- user's JWT role (teacher/coordinator/principal/admin).  Smartboard users
-- have role = 'smartboard' so they were blocked even when they are a
-- member of the classroom.  This migration extends both policies so that a
-- smartboard user who is a classroom member can create, update, and delete
-- folders and files in that classroom.
-- ============================================================

-- classroom_folders: add smartboard member access
DROP POLICY IF EXISTS "Staff can manage folders" ON public.classroom_folders;
CREATE POLICY "Staff can manage folders"
  ON public.classroom_folders FOR ALL
  TO authenticated USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
    OR (
      (auth.jwt() -> 'user_metadata' ->> 'role') = 'smartboard'
      AND public.user_is_classroom_member(classroom_folders.classroom_id)
    )
  );

-- classroom_files: add smartboard member access
DROP POLICY IF EXISTS "Staff can manage files" ON public.classroom_files;
CREATE POLICY "Staff can manage files"
  ON public.classroom_files FOR ALL
  TO authenticated USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
    OR (
      (auth.jwt() -> 'user_metadata' ->> 'role') = 'smartboard'
      AND EXISTS (
        SELECT 1 FROM public.classroom_folders cf
        WHERE cf.id = classroom_files.folder_id
          AND public.user_is_classroom_member(cf.classroom_id)
      )
    )
  );

NOTIFY pgrst, 'reload schema';
