-- ============================================================
-- Migration: Immediate results & auto-close
--
-- 1. exams.immediate_results — when TRUE, a submission on a fully
--    auto-graded exam is scored and finalised the moment the student
--    hands it in, and that student can review their result straight
--    away (per-student; other students still see a live exam).
-- 2. exams.auto_close_at — preset date/time at which an
--    immediate-results exam publishes results exam-wide and moves to
--    the Closed section. Manually graded exams close when the teacher
--    publishes results; there is no manual Close action any more.
-- 3. student_can_review_exam() — a student may read questions with
--    their correct_answer once results are published for the exam OR
--    (immediate-results exams) once their own submission is graded.
--    The exam_questions SELECT policy now uses it.
--
-- Idempotent — safe to run multiple times.
-- Run AFTER add_exam_app.sql and add_exam_modes_and_access.sql.
-- ============================================================

BEGIN;

-- ── 1 & 2. new exam columns ──────────────────────────────────
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS immediate_results BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS auto_close_at TIMESTAMPTZ;

-- ── 3. student review access ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.student_can_review_exam(p_exam_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exams e
    WHERE e.id = p_exam_id
      AND (
        e.results_published = TRUE
        OR (
          e.immediate_results = TRUE
          AND EXISTS (
            SELECT 1 FROM public.exam_submissions s
            WHERE s.exam_id = e.id
              AND s.student_id = auth.uid()
              AND s.status = 'graded'
          )
        )
      )
  );
$$;
GRANT EXECUTE ON FUNCTION public.student_can_review_exam(UUID) TO authenticated;

-- Students may read questions (incl. correct_answer) only once they are
-- allowed to review. Before that they use get_exam_questions_for_student().
DROP POLICY IF EXISTS "exam_questions_select" ON public.exam_questions;
CREATE POLICY "exam_questions_select"
  ON public.exam_questions FOR SELECT
  USING (
    public.can_manage_exam(exam_id)
    OR (
      public.is_exam_student(exam_id)
      AND public.student_can_review_exam(exam_id)
    )
  );

COMMIT;
