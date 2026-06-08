-- ============================================================
-- Migration: Staff Attendance Upgrade
--   * Per-staff geofence exemption (profiles.geofence_exempt)
--   * Holidays table (attendance_holidays)
--   * Attendance config (late cutoff) lives in site_settings → key 'attendance_config'
--   * Staff can edit their OWN attendance record
--   * Coordinators can view attendance of staff in their team(s)
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── 1. Geofence exemption flag on profiles ───────────────────
-- When true, the staff member may check in even when located
-- outside the configured school geofence.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS geofence_exempt BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Holidays ──────────────────────────────────────────────
-- Admin-declared non-working days. On these days staff are not
-- expected to check in and are not auto-marked absent.

CREATE TABLE IF NOT EXISTS public.attendance_holidays (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.attendance_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view holidays" ON public.attendance_holidays;
CREATE POLICY "Anyone can view holidays"
  ON public.attendance_holidays FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin can manage holidays" ON public.attendance_holidays;
CREATE POLICY "Admin can manage holidays"
  ON public.attendance_holidays FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_attendance_holidays_date ON public.attendance_holidays(date);

-- ── 3. Staff can edit their own attendance record ────────────
-- Lets staff switch present → half_day / wfh / late etc. and
-- correct mistakes on their own entries.

DROP POLICY IF EXISTS "Staff can update own attendance" ON public.staff_attendance_records;
CREATE POLICY "Staff can update own attendance"
  ON public.staff_attendance_records FOR UPDATE
  USING (staff_id = auth.uid())
  WITH CHECK (staff_id = auth.uid());

-- ── 4. Coordinators can view team staff attendance ───────────
-- A coordinator may read attendance for any staff member who
-- shares at least one team with them.

DROP POLICY IF EXISTS "Coordinators can view team staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Coordinators can view team staff attendance"
  ON public.staff_attendance_records FOR SELECT
  USING (
    public.get_user_role() = 'coordinator'
    AND EXISTS (
      SELECT 1
      FROM public.team_members tm_self
      JOIN public.team_members tm_target ON tm_self.team_id = tm_target.team_id
      WHERE tm_self.user_id = auth.uid()
        AND tm_target.user_id = staff_attendance_records.staff_id
    )
  );

-- ── Grant access / reload ────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
