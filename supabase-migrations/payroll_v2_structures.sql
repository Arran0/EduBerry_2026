-- ============================================================================
-- payroll_v2_structures — salary heads, structures, effective-dated assignments
-- ============================================================================
-- Run this in the Supabase SQL Editor. Safe to re-run.
--
-- Replaces the single `staff_salary_base.base_amount` with a real structure
-- engine: a catalogue of salary heads, versioned structure templates built from
-- them, and an APPEND-ONLY assignment of an employee to a structure over a date
-- range.
--
-- The append-only part is the point. `payroll_employee_structures` rows are
-- never edited once a locked run has paid against them — a revision inserts a
-- new row and closes the previous one's effective_to. That is what makes
-- historical payroll immutable and what turns a backdated increment into
-- arrears rather than a rewrite of a payslip somebody already downloaded.
--
-- Non-overlap is enforced by the database, not by the app, using btree_gist.
-- Two assignments covering the same day would make "which salary applied on the
-- 14th" unanswerable, and no amount of application care prevents that under
-- concurrency.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Employee dimension ──────────────────────────────────────────────────
-- staff_details already holds the CBSE personnel fields. Payroll adds the few
-- it needs and nothing more, so the existing table and its RLS stay as they are.
ALTER TABLE public.staff_details
  ADD COLUMN IF NOT EXISTS employee_category  TEXT,
  ADD COLUMN IF NOT EXISTS date_of_exit       DATE,
  ADD COLUMN IF NOT EXISTS exit_reason        TEXT,
  ADD COLUMN IF NOT EXISTS notice_period_days INT,
  ADD COLUMN IF NOT EXISTS pt_jurisdiction    TEXT;

COMMENT ON COLUMN public.staff_details.employee_category IS 'teaching | non_teaching | transport | support — drives structure, policy group and calendar eligibility';
COMMENT ON COLUMN public.staff_details.date_of_exit      IS 'Last working day. Prorates the final month and unlocks full & final settlement.';
COMMENT ON COLUMN public.staff_details.pt_jurisdiction   IS 'State code for Professional Tax and LWF, e.g. IN-TN. Falls back to the school default.';

ALTER TABLE public.staff_details DROP CONSTRAINT IF EXISTS staff_details_employee_category_check;
ALTER TABLE public.staff_details
  ADD CONSTRAINT staff_details_employee_category_check
  CHECK (employee_category IS NULL OR employee_category IN ('teaching', 'non_teaching', 'transport', 'support'));

