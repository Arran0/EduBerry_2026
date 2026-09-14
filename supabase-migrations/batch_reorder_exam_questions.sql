-- Reorder an exam's questions in one statement instead of one UPDATE per
-- question (a 40-question paper was 40 round trips on every drag-and-drop
-- save). SECURITY INVOKER so the exam_questions_update policy
-- (can_manage_exam) still decides who may reorder — a student calling this
-- updates zero rows.
CREATE OR REPLACE FUNCTION public.reorder_exam_questions(p_exam_id uuid, p_ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH updated AS (
    UPDATE public.exam_questions q
       SET position = t.idx - 1
      FROM unnest(p_ids) WITH ORDINALITY AS t(id, idx)
     WHERE q.id = t.id
       AND q.exam_id = p_exam_id
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated;
$$;

REVOKE ALL ON FUNCTION public.reorder_exam_questions(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_exam_questions(uuid, uuid[]) TO authenticated;
