import { supabase, UserProfile } from './supabase'
import { Homeroom } from './homerooms'
import { addClassroomMember, Classroom } from './classrooms'
import { compressImageIfNeeded } from './imageCompression'

// Reuse the same four-state model as staff tasks / classroom progress.
export type SmartboardTaskStatus = 'not_done' | 'partial' | 'done' | 'checked'

/**
 * Next status in the cycle — mirrors the staff Task Manager logic.
 *
 * requireCheck = false (no verification): not_done → partial → done (completed) → not_done
 * requireCheck = true  (verification):
 *   • canCheck = false (student): not_done → partial → done ("awaiting verification") → done
 *   • canCheck = true  (board/staff): not_done → partial → done → checked (verified) → not_done
 */
export function getNextSmartboardStatus(
  current: SmartboardTaskStatus,
  canCheck: boolean,
  requireCheck = false,
): SmartboardTaskStatus {
  if (current === 'not_done') return 'partial'
  if (current === 'partial') return 'done'
  if (current === 'done') {
    if (requireCheck && canCheck) return 'checked'
    if (requireCheck) return 'done' // student is stuck until board verifies
    return 'not_done'
  }
  if (current === 'checked') return 'not_done'
  return current
}

// ============================================
// Homeroom → Classroom import
// ============================================

export interface ImportHomeroomResult {
  success: boolean
  studentsAdded: number
  smartboardAdded: boolean
  /** Whether the homeroom actually had a board linked (helps explain a no-op). */
  hadSmartboard: boolean
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
    return { success: false, studentsAdded: 0, smartboardAdded: false, hadSmartboard: false, error: 'Failed to read homeroom students' }
  }

  let studentsAdded = 0
  for (const m of members ?? []) {
    const ok = await addClassroomMember(classroomId, m.student_id, 'student')
    if (ok) studentsAdded++
  }

  // 2. Smart board account (teacher-level).
  const { data: hr, error: hrErr } = await supabase
    .from('homerooms')
    .select('smartboard_id')
    .eq('id', homeroomId)
    .single()

  if (hrErr) console.error('importHomeroomIntoClassroom homeroom error:', hrErr)

  const hadSmartboard = !!hr?.smartboard_id
  let smartboardAdded = false
  if (hr?.smartboard_id) {
    smartboardAdded = await addClassroomMember(classroomId, hr.smartboard_id, 'teacher')
    if (!smartboardAdded) console.error('importHomeroomIntoClassroom: failed to add smart board', hr.smartboard_id)
  }

  return { success: true, studentsAdded, smartboardAdded, hadSmartboard }
}

/** All smart board accounts (role = 'smartboard'), for pickers/managers. */
export async function fetchSmartboardAccounts(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, created_at, updated_at')
    .eq('role', 'smartboard')
    .order('full_name', { ascending: true })

  if (error) {
    console.error('fetchSmartboardAccounts error:', error)
    return []
  }
  return (data ?? []) as UserProfile[]
}

/** Adds a smart board account to a classroom with teacher-level access. */
export async function addSmartboardToClassroom(classroomId: string, smartboardId: string): Promise<boolean> {
  return addClassroomMember(classroomId, smartboardId, 'teacher')
}

/**
 * Smart board profile ids that belong to a grade + section, found two ways and
 * de-duplicated: boards whose own profile carries that grade/section, and boards
 * linked to a homeroom of that grade/section. Used to auto-enrol the board when a
 * classroom is created for a grade/section (mirroring how students are added).
 */
