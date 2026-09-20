-- ============================================================================
-- fee_r1_config — the price list: categories, heads, groups, structures,
--                 installments, and the one-click yearly clone
-- ============================================================================
-- Round 1 of docs/fee-upgrade-plan.md. Run after fee_r1_permissions.sql.
-- Safe to re-run.
--
-- What existed before: `fee_heads`, a flat catalogue with one `default_amount`
-- for the whole school. Grade 1 tuition and Grade 12 tuition were the same
-- number, and there was no way to say "three terms, due 10 Apr, 10 Aug, 10 Dec".
--
-- The shape here is the one Indian schools actually run on:
--
--   category      an organisational folder (Academic, Facility, Transport)
--   head          a line item that gets charged (Tuition, Lab, Bus)
--   group         a cohort priced differently (Regular, RTE, Staff Ward)
--   structure     the plan for (group x grade) — which heads, how much
--   installment   when a slice of that structure becomes payable
--
-- Heads are year-scoped on purpose. "The 2026-27 price list" is then a
-- complete, self-contained thing that can be cloned, archived and reasoned
-- about without a live head silently changing what last year's bills meant.
-- Cross-year reporting joins on `code`, which is stable.

-- ── Categories (global — folders, not prices) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_categories (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  sort       INT  NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Heads (year-scoped) ─────────────────────────────────────────────────
ALTER TABLE public.fee_heads ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE CASCADE;
ALTER TABLE public.fee_heads ADD COLUMN IF NOT EXISTS category_id      UUID REFERENCES public.fee_categories(id) ON DELETE SET NULL;
ALTER TABLE public.fee_heads ADD COLUMN IF NOT EXISTS code             TEXT;
ALTER TABLE public.fee_heads ADD COLUMN IF NOT EXISTS tax_rate         NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.fee_heads ADD COLUMN IF NOT EXISTS tax_inclusive    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.fee_heads ADD COLUMN IF NOT EXISTS is_refundable    BOOLEAN NOT NULL DEFAULT false;
-- Transport is a head like any other, so a family gets one bill. Round 2's
-- bus merge sets this on the heads it brings across.
ALTER TABLE public.fee_heads ADD COLUMN IF NOT EXISTS is_transport     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.fee_heads ADD COLUMN IF NOT EXISTS sort             INT NOT NULL DEFAULT 0;

-- Existing rows (there are none in production) belong to the active year.
UPDATE public.fee_heads SET academic_year_id = public.current_academic_year_id()
 WHERE academic_year_id IS NULL;
UPDATE public.fee_heads
   SET code = upper(regexp_replace(name, '[^a-zA-Z0-9]+', '_', 'g'))
 WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_heads_year_code ON public.fee_heads(academic_year_id, code);
CREATE INDEX IF NOT EXISTS idx_fee_heads_category ON public.fee_heads(category_id);

-- ── Groups: cohorts priced differently ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_groups (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  code             TEXT NOT NULL,
  -- The group a student falls into when nobody has assigned them one.
  is_default       BOOLEAN NOT NULL DEFAULT false,
  -- RTE students are billed nothing and claimed from the state instead;
  -- bulk profile creation and invoice generation both skip them by this flag.
  is_rte           BOOLEAN NOT NULL DEFAULT false,
  description      TEXT,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (academic_year_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_groups_one_default
  ON public.fee_groups(academic_year_id) WHERE is_default;

-- ── Structures: the plan for (group x grade) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_structures (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  fee_group_id     UUID NOT NULL REFERENCES public.fee_groups(id) ON DELETE CASCADE,
  -- NULL = applies to every grade in the group. Negative grades are
  -- pre-primary (Pre-KG -3, LKG -2, UKG -1) — see src/lib/grades.ts.
  grade            SMALLINT,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'published', 'archived')),
  -- Cached sum of fee_structure_items, kept by trigger. Read-only to clients.
  total_cached     NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes            TEXT,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One structure per (group, grade). Two indexes because NULL grade does not
-- collide with itself under a plain unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_structures_group_grade
  ON public.fee_structures(fee_group_id, grade) WHERE grade IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_structures_group_allgrades
  ON public.fee_structures(fee_group_id) WHERE grade IS NULL;
CREATE INDEX IF NOT EXISTS idx_fee_structures_year ON public.fee_structures(academic_year_id);

CREATE TABLE IF NOT EXISTS public.fee_structure_items (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  structure_id UUID NOT NULL REFERENCES public.fee_structures(id) ON DELETE CASCADE,
  fee_head_id  UUID NOT NULL REFERENCES public.fee_heads(id) ON DELETE RESTRICT,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  tax_rate     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  sort         INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (structure_id, fee_head_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_structure_items_structure ON public.fee_structure_items(structure_id);
CREATE INDEX IF NOT EXISTS idx_fee_structure_items_head      ON public.fee_structure_items(fee_head_id);

-- ── Installments: when a slice becomes payable ──────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_installments (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  structure_id        UUID NOT NULL REFERENCES public.fee_structures(id) ON DELETE CASCADE,
  seq                 INT  NOT NULL,
  name                TEXT NOT NULL,
  due_date            DATE NOT NULL,
  -- Exactly one of amount / percent, or neither when the installment is
  -- defined by an explicit list of heads in fee_installment_items.
  amount              NUMERIC(12,2) CHECK (amount IS NULL OR amount >= 0),
  percent             NUMERIC(5,2)  CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
  -- Nightly automatic generation. Off by default; a school switches it on per
  -- installment and says how many days before the due date bills should appear.
  autogen_enabled     BOOLEAN NOT NULL DEFAULT false,
  autogen_days_before INT NOT NULL DEFAULT 7 CHECK (autogen_days_before >= 0),
  -- Drag order on the bill. Independent of seq so a school can reorder how
  -- lines print without renumbering the payment schedule.
  sort                INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (structure_id, seq),
  CHECK (amount IS NULL OR percent IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_fee_installments_structure ON public.fee_installments(structure_id);
CREATE INDEX IF NOT EXISTS idx_fee_installments_due       ON public.fee_installments(due_date);
CREATE INDEX IF NOT EXISTS idx_fee_installments_autogen   ON public.fee_installments(due_date) WHERE autogen_enabled;

CREATE TABLE IF NOT EXISTS public.fee_installment_items (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  installment_id UUID NOT NULL REFERENCES public.fee_installments(id) ON DELETE CASCADE,
  fee_head_id    UUID NOT NULL REFERENCES public.fee_heads(id) ON DELETE RESTRICT,
  amount         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (installment_id, fee_head_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_installment_items_inst ON public.fee_installment_items(installment_id);

-- ── Student → group, per year ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_group_assignments (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  student_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fee_group_id     UUID NOT NULL REFERENCES public.fee_groups(id) ON DELETE RESTRICT,
  is_rte           BOOLEAN NOT NULL DEFAULT false,
  -- Set for a mid-year joiner: the engine charges only from this date.
  prorate_from     DATE,
  note             TEXT,
  assigned_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_group_assignments_year  ON public.fee_group_assignments(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_group_assignments_group ON public.fee_group_assignments(fee_group_id);

-- ── Cached structure total ──────────────────────────────────────────────
-- The list screen shows a total per structure; recomputing it per render is a
-- join per row. Kept honest by trigger rather than written by the client.
CREATE OR REPLACE FUNCTION public.fee_refresh_structure_total()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_id UUID := COALESCE(NEW.structure_id, OLD.structure_id);
BEGIN
  UPDATE public.fee_structures s
     SET total_cached = COALESCE(
           (SELECT SUM(i.amount) FROM public.fee_structure_items i WHERE i.structure_id = v_id), 0)
   WHERE s.id = v_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fee_structure_items_total ON public.fee_structure_items;
CREATE TRIGGER fee_structure_items_total
  AFTER INSERT OR UPDATE OR DELETE ON public.fee_structure_items
  FOR EACH ROW EXECUTE FUNCTION public.fee_refresh_structure_total();

-- ── updated_at ──────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_categories','fee_groups','fee_structures',
                           'fee_installments','fee_group_assignments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END$$;

-- ── Yearly clone ────────────────────────────────────────────────────────
-- One button. Copies heads, groups, structures, their items and their
-- installments from one session to the next, shifting due dates by the year
-- delta. Idempotent: anything whose code already exists in the target year is
-- left alone, so a half-finished clone can simply be run again.
CREATE OR REPLACE FUNCTION public.fee_clone_year(p_from UUID, p_to UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta   INT;
  v_heads   INT := 0;
  v_groups  INT := 0;
  v_structs INT := 0;
  v_items   INT := 0;
  v_insts   INT := 0;
  v_iitems  INT := 0;
BEGIN
  IF NOT public.fee_requires('fees.config.clone_year') THEN
    RAISE EXCEPTION 'You do not have permission to clone a fee year';
  END IF;
  IF p_from = p_to THEN
    RAISE EXCEPTION 'Source and target academic year are the same';
  END IF;

  SELECT EXTRACT(YEAR FROM t.starts_on)::INT - EXTRACT(YEAR FROM f.starts_on)::INT
    INTO v_delta
    FROM public.academic_years f, public.academic_years t
   WHERE f.id = p_from AND t.id = p_to;

  IF v_delta IS NULL THEN
    RAISE EXCEPTION 'Both academic years must exist';
  END IF;

  -- Heads
  INSERT INTO public.fee_heads (academic_year_id, category_id, name, code, description,
                                default_amount, tax_rate, tax_inclusive, is_refundable,
                                is_transport, sort, active, created_by)
  SELECT p_to, h.category_id, h.name, h.code, h.description,
         h.default_amount, h.tax_rate, h.tax_inclusive, h.is_refundable,
         h.is_transport, h.sort, h.active, (SELECT auth.uid())
    FROM public.fee_heads h
   WHERE h.academic_year_id = p_from
     AND NOT EXISTS (SELECT 1 FROM public.fee_heads x
                      WHERE x.academic_year_id = p_to AND x.code = h.code);
  GET DIAGNOSTICS v_heads = ROW_COUNT;

  -- Groups
  INSERT INTO public.fee_groups (academic_year_id, name, code, is_default, is_rte,
                                 description, created_by)
  SELECT p_to, g.name, g.code, g.is_default, g.is_rte, g.description, (SELECT auth.uid())
    FROM public.fee_groups g
   WHERE g.academic_year_id = p_from
     AND NOT EXISTS (SELECT 1 FROM public.fee_groups x
                      WHERE x.academic_year_id = p_to AND x.code = g.code);
  GET DIAGNOSTICS v_groups = ROW_COUNT;

  -- Structures, matched to the target year's group by code. Cloned as drafts:
  -- a school should look at next year's prices before they are live.
  INSERT INTO public.fee_structures (academic_year_id, fee_group_id, grade, name,
                                     status, notes, created_by)
  SELECT p_to, tg.id, s.grade, s.name, 'draft', s.notes, (SELECT auth.uid())
    FROM public.fee_structures s
    JOIN public.fee_groups sg ON sg.id = s.fee_group_id
    JOIN public.fee_groups tg ON tg.academic_year_id = p_to AND tg.code = sg.code
   WHERE s.academic_year_id = p_from
     AND NOT EXISTS (
       SELECT 1 FROM public.fee_structures x
        WHERE x.fee_group_id = tg.id
          AND x.grade IS NOT DISTINCT FROM s.grade);
  GET DIAGNOSTICS v_structs = ROW_COUNT;

  -- Structure items, remapping head ids by code.
  INSERT INTO public.fee_structure_items (structure_id, fee_head_id, amount, tax_rate, sort)
  SELECT ts.id, th.id, si.amount, si.tax_rate, si.sort
    FROM public.fee_structure_items si
    JOIN public.fee_structures  ss ON ss.id = si.structure_id AND ss.academic_year_id = p_from
    JOIN public.fee_groups      sg ON sg.id = ss.fee_group_id
    JOIN public.fee_groups      tg ON tg.academic_year_id = p_to AND tg.code = sg.code
    JOIN public.fee_structures  ts ON ts.fee_group_id = tg.id
                                  AND ts.grade IS NOT DISTINCT FROM ss.grade
    JOIN public.fee_heads       sh ON sh.id = si.fee_head_id
    JOIN public.fee_heads       th ON th.academic_year_id = p_to AND th.code = sh.code
   WHERE NOT EXISTS (SELECT 1 FROM public.fee_structure_items x
                      WHERE x.structure_id = ts.id AND x.fee_head_id = th.id);
  GET DIAGNOSTICS v_items = ROW_COUNT;

  -- Installments, with due dates moved on by the year delta. Auto-generation
  -- is deliberately NOT carried over: a cloned year should not start billing
  -- by itself before anyone has checked the prices.
  INSERT INTO public.fee_installments (structure_id, seq, name, due_date, amount, percent,
                                       autogen_enabled, autogen_days_before, sort)
  SELECT ts.id, si.seq, si.name,
         (si.due_date + make_interval(years => v_delta))::DATE,
         si.amount, si.percent, false, si.autogen_days_before, si.sort
    FROM public.fee_installments si
    JOIN public.fee_structures  ss ON ss.id = si.structure_id AND ss.academic_year_id = p_from
    JOIN public.fee_groups      sg ON sg.id = ss.fee_group_id
    JOIN public.fee_groups      tg ON tg.academic_year_id = p_to AND tg.code = sg.code
    JOIN public.fee_structures  ts ON ts.fee_group_id = tg.id
                                  AND ts.grade IS NOT DISTINCT FROM ss.grade
   WHERE NOT EXISTS (SELECT 1 FROM public.fee_installments x
                      WHERE x.structure_id = ts.id AND x.seq = si.seq);
  GET DIAGNOSTICS v_insts = ROW_COUNT;

  -- Installment items, remapping both installment and head.
  INSERT INTO public.fee_installment_items (installment_id, fee_head_id, amount)
  SELECT ti.id, th.id, sii.amount
    FROM public.fee_installment_items sii
    JOIN public.fee_installments si ON si.id = sii.installment_id
    JOIN public.fee_structures   ss ON ss.id = si.structure_id AND ss.academic_year_id = p_from
    JOIN public.fee_groups       sg ON sg.id = ss.fee_group_id
    JOIN public.fee_groups       tg ON tg.academic_year_id = p_to AND tg.code = sg.code
    JOIN public.fee_structures   ts ON ts.fee_group_id = tg.id
                                   AND ts.grade IS NOT DISTINCT FROM ss.grade
    JOIN public.fee_installments ti ON ti.structure_id = ts.id AND ti.seq = si.seq
    JOIN public.fee_heads        sh ON sh.id = sii.fee_head_id
    JOIN public.fee_heads        th ON th.academic_year_id = p_to AND th.code = sh.code
   WHERE NOT EXISTS (SELECT 1 FROM public.fee_installment_items x
                      WHERE x.installment_id = ti.id AND x.fee_head_id = th.id);
  GET DIAGNOSTICS v_iitems = ROW_COUNT;

  RETURN jsonb_build_object(
    'heads', v_heads, 'groups', v_groups, 'structures', v_structs,
    'structure_items', v_items, 'installments', v_insts, 'installment_items', v_iitems,
    'year_delta', v_delta);
END $$;

-- ── Seed: a default group per year, so nothing is ever unassignable ─────
INSERT INTO public.fee_categories (name, code, sort) VALUES
  ('Academic',       'ACADEMIC',       10),
  ('Facility',       'FACILITY',       20),
  ('Transport',      'TRANSPORT',      30),
  ('Administrative', 'ADMINISTRATIVE', 40),
  ('Examination',    'EXAMINATION',    50),
  ('Other',          'OTHER',          60)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.fee_groups (academic_year_id, name, code, is_default, is_rte, description)
SELECT y.id, 'Regular', 'REGULAR', true, false,
       'Every student who has not been put in another group.'
  FROM public.academic_years y
 WHERE NOT EXISTS (SELECT 1 FROM public.fee_groups g WHERE g.academic_year_id = y.id);

INSERT INTO public.fee_groups (academic_year_id, name, code, is_default, is_rte, description)
SELECT y.id, 'RTE', 'RTE', false, true,
       'Right to Education students. Billed nothing; claimed from the state instead.'
  FROM public.academic_years y
 WHERE NOT EXISTS (SELECT 1 FROM public.fee_groups g
                    WHERE g.academic_year_id = y.id AND g.code = 'RTE');

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Reading the price list needs `fees.view`; changing it needs
-- `fees.config.manage`. Students never read these tables — Round 2 puts the
-- head name on the invoice line itself so a bill is legible without them.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_categories','fee_groups','fee_structures',
                           'fee_structure_items','fee_installments',
                           'fee_installment_items','fee_group_assignments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO authenticated
                      USING (public.has_fee_permission(''fees.view''))', t, t);

    EXECUTE format('DROP POLICY IF EXISTS "Manage %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Manage %s" ON public.%I FOR ALL TO authenticated
                      USING (public.has_fee_permission(''fees.config.manage''))
                      WITH CHECK (public.has_fee_permission(''fees.config.manage''))', t, t);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END$$;

-- fee_heads pre-dates this migration with an admin-only policy and a
-- read-for-anyone policy. Bring it onto the permission system.
DROP POLICY IF EXISTS "Admin manage fee heads"          ON public.fee_heads;
DROP POLICY IF EXISTS "Authenticated read fee heads"    ON public.fee_heads;
DROP POLICY IF EXISTS "Read fee heads"                  ON public.fee_heads;
CREATE POLICY "Read fee heads" ON public.fee_heads
  FOR SELECT TO authenticated USING (public.has_fee_permission('fees.view'));
DROP POLICY IF EXISTS "Manage fee heads" ON public.fee_heads;
CREATE POLICY "Manage fee heads" ON public.fee_heads
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.config.manage'))
  WITH CHECK (public.has_fee_permission('fees.config.manage'));

GRANT EXECUTE ON FUNCTION public.fee_clone_year(UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fee_clone_year(UUID, UUID) FROM anon;

NOTIFY pgrst, 'reload schema';
