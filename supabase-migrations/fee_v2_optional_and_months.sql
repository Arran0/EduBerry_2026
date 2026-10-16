-- ============================================================================
-- fee_v2_optional_and_months — optional fees, monthly due dates, and grades
--                              that are fully split into groups
-- ============================================================================
-- Run after fee_v2_grid.sql. Safe to re-run.
--
-- Optional fees. A head (Bus, Lunch) or an other fee (a trip) can be marked
-- optional. Optional means opt-in: the office records which students took
-- it, and issuing bills only those students. Nothing about bills, payments or
-- reports changes — an optional fee simply has a shorter list of payers.
--
-- Monthly due dates. A term carries its own due date; months now do too, so
-- issuing a month never asks for a date. Months without a row fall due on the
-- 10th.
--
-- Split grades. Once a grade has groups, every one of its sections belongs to
-- exactly one group and the grade's own row prices nobody. Issuing skips that
-- row, and reports any student whose section no group covers rather than
-- silently billing them at a price nobody can see.

-- ── Optional ────────────────────────────────────────────────────────────
ALTER TABLE public.fee_heads         ADD COLUMN IF NOT EXISTS optional BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.fee_other_charges ADD COLUMN IF NOT EXISTS optional BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.fee_optins (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  head_id          UUID REFERENCES public.fee_heads(id) ON DELETE CASCADE,
  charge_id        UUID REFERENCES public.fee_other_charges(id) ON DELETE CASCADE,
  student_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((head_id IS NULL) <> (charge_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_optins_head   ON public.fee_optins(head_id, student_id)   WHERE head_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_optins_charge ON public.fee_optins(charge_id, student_id) WHERE charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fee_optins_year ON public.fee_optins(academic_year_id);

-- ── Monthly due dates ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_months (
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  -- First day of the month.
  month            DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  due_date         DATE NOT NULL,
  updated_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (academic_year_id, month)
);

-- A month that has been issued keeps its due date: the bills already carry it.
CREATE OR REPLACE FUNCTION public.fee_months_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.fee_issue_cells c
              WHERE c.active AND c.academic_year_id = COALESCE(NEW.academic_year_id, OLD.academic_year_id)
                AND c.bill_month = COALESCE(NEW.month, OLD.month))
     AND (TG_OP = 'DELETE' OR NEW.due_date IS DISTINCT FROM OLD.due_date) THEN
    RAISE EXCEPTION 'Fees for % have been issued, so its due date is locked.', to_char(COALESCE(NEW.month, OLD.month), 'FMMonth YYYY');
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE OR REPLACE TRIGGER fee_months_lock BEFORE UPDATE OR DELETE ON public.fee_months
  FOR EACH ROW EXECUTE FUNCTION public.fee_months_guard();

-- ── RLS ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_optins','fee_months'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                    AND policyname = 'Read ' || t) THEN
      EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO authenticated
                        USING (public.has_fee_permission(''fees.view''))', t, t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                    AND policyname = 'Manage ' || t) THEN
      EXECUTE format('CREATE POLICY "Manage %s" ON public.%I FOR ALL TO authenticated
                        USING (public.has_fee_permission(''fees.config.manage''))
                        WITH CHECK (public.has_fee_permission(''fees.config.manage''))', t, t);
    END IF;
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM authenticated, anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END$$;

-- An other fee's optional flag, set through a function because the charge
-- table itself is written only by the fee functions.
CREATE OR REPLACE FUNCTION public.fee_set_charge_optional(p_charge UUID, p_optional BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fee_requires('fees.config.manage') THEN
    RAISE EXCEPTION 'You do not have permission to change this fee';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fee_issues WHERE charge_id = p_charge AND status = 'issued') THEN
    RAISE EXCEPTION 'This fee has been issued. Undo the issue to change whether it is optional.';
  END IF;
  UPDATE public.fee_other_charges SET optional = COALESCE(p_optional, false) WHERE id = p_charge AND kind = 'other';
END $$;

-- ── Issuing the grid ────────────────────────────────────────────────────
-- Changes from fee_v2_grid.sql:
--   * a month's due date comes from fee_months (else the 10th);
--   * the own row of a grade that has groups is never billed;
--   * an optional head bills only students who opted in;
--   * the summary reports students in a split grade whose section no group
--     covers, and lines left off because a student did not opt in.
CREATE OR REPLACE FUNCTION public.fee_issue_grid(
  p_year      UUID,
  p_term      UUID DEFAULT NULL,
  p_month     DATE DEFAULT NULL,
  p_due       DATE DEFAULT NULL,
  p_head_ids  UUID[] DEFAULT NULL,
  p_rows      JSONB DEFAULT NULL,
  p_commit    BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_term       public.fee_terms%ROWTYPE;
  v_month      DATE := date_trunc('month', p_month)::DATE;
  v_due        DATE;
  v_title      TEXT;
  v_issue      UUID;
  v_row        RECORD;
  v_cell       RECORD;
  v_s          RECORD;
  v_line       RECORD;
  v_amount     NUMERIC(12,2);
  v_inv_total  NUMERIC(12,2);
  v_total      NUMERIC(12,2) := 0;
  v_invoices   INT := 0;
  v_students   INT := 0;
  v_cells      INT := 0;
  v_already    INT := 0;
  v_no_gender  INT := 0;
  v_not_opted  INT := 0;
  v_unassigned INT := 0;
  v_profile    UUID;
  v_invoice    UUID;
  v_seq        BIGINT;
  v_number     TEXT;
  v_by_row     JSONB := '[]'::JSONB;
  v_row_total  NUMERIC(12,2);
  v_row_count  INT;
  v_lines      JSONB;
  v_sort       INT;
  v_all        JSONB;
  v_live       JSONB;
BEGIN
  IF NOT public.fee_requires('fees.invoice.generate') THEN
    RAISE EXCEPTION 'You do not have permission to issue fees';
  END IF;
  IF (p_term IS NULL) = (p_month IS NULL) THEN
    RAISE EXCEPTION 'Choose either a term or a month to issue';
  END IF;

  IF p_term IS NOT NULL THEN
    SELECT * INTO v_term FROM public.fee_terms WHERE id = p_term AND academic_year_id = p_year;
    IF NOT FOUND THEN RAISE EXCEPTION 'That term is not in this session'; END IF;
    v_due := COALESCE(p_due, v_term.due_date);
    v_title := v_term.name;
  ELSE
    v_due := COALESCE(p_due,
      (SELECT due_date FROM public.fee_months WHERE academic_year_id = p_year AND month = v_month),
      v_month + 9);
    v_title := to_char(v_month, 'FMMonth YYYY');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::JSONB) INTO v_all FROM (
    SELECT r.grade, r.group_id, h.id AS head_id, h.name AS head_name, h.sort AS head_sort,
           h.gender_split, h.optional,
           MAX(r.amount) FILTER (WHERE r.gender = 'any')    AS any_amt,
           MAX(r.amount) FILTER (WHERE r.gender = 'male')   AS male_amt,
           MAX(r.amount) FILTER (WHERE r.gender = 'female') AS female_amt,
           EXISTS (SELECT 1 FROM public.fee_issue_cells c
                    WHERE c.active AND c.academic_year_id = p_year
                      AND c.grade IS NOT DISTINCT FROM r.grade
                      AND c.group_id IS NOT DISTINCT FROM r.group_id
                      AND c.head_id = h.id
                      AND (CASE WHEN p_term IS NOT NULL THEN c.term_id = p_term
                                ELSE c.bill_month = v_month END)) AS already
      FROM public.fee_rates r
      JOIN public.fee_heads h ON h.id = r.head_id
     WHERE r.academic_year_id = p_year
       AND h.active
       AND (CASE WHEN p_term IS NOT NULL THEN h.frequency = 'term' AND r.term_id = p_term
                 ELSE h.frequency = 'monthly' END)
       AND (p_head_ids IS NULL OR h.id = ANY (p_head_ids))
       AND (p_rows IS NULL OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(p_rows) x
              WHERE NULLIF(x ->> 'grade', '')::SMALLINT IS NOT DISTINCT FROM r.grade
                AND NULLIF(x ->> 'group_id', '')::UUID IS NOT DISTINCT FROM r.group_id))
       -- A split grade's own row prices nobody.
       AND NOT (r.group_id IS NULL AND r.grade IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.fee_grade_groups g
              WHERE g.academic_year_id = p_year AND g.grade = r.grade))
       AND r.amount > 0
     GROUP BY r.grade, r.group_id, h.id, h.name, h.sort, h.gender_split, h.optional) x;

  SELECT COUNT(*) FILTER (WHERE (e ->> 'already')::BOOLEAN),
         COALESCE(jsonb_agg(e) FILTER (WHERE NOT (e ->> 'already')::BOOLEAN), '[]'::JSONB)
    INTO v_already, v_live
    FROM jsonb_array_elements(v_all) e;
  v_cells := jsonb_array_length(v_live);

  -- Students in a split grade whose section no group covers. They are never
  -- billed from the grid until a group takes their section.
  SELECT COUNT(*) INTO v_unassigned
    FROM public.profiles p
   WHERE p.role = 'student' AND COALESCE(p.is_banned, false) = false
     AND EXISTS (SELECT 1 FROM public.fee_grade_groups g
                  WHERE g.academic_year_id = p_year AND g.grade = p.grade)
     AND NOT EXISTS (SELECT 1 FROM public.fee_grade_groups g
                      WHERE g.academic_year_id = p_year AND g.grade = p.grade
                        AND upper(btrim(COALESCE(p.section, ''))) = ANY (g.sections))
     AND (p_rows IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(p_rows) x
            WHERE NULLIF(x ->> 'grade', '')::SMALLINT = p.grade));

  IF v_cells = 0 THEN
    RETURN jsonb_build_object('committed', false, 'title', v_title, 'due_date', v_due,
      'cells', 0, 'already_issued_cells', v_already, 'students', 0, 'invoices', 0,
      'total', 0, 'no_gender', 0, 'not_opted', 0, 'unassigned', v_unassigned, 'by_row', '[]'::JSONB);
  END IF;

  IF p_commit THEN
    INSERT INTO public.fee_issues (academic_year_id, kind, term_id, bill_month, due_date, title,
                                   filters, issued_by)
    VALUES (p_year, 'grid', p_term, CASE WHEN p_term IS NULL THEN v_month END, v_due, v_title,
            jsonb_build_object('head_ids', to_jsonb(p_head_ids), 'rows', p_rows),
            (SELECT auth.uid()))
    RETURNING id INTO v_issue;

    INSERT INTO public.fee_issue_cells (issue_id, academic_year_id, grade, group_id, head_id, term_id, bill_month)
    SELECT v_issue, p_year, c.grade, c.group_id, c.head_id, p_term,
           CASE WHEN p_term IS NULL THEN v_month END
      FROM jsonb_to_recordset(v_live) AS c(grade SMALLINT, group_id UUID, head_id UUID);
  END IF;

  FOR v_row IN SELECT DISTINCT c.grade, c.group_id
                 FROM jsonb_to_recordset(v_live) AS c(grade SMALLINT, group_id UUID)
                ORDER BY c.grade NULLS LAST LOOP
    v_row_total := 0; v_row_count := 0;
    FOR v_s IN SELECT * FROM public.fee_row_students(p_year, v_row.grade, v_row.group_id) LOOP
      v_lines := '[]'::JSONB;
      v_inv_total := 0;
      FOR v_cell IN SELECT * FROM jsonb_to_recordset(v_live) AS c(
                       grade SMALLINT, group_id UUID, head_id UUID, head_name TEXT, head_sort INT,
                       gender_split BOOLEAN, optional BOOLEAN,
                       any_amt NUMERIC, male_amt NUMERIC, female_amt NUMERIC)
                     WHERE c.grade IS NOT DISTINCT FROM v_row.grade
                       AND c.group_id IS NOT DISTINCT FROM v_row.group_id
                     ORDER BY c.head_sort, c.head_name LOOP
        IF v_cell.optional AND NOT EXISTS (
             SELECT 1 FROM public.fee_optins o
              WHERE o.head_id = v_cell.head_id AND o.student_id = v_s.student_id) THEN
          v_not_opted := v_not_opted + 1;
          CONTINUE;
        END IF;
        IF v_cell.gender_split THEN
          v_amount := CASE v_s.gender WHEN 'male' THEN v_cell.male_amt
                                      WHEN 'female' THEN v_cell.female_amt END;
          IF v_s.gender IS NULL AND COALESCE(v_cell.male_amt, v_cell.female_amt) IS NOT NULL THEN
            v_no_gender := v_no_gender + 1;
          END IF;
        ELSE
          v_amount := v_cell.any_amt;
        END IF;
        IF COALESCE(v_amount, 0) > 0 THEN
          v_lines := v_lines || jsonb_build_object('head_id', v_cell.head_id,
                       'label', v_cell.head_name, 'amount', v_amount, 'sort', v_cell.head_sort);
          v_inv_total := v_inv_total + v_amount;
        END IF;
      END LOOP;

      CONTINUE WHEN v_inv_total <= 0;
      v_students := v_students + 1;
      v_invoices := v_invoices + 1;
      v_total := v_total + v_inv_total;
      v_row_total := v_row_total + v_inv_total;
      v_row_count := v_row_count + 1;

      IF p_commit THEN
        v_profile := public.fee_ensure_profile(v_s.student_id, p_year);
        SELECT seq, formatted INTO v_seq, v_number FROM public.fee_next_number('invoice', p_year);
        INSERT INTO public.fee_invoices (profile_id, student_id, academic_year_id, issue_id,
                                         number, seq, issue_date, due_date, created_by, status)
        VALUES (v_profile, v_s.student_id, p_year, v_issue, v_number, v_seq, CURRENT_DATE, v_due,
                (SELECT auth.uid()), 'pending')
        RETURNING id INTO v_invoice;

        v_sort := 0;
        FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
          v_sort := v_sort + 1;
          INSERT INTO public.fee_invoice_lines (invoice_id, kind, fee_head_id, label, amount, sort)
          VALUES (v_invoice, 'fee', (v_line.value ->> 'head_id')::UUID,
                  (v_line.value ->> 'label') || ' — ' || v_title,
                  (v_line.value ->> 'amount')::NUMERIC, v_sort);
        END LOOP;

        PERFORM public.fee_post_ledger(v_s.student_id, p_year, 'invoice', v_inv_total, 0,
          'fee_invoices', v_invoice, format('Bill %s — %s', v_number, v_title));
      END IF;
    END LOOP;

    v_by_row := v_by_row || jsonb_build_object('grade', v_row.grade, 'group_id', v_row.group_id,
                  'students', v_row_count, 'total', v_row_total);
  END LOOP;

  IF p_commit THEN
    UPDATE public.fee_issues SET student_count = v_students, invoice_count = v_invoices, total = v_total
     WHERE id = v_issue;
    PERFORM public.fee_log('issue.create', 'fee_issues', v_issue, NULL, p_year, NULL,
      jsonb_build_object('title', v_title, 'cells', v_cells, 'invoices', v_invoices), NULL, v_total);
  END IF;

  RETURN jsonb_build_object('committed', p_commit, 'issue_id', v_issue, 'title', v_title,
    'due_date', v_due, 'cells', v_cells, 'already_issued_cells', v_already,
    'students', v_students, 'invoices', v_invoices, 'total', v_total,
    'no_gender', v_no_gender, 'not_opted', v_not_opted, 'unassigned', v_unassigned,
    'by_row', v_by_row);
