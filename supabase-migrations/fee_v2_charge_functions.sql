-- ============================================================================
-- fee_v2_charge_functions — saving and deleting "Other" fees and fines
-- ============================================================================
-- The two functions from fee_v2_grid.sql that could not be applied through the
-- Supabase connector (it holds any SQL containing DELETE for an approval).
-- Paste this file into the Supabase SQL editor once. Safe to re-run.
--
-- Depends on fee_issue_charge, which is already applied.

CREATE OR REPLACE FUNCTION public.fee_save_charge(
  p_year        UUID,
  p_kind        TEXT,
  p_title       TEXT,
  p_amount      NUMERIC,
  p_due         DATE,
  p_student_ids UUID[],
  p_filters     JSONB DEFAULT '{}'::JSONB,
  p_description TEXT DEFAULT NULL,
  p_category    UUID DEFAULT NULL,
  p_id          UUID DEFAULT NULL,
  p_issue       BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID := p_id; v_res JSONB;
BEGIN
  IF p_kind = 'fine' THEN
    IF NOT public.fee_requires('fees.fine.apply') THEN
      RAISE EXCEPTION 'You do not have permission to issue fines';
    END IF;
  ELSIF NOT public.fee_requires('fees.config.manage') THEN
    RAISE EXCEPTION 'You do not have permission to add fees';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) < 4 THEN
    RAISE EXCEPTION 'Give the fee a clear title — at least a few words parents will understand';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'The amount must be more than zero'; END IF;
  IF p_student_ids IS NULL OR cardinality(p_student_ids) = 0 THEN
    RAISE EXCEPTION 'Pick at least one student';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.fee_other_charges (academic_year_id, kind, title, description, amount,
                                          due_date, fine_category_id, filters, created_by)
    VALUES (p_year, COALESCE(p_kind, 'other'), btrim(p_title), NULLIF(btrim(p_description), ''),
            p_amount, p_due, p_category, COALESCE(p_filters, '{}'::JSONB), (SELECT auth.uid()))
    RETURNING id INTO v_id;
  ELSE
    IF EXISTS (SELECT 1 FROM public.fee_issues WHERE charge_id = v_id AND status = 'issued') THEN
      RAISE EXCEPTION 'This fee has been issued and is locked. Undo the issue to change it.';
    END IF;
    UPDATE public.fee_other_charges
       SET title = btrim(p_title), description = NULLIF(btrim(p_description), ''),
           amount = p_amount, due_date = p_due, fine_category_id = p_category,
           filters = COALESCE(p_filters, '{}'::JSONB)
     WHERE id = v_id AND academic_year_id = p_year;
    DELETE FROM public.fee_other_charge_students WHERE charge_id = v_id;
  END IF;

  INSERT INTO public.fee_other_charge_students (charge_id, student_id, grade, section)
  SELECT v_id, p.id, p.grade, p.section
    FROM public.profiles p
   WHERE p.id = ANY (p_student_ids) AND p.role = 'student'
  ON CONFLICT DO NOTHING;

  IF p_issue THEN
    v_res := public.fee_issue_charge(v_id, true);
  END IF;
  RETURN jsonb_build_object('id', v_id, 'issue', v_res);
END $$;

CREATE OR REPLACE FUNCTION public.fee_delete_charge(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_kind TEXT;
BEGIN
  SELECT kind INTO v_kind FROM public.fee_other_charges WHERE id = p_id;
  IF NOT public.fee_requires(CASE WHEN v_kind = 'fine' THEN 'fees.fine.apply' ELSE 'fees.config.manage' END) THEN
    RAISE EXCEPTION 'You do not have permission to remove this';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fee_issues WHERE charge_id = p_id AND status = 'issued') THEN
    RAISE EXCEPTION 'This fee has been issued. Undo the issue before removing it.';
  END IF;
  -- Undone issues keep their history; the charge row is what goes.
  UPDATE public.fee_issues SET charge_id = NULL WHERE charge_id = p_id;
  DELETE FROM public.fee_other_charges WHERE id = p_id;
END $$;

REVOKE ALL ON FUNCTION public.fee_save_charge(UUID, TEXT, TEXT, NUMERIC, DATE, UUID[], JSONB, TEXT, UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fee_delete_charge(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fee_save_charge(UUID, TEXT, TEXT, NUMERIC, DATE, UUID[], JSONB, TEXT, UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_delete_charge(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
