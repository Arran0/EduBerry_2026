-- ============================================================
-- Migration: Exam App
-- Creates the exam tables (exams, questions, audiences, graders,
-- submissions, answers, PYQ templates, result links) with RLS.
--
-- Grading: MCQ + True/False are auto-graded; objective & subjective
-- are graded manually. Negative marking ratio is stored per exam
-- (none=0, neet=0.25, jee=0.25, custom=teacher-set).
--
-- Idempotent — safe to run multiple times in the Supabase SQL Editor.
-- Relies on existing helpers public.get_user_role() and
-- update_task_updated_at() (see add_attendance.sql / schema).
--
-- Order matters: tables are created first, then the SECURITY DEFINER
-- helper functions (which reference those tables and are validated at
-- creation time), then the RLS policies (which reference the helpers),
-- then the student-safe RPC.
--
-- Wrapped in a transaction so a missing dependency aborts the WHOLE
-- migration cleanly instead of leaving tables RLS-enabled without their
-- policies (which would deny all access).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. TABLES
-- ============================================================

-- ── exams ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.exams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT,
  grade SMALLINT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  duration_minutes INTEGER,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  grading_method TEXT NOT NULL DEFAULT 'none'
    CHECK (grading_method IN ('none', 'neet', 'jee', 'custom')),
  negative_ratio NUMERIC NOT NULL DEFAULT 0,
  total_marks NUMERIC NOT NULL DEFAULT 0,
  is_pyq BOOLEAN NOT NULL DEFAULT FALSE,
  results_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_exams_created_by ON public.exams(created_by);

DROP TRIGGER IF EXISTS exams_updated_at ON public.exams;
CREATE TRIGGER exams_updated_at
  BEFORE UPDATE ON public.exams
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- Pin created_by to the authenticated user so the client can never set a
-- mismatched value (which would fail the INSERT RLS check).
-- Only override when there IS an authenticated user: the /api/exam/create
-- route inserts with the SERVICE ROLE (no JWT, auth.uid() IS NULL) after
-- verifying the caller, and sets created_by itself; unconditionally forcing
-- created_by := auth.uid() there would clobber it to NULL and orphan the exam.
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

-- ── exam_questions ───────────────────────────────────────────
-- options jsonb shape (mcq): [{ "id": "a", "text": "..." }, ...]
-- correct_answer jsonb shape:
--   mcq          -> ["a", "c"]   (option ids; one element unless multiple_select)
--   true_false   -> true | false
--   objective    -> "reference answer text" (manual-graded; reference only)
--   subjective   -> null

CREATE TABLE IF NOT EXISTS public.exam_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES public.exams(id) ON DELETE CASCADE NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL CHECK (type IN ('subjective', 'objective', 'mcq', 'true_false')),
  prompt TEXT NOT NULL,
  marks NUMERIC NOT NULL DEFAULT 1,
  options JSONB,
  correct_answer JSONB,
  multiple_select BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_exam_questions_exam_id ON public.exam_questions(exam_id);

-- ── exam_audiences ───────────────────────────────────────────
-- Each row targets EITHER a homeroom OR an individual student
-- (mirrors announcement_audiences).

CREATE TABLE IF NOT EXISTS public.exam_audiences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES public.exams(id) ON DELETE CASCADE NOT NULL,
  homeroom_id UUID REFERENCES public.homerooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.exam_audiences ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_exam_audiences_exam_id ON public.exam_audiences(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_audiences_homeroom_id ON public.exam_audiences(homeroom_id);
CREATE INDEX IF NOT EXISTS idx_exam_audiences_user_id ON public.exam_audiences(user_id);

-- ── exam_graders ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.exam_graders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES public.exams(id) ON DELETE CASCADE NOT NULL,
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(exam_id, teacher_id)
);

ALTER TABLE public.exam_graders ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_exam_graders_exam_id ON public.exam_graders(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_graders_teacher_id ON public.exam_graders(teacher_id);

-- ── exam_submissions ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.exam_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES public.exams(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'submitted', 'graded')),
  is_absent BOOLEAN NOT NULL DEFAULT FALSE,
  auto_score NUMERIC,
  manual_score NUMERIC,
  total_score NUMERIC,
  max_score NUMERIC,
  graded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  graded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(exam_id, student_id)
);

