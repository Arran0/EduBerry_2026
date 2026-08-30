-- ============================================================================
-- fees_v2_structures — the fee rule engine
-- ============================================================================
-- Run after fees_v2_ledger.sql. Safe to re-run.
--
-- Today a fee is one row per student per fee, and the amount is whatever an
-- admin typed. Class, category, sibling rank, transport zone and concessions
-- are resolved in someone's head before they reach the keyboard, so nothing
-- records WHY a student owes what they owe. A disputed bill cannot be
-- explained and a mid-year rule change means editing rows by hand.
--
-- This file makes the rule the object and the bill the output:
--
--   fee_structures + fee_structure_items   what a cohort is charged
--   fee_policy_groups                      which students are that cohort
--   fee_structure_assignments              which structure applies, and when
--   fee_concessions                        what comes off, and who approved it
--   fee_demand_runs                        the generation event, with its
--                                          inputs pinned
--
-- school_fees stays exactly where it is and keeps its meaning — it becomes the
-- GENERATED demand line, carrying gross/concession/net and a rule_trace that
-- names every rule that touched the number. `amount` still means net payable,
-- so every existing read path (fees.ts, the collection report, statements,
-- receipts) works untouched.
--
-- The shapes here are deliberately those of payroll_v2_structures.sql and
-- payroll_v2_rules.sql: effective-dated, versioned, frozen on publish,
-- non-overlap enforced by btree_gist rather than by application care. Two
-- structures covering the same day would make "which fee applied in July"
-- unanswerable, and no amount of care in the app prevents that under
-- concurrency.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── fee_heads: from a label to a real head ──────────────────────────────────
-- The flags are the point. Whether a head is refundable decides what a
-- withdrawal owes back; whether it takes concessions decides what a sibling
-- discount may touch; gl_code is what makes the Tally export a mapping rather
-- than a guess.

ALTER TABLE public.fee_heads
  ADD COLUMN IF NOT EXISTS code                TEXT,
  ADD COLUMN IF NOT EXISTS kind                TEXT NOT NULL DEFAULT 'tuition',
  ADD COLUMN IF NOT EXISTS frequency           TEXT NOT NULL DEFAULT 'one_time',
  ADD COLUMN IF NOT EXISTS sequence            INT  NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS refundable          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS concession_eligible BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gl_code             TEXT;

ALTER TABLE public.fee_heads DROP CONSTRAINT IF EXISTS fee_heads_kind_check;
ALTER TABLE public.fee_heads ADD CONSTRAINT fee_heads_kind_check
  CHECK (kind IN ('tuition', 'transport', 'exam', 'optional', 'fine', 'deposit', 'other'));

ALTER TABLE public.fee_heads DROP CONSTRAINT IF EXISTS fee_heads_frequency_check;
ALTER TABLE public.fee_heads ADD CONSTRAINT fee_heads_frequency_check
  CHECK (frequency IN ('one_time', 'monthly', 'term', 'annual'));

-- Backfill a code from the name for rows that predate this column, so formulas
-- can reference heads symbolically. Uppercased, non-alphanumerics to
-- underscores, de-duplicated with a numeric suffix.
UPDATE public.fee_heads h
SET code = c.candidate
FROM (
  SELECT id,
         upper(regexp_replace(name, '[^A-Za-z0-9]+', '_', 'g'))
           || CASE WHEN rn = 1 THEN '' ELSE '_' || rn::text END AS candidate
  FROM (
    SELECT id, name,
           row_number() OVER (
             PARTITION BY upper(regexp_replace(name, '[^A-Za-z0-9]+', '_', 'g'))
             ORDER BY created_at, id
           ) AS rn
    FROM public.fee_heads
  ) s
) c
WHERE h.id = c.id AND h.code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_fee_heads_code
  ON public.fee_heads(code) WHERE code IS NOT NULL;

