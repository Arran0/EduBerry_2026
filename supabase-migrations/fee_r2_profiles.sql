-- ============================================================================
-- fee_r2_profiles — a student's fee account for one session
-- ============================================================================
-- Round 2 of docs/fee-upgrade-plan.md. Run after fee_r1_settings_audit.sql.
-- Safe to re-run.
--
-- One row per student per year: which group prices them, which structure was
-- resolved, what they owed before the year started, and whether they are still
-- here. Everything in Round 2 hangs off it — invoices, payments, credits and
-- the ledger all name a profile or the student it belongs to.
--
-- Resolving the structure once, at profile creation, and storing the id is
-- deliberate. Re-resolving it every time a bill is generated would mean that
-- publishing a new structure in November silently re-prices bills already sent.

CREATE TABLE IF NOT EXISTS public.fee_profiles (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  fee_group_id     UUID REFERENCES public.fee_groups(id) ON DELETE SET NULL,
  -- The structure resolved when the profile was made. Null only when none
  -- covered the student, which the bulk screen reports rather than hiding.
  structure_id     UUID REFERENCES public.fee_structures(id) ON DELETE SET NULL,
  -- Why that structure. Stored so "why is my child charged more than her
  -- classmate?" is answerable months later without re-running the resolver
  -- against a price list that has since changed.
  structure_source JSONB,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'withdrawn', 'transferred')),
  -- Mid-year joiner: the engine charges only from this date.
  prorate_from     DATE,
  -- Carried forward on promotion. A debit on the ledger, not a silent number.
  opening_balance  NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_rte           BOOLEAN NOT NULL DEFAULT false,
  notes            TEXT,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_profiles_year    ON public.fee_profiles(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_profiles_student ON public.fee_profiles(student_id);
CREATE INDEX IF NOT EXISTS idx_fee_profiles_group   ON public.fee_profiles(fee_group_id);
CREATE INDEX IF NOT EXISTS idx_fee_profiles_active
  ON public.fee_profiles(academic_year_id) WHERE status = 'active';

DROP TRIGGER IF EXISTS fee_profiles_touch ON public.fee_profiles;
CREATE TRIGGER fee_profiles_touch BEFORE UPDATE ON public.fee_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.fee_profiles ENABLE ROW LEVEL SECURITY;

-- Staff need the profile permission. A student may always read their own,
-- which is what the fee card on their home screen is built from.
DROP POLICY IF EXISTS "Read fee profiles" ON public.fee_profiles;
CREATE POLICY "Read fee profiles" ON public.fee_profiles
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'));

DROP POLICY IF EXISTS "Manage fee profiles" ON public.fee_profiles;
CREATE POLICY "Manage fee profiles" ON public.fee_profiles
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.profile.create'))
  WITH CHECK (public.has_fee_permission('fees.profile.create'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_profiles TO authenticated;

NOTIFY pgrst, 'reload schema';
