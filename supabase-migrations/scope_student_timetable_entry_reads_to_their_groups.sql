-- A split homeroom's parallel group lessons were readable by every student in
-- the class: the "only my groups" rule lived in fetchTimetableForStudent, not in
-- the policy, so a student could read the other groups' periods straight from
-- PostgREST. Move the rule server-side. Staff reads are untouched, and a
-- whole-class lesson (group_id null) stays visible to the whole class.
DROP POLICY "Staff can view all timetable entries" ON public.timetable_entries;

CREATE POLICY "Staff can view all timetable entries" ON public.timetable_entries
  FOR SELECT TO authenticated
  USING (
    ((SELECT get_user_role()) = ANY (ARRAY['teacher','coordinator','principal','admin']))
    OR (
      EXISTS (
        SELECT 1 FROM timetables t
        JOIN timetable_configs c ON c.id = t.config_id
        WHERE t.id = timetable_entries.timetable_id
          AND t.status = 'published'::timetable_status
          AND c.is_active = true
      )
      AND EXISTS (
        SELECT 1 FROM homeroom_members hm
        WHERE hm.homeroom_id = timetable_entries.homeroom_id
          AND hm.student_id = (SELECT auth.uid())
      )
      AND (
        timetable_entries.group_id IS NULL
        OR EXISTS (
          SELECT 1 FROM timetable_group_members gm
          WHERE gm.group_id = timetable_entries.group_id
            AND gm.student_id = (SELECT auth.uid())
        )
      )
    )
  );
