-- ============================================================
-- Migration: Exam Modes, per-question scoring, close state &
--            broadened staff management access.
--
-- 1. exams.exam_mode  (school | neet | jee_main | jee_advanced | custom)
--    replaces the old exams.grading_method, backfilled from it.
-- 2. exams.is_closed / closed_at  — creator can close an exam (or it
--    closes once all participants are graded and results published).
-- 3. exam_questions.scoring_strategy / scoring_params (jsonb) — every
--    question carries its own scoring rule, so grading never re-derives
--    rules from the exam. Backfilled from the old per-exam negative_ratio.
-- 4. exam_questions.type now also allows 'integer'.
-- 5. can_manage_exam() now also grants management to admins & principals
--    (every exam) and to a coordinator when the exam's creator is a
--    member of one of that coordinator's teams.
--
-- Idempotent — safe to run multiple times (the legacy-column backfills are
-- guarded so re-running after the columns are dropped is a no-op).
-- Run AFTER add_exam_app.sql.
-- ============================================================

BEGIN;

-- ── 1. exams.exam_mode ───────────────────────────────────────
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS exam_mode TEXT;

-- Backfill exam_mode from the legacy grading_method, if that column still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'exams' AND column_name = 'grading_method'
  ) THEN
    EXECUTE $q$
      UPDATE public.exams
      SET exam_mode = CASE grading_method
          WHEN 'none'   THEN 'school'
          WHEN 'neet'   THEN 'neet'
          WHEN 'jee'    THEN 'jee_main'
          WHEN 'custom' THEN 'custom'
          ELSE 'school'
        END
      WHERE exam_mode IS NULL
    $q$;
  END IF;
END $$;

ALTER TABLE public.exams ALTER COLUMN exam_mode SET DEFAULT 'school';
UPDATE public.exams SET exam_mode = 'school' WHERE exam_mode IS NULL;
ALTER TABLE public.exams ALTER COLUMN exam_mode SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.exams
    ADD CONSTRAINT exams_exam_mode_check
    CHECK (exam_mode IN ('school','neet','jee_main','jee_advanced','custom'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. close state ───────────────────────────────────────────
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS is_closed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- ── 3 & 4. per-question scoring + integer type ───────────────
ALTER TABLE public.exam_questions ADD COLUMN IF NOT EXISTS scoring_strategy TEXT;
ALTER TABLE public.exam_questions ADD COLUMN IF NOT EXISTS scoring_params JSONB;

-- Allow the new 'integer' question type.
ALTER TABLE public.exam_questions DROP CONSTRAINT IF EXISTS exam_questions_type_check;
ALTER TABLE public.exam_questions
  ADD CONSTRAINT exam_questions_type_check
  CHECK (type IN ('subjective','objective','mcq','true_false','integer'));

-- Backfill scoring_strategy + scoring_params from the legacy model
-- (type + multiple_select + the exam's negative_ratio if it still exists).
-- Only fills rows that don't yet have a strategy, so re-running is a no-op.
DO $$
DECLARE
  has_ratio BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'exams' AND column_name = 'negative_ratio'
  ) INTO has_ratio;

  EXECUTE format($q$
    UPDATE public.exam_questions q
    SET
      scoring_strategy = CASE
        WHEN q.type = 'mcq' AND q.multiple_select THEN 'mcq_multiple_proportional'
        WHEN q.type = 'mcq'                        THEN 'mcq_single'
        WHEN q.type = 'true_false'                 THEN 'true_false'
        WHEN q.type = 'integer'                    THEN 'integer_exact'
        ELSE 'manual'
      END,
      scoring_params = jsonb_build_object(
        'correct', q.marks,
        'wrong', CASE
          WHEN q.type IN ('mcq','true_false')
            THEN -1 * ROUND((COALESCE(%s, 0) * q.marks)::numeric, 2)
          ELSE 0
        END,
        'blank', 0
      )
    FROM public.exams e
    WHERE q.exam_id = e.id AND q.scoring_strategy IS NULL
  $q$, CASE WHEN has_ratio THEN 'e.negative_ratio' ELSE '0' END);
END $$;

-- Legacy columns are fully replaced by exam_mode + per-question scoring.
-- Dropped only after the backfills above have consumed them.
ALTER TABLE public.exams DROP COLUMN IF EXISTS grading_method;
ALTER TABLE public.exams DROP COLUMN IF EXISTS negative_ratio;

-- ── 5. broadened management access ───────────────────────────
-- Owner OR explicit grader OR admin/principal (all exams) OR a coordinator
-- whose team contains the exam's creator.
CREATE OR REPLACE FUNCTION public.can_manage_exam(p_exam_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.exams e WHERE e.id = p_exam_id AND e.created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM public.exam_graders g WHERE g.exam_id = p_exam_id AND g.teacher_id = auth.uid())
    OR public.get_user_role() IN ('admin','principal')
    OR (
      public.get_user_role() = 'coordinator'
      AND EXISTS (
        SELECT 1
        FROM public.exams e
        JOIN public.team_members tm ON tm.user_id = e.created_by
        JOIN public.teams t ON t.id = tm.team_id
        WHERE e.id = p_exam_id AND t.coordinator_id = auth.uid()
      )
    );
$$;

COMMIT;