export async function fetchSmartboardIdsForGradeSection(
  grade: number,
  section: string,
): Promise<string[]> {
  const [profileRes, homeroomRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id')
      .eq('role', 'smartboard')
      .eq('grade', grade)
      .ilike('section', section),
    supabase
      .from('homerooms')
      .select('smartboard_id')
      .eq('grade', grade)
      .ilike('section', section)
      .not('smartboard_id', 'is', null),
  ])

  if (profileRes.error) console.error('fetchSmartboardIdsForGradeSection profiles error:', profileRes.error)
  if (homeroomRes.error) console.error('fetchSmartboardIdsForGradeSection homerooms error:', homeroomRes.error)

  const ids = new Set<string>()
  for (const p of profileRes.data ?? []) ids.add((p as { id: string }).id)
  for (const h of homeroomRes.data ?? []) {
    const sid = (h as { smartboard_id: string | null }).smartboard_id
    if (sid) ids.add(sid)
  }
  return [...ids]
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
  require_check: boolean
  requires_submission: boolean
  attachment_url: string | null
  attachment_name: string | null
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
  homeroom_id?: string | null
  classroom_id?: string | null
  title: string
  description?: string | null
  due_date?: string | null
  timing?: string | null
  end_time?: string | null
  edu_points?: number
  require_check?: boolean
  requires_submission?: boolean
  attachment_url?: string | null
  attachment_name?: string | null
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

/**
 * All tasks for the homeroom calendar — unions homeroom tasks
 * (homeroom_id = homeroomId) with classroom-specific tasks
 * (classroom_id IN classroomIds) within the date range.
 * De-duplicated by id, sorted by due_date / timing.
 */
export async function fetchSmartboardBoardTasks(
  homeroomId: string,
  classroomIds: string[],
  startDate: string,
  endDate: string,
): Promise<SmartboardTask[]> {
  const [hrRes, clRes] = await Promise.all([
    supabase
      .from('smartboard_tasks')
      .select('*')
      .eq('homeroom_id', homeroomId)
      .gte('due_date', startDate)
      .lte('due_date', endDate),
    classroomIds.length > 0
      ? supabase
          .from('smartboard_tasks')
          .select('*')
          .in('classroom_id', classroomIds)
          .gte('due_date', startDate)
          .lte('due_date', endDate)
      : Promise.resolve({ data: [] as SmartboardTask[], error: null }),
  ])

  if (hrRes.error) console.error('fetchSmartboardBoardTasks homeroom error:', hrRes.error)
  if (clRes.error) console.error('fetchSmartboardBoardTasks classroom error:', clRes.error)

  const byId = new Map<string, SmartboardTask>()
  for (const t of [...(hrRes.data ?? []), ...(clRes.data ?? [])] as SmartboardTask[]) {
    byId.set(t.id, t)
  }
  return [...byId.values()].sort((a, b) => {
    const d = (a.due_date ?? '').localeCompare(b.due_date ?? '')
    return d !== 0 ? d : (a.timing ?? '~').localeCompare(b.timing ?? '~')
  })
}

/**
 * The homeroom calendar a class teacher sees: every task set for their
 * homeroom(s), plus tasks mapped onto any classroom that holds their homeroom
 * students. Undated tasks are included alongside the dated ones in the window.
 * De-duplicated by id and sorted by due date / timing.
 */
export async function fetchHomeroomCalendarTasks(
  homeroomIds: string[],
  classroomIds: string[],
  startDate: string,
  endDate: string,
): Promise<SmartboardTask[]> {
  if (homeroomIds.length === 0 && classroomIds.length === 0) return []
  const inWindow = `due_date.is.null,and(due_date.gte.${startDate},due_date.lte.${endDate})`

  const [hrRes, clRes] = await Promise.all([
    homeroomIds.length > 0
      ? supabase.from('smartboard_tasks').select('*').in('homeroom_id', homeroomIds).or(inWindow)
      : Promise.resolve({ data: [] as SmartboardTask[], error: null }),
    classroomIds.length > 0
      ? supabase.from('smartboard_tasks').select('*').in('classroom_id', classroomIds).or(inWindow)
      : Promise.resolve({ data: [] as SmartboardTask[], error: null }),
  ])

  if (hrRes.error) console.error('fetchHomeroomCalendarTasks homeroom error:', hrRes.error)
  if (clRes.error) console.error('fetchHomeroomCalendarTasks classroom error:', clRes.error)

  const byId = new Map<string, SmartboardTask>()
  for (const t of [...(hrRes.data ?? []), ...(clRes.data ?? [])] as SmartboardTask[]) byId.set(t.id, t)
  return [...byId.values()].sort((a, b) => {
    const d = (a.due_date ?? '').localeCompare(b.due_date ?? '')
    return d !== 0 ? d : (a.timing ?? '~').localeCompare(b.timing ?? '~')
  })
}