ALTER TABLE public.exam_submissions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_exam_submissions_exam_id ON public.exam_submissions(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_submissions_student_id ON public.exam_submissions(student_id);

DROP TRIGGER IF EXISTS exam_submissions_updated_at ON public.exam_submissions;
CREATE TRIGGER exam_submissions_updated_at
  BEFORE UPDATE ON public.exam_submissions
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── exam_answers ─────────────────────────────────────────────
-- response jsonb shape:
--   subjective/objective -> "typed answer text"
--   mcq                  -> ["a", "c"]  (selected option ids)
--   true_false           -> true | false

CREATE TABLE IF NOT EXISTS public.exam_answers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID REFERENCES public.exam_submissions(id) ON DELETE CASCADE NOT NULL,
  question_id UUID REFERENCES public.exam_questions(id) ON DELETE CASCADE NOT NULL,
  response JSONB,
  awarded_marks NUMERIC,
  is_correct BOOLEAN,
  remark TEXT,
  graded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(submission_id, question_id)
);

ALTER TABLE public.exam_answers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_exam_answers_submission_id ON public.exam_answers(submission_id);
CREATE INDEX IF NOT EXISTS idx_exam_answers_question_id ON public.exam_answers(question_id);

DROP TRIGGER IF EXISTS exam_answers_updated_at ON public.exam_answers;
CREATE TRIGGER exam_answers_updated_at
  BEFORE UPDATE ON public.exam_answers
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── exam_templates (PYQ library) ─────────────────────────────
-- questions jsonb is a snapshot of the source exam's questions
-- (prompt, type, marks, options, correct_answer, multiple_select).
-- Browsable by all staff; only the creator can edit/delete.

