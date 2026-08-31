-- ============================================================================
-- Non-working days — a day that is not worked and not paid, distinct from a
-- Holiday (which is a paid day off). Mirrors the attendance_holidays /
-- attendance_holiday_members pattern exactly (see
-- upgrade_attendance_holidays_groups.sql): one row per date+scope, optionally
-- split so only specific teams are covered instead of the whole school.
--
--   * is_default = true  → whole-school non-working day
--   * is_default = false → applies only to staff listed in
--     attendance_non_working_day_members for that row
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.attendance_non_working_days (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_non_working_days_one_default
  ON public.attendance_non_working_days(date) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_attendance_non_working_days_date_lookup
  ON public.attendance_non_working_days(date);

-- Staff explicitly covered by a non-default (team-scoped) row.
CREATE TABLE IF NOT EXISTS public.attendance_non_working_day_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  non_working_day_id UUID NOT NULL REFERENCES public.attendance_non_working_days(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (non_working_day_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_non_working_day_members_day ON public.attendance_non_working_day_members(non_working_day_id);
CREATE INDEX IF NOT EXISTS idx_attendance_non_working_day_members_staff ON public.attendance_non_working_day_members(staff_id);

ALTER TABLE public.attendance_non_working_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_non_working_day_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view non-working days" ON public.attendance_non_working_days;
CREATE POLICY "Anyone can view non-working days"
  ON public.attendance_non_working_days FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin can manage non-working days" ON public.attendance_non_working_days;
CREATE POLICY "Admin can manage non-working days"
  ON public.attendance_non_working_days FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Anyone can view non-working day members" ON public.attendance_non_working_day_members;
CREATE POLICY "Anyone can view non-working day members"
  ON public.attendance_non_working_day_members FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin can manage non-working day members" ON public.attendance_non_working_day_members;
CREATE POLICY "Admin can manage non-working day members"
  ON public.attendance_non_working_day_members FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── Grant access / reload ────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
