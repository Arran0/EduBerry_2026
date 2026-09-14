import { supabase, UserProfile, UserRole } from './supabase'
import { TaskStatus, TaskTag } from './tasks'
import { compressImageIfNeeded } from './imageCompression'

// ============================================
// Types
// ============================================

export interface Project {
  id: string
  title: string
  description: string | null
  start_date: string | null
  end_date: string | null
  sequential_mode: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface ProjectMember {
  id: string
  project_id: string
  user_id: string
  user?: UserProfile
}

export interface Subtask {
  id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  due_date: string | null
  timing: string | null
  end_time: string | null
  require_check: boolean
  tag: TaskTag | null
  bonus_points: number
  assignee_id: string | null
  assignee?: UserProfile
  created_by: string | null
  creator?: UserProfile
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ProjectWithDetails extends Project {
  members: ProjectMember[]
  subtasks: Subtask[]
}

export interface NewProjectInput {
  title: string
  description?: string
  start_date?: string
  end_date?: string
  sequential_mode?: boolean
  member_ids: string[]
}

export interface NewSubtaskInput {
  title: string
  description?: string
  due_date?: string
  timing?: string
  end_time?: string
  require_check?: boolean
  tag?: TaskTag
  bonus_points?: number
  assignee_id?: string
  created_by_id?: string
  sort_order?: number
}

// ============================================
// Project progress
// ============================================

/** The only subtask fields project progress depends on. */
export type ProjectProgressSubtask = Pick<Subtask, 'status' | 'require_check'>

export interface ProjectStatus {
  label: string
  color: string
  isCompleted: boolean
  isOverdue: boolean
  isCompletedAfterDue: boolean
}

/**
 * Derive a project's headline status from its deadline and subtasks.
 *
 * "Completed" means every subtask is verified ('checked') or finished where no
 * verification is required ('done' + !require_check) — mirroring the per-subtask
 * UI label. Dismissed subtasks are treated as deleted and excluded from the
 * maths entirely.
 *
 * Lives here rather than in ProjectsList because the Projects tab badge counts
 * open projects with exactly these rules; two copies of this logic would drift
 * and show a badge that disagrees with the list beneath it.
 */
export function getProjectStatus(
  endDate: string | null,
  allSubtasks: ProjectProgressSubtask[],
): ProjectStatus {
  const subtasks = allSubtasks.filter(s => s.status !== 'dismissed')
  const total = subtasks.length

  if (total === 0) {
    return { label: 'No subtasks', color: 'text-slate-400', isCompleted: false, isOverdue: false, isCompletedAfterDue: false }
  }

  const completed = subtasks.filter(s => s.status === 'checked' || (!s.require_check && s.status === 'done')).length
  const done = subtasks.filter(s => s.status === 'done' || s.status === 'checked').length
  const isPastDue = !!endDate && endDate < new Date().toISOString().split('T')[0]
  const isCompleted = completed === total
  // All subtasks done/checked but not all checked, and the deadline has passed
  const isCompletedAfterDue = !isCompleted && done === total && isPastDue
  const isOverdue = !isCompleted && !isCompletedAfterDue && isPastDue

  if (isCompleted)          return { label: 'Completed', color: 'text-blue-600', isCompleted: true, isOverdue: false, isCompletedAfterDue: false }
  if (isCompletedAfterDue)  return { label: 'Completed after due', color: 'text-orange-600', isCompleted: false, isOverdue: false, isCompletedAfterDue: true }
  if (isOverdue)            return { label: 'Overdue', color: 'text-red-600', isCompleted: false, isOverdue: true, isCompletedAfterDue: false }
  if (done === total)       return { label: 'All Done', color: 'text-green-600', isCompleted: false, isOverdue: false, isCompletedAfterDue: false }
  if (done > 0)             return { label: 'In Progress', color: 'text-amber-600', isCompleted: false, isOverdue: false, isCompletedAfterDue: false }
  return { label: 'Not Started', color: 'text-slate-500', isCompleted: false, isOverdue: false, isCompletedAfterDue: false }
}

/** A project is open (shown under "Active", counted in the badge) until it is
 *  completed — whether on time or after its deadline. */
function isProjectOpen(endDate: string | null, subtasks: ProjectProgressSubtask[]): boolean {
  const status = getProjectStatus(endDate, subtasks)
  return !status.isCompleted && !status.isCompletedAfterDue
}

// ============================================
// Project CRUD
// ============================================

export async function createProject(
  input: NewProjectInput,
  createdBy: string
): Promise<Project | null> {
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      title: input.title,
      description: input.description || null,
      start_date: input.start_date || null,
      end_date: input.end_date || null,
      sequential_mode: input.sequential_mode ?? false,
      created_by: createdBy,
    })
    .select()
    .single()

