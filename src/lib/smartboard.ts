import { supabase, UserProfile } from './supabase'
import { Homeroom } from './homerooms'
import { addClassroomMember, Classroom } from './classrooms'

// Reuse the same four-state model as staff tasks / classroom progress.
export type SmartboardTaskStatus = 'not_done' | 'partial' | 'done' | 'checked'

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

// ============================================
// Smart board tasks
// ============================================

export interface SmartboardTask {
  id: string
  homeroom_id: string
  classroom_id: string | null
  created_by: string | null
  title: string
  description: string | null
  due_date: string | null
  timing: string | null
  end_time: string | null
  edu_points: number
  created_at: string
  updated_at: string
}

export interface SmartboardTaskCompletion {
  id: string
  task_id: string
  student_id: string
  status: SmartboardTaskStatus
  submission: string | null
  updated_at: string
  student?: UserProfile
}

export interface NewSmartboardTaskInput {
  homeroom_id: string
  classroom_id?: string | null
  title: string
  description?: string | null
  due_date?: string | null
  timing?: string | null
  end_time?: string | null
  edu_points?: number
}

/** Tasks for a homeroom within an inclusive [startDate, endDate] range. */
export async function fetchSmartboardTasks(
  homeroomId: string,
  startDate: string,
  endDate: string,
): Promise<SmartboardTask[]> {
  const { data, error } = await supabase
    .from('smartboard_tasks')
    .select('*')
    .eq('homeroom_id', homeroomId)
    .gte('due_date', startDate)
    .lte('due_date', endDate)
    .order('due_date', { ascending: true })
    .order('timing', { ascending: true, nullsFirst: false })

  if (error) {
    console.error('fetchSmartboardTasks error:', error)
    return []
  }
  return (data ?? []) as SmartboardTask[]
}

export async function createSmartboardTask(
  input: NewSmartboardTaskInput,
  createdBy: string,
): Promise<SmartboardTask | null> {
  const { data, error } = await supabase
    .from('smartboard_tasks')
    .insert({
      homeroom_id: input.homeroom_id,
      classroom_id: input.classroom_id ?? null,
      created_by: createdBy,
      title: input.title,
      description: input.description ?? null,
      due_date: input.due_date ?? null,
      timing: input.timing ?? null,
      end_time: input.end_time ?? null,
      edu_points: Math.max(0, Math.round(input.edu_points ?? 0)),
    })
    .select()
    .single()

  if (error) {
    console.error('createSmartboardTask error:', error)
    return null
  }
  return data as SmartboardTask
}

export async function updateSmartboardTask(
  id: string,
  updates: Partial<Pick<SmartboardTask, 'title' | 'description' | 'due_date' | 'timing' | 'end_time' | 'classroom_id' | 'edu_points'>>,
): Promise<boolean> {
  const { error } = await supabase
    .from('smartboard_tasks')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('updateSmartboardTask error:', error)
    return false
  }
  return true
}

export async function deleteSmartboardTask(id: string): Promise<boolean> {
  const { error } = await supabase.from('smartboard_tasks').delete().eq('id', id)
  if (error) {
    console.error('deleteSmartboardTask error:', error)
    return false
  }
  return true
}

// ============================================
// Task completions (per homeroom member)
// ============================================

/**
 * Completion rows for a task, one per homeroom member. Members without a row
 * yet are returned with a synthetic 'not_done' completion so the board sees the
 * full roster and who hasn't started.
 */
export async function fetchTaskCompletions(
  task: Pick<SmartboardTask, 'id' | 'homeroom_id'>,
): Promise<SmartboardTaskCompletion[]> {
  const { data: members } = await supabase
    .from('homeroom_members')
    .select(`student_id, student:profiles!homeroom_members_student_id_fkey(id, email, full_name, role, avatar_url, grade, section)`)
    .eq('homeroom_id', task.homeroom_id)
    .order('created_at', { ascending: true })

  const { data: rows } = await supabase
    .from('smartboard_task_completions')
    .select('*')
    .eq('task_id', task.id)

  const rowByStudent: Record<string, SmartboardTaskCompletion> = {}
  for (const r of rows ?? []) rowByStudent[r.student_id] = r as SmartboardTaskCompletion

  return (members ?? []).map(m => {
    const student = (Array.isArray(m.student) ? m.student[0] : m.student) as UserProfile | undefined
    const existing = rowByStudent[m.student_id]
    return existing
      ? { ...existing, student }
      : {
          id: `pending-${m.student_id}`,
          task_id: task.id,
          student_id: m.student_id,
          status: 'not_done' as SmartboardTaskStatus,
          submission: null,
          updated_at: '',
          student,
        }
  })
}

