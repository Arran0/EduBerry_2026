import { supabase, UserProfile, UserRole } from './supabase'
import { TaskStatus, TaskTag } from './tasks'

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
    .select('*, assignee:profiles!subtasks_assignee_id_fkey(*), creator:profiles!subtasks_created_by_fkey(*)')
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

export async function fetchProjectsForUser(
  userId: string,
  userRole: UserRole
): Promise<ProjectWithDetails[]> {
  let projectIds: string[] = []

  if (userRole === 'principal' || userRole === 'admin') {
    // Principals and admins see all projects
    const { data: projects, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })

    if (error || !projects) return []

    return enrichProjects(projects as Project[])
  }

  if (userRole === 'coordinator') {
    // Coordinators only see projects they are directly a member of
    const { data: memberships } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', userId)

    projectIds = (memberships || []).map(m => m.project_id)
  } else {
    // Teachers: only projects they are a member of
    const { data: memberships } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', userId)

    projectIds = (memberships || []).map(m => m.project_id)
  }

  if (projectIds.length === 0) return []

  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .in('id', projectIds)
    .order('created_at', { ascending: false })

  if (error || !projects) return []

  return enrichProjects(projects as Project[])
}

export async function fetchProjectById(
  projectId: string
): Promise<ProjectWithDetails | null> {
  const { data: project, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (error || !project) {
    console.error('Error fetching project:', error)
    return null
  }

  const enriched = await enrichProjects([project as Project])
  return enriched.length > 0 ? enriched[0] : null
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
    .select('*, assignee:profiles!subtasks_assignee_id_fkey(*), creator:profiles!subtasks_created_by_fkey(*), project:projects!subtasks_project_id_fkey(title, sequential_mode)')
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
  const ext = file.name.split('.').pop() || 'bin'
  const path = `${userId}/${subtaskId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('subtask-attachments')
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) { console.error('uploadSubtaskAttachment:', error); return null }
  const { data: { publicUrl } } = supabase.storage.from('subtask-attachments').getPublicUrl(path)
  const isImage = file.type.startsWith('image/')
  return { url: publicUrl, name: file.name, type: isImage ? 'image' : 'document' }
}

// ============================================
// Helpers
// ============================================

async function enrichProjects(projects: Project[]): Promise<ProjectWithDetails[]> {
  if (projects.length === 0) return []

  const projectIds = projects.map(p => p.id)

  // Fetch all members for these projects
  const { data: allMembers } = await supabase
    .from('project_members')
    .select('*, user:profiles(*)')
    .in('project_id', projectIds)

  // Fetch all subtasks for these projects
  const { data: allSubtasks } = await supabase
    .from('subtasks')
    .select('*, assignee:profiles!subtasks_assignee_id_fkey(*), creator:profiles!subtasks_created_by_fkey(*)')
    .in('project_id', projectIds)
    .order('sort_order', { ascending: true })

  return projects.map(project => ({
    ...project,
    members: (allMembers || []).filter(m => m.project_id === project.id) as ProjectMember[],
    subtasks: (allSubtasks || []).filter(s => s.project_id === project.id) as Subtask[],
  }))
}
