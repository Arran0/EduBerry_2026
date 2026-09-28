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
  /** An optional second maximum the marks are *displayed* against — a test
   *  marked out of 120 that a school reports out of 50. Null means the marks
   *  are only ever shown at their own scale. */
  conversion_total: number | null
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

/** A named part of an assessment — "Lab" out of 20, "Examination" out of 80.
 *  An assessment either has none of these (one mark per student, as before) or
 *  has a set of them whose maximums add up to the assessment's own max. */
export interface AssessmentComponent {
  id: string
  assessment_id: string
  name: string
  max_marks: number
  /** Display order in the marksheet and on the report card. */
  position: number
  created_at: string
  updated_at: string
}

export interface AssessmentComponentMark {
  id: string
  component_id: string
  student_id: string
  marks: number | null
  is_absent: boolean
  created_at: string
  updated_at: string
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
    conversion_total: null,
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
  updates: Partial<Pick<ClassroomAssessment, 'title' | 'description' | 'date' | 'tag' | 'report_card_title' | 'max_marks' | 'conversion_total'>>
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

// --- Assessment components ---
//
// A component splits one assessment into named parts that are marked
// separately ("Lab" /20, "Examination" /80) but reported as one score.
// `classroom_assessment_marks` stays the student's total for the assessment and
// is recomputed by the database from the component marks, so none of the
// readers above (report cards, the class-wide matrix, the academic record) had
// to learn about components to keep adding up correctly.

/** Components of the given assessments, keyed by assessment id and already in
 *  display order. An assessment scored as a single total is simply absent from
 *  the map. */
export async function fetchAssessmentComponents(
  assessmentIds: string[],
): Promise<Record<string, AssessmentComponent[]>> {
  if (assessmentIds.length === 0) return {}
  const { data, error } = await supabase
    .from('classroom_assessment_components')
    .select('*')
    .in('assessment_id', assessmentIds)
    .order('position', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('Failed to fetch assessment components:', error.message)
    return {}
  }
  const byAssessment: Record<string, AssessmentComponent[]> = {}
  for (const c of (data ?? []) as AssessmentComponent[]) {
    const list = byAssessment[c.assessment_id] ?? []
    list.push(c)
    byAssessment[c.assessment_id] = list
  }
  return byAssessment
}

export interface AssessmentComponentDraft {
  /** Set when editing an existing component, absent when adding one. */
  id?: string
  name: string
  max_marks: number
}

/** Replaces an assessment's component set in one go: drafts carrying an id are
 *  updated in place (so marks already entered survive a rename or a
 *  re-weighting), drafts without one are created, and components no longer in
 *  the list are deleted along with their marks. An empty list turns the
 *  assessment back into a single total typed by hand.
 *
 *  Totals are deliberately not written here — the database recomputes them
 *  from the components on every change. */
export async function saveAssessmentComponents(
  assessmentId: string,
  drafts: AssessmentComponentDraft[],
): Promise<AssessmentComponent[] | null> {
  const cleaned = drafts
    .map((d, i) => ({ id: d.id, name: d.name.trim(), max_marks: d.max_marks, position: i }))
    .filter(d => d.name !== '' && isFinite(d.max_marks) && d.max_marks > 0)

  const keptIds = cleaned.map(d => d.id).filter((id): id is string => !!id)

  // Removals go first: a component renamed to a name one of the removed ones
  // was holding would otherwise collide on the (assessment_id, name) unique
  // constraint.
  const removals = supabase
    .from('classroom_assessment_components')
    .delete()
    .eq('assessment_id', assessmentId)
  const { error: deleteError } = keptIds.length > 0
    ? await removals.not('id', 'in', `(${keptIds.map(id => `"${id}"`).join(',')})`)
    : await removals

  if (deleteError) {
    console.error('Failed to remove assessment components:', deleteError.message)
    return null
  }

  if (cleaned.length === 0) return []

  // Every row carries an id — new ones included — so the batch is a single
  // upsert rather than an insert and an update with different column sets.
  const rows = cleaned.map(d => ({
    id: d.id ?? crypto.randomUUID(),
    assessment_id: assessmentId,
    name: d.name,
    max_marks: d.max_marks,
    position: d.position,
    updated_at: new Date().toISOString(),
  }))

  const { data, error } = await supabase
    .from('classroom_assessment_components')
    .upsert(rows, { onConflict: 'id' })
    .select()

  if (error) {
    console.error('Failed to save assessment components:', error.message)
    return null
  }
  return ((data ?? []) as AssessmentComponent[])
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}

/** Every student's component marks for one assessment — the marksheet grid. */
export async function fetchAssessmentComponentMarks(
  assessmentId: string,
): Promise<AssessmentComponentMark[]> {
  const { data, error } = await supabase
    .from('classroom_assessment_component_marks')
    .select('*, classroom_assessment_components!inner(assessment_id)')
    .eq('classroom_assessment_components.assessment_id', assessmentId)

  if (error) {
    console.error('Failed to fetch component marks:', error.message)
    return []
  }
  // Drop the join-only column so callers see a plain component mark.
  return (data ?? []).map(
    ({ classroom_assessment_components: _joined, ...m }) => m as AssessmentComponentMark
  )
}

/** One student's component marks across a set of assessments, keyed by
 *  component id. Keys off the assessment rather than a component id list, so it
 *  can run alongside (rather than after) the components query itself. */
export async function fetchStudentComponentMarks(
  studentId: string,
  assessmentIds: string[],
): Promise<Record<string, AssessmentComponentMark>> {
  if (assessmentIds.length === 0) return {}
  const { data, error } = await supabase
    .from('classroom_assessment_component_marks')
    .select('*, classroom_assessment_components!inner(assessment_id)')
    .eq('student_id', studentId)
    .in('classroom_assessment_components.assessment_id', assessmentIds)

  if (error) {
    console.error('Failed to fetch student component marks:', error.message)
    return {}
  }
  const byComponent: Record<string, AssessmentComponentMark> = {}
  for (const row of data ?? []) {
    const { classroom_assessment_components: _joined, ...m } = row
    byComponent[(m as AssessmentComponentMark).component_id] = m as AssessmentComponentMark
  }
  return byComponent
}

/** Saves a whole component marksheet. A cell left blank is deleted rather than
 *  stored as a null mark, so "never entered" and "entered as nothing" stay the
 *  same thing and a student with an empty sheet keeps no total at all. */
export async function upsertAssessmentComponentMarks(
  entries: { componentId: string; studentId: string; marks: number | null; isAbsent: boolean }[],
): Promise<boolean> {
  const now = new Date().toISOString()

  const rows = entries
    .filter(e => e.isAbsent || e.marks != null)
    .map(e => ({
      component_id: e.componentId,
      student_id: e.studentId,
      marks: e.isAbsent ? null : e.marks,
      is_absent: e.isAbsent,
      updated_at: now,
    }))

  // Blanks, grouped by component: PostgREST cannot filter on a composite
  // (component, student) list, and there are only ever a handful of components.
  const blanksByComponent = new Map<string, string[]>()
  for (const e of entries) {
    if (e.isAbsent || e.marks != null) continue
    const list = blanksByComponent.get(e.componentId) ?? []
    list.push(e.studentId)
    blanksByComponent.set(e.componentId, list)
  }

  const [upsertResult, ...deleteResults] = await Promise.all([
    rows.length > 0
      ? supabase
          .from('classroom_assessment_component_marks')
          .upsert(rows, { onConflict: 'component_id,student_id' })
      : Promise.resolve({ error: null }),
    ...Array.from(blanksByComponent.entries()).map(([componentId, studentIds]) =>
      supabase
        .from('classroom_assessment_component_marks')
        .delete()
        .eq('component_id', componentId)
        .in('student_id', studentIds)
    ),
  ])

  const failure = [upsertResult, ...deleteResults].find(r => r.error)
  if (failure?.error) {
    console.error('Failed to save component marks:', failure.error.message)
    return false
  }
  return true
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
export async function fetchProfilesByIds(
  ids: (string | null | undefined)[],
  // Callers that render a name and an avatar (rather than a whole profile) can
  // narrow this; the default keeps every existing caller's shape unchanged.
  columns = '*',
): Promise<Record<string, UserProfile>> {
  const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))]
  if (uniqueIds.length === 0) return {}

  const { data } = await supabase
    .from('profiles')
    .select(columns)
    .in('id', uniqueIds)

  const map: Record<string, UserProfile> = {}
  // `columns` is a runtime string, so supabase-js can't infer the row shape.
  for (const p of ((data ?? []) as unknown as UserProfile[])) map[p.id] = p
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
  /** Hydrated by fetchRemarksForStudent — only the fields a remark bubble
   *  renders, so the lookup does not pull whole profile rows. */
  author?: RemarkAuthor
}