/**
 * Homework tasks streamed in a classroom's Homework tab — every smart-board
 * task linked to that classroom, newest first (like the announcement stream),
 * paginated 10 at a time to avoid data waterfalls.
 */
export async function fetchClassroomHomeworkTasks(
  classroomId: string,
  limit = 10,
  offset = 0,
): Promise<SmartboardTask[]> {
  const { data, error } = await supabase
    .from('smartboard_tasks')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('fetchClassroomHomeworkTasks error:', error)
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
      homeroom_id: input.homeroom_id ?? null,
      classroom_id: input.classroom_id ?? null,
      created_by: createdBy,
      title: input.title,
      description: input.description ?? null,
      due_date: input.due_date ?? null,
      timing: input.timing ?? null,
      end_time: input.end_time ?? null,
      edu_points: Math.max(0, Math.round(input.edu_points ?? 0)),
      require_check: input.require_check ?? false,
      requires_submission: input.requires_submission ?? false,
      attachment_url: input.attachment_url ?? null,
      attachment_name: input.attachment_name ?? null,
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
  updates: Partial<Pick<SmartboardTask, 'title' | 'description' | 'due_date' | 'timing' | 'end_time' | 'classroom_id' | 'edu_points' | 'require_check' | 'requires_submission' | 'attachment_url' | 'attachment_name'>>,
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

/**
 * Uploads a file to attach to a smart board task. Reuses the shared
 * `classroom-files` bucket under a `smartboard-tasks/` prefix and returns the
 * public URL + original name (or null on failure).
 */
export async function uploadSmartboardTaskAttachment(
  file: File,
  homeroomId: string,
): Promise<{ url: string; name: string } | null> {
  const compressed = await compressImageIfNeeded(file)
  const safe = compressed.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `smartboard-tasks/${homeroomId}/${Date.now()}_${safe}`
  const { error } = await supabase.storage.from('classroom-files').upload(path, compressed, { upsert: true, cacheControl: '31536000' })
  if (error) {
    console.error('uploadSmartboardTaskAttachment error:', error)
    return null
  }
  const { data } = supabase.storage.from('classroom-files').getPublicUrl(path)
  return { url: data.publicUrl, name: compressed.name }
}

// ============================================
// Task completions (per homeroom member)
// ============================================

/**
 * Completion rows for a task, one per student. The roster is whoever the task
 * actually reaches: the classroom's students when it names a classroom (a
 * mapped task is scoped to that classroom — see fetchStudentHomeroomTasks),
 * otherwise the homeroom's members. Students without a row yet are returned
 * with a synthetic 'not_done' completion so the board sees who hasn't started.
 */
export async function fetchTaskCompletions(
  task: Pick<SmartboardTask, 'id' | 'homeroom_id' | 'classroom_id'>,
): Promise<SmartboardTaskCompletion[]> {
  const studentSelect = `id, email, full_name, role, avatar_url, grade, section`

  let memberIds: { student_id: string; student?: UserProfile }[] = []
  if (!task.classroom_id && task.homeroom_id) {
    const { data: members } = await supabase
      .from('homeroom_members')
      .select(`student_id, student:profiles!homeroom_members_student_id_fkey(${studentSelect})`)
      .eq('homeroom_id', task.homeroom_id)
      .order('created_at', { ascending: true })
    memberIds = (members ?? []).map(m => ({
      student_id: m.student_id,
      student: (Array.isArray(m.student) ? m.student[0] : m.student) as UserProfile | undefined,
    }))
  } else if (task.classroom_id) {
    // Two queries (members, then profiles) — matches how the rest of the app
    // joins classroom_members to profiles, avoiding the embedded FK join.
    const { data: members } = await supabase
      .from('classroom_members')
      .select('user_id')
      .eq('classroom_id', task.classroom_id)
      .eq('role', 'student')
      .order('created_at', { ascending: true })
    const userIds = (members ?? []).map(m => (m as { user_id: string }).user_id)
    let profileById = new Map<string, UserProfile>()
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select(studentSelect)
        .in('id', userIds)
      profileById = new Map((profiles ?? []).map(p => [(p as UserProfile).id, p as UserProfile]))
    }
    memberIds = userIds.map(uid => ({ student_id: uid, student: profileById.get(uid) }))
  }

  const { data: rows } = await supabase
    .from('smartboard_task_completions')
    .select('*')
    .eq('task_id', task.id)

  const rowByStudent: Record<string, SmartboardTaskCompletion> = {}
  for (const r of rows ?? []) rowByStudent[r.student_id] = r as SmartboardTaskCompletion

  return memberIds.map(m => {
    const existing = rowByStudent[m.student_id]
    return existing
      ? { ...existing, student: m.student }
      : {
          id: `pending-${m.student_id}`,
          task_id: task.id,
          student_id: m.student_id,
          status: 'not_done' as SmartboardTaskStatus,
          submission: null,
          updated_at: '',
          student: m.student,
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

/** Fetches a student's own completion rows for a set of task IDs. */
export async function fetchStudentCompletionsForTasks(
  taskIds: string[],
  studentId: string,
): Promise<Record<string, { status: SmartboardTaskStatus; submission: string | null }>> {
  if (taskIds.length === 0) return {}
  const { data, error } = await supabase
    .from('smartboard_task_completions')
    .select('task_id, status, submission')
    .in('task_id', taskIds)
    .eq('student_id', studentId)
  if (error) {
    console.error('fetchStudentCompletionsForTasks error:', error)
    return {}
  }
  const map: Record<string, { status: SmartboardTaskStatus; submission: string | null }> = {}
  for (const row of (data ?? []) as Array<{ task_id: string; status: string; submission: string | null }>) {
    map[row.task_id] = { status: row.status as SmartboardTaskStatus, submission: row.submission }
  }
  return map
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
 * Every smart-board task reflected onto a student's calendar within an
 * inclusive [startDate, endDate] window, joined with the student's own
 * completion row (defaulting to 'not_done'). Two sources are unioned:
 *   • homeroom tasks — tasks in any homeroom the student belongs to
 *   • classroom homework — tasks linked to any classroom the student is in
 * (the same task may be both; it is de-duplicated by id).
 *
 * Mapping a task to a classroom *narrows* it: a homeroom task that also names
 * a classroom reaches only the homeroom students enrolled in that classroom,
 * so a class teacher can set work for one subject group without it landing on
 * the whole homeroom's calendar.
 */
export async function fetchStudentHomeroomTasks(
  studentId: string,
  startDate: string,
  endDate: string,
): Promise<StudentHomeroomTask[]> {
  // 1. The student's homerooms + classrooms.
  const [{ data: hrMemberships }, { data: clMemberships }] = await Promise.all([
    supabase.from('homeroom_members').select('homeroom_id').eq('student_id', studentId),
    supabase.from('classroom_members').select('classroom_id').eq('user_id', studentId).eq('role', 'student'),
  ])

  const homeroomIds = (hrMemberships ?? []).map((m: { homeroom_id: string }) => m.homeroom_id)
  const myClassroomIds = (clMemberships ?? []).map((m: { classroom_id: string }) => m.classroom_id)
  if (homeroomIds.length === 0 && myClassroomIds.length === 0) return []

  // 2. Homeroom tasks + classroom homework within the window (parallel).
  // Include tasks with null due_date (undated tasks) alongside dated ones.
  const [hrRes, clRes] = await Promise.all([
    homeroomIds.length > 0
      ? supabase.from('smartboard_tasks').select('*')
          .in('homeroom_id', homeroomIds)
          .or(`due_date.is.null,and(due_date.gte.${startDate},due_date.lte.${endDate})`)
      : Promise.resolve({ data: [] as SmartboardTask[], error: null }),
    myClassroomIds.length > 0
      ? supabase.from('smartboard_tasks').select('*')
          .in('classroom_id', myClassroomIds)
          .or(`due_date.is.null,and(due_date.gte.${startDate},due_date.lte.${endDate})`)
      : Promise.resolve({ data: [] as SmartboardTask[], error: null }),
  ])

  if (hrRes.error) console.error('fetchStudentHomeroomTasks homeroom error:', hrRes.error)
  if (clRes.error) console.error('fetchStudentHomeroomTasks classroom error:', clRes.error)

  // Merge + de-dupe by id, then sort by due date / timing. A task that names a
  // classroom is scoped to it — drop those the student isn't enrolled in, which
  // the homeroom query would otherwise let through.
  const myClassroomIdSet = new Set(myClassroomIds)
  const byId = new Map<string, SmartboardTask>()
  for (const t of [...(hrRes.data ?? []), ...(clRes.data ?? [])] as SmartboardTask[]) {
    if (t.classroom_id && !myClassroomIdSet.has(t.classroom_id)) continue
    byId.set(t.id, t)
  }
  const tasks = [...byId.values()].sort((a, b) => {
    const d = (a.due_date ?? '').localeCompare(b.due_date ?? '')
    return d !== 0 ? d : (a.timing ?? '~').localeCompare(b.timing ?? '~')
  })
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
    homeroomIds.length > 0
      ? supabase.from('homerooms').select('id, name').in('id', homeroomIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
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
      homeroom_name: t.homeroom_id ? homeroomName.get(t.homeroom_id) ?? null : null,
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

/**
 * Top 3 students by EduPoints for a classroom.
 * Merges file-based points (get_classroom_edu_top3) and homework-task points
 * (get_classroom_homework_edu_top3) so neither migration order nor prior
 * application of update_classroom_edu_top3_with_homework causes double-counting.
 */
export async function fetchClassroomTop3(classroomId: string): Promise<ClassroomTop3Entry[]> {
  const [fileRes, hwRes] = await Promise.all([
    supabase.rpc('get_classroom_edu_top3', { p_classroom_id: classroomId }),
    supabase.rpc('get_classroom_homework_edu_top3', { p_classroom_id: classroomId }),
  ])

  if (fileRes.error) console.error('fetchClassroomTop3 file error:', fileRes.error)
  if (hwRes.error) console.error('fetchClassroomTop3 hw error:', hwRes.error)

  const combined: Record<string, { full_name: string; avatar_url: string | null; points: number }> = {}

  for (const e of (fileRes.data ?? []) as ClassroomTop3Entry[]) {
    combined[e.student_id] = {
      full_name: e.full_name,
      avatar_url: e.avatar_url,
      points: (combined[e.student_id]?.points ?? 0) + e.points,
    }
  }

  for (const e of (hwRes.data ?? []) as { student_id: string; full_name: string; avatar_url: string | null; points: number }[]) {
    if (combined[e.student_id]) {
      combined[e.student_id].points += e.points
    } else {
      combined[e.student_id] = { full_name: e.full_name, avatar_url: e.avatar_url, points: e.points }
    }
  }

  return Object.entries(combined)
    .map(([student_id, d]) => ({ student_id, ...d }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((e, i) => ({ ...e, rank: i + 1 }))
}
