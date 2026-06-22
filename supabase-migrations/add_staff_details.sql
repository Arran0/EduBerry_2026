-- ============================================
-- Staff Details — extended HR / personnel fields
-- ============================================
-- Adds public.staff_details, 1:1 with a non-student profile (keyed by staff_id),
-- to maintain employee records (employee id, designation, department, joining
-- date, qualification, contact, statutory ids, …). Kept in its own table so the
-- heavily-used profiles table / RLS stays untouched — mirrors student_details.
--
-- RLS mirrors add_certificates.sql:
--   role read from auth.jwt() -> 'user_metadata' ->> 'role', staff =
--   teacher/coordinator/principal/admin, updated_at maintained by the shared
--   update_task_updated_at() trigger.

CREATE TABLE IF NOT EXISTS public.staff_details (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  employee_id TEXT,
  designation TEXT,
  department TEXT,
  qualification TEXT,
  date_of_joining DATE,
  date_of_birth DATE,
  gender TEXT,
  blood_group TEXT,
  phone TEXT,
  emergency_contact TEXT,
  address TEXT,
  aadhaar_no TEXT,
  pan_no TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_details_staff
  ON public.staff_details(staff_id);

ALTER TABLE public.staff_details ENABLE ROW LEVEL SECURITY;

-- Staff read their own record; admin-tier staff read everyone's.
DROP POLICY IF EXISTS "View own or staff view all staff details" ON public.staff_details;
CREATE POLICY "View own or staff view all staff details"
  ON public.staff_details FOR SELECT
  TO authenticated USING (
    staff_id = auth.uid()
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS "Staff can insert staff details" ON public.staff_details;
CREATE POLICY "Staff can insert staff details"
  ON public.staff_details FOR INSERT
  TO authenticated WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS "Staff can update staff details" ON public.staff_details;
CREATE POLICY "Staff can update staff details"
  ON public.staff_details FOR UPDATE
  TO authenticated USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('coordinator', 'principal', 'admin')
  );

DROP TRIGGER IF EXISTS staff_details_updated_at ON public.staff_details;
CREATE TRIGGER staff_details_updated_at
  BEFORE UPDATE ON public.staff_details
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

GRANT ALL ON public.staff_details TO anon, authenticated;