export type RemarkAuthor = Pick<UserProfile, 'id' | 'full_name' | 'role' | 'avatar_url'>

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

/** Reference data for the report-card views: a handful of rows that changes
 *  only when an admin edits it, but was refetched on every mount (switching
 *  the staff Individual/Class Marks tabs remounts the view). Cached for the
 *  page session and invalidated by the writes below. */
let reportCardTitleCache: string[] | null = null
let gradeSectionCache: { grade: number; section: string }[] | null = null

/** Fetches the union of default + custom report card titles. */
export async function fetchAllReportCardTitles(): Promise<string[]> {
  if (reportCardTitleCache) return reportCardTitleCache
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
  reportCardTitleCache = merged
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
    if (error.code === '23505') { reportCardTitleCache = null; return true } // already exists
    console.error('Failed to create report card title:', error.message)
    return false
  }
  reportCardTitleCache = null
  return true
}

export interface StudentReportCardEntry {
  classroom_id: string
  classroom_title: string
  assessment: ClassroomAssessment
  mark: AssessmentMark | null
  /** The assessment's components in display order — empty when it is scored as
   *  a single total. */
  components: AssessmentComponent[]
  /** This student's mark for each of those components, keyed by component id. */
  componentMarks: Record<string, AssessmentComponentMark>
}

