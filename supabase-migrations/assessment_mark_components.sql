-- Marksheet components.
--
-- An assessment used to carry one number per student. Teachers asked to split
-- it: "Lab" out of 20 and "Examination" out of 80, entered separately but
-- reported as one score out of 100.
--
-- Two tables carry the split — the components themselves and a mark per
-- (component, student). `classroom_assessment_marks` stays exactly what it
-- always was, the student's total for the assessment, so every existing reader
-- (report cards, the class-wide matrix, the academic record) keeps working
-- untouched. It is just no longer written by hand when components exist:
-- triggers recompute it from the component marks, which is what keeps the two
-- levels from drifting apart no matter which client wrote them.

-- ─── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.classroom_assessment_components (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.classroom_assessments(id) ON DELETE CASCADE,
  name        text NOT NULL,
  max_marks   numeric NOT NULL DEFAULT 0,
  -- Display order in the marksheet and on the report card. Ties break on name.
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  CONSTRAINT classroom_assessment_components_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT classroom_assessment_components_max_positive CHECK (max_marks > 0),
  -- Two components called "Lab" on one assessment would be unreadable on a
  -- report card, and nothing in the UI needs it.
  CONSTRAINT classroom_assessment_components_unique_name UNIQUE (assessment_id, name)
);

CREATE INDEX IF NOT EXISTS classroom_assessment_components_assessment_idx
  ON public.classroom_assessment_components (assessment_id);

CREATE TABLE IF NOT EXISTS public.classroom_assessment_component_marks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id uuid NOT NULL REFERENCES public.classroom_assessment_components(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marks        numeric,
  is_absent    boolean NOT NULL DEFAULT false,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  CONSTRAINT classroom_assessment_component_marks_non_negative
    CHECK (marks IS NULL OR marks >= 0),
  CONSTRAINT classroom_assessment_component_marks_unique UNIQUE (component_id, student_id)
);

CREATE INDEX IF NOT EXISTS classroom_assessment_component_marks_student_idx
  ON public.classroom_assessment_component_marks (student_id);

-- ─── Total recomputation ──────────────────────────────────────────────────────