COMMENT ON COLUMN public.fee_heads.code       IS 'Symbolic name a structure formula can reference, e.g. TUITION. Unique.';
COMMENT ON COLUMN public.fee_heads.refundable IS 'Whether a withdrawal or exit returns this head. Caution deposits are; tuition typically is not.';
COMMENT ON COLUMN public.fee_heads.gl_code    IS 'Ledger account in the school''s accounting package. Drives the Tally / Zoho export.';

-- ── Families ────────────────────────────────────────────────────────────────
-- A sibling discount needs to know who the siblings are, and Round 2's
-- multi-payer support needs to know who may pay for whom. Both are the same
-- fact, so it is modelled once here rather than twice later.

CREATE TABLE IF NOT EXISTS public.fee_families (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  primary_payer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  phone          TEXT,
  email          TEXT,
  -- DPDP: the school records that a parent consented to processing their
  -- child's data for fee purposes, and when. Absence is not consent.
  consent_given_at TIMESTAMPTZ,
  consent_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes          TEXT,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.fee_families ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS fee_families_updated_at ON public.fee_families;
CREATE TRIGGER fee_families_updated_at
  BEFORE UPDATE ON public.fee_families
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- Students of a family, and the adults who may pay for them. `role` separates
-- the two: a student is billed, a payer is allowed to clear the bill.
CREATE TABLE IF NOT EXISTS public.fee_family_members (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id   UUID NOT NULL REFERENCES public.fee_families(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('student', 'payer')),
  -- 1 = eldest enrolled child. Drives sibling concession slabs, which are
  -- almost always "second child 25%, third 50%".
  sibling_rank INT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (family_id, profile_id, role)
);

CREATE INDEX IF NOT EXISTS idx_fee_family_members_profile ON public.fee_family_members(profile_id);
CREATE INDEX IF NOT EXISTS idx_fee_family_members_family  ON public.fee_family_members(family_id, role);

ALTER TABLE public.fee_family_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manage fee families" ON public.fee_families;
CREATE POLICY "Admin manage fee families" ON public.fee_families FOR ALL
  USING (public.get_user_role() = 'admin') WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Member reads own family" ON public.fee_families;
CREATE POLICY "Member reads own family" ON public.fee_families FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.fee_family_members m
    WHERE m.family_id = fee_families.id AND m.profile_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admin manage fee family members" ON public.fee_family_members;
CREATE POLICY "Admin manage fee family members" ON public.fee_family_members FOR ALL
  USING (public.get_user_role() = 'admin') WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Member reads own family membership" ON public.fee_family_members;
CREATE POLICY "Member reads own family membership" ON public.fee_family_members FOR SELECT
  USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.fee_family_members me
      WHERE me.family_id = fee_family_members.family_id AND me.profile_id = auth.uid()
    )
  );

-- ── Student fee dimensions ──────────────────────────────────────────────────
-- student_details already holds the CBSE personnel fields and has its own RLS.
-- Fees add the few inputs the engine needs and nothing more.