/** PostgREST returns a to-one embed as a single object, but supabase-js types
 *  every embed as an array — normalise whichever shape arrives. */
function embeddedOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

/** Classroom fields the report-card views need off a student's memberships. */
interface ReportCardClassroom {
  id: string
  title: string
  start_date: string | null
  end_date: string | null
}

/** Every classroom the student belongs to, in one round trip (the membership
 *  rows carry the classroom inline instead of a second `.in('id', ids)` query).
 *  Date filtering is left to the caller: a student's membership list is small,
 *  so filtering it in JS is cheaper than another round trip. */
async function fetchStudentClassrooms(studentId: string): Promise<ReportCardClassroom[]> {
  const { data, error } = await supabase
    .from('classroom_members')
    .select('classroom:classrooms!inner(id, title, start_date, end_date)')
    .eq('user_id', studentId)

  if (error) {
    console.error('Failed to fetch student classrooms:', error.message)
    return []
  }
  return (data ?? [])
    .map(row => embeddedOne<ReportCardClassroom>(row.classroom as never))
    .filter((c): c is ReportCardClassroom => !!c)
}

/** True when the classroom is still running (no end date, or not yet past). */
function isActiveOn(classroom: Pick<ReportCardClassroom, 'end_date'>, today: string): boolean {
  return !classroom.end_date || classroom.end_date >= today
}

/** True when the classroom's start_date falls in the given academic year
 *  (e.g. "2025-26" matches any start_date in calendar 2025). */
function startsInAcademicYear(
  classroom: Pick<ReportCardClassroom, 'start_date'>,
  academicYear: string,
): boolean {
  if (!classroom.start_date) return false
  return parseInt(classroom.start_date.split('-')[0]) === parseInt(academicYear.split('-')[0])
}

/** Requests in flight right now, keyed by function + arguments.
 *
 *  The academics page renders the report-card digest and the full Report Cards
 *  section together, and a student's copy of each asks for the same year list
 *  and the same cards at the same moment. Coalescing means they share one
 *  request instead of issuing two identical ones. Nothing is kept once the
 *  request settles — this de-duplicates concurrent callers, it is not a cache,
 *  so no caller can be handed a stale result. */
const inFlight = new Map<string, Promise<unknown>>()

function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = run().finally(() => { inFlight.delete(key) })
  inFlight.set(key, p)
  return p
}

/** Returns distinct academic years (e.g. ["2026-27", "2025-26"]) for all
 *  classrooms the student belongs to that have a start_date set.
 *  Sorted descending so the most recent year comes first. */
export function fetchAvailableAcademicYearsForStudent(studentId: string): Promise<string[]> {
  return coalesce(`years:${studentId}`, () => loadAvailableAcademicYearsForStudent(studentId))
}

