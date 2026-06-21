import { supabase, UserProfile } from './supabase'
import { Homeroom } from './homerooms'
import { addClassroomMember, Classroom } from './classrooms'

// ============================================
// Homeroom → Classroom import
// ============================================

export interface ImportHomeroomResult {
  success: boolean
  studentsAdded: number
  smartboardAdded: boolean
  error?: string
}

/**
 * Imports every student of a homeroom into a classroom and, when the homeroom
 * has a smart board account, adds that board as a teacher-level classroom member.
 *
 * The smart board is intentionally added with the 'teacher' role (not 'student')
 * so it never appears in student rosters, mark sheets, or leaderboards while
 * still getting teacher-level access inside the classroom.
 */
export async function importHomeroomIntoClassroom(
  classroomId: string,
  homeroomId: string,
): Promise<ImportHomeroomResult> {
  // 1. Homeroom students.
  const { data: members, error: memErr } = await supabase
    .from('homeroom_members')
    .select('student_id')
    .eq('homeroom_id', homeroomId)

  if (memErr) {
    console.error('importHomeroomIntoClassroom members error:', memErr)
    return { success: false, studentsAdded: 0, smartboardAdded: false, error: 'Failed to read homeroom students' }
  }

  let studentsAdded = 0
  for (const m of members ?? []) {
    const ok = await addClassroomMember(classroomId, m.student_id, 'student')
    if (ok) studentsAdded++
  }

  // 2. Smart board account (teacher-level).
  const { data: hr } = await supabase
    .from('homerooms')
    .select('smartboard_id')
    .eq('id', homeroomId)
    .single()

  let smartboardAdded = false
  if (hr?.smartboard_id) {
    smartboardAdded = await addClassroomMember(classroomId, hr.smartboard_id, 'teacher')
  }

  return { success: true, studentsAdded, smartboardAdded }
}

// ============================================
// Smart board dashboard context
// ============================================

export interface SmartboardContext {
  homeroom: Homeroom | null
  classrooms: Classroom[]
}

/**
 * Loads everything the smart board dashboard needs: the homeroom it belongs to
 * and every classroom the board account is a member of.
 */
export async function fetchSmartboardContext(smartboardId: string): Promise<SmartboardContext> {
  const { data: homeroom } = await supabase
    .from('homerooms')
    .select('*')
    .eq('smartboard_id', smartboardId)
    .maybeSingle()

  const { data: memberships } = await supabase
    .from('classroom_members')
    .select('classroom_id')
    .eq('user_id', smartboardId)

  const classroomIds = (memberships ?? []).map((m: { classroom_id: string }) => m.classroom_id)
  let classrooms: Classroom[] = []
  if (classroomIds.length > 0) {
    const { data } = await supabase
      .from('classrooms')
      .select('*')
      .in('id', classroomIds)
      .order('title', { ascending: true })
    classrooms = (data ?? []) as Classroom[]
  }

  return { homeroom: (homeroom as Homeroom) ?? null, classrooms }
}