-- Rebuilds `classroom_assessment_marks` for one assessment from its component
-- marks — for a single student when one is named, otherwise for everyone.
--
-- The rules a report card needs:
--   * absent in every component  → the total is absent (marks NULL);
--   * at least one mark entered  → total = sum of the entered marks, with a
--     blank or absent component contributing nothing;
--   * nothing entered at all     → no total row, so the card shows "—" rather
--     than a zero the teacher never typed.
-- Out of is always the assessment's full max, never only the graded parts:
-- 15/20 on the lab with the exam still to come is 15 out of 100, not 15/20.
CREATE OR REPLACE FUNCTION public.recompute_assessment_component_totals(
  p_assessment_id uuid,
  p_student_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_total_max      numeric;
  v_component_count integer;
BEGIN
  SELECT coalesce(sum(max_marks), 0), count(*)
    INTO v_total_max, v_component_count
  FROM public.classroom_assessment_components
  WHERE assessment_id = p_assessment_id;

  -- The last component was just removed: the assessment is back to a single
  -- total the teacher enters by hand, so leave the existing totals alone.
  IF v_component_count = 0 THEN
    RETURN;
  END IF;

  -- Students whose component marks no longer amount to anything (every row
  -- deleted, or every row left blank) lose their total row.
  DELETE FROM public.classroom_assessment_marks m
  WHERE m.assessment_id = p_assessment_id
    AND (p_student_id IS NULL OR m.student_id = p_student_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.classroom_assessment_component_marks cm
      JOIN public.classroom_assessment_components c ON c.id = cm.component_id
      WHERE c.assessment_id = p_assessment_id
        AND cm.student_id = m.student_id
        AND (cm.is_absent OR cm.marks IS NOT NULL)
    );

  INSERT INTO public.classroom_assessment_marks
    (assessment_id, student_id, marks, max_marks, is_absent, updated_at)
  SELECT
    p_assessment_id,
    cm.student_id,
    CASE WHEN bool_and(cm.is_absent) THEN NULL
         ELSE sum(CASE WHEN cm.is_absent THEN 0 ELSE coalesce(cm.marks, 0) END)
    END,
    v_total_max,
    bool_and(cm.is_absent),
    now()
  FROM public.classroom_assessment_component_marks cm
  JOIN public.classroom_assessment_components c ON c.id = cm.component_id
  WHERE c.assessment_id = p_assessment_id
    AND (p_student_id IS NULL OR cm.student_id = p_student_id)
  GROUP BY cm.student_id
  HAVING bool_or(cm.is_absent) OR count(*) FILTER (WHERE cm.marks IS NOT NULL) > 0
  ON CONFLICT (assessment_id, student_id) DO UPDATE
    SET marks      = excluded.marks,
        max_marks  = excluded.max_marks,
        is_absent  = excluded.is_absent,
        updated_at = now();
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.recompute_assessment_component_totals(uuid, uuid) FROM public, anon, authenticated;

-- A component mark changed → that one student's total is stale.
CREATE OR REPLACE FUNCTION public.tg_component_mark_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_assessment_id uuid;
  v_row public.classroom_assessment_component_marks;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT assessment_id INTO v_assessment_id
  FROM public.classroom_assessment_components
  WHERE id = v_row.component_id;

  IF v_assessment_id IS NOT NULL THEN
    PERFORM public.recompute_assessment_component_totals(v_assessment_id, v_row.student_id);
  END IF;
  RETURN NULL;
END;
$fn$;

-- Both trigger functions are SECURITY DEFINER, so PostgREST would otherwise
-- expose them at /rest/v1/rpc/... A direct call errors out ("can only be called
-- as a trigger"), but a definer function has no business being reachable.
REVOKE EXECUTE ON FUNCTION public.tg_component_mark_recompute() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS component_mark_recompute ON public.classroom_assessment_component_marks;
CREATE TRIGGER component_mark_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.classroom_assessment_component_marks
FOR EACH ROW EXECUTE FUNCTION public.tg_component_mark_recompute();

-- The component set changed → the assessment's own max is the sum of its parts,
-- and every total for it needs rebuilding against the new denominator.
CREATE OR REPLACE FUNCTION public.tg_component_sync_assessment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_assessment_id uuid;
  v_total_max     numeric;
  v_count         integer;
BEGIN
  v_assessment_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.assessment_id ELSE NEW.assessment_id END;

  SELECT coalesce(sum(max_marks), 0), count(*)
    INTO v_total_max, v_count
  FROM public.classroom_assessment_components
  WHERE assessment_id = v_assessment_id;

  IF v_count > 0 THEN
    UPDATE public.classroom_assessments
       SET max_marks = v_total_max, updated_at = now()
     WHERE id = v_assessment_id AND max_marks IS DISTINCT FROM v_total_max;

    -- Totals a student has no component mark for (entered before the split)
    -- still have to carry the new denominator, or the report card would add a
    -- mark out of 50 into a column headed 100.
    UPDATE public.classroom_assessment_marks
       SET max_marks = v_total_max, updated_at = now()
     WHERE assessment_id = v_assessment_id AND max_marks IS DISTINCT FROM v_total_max;

    PERFORM public.recompute_assessment_component_totals(v_assessment_id, NULL);
  END IF;

  RETURN NULL;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.tg_component_sync_assessment() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS component_sync_assessment ON public.classroom_assessment_components;
CREATE TRIGGER component_sync_assessment
AFTER INSERT OR UPDATE OR DELETE ON public.classroom_assessment_components
FOR EACH ROW EXECUTE FUNCTION public.tg_component_sync_assessment();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Mirrors classroom_assessments / classroom_assessment_marks exactly: staff
-- write, classroom members read the components, and a student reads only their
-- own component marks.

ALTER TABLE public.classroom_assessment_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_assessment_component_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS classroom_assessment_components_select ON public.classroom_assessment_components;
CREATE POLICY classroom_assessment_components_select
  ON public.classroom_assessment_components FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin'])
    OR EXISTS (
      SELECT 1 FROM public.classroom_assessments a
      WHERE a.id = classroom_assessment_components.assessment_id
        AND public.user_is_classroom_member(a.classroom_id)
    )
  );

DROP POLICY IF EXISTS classroom_assessment_components_insert ON public.classroom_assessment_components;
CREATE POLICY classroom_assessment_components_insert
  ON public.classroom_assessment_components FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']));

DROP POLICY IF EXISTS classroom_assessment_components_update ON public.classroom_assessment_components;
CREATE POLICY classroom_assessment_components_update
  ON public.classroom_assessment_components FOR UPDATE TO authenticated
  USING ((SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']))
  WITH CHECK ((SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']));

DROP POLICY IF EXISTS classroom_assessment_components_delete ON public.classroom_assessment_components;
CREATE POLICY classroom_assessment_components_delete
  ON public.classroom_assessment_components FOR DELETE TO authenticated
  USING ((SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']));

DROP POLICY IF EXISTS classroom_assessment_component_marks_select ON public.classroom_assessment_component_marks;
CREATE POLICY classroom_assessment_component_marks_select
  ON public.classroom_assessment_component_marks FOR SELECT TO authenticated
  USING (
    student_id = (SELECT auth.uid())
    OR (SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin'])
  );

DROP POLICY IF EXISTS classroom_assessment_component_marks_insert ON public.classroom_assessment_component_marks;
CREATE POLICY classroom_assessment_component_marks_insert
  ON public.classroom_assessment_component_marks FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']));

DROP POLICY IF EXISTS classroom_assessment_component_marks_update ON public.classroom_assessment_component_marks;
CREATE POLICY classroom_assessment_component_marks_update
  ON public.classroom_assessment_component_marks FOR UPDATE TO authenticated
  USING ((SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']))
  WITH CHECK ((SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']));

DROP POLICY IF EXISTS classroom_assessment_component_marks_delete ON public.classroom_assessment_component_marks;
CREATE POLICY classroom_assessment_component_marks_delete
  ON public.classroom_assessment_component_marks FOR DELETE TO authenticated
  USING ((SELECT public.get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']));
