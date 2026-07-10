-- ============================================================
-- Migration: Custom entry/exit timing for specific attendance dates
--   * Admin can set an override entry/exit time for a date, applied
--     to everyone (the "default" row for that date).
--   * Admin can also define separate timing groups for the same date,
--     each with its own entry/exit time and an explicit staff list
--     (built via team filters in the UI; contradictions between
--     overlapping teams are resolved manually before saving, so no
--     staff member ends up in two non-default groups for one date).
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_day_timings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  label TEXT NOT NULL DEFAULT 'Default',
  is_default BOOLEAN NOT NULL DEFAULT false,
  entry_time TIME NOT NULL,
  exit_time TIME NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one whole-day default timing row per date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_day_timings_one_default
  ON public.attendance_day_timings(date) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_attendance_day_timings_date ON public.attendance_day_timings(date);

ALTER TABLE public.attendance_day_timings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view day timings" ON public.attendance_day_timings;
CREATE POLICY "Anyone can view day timings"
  ON public.attendance_day_timings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin can manage day timings" ON public.attendance_day_timings;
CREATE POLICY "Admin can manage day timings"
  ON public.attendance_day_timings FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- Staff explicitly assigned to a non-default timing group for that date.
CREATE TABLE IF NOT EXISTS public.attendance_day_timing_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timing_id UUID NOT NULL REFERENCES public.attendance_day_timings(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (timing_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_day_timing_members_timing ON public.attendance_day_timing_members(timing_id);
CREATE INDEX IF NOT EXISTS idx_attendance_day_timing_members_staff ON public.attendance_day_timing_members(staff_id);

ALTER TABLE public.attendance_day_timing_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view day timing members" ON public.attendance_day_timing_members;
CREATE POLICY "Anyone can view day timing members"
  ON public.attendance_day_timing_members FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin can manage day timing members" ON public.attendance_day_timing_members;
CREATE POLICY "Admin can manage day timing members"
  ON public.attendance_day_timing_members FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── Grant access / reload ────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