END $$;

-- ── Issuing an other fee ────────────────────────────────────────────────
-- An optional other fee bills only the students who opted in. Issuing it
-- again later bills whoever has opted in since, into the same issue, so one
-- undo still withdraws the lot.
CREATE OR REPLACE FUNCTION public.fee_issue_charge(p_charge UUID, p_commit BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c       public.fee_other_charges%ROWTYPE;
  v_issue   UUID;
  v_new     BOOLEAN := false;
  v_s       RECORD;
  v_profile UUID;
  v_invoice UUID;
  v_seq     BIGINT;
  v_number  TEXT;
  v_line    UUID;
  v_fine    UUID;
  v_n       INT := 0;
BEGIN
  SELECT * INTO v_c FROM public.fee_other_charges WHERE id = p_charge;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such fee'; END IF;
  IF NOT public.fee_requires(CASE WHEN v_c.kind = 'fine' THEN 'fees.fine.apply' ELSE 'fees.invoice.generate' END) THEN
    RAISE EXCEPTION 'You do not have permission to issue this';
  END IF;

  SELECT id INTO v_issue FROM public.fee_issues WHERE charge_id = p_charge AND status = 'issued';
  IF v_issue IS NOT NULL AND NOT v_c.optional THEN
    RAISE EXCEPTION 'This fee has already been issued';
  END IF;

  -- Who is billed now: everyone picked, or for an optional fee everyone who
  -- opted in — less anyone this fee has already billed.
  SELECT COUNT(*) INTO v_n
    FROM public.fee_other_charge_students cs
   WHERE cs.charge_id = p_charge
     AND (NOT v_c.optional OR EXISTS (SELECT 1 FROM public.fee_optins o
                                       WHERE o.charge_id = p_charge AND o.student_id = cs.student_id))
     AND (v_issue IS NULL OR NOT EXISTS (SELECT 1 FROM public.fee_invoices i
                                          WHERE i.issue_id = v_issue AND i.student_id = cs.student_id
                                            AND i.status <> 'cancelled'));

  IF NOT p_commit THEN
    RETURN jsonb_build_object('committed', false, 'students', v_n, 'total', v_n * v_c.amount,
                              'top_up', v_issue IS NOT NULL);
  END IF;
  IF v_n = 0 THEN
    RAISE EXCEPTION '%', CASE WHEN v_c.optional THEN 'Nobody new has opted in to bill'
                              ELSE 'There is nobody to bill' END;
  END IF;

  IF v_issue IS NULL THEN
    INSERT INTO public.fee_issues (academic_year_id, kind, charge_id, due_date, title, filters, issued_by)
    VALUES (v_c.academic_year_id, 'charge', p_charge, v_c.due_date, v_c.title, v_c.filters, (SELECT auth.uid()))
    RETURNING id INTO v_issue;
    v_new := true;
  END IF;

  FOR v_s IN
    SELECT cs.student_id FROM public.fee_other_charge_students cs
     WHERE cs.charge_id = p_charge
       AND (NOT v_c.optional OR EXISTS (SELECT 1 FROM public.fee_optins o
                                         WHERE o.charge_id = p_charge AND o.student_id = cs.student_id))
       AND NOT EXISTS (SELECT 1 FROM public.fee_invoices i
                        WHERE i.issue_id = v_issue AND i.student_id = cs.student_id AND i.status <> 'cancelled')
  LOOP
    v_profile := public.fee_ensure_profile(v_s.student_id, v_c.academic_year_id);
    SELECT seq, formatted INTO v_seq, v_number FROM public.fee_next_number('invoice', v_c.academic_year_id);
    INSERT INTO public.fee_invoices (profile_id, student_id, academic_year_id, issue_id,
                                     number, seq, issue_date, due_date, created_by, status)
    VALUES (v_profile, v_s.student_id, v_c.academic_year_id, v_issue, v_number, v_seq,
            CURRENT_DATE, v_c.due_date, (SELECT auth.uid()), 'pending')
    RETURNING id INTO v_invoice;

    INSERT INTO public.fee_invoice_lines (invoice_id, kind, label, amount, note, sort)
    VALUES (v_invoice, CASE WHEN v_c.kind = 'fine' THEN 'fine' ELSE 'fee' END,
            CASE WHEN v_c.kind = 'fine' THEN 'Fine — ' ELSE 'Other — ' END || v_c.title,
            v_c.amount, v_c.description, 1)
    RETURNING id INTO v_line;

    IF v_c.kind = 'fine' THEN
      INSERT INTO public.fee_fines (student_id, academic_year_id, category_id, invoice_id, line_id,
                                    amount, reason, applied_by)
      VALUES (v_s.student_id, v_c.academic_year_id, v_c.fine_category_id, v_invoice, v_line,
              v_c.amount, v_c.title, (SELECT auth.uid()))
      RETURNING id INTO v_fine;
      UPDATE public.fee_invoice_lines SET source_id = v_fine WHERE id = v_line;
    END IF;

    PERFORM public.fee_post_ledger(v_s.student_id, v_c.academic_year_id, 'invoice', v_c.amount, 0,
      'fee_invoices', v_invoice, format('Bill %s — %s', v_number, v_c.title));
  END LOOP;

  UPDATE public.fee_issues i
     SET invoice_count = x.n, student_count = x.n, total = x.t
    FROM (SELECT COUNT(*) AS n, COALESCE(SUM(net), 0) AS t FROM public.fee_invoices
           WHERE issue_id = v_issue AND status <> 'cancelled') x
   WHERE i.id = v_issue;

  PERFORM public.fee_log(CASE WHEN v_new THEN 'issue.create' ELSE 'issue.top_up' END,
    'fee_issues', v_issue, NULL, v_c.academic_year_id, NULL,
    jsonb_build_object('title', v_c.title, 'kind', v_c.kind, 'invoices', v_n), NULL, v_n * v_c.amount);

  RETURN jsonb_build_object('committed', true, 'issue_id', v_issue, 'students', v_n,
                            'invoices', v_n, 'total', v_n * v_c.amount, 'top_up', NOT v_new);
END $$;

-- ── Clone, now with optional flags and month due dates ──────────────────
CREATE OR REPLACE FUNCTION public.fee_clone_grid(p_from UUID, p_to UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_delta INT; v_terms INT := 0; v_heads INT := 0; v_groups INT := 0; v_rates INT := 0; v_months INT := 0;
BEGIN
  IF NOT public.fee_requires('fees.config.clone_year') THEN
    RAISE EXCEPTION 'You do not have permission to copy a fee year';
  END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'Pick a different session to copy from'; END IF;

  SELECT EXTRACT(YEAR FROM t.starts_on)::INT - EXTRACT(YEAR FROM f.starts_on)::INT INTO v_delta
    FROM public.academic_years f, public.academic_years t WHERE f.id = p_from AND t.id = p_to;
  IF v_delta IS NULL THEN RAISE EXCEPTION 'Both sessions must exist'; END IF;

  INSERT INTO public.fee_terms (academic_year_id, name, seq, due_date, created_by)
  SELECT p_to, t.name, t.seq, (t.due_date + make_interval(years => v_delta))::DATE, (SELECT auth.uid())
    FROM public.fee_terms t
   WHERE t.academic_year_id = p_from
     AND NOT EXISTS (SELECT 1 FROM public.fee_terms x WHERE x.academic_year_id = p_to AND x.seq = t.seq);
  GET DIAGNOSTICS v_terms = ROW_COUNT;

  INSERT INTO public.fee_months (academic_year_id, month, due_date, updated_by)
  SELECT p_to, (m.month + make_interval(years => v_delta))::DATE,
         (m.due_date + make_interval(years => v_delta))::DATE, (SELECT auth.uid())
    FROM public.fee_months m
   WHERE m.academic_year_id = p_from
  ON CONFLICT (academic_year_id, month) DO NOTHING;
  GET DIAGNOSTICS v_months = ROW_COUNT;

  INSERT INTO public.fee_heads (academic_year_id, name, code, description, default_amount, frequency,
                                gender_split, optional, tax_rate, tax_inclusive, is_refundable, is_transport,
                                sort, active, created_by)
  SELECT p_to, h.name, h.code, h.description, h.default_amount, h.frequency, h.gender_split, h.optional,
         h.tax_rate, h.tax_inclusive, h.is_refundable, h.is_transport, h.sort, h.active, (SELECT auth.uid())
    FROM public.fee_heads h
   WHERE h.academic_year_id = p_from
     AND NOT EXISTS (SELECT 1 FROM public.fee_heads x WHERE x.academic_year_id = p_to AND x.code = h.code);
  GET DIAGNOSTICS v_heads = ROW_COUNT;

  INSERT INTO public.fee_grade_groups (academic_year_id, grade, name, sections, sort, created_by)
  SELECT p_to, g.grade, g.name, g.sections, g.sort, (SELECT auth.uid())
    FROM public.fee_grade_groups g
   WHERE g.academic_year_id = p_from
     AND NOT EXISTS (SELECT 1 FROM public.fee_grade_groups x
                      WHERE x.academic_year_id = p_to AND x.grade = g.grade AND x.name = g.name)
     AND NOT EXISTS (SELECT 1 FROM public.fee_grade_groups x
                      WHERE x.academic_year_id = p_to AND x.grade = g.grade AND x.sections && g.sections);
  GET DIAGNOSTICS v_groups = ROW_COUNT;

  INSERT INTO public.fee_rates (academic_year_id, grade, group_id, head_id, term_id, gender, amount, updated_by)
  SELECT p_to, r.grade, tg.id, th.id, tt.id, r.gender, r.amount, (SELECT auth.uid())
    FROM public.fee_rates r
    JOIN public.fee_heads sh ON sh.id = r.head_id
    JOIN public.fee_heads th ON th.academic_year_id = p_to AND th.code = sh.code
    LEFT JOIN public.fee_terms st ON st.id = r.term_id
    LEFT JOIN public.fee_terms tt ON tt.academic_year_id = p_to AND tt.seq = st.seq
    LEFT JOIN public.fee_grade_groups sg ON sg.id = r.group_id
    LEFT JOIN public.fee_grade_groups tg ON tg.academic_year_id = p_to AND tg.grade = sg.grade AND tg.name = sg.name
   WHERE r.academic_year_id = p_from
     AND (r.term_id IS NULL OR tt.id IS NOT NULL)
     AND (r.group_id IS NULL OR tg.id IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM public.fee_rates x
        WHERE x.academic_year_id = p_to AND x.grade IS NOT DISTINCT FROM r.grade
          AND x.group_id IS NOT DISTINCT FROM tg.id AND x.head_id = th.id
          AND x.term_id IS NOT DISTINCT FROM tt.id AND x.gender = r.gender);
  GET DIAGNOSTICS v_rates = ROW_COUNT;

  RETURN jsonb_build_object('terms', v_terms, 'heads', v_heads, 'groups', v_groups,
                            'rates', v_rates, 'months', v_months, 'year_delta', v_delta);
END $$;

REVOKE ALL ON FUNCTION public.fee_set_charge_optional(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fee_set_charge_optional(UUID, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.fee_months_guard() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
