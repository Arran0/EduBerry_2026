-- Admin Space security pass — applied to the mps-web project as four
-- migrations (restrict_staff_details_pii_and_add_staff_directory,
-- fix_team_coordinators_select_and_homeroom_update_scope,
-- add_app_settings_admin_policy, app_settings_value_to_jsonb).
-- Kept here as the repo's record of what changed and why.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. staff_details held Aadhaar, PAN, EPF/NPS and bank account + IFSC for every
--    staff member, and its SELECT policy let ANY 'teacher' account read all of
--    it for everyone — while INSERT/UPDATE were already senior-staff-only.
--    Narrow SELECT to match the write side, and serve the four directory
--    columns every non-admin screen actually renders through a definer RPC.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "View own or staff view all staff details" ON public.staff_details;

CREATE POLICY "View own or senior staff view all staff details"
  ON public.staff_details FOR SELECT TO authenticated
  USING (
    staff_id = (SELECT auth.uid())
    OR (SELECT get_user_role()) = ANY (ARRAY['coordinator','principal','admin'])
  );

CREATE OR REPLACE FUNCTION public.staff_directory(p_ids uuid[])
RETURNS TABLE (staff_id uuid, employee_id text, designation text, department text, phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.staff_id, d.employee_id, d.designation, d.department, d.phone
  FROM staff_details d
  WHERE d.staff_id = ANY (p_ids)
    AND ( (SELECT get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin'])
          OR d.staff_id = (SELECT auth.uid()) );
$$;

REVOKE ALL ON FUNCTION public.staff_directory(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_directory(uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A previous policy merge left team_coordinators' SELECT clause as
--    `(get_user_role() = 'admin' OR true)` — i.e. readable by every
--    authenticated account, students included. Align it with the teams table.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "team_coordinators_select_merged" ON public.team_coordinators;

CREATE POLICY "team_coordinators_select_merged"
  ON public.team_coordinators FOR SELECT TO authenticated
  USING ((SELECT get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The homerooms UPDATE policy granted a smart board account full update
--    rights on its homeroom row so it could save its own dashboard banner.
--    That also let it rewrite the homeroom's name, grade, section and class
--    teacher. Give the banner its own RPC; put the table policy back to admin.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_smartboard_banner(p_homeroom uuid, p_banner jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE homerooms SET smartboard_banner = p_banner
  WHERE id = p_homeroom
    AND (smartboard_id = (SELECT auth.uid()) OR (SELECT get_user_role()) = 'admin');
  RETURN FOUND;
END; $$;

REVOKE ALL ON FUNCTION public.set_smartboard_banner(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_smartboard_banner(uuid, jsonb) TO authenticated;

DROP POLICY IF EXISTS "Admin can update homerooms" ON public.homerooms;

CREATE POLICY "Admin can update homerooms"
  ON public.homerooms FOR UPDATE TO authenticated
  USING ((SELECT get_user_role()) = 'admin')
  WITH CHECK ((SELECT get_user_role()) = 'admin');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. app_settings holds the admin-configurable homeroom_expiry_dates map but
--    had RLS enabled with zero policies, so it was unreachable to every client.
--    Its `value` was also text rather than jsonb, so PostgREST handed callers a
--    string and the `typeof value === 'object'` checks reading it never matched
--    (on top of those reads naming a non-existent `admin_settings` table).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "Admins manage app_settings" ON public.app_settings
  FOR ALL TO authenticated
  USING ((SELECT get_user_role()) = 'admin')
  WITH CHECK ((SELECT get_user_role()) = 'admin');

ALTER TABLE public.app_settings
  ALTER COLUMN value TYPE jsonb USING value::jsonb;
