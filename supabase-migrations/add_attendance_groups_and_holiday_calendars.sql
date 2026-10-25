-- ============================================================
-- Migration: Attendance groups and holiday calendars
--
--   Attendance Rules is split into Staff and Student halves. Each half can
--   divide its people into groups, and keep holiday calendars (typed in, or
--   uploaded as a CSV / .ics file) for everyone or for chosen groups.
--
--   * attendance_groups          — a named group, audience 'staff' | 'student'
--   * attendance_group_members   — a staff member (staff groups) or a
--                                  homeroom (student groups) in a group
--   * attendance_holiday_calendars        — a named calendar, per audience,
--                                           with optional weekly offs
--   * attendance_holiday_calendar_groups  — the groups a calendar covers
--                                           (none = everyone)
--   * attendance_holiday_calendar_entries — one holiday, a single date or a
--                                           start..end range (a vacation)
--
--   Staff calendars feed the holiday engine staff attendance and payroll
--   already read: the app writes each calendar's days into
--   attendance_holidays (+ attendance_holiday_members for group calendars),
--   stamped with calendar_id. Deleting a calendar cascades its rows away, and
--   the existing recompute triggers re-score the days it covered. Student
--   calendars are read straight from the calendar tables.
--
-- Run this in the Supabase SQL Editor AFTER add_attendance_holiday_weekday_scope.sql
-- and attendance_retroactive_recompute.sql. Safe to re-run.
-- ============================================================

-- ── 1. Groups ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.attendance_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audience TEXT NOT NULL CHECK (audience IN ('staff', 'student')),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_groups_audience ON public.attendance_groups(audience);
CREATE INDEX IF NOT EXISTS idx_attendance_groups_created_by ON public.attendance_groups(created_by);

-- A member is a person (staff groups) or a homeroom (student groups) — a
-- student group follows its homerooms, so a student moved between classes
-- moves between groups without anyone touching the group.
CREATE TABLE IF NOT EXISTS public.attendance_group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.attendance_groups(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  homeroom_id UUID REFERENCES public.homerooms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT attendance_group_members_one_target CHECK (
    (staff_id IS NOT NULL AND homeroom_id IS NULL) OR
    (staff_id IS NULL AND homeroom_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_group_members_staff
  ON public.attendance_group_members(group_id, staff_id) WHERE staff_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_group_members_homeroom
  ON public.attendance_group_members(group_id, homeroom_id) WHERE homeroom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_group_members_staff_id ON public.attendance_group_members(staff_id);
CREATE INDEX IF NOT EXISTS idx_attendance_group_members_homeroom_id ON public.attendance_group_members(homeroom_id);

-- ── 2. Holiday calendars ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.attendance_holiday_calendars (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audience TEXT NOT NULL CHECK (audience IN ('staff', 'student')),
  name TEXT NOT NULL,
  description TEXT,
  -- Weekdays off every week under this calendar (0 = Sunday .. 6 = Saturday).
  weekly_offs SMALLINT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT attendance_holiday_calendars_weekly_offs_check
    CHECK (weekly_offs <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[])
);

CREATE INDEX IF NOT EXISTS idx_attendance_holiday_calendars_audience ON public.attendance_holiday_calendars(audience);
CREATE INDEX IF NOT EXISTS idx_attendance_holiday_calendars_created_by ON public.attendance_holiday_calendars(created_by);

CREATE TABLE IF NOT EXISTS public.attendance_holiday_calendar_groups (
  calendar_id UUID NOT NULL REFERENCES public.attendance_holiday_calendars(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.attendance_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (calendar_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_holiday_calendar_groups_group ON public.attendance_holiday_calendar_groups(group_id);

CREATE TABLE IF NOT EXISTS public.attendance_holiday_calendar_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  calendar_id UUID NOT NULL REFERENCES public.attendance_holiday_calendars(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT attendance_holiday_calendar_entries_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_holiday_calendar_entries_calendar
  ON public.attendance_holiday_calendar_entries(calendar_id);
CREATE INDEX IF NOT EXISTS idx_attendance_holiday_calendar_entries_range
  ON public.attendance_holiday_calendar_entries(start_date, end_date);

-- ── 3. Staff calendars write into attendance_holidays ────────

ALTER TABLE public.attendance_holidays
  ADD COLUMN IF NOT EXISTS calendar_id UUID REFERENCES public.attendance_holiday_calendars(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_attendance_holidays_calendar_id ON public.attendance_holidays(calendar_id);

-- One hand-made "everyone" holiday per date / weekday still holds. A
-- calendar's rows sit beside it: two calendars (or a calendar and a hand-made
-- holiday) may both say a date is off, and every reader asks only whether
-- *a* rule covers the day (EXISTS), so the overlap is harmless.
DROP INDEX IF EXISTS public.idx_attendance_holidays_one_default_date;
DROP INDEX IF EXISTS public.idx_attendance_holidays_one_default_weekday;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_holidays_one_default_date
  ON public.attendance_holidays(scope_date) WHERE is_default AND scope_type = 'date' AND calendar_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_holidays_one_default_weekday
  ON public.attendance_holidays(scope_weekday) WHERE is_default AND scope_type = 'weekday' AND calendar_id IS NULL;

-- ── 4. updated_at ────────────────────────────────────────────

DROP TRIGGER IF EXISTS attendance_groups_updated_at ON public.attendance_groups;
CREATE TRIGGER attendance_groups_updated_at
  BEFORE UPDATE ON public.attendance_groups
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

DROP TRIGGER IF EXISTS attendance_holiday_calendars_updated_at ON public.attendance_holiday_calendars;
CREATE TRIGGER attendance_holiday_calendars_updated_at
  BEFORE UPDATE ON public.attendance_holiday_calendars
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── 5. RLS: everyone signed in reads, admins write ───────────
-- Read access matches attendance_holidays: the student attendance sheet and
-- a student's own calendar need to know which days are holidays.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance_groups',
    'attendance_group_members',
    'attendance_holiday_calendars',
    'attendance_holiday_calendar_groups',
    'attendance_holiday_calendar_entries'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.get_user_role()) = ''admin'')',
      t || '_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.get_user_role()) = ''admin'') WITH CHECK ((SELECT public.get_user_role()) = ''admin'')',
      t || '_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT public.get_user_role()) = ''admin'')',
      t || '_delete', t);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
