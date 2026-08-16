-- ============================================================
-- Migration: Geofence zones (per-group centre points)
--   * The school-wide centre point stays in site_settings →
--     'geofence' (lat / lng / radius_m + the master enable switch)
--     and remains the default for every staff member.
--   * Admin can also define zones — a named centre point with its
--     own radius, applied to an explicit staff list (built via team
--     filters in the UI, mirroring attendance_day_timings). Staff in
--     a zone are checked against that zone's centre instead of the
--     school-wide one.
--   * Contradictions (one teacher pulled in by two overlapping team
--     selections) are resolved in the UI before saving, and the
--     unique index on staff_id below makes that a hard guarantee —
--     a staff member can belong to at most one zone, so the centre
--     point that applies to them is never ambiguous.
--   * There is no per-zone "everyone" row: unlike day timings (which
--     are scoped per date/weekday) a zone has no scope dimension, so
--     the school-wide site_settings centre already is the default.
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_geofence_zones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL DEFAULT 'Zone',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 200,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.attendance_geofence_zones ENABLE ROW LEVEL SECURITY;

-- Every staff member needs to read the zone that applies to them at check-in time.
DROP POLICY IF EXISTS "Anyone can view geofence zones" ON public.attendance_geofence_zones;
CREATE POLICY "Anyone can view geofence zones"
  ON public.attendance_geofence_zones FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin can manage geofence zones" ON public.attendance_geofence_zones;
CREATE POLICY "Admin can manage geofence zones"
  ON public.attendance_geofence_zones FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- Staff assigned to a zone's centre point.
CREATE TABLE IF NOT EXISTS public.attendance_geofence_zone_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  zone_id UUID NOT NULL REFERENCES public.attendance_geofence_zones(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (zone_id, staff_id)
);

-- One zone per staff member — the DB-level contradiction guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_geofence_zone_members_one_zone
  ON public.attendance_geofence_zone_members(staff_id);

CREATE INDEX IF NOT EXISTS idx_attendance_geofence_zone_members_zone
  ON public.attendance_geofence_zone_members(zone_id);

ALTER TABLE public.attendance_geofence_zone_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view geofence zone members" ON public.attendance_geofence_zone_members;
CREATE POLICY "Anyone can view geofence zone members"
  ON public.attendance_geofence_zone_members FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin can manage geofence zone members" ON public.attendance_geofence_zone_members;
CREATE POLICY "Admin can manage geofence zone members"
  ON public.attendance_geofence_zone_members FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── Grant access / reload ────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