  if (error || !project) {
    console.error('Error creating project:', error)
    return null
  }

  // Ensure creator is always a member
  const memberIds = new Set(input.member_ids)
  memberIds.add(createdBy)

  const memberRecords = Array.from(memberIds).map(uid => ({
    project_id: project.id,
    user_id: uid,
  }))

  const { error: membersError } = await supabase
    .from('project_members')
    .insert(memberRecords)

  if (membersError) {
    console.error('Error inserting project members:', membersError)
  }

  return project as Project
}

export async function updateProject(
  projectId: string,
  updates: Partial<Pick<Project, 'title' | 'description' | 'start_date' | 'end_date' | 'sequential_mode'>>
): Promise<boolean> {
  const { error } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', projectId)

  if (error) {
    console.error('Error updating project:', error)
    return false
  }
  return true
}

export async function deleteProject(projectId: string): Promise<boolean> {
  // Subtasks and members will be cascade-deleted by FK constraints
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)

  if (error) {
    console.error('Error deleting project:', error)
    return false
  }
  return true
}

export async function addProjectMember(projectId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('project_members')
    .insert({ project_id: projectId, user_id: userId })

  if (error) {
    console.error('Error adding project member:', error)
    return false
  }
  return true
}

export async function removeProjectMember(projectId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)

  if (error) {
    console.error('Error removing project member:', error)
    return false
  }
  return true
}

// ============================================
// Subtask CRUD
// ============================================

export async function addSubtask(
  projectId: string,
  input: NewSubtaskInput
): Promise<Subtask | null> {
  const { data, error } = await supabase
    .from('subtasks')
    .insert({
      project_id: projectId,
      title: input.title,
      description: input.description || null,
      due_date: input.due_date || null,
      timing: input.timing || null,
      tag: input.bonus_points ? 'bonus' : (input.tag || null),
      bonus_points: input.bonus_points ?? 0,
      assignee_id: input.assignee_id || null,
      created_by: input.created_by_id || null,
      sort_order: input.sort_order ?? 0,
      require_check: input.require_check ?? false,
      ...(input.end_time !== undefined ? { end_time: input.end_time || null } : {}),
    })
    .select('*, assignee:profiles!subtasks_assignee_id_fkey(id, full_name, avatar_url, role), creator:profiles!subtasks_created_by_fkey(id, full_name, avatar_url, role)')
    .single()

  if (error || !data) {
    console.error('Error adding subtask:', error)
    return null
  }

  return data as Subtask
}

export async function updateSubtaskStatus(
  subtaskId: string,
  status: TaskStatus,
  projectId: string,
  sequentialMode: boolean
): Promise<{ success: boolean; error?: string }> {
  // Dismissing (verifier action) is exempt from sequential ordering — a
  // dismissed subtask is treated as removed and must never be gated.
  if (sequentialMode && status !== 'dismissed') {
    // Fetch the subtask to get its sort_order
    const { data: currentSubtask, error: fetchError } = await supabase
      .from('subtasks')
      .select('sort_order')
      .eq('id', subtaskId)
      .single()

    if (fetchError || !currentSubtask) {
      return { success: false, error: 'Could not fetch subtask' }
    }

    // Check if there is a previous subtask that is not done/checked
    if (currentSubtask.sort_order > 0) {
      const { data: previousSubtasks, error: prevError } = await supabase
        .from('subtasks')
        .select('id, status, sort_order')
        .eq('project_id', projectId)
        .lt('sort_order', currentSubtask.sort_order)
        .order('sort_order', { ascending: false })
        .limit(1)

      if (prevError) {
        return { success: false, error: 'Could not verify sequential order' }
      }

      if (previousSubtasks && previousSubtasks.length > 0) {
        const prev = previousSubtasks[0]
        if (prev.status !== 'done' && prev.status !== 'checked') {
          return { success: false, error: 'Complete previous subtask first' }
        }
      }
    }
  }

  const { error } = await supabase
    .from('subtasks')
    .update({ status })
    .eq('id', subtaskId)

  if (error) {
    console.error('Error updating subtask status:', error)
    return { success: false, error: 'Failed to update status' }
  }

  return { success: true }
}

export async function deleteSubtask(subtaskId: string): Promise<boolean> {
  const { error } = await supabase
    .from('subtasks')
    .delete()
    .eq('id', subtaskId)

  if (error) {
    console.error('Error deleting subtask:', error)
    return false
  }
  return true
}

