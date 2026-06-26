-- Fix: staff details cannot be saved through the Staff Profile Manager
--
-- Root cause: staff_details INSERT / UPDATE policies use
--
--   auth.jwt() -> 'user_metadata' ->> 'role'
--
-- Staff accounts created via the Admin API carry user_metadata.role in their
-- JWT, but accounts created or updated in other ways may not — identical to the
-- bug fixed for announcements in fix_student_announcement_rls.sql.  When the
-- role is absent from the JWT the policies evaluate to NULL which is treated as
-- FALSE, so even an admin gets a silent permission error on upsert.
--
-- Fix: replace every JWT role check with public.get_user_role() which reads
-- directly from public.profiles — the authoritative source regardless of how
-- the account was created.  The SELECT policy is also updated for consistency.

-- Ensure get_user_role() exists (created by fix_student_announcement_rls.sql,
-- repeated here so this file is safe to run standalone).
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- SELECT: own record, or any staff member
DROP POLICY IF EXISTS "View own or staff view all staff details" ON public.staff_details;
CREATE POLICY "View own or staff view all staff details"
  ON public.staff_details FOR SELECT
  TO authenticated USING (
    staff_id = auth.uid()
    OR public.get_user_role() IN ('teacher', 'coordinator', 'principal', 'admin')
  );

-- INSERT: coordinator / principal / admin
DROP POLICY IF EXISTS "Staff can insert staff details" ON public.staff_details;
CREATE POLICY "Staff can insert staff details"
  ON public.staff_details FOR INSERT
  TO authenticated WITH CHECK (
    public.get_user_role() IN ('coordinator', 'principal', 'admin')
  );

-- UPDATE: coordinator / principal / admin
DROP POLICY IF EXISTS "Staff can update staff details" ON public.staff_details;
CREATE POLICY "Staff can update staff details"
  ON public.staff_details FOR UPDATE
  TO authenticated USING (
    public.get_user_role() IN ('coordinator', 'principal', 'admin')
  );