async function loadAvailableAcademicYearsForStudent(studentId: string): Promise<string[]> {
  // One round trip: the membership rows carry their classroom's start_date via
  // an inner join, so there is no second query keyed on the ids from the first.
  const { data, error } = await supabase
    .from('classroom_members')
    .select('classroom:classrooms!inner(start_date)')
    .eq('user_id', studentId)

  if (error) {
    console.error('Failed to fetch academic years:', error.message)
    return []
  }

  const years = new Set<string>()
  for (const row of data ?? []) {
    const startDate = embeddedOne<{ start_date: string | null }>(row.classroom as never)?.start_date
    if (!startDate) continue
    const y = parseInt(startDate.split('-')[0])
    years.add(`${y}-${String(y + 1).slice(-2)}`)
  }
  return Array.from(years).sort().reverse()
}

/** A student's own marks for the report-card-tagged assessments of the given
 *  classrooms. The assessment is inner-joined purely so its classroom and tag
 *  can be filtered on, which is what lets this run alongside (rather than
 *  after) the assessments query itself. */
async function fetchStudentMarksForClassrooms(
  studentId: string,
  classroomIds: string[],
): Promise<AssessmentMark[]> {
  if (classroomIds.length === 0) return []
  const { data, error } = await supabase
    .from('classroom_assessment_marks')
    .select('*, classroom_assessments!inner(classroom_id)')
    .eq('student_id', studentId)
    .in('classroom_assessments.classroom_id', classroomIds)
    .not('classroom_assessments.report_card_title', 'is', null)

  if (error) {
    console.error('Failed to fetch student marks:', error.message)
    return []
  }
  // Drop the join-only column so callers see a plain AssessmentMark.
  return (data ?? []).map(({ classroom_assessments: _joined, ...mark }) => mark as AssessmentMark)
}

/** Fetches every assessment that has a non-null `report_card_title` for the
 *  given student across classrooms they belong to, plus the student's own mark
 *  for each. When `academicYear` (e.g. "2025-26") is provided, classrooms with
 *  a matching start_date year are used (active or not). When omitted, only
 *  active classrooms (end_date null or in future) are used. */
export function fetchReportCardsForStudent(
  studentId: string,
  academicYear?: string | null,
): Promise<Map<string, StudentReportCardEntry[]>> {
  return coalesce(
    `cards:${studentId}:${academicYear ?? ''}`,
    () => loadReportCardsForStudent(studentId, academicYear),
  )
}

