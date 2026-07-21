-- ============================================
-- Assessment Max Marks & Absent Marking
-- ============================================
-- Adds:
--   1. max_marks column on classroom_assessments — a single, assessment-wide
--      maximum mark that applies uniformly to every student (no more
--      per-student overrides from the marksheet UI).
--   2. is_absent column on classroom_assessment_marks — lets staff mark a
--      student Absent (AB) for an assessment, distinct from "not yet graded".
--   3. A guard so marks can never be negative or exceed the assessment's max.

-- 1. Assessment-level max marks -----------------------------------------------
ALTER TABLE public.classroom_assessments
  ADD COLUMN IF NOT EXISTS max_marks NUMERIC NOT NULL DEFAULT 100;

-- 2. Absent flag on marks ------------------------------------------------------
ALTER TABLE public.classroom_assessment_marks
  ADD COLUMN IF NOT EXISTS is_absent BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Marks must be non-negative (upper bound vs. max_marks is enforced by the
--    application, since max_marks lives on a different table). -------------
ALTER TABLE public.classroom_assessment_marks
  DROP CONSTRAINT IF EXISTS classroom_assessment_marks_marks_non_negative;
ALTER TABLE public.classroom_assessment_marks
  ADD CONSTRAINT classroom_assessment_marks_marks_non_negative
  CHECK (marks IS NULL OR marks >= 0);