// ============================================
// Project queries
// ============================================

/**
 * Load the projects visible to a user: everything for principals and admins,
 * and for everyone else only the projects they are a member of.
 */
async function fetchVisibleProjects(userId: string, userRole: UserRole): Promise<Project[]> {
  if (userRole === 'principal' || userRole === 'admin') {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    return error || !data ? [] : (data as Project[])
  }

  // Coordinators and teachers alike see only projects they belong to.
  const { data: memberships } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('user_id', userId)

  const projectIds = (memberships || []).map(m => m.project_id)
  if (projectIds.length === 0) return []

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .in('id', projectIds)
    .order('created_at', { ascending: false })
  return error || !data ? [] : (data as Project[])
}

export async function fetchProjectsForUser(
  userId: string,
  userRole: UserRole
): Promise<ProjectWithDetails[]> {
  return enrichProjects(await fetchVisibleProjects(userId, userRole))
}

/**
 * Count the projects that are still open for a user — what the Projects tab
 * badge shows. Deliberately does NOT go through fetchProjectsForUser: the badge
 * needs three subtask columns, while full enrichment also pulls every project
 * member plus an assignee and creator profile join per subtask, none of which
 * the badge renders.
 */
export async function fetchActiveProjectCount(userId: string, userRole: UserRole): Promise<number> {
  const projects = await fetchVisibleProjects(userId, userRole)
  if (projects.length === 0) return 0

  const { data: subtaskRows } = await supabase
    .from('subtasks')
    .select('project_id, status, require_check')
    .in('project_id', projects.map(p => p.id))

  const byProject = new Map<string, ProjectProgressSubtask[]>()
  for (const row of (subtaskRows || []) as (ProjectProgressSubtask & { project_id: string })[]) {
    const bucket = byProject.get(row.project_id)
    if (bucket) bucket.push(row)
    else byProject.set(row.project_id, [row])
  }

  return projects.filter(p => isProjectOpen(p.end_date, byProject.get(p.id) ?? [])).length
}

export interface SubtaskWithProject extends Subtask {
  project_title: string
  project_sequential: boolean
}

export async function fetchSubtasksForCalendar(
  userId: string
): Promise<SubtaskWithProject[]> {
  const { data, error } = await supabase
    .from('subtasks')
    .select('*, assignee:profiles!subtasks_assignee_id_fkey(id, full_name, avatar_url, role), creator:profiles!subtasks_created_by_fkey(id, full_name, avatar_url, role), project:projects!subtasks_project_id_fkey(title, sequential_mode)')
    .eq('assignee_id', userId)
    .order('due_date', { ascending: true })

  if (error || !data) {
    console.error('Error fetching subtasks for calendar:', error)
    return []
  }

  return (data as any[]).map(d => ({
    ...d,
    project_title: d.project?.title || 'Unknown Project',
    project_sequential: d.project?.sequential_mode || false,
    project: undefined,
  })) as SubtaskWithProject[]
}

export async function updateSubtask(
  subtaskId: string,
  updates: Partial<Pick<Subtask, 'title' | 'description' | 'due_date' | 'timing' | 'end_time' | 'require_check' | 'tag' | 'bonus_points' | 'assignee_id'>>
): Promise<boolean> {
  const { error } = await supabase
    .from('subtasks')
    .update(updates)
    .eq('id', subtaskId)

  if (error) {
    console.error('Error updating subtask:', error)
    return false
  }
  return true
}

// ============================================
// Subtask Checklist
// ============================================

export interface SubtaskChecklistItem {
  id: string
  subtask_id: string
  text: string
  is_completed: boolean
  sort_order: number
  created_at: string
}

export async function fetchSubtaskChecklist(subtaskId: string): Promise<SubtaskChecklistItem[]> {
  const { data, error } = await supabase
    .from('subtask_checklist_items')
    .select('*')
    .eq('subtask_id', subtaskId)
    .order('sort_order', { ascending: true })
  if (error) { console.error('fetchSubtaskChecklist:', error); return [] }
  return (data || []) as SubtaskChecklistItem[]
}

export async function addSubtaskChecklistItem(subtaskId: string, text: string, sortOrder: number): Promise<SubtaskChecklistItem | null> {
  const { data, error } = await supabase
    .from('subtask_checklist_items')
    .insert({ subtask_id: subtaskId, text, sort_order: sortOrder })
    .select()
    .single()
  if (error) { console.error('addSubtaskChecklistItem:', error); return null }
  return data as SubtaskChecklistItem
}

