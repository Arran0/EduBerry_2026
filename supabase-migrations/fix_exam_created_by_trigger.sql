-- ============================================================
-- Fix: exam creation produces orphaned exams (created_by = NULL)
--
-- Root cause:
--   Exams are created by the /api/exam/create route using the SERVICE ROLE
--   (no JWT), after the route verifies the caller's token + staff role and
--   sets created_by to that user's id. The BEFORE INSERT trigger
--   exam_set_created_by unconditionally ran `NEW.created_by := auth.uid()`,
--   but auth.uid() is NULL for a service-role connection — so it clobbered
--   the real id to NULL. The exam was inserted but orphaned: can_manage_exam()
--   is false for everyone, so the creating teacher could not read it back,
--   could not add questions (exam_questions INSERT failed RLS), and it never
--   appeared in their list.
--
-- Fix:
--   Only override created_by when there IS an authenticated user. Client/RLS
--   inserts (auth.uid() set) are still pinned to the caller — they cannot
--   spoof created_by. Service-role inserts (auth.uid() NULL) keep the value
--   the trusted server route already set.
--
-- Idempotent. Safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.exam_set_created_by()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END; $$;

-- (Re)attach the trigger so the table is guaranteed to use the fixed function.
DROP TRIGGER IF EXISTS exams_set_created_by ON public.exams;
CREATE TRIGGER exams_set_created_by
  BEFORE INSERT ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.exam_set_created_by();
