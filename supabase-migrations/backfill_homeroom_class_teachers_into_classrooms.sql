-- Backfill: a homeroom's class teacher belongs in the homeroom's classrooms.
--
-- Going forward the app adds them at the three points a homeroom meets a
-- classroom (creating a classroom for a grade+section, importing a homeroom
-- into one, and naming/changing a class teacher — see
-- src/lib/homeroomClassTeachers.ts). This fills in the classrooms that already
-- existed before that rule did.
--
-- A homeroom counts as "in" a classroom when either:
--   (a) the classroom's grade+section match the homeroom's — the same match the
--       create-classroom flow uses to auto-enrol that section's students and
--       smart boards; or
--   (b) every one of the homeroom's students is already a classroom member —
--       the footprint left by an Import Homeroom, which also catches combined
--       classrooms (e.g. a 9B subject classroom that also holds all of 9C).
--
-- The teacher joins at their own staff role, never as a student, so they never
-- appear in rosters, mark sheets or leaderboards. Existing memberships are left
-- exactly as they are: ON CONFLICT DO NOTHING never downgrades a teacher who is
-- already in the classroom as a coordinator/principal/admin.

insert into classroom_members (classroom_id, user_id, role)
select distinct
  c.id,
  h.class_teacher_id,
  case when p.role in ('teacher', 'coordinator', 'principal', 'admin') then p.role else 'teacher' end
from classrooms c
join homerooms h
  on h.class_teacher_id is not null
join profiles p
  on p.id = h.class_teacher_id
where
  (c.grade = h.grade and upper(btrim(c.section)) = upper(btrim(h.section)))
  or (
    exists (select 1 from homeroom_members hm where hm.homeroom_id = h.id)
    and not exists (
      select 1
      from homeroom_members hm
      where hm.homeroom_id = h.id
        and not exists (
          select 1 from classroom_members cm
          where cm.classroom_id = c.id and cm.user_id = hm.student_id
        )
    )
  )
on conflict (classroom_id, user_id) do nothing;
