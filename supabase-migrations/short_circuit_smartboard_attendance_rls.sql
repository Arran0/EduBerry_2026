-- `is_homeroom_smartboard(homeroom_id)` takes a per-row column, so unlike a
-- niladic STABLE helper it cannot be hoisted into an InitPlan — Postgres ran
-- that subquery once per row. Because it sat first in the OR chain, every
-- teacher/manager/student read paid it on every row scanned (a whole-school
-- report page is thousands of rows).
--
-- Two changes, both provably behaviour-preserving:
--   1. the hoisted checks (role, own-row) move to the front of the OR, so the
--      boolean short-circuits before the per-row function for everyone who is
--      not a smart board;
--   2. the per-row call is gated behind a niladic `is_smartboard_account()`,
--      which is hoisted to a single InitPlan. This is an identity, not a new
--      restriction: is_homeroom_smartboard(h) can only be true when a homeroom
--      with smartboard_id = auth.uid() exists, which is exactly what
--      is_smartboard_account() tests — so `A AND B` == `B` here.
-- Row visibility is unchanged; only the number of function calls drops.

CREATE OR REPLACE FUNCTION public.is_smartboard_account()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM homerooms WHERE smartboard_id = auth.uid());
$fn$;

DROP POLICY "Smart board can view homeroom attendance" ON public.attendance_records;
CREATE POLICY "Smart board can view homeroom attendance" ON public.attendance_records
  FOR SELECT TO authenticated
  USING (
    ((SELECT get_user_role()) = ANY (ARRAY['teacher'::text,'coordinator'::text,'principal'::text,'admin'::text]))
    OR (student_id = (SELECT auth.uid()))
    OR ((SELECT is_smartboard_account()) AND is_homeroom_smartboard(homeroom_id))
  );

DROP POLICY "Smart board can insert homeroom attendance" ON public.attendance_records;
CREATE POLICY "Smart board can insert homeroom attendance" ON public.attendance_records
  FOR INSERT TO authenticated
  WITH CHECK (
    ((SELECT get_user_role()) = ANY (ARRAY['teacher'::text,'coordinator'::text,'principal'::text,'admin'::text]))
    OR ((SELECT is_smartboard_account()) AND is_homeroom_smartboard(homeroom_id))
  );

DROP POLICY "Smart board can update homeroom attendance" ON public.attendance_records;
CREATE POLICY "Smart board can update homeroom attendance" ON public.attendance_records
  FOR UPDATE TO authenticated
  USING (
    ((SELECT get_user_role()) = ANY (ARRAY['teacher'::text,'coordinator'::text,'principal'::text,'admin'::text]))
    OR ((SELECT is_smartboard_account()) AND is_homeroom_smartboard(homeroom_id))
  );

DROP POLICY "Smart board can view homeroom members" ON public.homeroom_members;
CREATE POLICY "Smart board can view homeroom members" ON public.homeroom_members
  FOR SELECT TO authenticated
  USING (
    ((SELECT get_user_role()) = ANY (ARRAY['teacher'::text,'coordinator'::text,'principal'::text,'admin'::text]))
    OR (student_id = (SELECT auth.uid()))
    OR ((SELECT is_smartboard_account()) AND is_homeroom_smartboard(homeroom_id))
  );

-- Both helpers exist only to be called from the policies above, which are
-- `TO authenticated` — an anon session never evaluates them. Postgres grants
-- EXECUTE to PUBLIC by default though, which PostgREST turns into a callable
-- /rest/v1/rpc/ endpoint for the anon key. Narrow that to the role that needs it.
REVOKE EXECUTE ON FUNCTION public.is_smartboard_account() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_homeroom_smartboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_smartboard_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_homeroom_smartboard(uuid) TO authenticated;
