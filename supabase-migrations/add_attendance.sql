-- ============================================================
-- Migration: Attendance System
-- Creates homerooms, homeroom_members, attendance_records,
-- and staff_attendance_records tables with RLS.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────

CREATE TYPE public.attendance_status AS ENUM (
  'present', 'absent', 'late', 'on_leave', 'excused'
);

CREATE TYPE public.staff_attendance_status AS ENUM (
  'present', 'absent', 'late', 'on_leave', 'wfh', 'half_day'
);

-- ── homerooms ────────────────────────────────────────────────

CREATE TABLE public.homerooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  grade SMALLINT,
  section TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.homerooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all homerooms"
  ON public.homerooms FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Admin can insert homerooms"
  ON public.homerooms FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can update homerooms"
  ON public.homerooms FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete homerooms"
  ON public.homerooms FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_homerooms_grade_section ON public.homerooms(grade, section);

CREATE TRIGGER homerooms_updated_at
  BEFORE UPDATE ON public.homerooms
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── homeroom_members ─────────────────────────────────────────

CREATE TABLE public.homeroom_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  homeroom_id UUID REFERENCES public.homerooms(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(homeroom_id, student_id)
);

ALTER TABLE public.homeroom_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all homeroom members"
  ON public.homeroom_members FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Students can view own homeroom memberships"
  ON public.homeroom_members FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Admin can insert homeroom members"
  ON public.homeroom_members FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admin can delete homeroom members"
  ON public.homeroom_members FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_homeroom_members_homeroom_id ON public.homeroom_members(homeroom_id);
CREATE INDEX IF NOT EXISTS idx_homeroom_members_student_id ON public.homeroom_members(student_id);

-- ── attendance_records ───────────────────────────────────────

CREATE TABLE public.attendance_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  homeroom_id UUID REFERENCES public.homerooms(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  status public.attendance_status NOT NULL DEFAULT 'absent',
  leave_application_id UUID REFERENCES public.leave_applications(id) ON DELETE SET NULL,
  marked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(homeroom_id, student_id, date)
);

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own attendance records"
  ON public.attendance_records FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Staff can view all attendance records"
  ON public.attendance_records FOR SELECT
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Staff can insert attendance records"
  ON public.attendance_records FOR INSERT
  WITH CHECK (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Staff can update attendance records"
  ON public.attendance_records FOR UPDATE
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

CREATE POLICY "Admin can delete attendance records"
  ON public.attendance_records FOR DELETE
  USING (public.get_user_role() IN ('principal', 'admin'));

CREATE INDEX IF NOT EXISTS idx_attendance_records_homeroom_date ON public.attendance_records(homeroom_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student_id ON public.attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON public.attendance_records(date);

CREATE TRIGGER attendance_records_updated_at
  BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── staff_attendance_records ─────────────────────────────────

CREATE TABLE public.staff_attendance_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  status public.staff_attendance_status NOT NULL,
  check_in_time TIMESTAMPTZ,
  check_in_lat DECIMAL(9,6),
  check_in_lng DECIMAL(9,6),
  check_in_accuracy REAL,
  geofence_passed BOOLEAN,
  leave_application_id UUID REFERENCES public.leave_applications(id) ON DELETE SET NULL,
  marked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(staff_id, date)
);

ALTER TABLE public.staff_attendance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view own attendance"
  ON public.staff_attendance_records FOR SELECT
  USING (staff_id = auth.uid());

CREATE POLICY "Principal and admin can view all staff attendance"
  ON public.staff_attendance_records FOR SELECT
  USING (public.get_user_role() IN ('principal', 'admin'));

CREATE POLICY "Staff can insert own attendance"
  ON public.staff_attendance_records FOR INSERT
  WITH CHECK (
    staff_id = auth.uid()
    AND public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
  );

CREATE POLICY "Principal and admin can update staff attendance"
  ON public.staff_attendance_records FOR UPDATE
  USING (public.get_user_role() IN ('principal', 'admin'));

CREATE POLICY "Principal and admin can delete staff attendance"
  ON public.staff_attendance_records FOR DELETE
  USING (public.get_user_role() IN ('principal', 'admin'));

CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff_date ON public.staff_attendance_records(staff_id, date);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON public.staff_attendance_records(date);

CREATE TRIGGER staff_attendance_records_updated_at
  BEFORE UPDATE ON public.staff_attendance_records
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
