-- ============================================================
-- Fix: ensure all Exam app RLS policies exist
--
-- Symptom this fixes:
--   "new row violates row-level security policy for table exams"
--   when creating an exam, because an earlier run of add_exam_app.sql
--   aborted partway (Supabase's SQL editor commits each statement), so
--   the exam tables ended up RLS-enabled but WITHOUT their policies.
--
-- This script only (re)creates the helper functions and policies — it
-- does NOT create tables or triggers, so it cannot abort on a missing
-- trigger function or a referenced table. Safe to run multiple times.
-- Requires: the exam_* tables, plus profiles and homeroom_members.
-- ============================================================

-- Role helper (also defined by the base schema; recreate to be safe).
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- ── Exam helper functions ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_exam_owner(p_exam_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.exams e WHERE e.id = p_exam_id AND e.created_by = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.can_manage_exam(p_exam_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.exams e WHERE e.id = p_exam_id AND e.created_by = auth.uid())
      OR EXISTS (SELECT 1 FROM public.exam_graders g WHERE g.exam_id = p_exam_id AND g.teacher_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_exam_student(p_exam_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exam_audiences a
    WHERE a.exam_id = p_exam_id
      AND (
        a.user_id = auth.uid()
        OR a.homeroom_id IN (SELECT hm.homeroom_id FROM public.homeroom_members hm WHERE hm.student_id = auth.uid())
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.submission_exam_id(p_submission_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT exam_id FROM public.exam_submissions WHERE id = p_submission_id;
$$;

CREATE OR REPLACE FUNCTION public.owns_submission(p_submission_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.exam_submissions s WHERE s.id = p_submission_id AND s.student_id = auth.uid());
$$;

-- Pin exams.created_by to the authenticated user on insert, so a client-sent
-- value can never mismatch auth.uid() and fail the RLS check.
--
-- IMPORTANT: only override when there IS an authenticated user (auth.uid()
-- IS NOT NULL). Exams are created by the /api/exam/create route using the
-- SERVICE ROLE, which has no JWT, so auth.uid() is NULL there. The route has
-- already verified the caller's token and staff role and sets created_by to
-- that user's id; if this trigger unconditionally set created_by := auth.uid()
-- it would clobber that to NULL, orphaning the exam (no one passes
-- can_manage_exam, so the creator cannot read it back or add questions).
CREATE OR REPLACE FUNCTION public.exam_set_created_by()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS exams_set_created_by ON public.exams;
CREATE TRIGGER exams_set_created_by
  BEFORE INSERT ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.exam_set_created_by();

-- ── Make sure RLS is enabled (no-op if already on) ───────────
ALTER TABLE public.exams              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_questions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_audiences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_graders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_submissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_answers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_result_links  ENABLE ROW LEVEL SECURITY;

-- ── exams ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "exams_select" ON public.exams;
CREATE POLICY "exams_select" ON public.exams FOR SELECT
  USING (public.can_manage_exam(id) OR public.is_exam_student(id));

DROP POLICY IF EXISTS "exams_insert" ON public.exams;
CREATE POLICY "exams_insert" ON public.exams FOR INSERT
  WITH CHECK (
    (
      public.get_user_role() IN ('teacher','coordinator','principal','admin')
      OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher','coordinator','principal','admin')
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "exams_update" ON public.exams;
CREATE POLICY "exams_update" ON public.exams FOR UPDATE USING (public.can_manage_exam(id));

DROP POLICY IF EXISTS "exams_delete" ON public.exams;
CREATE POLICY "exams_delete" ON public.exams FOR DELETE USING (public.is_exam_owner(id));

-- ── exam_questions ───────────────────────────────────────────
-- NOTE: this recreates the pre-immediate-results policy. If your database
-- has already run add_exam_immediate_results.sql, re-run that migration
-- after this script so students keep their instant-result review access.
DROP POLICY IF EXISTS "exam_questions_select" ON public.exam_questions;
CREATE POLICY "exam_questions_select" ON public.exam_questions FOR SELECT
  USING (
    public.can_manage_exam(exam_id)
    OR (public.is_exam_student(exam_id)
        AND EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.results_published = TRUE))
  );
DROP POLICY IF EXISTS "exam_questions_insert" ON public.exam_questions;
CREATE POLICY "exam_questions_insert" ON public.exam_questions FOR INSERT WITH CHECK (public.can_manage_exam(exam_id));
DROP POLICY IF EXISTS "exam_questions_update" ON public.exam_questions;
CREATE POLICY "exam_questions_update" ON public.exam_questions FOR UPDATE USING (public.can_manage_exam(exam_id));
DROP POLICY IF EXISTS "exam_questions_delete" ON public.exam_questions;
CREATE POLICY "exam_questions_delete" ON public.exam_questions FOR DELETE USING (public.can_manage_exam(exam_id));

-- ── exam_audiences ───────────────────────────────────────────
DROP POLICY IF EXISTS "exam_audiences_select" ON public.exam_audiences;
CREATE POLICY "exam_audiences_select" ON public.exam_audiences FOR SELECT
  USING (public.can_manage_exam(exam_id) OR public.is_exam_student(exam_id));
DROP POLICY IF EXISTS "exam_audiences_insert" ON public.exam_audiences;
CREATE POLICY "exam_audiences_insert" ON public.exam_audiences FOR INSERT WITH CHECK (public.can_manage_exam(exam_id));
DROP POLICY IF EXISTS "exam_audiences_delete" ON public.exam_audiences;
CREATE POLICY "exam_audiences_delete" ON public.exam_audiences FOR DELETE USING (public.can_manage_exam(exam_id));

-- ── exam_graders ─────────────────────────────────────────────
DROP POLICY IF EXISTS "exam_graders_select" ON public.exam_graders;
CREATE POLICY "exam_graders_select" ON public.exam_graders FOR SELECT
  USING (public.can_manage_exam(exam_id) OR teacher_id = auth.uid());
DROP POLICY IF EXISTS "exam_graders_insert" ON public.exam_graders;
CREATE POLICY "exam_graders_insert" ON public.exam_graders FOR INSERT WITH CHECK (public.is_exam_owner(exam_id));
DROP POLICY IF EXISTS "exam_graders_delete" ON public.exam_graders;
CREATE POLICY "exam_graders_delete" ON public.exam_graders FOR DELETE USING (public.is_exam_owner(exam_id));

-- ── exam_submissions ─────────────────────────────────────────
DROP POLICY IF EXISTS "exam_submissions_select" ON public.exam_submissions;
CREATE POLICY "exam_submissions_select" ON public.exam_submissions FOR SELECT
  USING (public.can_manage_exam(exam_id) OR student_id = auth.uid());
DROP POLICY IF EXISTS "exam_submissions_insert" ON public.exam_submissions;
CREATE POLICY "exam_submissions_insert" ON public.exam_submissions FOR INSERT
  WITH CHECK ((student_id = auth.uid() AND public.is_exam_student(exam_id)) OR public.can_manage_exam(exam_id));
DROP POLICY IF EXISTS "exam_submissions_update" ON public.exam_submissions;
CREATE POLICY "exam_submissions_update" ON public.exam_submissions FOR UPDATE
  USING (public.can_manage_exam(exam_id) OR student_id = auth.uid());
DROP POLICY IF EXISTS "exam_submissions_delete" ON public.exam_submissions;
CREATE POLICY "exam_submissions_delete" ON public.exam_submissions FOR DELETE USING (public.can_manage_exam(exam_id));

-- ── exam_answers ─────────────────────────────────────────────
DROP POLICY IF EXISTS "exam_answers_select" ON public.exam_answers;
CREATE POLICY "exam_answers_select" ON public.exam_answers FOR SELECT
  USING (public.owns_submission(submission_id) OR public.can_manage_exam(public.submission_exam_id(submission_id)));
DROP POLICY IF EXISTS "exam_answers_insert" ON public.exam_answers;
CREATE POLICY "exam_answers_insert" ON public.exam_answers FOR INSERT
  WITH CHECK (public.owns_submission(submission_id) OR public.can_manage_exam(public.submission_exam_id(submission_id)));
DROP POLICY IF EXISTS "exam_answers_update" ON public.exam_answers;
CREATE POLICY "exam_answers_update" ON public.exam_answers FOR UPDATE
  USING (public.owns_submission(submission_id) OR public.can_manage_exam(public.submission_exam_id(submission_id)));
DROP POLICY IF EXISTS "exam_answers_delete" ON public.exam_answers;
CREATE POLICY "exam_answers_delete" ON public.exam_answers FOR DELETE
  USING (public.can_manage_exam(public.submission_exam_id(submission_id)));

-- ── exam_templates ───────────────────────────────────────────
DROP POLICY IF EXISTS "exam_templates_select" ON public.exam_templates;
CREATE POLICY "exam_templates_select" ON public.exam_templates FOR SELECT
  USING (public.get_user_role() IN ('teacher','coordinator','principal','admin'));
DROP POLICY IF EXISTS "exam_templates_insert" ON public.exam_templates;
CREATE POLICY "exam_templates_insert" ON public.exam_templates FOR INSERT
  WITH CHECK (
    (
      public.get_user_role() IN ('teacher','coordinator','principal','admin')
      OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher','coordinator','principal','admin')
    )
    AND created_by = auth.uid()
  );
DROP POLICY IF EXISTS "exam_templates_update" ON public.exam_templates;
CREATE POLICY "exam_templates_update" ON public.exam_templates FOR UPDATE USING (created_by = auth.uid());
DROP POLICY IF EXISTS "exam_templates_delete" ON public.exam_templates;
CREATE POLICY "exam_templates_delete" ON public.exam_templates FOR DELETE USING (created_by = auth.uid());

-- ── exam_result_links ────────────────────────────────────────
DROP POLICY IF EXISTS "exam_result_links_select" ON public.exam_result_links;
CREATE POLICY "exam_result_links_select" ON public.exam_result_links FOR SELECT USING (public.can_manage_exam(exam_id));
DROP POLICY IF EXISTS "exam_result_links_insert" ON public.exam_result_links;
CREATE POLICY "exam_result_links_insert" ON public.exam_result_links FOR INSERT WITH CHECK (public.can_manage_exam(exam_id));
DROP POLICY IF EXISTS "exam_result_links_delete" ON public.exam_result_links;
CREATE POLICY "exam_result_links_delete" ON public.exam_result_links FOR DELETE USING (public.can_manage_exam(exam_id));

-- ── student-safe questions RPC ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_exam_questions_for_student(p_exam_id UUID)
RETURNS TABLE (
  id UUID, exam_id UUID, "position" INTEGER, type TEXT, prompt TEXT,
  marks NUMERIC, options JSONB, multiple_select BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT q.id, q.exam_id, q.position, q.type, q.prompt, q.marks, q.options, q.multiple_select
  FROM public.exam_questions q
  WHERE q.exam_id = p_exam_id
    AND (public.is_exam_student(p_exam_id) OR public.can_manage_exam(p_exam_id))
  ORDER BY q.position ASC;
$$;
GRANT EXECUTE ON FUNCTION public.get_exam_questions_for_student(UUID) TO authenticated;
