-- ============================================================================
-- payroll_v3_locations — legal entities, work locations, multi-state payroll
-- ============================================================================
-- Run after payroll_v2_tax_ff.sql. Safe to re-run.
--
-- Until now the school's state was a constant in the code
-- (DEFAULT_JURISDICTION = 'IN-TN', src/lib/payroll/hydrate.ts) and its statutory
-- registration numbers were one row in site_settings. Neither survives a second
-- office in a second state: Professional Tax and the Labour Welfare Fund are
-- levied by the state, and PF and ESI are filed per establishment.
--
-- The dimension that carries all of it is the WORK LOCATION. A location has a
-- state, and the state selects the PT and LWF rule sets; a location has its own
-- EPFO establishment id and ESIC employer code, and the monthly returns are
-- generated per location because that is how they are filed.
--
-- Resolution reuses the pattern the rest of payroll already uses (policy groups,
-- working calendars, attendance cutoffs):
--
--   explicit membership  →  match rules  →  the default location  →  nothing
--
-- Membership is effective-dated, because a transfer to another state changes
-- which state's PT applies from that month onward and must not rewrite what the
-- earlier months already filed.

-- ── payroll_legal_entities ──────────────────────────────────────────────
-- The deductor. Most schools have exactly one; a trust running two registered
-- societies has two, with two TANs, and their Form 24Q returns are separate.
CREATE TABLE IF NOT EXISTS public.payroll_legal_entities (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                TEXT NOT NULL,
  code                TEXT UNIQUE,
  pan                 TEXT,
  tan                 TEXT,
  registered_address  TEXT,
  -- The deductor details Form 24Q asks for, kept here so the filing module has
  -- one place to read them from.
  deductor_name       TEXT,
  deductor_designation TEXT,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_legal_entities_one_default
  ON public.payroll_legal_entities(is_default) WHERE is_default;

-- ── payroll_work_locations ──────────────────────────────────────────────
-- `state_code` is the whole point: it is the jurisdiction handed to the rule
-- resolver, in the same 'IN-TN' form payroll_rule_sets already uses, so a
-- location needs no translation layer to select its state's PT slab.
CREATE TABLE IF NOT EXISTS public.payroll_work_locations (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id      UUID NOT NULL REFERENCES public.payroll_legal_entities(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  code           TEXT,
  address        TEXT,
  -- ISO 3166-2:IN, e.g. 'IN-TN'. Matched against payroll_rule_sets.jurisdiction.
  state_code     TEXT NOT NULL,
  is_default     BOOLEAN NOT NULL DEFAULT false,
  priority       INT NOT NULL DEFAULT 0,
  -- Used only when the location has no explicit members, exactly as for policy
  -- groups: an empty object selects nobody.
  match          JSONB,

  -- Statutory registrations. These were single values in site_settings; they
  -- belong to an establishment, and an establishment is a location.
  epf_establishment_id TEXT,
  esi_employer_code    TEXT,
  pt_registration_no   TEXT,   -- employer's PT registration (deducts for staff)
  pt_enrolment_no      TEXT,   -- employer's own PT enrolment
  lwf_registration_no  TEXT,

  -- The account this location's salaries are funded from. C4 (bulk disbursal)
  -- reads it; nullable until then, and nullable forever for a school that pays
  -- everything from one account.
  bank_account_id UUID,

  effective_from DATE NOT NULL DEFAULT '2000-01-01',
  effective_to   DATE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  notes          TEXT,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_work_locations_one_default
  ON public.payroll_work_locations(is_default) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_payroll_work_locations_entity
  ON public.payroll_work_locations(entity_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_work_locations_state
  ON public.payroll_work_locations(state_code);

-- ── payroll_location_members ────────────────────────────────────────────
-- Effective-dated, unlike policy-group membership, because a transfer is a
-- dated event with tax consequences on both sides of it. Overlapping periods
-- for one employee are rejected outright: two live locations would mean two
-- states claiming the same month, and there is no correct answer to that.
CREATE TABLE IF NOT EXISTS public.payroll_location_members (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id    UUID NOT NULL REFERENCES public.payroll_work_locations(id) ON DELETE CASCADE,
  employee_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  reason         TEXT,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_payroll_location_members_emp
  ON public.payroll_location_members(employee_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_payroll_location_members_loc
  ON public.payroll_location_members(location_id);

-- btree_gist is already installed by payroll_v2_structures.sql for the same
-- reason: non-overlap on a daterange needs it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.payroll_location_members
  DROP CONSTRAINT IF EXISTS payroll_location_members_no_overlap;
ALTER TABLE public.payroll_location_members
  ADD CONSTRAINT payroll_location_members_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

-- ── Run and line scoping ────────────────────────────────────────────────
-- A run may cover every location or just one office; null means every one.
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS location_ids UUID[];

COMMENT ON COLUMN public.payroll_runs.location_ids IS
  'Work locations this run covers. NULL = every location.';

-- rule_set_ids changes shape here: it was {domain: id} against one implied
-- jurisdiction, which silently mislabelled a multi-state run. It becomes
-- {jurisdiction: {domain: id}} — see the note in src/lib/payroll/hydrate.ts.
COMMENT ON COLUMN public.payroll_runs.rule_set_ids IS
  'Rule sets pinned to this run, as {jurisdiction: {domain: rule_set_id}}. Central domains (PF, ESI, TDS) sit under "IN"; state domains (PT, LWF) under each state present in the run.';

-- Snapshotted at calculate time. A transfer next year must not move which
-- establishment last year's return was filed under.
ALTER TABLE public.payroll_run_lines
  ADD COLUMN IF NOT EXISTS location_id  UUID REFERENCES public.payroll_work_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entity_id    UUID REFERENCES public.payroll_legal_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS jurisdiction TEXT;

CREATE INDEX IF NOT EXISTS idx_payroll_run_lines_location
  ON public.payroll_run_lines(location_id);

COMMENT ON COLUMN public.payroll_run_lines.jurisdiction IS
  'The state whose PT/LWF rules priced this line, resolved from the work location and snapshotted.';

-- staff_details.pt_jurisdiction survives, demoted from "the answer" to "the
-- exception": an explicit per-person override for someone genuinely taxed
-- somewhere other than their office.
COMMENT ON COLUMN public.staff_details.pt_jurisdiction IS
  'Per-person override of the work location''s state for Professional Tax and LWF. Normally NULL — the location decides.';

-- ── Triggers ────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_legal_entities', 'payroll_work_locations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_task_updated_at()', t, t);
  END LOOP;
END$$;

-- ── RLS ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payroll_legal_entities', 'payroll_work_locations', 'payroll_location_members'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin manage %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "Admin manage %s" ON public.%I FOR ALL USING (public.get_user_role() = ''admin'') WITH CHECK (public.get_user_role() = ''admin'')',
      t, t);
  END LOOP;
END$$;

-- A payslip names the office that priced it and the return names the
-- establishment, so any signed-in user reads locations and entities. Who else
-- works where stays admin-only, except a person's own assignment.
DROP POLICY IF EXISTS "Staff read locations" ON public.payroll_work_locations;
CREATE POLICY "Staff read locations" ON public.payroll_work_locations
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Staff read entities" ON public.payroll_legal_entities;
CREATE POLICY "Staff read entities" ON public.payroll_legal_entities
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Staff read own location membership" ON public.payroll_location_members;
CREATE POLICY "Staff read own location membership" ON public.payroll_location_members
  FOR SELECT USING (employee_id = auth.uid());

-- ── Backfill ────────────────────────────────────────────────────────────
-- The safety property of this migration: a single-state school ends up with
-- exactly one entity and one location holding exactly the registration numbers
-- it already had, every employee assigned to it from the day they joined, and
-- not one number in any run changed.
DO $$
DECLARE
  v_entity   UUID;
  v_location UUID;
  v_cfg      JSONB;
  v_state    TEXT;
BEGIN
  SELECT value INTO v_cfg FROM public.site_settings WHERE key = 'statutory_config';

  -- 'IN-TN' was the hardcoded default in the engine; keep it unless the school
  -- has already told us otherwise in site_settings.
  SELECT COALESCE(value #>> '{}', 'IN-TN') INTO v_state
  FROM public.site_settings WHERE key = 'payroll_default_jurisdiction';
  v_state := COALESCE(v_state, 'IN-TN');

  IF NOT EXISTS (SELECT 1 FROM public.payroll_legal_entities) THEN
    INSERT INTO public.payroll_legal_entities (name, is_default, code)
    VALUES (
      COALESCE((SELECT value #>> '{}' FROM public.site_settings WHERE key = 'school_name'), 'Default entity'),
      true, 'MAIN')
    RETURNING id INTO v_entity;
  ELSE
    SELECT id INTO v_entity FROM public.payroll_legal_entities ORDER BY is_default DESC, created_at LIMIT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payroll_work_locations) THEN
    INSERT INTO public.payroll_work_locations (
      entity_id, name, code, state_code, is_default, priority,
      epf_establishment_id, esi_employer_code, effective_from
    ) VALUES (
      v_entity, 'Main campus', 'MAIN', v_state, true, 0,
      NULLIF(v_cfg ->> 'epf_establishment_id', ''),
      NULLIF(v_cfg ->> 'esi_employer_code', ''),
      '2000-01-01'
    ) RETURNING id INTO v_location;

    -- Everyone who is not already placed goes to the default location from the
    -- day they joined, or from the epoch when that is unknown.
    INSERT INTO public.payroll_location_members (location_id, employee_id, effective_from, reason)
    SELECT v_location, p.id,
           COALESCE(sd.date_of_joining, DATE '2000-01-01'),
           'Backfilled by payroll_v3_locations'
    FROM public.profiles p
    LEFT JOIN public.staff_details sd ON sd.staff_id = p.id
    WHERE p.role IN ('teacher', 'coordinator', 'principal', 'admin', 'driver')
      AND NOT EXISTS (SELECT 1 FROM public.payroll_location_members m WHERE m.employee_id = p.id);
  END IF;
END$$;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
