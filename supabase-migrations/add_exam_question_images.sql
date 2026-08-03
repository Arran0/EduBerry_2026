-- ============================================================
-- Migration: exam_questions.image_url
--
-- Lets teachers attach a figure (diagram, graph, map, …) to a question
-- alongside its text prompt. The file itself lives in the existing
-- public 'classroom-files' storage bucket; this column just stores its
-- public URL.
--
-- get_exam_questions_for_student() is redefined to also return image_url
-- so the figure renders while a student is taking the exam (the RPC
-- still omits correct_answer).
--
-- Idempotent — safe to run multiple times. Run AFTER add_exam_app.sql
-- and add_exam_modes_and_access.sql.
-- ============================================================

BEGIN;

ALTER TABLE public.exam_questions ADD COLUMN IF NOT EXISTS image_url TEXT;

-- The new image_url column changes the function's OUT-parameter row type,
-- which CREATE OR REPLACE cannot do in place — drop first.
DROP FUNCTION IF EXISTS public.get_exam_questions_for_student(UUID);

CREATE FUNCTION public.get_exam_questions_for_student(p_exam_id UUID)
RETURNS TABLE (
  id UUID,
  exam_id UUID,
  "position" INTEGER,
  type TEXT,
  prompt TEXT,
  marks NUMERIC,
  options JSONB,
  multiple_select BOOLEAN,
  image_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT q.id, q.exam_id, q.position, q.type, q.prompt, q.marks, q.options, q.multiple_select, q.image_url
  FROM public.exam_questions q
  WHERE q.exam_id = p_exam_id
    AND (public.is_exam_student(p_exam_id) OR public.can_manage_exam(p_exam_id))
  ORDER BY q.position ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_exam_questions_for_student(UUID) TO authenticated;

COMMIT;
