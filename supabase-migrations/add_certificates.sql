-- ============================================
-- Certificate Generation Engine
-- ============================================
-- Adds three tables that power the Profile Manager "generate certificate" flow:
--   1. student_details   – extended CBSE student fields (admission no, DOB,
--                          parents, etc.) kept 1:1 with a student profile so the
--                          heavily-used profiles table / RLS stays untouched.
--   2. certificates      – immutable registry of every issued document. Each row
--                          snapshots the field values at issue time so the public
--                          QR verification page always reflects what was printed.
--   3. certificate_templates – custom free-text templates for the universal
--                          certificate engine ({{placeholder}} substitution).
--
-- Institutional info (affiliation no, principal, seal, …) is NOT a table; it uses
-- the existing site_settings + fetchSetting/saveSetting pattern under the
-- 'school_profile' key.
--
-- RLS mirrors add_report_card_titles_and_remarks.sql:
--   role read from auth.jwt() -> 'user_metadata' ->> 'role', staff =
--   teacher/coordinator/principal/admin, updated_at maintained by the shared
--   update_task_updated_at() trigger.

-- 1. Extended student details --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_details (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  admission_no TEXT,
  roll_no TEXT,
  date_of_birth DATE,
  father_name TEXT,
  mother_name TEXT,
  guardian_name TEXT,
  nationality TEXT DEFAULT 'Indian',
  mother_tongue TEXT,
  religion TEXT,
  category TEXT,
  caste TEXT,
  blood_group TEXT,
  date_of_admission DATE,
  admission_class TEXT,
  address TEXT,
  phone TEXT,
  aadhaar_no TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_details_student
  ON public.student_details(student_id);

ALTER TABLE public.student_details ENABLE ROW LEVEL SECURITY;

-- Students read their own details; staff read everyone's.
DROP POLICY IF EXISTS "View own or staff view all student details" ON public.student_details;
CREATE POLICY "View own or staff view all student details"
  ON public.student_details FOR SELECT
  TO authenticated USING (
    student_id = auth.uid()
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS "Staff can insert student details" ON public.student_details;
CREATE POLICY "Staff can insert student details"
  ON public.student_details FOR INSERT
  TO authenticated WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS "Staff can update student details" ON public.student_details;
CREATE POLICY "Staff can update student details"
  ON public.student_details FOR UPDATE
  TO authenticated USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP TRIGGER IF EXISTS student_details_updated_at ON public.student_details;
CREATE TRIGGER student_details_updated_at
  BEFORE UPDATE ON public.student_details
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- 2. Issued certificate registry ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.certificates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  certificate_no TEXT NOT NULL UNIQUE,
  cert_type TEXT NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  student_name TEXT NOT NULL,
  academic_year TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  issued_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_certificates_student ON public.certificates(student_id);
CREATE INDEX IF NOT EXISTS idx_certificates_cert_no ON public.certificates(certificate_no);

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;

-- Staff manage the registry. Public verification reads do NOT go through RLS —
-- they use the service-role key inside /api/certificates/verify/[certNo], which
-- returns only the safe snapshot fields. So there is intentionally no anon SELECT
-- policy here.
DROP POLICY IF EXISTS "Staff can view certificates" ON public.certificates;
CREATE POLICY "Staff can view certificates"
  ON public.certificates FOR SELECT
  TO authenticated USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS "Staff can insert certificates" ON public.certificates;
CREATE POLICY "Staff can insert certificates"
  ON public.certificates FOR INSERT
  TO authenticated WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS "Staff can update certificates" ON public.certificates;
CREATE POLICY "Staff can update certificates"
  ON public.certificates FOR UPDATE
  TO authenticated USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP TRIGGER IF EXISTS certificates_updated_at ON public.certificates;
CREATE TRIGGER certificates_updated_at
  BEFORE UPDATE ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- 3. Custom certificate templates (universal engine) --------------------------
CREATE TABLE IF NOT EXISTS public.certificate_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  cert_type TEXT NOT NULL DEFAULT 'custom',
  title TEXT,
  body TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.certificate_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view certificate templates" ON public.certificate_templates;
CREATE POLICY "Anyone can view certificate templates"
  ON public.certificate_templates FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Staff can insert certificate templates" ON public.certificate_templates;
CREATE POLICY "Staff can insert certificate templates"
  ON public.certificate_templates FOR INSERT
  TO authenticated WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS "Staff can update certificate templates" ON public.certificate_templates;
CREATE POLICY "Staff can update certificate templates"
  ON public.certificate_templates FOR UPDATE
  TO authenticated USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS "Staff can delete certificate templates" ON public.certificate_templates;
CREATE POLICY "Staff can delete certificate templates"
  ON public.certificate_templates FOR DELETE
  TO authenticated USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('coordinator', 'principal', 'admin')
  );

DROP TRIGGER IF EXISTS certificate_templates_updated_at ON public.certificate_templates;
CREATE TRIGGER certificate_templates_updated_at
  BEFORE UPDATE ON public.certificate_templates
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

GRANT ALL ON public.student_details TO anon, authenticated;
GRANT ALL ON public.certificates TO anon, authenticated;
GRANT ALL ON public.certificate_templates TO anon, authenticated;
