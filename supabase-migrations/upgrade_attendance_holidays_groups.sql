-- ============================================================
-- Migration: Team-scoped holidays
--   Extends attendance_holidays (one row per date, whole-school)
--   to optionally cover only specific teachers instead of everyone,
--   mirroring the attendance_day_timings / attendance_day_timing_members
--   pattern already used for late/checkout cutoff overrides.
--
--   * is_default = true  → whole-school holiday (old behaviour)
--   * is_default = false → applies only to staff listed in
--     attendance_holiday_members for that row
--
-- Run this in the Supabase SQL Editor AFTER upgrade_staff_attendance.sql.
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.attendance_holidays
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT true;

-- The original `date DATE NOT NULL UNIQUE` only allowed one holiday per date
-- ever. Drop it — multiple team-scoped rows can now share a date, with only
-- one "everyone" (is_default) row allowed per date.
ALTER TABLE public.attendance_holidays DROP CONSTRAINT IF EXISTS attendance_holidays_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_holidays_one_default
  ON public.attendance_holidays(date) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_attendance_holidays_date_lookup ON public.attendance_holidays(date);

-- Staff explicitly covered by a non-default (team-scoped) holiday row.
CREATE TABLE IF NOT EXISTS public.attendance_holiday_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  holiday_id UUID NOT NULL REFERENCES public.attendance_holidays(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (holiday_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_holiday_members_holiday ON public.attendance_holiday_members(holiday_id);
CREATE INDEX IF NOT EXISTS idx_attendance_holiday_members_staff ON public.attendance_holiday_members(staff_id);

ALTER TABLE public.attendance_holiday_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view holiday members" ON public.attendance_holiday_members;
CREATE POLICY "Anyone can view holiday members"
  ON public.attendance_holiday_members FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin can manage holiday members" ON public.attendance_holiday_members;
CREATE POLICY "Admin can manage holiday members"
  ON public.attendance_holiday_members FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── Grant access / reload ────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
