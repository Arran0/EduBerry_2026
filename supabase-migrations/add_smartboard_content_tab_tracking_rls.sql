-- ============================================================
-- Migration: Extend smartboard access to classroom_file_progress
--            and classroom_submissions for the Content tab.
--
-- Context: fix_smartboard_classroom_folder_permissions.sql already lets
-- the smartboard CREATE / UPDATE / DELETE folders and files. But the
-- Content tab also shows per-file student-progress bars and a tracking
-- modal. Those read from classroom_file_progress and
-- classroom_submissions, which were still restricted to staff only.
-- This migration adds smartboard read+write access (progress) and
-- read-only access (submissions) for files in classrooms they belong to.
-- ============================================================

-- ── classroom_file_progress ────────────────────────────────────────────

-- Extend the existing all-roles policy so smartboard can read and cycle
-- student progress for files in their classrooms.
DROP POLICY IF EXISTS "Students can manage own progress" ON public.classroom_file_progress;

CREATE POLICY "Students can manage own progress"
  ON public.classroom_file_progress FOR ALL
  TO authenticated USING (
    -- Student managing their own progress
    student_id = auth.uid()
    -- Staff (teacher / coordinator / principal / admin) have full access
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
    -- Smartboard: full access for files inside classrooms it belongs to
    OR (
      (auth.jwt() -> 'user_metadata' ->> 'role') = 'smartboard'
      AND EXISTS (
        SELECT 1
        FROM public.classroom_files cf
        JOIN public.classroom_folders fold ON fold.id = cf.folder_id
        WHERE cf.id = classroom_file_progress.file_id
          AND public.user_is_classroom_member(fold.classroom_id)
      )
    )
  );

-- ── classroom_submissions ──────────────────────────────────────────────

-- Students write their own submissions; staff/smartboard need read access
-- to view them in the tracking modal. Smartboard gets SELECT-only so it
-- cannot write or delete another student's submission.

-- Add a dedicated SELECT policy for smartboard (stacks with existing FOR ALL).
DROP POLICY IF EXISTS "Smartboard can view classroom submissions" ON public.classroom_submissions;

CREATE POLICY "Smartboard can view classroom submissions"
  ON public.classroom_submissions FOR SELECT
  TO authenticated USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'smartboard'
    AND EXISTS (
      SELECT 1
      FROM public.classroom_files cf
      JOIN public.classroom_folders fold ON fold.id = cf.folder_id
      WHERE cf.id = classroom_submissions.file_id
        AND public.user_is_classroom_member(fold.classroom_id)
    )
  );

NOTIFY pgrst, 'reload schema';
