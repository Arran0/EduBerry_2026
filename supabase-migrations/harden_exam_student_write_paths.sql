-- Harden the exam app's student-facing write paths.
--
-- RLS on exam_submissions and exam_answers is row-scoped only: it establishes
-- WHICH row a student may write, never WHICH COLUMNS. That left three holes,
-- all reachable with nothing but the student's own anon-key session:
--
--   1. Score forgery — a student could UPDATE their own exam_submissions row
--      and set total_score / manual_score / auto_score / status directly.
--   2. Self-grading  — a student could UPDATE their own exam_answers rows and
--      set awarded_marks / is_correct, which finalizeSubmission() then sums.
--   3. Answer-key leak — setting their own submission to status 'graded' makes
--      student_can_review_exam() true, which opens exam_questions (including
--      correct_answer) to them BEFORE they have answered.
--
-- Postgres RLS has no column-level WITH CHECK, and column-level GRANTs would
-- also hit teachers, who legitimately write these columns. So the guard is a
-- BEFORE trigger per table: privileged backend roles and exam managers write
-- freely; everyone else gets the grading columns pinned to their previous
-- values and is held to the transitions a student is actually allowed to make.
--
-- Grading and submission stay server-side: /api/exam/submit runs with the
-- service role, which these triggers pass straight through.

-- ── exam_submissions ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.exam_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  -- The submit route (service role) and DB owners write freely.
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  -- Teachers/graders/admins grade through this table by design.
  IF public.can_manage_exam(NEW.exam_id) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A student may open their own attempt, and nothing more.
    IF NEW.status NOT IN ('not_started', 'in_progress') THEN
      RAISE EXCEPTION 'exam_submissions: a student cannot open an attempt with status %', NEW.status
        USING ERRCODE = '42501';
    END IF;
    NEW.is_absent    := false;
    NEW.auto_score   := NULL;
    NEW.manual_score := NULL;
    NEW.total_score  := NULL;
    NEW.max_score    := NULL;
    NEW.graded_by    := NULL;
    NEW.graded_at    := NULL;
    NEW.submitted_at := NULL;
    RETURN NEW;
  END IF;

  -- A handed-in attempt is closed to its author.
  IF OLD.status IN ('submitted', 'graded') THEN
    RAISE EXCEPTION 'exam_submissions: a submitted attempt cannot be modified by the student'
      USING ERRCODE = '42501';
  END IF;

  -- Starting the attempt is the only student-writable transition; handing in
  -- goes through /api/exam/submit under the service role.
  IF NEW.status NOT IN ('not_started', 'in_progress') THEN
    RAISE EXCEPTION 'exam_submissions: a student cannot set status %', NEW.status
      USING ERRCODE = '42501';
  END IF;

  NEW.exam_id      := OLD.exam_id;
  NEW.student_id   := OLD.student_id;
  NEW.is_absent    := OLD.is_absent;
  NEW.auto_score   := OLD.auto_score;
  NEW.manual_score := OLD.manual_score;
  NEW.total_score  := OLD.total_score;
  NEW.max_score    := OLD.max_score;
  NEW.graded_by    := OLD.graded_by;
  NEW.graded_at    := OLD.graded_at;
  NEW.submitted_at := OLD.submitted_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exam_submissions_guard ON public.exam_submissions;
CREATE TRIGGER exam_submissions_guard
  BEFORE INSERT OR UPDATE ON public.exam_submissions
  FOR EACH ROW EXECUTE FUNCTION public.exam_submissions_guard();

-- ── exam_answers ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.exam_answers_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF public.can_manage_exam(public.submission_exam_id(NEW.submission_id)) THEN
    RETURN NEW;
  END IF;

  -- RLS has already established the writer owns this submission. Answers are
  -- writable only while their attempt is still open.
  SELECT s.status INTO v_status
    FROM public.exam_submissions s
   WHERE s.id = NEW.submission_id;

  IF v_status IS NULL OR v_status NOT IN ('not_started', 'in_progress') THEN
    RAISE EXCEPTION 'exam_answers: this attempt is no longer open for answers'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.awarded_marks := NULL;
    NEW.is_correct    := NULL;
    NEW.graded_by     := NULL;
    NEW.remark        := NULL;
  ELSE
    NEW.submission_id := OLD.submission_id;
    NEW.question_id   := OLD.question_id;
    NEW.awarded_marks := OLD.awarded_marks;
    NEW.is_correct    := OLD.is_correct;
    NEW.graded_by     := OLD.graded_by;
    NEW.remark        := OLD.remark;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exam_answers_guard ON public.exam_answers;
CREATE TRIGGER exam_answers_guard
  BEFORE INSERT OR UPDATE ON public.exam_answers
  FOR EACH ROW EXECUTE FUNCTION public.exam_answers_guard();

-- ── Question paper: don't hand it out before the exam opens ──
--
-- The RPC returns a student-safe question (no correct_answer), but it returned
-- one for any audience student at any time — so a scheduled exam's paper could
-- be read before it opened, and re-read after the attempt window shut. Gate it
-- on the same window the take page enforces client-side.

CREATE OR REPLACE FUNCTION public.get_exam_questions_for_student(p_exam_id uuid)
RETURNS TABLE(
  id uuid,
  exam_id uuid,
  "position" integer,
  type text,
  prompt text,
  marks numeric,
  options jsonb,
  multiple_select boolean,
  image_url text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT q.id, q.exam_id, q.position, q.type, q.prompt, q.marks, q.options, q.multiple_select, q.image_url
  FROM public.exam_questions q
  JOIN public.exams e ON e.id = q.exam_id
  WHERE q.exam_id = p_exam_id
    AND (
      public.can_manage_exam(p_exam_id)
      OR (
        public.is_exam_student(p_exam_id)
        AND (
          -- Reviewable exams stay readable regardless of the attempt window.
          public.student_can_review_exam(p_exam_id)
          OR (
            (e.start_at IS NULL OR now() >= e.start_at)
            AND now() <= LEAST(
              COALESCE(e.due_at, 'infinity'::timestamptz),
              COALESCE(e.end_at, 'infinity'::timestamptz)
            )
          )
        )
      )
    )
  ORDER BY q.position ASC;
$$;

-- ── Defence in depth: anon has no business in the exam tables ──
--
-- Every exam policy is scoped to `authenticated`, so anon already reads and
-- writes nothing. Dropping the table grants removes the standing privilege
-- rather than relying on policy coverage alone (matching what
-- revoke_anon_and_trigger_function_execute.sql did for other tables).

REVOKE ALL ON TABLE
  public.exams,
  public.exam_questions,
  public.exam_audiences,
  public.exam_graders,
  public.exam_submissions,
  public.exam_answers,
  public.exam_templates,
  public.exam_result_links
FROM anon;
