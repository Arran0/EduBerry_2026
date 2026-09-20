-- ============================================================
-- Migration: distinct grade/section lookup + student grade index  [APPLIED]
--
-- The academics Class Marks picker read `profiles` directly and de-duplicated
-- grade/section pairs in the browser — one row per student (1000+) to build a
-- list of a few dozen. This does the DISTINCT in the database.
--
-- SECURITY INVOKER (the default): the caller's RLS still decides which profile
-- rows are visible, so the result matches the client query it replaces.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_grade_sections_with_students()
RETURNS TABLE (grade INTEGER, section TEXT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT p.grade::INTEGER, p.section::TEXT
  FROM public.profiles p
  WHERE p.role = 'student'
    AND p.grade IS NOT NULL
    AND p.section IS NOT NULL
  ORDER BY 1, 2;
$$;

-- Postgres grants EXECUTE to PUBLIC by default, which would leave this
-- callable with the anon key — revoke that before granting.
REVOKE EXECUTE ON FUNCTION public.get_grade_sections_with_students() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_grade_sections_with_students() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_grade_sections_with_students() TO authenticated;

-- Students are ~90% of the profiles table, so idx_profiles_role is not
-- selective for the grade/section lookups the Class Marks view runs.
CREATE INDEX IF NOT EXISTS idx_profiles_student_grade_section
  ON public.profiles (grade, section)
  WHERE role = 'student';

NOTIFY pgrst, 'reload schema';
