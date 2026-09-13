import { supabase, UserProfile, UserRole } from './supabase'
import { compressImageIfNeeded } from './imageCompression'

// --- Types ---

export type ClassroomMemberRole = 'student' | 'teacher' | 'coordinator' | 'principal' | 'admin'
export type FolderType = 'coursework' | 'homework'
export type FileStatus = 'not_done' | 'partial' | 'done' | 'completed'
export type SubmissionType = 'text' | 'link' | 'file'
export type AssessmentTag = 'main' | 'other'

export interface Classroom {
  id: string
  title: string
  description: string | null
  grade: number | null
  section: string | null
  subject: string | null
  start_date: string | null
  end_date: string | null
  coordinator_id: string | null
  banner_url: string | null
  logo_url: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ClassroomMember {
  id: string
  classroom_id: string
  user_id: string
  role: ClassroomMemberRole
  created_at: string
  user?: UserProfile
}

export interface ClassroomWithDetails extends Classroom {
  members: ClassroomMember[]
  coordinator?: UserProfile
  creator?: UserProfile
  member_count?: number
}

export interface ClassroomFolder {
  id: string
  classroom_id: string
  type: FolderType
  title: string
  description: string | null
  due_date: string | null
  sort_order: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface ClassroomFile {
  id: string
  folder_id: string
  title: string
  description: string | null
  due_date: string | null
  requires_submission: boolean
  submission_type: SubmissionType | null
  requires_check: boolean
  edu_points: number
  attachment_url: string | null
  attachment_name: string | null
  sort_order: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface FileProgress {
  id: string
  file_id: string
  student_id: string
  status: FileStatus
  updated_at: string
  student?: UserProfile
}

export interface FileSubmission {
  id: string
  file_id: string
  student_id: string
  content: string
  submission_type: SubmissionType
  submitted_at: string
  updated_at: string
  student?: UserProfile
}

export interface ClassroomAssessment {
  id: string
  classroom_id: string
  title: string
  description: string | null
  date: string | null
  tag: AssessmentTag
  report_card_title: string | null
  max_marks: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface AssessmentMark {
  id: string
  assessment_id: string
  student_id: string
  marks: number | null
  max_marks: number
  is_absent: boolean
  created_at: string
  updated_at: string
  student?: UserProfile
}

export interface DiscussionPost {
  id: string
  classroom_id: string
  user_id: string
  content: string
  parent_id: string | null
  created_at: string
  updated_at: string
  user?: UserProfile
  replies?: DiscussionPost[]
}

// --- Helpers ---

/** Returns true if the classroom's end_date is in the past (classroom is closed). */
export function isClassroomClosed(classroom: Pick<Classroom, 'end_date'>): boolean {
  if (!classroom.end_date) return false
  const today = new Date().toISOString().split('T')[0]
  return classroom.end_date < today
}

/** Upload a classroom banner or logo image and return the public URL. */
export async function uploadClassroomImage(
  classroomId: string,
  file: File,
  kind: 'banner' | 'logo',
): Promise<string | null> {
  const compressed = await compressImageIfNeeded(file)
  const safeName = compressed.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${classroomId}/${kind}_${Date.now()}_${safeName}`

  const { data, error } = await supabase.storage
    .from('classroom-files')
    .upload(path, compressed, { upsert: true, cacheControl: '31536000' })

  if (error) {
    console.error(`Failed to upload ${kind}:`, error.message)
    return null
  }

  const { data: { publicUrl } } = supabase.storage
    .from('classroom-files')
    .getPublicUrl(data.path)

  // Save URL to classroom row
  const { error: updateErr } = await supabase
    .from('classrooms')
    .update({ [`${kind}_url`]: publicUrl, updated_at: new Date().toISOString() })
    .eq('id', classroomId)

  if (updateErr) {
    console.error(`Failed to update classroom ${kind}_url:`, updateErr.message)
    return null
  }

  return publicUrl
}

// --- Classroom CRUD ---

export async function createClassroom(input: {
  title: string
  description?: string
  grade?: number | null
  section?: string | null
  subject?: string | null
  start_date?: string
  end_date?: string
  coordinator_id?: string
  creatorRole?: string
}, createdBy: string): Promise<Classroom | null> {
  const id = crypto.randomUUID()

  const { error } = await supabase
    .from('classrooms')
    .insert({
      id,
      title: input.title,
      description: input.description || null,
      grade: input.grade ?? null,
      section: input.section || null,
      subject: input.subject || null,
      start_date: input.start_date || null,
      end_date: input.end_date || null,
      coordinator_id: input.coordinator_id || null,
      created_by: createdBy,
    })

  if (error) {
    console.error('Failed to create classroom:', error.message, error.code)
    return null
  }

  // Add creator as member with their actual role (admin/principal/teacher)
  const creatorRole = (['admin', 'principal', 'teacher', 'coordinator'].includes(input.creatorRole || '')
    ? input.creatorRole
    : 'teacher') as ClassroomMemberRole
  await addClassroomMember(id, createdBy, creatorRole)

  // Add coordinator if specified and different from creator
  if (input.coordinator_id && input.coordinator_id !== createdBy) {
    await addClassroomMember(id, input.coordinator_id, 'coordinator')
  }

  return {
    id,
    title: input.title,
    description: input.description || null,
    grade: input.grade ?? null,
    section: input.section || null,
    subject: input.subject || null,
    start_date: input.start_date || null,
    end_date: input.end_date || null,
    coordinator_id: input.coordinator_id || null,
    banner_url: null,
    logo_url: null,
    created_by: createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function updateClassroom(classroomId: string, input: {
  title?: string
  description?: string | null
  grade?: number | null
  section?: string | null
  subject?: string | null
  start_date?: string | null
  end_date?: string | null
  coordinator_id?: string | null
}): Promise<boolean> {
  const { error } = await supabase
    .from('classrooms')
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .eq('id', classroomId)

  if (error) {
    console.error('Failed to update classroom:', error.message)
    return false
  }
  return true
}

/**
 * Fetch classrooms for a user.
 * - includeAll: if true, returns all classrooms including closed ones (for admin manager).
 *   If false (default), only returns active classrooms (end_date is null or in the future).
 */
/**
 * Lightweight list of every classroom (id, title, subject, grade, section) for
 * admin pickers — e.g. the subject-classroom filter that bulk-adds a homeroom's
 * students into a timetable group.
 */
export async function fetchAllClassrooms(): Promise<Classroom[]> {
  const { data, error } = await supabase
    .from('classrooms')
    .select('*')
    .order('title', { ascending: true })
  if (error) {
    console.error('fetchAllClassrooms error:', error)
    return []
  }
  return (data ?? []) as Classroom[]
}

export async function fetchClassroomsForUser(
  userId: string,
  userRole: UserRole,
  includeAll = false,
  limit?: number,
  // Callers that render only title/grade/banner (e.g. the home and academics
  // dashboard grids) never display this — skip it there to avoid pulling
  // every classroom_members row for the whole school just to count them.
  withMemberCount = true,
): Promise<ClassroomWithDetails[]> {
  const today = new Date().toISOString().split('T')[0]

  // Principals and admins see all classrooms
  if (['principal', 'admin'].includes(userRole)) {
    let query = supabase
      .from('classrooms')
      .select('*')
      .order('created_at', { ascending: false })

    if (!includeAll) {
      query = query.or(`end_date.is.null,end_date.gte.${today}`)
    }
    if (limit) query = query.limit(limit)

    const { data, error } = await query

    if (error) {
      console.error('Failed to fetch classrooms:', error.message)
      return []
    }

    // Skip member-count query when a preview limit is set (saves a full-table scan)
    if (limit || !withMemberCount) {
      return (data ?? []).map((c: Classroom) => ({ ...c, members: [], member_count: 0 }))
    }

    const classroomIds = (data ?? []).map((c: Classroom) => c.id)
    const { data: members } = await supabase
      .from('classroom_members')
      .select('classroom_id, user_id')
      .in('classroom_id', classroomIds.length > 0 ? classroomIds : ['__none__'])

    const countMap: Record<string, number> = {}
    for (const m of members ?? []) {
      countMap[m.classroom_id] = (countMap[m.classroom_id] || 0) + 1
    }

    return (data ?? []).map((c: Classroom) => ({
      ...c,
      members: [],
      member_count: countMap[c.id] || 0,
    }))
  }

  // Others see only classrooms they're members of
  const { data: memberships, error: memErr } = await supabase
    .from('classroom_members')
    .select('classroom_id')
    .eq('user_id', userId)

  if (memErr || !memberships || memberships.length === 0) {
    return []
  }

  const classroomIds = memberships.map((m: { classroom_id: string }) => m.classroom_id)

  let query = supabase
    .from('classrooms')
    .select('*')
    .in('id', classroomIds)
    .order('created_at', { ascending: false })

  if (!includeAll) {
    query = query.or(`end_date.is.null,end_date.gte.${today}`)
  }
  if (limit) query = query.limit(limit)

  const { data, error } = await query

  if (error) {
    console.error('Failed to fetch classrooms:', error.message)
    return []
  }

  if (limit || !withMemberCount) {
    return (data ?? []).map((c: Classroom) => ({ ...c, members: [], member_count: 0 }))
  }

  // Fetch member counts only for the returned classroom IDs
  const returnedIds = (data ?? []).map((c: Classroom) => c.id)
  const { data: allMembers } = await supabase
    .from('classroom_members')
    .select('classroom_id, user_id')
    .in('classroom_id', returnedIds)

  const countMap: Record<string, number> = {}
  for (const m of allMembers ?? []) {
    countMap[m.classroom_id] = (countMap[m.classroom_id] || 0) + 1
  }

  return (data ?? []).map((c: Classroom) => ({
    ...c,
    members: [],
    member_count: countMap[c.id] || 0,
  }))
}

export async function fetchClassroomById(classroomId: string): Promise<ClassroomWithDetails | null> {
  // Fetch classroom metadata and member list in parallel
  const [{ data, error }, { data: members }] = await Promise.all([
    supabase.from('classrooms').select('*').eq('id', classroomId).single(),
    supabase.from('classroom_members').select('*').eq('classroom_id', classroomId),
  ])

  if (error || !data) {
    console.error('Failed to fetch classroom:', error?.message)
    return null
  }

  const memberUserIds = (members ?? []).map((m: ClassroomMember) => m.user_id)
  let profiles: UserProfile[] = []
  if (memberUserIds.length > 0) {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('*')
      .in('id', memberUserIds)
    profiles = (profilesData ?? []) as UserProfile[]
  }

  const profileMap = new Map(profiles.map((p) => [p.id, p]))

  const enrichedMembers = (members ?? []).map((m: ClassroomMember) => ({
    ...m,
    user: profileMap.get(m.user_id) || undefined,
  }))

  return {
    ...data,
    members: enrichedMembers,
    coordinator: data.coordinator_id ? profileMap.get(data.coordinator_id) : undefined,
    member_count: enrichedMembers.length,
  } as ClassroomWithDetails
}

// --- Members ---

export async function addClassroomMember(classroomId: string, userId: string, role: ClassroomMemberRole): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_members')
    .insert({ classroom_id: classroomId, user_id: userId, role })

  if (error) {
    // Ignore duplicate
    if (error.code === '23505') return true
    console.error('Failed to add classroom member:', error.message)
    return false
  }
  return true
}

export async function addMemberByEmail(classroomId: string, email: string): Promise<{ success: boolean; error?: string }> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('email', email.trim().toLowerCase())
    .single()

  if (profileError || !profile) {
    return { success: false, error: 'User not found with that email' }
  }

  // Auto-detect classroom role from profile role
  const classroomRole: ClassroomMemberRole = profile.role === 'student' ? 'student' : 'teacher'

  const success = await addClassroomMember(classroomId, profile.id, classroomRole)
  return { success, error: success ? undefined : 'Failed to add member' }
}

export async function deleteClassroom(classroomId: string): Promise<boolean> {
  const { error } = await supabase
    .from('classrooms')
    .delete()
    .eq('id', classroomId)

  if (error) {
    console.error('Failed to delete classroom:', error.message)
    return false
  }
  return true
}

export async function removeClassroomMember(classroomId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_members')
    .delete()
    .eq('classroom_id', classroomId)
    .eq('user_id', userId)

  if (error) {
    console.error('Failed to remove classroom member:', error.message)
    return false
  }
  return true
}

// --- Folders ---

export async function createFolder(input: {
  classroom_id: string
  type: FolderType
  title: string
  description?: string
  due_date?: string
}, createdBy: string): Promise<ClassroomFolder | null> {
  const id = crypto.randomUUID()
  const { error } = await supabase
    .from('classroom_folders')
    .insert({
      id,
      classroom_id: input.classroom_id,
      type: input.type,
      title: input.title,
      description: input.description || null,
      due_date: input.due_date || null,
      created_by: createdBy,
    })

  if (error) {
    console.error('Failed to create folder:', error.message)
    return null
  }

  return {
    id,
    classroom_id: input.classroom_id,
    type: input.type,
    title: input.title,
    description: input.description || null,
    due_date: input.due_date || null,
    sort_order: 0,
    created_by: createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function updateFolder(folderId: string, input: {
  title?: string
  description?: string | null
  due_date?: string | null
}): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_folders')
    .update({
      title: input.title,
      description: input.description,
      due_date: input.due_date,
      updated_at: new Date().toISOString(),
    })
    .eq('id', folderId)

  if (error) {
    console.error('Failed to update folder:', error.message)
    return false
  }
  return true
}

export async function updateFolderOrder(folderId: string, sortOrder: number): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_folders')
    .update({ sort_order: sortOrder, updated_at: new Date().toISOString() })
    .eq('id', folderId)
  if (error) {
    console.error('Failed to update folder order:', error.message)
    return false
  }
  return true
}

export async function fetchFolders(classroomId: string, type: FolderType): Promise<ClassroomFolder[]> {
  const { data, error } = await supabase
    .from('classroom_folders')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('type', type)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch folders:', error.message)
    return []
  }

  return (data ?? []) as ClassroomFolder[]
}

export async function deleteFolder(folderId: string): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_folders')
    .delete()
    .eq('id', folderId)
  return !error
}

// --- Files ---

export async function createFile(input: {
  folder_id: string
  title: string
  description?: string
  due_date?: string
  requires_submission?: boolean
  submission_type?: SubmissionType
  requires_check?: boolean
  edu_points?: number
  attachment_url?: string
  attachment_name?: string
}, createdBy: string): Promise<ClassroomFile | null> {
  const id = crypto.randomUUID()
  const eduPoints = Math.max(0, Math.round(input.edu_points || 0))
  const { error } = await supabase
    .from('classroom_files')
    .insert({
      id,
      folder_id: input.folder_id,
      title: input.title,
      description: input.description || null,
      due_date: input.due_date || null,
      requires_submission: input.requires_submission || false,
      submission_type: input.requires_submission ? (input.submission_type || 'text') : null,
      requires_check: input.requires_check || false,
      edu_points: eduPoints,
      attachment_url: input.attachment_url || null,
      attachment_name: input.attachment_name || null,
      created_by: createdBy,
    })

  if (error) {
    console.error('Failed to create file:', error.message)
    return null
  }

  return {
    id,
    folder_id: input.folder_id,
    title: input.title,
    description: input.description || null,
    due_date: input.due_date || null,
    requires_submission: input.requires_submission || false,
    submission_type: input.requires_submission ? (input.submission_type || 'text') : null,
    requires_check: input.requires_check || false,
    edu_points: eduPoints,
    attachment_url: input.attachment_url || null,
    attachment_name: input.attachment_name || null,
    sort_order: 0,
    created_by: createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function fetchFilesForFolder(folderId: string): Promise<ClassroomFile[]> {
  const { data, error } = await supabase
    .from('classroom_files')
    .select('*')
    .eq('folder_id', folderId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch files:', error.message)
    return []
  }
  return (data ?? []) as ClassroomFile[]
}

export async function deleteFile(fileId: string): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_files')
    .delete()
    .eq('id', fileId)
  return !error
}

export async function updateFile(fileId: string, input: {
  title: string
  description?: string | null
  due_date?: string | null
  requires_submission?: boolean
  requires_check?: boolean
  edu_points?: number
  attachment_url?: string | null
  attachment_name?: string | null
}): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_files')
    .update({
      title: input.title,
      description: input.description ?? null,
      due_date: input.due_date ?? null,
      requires_submission: input.requires_submission ?? false,
      requires_check: input.requires_check ?? false,
      edu_points: Math.max(0, Math.round(input.edu_points || 0)),
      attachment_url: input.attachment_url ?? null,
      attachment_name: input.attachment_name ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fileId)

  if (error) {
    console.error('Failed to update file:', error.message)
    return false
  }
  return true
}

// --- File Progress ---

export async function updateFileProgress(fileId: string, studentId: string, status: FileStatus): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_file_progress')
    .upsert({
      file_id: fileId,
      student_id: studentId,
      status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'file_id,student_id' })

  if (error) {
    console.error('Failed to update file progress:', error.message)
    return false
  }
  return true
}

export async function fetchFileProgress(fileId: string): Promise<FileProgress[]> {
  const { data, error } = await supabase
    .from('classroom_file_progress')
    .select('*')
    .eq('file_id', fileId)

  if (error) {
    console.error('Failed to fetch file progress:', error.message)
    return []
  }
  return (data ?? []) as FileProgress[]
}

export async function fetchProgressForStudent(studentId: string, fileIds: string[]): Promise<FileProgress[]> {
  if (fileIds.length === 0) return []
  const { data, error } = await supabase
    .from('classroom_file_progress')
    .select('*')
    .eq('student_id', studentId)
    .in('file_id', fileIds)

  if (error) {
    console.error('Failed to fetch student progress:', error.message)
    return []
  }
  return (data ?? []) as FileProgress[]
}

// --- Submissions ---

export async function submitWork(fileId: string, studentId: string, content: string, submissionType: SubmissionType): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_submissions')
    .upsert({
      file_id: fileId,
      student_id: studentId,
      content,
      submission_type: submissionType,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'file_id,student_id' })

  if (error) {
    console.error('Failed to submit work:', error.message)
    return false
  }
  return true
}

export async function fetchSubmissions(fileId: string): Promise<FileSubmission[]> {
  const { data, error } = await supabase
    .from('classroom_submissions')
    .select('*')
    .eq('file_id', fileId)

  if (error) {
    console.error('Failed to fetch submissions:', error.message)
    return []
  }
  return (data ?? []) as FileSubmission[]
}

export async function fetchStudentSubmissionsForFiles(fileIds: string[], studentId: string): Promise<FileSubmission[]> {
  if (fileIds.length === 0) return []
  const { data, error } = await supabase
    .from('classroom_submissions')
    .select('*')
    .eq('student_id', studentId)
    .in('file_id', fileIds)

  if (error) {
    console.error('Failed to fetch student submissions:', error.message)
    return []
  }
  return (data ?? []) as FileSubmission[]
}

// --- Assessments ---

export async function createAssessment(input: {
  classroom_id: string
  title: string
  description?: string
  date?: string
  tag: AssessmentTag
  report_card_title?: string | null
  max_marks?: number
}, createdBy: string): Promise<ClassroomAssessment | null> {
  const id = crypto.randomUUID()
  const maxMarks = input.max_marks && input.max_marks > 0 ? input.max_marks : 100
  const { error } = await supabase
    .from('classroom_assessments')
    .insert({
      id,
      classroom_id: input.classroom_id,
      title: input.title,
      description: input.description || null,
      date: input.date || null,
      tag: input.tag,
      report_card_title: input.report_card_title || null,
      max_marks: maxMarks,
      created_by: createdBy,
    })

  if (error) {
    console.error('Failed to create assessment:', error.message)
    return null
  }

  return {
    id,
    classroom_id: input.classroom_id,
    title: input.title,
    description: input.description || null,
    date: input.date || null,
    tag: input.tag,
    report_card_title: input.report_card_title || null,
    max_marks: maxMarks,
    created_by: createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function fetchAssessments(classroomId: string): Promise<ClassroomAssessment[]> {
  const { data, error } = await supabase
    .from('classroom_assessments')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('date', { ascending: false })

  if (error) {
    console.error('Failed to fetch assessments:', error.message)
    return []
  }
  return (data ?? []) as ClassroomAssessment[]
}

export async function deleteAssessment(assessmentId: string): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_assessments')
    .delete()
    .eq('id', assessmentId)
  return !error
}

export async function updateAssessment(
  assessmentId: string,
  updates: Partial<Pick<ClassroomAssessment, 'title' | 'description' | 'date' | 'tag' | 'report_card_title' | 'max_marks'>>
): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_assessments')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', assessmentId)
  if (error) { console.error('Failed to update assessment:', error.message); return false }

  // Max marks is uniform for the whole assessment — cascade it onto every
  // existing mark row so per-student totals never drift out of sync.
  if (updates.max_marks != null) {
    const { error: cascadeError } = await supabase
      .from('classroom_assessment_marks')
      .update({ max_marks: updates.max_marks, updated_at: new Date().toISOString() })
      .eq('assessment_id', assessmentId)
    if (cascadeError) {
      console.error('Failed to cascade max_marks to existing marks:', cascadeError.message)
      return false
    }
  }
  return true
}

export async function upsertAssessmentMark(
  assessmentId: string,
  studentId: string,
  marks: number | null,
  maxMarks: number,
  isAbsent: boolean = false,
): Promise<boolean> {
  // Defensive validation — the UI already prevents these, but never trust
  // the caller alone for data integrity.
  if (marks != null && !isAbsent && (marks < 0 || marks > maxMarks)) {
    console.error('Rejected mark outside valid range:', marks, 'max:', maxMarks)
    return false
  }

  const { error } = await supabase
    .from('classroom_assessment_marks')
    .upsert({
      assessment_id: assessmentId,
      student_id: studentId,
      marks: isAbsent ? null : marks,
      max_marks: maxMarks,
      is_absent: isAbsent,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'assessment_id,student_id' })

  if (error) {
    console.error('Failed to upsert mark:', error.message)
    return false
  }
  return true
}

/** Batch form of upsertAssessmentMark — one round trip for a whole marksheet
 *  instead of one upsert per student. Entries failing the same range check
 *  upsertAssessmentMark applies are silently dropped from the batch. */
export async function upsertAssessmentMarks(
  assessmentId: string,
  entries: { studentId: string; marks: number | null; maxMarks: number; isAbsent?: boolean }[],
): Promise<boolean> {
  const rows = entries
    .filter(e => e.isAbsent || e.marks == null || (e.marks >= 0 && e.marks <= e.maxMarks))
    .map(e => ({
      assessment_id: assessmentId,
      student_id: e.studentId,
      marks: e.isAbsent ? null : e.marks,
      max_marks: e.maxMarks,
      is_absent: e.isAbsent ?? false,
      updated_at: new Date().toISOString(),
    }))
  if (rows.length === 0) return true

  const { error } = await supabase
    .from('classroom_assessment_marks')
    .upsert(rows, { onConflict: 'assessment_id,student_id' })

  if (error) {
    console.error('Failed to upsert marks:', error.message)
    return false
  }
  return true
}

export async function fetchAssessmentMarks(assessmentId: string): Promise<AssessmentMark[]> {
  const { data, error } = await supabase
    .from('classroom_assessment_marks')
    .select('*')
    .eq('assessment_id', assessmentId)

  if (error) {
    console.error('Failed to fetch marks:', error.message)
    return []
  }
  return (data ?? []) as AssessmentMark[]
}

/** One student's marks across a set of assessments, in one round trip instead
 *  of fetching every student's marks per assessment and filtering client-side. */
export async function fetchStudentAssessmentMarks(
  studentId: string,
  assessmentIds: string[],
): Promise<Record<string, AssessmentMark>> {
  if (assessmentIds.length === 0) return {}
  const { data, error } = await supabase
    .from('classroom_assessment_marks')
    .select('*')
    .eq('student_id', studentId)
    .in('assessment_id', assessmentIds)

  if (error) {
    console.error('Failed to fetch student marks:', error.message)
    return {}
  }
  const byAssessment: Record<string, AssessmentMark> = {}
  for (const m of (data ?? []) as AssessmentMark[]) byAssessment[m.assessment_id] = m
  return byAssessment
}

export interface StudentMarkWithContext {
  marks: number | null
  max_marks: number
  assessment_title: string
  assessment_date: string | null
  classroom_title: string
  classroom_start_date: string | null
}

export async function fetchMarksForStudent(studentId: string): Promise<StudentMarkWithContext[]> {
  const { data, error } = await supabase
    .from('classroom_assessment_marks')
    .select(`
      marks, max_marks,
      classroom_assessments (
        title, date,
        classrooms ( title, start_date )
      )
    `)
    .eq('student_id', studentId)

  if (error) {
    console.error('Failed to fetch student marks:', error.message)
    return []
  }

  return (data ?? []).map((d: any) => ({
    marks: d.marks,
    max_marks: d.max_marks,
    assessment_title: d.classroom_assessments?.title ?? '—',
    assessment_date: d.classroom_assessments?.date ?? null,
    classroom_title: d.classroom_assessments?.classrooms?.title ?? '—',
    classroom_start_date: d.classroom_assessments?.classrooms?.start_date ?? null,
  }))
}

// --- Discussion ---

export async function uploadDiscussionFile(
  file: File,
  classroomId: string,
  userId: string,
): Promise<{ url: string; name: string; type: 'image' | 'document' } | null> {
  const isImage = file.type.startsWith('image/')
  const compressed = isImage ? await compressImageIfNeeded(file) : file
  const ext  = compressed.name.split('.').pop() ?? 'bin'
  const path = `discussions/${classroomId}/${userId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('classroom-files').upload(path, compressed, { cacheControl: '31536000' })
  if (error) return null
  const { data } = supabase.storage.from('classroom-files').getPublicUrl(path)
  return { url: data.publicUrl, name: compressed.name, type: isImage ? 'image' : 'document' }
}

export async function createDiscussionPost(classroomId: string, userId: string, content: string, parentId?: string): Promise<DiscussionPost | null> {
  const id = crypto.randomUUID()
  const { error } = await supabase
    .from('classroom_discussions')
    .insert({
      id,
      classroom_id: classroomId,
      user_id: userId,
      content,
      parent_id: parentId || null,
    })

  if (error) {
    console.error('Failed to create discussion post:', error.message)
    return null
  }

  return {
    id,
    classroom_id: classroomId,
    user_id: userId,
    content,
    parent_id: parentId || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function fetchDiscussionPosts(classroomId: string): Promise<DiscussionPost[]> {
  const { data, error } = await supabase
    .from('classroom_discussions')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch discussions:', error.message)
    return []
  }

  // Fetch user profiles
  const userIds = [...new Set((data ?? []).map((d: DiscussionPost) => d.user_id))]
  let profiles: UserProfile[] = []
  if (userIds.length > 0) {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('*')
      .in('id', userIds)
    profiles = (profilesData ?? []) as UserProfile[]
  }
  const profileMap = new Map(profiles.map((p) => [p.id, p]))

  const posts = (data ?? []).map((d: DiscussionPost) => ({
    ...d,
    user: profileMap.get(d.user_id),
  })) as DiscussionPost[]

  // Organize into tree: top-level posts with replies
  const topLevel = posts.filter((p) => !p.parent_id)
  const replies = posts.filter((p) => p.parent_id)

  for (const post of topLevel) {
    post.replies = replies.filter((r) => r.parent_id === post.id)
  }

  return topLevel
}

export async function deleteDiscussionPost(postId: string): Promise<boolean> {
  const { error } = await supabase
    .from('classroom_discussions')
    .delete()
    .eq('id', postId)
  return !error
}

// --- Helpers ---

export async function fetchCoordinators(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'coordinator')
    .order('full_name', { ascending: true })

  if (error) {
    console.error('Failed to fetch coordinators:', error.message)
    return []
  }
  return (data ?? []) as UserProfile[]
}

/** Fetches ALL file progress records across the given file IDs (any student). For staff use. */
export async function fetchProgressForFiles(fileIds: string[]): Promise<FileProgress[]> {
  if (fileIds.length === 0) return []
  const { data, error } = await supabase
    .from('classroom_file_progress')
    .select('*')
    .in('file_id', fileIds)

  if (error) {
    console.error('Failed to fetch progress for files:', error.message)
    return []
  }
  return (data ?? []) as FileProgress[]
}

/** Extracts a YouTube embed URL from any YouTube share/watch/embed link. Returns null if not YouTube. */
export function extractYouTubeEmbedUrl(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return `https://www.youtube.com/embed/${match[1]}`
  }
  return null
}

/** Uploads a document file to Supabase storage and returns its public URL and name.
 *  Requires a 'classroom-files' storage bucket in Supabase with public read access.
 *  Max size: 20 MB. Returns { url, name } on success or { error } on failure. */
export async function uploadClassroomFile(
  classroomId: string,
  file: File,
): Promise<{ url: string; name: string } | { error: string }> {
  const MAX_SIZE = 20 * 1024 * 1024 // 20 MB
  if (file.size > MAX_SIZE) {
    return { error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.` }
  }

  const compressed = await compressImageIfNeeded(file)
  const safeName = compressed.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${classroomId}/${Date.now()}_${safeName}`

  const { data, error } = await supabase.storage
    .from('classroom-files')
    .upload(path, compressed, { upsert: false, cacheControl: '31536000' })

  if (error) {
    console.error('Failed to upload file:', error.message)
    const msg = error.message.toLowerCase()
    if (msg.includes('bucket') || msg.includes('not found') || msg.includes('does not exist')) {
      return { error: 'Storage bucket "classroom-files" not found. Please create it in Supabase Storage with public read access.' }
    }
    if (msg.includes('policy') || msg.includes('permission') || msg.includes('unauthorized')) {
      return { error: 'Upload permission denied. Check the storage bucket RLS policies.' }
    }
    return { error: `Upload failed: ${error.message}` }
  }

  const { data: { publicUrl } } = supabase.storage
    .from('classroom-files')
    .getPublicUrl(data.path)

  return { url: publicUrl, name: file.name }
}

/** Uploads a student submission file to Supabase storage.
 *  Uses the same 'classroom-files' bucket, under a 'submissions' prefix.
 *  Max size: 20 MB. Returns { url, name } on success or { error } on failure. */
export async function uploadSubmissionFile(
  fileId: string,
  studentId: string,
  file: File,
): Promise<{ url: string; name: string } | { error: string }> {
  const MAX_SIZE = 20 * 1024 * 1024
  if (file.size > MAX_SIZE) {
    return { error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.` }
  }

  const compressed = await compressImageIfNeeded(file)
  const safeName = compressed.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `submissions/${fileId}/${studentId}/${Date.now()}_${safeName}`

  const { data, error } = await supabase.storage
    .from('classroom-files')
    .upload(path, compressed, { upsert: true, cacheControl: '31536000' })

  if (error) {
    console.error('Failed to upload submission file:', error.message)
    const msg = error.message.toLowerCase()
    if (msg.includes('bucket') || msg.includes('not found') || msg.includes('does not exist')) {
      return { error: 'Storage bucket "classroom-files" not found. Please create it in Supabase Storage.' }
    }
    return { error: `Upload failed: ${error.message}` }
  }

  const { data: { publicUrl } } = supabase.storage
    .from('classroom-files')
    .getPublicUrl(data.path)

  return { url: publicUrl, name: file.name }
}

export async function fetchStudentMembers(classroomId: string): Promise<(ClassroomMember & { user: UserProfile })[]> {
  const { data: members, error } = await supabase
    .from('classroom_members')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('role', 'student')

  if (error || !members || members.length === 0) return []

  const userIds = members.map((m: ClassroomMember) => m.user_id)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', userIds)

  const profileMap = new Map((profiles ?? []).map((p: UserProfile) => [p.id, p]))

  return members
    .map((m: ClassroomMember) => ({
      ...m,
      user: profileMap.get(m.user_id),
    }))
    .filter((m: ClassroomMember & { user?: UserProfile }) => m.user) as (ClassroomMember & { user: UserProfile })[]
}

// Batch-fetch profiles for a set of ids (e.g. the `created_by` of a page's
// folders/files/assessments) and return them keyed by id, so callers can look
// up "created by" names without one round trip per row.
export async function fetchProfilesByIds(ids: (string | null | undefined)[]): Promise<Record<string, UserProfile>> {
  const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))]
  if (uniqueIds.length === 0) return {}

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .in('id', uniqueIds)

  const map: Record<string, UserProfile> = {}
  for (const p of (data ?? []) as UserProfile[]) map[p.id] = p
  return map
}

// Fetch all files across all folders for a classroom (for student dashboard calendar)
export async function fetchAllFilesForClassroom(classroomId: string): Promise<(ClassroomFile & { folder: ClassroomFolder })[]> {
  const { data: folders, error: fErr } = await supabase
    .from('classroom_folders')
    .select('*')
    .eq('classroom_id', classroomId)

  if (fErr || !folders || folders.length === 0) return []

  const folderIds = folders.map((f: ClassroomFolder) => f.id)
  const { data: files, error: fileErr } = await supabase
    .from('classroom_files')
    .select('*')
    .in('folder_id', folderIds)
    .order('due_date', { ascending: true })

  if (fileErr) return []

  const folderMap = new Map(folders.map((f: ClassroomFolder) => [f.id, f]))

  return (files ?? []).map((f: ClassroomFile) => ({
    ...f,
    folder: folderMap.get(f.folder_id)!,
  }))
}

// Batched version of fetchAllFilesForClassroom: same "all folder types, no
// date filter" semantics, but one round trip across every classroom instead
// of one round-trip pair per classroom. Pass startDate/endDate to also
// restrict to a due-date window (still all folder types, unlike
// fetchClassroomFilesForDateRange below which is coursework-only).
export async function fetchClassroomFilesBatch(
  classroomIds: string[],
  dateRange?: { startDate: string; endDate: string },
): Promise<(ClassroomFile & { folder: ClassroomFolder })[]> {
  if (classroomIds.length === 0) return []

  const { data: folders, error: fErr } = await supabase
    .from('classroom_folders')
    .select('*')
    .in('classroom_id', classroomIds)

  if (fErr || !folders || folders.length === 0) return []

  const folderIds = (folders as ClassroomFolder[]).map(f => f.id)
  let query = supabase
    .from('classroom_files')
    .select('*')
    .in('folder_id', folderIds)
    .order('due_date', { ascending: true })

  if (dateRange) {
    query = query.gte('due_date', dateRange.startDate).lte('due_date', dateRange.endDate)
  }

  const { data: files, error: fileErr } = await query
  if (fileErr) return []

  const folderMap = new Map((folders as ClassroomFolder[]).map(f => [f.id, f]))
  return (files ?? []).map((f: ClassroomFile) => ({
    ...f,
    folder: folderMap.get(f.folder_id)!,
  }))
}

// Fetch classwork files across multiple classrooms filtered to a due-date range.
// Used by the SmartboardWeeklyCalendar to show CW chips alongside HW tasks.
export async function fetchClassroomFilesForDateRange(
  classroomIds: string[],
  startDate: string,
  endDate: string,
): Promise<(ClassroomFile & { folder: ClassroomFolder })[]> {
  if (classroomIds.length === 0) return []

  const { data: folders } = await supabase
    .from('classroom_folders')
    .select('*')
    .in('classroom_id', classroomIds)
    .eq('type', 'coursework')

  if (!folders || folders.length === 0) return []

  const folderIds = (folders as ClassroomFolder[]).map(f => f.id)
  const { data: files } = await supabase
    .from('classroom_files')
    .select('*')
    .in('folder_id', folderIds)
    .gte('due_date', startDate)
    .lte('due_date', endDate)
    .order('due_date', { ascending: true })

  if (!files) return []

  const folderMap = new Map((folders as ClassroomFolder[]).map(f => [f.id, f]))
  return (files as ClassroomFile[]).map(f => ({ ...f, folder: folderMap.get(f.folder_id)! }))
}

// ── Report Card Titles & Remarks ─────────────────────────────────────────────

export interface ReportCardRemark {
  id: string
  student_id: string
  report_card_title: string
  author_id: string
  remark: string
  created_at: string
  updated_at: string
  author?: UserProfile
}

/** Hard-coded default report card titles. These are always available in the
 *  picker without needing a row in `report_card_titles`. */
export const DEFAULT_REPORT_CARD_TITLES: string[] = [
  'Term 1', 'Term 2', 'Term 3', 'Term 4',
  'Mid Term', 'Final Term',
  'Monthly Test - January', 'Monthly Test - February', 'Monthly Test - March',
  'Monthly Test - April', 'Monthly Test - May', 'Monthly Test - June',
  'Monthly Test - July', 'Monthly Test - August', 'Monthly Test - September',
  'Monthly Test - October', 'Monthly Test - November', 'Monthly Test - December',
  'Practice 1', 'Practice 2', 'Practice 3', 'Practice 4', 'Practice 5', 'Practice 6',
  'Practice 7', 'Practice 8', 'Practice 9', 'Practice 10', 'Practice 11', 'Practice 12',
]

/** Fetches the union of default + custom report card titles. */
export async function fetchAllReportCardTitles(): Promise<string[]> {
  const { data, error } = await supabase
    .from('report_card_titles')
    .select('title')
    .order('title', { ascending: true })

  if (error) {
    console.error('Failed to fetch report card titles:', error.message)
    return [...DEFAULT_REPORT_CARD_TITLES]
  }

  const customTitles = (data ?? []).map((r: { title: string }) => r.title)
  // Preserve default ordering, then append unseen custom titles.
  const seen = new Set(DEFAULT_REPORT_CARD_TITLES.map(t => t.toLowerCase()))
  const merged = [...DEFAULT_REPORT_CARD_TITLES]
  for (const t of customTitles) {
    if (!seen.has(t.toLowerCase())) {
      merged.push(t)
      seen.add(t.toLowerCase())
    }
  }
  return merged
}

/** Persists a custom report card title (no-op if it matches a default). */
export async function createReportCardTitle(title: string, createdBy: string): Promise<boolean> {
  const trimmed = title.trim()
  if (!trimmed) return false
  // Skip persistence if it matches a default (case-insensitive).
  const isDefault = DEFAULT_REPORT_CARD_TITLES.some(t => t.toLowerCase() === trimmed.toLowerCase())
  if (isDefault) return true

  const { error } = await supabase
    .from('report_card_titles')
    .insert({ title: trimmed, created_by: createdBy })

  if (error) {
    if (error.code === '23505') return true // already exists
    console.error('Failed to create report card title:', error.message)
    return false
  }
  return true
}

export interface StudentReportCardEntry {
  classroom_id: string
  classroom_title: string
  assessment: ClassroomAssessment
  mark: AssessmentMark | null
}

/** Returns distinct academic years (e.g. ["2026-27", "2025-26"]) for all
 *  classrooms the student belongs to that have a start_date set.
 *  Sorted descending so the most recent year comes first. */
export async function fetchAvailableAcademicYearsForStudent(studentId: string): Promise<string[]> {
  const { data: memberships } = await supabase
    .from('classroom_members')
    .select('classroom_id')
    .eq('user_id', studentId)

  const classroomIds = (memberships ?? []).map((m: { classroom_id: string }) => m.classroom_id)
  if (classroomIds.length === 0) return []

  const { data: classrooms } = await supabase
    .from('classrooms')
    .select('start_date')
    .in('id', classroomIds)
    .not('start_date', 'is', null)

  const years = new Set<string>()
  for (const c of classrooms ?? []) {
    if (c.start_date) {
      const y = parseInt(c.start_date.split('-')[0])
      years.add(`${y}-${String(y + 1).slice(-2)}`)
    }
  }
  return Array.from(years).sort().reverse()
}

/** Fetches every assessment that has a non-null `report_card_title` for the
 *  given student across classrooms they belong to, plus the student's own mark
 *  for each. When `academicYear` (e.g. "2025-26") is provided, classrooms with
 *  a matching start_date year are used (active or not). When omitted, only
 *  active classrooms (end_date null or in future) are used. */
export async function fetchReportCardsForStudent(
  studentId: string,
  academicYear?: string | null,
): Promise<Map<string, StudentReportCardEntry[]>> {
  // 1. Classrooms the student is a member of.
  const { data: memberships } = await supabase
    .from('classroom_members')
    .select('classroom_id')
    .eq('user_id', studentId)

  const classroomIds = (memberships ?? []).map((m: { classroom_id: string }) => m.classroom_id)
  if (classroomIds.length === 0) return new Map()

  let classroomQuery = supabase
    .from('classrooms')
    .select('id, title, end_date')
    .in('id', classroomIds)

  if (academicYear) {
    const startYear = parseInt(academicYear.split('-')[0])
    classroomQuery = classroomQuery
      .gte('start_date', `${startYear}-01-01`)
      .lt('start_date', `${startYear + 1}-01-01`)
  } else {
    const today = new Date().toISOString().split('T')[0]
    classroomQuery = classroomQuery.or(`end_date.is.null,end_date.gte.${today}`)
  }

  const { data: classrooms } = await classroomQuery

  const filteredClassroomIds = (classrooms ?? []).map((c: { id: string }) => c.id)
  if (filteredClassroomIds.length === 0) return new Map()
  const classroomMap = new Map<string, { id: string; title: string }>(
    (classrooms ?? []).map((c: { id: string; title: string }) => [c.id, { id: c.id, title: c.title }])
  )

  // 2. All tagged assessments in those classrooms.
  const { data: assessments } = await supabase
    .from('classroom_assessments')
    .select('*')
    .in('classroom_id', filteredClassroomIds)
    .not('report_card_title', 'is', null)
    .order('date', { ascending: false })

  if (!assessments || assessments.length === 0) return new Map()

  // 3. Marks for this student.
  const assessmentIds = assessments.map((a: ClassroomAssessment) => a.id)
  const { data: marks } = await supabase
    .from('classroom_assessment_marks')
    .select('*')
    .in('assessment_id', assessmentIds)
    .eq('student_id', studentId)

  const markMap = new Map<string, AssessmentMark>(
    (marks ?? []).map((m: AssessmentMark) => [m.assessment_id, m])
  )

  // 4. Group.
  const grouped = new Map<string, StudentReportCardEntry[]>()
  for (const a of assessments as ClassroomAssessment[]) {
    if (!a.report_card_title) continue
    const cls = classroomMap.get(a.classroom_id)
    if (!cls) continue
    const entry: StudentReportCardEntry = {
      classroom_id: cls.id,
      classroom_title: cls.title,
      assessment: a,
      mark: markMap.get(a.id) ?? null,
    }
    const list = grouped.get(a.report_card_title) ?? []
    list.push(entry)
    grouped.set(a.report_card_title, list)
  }
  return grouped
}

/** Fetches every assessment grouped by report card title for the given
 *  student, but only across the classrooms that the *viewer* (a non-student)
 *  also belongs to. Used for the staff report-card view so a teacher only sees
 *  marks from classrooms they share. Admin/principal see everything. */
export async function fetchReportCardsForStudentAsViewer(
  studentId: string,
  viewerId: string,
  viewerRole: UserRole,
): Promise<Map<string, StudentReportCardEntry[]>> {
  const today = new Date().toISOString().split('T')[0]

  // 1. Active classrooms the student is in.
  const { data: studentMemberships } = await supabase
    .from('classroom_members')
    .select('classroom_id')
    .eq('user_id', studentId)

  const studentClassroomIds = (studentMemberships ?? []).map(
    (m: { classroom_id: string }) => m.classroom_id
  )
  if (studentClassroomIds.length === 0) return new Map()

  // 2. Restrict to classrooms the viewer also belongs to (unless admin/principal).
  let allowedIds = studentClassroomIds
  if (!['principal', 'admin'].includes(viewerRole)) {
    const { data: viewerMemberships } = await supabase
      .from('classroom_members')
      .select('classroom_id')
      .eq('user_id', viewerId)
      .in('classroom_id', studentClassroomIds)
    allowedIds = (viewerMemberships ?? []).map(
      (m: { classroom_id: string }) => m.classroom_id
    )
  }
  if (allowedIds.length === 0) return new Map()

  // 3. Filter to active.
  const { data: classrooms } = await supabase
    .from('classrooms')
    .select('id, title, end_date')
    .in('id', allowedIds)
    .or(`end_date.is.null,end_date.gte.${today}`)

  const activeIds = (classrooms ?? []).map((c: { id: string }) => c.id)
  if (activeIds.length === 0) return new Map()
  const classroomMap = new Map<string, { id: string; title: string }>(
    (classrooms ?? []).map((c: { id: string; title: string }) => [c.id, { id: c.id, title: c.title }])
  )

  // 4. Tagged assessments + marks.
  const { data: assessments } = await supabase
    .from('classroom_assessments')
    .select('*')
    .in('classroom_id', activeIds)
    .not('report_card_title', 'is', null)
    .order('date', { ascending: false })

  if (!assessments || assessments.length === 0) return new Map()

  const assessmentIds = assessments.map((a: ClassroomAssessment) => a.id)
  const { data: marks } = await supabase
    .from('classroom_assessment_marks')
    .select('*')
    .in('assessment_id', assessmentIds)
    .eq('student_id', studentId)

  const markMap = new Map<string, AssessmentMark>(
    (marks ?? []).map((m: AssessmentMark) => [m.assessment_id, m])
  )

  const grouped = new Map<string, StudentReportCardEntry[]>()
  for (const a of assessments as ClassroomAssessment[]) {
    if (!a.report_card_title) continue
    const cls = classroomMap.get(a.classroom_id)
    if (!cls) continue
    const list = grouped.get(a.report_card_title) ?? []
    list.push({
      classroom_id: cls.id,
      classroom_title: cls.title,
      assessment: a,
      mark: markMap.get(a.id) ?? null,
    })
    grouped.set(a.report_card_title, list)
  }
  return grouped
}

/** Searches student profiles whose name or email matches `query`. For
 *  non-admin/principal viewers, restricts to students that share at least one
 *  classroom (active or not) with the viewer. */
export async function searchStudentsForReportCard(
  viewerId: string,
  viewerRole: UserRole,
  query: string,
  limit = 8,
): Promise<UserProfile[]> {
  const q = query.trim()
  if (q.length < 1) return []

  // Admin/principal can search everyone.
  if (['admin', 'principal'].includes(viewerRole)) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, avatar_url, grade, section, created_at, updated_at')
      .eq('role', 'student')
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .order('full_name', { ascending: true })
      .limit(limit)
    if (error) {
      console.error('Failed to search students:', error.message)
      return []
    }
    return (data ?? []) as UserProfile[]
  }

  // Other staff: limited to students sharing at least one classroom.
  const { data: viewerMemberships } = await supabase
    .from('classroom_members')
    .select('classroom_id')
    .eq('user_id', viewerId)

  const viewerClassroomIds = (viewerMemberships ?? []).map(
    (m: { classroom_id: string }) => m.classroom_id
  )
  if (viewerClassroomIds.length === 0) return []

  const { data: studentMembers } = await supabase
    .from('classroom_members')
    .select('user_id')
    .in('classroom_id', viewerClassroomIds)
    .eq('role', 'student')

  const studentIds = Array.from(new Set(
    (studentMembers ?? []).map((m: { user_id: string }) => m.user_id)
  ))
  if (studentIds.length === 0) return []

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, avatar_url, grade, section, created_at, updated_at')
    .in('id', studentIds)
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order('full_name', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('Failed to search students:', error.message)
    return []
  }
  return (data ?? []) as UserProfile[]
}

/** Fetches all remarks for a student (across every report card title). The
 *  caller can then group them by `report_card_title`. */
export async function fetchRemarksForStudent(studentId: string): Promise<ReportCardRemark[]> {
  const { data, error } = await supabase
    .from('report_card_remarks')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch remarks:', error.message)
    return []
  }
  const remarks = (data ?? []) as ReportCardRemark[]

  // Hydrate authors.
  const authorIds = Array.from(new Set(remarks.map(r => r.author_id)))
  if (authorIds.length === 0) return remarks
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', authorIds)
  const profileMap = new Map<string, UserProfile>(
    (profiles ?? []).map((p: UserProfile) => [p.id, p])
  )
  return remarks.map(r => ({ ...r, author: profileMap.get(r.author_id) }))
}

/** Insert or update a remark for (student, title, author). */
export async function upsertRemark(
  studentId: string,
  reportCardTitle: string,
  authorId: string,
  remark: string,
): Promise<ReportCardRemark | null> {
  const trimmed = remark.trim()

  // Empty remark → delete instead of upsert.
  if (!trimmed) {
    await supabase
      .from('report_card_remarks')
      .delete()
      .eq('student_id', studentId)
      .eq('report_card_title', reportCardTitle)
      .eq('author_id', authorId)
    return null
  }

  const { data, error } = await supabase
    .from('report_card_remarks')
    .upsert({
      student_id: studentId,
      report_card_title: reportCardTitle,
      author_id: authorId,
      remark: trimmed,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'student_id,report_card_title,author_id' })
    .select()
    .single()

  if (error) {
    console.error('Failed to upsert remark:', error.message)
    return null
  }
  return data as ReportCardRemark
}

export async function deleteRemark(remarkId: string): Promise<boolean> {
  const { error } = await supabase
    .from('report_card_remarks')
    .delete()
    .eq('id', remarkId)
  if (error) {
    console.error('Failed to delete remark:', error.message)
    return false
  }
  return true
}

// ─── Class-wise Marks ─────────────────────────────────────────────────────────

export interface ClasswiseSubject {
  classroomId: string
  classroomTitle: string
  subject: string
}

export interface ClasswiseCellData {
  obtained: number
  max: number
  hasAnyMark: boolean
}

export interface ClasswiseMarksResult {
  students: UserProfile[]
  subjects: ClasswiseSubject[]
  /** cellData[studentId][classroomId] = aggregated marks for that student × subject */
  cellData: Record<string, Record<string, ClasswiseCellData>>
}

/** Returns distinct grade + section pairs that have at least one student profile. */
export async function fetchGradeSectionsWithStudents(): Promise<{ grade: number; section: string }[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('grade, section')
    .eq('role', 'student')
    .not('grade', 'is', null)
    .not('section', 'is', null)

  if (error) {
    console.error('Failed to fetch grade/sections:', error.message)
    return []
  }

  const seen = new Set<string>()
  const result: { grade: number; section: string }[] = []
  for (const p of data ?? []) {
    const key = `${p.grade}-${p.section}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push({ grade: Number(p.grade), section: p.section as string })
    }
  }
  return result.sort((a, b) => a.grade - b.grade || a.section.localeCompare(b.section))
}

/** Fetches the class-wide marks matrix for a given grade, section, and report card title.
 *  Students are pulled from profiles; subjects from classrooms with a subject set. */
export async function fetchClasswiseMarks(
  grade: number,
  section: string,
  reportCardTitle: string,
): Promise<ClasswiseMarksResult> {
  const empty: ClasswiseMarksResult = { students: [], subjects: [], cellData: {} }
  const today = new Date().toISOString().split('T')[0]

  // 1. Students matching the grade + section
  const { data: studentData, error: stuErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .eq('grade', grade)
    .ilike('section', section)
    .order('full_name', { ascending: true })

  if (stuErr || !studentData || studentData.length === 0) return empty
  const students = studentData as UserProfile[]
  const studentIds = students.map(s => s.id)

  // 2. Active classrooms for this grade + section that have a subject set
  const { data: classroomData, error: clsErr } = await supabase
    .from('classrooms')
    .select('id, title, subject')
    .eq('grade', grade)
    .ilike('section', section)
    .not('subject', 'is', null)
    .or(`end_date.is.null,end_date.gte.${today}`)

  if (clsErr || !classroomData || classroomData.length === 0) return { ...empty, students }
  const classroomIds = classroomData.map((c: { id: string }) => c.id)

  // 3. Assessments in those classrooms tagged with the selected report card title
  const { data: assessmentData, error: assErr } = await supabase
    .from('classroom_assessments')
    .select('*')
    .in('classroom_id', classroomIds)
    .eq('report_card_title', reportCardTitle)

  if (assErr || !assessmentData || assessmentData.length === 0) return { ...empty, students }
  const assessments = assessmentData as ClassroomAssessment[]
  const assessmentIds = assessments.map(a => a.id)

  // Only keep classrooms that have at least one assessment under this report card title
  const classroomsWithAssessments = new Set(assessments.map(a => a.classroom_id))
  const subjects: ClasswiseSubject[] = (classroomData as Array<{ id: string; title: string; subject: string }>)
    .filter(c => classroomsWithAssessments.has(c.id))
    .map(c => ({ classroomId: c.id, classroomTitle: c.title, subject: c.subject }))
    .sort((a, b) => a.subject.localeCompare(b.subject))

  if (subjects.length === 0) return { ...empty, students }

  // Map assessmentId → classroomId for fast lookup
  const assessmentToClassroom = new Map<string, string>(
    assessments.map(a => [a.id, a.classroom_id])
  )

  // 4. All marks for these assessments, restricted to students in this grade/section
  const { data: markData } = await supabase
    .from('classroom_assessment_marks')
    .select('*')
    .in('assessment_id', assessmentIds)
    .in('student_id', studentIds)

  // 5. Build the cell data matrix
  const cellData: Record<string, Record<string, ClasswiseCellData>> = {}
  for (const mark of markData ?? []) {
    const classroomId = assessmentToClassroom.get(mark.assessment_id)
    if (!classroomId) continue

    if (!cellData[mark.student_id]) cellData[mark.student_id] = {}
    if (!cellData[mark.student_id][classroomId]) {
      cellData[mark.student_id][classroomId] = { obtained: 0, max: 0, hasAnyMark: false }
    }

    if (mark.marks != null) {
      cellData[mark.student_id][classroomId].obtained += Number(mark.marks)
      cellData[mark.student_id][classroomId].max += Number(mark.max_marks)
      cellData[mark.student_id][classroomId].hasAnyMark = true
    }
  }

  return { students, subjects, cellData }
}
