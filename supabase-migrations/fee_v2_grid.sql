-- ============================================================================
-- fee_v2_grid — terms, term/monthly heads, the grade grid, other fees, fines,
--               and issuing with a lock
-- ============================================================================
-- Replaces the structures/installments price list with the shape the office
-- actually thinks in:
--
--   term        Term 1, Term 2 … each with one due date
--   head        Tuition, Bus, Uniform … collected per term or per month,
--               optionally priced separately for boys and girls
--   grid row    a grade (Pre-KG … Grade 12), a group inside a grade that owns
--               some of its sections, or "No particular grade"
--   rate        one cell of the grid: row × head × term (or × month for a
--               monthly head) × gender when the head is split
--   other fee   a titled one-off charge (or fine) for a hand-picked set of
--               students
--   issue       turning a filtered slice of the grid (or one other fee) into
--               bills. Issued cells are locked until the issue is undone, and
--               an issue can only be undone while no money is held against it.
--
-- Bills, payments, the ledger and receipts are unchanged: an issue writes
-- ordinary fee_invoices, so the Collection Center needs nothing new.
--
-- Safe to re-run.

-- ── Heads: how often, and whether boys and girls pay differently ────────
ALTER TABLE public.fee_heads ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'term';
ALTER TABLE public.fee_heads ADD COLUMN IF NOT EXISTS gender_split BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE public.fee_heads ADD CONSTRAINT fee_heads_frequency_check
    CHECK (frequency IN ('term', 'monthly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Terms ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_terms (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  seq              INT  NOT NULL,
  due_date         DATE NOT NULL,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (academic_year_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_fee_terms_year ON public.fee_terms(academic_year_id, seq);

-- ── Groups inside a grade ───────────────────────────────────────────────
-- A grade's own row prices every section no group has claimed.
CREATE TABLE IF NOT EXISTS public.fee_grade_groups (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  grade            SMALLINT NOT NULL,
  name             TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  sections         TEXT[] NOT NULL DEFAULT '{}',
  sort             INT NOT NULL DEFAULT 0,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (academic_year_id, grade, name)
);
CREATE INDEX IF NOT EXISTS idx_fee_grade_groups_year ON public.fee_grade_groups(academic_year_id, grade);

-- A section belongs to at most one group in its grade, otherwise a student
-- would be priced twice.
CREATE OR REPLACE FUNCTION public.fee_grade_groups_no_overlap()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_clash TEXT;
BEGIN
  NEW.sections := ARRAY(SELECT DISTINCT upper(btrim(s)) FROM unnest(NEW.sections) s
                         WHERE btrim(s) <> '' ORDER BY 1);
  SELECT g.name INTO v_clash
    FROM public.fee_grade_groups g
   WHERE g.academic_year_id = NEW.academic_year_id AND g.grade = NEW.grade
     AND g.id <> NEW.id AND g.sections && NEW.sections
   LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'A section can only be in one group — "%" already has one of these sections', v_clash;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER fee_grade_groups_overlap BEFORE INSERT OR UPDATE ON public.fee_grade_groups
  FOR EACH ROW EXECUTE FUNCTION public.fee_grade_groups_no_overlap();

-- ── Rates: one cell of the grid ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_rates (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  -- NULL = the "No particular grade" row.
  grade            SMALLINT,
  -- NULL = the grade's own row.
  group_id         UUID REFERENCES public.fee_grade_groups(id) ON DELETE CASCADE,
  head_id          UUID NOT NULL REFERENCES public.fee_heads(id) ON DELETE CASCADE,
  -- NULL for a monthly head: one amount, billed every month.
  term_id          UUID REFERENCES public.fee_terms(id) ON DELETE CASCADE,
  gender           TEXT NOT NULL DEFAULT 'any' CHECK (gender IN ('any', 'male', 'female')),
  amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  updated_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_rates_cell ON public.fee_rates (
  academic_year_id, COALESCE(grade, -100),
  COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::UUID),
  head_id, COALESCE(term_id, '00000000-0000-0000-0000-000000000000'::UUID), gender);
CREATE INDEX IF NOT EXISTS idx_fee_rates_year ON public.fee_rates(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_rates_head ON public.fee_rates(head_id);

-- ── Other fees and fines ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_other_charges (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('other', 'fine')),
  title            TEXT NOT NULL CHECK (length(btrim(title)) >= 4),
  description      TEXT,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  due_date         DATE NOT NULL,
  fine_category_id UUID REFERENCES public.fee_fine_categories(id) ON DELETE SET NULL,
  -- How the students were picked, kept so the popup can show it again.
  filters          JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fee_other_charges_year ON public.fee_other_charges(academic_year_id);

CREATE TABLE IF NOT EXISTS public.fee_other_charge_students (
  charge_id  UUID NOT NULL REFERENCES public.fee_other_charges(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Snapshotted, so the grid can file the charge under the grade it was for.
  grade      SMALLINT,
  section    TEXT,
  PRIMARY KEY (charge_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_fee_other_charge_students_student ON public.fee_other_charge_students(student_id);

-- ── Issues ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_issues (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('grid', 'charge')),
  charge_id        UUID REFERENCES public.fee_other_charges(id) ON DELETE CASCADE,
  term_id          UUID REFERENCES public.fee_terms(id) ON DELETE SET NULL,
  -- First day of the month, for a monthly issue.
  bill_month       DATE,
  due_date         DATE NOT NULL,
  title            TEXT NOT NULL,
  filters          JSONB NOT NULL DEFAULT '{}'::JSONB,
  status           TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'undone')),
  student_count    INT NOT NULL DEFAULT 0,
  invoice_count    INT NOT NULL DEFAULT 0,
  total            NUMERIC(12,2) NOT NULL DEFAULT 0,
  issued_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  undone_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  undone_at        TIMESTAMPTZ,
  undo_reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_fee_issues_year ON public.fee_issues(academic_year_id, issued_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_issues_one_per_charge
  ON public.fee_issues(charge_id) WHERE charge_id IS NOT NULL AND status = 'issued';

-- The cells an issue billed. While `active`, the cell is locked.
CREATE TABLE IF NOT EXISTS public.fee_issue_cells (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_id         UUID NOT NULL REFERENCES public.fee_issues(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  grade            SMALLINT,
  group_id         UUID REFERENCES public.fee_grade_groups(id) ON DELETE CASCADE,
  head_id          UUID NOT NULL REFERENCES public.fee_heads(id) ON DELETE CASCADE,
  term_id          UUID REFERENCES public.fee_terms(id) ON DELETE CASCADE,
  bill_month       DATE,
  active           BOOLEAN NOT NULL DEFAULT true,
  CHECK ((term_id IS NULL) <> (bill_month IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_fee_issue_cells_issue ON public.fee_issue_cells(issue_id);
CREATE INDEX IF NOT EXISTS idx_fee_issue_cells_year  ON public.fee_issue_cells(academic_year_id) WHERE active;
-- A cell is never billed twice for the same period while the first is live.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_issue_cells_once_term ON public.fee_issue_cells (
  academic_year_id, COALESCE(grade, -100),
  COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::UUID),
  head_id, term_id) WHERE active AND term_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_issue_cells_once_month ON public.fee_issue_cells (
  academic_year_id, COALESCE(grade, -100),
  COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::UUID),
  head_id, bill_month) WHERE active AND bill_month IS NOT NULL;

ALTER TABLE public.fee_invoices ADD COLUMN IF NOT EXISTS issue_id UUID REFERENCES public.fee_issues(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fee_invoices_issue ON public.fee_invoices(issue_id) WHERE issue_id IS NOT NULL;

-- ── touch triggers ──────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_terms','fee_grade_groups','fee_rates','fee_other_charges'] LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER %I_touch BEFORE UPDATE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END$$;

-- ── Locks ───────────────────────────────────────────────────────────────
-- An issued cell's price cannot move under the bills it produced.
CREATE OR REPLACE FUNCTION public.fee_cell_locked(
  p_year UUID, p_grade SMALLINT, p_group UUID, p_head UUID, p_term UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.fee_issue_cells c
     WHERE c.active AND c.academic_year_id = p_year
       AND c.grade IS NOT DISTINCT FROM p_grade
       AND c.group_id IS NOT DISTINCT FROM p_group
       AND c.head_id = p_head
       AND (c.term_id = p_term OR (p_term IS NULL AND c.bill_month IS NOT NULL)))
$$;

CREATE OR REPLACE FUNCTION public.fee_rates_guard_lock()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    r := OLD;
    IF public.fee_cell_locked(r.academic_year_id, r.grade, r.group_id, r.head_id, r.term_id) THEN
      RAISE EXCEPTION 'This fee has been issued and is locked. Undo the issue to change it.';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF public.fee_cell_locked(NEW.academic_year_id, NEW.grade, NEW.group_id, NEW.head_id, NEW.term_id) THEN
      RAISE EXCEPTION 'This fee has been issued and is locked. Undo the issue to change it.';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE TRIGGER fee_rates_lock BEFORE INSERT OR UPDATE OR DELETE ON public.fee_rates
  FOR EACH ROW EXECUTE FUNCTION public.fee_rates_guard_lock();

-- A head, term or group with live bills keeps its shape.
CREATE OR REPLACE FUNCTION public.fee_v2_guard_issued_parent()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_live BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'fee_heads' THEN
    SELECT EXISTS (SELECT 1 FROM public.fee_issue_cells WHERE head_id = OLD.id AND active) INTO v_live;
    IF v_live AND (TG_OP = 'DELETE' OR NEW.frequency <> OLD.frequency OR NEW.gender_split <> OLD.gender_split) THEN
      RAISE EXCEPTION 'Fees under "%" have been issued. Undo those issues before changing or removing it.', OLD.name;
    END IF;
  ELSIF TG_TABLE_NAME = 'fee_terms' THEN
    SELECT EXISTS (SELECT 1 FROM public.fee_issue_cells WHERE term_id = OLD.id AND active) INTO v_live;
    IF v_live AND (TG_OP = 'DELETE' OR NEW.due_date <> OLD.due_date) THEN
      RAISE EXCEPTION '% has been issued. Undo those issues before changing its due date or removing it.', OLD.name;
    END IF;
  ELSIF TG_TABLE_NAME = 'fee_grade_groups' THEN
    SELECT EXISTS (SELECT 1 FROM public.fee_issue_cells WHERE group_id = OLD.id AND active) INTO v_live;
    IF v_live AND TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Fees for "%" have been issued. Undo those issues before removing the group.', OLD.name;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE TRIGGER fee_heads_v2_guard BEFORE UPDATE OR DELETE ON public.fee_heads
  FOR EACH ROW EXECUTE FUNCTION public.fee_v2_guard_issued_parent();
CREATE OR REPLACE TRIGGER fee_terms_v2_guard BEFORE UPDATE OR DELETE ON public.fee_terms
  FOR EACH ROW EXECUTE FUNCTION public.fee_v2_guard_issued_parent();
CREATE OR REPLACE TRIGGER fee_grade_groups_v2_guard BEFORE UPDATE OR DELETE ON public.fee_grade_groups
  FOR EACH ROW EXECUTE FUNCTION public.fee_v2_guard_issued_parent();

-- ── Helpers ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_norm_gender(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    WHEN lower(btrim(p)) IN ('m', 'male', 'boy', 'b') THEN 'male'
    WHEN lower(btrim(p)) IN ('f', 'female', 'girl', 'g') THEN 'female'
    ELSE NULL END
$$;

-- The students one grid row prices.
CREATE OR REPLACE FUNCTION public.fee_row_students(p_year UUID, p_grade SMALLINT, p_group UUID)
RETURNS TABLE (student_id UUID, full_name TEXT, section TEXT, gender TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, p.section, public.fee_norm_gender(d.gender)
    FROM public.profiles p
    LEFT JOIN public.student_details d ON d.student_id = p.id
   WHERE p.role = 'student'
     AND COALESCE(p.is_banned, false) = false
     AND CASE
       WHEN p_grade IS NULL THEN p.grade IS NULL
       WHEN p_group IS NOT NULL THEN p.grade = p_grade
         AND EXISTS (SELECT 1 FROM public.fee_grade_groups g
                      WHERE g.id = p_group
                        AND upper(btrim(COALESCE(p.section, ''))) = ANY (g.sections))
       ELSE p.grade = p_grade
         AND NOT EXISTS (SELECT 1 FROM public.fee_grade_groups g
                          WHERE g.academic_year_id = p_year AND g.grade = p_grade
                            AND upper(btrim(COALESCE(p.section, ''))) = ANY (g.sections))
     END
$$;

-- A student's fee account for the year, made on first billing.
CREATE OR REPLACE FUNCTION public.fee_ensure_profile(p_student UUID, p_year UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.fee_profiles WHERE student_id = p_student AND academic_year_id = p_year;
  IF v_id IS NULL THEN
    INSERT INTO public.fee_profiles (student_id, academic_year_id, created_by)
    VALUES (p_student, p_year, (SELECT auth.uid()))
    ON CONFLICT (student_id, academic_year_id) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.fee_profiles WHERE student_id = p_student AND academic_year_id = p_year;
    END IF;
  END IF;
  RETURN v_id;
END $$;

-- ── Saving cells ────────────────────────────────────────────────────────
-- p_cells: [{grade, group_id, head_id, term_id, gender, amount}] — amount null
-- or '' clears the cell.
CREATE OR REPLACE FUNCTION public.fee_set_rates(p_year UUID, p_cells JSONB)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c JSONB; v_n INT := 0;
  v_grade SMALLINT; v_group UUID; v_head UUID; v_term UUID; v_gender TEXT; v_amount NUMERIC;
  v_freq TEXT;
BEGIN
  IF NOT public.fee_requires('fees.config.manage') THEN
    RAISE EXCEPTION 'You do not have permission to edit the price list';
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(p_cells) LOOP
    v_grade  := NULLIF(c ->> 'grade', '')::SMALLINT;
    v_group  := NULLIF(c ->> 'group_id', '')::UUID;
    v_head   := (c ->> 'head_id')::UUID;
    v_term   := NULLIF(c ->> 'term_id', '')::UUID;
    v_gender := COALESCE(NULLIF(c ->> 'gender', ''), 'any');
    v_amount := NULLIF(c ->> 'amount', '')::NUMERIC;

    SELECT frequency INTO v_freq FROM public.fee_heads WHERE id = v_head AND academic_year_id = p_year;
    IF v_freq IS NULL THEN RAISE EXCEPTION 'That fee head is not in this session'; END IF;
    IF v_freq = 'monthly' THEN v_term := NULL;
    ELSIF v_term IS NULL THEN RAISE EXCEPTION 'A term-wise fee needs a term'; END IF;

    IF v_amount IS NULL THEN
      DELETE FROM public.fee_rates
       WHERE academic_year_id = p_year AND grade IS NOT DISTINCT FROM v_grade
         AND group_id IS NOT DISTINCT FROM v_group AND head_id = v_head
         AND term_id IS NOT DISTINCT FROM v_term AND gender = v_gender;
    ELSE
      IF v_amount < 0 THEN RAISE EXCEPTION 'A fee cannot be negative'; END IF;
      UPDATE public.fee_rates SET amount = v_amount, updated_by = (SELECT auth.uid())
       WHERE academic_year_id = p_year AND grade IS NOT DISTINCT FROM v_grade
         AND group_id IS NOT DISTINCT FROM v_group AND head_id = v_head
         AND term_id IS NOT DISTINCT FROM v_term AND gender = v_gender
         AND amount IS DISTINCT FROM v_amount;
      IF NOT FOUND AND NOT EXISTS (
        SELECT 1 FROM public.fee_rates
         WHERE academic_year_id = p_year AND grade IS NOT DISTINCT FROM v_grade
           AND group_id IS NOT DISTINCT FROM v_group AND head_id = v_head
           AND term_id IS NOT DISTINCT FROM v_term AND gender = v_gender) THEN
        INSERT INTO public.fee_rates (academic_year_id, grade, group_id, head_id, term_id, gender, amount, updated_by)
        VALUES (p_year, v_grade, v_group, v_head, v_term, v_gender, v_amount, (SELECT auth.uid()));
      END IF;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- ── Issuing the grid ────────────────────────────────────────────────────
-- Either a term (term-wise heads) or a month (monthly heads). p_head_ids and
-- p_rows narrow it; null means everything. p_rows: [{grade, group_id}].
-- p_commit = false runs the identical path and writes nothing.
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
    v_due := COALESCE(p_due, v_month + 9);
    v_title := to_char(v_month, 'FMMonth YYYY');
  END IF;

  -- The cells in scope: a rate exists, its head fits the period and the
  -- filter, and its row is one of the chosen rows. Held as JSONB rather than a
  -- temp table: it is a few hundred rows at most, and it keeps the function
  -- free of per-call catalog churn.
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::JSONB) INTO v_all FROM (
    SELECT r.grade, r.group_id, h.id AS head_id, h.name AS head_name, h.sort AS head_sort,
           h.gender_split,
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
       AND r.amount > 0
     GROUP BY r.grade, r.group_id, h.id, h.name, h.sort, h.gender_split) x;

  SELECT COUNT(*) FILTER (WHERE (e ->> 'already')::BOOLEAN),
         COALESCE(jsonb_agg(e) FILTER (WHERE NOT (e ->> 'already')::BOOLEAN), '[]'::JSONB)
    INTO v_already, v_live
    FROM jsonb_array_elements(v_all) e;
  v_cells := jsonb_array_length(v_live);

  IF v_cells = 0 THEN
    RETURN jsonb_build_object('committed', false, 'title', v_title, 'due_date', v_due,
      'cells', 0, 'already_issued_cells', v_already, 'students', 0, 'invoices', 0,
      'total', 0, 'no_gender', 0, 'by_row', '[]'::JSONB);
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
                       gender_split BOOLEAN, any_amt NUMERIC, male_amt NUMERIC, female_amt NUMERIC)
                     WHERE c.grade IS NOT DISTINCT FROM v_row.grade
                       AND c.group_id IS NOT DISTINCT FROM v_row.group_id
                     ORDER BY c.head_sort, c.head_name LOOP
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
    'no_gender', v_no_gender, 'by_row', v_by_row);
END $$;

-- ── Other fees and fines ────────────────────────────────────────────────
-- Create or edit (while not issued). Optionally issues straight away.
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

CREATE OR REPLACE FUNCTION public.fee_issue_charge(p_charge UUID, p_commit BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c       public.fee_other_charges%ROWTYPE;
  v_issue   UUID;
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
  IF EXISTS (SELECT 1 FROM public.fee_issues WHERE charge_id = p_charge AND status = 'issued') THEN
    RAISE EXCEPTION 'This fee has already been issued';
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.fee_other_charge_students WHERE charge_id = p_charge;

  IF NOT p_commit THEN
    RETURN jsonb_build_object('committed', false, 'students', v_n, 'total', v_n * v_c.amount);
  END IF;

  INSERT INTO public.fee_issues (academic_year_id, kind, charge_id, due_date, title, filters,
                                 issued_by, student_count, invoice_count, total)
  VALUES (v_c.academic_year_id, 'charge', p_charge, v_c.due_date, v_c.title, v_c.filters,
          (SELECT auth.uid()), v_n, v_n, v_n * v_c.amount)
  RETURNING id INTO v_issue;

  FOR v_s IN SELECT student_id FROM public.fee_other_charge_students WHERE charge_id = p_charge LOOP
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

  PERFORM public.fee_log('issue.create', 'fee_issues', v_issue, NULL, v_c.academic_year_id, NULL,
    jsonb_build_object('title', v_c.title, 'kind', v_c.kind, 'invoices', v_n), NULL, v_n * v_c.amount);

  RETURN jsonb_build_object('committed', true, 'issue_id', v_issue, 'students', v_n,
                            'invoices', v_n, 'total', v_n * v_c.amount);
END $$;

-- ── Undo ────────────────────────────────────────────────────────────────
-- Money held against an issue blocks undoing it: any payment that is pending
-- or verified and has not been refunded in full. A failed or reversed payment
-- does not count — nothing was kept.
CREATE OR REPLACE FUNCTION public.fee_issue_blockers(p_issue UUID)
RETURNS TABLE (payment_id UUID, student_id UUID, student_name TEXT, receipt_no TEXT,
               status TEXT, allocated NUMERIC, refunded NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.student_id, pr.full_name, p.receipt_no, p.status,
         SUM(a.amount),
         COALESCE((SELECT SUM(r.amount) FROM public.fee_refunds r
                    WHERE r.source_payment_id = p.id AND r.status = 'paid_out'), 0)
    FROM public.fee_invoices i
    JOIN public.fee_payment_allocations a ON a.invoice_id = i.id
    JOIN public.fee_payments p ON p.id = a.payment_id
    JOIN public.profiles pr ON pr.id = p.student_id
   WHERE i.issue_id = p_issue
     AND p.status IN ('pending', 'verified')
   GROUP BY p.id, p.student_id, pr.full_name, p.receipt_no, p.status
  HAVING COALESCE((SELECT SUM(r.amount) FROM public.fee_refunds r
                    WHERE r.source_payment_id = p.id AND r.status = 'paid_out'), 0) < SUM(a.amount)
$$;

CREATE OR REPLACE FUNCTION public.fee_undo_issue(p_issue UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_issue public.fee_issues%ROWTYPE;
  v_inv   RECORD;
  v_n     INT := 0;
BEGIN
  IF NOT public.fee_requires('fees.invoice.cancel') THEN
    RAISE EXCEPTION 'You do not have permission to undo an issue';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Say why the issue is being undone';
  END IF;

  SELECT * INTO v_issue FROM public.fee_issues WHERE id = p_issue FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such issue'; END IF;
  IF v_issue.status <> 'issued' THEN RAISE EXCEPTION 'This issue has already been undone'; END IF;

  IF EXISTS (SELECT 1 FROM public.fee_issue_blockers(p_issue)) THEN
    RAISE EXCEPTION 'Students have paid against this issue. Reverse or refund those payments first.';
  END IF;

  FOR v_inv IN SELECT id, student_id, academic_year_id, number, net FROM public.fee_invoices
                WHERE issue_id = p_issue AND status <> 'cancelled' LOOP
    UPDATE public.fee_invoices
       SET status = 'cancelled', cancelled_reason = btrim(p_reason),
           cancelled_by = (SELECT auth.uid()), cancelled_at = NOW()
     WHERE id = v_inv.id;
    IF v_inv.net > 0 THEN
      PERFORM public.fee_post_ledger(v_inv.student_id, v_inv.academic_year_id, 'adjustment', 0, v_inv.net,
        'fee_invoices', v_inv.id, format('Bill %s withdrawn — %s', v_inv.number, btrim(p_reason)));
    END IF;
    v_n := v_n + 1;
  END LOOP;

  UPDATE public.fee_fines f SET status = 'removed', waive_reason = btrim(p_reason)
    FROM public.fee_invoices i
   WHERE f.invoice_id = i.id AND i.issue_id = p_issue AND f.status = 'applied';

  UPDATE public.fee_issue_cells SET active = false WHERE issue_id = p_issue;
  UPDATE public.fee_issues
     SET status = 'undone', undone_by = (SELECT auth.uid()), undone_at = NOW(), undo_reason = btrim(p_reason)
   WHERE id = p_issue;

  PERFORM public.fee_log('issue.undo', 'fee_issues', p_issue, NULL, v_issue.academic_year_id, NULL,
    jsonb_build_object('title', v_issue.title, 'cancelled', v_n), p_reason, v_issue.total);

  RETURN jsonb_build_object('cancelled', v_n);
END $$;

-- ── Clone the grid from another session ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_clone_grid(p_from UUID, p_to UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_delta INT; v_terms INT := 0; v_heads INT := 0; v_groups INT := 0; v_rates INT := 0;
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

  INSERT INTO public.fee_heads (academic_year_id, name, code, description, default_amount, frequency,
                                gender_split, tax_rate, tax_inclusive, is_refundable, is_transport,
                                sort, active, created_by)
  SELECT p_to, h.name, h.code, h.description, h.default_amount, h.frequency, h.gender_split,
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
     -- skip a group whose sections the target grade already gives to another
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
                            'rates', v_rates, 'year_delta', v_delta);
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  -- The price list: read with fees.view, edit with fees.config.manage.
  FOREACH t IN ARRAY ARRAY['fee_terms','fee_grade_groups','fee_rates'] LOOP
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

  -- Written only through the functions above.
  FOREACH t IN ARRAY ARRAY['fee_other_charges','fee_other_charge_students','fee_issues','fee_issue_cells'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                    AND policyname = 'Read ' || t) THEN
      EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO authenticated
                        USING (public.has_fee_permission(''fees.view''))', t, t);
    END IF;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM authenticated, anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.fee_set_rates(UUID, JSONB)',
    'public.fee_issue_grid(UUID, UUID, DATE, DATE, UUID[], JSONB, BOOLEAN)',
    'public.fee_save_charge(UUID, TEXT, TEXT, NUMERIC, DATE, UUID[], JSONB, TEXT, UUID, UUID, BOOLEAN)',
    'public.fee_delete_charge(UUID)',
    'public.fee_issue_charge(UUID, BOOLEAN)',
    'public.fee_issue_blockers(UUID)',
    'public.fee_undo_issue(UUID, TEXT)',
    'public.fee_clone_grid(UUID, UUID)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  -- Internal helpers: not callable from the API.
  FOREACH f IN ARRAY ARRAY[
    'public.fee_row_students(UUID, SMALLINT, UUID)',
    'public.fee_ensure_profile(UUID, UUID)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END$$;

NOTIFY pgrst, 'reload schema';