CREATE TABLE IF NOT EXISTS public.exam_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_exam_id UUID REFERENCES public.exams(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  subject TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.exam_templates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_exam_templates_created_by ON public.exam_templates(created_by);

-- ── exam_result_links ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.exam_result_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES public.exams(id) ON DELETE CASCADE NOT NULL,
  classroom_id UUID REFERENCES public.classrooms(id) ON DELETE CASCADE NOT NULL,
  assessment_id UUID REFERENCES public.classroom_assessments(id) ON DELETE SET NULL,
  linked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.exam_result_links ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_exam_result_links_exam_id ON public.exam_result_links(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_result_links_classroom_id ON public.exam_result_links(classroom_id);

-- ============================================================
-- 2. HELPER FUNCTIONS
-- SECURITY DEFINER so they bypass RLS and can be safely referenced
-- from the policies below. Created after the tables they read.
-- ============================================================

-- True when the current user owns the exam (its creator).
CREATE OR REPLACE FUNCTION public.is_exam_owner(p_exam_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exams e
    WHERE e.id = p_exam_id AND e.created_by = auth.uid()
  );
$$;

-- True when the current user can manage the exam: owner OR a grader.
CREATE OR REPLACE FUNCTION public.can_manage_exam(p_exam_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exams e
    WHERE e.id = p_exam_id AND e.created_by = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.exam_graders g
    WHERE g.exam_id = p_exam_id AND g.teacher_id = auth.uid()
  );
$$;

-- True when the current user is a student in the exam's audience,
-- either targeted individually or via one of their homerooms.
CREATE OR REPLACE FUNCTION public.is_exam_student(p_exam_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exam_audiences a
    WHERE a.exam_id = p_exam_id
      AND (
        a.user_id = auth.uid()
        OR a.homeroom_id IN (
          SELECT hm.homeroom_id FROM public.homeroom_members hm
          WHERE hm.student_id = auth.uid()
        )
      )
  );
$$;

-- Resolve a submission to its exam (used by exam_answers policies).
CREATE OR REPLACE FUNCTION public.submission_exam_id(p_submission_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT exam_id FROM public.exam_submissions WHERE id = p_submission_id;
$$;

-- True when the current user owns the submission (the student).
CREATE OR REPLACE FUNCTION public.owns_submission(p_submission_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exam_submissions s
    WHERE s.id = p_submission_id AND s.student_id = auth.uid()
  );
$$;

-- ============================================================
-- 3. RLS POLICIES
-- ============================================================

-- ── exams ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "exams_select" ON public.exams;
CREATE POLICY "exams_select"
  ON public.exams FOR SELECT
  USING (public.can_manage_exam(id) OR public.is_exam_student(id));

DROP POLICY IF EXISTS "exams_insert" ON public.exams;
CREATE POLICY "exams_insert"
  ON public.exams FOR INSERT
  WITH CHECK (
    (
      public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
      OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "exams_update" ON public.exams;
CREATE POLICY "exams_update"
  ON public.exams FOR UPDATE
  USING (public.can_manage_exam(id));

DROP POLICY IF EXISTS "exams_delete" ON public.exams;
CREATE POLICY "exams_delete"
  ON public.exams FOR DELETE
  USING (public.is_exam_owner(id));

-- ── exam_questions ───────────────────────────────────────────
-- Managers see everything. Students may read questions (incl. the
-- correct_answer) ONLY after results are published, for review.
-- Before that, students must use get_exam_questions_for_student().

DROP POLICY IF EXISTS "exam_questions_select" ON public.exam_questions;
CREATE POLICY "exam_questions_select"
  ON public.exam_questions FOR SELECT
  USING (
    public.can_manage_exam(exam_id)
    OR (
      public.is_exam_student(exam_id)
      AND EXISTS (
        SELECT 1 FROM public.exams e
        WHERE e.id = exam_id AND e.results_published = TRUE
      )
    )
  );

DROP POLICY IF EXISTS "exam_questions_insert" ON public.exam_questions;
CREATE POLICY "exam_questions_insert"
  ON public.exam_questions FOR INSERT
  WITH CHECK (public.can_manage_exam(exam_id));

DROP POLICY IF EXISTS "exam_questions_update" ON public.exam_questions;
CREATE POLICY "exam_questions_update"
  ON public.exam_questions FOR UPDATE
  USING (public.can_manage_exam(exam_id));

DROP POLICY IF EXISTS "exam_questions_delete" ON public.exam_questions;
CREATE POLICY "exam_questions_delete"
  ON public.exam_questions FOR DELETE
  USING (public.can_manage_exam(exam_id));

-- ── exam_audiences ───────────────────────────────────────────

DROP POLICY IF EXISTS "exam_audiences_select" ON public.exam_audiences;
CREATE POLICY "exam_audiences_select"
  ON public.exam_audiences FOR SELECT
  USING (public.can_manage_exam(exam_id) OR public.is_exam_student(exam_id));

DROP POLICY IF EXISTS "exam_audiences_insert" ON public.exam_audiences;
CREATE POLICY "exam_audiences_insert"
  ON public.exam_audiences FOR INSERT
  WITH CHECK (public.can_manage_exam(exam_id));

DROP POLICY IF EXISTS "exam_audiences_delete" ON public.exam_audiences;
CREATE POLICY "exam_audiences_delete"
  ON public.exam_audiences FOR DELETE
  USING (public.can_manage_exam(exam_id));

-- ── exam_graders ─────────────────────────────────────────────
-- Only the exam owner can add/remove graders.

DROP POLICY IF EXISTS "exam_graders_select" ON public.exam_graders;
CREATE POLICY "exam_graders_select"
  ON public.exam_graders FOR SELECT
  USING (public.can_manage_exam(exam_id) OR teacher_id = auth.uid());

DROP POLICY IF EXISTS "exam_graders_insert" ON public.exam_graders;
CREATE POLICY "exam_graders_insert"
  ON public.exam_graders FOR INSERT
  WITH CHECK (public.is_exam_owner(exam_id));

DROP POLICY IF EXISTS "exam_graders_delete" ON public.exam_graders;
CREATE POLICY "exam_graders_delete"
  ON public.exam_graders FOR DELETE
  USING (public.is_exam_owner(exam_id));

-- ── exam_submissions ─────────────────────────────────────────
-- Students start their own attempt; managers may create rows
-- (e.g. marking a no-show absent).

DROP POLICY IF EXISTS "exam_submissions_select" ON public.exam_submissions;
CREATE POLICY "exam_submissions_select"
  ON public.exam_submissions FOR SELECT
  USING (public.can_manage_exam(exam_id) OR student_id = auth.uid());

DROP POLICY IF EXISTS "exam_submissions_insert" ON public.exam_submissions;
CREATE POLICY "exam_submissions_insert"
  ON public.exam_submissions FOR INSERT
  WITH CHECK (
    (student_id = auth.uid() AND public.is_exam_student(exam_id))
    OR public.can_manage_exam(exam_id)
  );

DROP POLICY IF EXISTS "exam_submissions_update" ON public.exam_submissions;
CREATE POLICY "exam_submissions_update"
  ON public.exam_submissions FOR UPDATE
  USING (public.can_manage_exam(exam_id) OR student_id = auth.uid());

DROP POLICY IF EXISTS "exam_submissions_delete" ON public.exam_submissions;
CREATE POLICY "exam_submissions_delete"
  ON public.exam_submissions FOR DELETE
  USING (public.can_manage_exam(exam_id));

-- ── exam_answers ─────────────────────────────────────────────

DROP POLICY IF EXISTS "exam_answers_select" ON public.exam_answers;
CREATE POLICY "exam_answers_select"
  ON public.exam_answers FOR SELECT
  USING (
    public.owns_submission(submission_id)
    OR public.can_manage_exam(public.submission_exam_id(submission_id))
  );

DROP POLICY IF EXISTS "exam_answers_insert" ON public.exam_answers;
CREATE POLICY "exam_answers_insert"
  ON public.exam_answers FOR INSERT
  WITH CHECK (
    public.owns_submission(submission_id)
    OR public.can_manage_exam(public.submission_exam_id(submission_id))
  );

DROP POLICY IF EXISTS "exam_answers_update" ON public.exam_answers;
CREATE POLICY "exam_answers_update"
  ON public.exam_answers FOR UPDATE
  USING (
    public.owns_submission(submission_id)
    OR public.can_manage_exam(public.submission_exam_id(submission_id))
  );

DROP POLICY IF EXISTS "exam_answers_delete" ON public.exam_answers;
CREATE POLICY "exam_answers_delete"
  ON public.exam_answers FOR DELETE
  USING (public.can_manage_exam(public.submission_exam_id(submission_id)));

-- ── exam_templates (PYQ library) ─────────────────────────────

DROP POLICY IF EXISTS "exam_templates_select" ON public.exam_templates;
CREATE POLICY "exam_templates_select"
  ON public.exam_templates FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

DROP POLICY IF EXISTS "exam_templates_insert" ON public.exam_templates;
CREATE POLICY "exam_templates_insert"
  ON public.exam_templates FOR INSERT
  WITH CHECK (
    (
      public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
      OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "exam_templates_update" ON public.exam_templates;
CREATE POLICY "exam_templates_update"
  ON public.exam_templates FOR UPDATE
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS "exam_templates_delete" ON public.exam_templates;
CREATE POLICY "exam_templates_delete"
  ON public.exam_templates FOR DELETE
  USING (created_by = auth.uid());

-- ── exam_result_links ────────────────────────────────────────

DROP POLICY IF EXISTS "exam_result_links_select" ON public.exam_result_links;
CREATE POLICY "exam_result_links_select"
  ON public.exam_result_links FOR SELECT
  USING (public.can_manage_exam(exam_id));

DROP POLICY IF EXISTS "exam_result_links_insert" ON public.exam_result_links;
CREATE POLICY "exam_result_links_insert"
  ON public.exam_result_links FOR INSERT
  WITH CHECK (public.can_manage_exam(exam_id));

DROP POLICY IF EXISTS "exam_result_links_delete" ON public.exam_result_links;
CREATE POLICY "exam_result_links_delete"
  ON public.exam_result_links FOR DELETE
  USING (public.can_manage_exam(exam_id));

-- ============================================================
-- 4. RPC: student-safe question fetch (omits correct_answer)
-- Students use this to take an exam; correct answers are never
-- returned. Access is restricted to audience students (and managers).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_exam_questions_for_student(p_exam_id UUID)
RETURNS TABLE (
  id UUID,
  exam_id UUID,
  "position" INTEGER,
  type TEXT,
  prompt TEXT,
  marks NUMERIC,
  options JSONB,
  multiple_select BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT q.id, q.exam_id, q.position, q.type, q.prompt, q.marks, q.options, q.multiple_select
  FROM public.exam_questions q
  WHERE q.exam_id = p_exam_id
    AND (public.is_exam_student(p_exam_id) OR public.can_manage_exam(p_exam_id))
  ORDER BY q.position ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_exam_questions_for_student(UUID) TO authenticated;

COMMIT;
