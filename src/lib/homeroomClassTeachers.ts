import { supabase } from './supabase'
import { addClassroomMember, ClassroomMemberRole } from './classrooms'

/**
 * A homeroom's class teacher follows the homeroom into every classroom it is
 * part of. Three paths feed a homeroom into a classroom, and all three land
 * here so the rule is written once:
 *
 *  • creating a classroom for a grade + section (auto-enrols that
 *    grade/section's students and smart boards — and now its class teachers),
 *  • importing a homeroom into an existing classroom, and
 *  • naming/changing a homeroom's class teacher after its classrooms exist.
 *
 * The teacher joins with staff-level access, never as a student, so they never
 * appear in rosters, mark sheets or leaderboards.
 */

/** Classroom role to give a class teacher: their own staff role, or 'teacher'. */
const STAFF_ROLES = ['teacher', 'coordinator', 'principal', 'admin']

function staffRole(profileRole: string | null | undefined): ClassroomMemberRole {
  return (STAFF_ROLES.includes(profileRole ?? '') ? profileRole : 'teacher') as ClassroomMemberRole
}

/** id + classroom role for each of the given profiles, skipping unknown ids. */
export async function staffRolesForClassTeachers(ids: string[]): Promise<{ id: string; role: ClassroomMemberRole }[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('profiles').select('id, role').in('id', ids)
  if (error) {
    console.error('staffRolesForClassTeachers error:', error)
    // Fall back to plain teacher access rather than dropping the teacher entirely.
    return ids.map(id => ({ id, role: 'teacher' as ClassroomMemberRole }))
  }
  return (data ?? []).map(p => ({ id: (p as { id: string }).id, role: staffRole((p as { role: string }).role) }))
}

/**
 * Class teachers of every homeroom for a grade + section. Used when a
 * classroom is created for that grade/section, mirroring how the matching
 * students and smart boards are auto-enrolled.
 */
export async function fetchClassTeachersForGradeSection(
  grade: number,
  section: string,
): Promise<{ id: string; role: ClassroomMemberRole }[]> {
  const { data, error } = await supabase
    .from('homerooms')
    .select('class_teacher_id')
    .eq('grade', grade)
    .ilike('section', section)
    .not('class_teacher_id', 'is', null)

  if (error) {
    console.error('fetchClassTeachersForGradeSection error:', error)
    return []
  }

  const ids = [...new Set((data ?? [])
    .map(h => (h as { class_teacher_id: string | null }).class_teacher_id)
    .filter((id): id is string => !!id))]

  return staffRolesForClassTeachers(ids)
}

/**
 * Adds a homeroom's class teacher to every classroom of the homeroom's own
 * grade + section. Called when the class teacher is named or changed, so a
 * teacher assigned after the classrooms already exist still lands in them.
 * Returns how many classrooms they were added to (duplicates count as added).
 */
export async function enrolClassTeacherInMatchingClassrooms(
  homeroomId: string,
  teacherId: string,
): Promise<number> {
  const { data: hr, error: hrErr } = await supabase
    .from('homerooms')
    .select('grade, section')
    .eq('id', homeroomId)
    .single()

  if (hrErr || !hr) {
    console.error('enrolClassTeacherInMatchingClassrooms homeroom error:', hrErr)
    return 0
  }

  const { grade, section } = hr as { grade: number | null; section: string | null }
  if (grade == null || !section) return 0

  const { data: classrooms, error: cErr } = await supabase
    .from('classrooms')
    .select('id')
    .eq('grade', grade)
    .ilike('section', section)

  if (cErr) {
    console.error('enrolClassTeacherInMatchingClassrooms classrooms error:', cErr)
    return 0
  }

  const [teacher] = await staffRolesForClassTeachers([teacherId])
  if (!teacher) return 0

  let added = 0
  for (const c of classrooms ?? []) {
    const ok = await addClassroomMember((c as { id: string }).id, teacher.id, teacher.role)
    if (ok) added++
  }
  return added
}
