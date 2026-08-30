-- ============================================================================
-- payroll_v2_policy — policy groups, working calendars, attendance corrections
-- ============================================================================
-- Run after payroll_v2_structures.sql. Safe to re-run.
--
-- Different cohorts of staff need different LOP rules, different leave
-- treatment and different working calendars. This mirrors, deliberately, the
-- shape the attendance module already uses for late/checkout cutoff overrides
-- (attendance_day_timings + attendance_day_timing_members, resolved by
-- `resolveLateCutoff` in src/lib/attendance.ts):
--
--   is_default = true  → the whole-school fallback
--   is_default = false → applies to the staff listed in the members table,
--                        or to whoever the `match` rules select
--   priority           → breaks ties between competing non-default groups
--
-- Only one "everyone" group may be live per kind at a time, which is what the
-- partial unique indexes enforce.

-- ── payroll_policy_groups ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_policy_groups (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  is_default     BOOLEAN NOT NULL DEFAULT false,
  priority       INT NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL DEFAULT '2000-01-01',
  effective_to   DATE,
  -- Used only when the group has no explicit members. An empty object selects
  -- nobody: selecting everybody is what is_default is for, and conflating the
  -- two makes a half-filled form silently capture the whole school.
  match          JSONB,
  policy         JSONB NOT NULL,
  notes          TEXT,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_policy_groups_one_default
  ON public.payroll_policy_groups(is_default) WHERE is_default AND effective_to IS NULL;

CREATE TABLE IF NOT EXISTS public.payroll_policy_group_members (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id    UUID NOT NULL REFERENCES public.payroll_policy_groups(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_policy_group_members_group ON public.payroll_policy_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_payroll_policy_group_members_emp   ON public.payroll_policy_group_members(employee_id);

-- ── payroll_calendars ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_calendars (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  is_default     BOOLEAN NOT NULL DEFAULT false,
  priority       INT NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL DEFAULT '2000-01-01',
  effective_to   DATE,
  match          JSONB,
  basis          TEXT NOT NULL DEFAULT 'calendar_days'
                 CHECK (basis IN ('calendar_days', 'fixed_days', 'calendar_minus_holidays', 'actual_working_days')),
  fixed_days     INT NOT NULL DEFAULT 30,
  -- Seven entries, index 0 = Sunday: 'full' | 'half' | 'off'.
  week_pattern   JSONB NOT NULL DEFAULT '["off","full","full","full","full","full","full"]'::jsonb,
  -- e.g. [{"weekday":6,"nth":[2,4],"mode":"off"}] for alternate Saturdays.
  -- nth of -1 means the last occurrence of that weekday in the month.
  nth_weekday_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_calendars_one_default
  ON public.payroll_calendars(is_default) WHERE is_default AND effective_to IS NULL;

CREATE TABLE IF NOT EXISTS public.payroll_calendar_members (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  calendar_id UUID NOT NULL REFERENCES public.payroll_calendars(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (calendar_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_calendar_members_cal ON public.payroll_calendar_members(calendar_id);
CREATE INDEX IF NOT EXISTS idx_payroll_calendar_members_emp ON public.payroll_calendar_members(employee_id);

-- ── payroll_attendance_corrections ──────────────────────────────────────
-- Attendance gets corrected late — someone was on approved duty the system did
-- not know about. A correction raised after the run is locked cannot alter it;
-- it lands on the next open run as an adjustment, and `applied_to_run_id`
-- records where the money actually moved.
CREATE TABLE IF NOT EXISTS public.payroll_attendance_corrections (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  reason       TEXT NOT NULL,
  requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at  TIMESTAMPTZ,
  applied_to_run_id UUID,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_payroll_attendance_corrections_emp ON public.payroll_attendance_corrections(employee_id, date);

-- ── Triggers ────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_policy_groups', 'payroll_calendars'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_task_updated_at()', t, t);
  END LOOP;
END$$;

-- ── RLS ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payroll_policy_groups', 'payroll_policy_group_members',
    'payroll_calendars', 'payroll_calendar_members', 'payroll_attendance_corrections'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin manage %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "Admin manage %s" ON public.%I FOR ALL USING (public.get_user_role() = ''admin'') WITH CHECK (public.get_user_role() = ''admin'')',
      t, t);
  END LOOP;
END$$;

-- A payslip names the policy group and calendar that priced it, so any signed-in
-- user has to be able to read them. Membership stays admin-only: who else is in
-- a cohort is not the employee's business.
DROP POLICY IF EXISTS "Staff read policy groups" ON public.payroll_policy_groups;
CREATE POLICY "Staff read policy groups" ON public.payroll_policy_groups FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Staff read calendars" ON public.payroll_calendars;
CREATE POLICY "Staff read calendars" ON public.payroll_calendars FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Staff read own corrections" ON public.payroll_attendance_corrections;
CREATE POLICY "Staff read own corrections" ON public.payroll_attendance_corrections FOR SELECT USING (employee_id = auth.uid());

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