export async function toggleSubtaskChecklistItem(itemId: string, isCompleted: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('subtask_checklist_items')
    .update({ is_completed: isCompleted })
    .eq('id', itemId)
  if (error) { console.error('toggleSubtaskChecklistItem:', error); return false }
  return true
}

export async function deleteSubtaskChecklistItem(itemId: string): Promise<boolean> {
  const { error } = await supabase
    .from('subtask_checklist_items')
    .delete()
    .eq('id', itemId)
  if (error) { console.error('deleteSubtaskChecklistItem:', error); return false }
  return true
}

// ============================================
// Subtask Comments
// ============================================

export interface SubtaskCommentAttachment {
  id: string
  comment_id: string
  url: string
  name: string
  type: 'image' | 'document'
  created_at: string
}

export interface SubtaskComment {
  id: string
  subtask_id: string
  author_id: string
  content: string
  created_at: string
  updated_at: string
  author?: { id: string; full_name: string; avatar_url: string | null }
  attachments?: SubtaskCommentAttachment[]
}

export async function fetchSubtaskComments(subtaskId: string): Promise<SubtaskComment[]> {
  const { data, error } = await supabase
    .from('subtask_comments')
    .select('*, author:profiles!subtask_comments_author_id_fkey(id, full_name, avatar_url), attachments:subtask_comment_attachments(*)')
    .eq('subtask_id', subtaskId)
    .order('created_at', { ascending: true })
  if (error) { console.error('fetchSubtaskComments:', error); return [] }
  return (data || []) as SubtaskComment[]
}

export async function addSubtaskComment(
  subtaskId: string,
  authorId: string,
  content: string,
  attachments: { url: string; name: string; type: 'image' | 'document' }[] = []
): Promise<SubtaskComment | null> {
  const { data: comment, error } = await supabase
    .from('subtask_comments')
    .insert({ subtask_id: subtaskId, author_id: authorId, content })
    .select()
    .single()
  if (error || !comment) { console.error('addSubtaskComment:', error); return null }

  if (attachments.length > 0) {
    await supabase
      .from('subtask_comment_attachments')
      .insert(attachments.map(a => ({ comment_id: comment.id, ...a })))
  }
  return comment as SubtaskComment
}

export async function uploadSubtaskAttachment(
  file: File,
  subtaskId: string,
  userId: string
): Promise<{ url: string; name: string; type: 'image' | 'document' } | null> {
  const isImage = file.type.startsWith('image/')
  const compressed = isImage ? await compressImageIfNeeded(file) : file
  const ext = compressed.name.split('.').pop() || 'bin'
  const path = `${userId}/${subtaskId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('subtask-attachments')
    .upload(path, compressed, { cacheControl: '31536000', upsert: false })
  if (error) { console.error('uploadSubtaskAttachment:', error); return null }
  const { data: { publicUrl } } = supabase.storage.from('subtask-attachments').getPublicUrl(path)
  return { url: publicUrl, name: compressed.name, type: isImage ? 'image' : 'document' }
}

// ============================================
// Helpers
// ============================================

async function enrichProjects(projects: Project[]): Promise<ProjectWithDetails[]> {
  if (projects.length === 0) return []

  const projectIds = projects.map(p => p.id)

  // Members and subtasks are independent queries — run them together so the
  // Projects tab waits on one round-trip rather than two.
  const [{ data: allMembers }, { data: allSubtasks }] = await Promise.all([
    supabase
      .from('project_members')
      .select('*, user:profiles(id, full_name, avatar_url, role)')
      .in('project_id', projectIds),
    supabase
      .from('subtasks')
      .select('*, assignee:profiles!subtasks_assignee_id_fkey(id, full_name, avatar_url, role), creator:profiles!subtasks_created_by_fkey(id, full_name, avatar_url, role)')
      .in('project_id', projectIds)
      .order('sort_order', { ascending: true }),
  ])

  const membersByProject  = groupByProjectId<ProjectMember>(allMembers)
  const subtasksByProject = groupByProjectId<Subtask>(allSubtasks)

  return projects.map(project => ({
    ...project,
    members: membersByProject.get(project.id) ?? [],
    subtasks: subtasksByProject.get(project.id) ?? [],
  }))
}

/** Bucket rows carrying a project_id into a Map, preserving their query order. */
function groupByProjectId<T extends { project_id: string }>(rows: unknown[] | null): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of (rows ?? []) as T[]) {
    const bucket = map.get(row.project_id)
    if (bucket) bucket.push(row)
    else map.set(row.project_id, [row])
  }
  return map
}