async function loadReportCardsForStudent(
  studentId: string,
  academicYear?: string | null,
): Promise<Map<string, StudentReportCardEntry[]>> {
  // 1. Classrooms the student is a member of (one round trip, classroom inline).
  const classrooms = await fetchStudentClassrooms(studentId)
  const today = new Date().toISOString().split('T')[0]
  const inScope = academicYear
    ? classrooms.filter(c => startsInAcademicYear(c, academicYear))
    : classrooms.filter(c => isActiveOn(c, today))

  const filteredClassroomIds = inScope.map(c => c.id)
  if (filteredClassroomIds.length === 0) return new Map()
  const classroomMap = new Map<string, { id: string; title: string }>(
    inScope.map(c => [c.id, { id: c.id, title: c.title }])
  )

  // 2. Tagged assessments in those classrooms, and this student's marks —
  //    in parallel: the marks query keys off the assessment's classroom (an
  //    inner join) rather than off the ids the first query returns.
  const [{ data: assessments }, marks] = await Promise.all([
    supabase
      .from('classroom_assessments')
      .select('*')
      .in('classroom_id', filteredClassroomIds)
      .not('report_card_title', 'is', null)
      .order('date', { ascending: false }),
    fetchStudentMarksForClassrooms(studentId, filteredClassroomIds),
  ])

  if (!assessments || assessments.length === 0) return new Map()

  const markMap = new Map<string, AssessmentMark>(
    (marks ?? []).map((m: AssessmentMark) => [m.assessment_id, m])
  )

  // 3. The component breakdown behind those totals. Both queries key off the
  //    assessment ids, so they go out together.
  const assessmentIds = (assessments as ClassroomAssessment[]).map(a => a.id)
  const [componentsByAssessment, componentMarks] = await Promise.all([
    fetchAssessmentComponents(assessmentIds),
    fetchStudentComponentMarks(studentId, assessmentIds),
  ])

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
      components: componentsByAssessment[a.id] ?? [],
      componentMarks,
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
  const isSeniorStaff = ['principal', 'admin'].includes(viewerRole)

  // 1-3. The student's classrooms and (for staff who aren't principal/admin)
  //      the viewer's own, fetched in parallel — neither needs the other's
  //      result — then intersected and filtered to active ones in JS.
  const [studentClassrooms, viewerMemberships] = await Promise.all([
    fetchStudentClassrooms(studentId),
    isSeniorStaff
      ? Promise.resolve(null)
      : supabase.from('classroom_members').select('classroom_id').eq('user_id', viewerId),
  ])

  if (studentClassrooms.length === 0) return new Map()

  let allowed = studentClassrooms
  if (!isSeniorStaff) {
    const viewerIds = new Set(
      (viewerMemberships?.data ?? []).map((m: { classroom_id: string }) => m.classroom_id)
    )
    allowed = studentClassrooms.filter(c => viewerIds.has(c.id))
  }

  const active = allowed.filter(c => isActiveOn(c, today))
  const activeIds = active.map(c => c.id)
  if (activeIds.length === 0) return new Map()
  const classroomMap = new Map<string, { id: string; title: string }>(
    active.map(c => [c.id, { id: c.id, title: c.title }])
  )

  // 4. Tagged assessments and the student's marks, in parallel.
  const [{ data: assessments }, marks] = await Promise.all([
    supabase
      .from('classroom_assessments')
      .select('*')
      .in('classroom_id', activeIds)
      .not('report_card_title', 'is', null)
      .order('date', { ascending: false }),
    fetchStudentMarksForClassrooms(studentId, activeIds),
  ])

  if (!assessments || assessments.length === 0) return new Map()

  const markMap = new Map<string, AssessmentMark>(
    (marks ?? []).map((m: AssessmentMark) => [m.assessment_id, m])
  )

  const assessmentIds = (assessments as ClassroomAssessment[]).map(a => a.id)
  const [componentsByAssessment, componentMarks] = await Promise.all([
    fetchAssessmentComponents(assessmentIds),
    fetchStudentComponentMarks(studentId, assessmentIds),
  ])

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
      components: componentsByAssessment[a.id] ?? [],
      componentMarks,
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
  // A remark bubble renders the author's name, role and avatar only.
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, role, avatar_url')
    .in('id', authorIds)
  const profileMap = new Map<string, RemarkAuthor>(
    ((profiles ?? []) as RemarkAuthor[]).map(p => [p.id, p])
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
  if (gradeSectionCache) return gradeSectionCache

  // The RPC does the DISTINCT server-side (tens of rows instead of one row per
  // student). It runs as the caller, so RLS still decides what is visible.
  const { data, error } = await supabase.rpc('get_grade_sections_with_students')

  if (!error) {
    gradeSectionCache = ((data ?? []) as { grade: number; section: string }[])
      .map(r => ({ grade: Number(r.grade), section: r.section }))
    return gradeSectionCache
  }
  if (error.code !== 'PGRST202') {
    console.error('Failed to fetch grade/sections:', error.message)
    return []
  }

  // The RPC isn't deployed yet — fall back to de-duplicating client-side.
  const { data: rows, error: rowsError } = await supabase
    .from('profiles')
    .select('grade, section')
    .eq('role', 'student')
    .not('grade', 'is', null)
    .not('section', 'is', null)

  if (rowsError) {
    console.error('Failed to fetch grade/sections:', rowsError.message)
    return []
  }

  const seen = new Set<string>()
  const result: { grade: number; section: string }[] = []
  for (const p of rows ?? []) {
    const key = `${p.grade}-${p.section}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push({ grade: Number(p.grade), section: p.section as string })
    }
  }
  result.sort((a, b) => a.grade - b.grade || a.section.localeCompare(b.section))
  gradeSectionCache = result
  return result
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

  // 1 & 2. Students and their classrooms — independent queries, so in parallel.
  //         The matrix renders name/email/avatar only, so the student columns
  //         are listed out rather than selected with `*`.
  const [
    { data: studentData, error: stuErr },
    { data: classroomData, error: clsErr },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, role, avatar_url, grade, section')
      .eq('role', 'student')
      .eq('grade', grade)
      .ilike('section', section)
      .order('full_name', { ascending: true }),
    supabase
      .from('classrooms')
      .select('id, title, subject')
      .eq('grade', grade)
      .ilike('section', section)
      .not('subject', 'is', null)
      .or(`end_date.is.null,end_date.gte.${today}`),
  ])

  if (stuErr || !studentData || studentData.length === 0) return empty
  const students = studentData as UserProfile[]
  const studentIds = students.map(s => s.id)

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
