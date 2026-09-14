-- ============================================================
-- Migration: drop redundant arms from three academics SELECT policies
--            [NOT YET APPLIED — needs to be run manually]
--
-- Each of these policies evaluates the same helper twice per statement because
-- an earlier consolidation OR-ed a narrow policy into a broad one that already
-- covered it. The rewrites below are pure boolean algebra on the *original*
-- clause text, so row visibility is provably unchanged:
--
--   classroom_assessment_marks:  A OR (B OR A)   ->  B OR A
--   classroom_assessments:       A OR (B OR A')  ->  A OR B
--                                (A' = role IN (principal, admin), a subset of
--                                 A = role IN (teacher, coordinator,
--                                 principal, admin))
--   profiles:                    true OR f(id)   ->  true
--
-- Each table has exactly one PERMISSIVE policy per command for the
-- `authenticated` role, so there is no policy-merge subtlety here: ALTER POLICY
-- replaces the qual in place and no command loses or gains a check.
--
-- Verify after applying by comparing visible row counts per persona against
-- these pre-change baselines (authenticated role, request.jwt.claims set to
-- each persona's sub):
--
--   table                       admin  coordinator  principal  teacher  student  no-claims
--   classroom_assessment_marks    334          334        334      334        5          0
--   classroom_assessments          19           19         19       19        5          0
--   profiles                     1157         1157       1157     1157     1157       1157
-- ============================================================

ALTER POLICY "classroom_assessment_marks_select_merged" ON public.classroom_assessment_marks
  USING (
    (student_id = (SELECT auth.uid()))
    OR ((SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']))
  );

ALTER POLICY "classroom_assessments_select_merged" ON public.classroom_assessments
  USING (
    ((SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']))
    OR public.user_is_classroom_member(classroom_id)
  );

ALTER POLICY "Authenticated users can view all profiles" ON public.profiles
  USING (true);
