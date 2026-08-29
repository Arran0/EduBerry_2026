-- ============================================================================
-- payroll_v2_rules — versioned statutory rule sets
-- ============================================================================
-- Run after payroll_v2_structures.sql. Safe to re-run.
--
-- Compliance as data, not code. Every PF rate, ESI ceiling, PT slab, LWF amount,
-- TDS band, gratuity formula and bonus percentage lives in a row with an
-- effective date. The engine reads nothing else.
--
-- Two consequences, both deliberate:
--   • A rate change is a new version with a future effective date, published by
--     an admin. No developer, no deploy.
--   • Every run pins the rule-set ids it used. A February change cannot move
--     January's numbers, and January's payslip can still name the version that
--     produced it.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.payroll_rule_sets (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  domain         TEXT NOT NULL CHECK (domain IN ('pf', 'esi', 'pt', 'lwf', 'tds', 'gratuity', 'bonus')),
  -- 'IN' for central schemes, 'IN-TN' and friends for state ones.
  jurisdiction   TEXT NOT NULL DEFAULT 'IN',
  version        INT NOT NULL DEFAULT 1,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  rules          JSONB NOT NULL,
  -- The notification or circular this came from. Without it nobody can audit
  -- why a rate is what it is three years later.
  source_note    TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded')),
  published_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_at   TIMESTAMPTZ,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (domain, jurisdiction, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- At most one published rule set per domain and jurisdiction on any given day.
-- Overlapping rule sets would make "which rate applied in June" ambiguous, which
-- is exactly the ambiguity this whole table exists to remove.
ALTER TABLE public.payroll_rule_sets DROP CONSTRAINT IF EXISTS payroll_rule_sets_no_overlap;
ALTER TABLE public.payroll_rule_sets
  ADD CONSTRAINT payroll_rule_sets_no_overlap
  EXCLUDE USING gist (
    domain WITH =,
    jurisdiction WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  ) WHERE (status = 'published');

CREATE INDEX IF NOT EXISTS idx_payroll_rule_sets_lookup
  ON public.payroll_rule_sets(domain, jurisdiction, effective_from DESC) WHERE status = 'published';

DROP TRIGGER IF EXISTS payroll_rule_sets_updated_at ON public.payroll_rule_sets;
CREATE TRIGGER payroll_rule_sets_updated_at
  BEFORE UPDATE ON public.payroll_rule_sets
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- A published rule set is frozen. Correcting one means publishing a new version
-- with a later effective date — editing it in place would silently change what
-- past runs claim they applied.
CREATE OR REPLACE FUNCTION public.payroll_rule_sets_freeze_published()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' AND NEW.status = 'published'
     AND (NEW.rules IS DISTINCT FROM OLD.rules
          OR NEW.effective_from IS DISTINCT FROM OLD.effective_from) THEN
    RAISE EXCEPTION 'Rule set % v% is published and cannot be edited. Publish a new version with a later effective date instead.',
      OLD.domain, OLD.version;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payroll_rule_sets_freeze ON public.payroll_rule_sets;
CREATE TRIGGER payroll_rule_sets_freeze
  BEFORE UPDATE ON public.payroll_rule_sets
  FOR EACH ROW EXECUTE FUNCTION public.payroll_rule_sets_freeze_published();

-- Resolve the rule set in force for a domain on a date, preferring the most
-- specific jurisdiction. Used by the calculate route to pin a run.
CREATE OR REPLACE FUNCTION public.payroll_resolve_rule_set(
  p_domain TEXT, p_jurisdiction TEXT, p_on_date DATE
) RETURNS SETOF public.payroll_rule_sets
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.payroll_rule_sets
  WHERE domain = p_domain
    AND status = 'published'
    AND effective_from <= p_on_date
    AND (effective_to IS NULL OR effective_to >= p_on_date)
    AND jurisdiction IN (p_jurisdiction, 'IN')
  ORDER BY (jurisdiction = p_jurisdiction) DESC, effective_from DESC
  LIMIT 1;
$$;

ALTER TABLE public.payroll_rule_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manage rule sets" ON public.payroll_rule_sets;
CREATE POLICY "Admin manage rule sets" ON public.payroll_rule_sets FOR ALL
  USING (public.get_user_role() = 'admin') WITH CHECK (public.get_user_role() = 'admin');

-- A payslip cites the rule version behind every statutory figure, so published
-- sets are readable by anyone signed in. Drafts stay admin-only.
DROP POLICY IF EXISTS "Staff read published rule sets" ON public.payroll_rule_sets;
CREATE POLICY "Staff read published rule sets" ON public.payroll_rule_sets FOR SELECT
  USING (auth.uid() IS NOT NULL AND status = 'published');

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
