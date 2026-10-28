-- Students see a report card's marks only once that report card is published.
--
-- Report cards are published one class at a time (grade + section + report card
-- title, report_card_publications), and the report cards screen hides a card
-- until its class is published. The marks underneath were not held back: the
-- select policies on classroom_assessment_marks and
-- classroom_assessment_component_marks let a student read every one of their own
-- marks the moment a teacher typed it, so the Assessments tab, the home
-- "latest assessments" list and the academic record showed what the report card
-- was still hiding. report_card_remarks had the same gap.
--
-- After this migration a student reads their own mark for an assessment when the
-- assessment has no report card title (an ordinary class test), or when its title
-- has been published for the assessment's class. A remark follows the same rule
-- for its title and the student's own class. Staff access is unchanged.
--
-- Live on 28 Oct 2026: 231 of 252 assessments carry a report card title and no
-- class has been published, so students stop seeing 5,715 of their 6,213 marks
-- until their class teachers publish.
--
-- SAFE TO RE-RUN.

-- Whether a student may see marks of this assessment yet. Matches the class the
-- way the report cards screen does: the classroom's grade and section, sections
-- compared trimmed and upper-cased (normalizeSection).
CREATE OR REPLACE FUNCTION public.assessment_marks_released(p_assessment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT NULLIF(btrim(a.report_card_title), '') IS NULL
        OR EXISTS (
             SELECT 1
               FROM public.report_card_publications rp
              WHERE rp.report_card_title = a.report_card_title
                AND rp.grade = c.grade
                AND upper(btrim(rp.section)) = upper(btrim(c.section))
           )
      FROM public.classroom_assessments a
      JOIN public.classrooms c ON c.id = a.classroom_id
     WHERE a.id = p_assessment_id
  ), false);
$$;

-- The same question for a remark: published for this title and the student's
-- own grade and section.
CREATE OR REPLACE FUNCTION public.report_card_title_released(p_student_id UUID, p_title TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.report_card_publications rp
      JOIN public.profiles p ON p.id = p_student_id
     WHERE rp.report_card_title = p_title
       AND rp.grade = p.grade
       AND upper(btrim(rp.section)) = upper(btrim(p.section))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.assessment_marks_released(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.report_card_title_released(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assessment_marks_released(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_card_title_released(UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS classroom_assessment_marks_select_merged ON public.classroom_assessment_marks;
CREATE POLICY classroom_assessment_marks_select_merged
  ON public.classroom_assessment_marks
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = ANY (ARRAY['teacher', 'coordinator', 'principal', 'admin'])
    OR (student_id = (SELECT auth.uid()) AND public.assessment_marks_released(assessment_id))
  );

DROP POLICY IF EXISTS classroom_assessment_component_marks_select ON public.classroom_assessment_component_marks;
CREATE POLICY classroom_assessment_component_marks_select
  ON public.classroom_assessment_component_marks
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = ANY (ARRAY['teacher', 'coordinator', 'principal', 'admin'])
    OR (
      student_id = (SELECT auth.uid())
      AND public.assessment_marks_released(
            (SELECT c.assessment_id FROM public.classroom_assessment_components c WHERE c.id = component_id))
    )
  );

DROP POLICY IF EXISTS "View own or staff view all remarks" ON public.report_card_remarks;
CREATE POLICY "View own or staff view all remarks"
  ON public.report_card_remarks
  FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = ANY (ARRAY['teacher', 'coordinator', 'principal', 'admin'])
    OR (student_id = (SELECT auth.uid()) AND public.report_card_title_released(student_id, report_card_title))
  );