-- ── payroll_components — the salary-head catalogue ──────────────────────
-- The flags are what give a head meaning: whether PF sits on it, whether loss
-- of pay reduces it, whether a mid-month joiner has it prorated. A school can
-- add its own heads without any code change.
CREATE TABLE IF NOT EXISTS public.payroll_components (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_contribution', 'informational')),
  calc_type    TEXT NOT NULL DEFAULT 'fixed' CHECK (calc_type IN ('fixed', 'percent_of', 'formula', 'slab', 'balance')),
  percent_of   TEXT,
  formula      TEXT,
  slabs        JSONB,
  sequence     INT NOT NULL DEFAULT 100,
  rounding     TEXT NOT NULL DEFAULT 'nearest_rupee' CHECK (rounding IN ('none', 'nearest_rupee', 'up_rupee', 'down_rupee', 'nearest_paisa')),
  is_taxable            BOOLEAN NOT NULL DEFAULT true,
  counts_for_pf         BOOLEAN NOT NULL DEFAULT false,
  counts_for_esi        BOOLEAN NOT NULL DEFAULT true,
  counts_for_pt         BOOLEAN NOT NULL DEFAULT true,
  lop_applicable        BOOLEAN NOT NULL DEFAULT true,
  prorate_on_join_exit  BOOLEAN NOT NULL DEFAULT true,
  show_on_payslip       BOOLEAN NOT NULL DEFAULT true,
  is_system             BOOLEAN NOT NULL DEFAULT false,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── payroll_structures — a versioned template ───────────────────────────
-- Editing an active structure forks a new version rather than mutating it, so a
-- run that already paid against v1 can still say what v1 contained.
CREATE TABLE IF NOT EXISTS public.payroll_structures (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  employee_category TEXT,
  version           INT NOT NULL DEFAULT 1,
  supersedes_id     UUID REFERENCES public.payroll_structures(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  effective_from    DATE NOT NULL,
  effective_to      DATE,
  notes             TEXT,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (code, version)
);

CREATE TABLE IF NOT EXISTS public.payroll_structure_components (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  structure_id UUID NOT NULL REFERENCES public.payroll_structures(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES public.payroll_components(id) ON DELETE RESTRICT,
  calc_type    TEXT CHECK (calc_type IN ('fixed', 'percent_of', 'formula', 'slab', 'balance')),
  value        NUMERIC(12,2),
  formula      TEXT,
  sequence     INT,
  UNIQUE (structure_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_structure_components_structure ON public.payroll_structure_components(structure_id);

-- ── payroll_revisions — the batch header for an increment ───────────────
CREATE TABLE IF NOT EXISTS public.payroll_revisions (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  label          TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'individual' CHECK (kind IN ('individual', 'bulk_increment', 'promotion')),
  basis          TEXT NOT NULL DEFAULT 'percent' CHECK (basis IN ('percent', 'amount', 'new_structure')),
  value          NUMERIC(12,2),
  target_structure_id UUID REFERENCES public.payroll_structures(id) ON DELETE SET NULL,
  effective_from DATE NOT NULL,
  -- When earlier than effective_from's run, the difference is paid as arrears
  -- instead of rewriting the locked months.
  arrears_from   DATE,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'cancelled')),
  scope          JSONB,
  reason         TEXT,
  approved_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  applied_at     TIMESTAMPTZ,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── payroll_employee_structures — APPEND-ONLY assignment ────────────────
CREATE TABLE IF NOT EXISTS public.payroll_employee_structures (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  structure_id   UUID NOT NULL REFERENCES public.payroll_structures(id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  anchor_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  revision_id    UUID REFERENCES public.payroll_revisions(id) ON DELETE SET NULL,
  reason         TEXT,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Two assignments can never cover the same day for the same person. Enforced
-- here rather than in the app because "which salary applied on the 14th" has to
-- have exactly one answer even under concurrent writes.
ALTER TABLE public.payroll_employee_structures
  DROP CONSTRAINT IF EXISTS payroll_employee_structures_no_overlap;
ALTER TABLE public.payroll_employee_structures
  ADD CONSTRAINT payroll_employee_structures_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  );

CREATE INDEX IF NOT EXISTS idx_payroll_employee_structures_emp ON public.payroll_employee_structures(employee_id, effective_from DESC);

-- ── payroll_employee_overrides — one head, one person, effective-dated ──
CREATE TABLE IF NOT EXISTS public.payroll_employee_overrides (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  component_id   UUID NOT NULL REFERENCES public.payroll_components(id) ON DELETE CASCADE,
  calc_type      TEXT CHECK (calc_type IN ('fixed', 'percent_of', 'formula', 'slab', 'balance')),
  value          NUMERIC(12,2),
  formula        TEXT,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  reason         TEXT,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_employee_overrides_emp ON public.payroll_employee_overrides(employee_id);

-- ── Statutory identity, moved off the legacy base table ─────────────────
-- staff_salary_base carries uan / esi_ip_number / pf_applicable today. Payroll
-- v2 keeps them on their own row so the legacy table can go read-only.
CREATE TABLE IF NOT EXISTS public.payroll_employee_statutory (
  employee_id      UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pf_applicable    BOOLEAN NOT NULL DEFAULT false,
  eps_applicable   BOOLEAN NOT NULL DEFAULT true,
  pf_wage_override NUMERIC(12,2),
  esi_override     BOOLEAN,
  -- Derived from the previous run each month: whether the member was covered
  -- when the current ESI contribution period opened. Drives the continuity rule
  -- that the current app makes a human toggle by hand.
  esi_covered_at_period_start BOOLEAN,
  uan              TEXT,
  esi_ip_number    TEXT,
  pan              TEXT,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Triggers ────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_components', 'payroll_structures', 'payroll_revisions', 'payroll_employee_statutory']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_task_updated_at()', t, t);
  END LOOP;
END$$;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Admins manage everything. An employee may read their own assignment history
-- and statutory row (it is their salary) but never write either.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payroll_components', 'payroll_structures', 'payroll_structure_components',
    'payroll_revisions', 'payroll_employee_structures', 'payroll_employee_overrides',
    'payroll_employee_statutory'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin manage %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "Admin manage %s" ON public.%I FOR ALL USING (public.get_user_role() = ''admin'') WITH CHECK (public.get_user_role() = ''admin'')',
      t, t);
  END LOOP;
END$$;

-- The catalogue and structures are readable by any signed-in user: a payslip has
-- to name its heads, and the self-service salary history has to name structures.
DROP POLICY IF EXISTS "Staff read components" ON public.payroll_components;
CREATE POLICY "Staff read components" ON public.payroll_components FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Staff read structures" ON public.payroll_structures;
CREATE POLICY "Staff read structures" ON public.payroll_structures FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Staff read own assignments" ON public.payroll_employee_structures;
CREATE POLICY "Staff read own assignments" ON public.payroll_employee_structures FOR SELECT USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "Staff read own overrides" ON public.payroll_employee_overrides;
CREATE POLICY "Staff read own overrides" ON public.payroll_employee_overrides FOR SELECT USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "Staff read own statutory" ON public.payroll_employee_statutory;
CREATE POLICY "Staff read own statutory" ON public.payroll_employee_statutory FOR SELECT USING (employee_id = auth.uid());

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
