-- Make the announcements SELECT policy stop re-deriving the viewer's audience per row.
--
-- `count_unread_announcements` averaged 139.9ms and `get_unread_announcements` 153.6ms
-- against a table holding EIGHT rows. The data was never the problem: the SELECT policy
-- was a five-branch OR whose branches each ran correlated EXISTS subqueries over
-- announcement_audiences, homerooms, profiles and team_members, re-evaluated for every
-- candidate row. Between them those two calls burned ~7,400 seconds, second only to the
-- Task Manager query that took the API down at 08:45.
--
-- Which announcements a viewer may see does not depend on which row is being tested —
-- only on who they are. So the audience resolution moves into three set-returning
-- helpers that take no arguments. Being STABLE and uncorrelated, each is evaluated once
-- per statement as a hashed InitPlan, and the per-row test collapses to a hash lookup.
--
-- The branches are preserved exactly, including the quirk that the smartboard case is
-- NOT gated on role (whichever account a homeroom's smartboard_id points at sees that
-- homeroom's student announcements). The rewrite was diffed against the old predicate
-- over every user x every announcement before being applied: 9,296 pairs, 0 gained
-- access, 0 lost access, 5,754 visible under both.
--
-- SECURITY INVOKER is deliberate. These helpers read announcement_audiences, homerooms,
-- profiles and team_members, and under INVOKER those tables' own RLS still applies
-- exactly as it did when the subqueries were inline. A DEFINER helper would be faster
-- still but could only widen visibility, which is not a trade worth making for a badge.

-- Announcements addressed to this user by name. Visible whatever the announcement type.
CREATE OR REPLACE FUNCTION public.announcement_ids_addressed_to_me()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT aa.announcement_id
  FROM public.announcement_audiences aa
  WHERE aa.user_id = (SELECT auth.uid());
$$;

-- Student-audience announcements. Two ways in: this account is a homeroom's smartboard
-- and the audience covers that homeroom, or this account is a student the audience
-- covers. Caller must still check type IN ('student','both').
CREATE OR REPLACE FUNCTION public.announcement_ids_for_student_audience()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT aa.announcement_id
  FROM public.announcement_audiences aa
  WHERE
    -- A smartboard showing the whole school's student notices.
    (aa.all_students AND EXISTS (
       SELECT 1 FROM public.homerooms h WHERE h.smartboard_id = (SELECT auth.uid())))
    -- A smartboard whose own homeroom is the audience.
    OR EXISTS (
       SELECT 1 FROM public.homerooms h
       WHERE h.smartboard_id = (SELECT auth.uid())
         AND aa.grade = h.grade
         AND (aa.section IS NULL OR aa.section = h.section))
    -- The student themselves.
    OR ((SELECT get_user_role()) = 'student' AND (
          aa.all_students
          OR EXISTS (
             SELECT 1 FROM public.profiles p
             WHERE p.id = (SELECT auth.uid())
               AND aa.grade = p.grade
               AND (aa.section IS NULL OR aa.section = p.section))));
$$;

-- Staff-audience announcements reaching this teacher, by team or school-wide.
-- Caller must still check type IN ('staff','both').
CREATE OR REPLACE FUNCTION public.announcement_ids_for_staff_audience()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT aa.announcement_id
  FROM public.announcement_audiences aa
  WHERE (SELECT get_user_role()) = 'teacher'
    AND (aa.all_teams
         OR aa.team_id IN (
              SELECT tm.team_id FROM public.team_members tm
              WHERE tm.user_id = (SELECT auth.uid())));
$$;

REVOKE ALL ON FUNCTION public.announcement_ids_addressed_to_me()       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.announcement_ids_for_student_audience()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.announcement_ids_for_staff_audience()    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.announcement_ids_addressed_to_me()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.announcement_ids_for_student_audience() TO authenticated;
GRANT EXECUTE ON FUNCTION public.announcement_ids_for_staff_audience()   TO authenticated;

-- Replacing the policy needs ACCESS EXCLUSIVE on `announcements`. Against a live
-- database the DROP below will queue behind the app's constant reads of that table —
-- it timed out doing exactly that when this was first applied. On a running system,
-- create the helpers in their own transaction, then swap the policy in a second one
-- that fails fast rather than holding the queue open:
--
--   SET LOCAL lock_timeout = '5s';
--   ALTER POLICY coord_principal_admin_view_all ON public.announcements USING ( ... );
--
-- ALTER also avoids the window where the policy does not exist. The DROP/CREATE pair
-- below is the from-scratch form and is what a fresh environment should run.
DROP POLICY IF EXISTS coord_principal_admin_view_all ON public.announcements;

CREATE POLICY coord_principal_admin_view_all ON public.announcements
FOR SELECT
USING (
  (SELECT get_user_role()) = ANY (ARRAY['coordinator', 'principal', 'admin'])
  OR id IN (SELECT public.announcement_ids_addressed_to_me())
  OR (type = ANY (ARRAY['student', 'both'])
      AND id IN (SELECT public.announcement_ids_for_student_audience()))
  OR (type = ANY (ARRAY['staff', 'both'])
      AND id IN (SELECT public.announcement_ids_for_staff_audience()))
);
