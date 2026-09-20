-- Individual (per-member) announcement targeting never actually worked.
--
-- add_individual_audience_to_announcements.sql added announcement_audiences.user_id
-- and the create form writes it, but the SELECT policy on `announcements` had no
-- clause for it — so a notice addressed to one student or teacher was filtered out
-- server-side for that very person. Every other clause is carried over unchanged.

DROP POLICY IF EXISTS coord_principal_admin_view_all ON public.announcements;

CREATE POLICY coord_principal_admin_view_all ON public.announcements
FOR SELECT
USING (
  -- Coordinators / principals / admins see everything
  (((SELECT auth.jwt()) -> 'user_metadata' ->> 'role') = ANY (ARRAY['coordinator','principal','admin']))

  -- Smart board: same reach as the homeroom it displays
  OR (
    type = ANY (ARRAY['student','both'])
    AND EXISTS (
      SELECT 1 FROM public.announcement_audiences aa
      WHERE aa.announcement_id = announcements.id
        AND (
          (aa.all_students = true AND EXISTS (
            SELECT 1 FROM public.homerooms h WHERE h.smartboard_id = (SELECT auth.uid())))
          OR EXISTS (
            SELECT 1 FROM public.homerooms h
            WHERE h.smartboard_id = (SELECT auth.uid())
              AND aa.grade = h.grade
              AND (aa.section IS NULL OR aa.section = h.section))
        )
    )
  )

  -- Student: their grade/section, or school-wide
  OR (
    (SELECT public.get_user_role()) = 'student'
    AND type = ANY (ARRAY['student','both'])
    AND EXISTS (
      SELECT 1
      FROM public.announcement_audiences aa
      JOIN public.profiles p ON p.id = (SELECT auth.uid())
      WHERE aa.announcement_id = announcements.id
        AND (
          aa.all_students = true
          OR (aa.grade = p.grade AND (aa.section IS NULL OR aa.section = p.section))
        )
    )
  )

  -- Teacher: their teams, or all staff
  OR (
    (((SELECT auth.jwt()) -> 'user_metadata' ->> 'role') = 'teacher')
    AND type = ANY (ARRAY['staff','both'])
    AND EXISTS (
      SELECT 1 FROM public.announcement_audiences aa
      WHERE aa.announcement_id = announcements.id
        AND (
          aa.all_teams = true
          OR aa.team_id IN (
            SELECT tm.team_id FROM public.team_members tm WHERE tm.user_id = (SELECT auth.uid()))
        )
    )
  )

  -- NEW: announcements addressed to this member individually, whatever their role
  OR EXISTS (
    SELECT 1 FROM public.announcement_audiences aa
    WHERE aa.announcement_id = announcements.id
      AND aa.user_id = (SELECT auth.uid())
  )
);
