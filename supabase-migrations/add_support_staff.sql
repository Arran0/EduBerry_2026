-- ============================================================================
-- Support staff — ground-level cleaning / maintenance staff.
--
-- Why these are NOT rows in public.profiles:
--   profiles.id is a FK to auth.users(id), so every profile implies a login.
--   Support staff have no app access at all (many have no phone), so giving
--   them an auth account would mean minting credentials nobody uses — and
--   would leak them into every list that reads profiles by role. They live in
--   their own table instead, which is also why they can never accidentally
--   appear in the regular staff attendance list or its statistics.
--
-- They are used in exactly two places: attendance (marked for them by an
-- admin, since they cannot punch in themselves) and salary management.
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.support_staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  -- ── Employment ────────────────────────────────────────────
  employee_id TEXT,
  designation TEXT,                 -- Housekeeping / Gardener / Security / Helper…
  department TEXT,
  employment_type TEXT,             -- Permanent / Contractual / Daily Wage…
  date_of_joining DATE,
  monthly_wage NUMERIC(12, 2),      -- consumed by salary management
  -- ── Contact ───────────────────────────────────────────────
  phone TEXT,
  alternate_phone TEXT,
  emergency_contact_name TEXT,
  emergency_contact TEXT,
  address TEXT,
  -- ── Personal ──────────────────────────────────────────────
  date_of_birth DATE,
  gender TEXT,
  blood_group TEXT,
  -- ── Identity / payout ─────────────────────────────────────
  aadhaar_no TEXT,
  pan_no TEXT,
  bank_account_no TEXT,
  bank_name TEXT,
  ifsc_code TEXT,
  notes TEXT,
  -- false = left the school. Kept (not deleted) so past attendance and salary
  -- rows still resolve to a name — the same reason profiles are banned rather
  -- than removed.
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- Excludes one person from the support attendance list, counts and stats,
  -- mirroring profiles.attendance_hidden.
  attendance_hidden BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_staff_active_name
  ON public.support_staff(is_active, full_name);

-- ── Attendance ───────────────────────────────────────────────
-- Deliberately a much thinner row than staff_attendance_records: there are no
-- punches, no GPS and no geofence here. Support staff do not carry the app, so
-- every row is set by an admin from the report.

CREATE TABLE IF NOT EXISTS public.support_staff_attendance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  support_staff_id UUID NOT NULL REFERENCES public.support_staff(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'half_day', 'on_leave')),
  marked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (support_staff_id, date)
);

CREATE INDEX IF NOT EXISTS idx_support_staff_attendance_date
  ON public.support_staff_attendance(date);
CREATE INDEX IF NOT EXISTS idx_support_staff_attendance_staff_date
  ON public.support_staff_attendance(support_staff_id, date);

-- ── updated_at triggers ──────────────────────────────────────

DROP TRIGGER IF EXISTS support_staff_updated_at ON public.support_staff;
CREATE TRIGGER support_staff_updated_at
  BEFORE UPDATE ON public.support_staff
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

DROP TRIGGER IF EXISTS support_staff_attendance_updated_at ON public.support_staff_attendance;
CREATE TRIGGER support_staff_attendance_updated_at
  BEFORE UPDATE ON public.support_staff_attendance
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
-- Staff can read the roster and the attendance (the report is visible to
-- them); only an admin creates support staff or marks their attendance, since
-- there is no self-service side to this at all.

ALTER TABLE public.support_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_staff_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view support staff" ON public.support_staff;
CREATE POLICY "Staff can view support staff"
  ON public.support_staff FOR SELECT
  TO authenticated
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

DROP POLICY IF EXISTS "Admin can manage support staff" ON public.support_staff;
CREATE POLICY "Admin can manage support staff"
  ON public.support_staff FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Staff can view support staff attendance" ON public.support_staff_attendance;
CREATE POLICY "Staff can view support staff attendance"
  ON public.support_staff_attendance FOR SELECT
  TO authenticated
  USING (public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin'));

DROP POLICY IF EXISTS "Admin can manage support staff attendance" ON public.support_staff_attendance;
CREATE POLICY "Admin can manage support staff attendance"
  ON public.support_staff_attendance FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── Grant access / reload ────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