ALTER TABLE public.student_details
  ADD COLUMN IF NOT EXISTS fee_category   TEXT,
  ADD COLUMN IF NOT EXISTS transport_zone TEXT,
  ADD COLUMN IF NOT EXISTS is_staff_ward  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS family_id      UUID REFERENCES public.fee_families(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_student_details_family ON public.student_details(family_id);

COMMENT ON COLUMN public.student_details.fee_category   IS 'Fee-bearing category: general | rte | ews | staff_ward | alumni_ward … Distinct from the CBSE social category in `category`.';
COMMENT ON COLUMN public.student_details.transport_zone IS 'Distance band or route zone. Drives the transport head''s slab.';

-- ── fee_structures — versioned, effective-dated, frozen on publish ──────────

CREATE TABLE IF NOT EXISTS public.fee_structures (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  code           TEXT,
  academic_year  TEXT NOT NULL,
  version        INT NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  effective_from DATE NOT NULL,
  effective_to   DATE,
  -- Whether a parent may pay less than the full instalment. Some schools allow
  -- it, some do not, and the parent UI must not guess.
  allow_partial  BOOLEAN NOT NULL DEFAULT true,
  -- Days after the due date before a late fee applies; NULL = no late fee.
  grace_days     INT,
  late_fee_head_id UUID REFERENCES public.fee_heads(id) ON DELETE SET NULL,
  notes          TEXT,
  published_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_at   TIMESTAMPTZ,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (academic_year, name, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_fee_structures_year
  ON public.fee_structures(academic_year, status);

DROP TRIGGER IF EXISTS fee_structures_updated_at ON public.fee_structures;
CREATE TRIGGER fee_structures_updated_at
  BEFORE UPDATE ON public.fee_structures
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- A published structure is frozen. Correcting one means publishing a new
-- version — editing it in place would silently change what already-issued
-- invoices claim they were computed from. Same rule, same reason, as
-- payroll_rule_sets_freeze_published().
CREATE OR REPLACE FUNCTION public.fee_structures_freeze_published()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' AND NEW.status = 'published'
     AND (NEW.effective_from IS DISTINCT FROM OLD.effective_from
          OR NEW.academic_year IS DISTINCT FROM OLD.academic_year) THEN
    RAISE EXCEPTION
      'Fee structure "% " v% is published and cannot be re-dated. Publish a new version instead.',
      OLD.name, OLD.version;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fee_structures_freeze ON public.fee_structures;
CREATE TRIGGER fee_structures_freeze
  BEFORE UPDATE ON public.fee_structures
  FOR EACH ROW EXECUTE FUNCTION public.fee_structures_freeze_published();

-- ── fee_structure_items — what the structure charges ────────────────────────

CREATE TABLE IF NOT EXISTS public.fee_structure_items (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  structure_id  UUID NOT NULL REFERENCES public.fee_structures(id) ON DELETE CASCADE,
  fee_head_id   UUID NOT NULL REFERENCES public.fee_heads(id) ON DELETE RESTRICT,

  calc_type     TEXT NOT NULL DEFAULT 'fixed'
                CHECK (calc_type IN ('fixed', 'percent_of', 'formula', 'slab')),
  amount        NUMERIC(10,2),
  -- Head code this is a percentage of, for calc_type = 'percent_of'.
  percent_of    TEXT,
  percent_value NUMERIC(6,3),
  -- Evaluated by src/lib/payroll/engine/expr.ts — a tiny recursive-descent
  -- grammar, deliberately not eval(), because these are authored by school
  -- admins in a web form and stored in a database.
  formula       TEXT,
  -- [{ "match": "ZONE_A", "amount": 1200 }, …] — keyed on the slab_on dimension.
  slabs         JSONB,
  slab_on       TEXT CHECK (slab_on IN ('transport_zone', 'fee_category', 'grade', 'sibling_rank')),

  -- [{ "no": 1, "label": "Term I", "due": "2026-04-10", "share": 40 }, …].
  -- share is a percentage of the item total; they must sum to 100.
  installment_plan JSONB,

  sequence      INT NOT NULL DEFAULT 100,
  -- An optional head is billed only where the student has opted in (transport,
  -- a second language lab). The demand run skips it otherwise.
  is_optional   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (structure_id, fee_head_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_structure_items_structure
  ON public.fee_structure_items(structure_id, sequence);

DROP TRIGGER IF EXISTS fee_structure_items_updated_at ON public.fee_structure_items;
CREATE TRIGGER fee_structure_items_updated_at
  BEFORE UPDATE ON public.fee_structure_items
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- Items of a published structure are frozen for the same reason the header is.
CREATE OR REPLACE FUNCTION public.fee_structure_items_freeze()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target   UUID;
  s_status TEXT;
BEGIN
  -- OLD is unassigned on INSERT and NEW on DELETE, so neither can be read
  -- unconditionally here.
  IF TG_OP = 'DELETE' THEN target := OLD.structure_id; ELSE target := NEW.structure_id; END IF;

  SELECT status INTO s_status FROM public.fee_structures WHERE id = target;
  IF s_status = 'published' THEN
    RAISE EXCEPTION
      'This fee structure is published; its items cannot be changed. Publish a new version instead.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fee_structure_items_frozen ON public.fee_structure_items;
CREATE TRIGGER fee_structure_items_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON public.fee_structure_items
  FOR EACH ROW EXECUTE FUNCTION public.fee_structure_items_freeze();

-- ── fee_policy_groups — which students a structure is for ───────────────────
-- Same shape as payroll_policy_groups, so the cohort-precedence resolver in
-- src/lib/payroll/engine/resolvePolicy.ts generalises to it rather than being
-- rewritten. Precedence, highest first: an explicit member list, then a match
-- rule, then the default group; ties break on priority then effective_from.

CREATE TABLE IF NOT EXISTS public.fee_policy_groups (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  is_default     BOOLEAN NOT NULL DEFAULT false,
  priority       INT NOT NULL DEFAULT 0,
  -- { grades: [6,7], sections: ["A"], categories: ["general"],
  --   homeroom_ids: [...], transport_zones: ["ZONE_A"] }
  match          JSONB,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Exactly one default group may be live at a time; two would make the fallback
-- ambiguous, which is the one case the resolver cannot reason its way out of.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fee_policy_groups_default
  ON public.fee_policy_groups((is_default)) WHERE is_default AND effective_to IS NULL;

DROP TRIGGER IF EXISTS fee_policy_groups_updated_at ON public.fee_policy_groups;
CREATE TRIGGER fee_policy_groups_updated_at
  BEFORE UPDATE ON public.fee_policy_groups
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE TABLE IF NOT EXISTS public.fee_policy_group_members (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id   UUID NOT NULL REFERENCES public.fee_policy_groups(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_policy_group_members_student
  ON public.fee_policy_group_members(student_id);

-- ── fee_structure_assignments — which structure applies, and when ───────────
-- Append-only and effective-dated. A revision closes the previous row's
-- effective_to and inserts a new one, so a mid-year fee change becomes a dated
-- fact rather than a rewrite of what a parent was already billed.

CREATE TABLE IF NOT EXISTS public.fee_structure_assignments (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  structure_id   UUID NOT NULL REFERENCES public.fee_structures(id) ON DELETE CASCADE,
  scope          TEXT NOT NULL CHECK (scope IN ('group', 'student')),
  group_id       UUID REFERENCES public.fee_policy_groups(id) ON DELETE CASCADE,
  student_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  -- The scope key as a single non-null column, so the exclusion constraint
  -- below can be written against it. Maintained by the trigger, never by hand.
  scope_key      UUID,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK ((scope = 'group'   AND group_id   IS NOT NULL AND student_id IS NULL)
      OR (scope = 'student' AND student_id IS NOT NULL AND group_id   IS NULL))
);

CREATE OR REPLACE FUNCTION public.fee_assignment_scope_key()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.scope_key := COALESCE(NEW.group_id, NEW.student_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fee_structure_assignments_key ON public.fee_structure_assignments;
CREATE TRIGGER fee_structure_assignments_key
  BEFORE INSERT OR UPDATE ON public.fee_structure_assignments
  FOR EACH ROW EXECUTE FUNCTION public.fee_assignment_scope_key();

-- One structure per scope target per day. Two overlapping assignments would
-- make "which structure applied on 14 July" unanswerable — exactly the
-- ambiguity this table exists to remove.
ALTER TABLE public.fee_structure_assignments
  DROP CONSTRAINT IF EXISTS fee_structure_assignments_no_overlap;
ALTER TABLE public.fee_structure_assignments
  ADD CONSTRAINT fee_structure_assignments_no_overlap
  EXCLUDE USING gist (
    scope WITH =,
    scope_key WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  );

CREATE INDEX IF NOT EXISTS idx_fee_structure_assignments_lookup
  ON public.fee_structure_assignments(scope, scope_key, effective_from DESC);

-- ── fee_concessions ─────────────────────────────────────────────────────────
-- A concession is a decision about money, so it carries who asked, who
-- approved and why. Withdrawal is a status change plus an end date — never a
-- delete, because the invoices it already reduced must stay explicable.

CREATE TABLE IF NOT EXISTS public.fee_concessions (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- NULL means every concession-eligible head.
  fee_head_id    UUID REFERENCES public.fee_heads(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('percent', 'amount', 'full')),
  value          NUMERIC(10,2) NOT NULL DEFAULT 0,
  category       TEXT NOT NULL DEFAULT 'other'
                 CHECK (category IN ('sibling', 'staff_ward', 'rte', 'ews', 'merit',
                                     'sports', 'single_girl_child', 'financial_aid', 'other')),
  reason         TEXT,
  academic_year  TEXT,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  requested_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_at   TIMESTAMPTZ DEFAULT NOW(),
  approved_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  decision_note  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (kind <> 'percent' OR (value >= 0 AND value <= 100))
);

CREATE INDEX IF NOT EXISTS idx_fee_concessions_student
  ON public.fee_concessions(student_id, status);
CREATE INDEX IF NOT EXISTS idx_fee_concessions_pending
  ON public.fee_concessions(requested_at DESC) WHERE status = 'pending';

DROP TRIGGER IF EXISTS fee_concessions_updated_at ON public.fee_concessions;
CREATE TRIGGER fee_concessions_updated_at
  BEFORE UPDATE ON public.fee_concessions
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- Maker–checker. The person who requests a discount is not the person who
-- grants it; that separation is the entire control, and it belongs in the
-- database where a compromised session cannot route around it.
CREATE OR REPLACE FUNCTION public.fee_concessions_check_approval()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'An approved concession must record who approved it.';
    END IF;
    IF NEW.approved_by = NEW.requested_by THEN
      RAISE EXCEPTION 'A concession cannot be approved by the person who requested it.';
    END IF;
  END IF;
  -- An approved concession's terms are settled. Ending it is allowed; silently
  -- changing what it was worth is not.
  IF OLD.status = 'approved' AND NEW.status = 'approved'
     AND (NEW.kind IS DISTINCT FROM OLD.kind
          OR NEW.value IS DISTINCT FROM OLD.value
          OR NEW.fee_head_id IS DISTINCT FROM OLD.fee_head_id
          OR NEW.effective_from IS DISTINCT FROM OLD.effective_from) THEN
    RAISE EXCEPTION
      'An approved concession cannot be re-priced. Revoke it and request a new one.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fee_concessions_approval ON public.fee_concessions;
CREATE TRIGGER fee_concessions_approval
  BEFORE UPDATE ON public.fee_concessions
  FOR EACH ROW EXECUTE FUNCTION public.fee_concessions_check_approval();

-- ── fee_demand_runs — the generation event ──────────────────────────────────
-- Generating a term's bills is a decision worth recording: which structures,
-- which students, computed when, published by whom. `structure_ids` is pinned
-- at calculate, so a later structure edit provably cannot have moved these
-- numbers.

CREATE TABLE IF NOT EXISTS public.fee_demand_runs (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  label          TEXT NOT NULL,
  academic_year  TEXT NOT NULL,
  -- Which instalment of the plan this run bills. NULL bills every instalment.
  installment_no INT,
  as_of_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'calculated', 'published', 'cancelled')),
  structure_ids  JSONB,
  -- Counters, so the review screen does not have to re-run the engine.
  student_count  INT NOT NULL DEFAULT 0,
  gross_total    NUMERIC(12,2) NOT NULL DEFAULT 0,
  concession_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  calculated_at  TIMESTAMPTZ,
  published_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_at   TIMESTAMPTZ,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_demand_runs_year
  ON public.fee_demand_runs(academic_year, created_at DESC);

DROP TRIGGER IF EXISTS fee_demand_runs_updated_at ON public.fee_demand_runs;
CREATE TRIGGER fee_demand_runs_updated_at
  BEFORE UPDATE ON public.fee_demand_runs
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- The preview rows a run produces before anyone commits to them. Published
-- runs turn these into school_fees; a cancelled run leaves them as the record
-- of what was proposed.
CREATE TABLE IF NOT EXISTS public.fee_demand_lines (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id            UUID NOT NULL REFERENCES public.fee_demand_runs(id) ON DELETE CASCADE,
  student_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fee_head_id       UUID REFERENCES public.fee_heads(id) ON DELETE SET NULL,
  structure_id      UUID REFERENCES public.fee_structures(id) ON DELETE SET NULL,
  structure_item_id UUID REFERENCES public.fee_structure_items(id) ON DELETE SET NULL,
  installment_no    INT,
  due_date          DATE,
  gross_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  concession_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Every number that produced this line, with the rule that produced it. This
  -- is what makes "why is my child billed ₹18,400" answerable three years on.
  rule_trace        JSONB,
  -- Set when the run is published and this line becomes a real demand row.
  school_fee_id     UUID REFERENCES public.school_fees(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_demand_lines_run     ON public.fee_demand_lines(run_id);
CREATE INDEX IF NOT EXISTS idx_fee_demand_lines_student ON public.fee_demand_lines(run_id, student_id);

-- ── school_fees becomes the generated demand line ───────────────────────────
-- `amount` keeps its meaning (net payable), so nothing that reads this table
-- today needs to change.

ALTER TABLE public.school_fees
  ADD COLUMN IF NOT EXISTS structure_id       UUID REFERENCES public.fee_structures(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS structure_item_id  UUID REFERENCES public.fee_structure_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS demand_run_id      UUID REFERENCES public.fee_demand_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS installment_no     INT,
  ADD COLUMN IF NOT EXISTS gross_amount       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS concession_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rule_trace         JSONB,
  -- Arrears carried in from a previous year keep their origin, so the ageing
  -- report can separate "owed since last year" from "owed this term".
  ADD COLUMN IF NOT EXISTS carried_from_year  TEXT;

-- A hand-issued fee has no structure and no concession; gross equals net.
UPDATE public.school_fees SET gross_amount = amount WHERE gross_amount IS NULL;

CREATE INDEX IF NOT EXISTS idx_school_fees_structure  ON public.school_fees(structure_id);
CREATE INDEX IF NOT EXISTS idx_school_fees_demand_run ON public.school_fees(demand_run_id);
CREATE INDEX IF NOT EXISTS idx_school_fees_due        ON public.school_fees(due_date) WHERE status IN ('unpaid', 'partial');

COMMENT ON COLUMN public.school_fees.amount     IS 'Net payable. Kept as the canonical amount so every existing read path is unaffected; gross_amount - concession_amount.';
COMMENT ON COLUMN public.school_fees.rule_trace IS 'The engine''s explanation of this number: structure, item, slab, and each concession applied.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Configuration is admin-only. Students read the concessions granted to them —
-- a discount a parent cannot see is a discount they cannot verify.

ALTER TABLE public.fee_structures            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_structure_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_policy_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_policy_group_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_structure_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_concessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_demand_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_demand_lines          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fee_structures', 'fee_structure_items', 'fee_policy_groups',
    'fee_policy_group_members', 'fee_structure_assignments',
    'fee_concessions', 'fee_demand_runs', 'fee_demand_lines'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admin manage %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Admin manage %1$s" ON public.%1$I FOR ALL
         USING (public.get_user_role() = ''admin'')
         WITH CHECK (public.get_user_role() = ''admin'')', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Student reads own concessions" ON public.fee_concessions;
CREATE POLICY "Student reads own concessions"
  ON public.fee_concessions FOR SELECT
  USING (student_id = auth.uid() AND status = 'approved');

-- The catalogue and published structures are readable by any signed-in user so
-- a parent can see the school's fee schedule, not just their own bill.
DROP POLICY IF EXISTS "Authenticated read published structures" ON public.fee_structures;
CREATE POLICY "Authenticated read published structures"
  ON public.fee_structures FOR SELECT
  USING (auth.uid() IS NOT NULL AND status = 'published');

DROP POLICY IF EXISTS "Authenticated read published structure items" ON public.fee_structure_items;
CREATE POLICY "Authenticated read published structure items"
  ON public.fee_structure_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.fee_structures s
    WHERE s.id = fee_structure_items.structure_id AND s.status = 'published'
  ));

-- ── Grants ──────────────────────────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