/** Student reports progress (or board/staff verifies) against a task. */
export async function upsertTaskCompletion(
  taskId: string,
  studentId: string,
  status: SmartboardTaskStatus,
  submission?: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('smartboard_task_completions')
    .upsert(
      {
        task_id: taskId,
        student_id: studentId,
        status,
        ...(submission !== undefined ? { submission } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'task_id,student_id' },
    )

  if (error) {
    console.error('upsertTaskCompletion error:', error)
    return false
  }
  return true
}

// ============================================
// Student-reflected tasks (homeroom members' calendar)
// ============================================

export interface StudentHomeroomTask extends SmartboardTask {
  homeroom_name: string | null
  classroom_title: string | null
  my_status: SmartboardTaskStatus
  my_submission: string | null
}

/**
 * Every smart-board task reflected onto a student's calendar, across all of
 * their homerooms, within an inclusive [startDate, endDate] window — joined
 * with the student's own completion row (defaulting to 'not_done').
 */
export async function fetchStudentHomeroomTasks(
  studentId: string,
  startDate: string,
  endDate: string,
): Promise<StudentHomeroomTask[]> {
  // 1. The student's homerooms.
  const { data: memberships } = await supabase
    .from('homeroom_members')
    .select('homeroom_id')
    .eq('student_id', studentId)

  const homeroomIds = (memberships ?? []).map((m: { homeroom_id: string }) => m.homeroom_id)
  if (homeroomIds.length === 0) return []

  // 2. Tasks in those homerooms within the window.
  const { data: taskRows, error } = await supabase
    .from('smartboard_tasks')
    .select('*')
    .in('homeroom_id', homeroomIds)
    .gte('due_date', startDate)
    .lte('due_date', endDate)
    .order('due_date', { ascending: true })
    .order('timing', { ascending: true, nullsFirst: false })

  if (error) {
    console.error('fetchStudentHomeroomTasks error:', error)
    return []
  }
  const tasks = (taskRows ?? []) as SmartboardTask[]
  if (tasks.length === 0) return []

  // 3. The student's own completions for those tasks.
  const taskIds = tasks.map(t => t.id)
  const { data: completions } = await supabase
    .from('smartboard_task_completions')
    .select('task_id, status, submission')
    .eq('student_id', studentId)
    .in('task_id', taskIds)

  const compByTask = new Map(
    (completions ?? []).map((c: { task_id: string; status: SmartboardTaskStatus; submission: string | null }) => [c.task_id, c]),
  )

  // 4. Homeroom + classroom labels.
  const classroomIds = [...new Set(tasks.map(t => t.classroom_id).filter(Boolean) as string[])]
  const [{ data: homerooms }, { data: classrooms }] = await Promise.all([
    supabase.from('homerooms').select('id, name').in('id', homeroomIds),
    classroomIds.length > 0
      ? supabase.from('classrooms').select('id, title').in('id', classroomIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ])
  const homeroomName = new Map((homerooms ?? []).map((h: { id: string; name: string }) => [h.id, h.name]))
  const classroomTitle = new Map((classrooms ?? []).map((c: { id: string; title: string }) => [c.id, c.title]))

  return tasks.map(t => {
    const c = compByTask.get(t.id)
    return {
      ...t,
      homeroom_name: homeroomName.get(t.homeroom_id) ?? null,
      classroom_title: t.classroom_id ? classroomTitle.get(t.classroom_id) ?? null : null,
      my_status: (c?.status as SmartboardTaskStatus) ?? 'not_done',
      my_submission: c?.submission ?? null,
    }
  })
}

// ============================================
// Homeroom attendance snapshot
// ============================================

export interface AttendanceCounts {
  present: number
  absent: number
  on_leave: number
  on_duty: number
  total: number
}

/** Today's attendance tallies for a homeroom (present / absent / OL / OD). */
export async function fetchHomeroomAttendanceCounts(
  homeroomId: string,
  date: string,
): Promise<AttendanceCounts> {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('status')
    .eq('homeroom_id', homeroomId)
    .eq('date', date)

  const counts: AttendanceCounts = { present: 0, absent: 0, on_leave: 0, on_duty: 0, total: 0 }
  if (error) {
    console.error('fetchHomeroomAttendanceCounts error:', error)
    return counts
  }
  for (const r of data ?? []) {
    counts.total++
    if (r.status === 'present' || r.status === 'late') counts.present++
    else if (r.status === 'absent') counts.absent++
    else if (r.status === 'on_leave') counts.on_leave++
    else if (r.status === 'on_duty') counts.on_duty++
  }
  return counts
}

// ============================================
// Classroom top 3 (EduPoints)
// ============================================

export interface ClassroomTop3Entry {
  student_id: string
  full_name: string
  avatar_url: string | null
  points: number
  rank: number
}

/** Top 3 students by derived EduPoints for a classroom (via SECURITY DEFINER RPC). */
export async function fetchClassroomTop3(classroomId: string): Promise<ClassroomTop3Entry[]> {
  const { data, error } = await supabase.rpc('get_classroom_edu_top3', { p_classroom_id: classroomId })
  if (error) {
    console.error('fetchClassroomTop3 error:', error)
    return []
  }
  return (data ?? []) as ClassroomTop3Entry[]
}
