import { supabase, UserProfile, UserRole } from './supabase'

// ============================================
// Types
// ============================================

export type TaskStatus = 'not_done' | 'partial' | 'done' | 'checked'
export type TaskTag = 'bonus' | null
export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  is_overdue: boolean
  due_date: string | null
  timing: string | null       // legacy / start_time alias
  end_time: string | null     // new end-time field
  require_check: boolean      // false = not_done>partial>done(completed); true = not_done>partial>done(await)>checked(completed)
  tag: TaskTag
  bonus_points: number
  recurrence: TaskRecurrence
  created_by: string
  created_at: string
  updated_at: string
}

export interface TaskAssignee {
  id: string
  task_id: string
  user_id: string
}

export interface TaskChecklistItem {
  id: string
  task_id: string
  text: string
  is_completed: boolean
  sort_order: number
  created_at: string
}

export interface TaskComment {
  id: string
  task_id: string
  user_id: string
  content: string
  attachment_url?: string | null
  attachment_name?: string | null
  attachment_type?: 'image' | 'document' | 'link' | null
  created_at: string
  user?: UserProfile
}

export interface Team {
  id: string
  name: string
  created_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  created_at: string
  user?: UserProfile
}

export interface TaskWithDetails extends Task {
  assignees: (TaskAssignee & { user?: UserProfile })[]
  checklist: TaskChecklistItem[]
  comments: TaskComment[]
  creator?: UserProfile
}

export interface NewTaskInput {
  title: string
  description?: string
  due_date?: string
  timing?: string      // start time
  end_time?: string    // end time
  require_check?: boolean
  tag?: TaskTag
  bonus_points?: number
  recurrence?: TaskRecurrence
  assignee_ids: string[]
  checklist_items?: string[]
}

export interface TaskFilter {
  status?: TaskStatus
  is_overdue?: boolean
  due_date_from?: string
  due_date_to?: string
}

// ============================================
// Status helpers
// ============================================

export const STATUS_LABELS: Record<TaskStatus, string> = {
  not_done: 'Not Done',
  partial: 'Partial',
  done: 'Done',
  checked: 'Checked',
}

/**
 * Returns the display label for a status, taking require_check into account.
 * - require_check=false: done → "Completed" (final state for everyone)
 * - require_check=true:  done → "Checking", checked → "Completed"
 */
export function getDynamicStatusLabel(status: TaskStatus, requireCheck: boolean): string {
  if (!requireCheck) {
    if (status === 'done') return 'Completed'
    if (status === 'checked') return 'Completed'
  } else {
    if (status === 'done') return 'Checking'
    if (status === 'checked') return 'Completed'
  }
  return STATUS_LABELS[status]
}

export const STATUS_COLORS: Record<TaskStatus, string> = {
  not_done: 'bg-red-100 text-red-700 border-red-200',
  partial: 'bg-amber-100 text-amber-700 border-amber-200',
  done: 'bg-green-100 text-green-700 border-green-200',
  checked: 'bg-blue-100 text-blue-700 border-blue-200',
}

/** Dynamic status colors: when require_check=true, done is yellow (checking); completed is always green */
export function getDynamicStatusColors(status: TaskStatus, requireCheck: boolean): string {
  if (requireCheck && status === 'done') return 'bg-yellow-100 text-yellow-700 border-yellow-200'
  if (status === 'checked') return 'bg-green-100 text-green-700 border-green-200'
  return STATUS_COLORS[status]
}

export const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  not_done: 'bg-red-500',
  partial: 'bg-amber-500',
  done: 'bg-green-500',
  checked: 'bg-blue-500',
}

export function getDynamicDotColor(status: TaskStatus, requireCheck: boolean): string {
  if (requireCheck && status === 'done') return 'bg-yellow-500'
  if (status === 'checked') return 'bg-green-500'
  return STATUS_DOT_COLORS[status]
}

export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  none: 'No Repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

/**
 * Returns the next status in the cycle.
 *
 * require_check = false (no verification needed):
 *   not_done → partial → done ("Completed") → not_done  (everyone cycles the same)
 *
 * require_check = true (verification required):
 *   Teacher (canCheck=false): not_done → partial → done ("Checking") → done (stuck)
 *   Coordinator+ (canCheck=true): not_done → partial → done → checked ("Completed") → not_done
 */
export function getNextStatus(current: TaskStatus, canCheck: boolean, requireCheck = true): TaskStatus {
  if (current === 'not_done') return 'partial'
  if (current === 'partial') return 'done'
  if (current === 'done') {
    if (requireCheck && canCheck) return 'checked'
    return 'not_done' // cycle back: completed (no check) or stuck then back (check required but can't check)
  }
  if (current === 'checked') return 'not_done'
  return current
}

// ============================================
// Task CRUD
// ============================================

export async function checkDuplicateTaskTitle(title: string, dueDate: string, assigneeIds: string[]): Promise<boolean> {
  const { data } = await supabase
    .from('tasks')
    .select('id, task_assignees!inner(user_id)')
    .eq('title', title)
    .eq('due_date', dueDate)
    .in('task_assignees.user_id', assigneeIds)
    .limit(1)
  return (data?.length ?? 0) > 0
}

export async function createTask(input: NewTaskInput, createdBy: string): Promise<Task | null> {
  const assigneeIds = input.assignee_ids.length > 0 ? input.assignee_ids : [createdBy]
  let firstTask: Task | null = null

  for (const assigneeId of assigneeIds) {
    const { data: task, error } = await supabase
      .from('tasks')
      .insert({
        title: input.title,
        description: input.description || null,
        due_date: input.due_date || null,
        timing: input.timing || null,
        end_time: input.end_time || null,
        require_check: input.require_check ?? false,
        tag: input.tag || null,
        bonus_points: input.bonus_points || 0,
        recurrence: input.recurrence || 'none',
        created_by: createdBy,
      })
      .select()
      .single()

    if (error || !task) {
      console.error('Error creating task:', error)
      continue
    }

    await supabase.from('task_assignees').insert({ task_id: task.id, user_id: assigneeId })

    if (input.checklist_items && input.checklist_items.length > 0) {
      const checklistRecords = input.checklist_items.map((text, i) => ({
        task_id: task.id,
        text,
        sort_order: i,
      }))
      await supabase.from('task_checklist_items').insert(checklistRecords)
    }

    if (!firstTask) firstTask = task as Task
  }

  return firstTask
}

export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<boolean> {
  const { error } = await supabase
    .from('tasks')
    .update({ status })
    .eq('id', taskId)

  if (error) {
    console.error('Error updating task status:', error)
    return false
  }

  if (status === 'checked') {
    await spawnNextRecurrence(taskId)
  } else if (status === 'done') {
    // For tasks with require_check=false, 'done' is the final/completed state
    const { data: t } = await supabase.from('tasks').select('require_check').eq('id', taskId).single()
    if (t && t.require_check === false) {
      await spawnNextRecurrence(taskId)
    }
  }

  return true
}

/** Build a YYYY-MM-DD string from parts, letting Date handle overflow. */
function formatDateParts(year: number, month: number, day: number): string {
  const d = new Date(year, month - 1, day)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// Prevents concurrent spawns for the same task (e.g. user rapidly taps complete)
const spawnInProgress = new Set<string>()

async function spawnNextRecurrence(taskId: string): Promise<void> {
  if (spawnInProgress.has(taskId)) return
  spawnInProgress.add(taskId)
  try {
    await _spawnNextRecurrence(taskId)
  } finally {
    spawnInProgress.delete(taskId)
  }
}

async function _spawnNextRecurrence(taskId: string): Promise<void> {
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single()

  if (!task || !task.recurrence || task.recurrence === 'none') return

  let nextDate: string | null = null
  if (task.due_date) {
    const [y, m, d] = task.due_date.split('-').map(Number)
    if (task.recurrence === 'daily') {
      nextDate = formatDateParts(y, m, d + 1)
    } else if (task.recurrence === 'weekly') {
      nextDate = formatDateParts(y, m, d + 7)
    } else if (task.recurrence === 'monthly') {
      nextDate = formatDateParts(y, m + 1, d)
    }
  }

  // Fetch assignees before inserting so we can check for duplicates
  const { data: assignees } = await supabase
    .from('task_assignees')
    .select('user_id')
    .eq('task_id', taskId)

  const assigneeIds = assignees?.map(a => a.user_id) ?? []

  // Guard: don't spawn if the next-occurrence task already exists
  if (nextDate && assigneeIds.length > 0) {
    const { data: existing } = await supabase
      .from('tasks')
      .select('id, task_assignees!inner(user_id)')
      .eq('title', task.title)
      .eq('due_date', nextDate)
      .in('task_assignees.user_id', assigneeIds)
      .limit(1)
    if ((existing?.length ?? 0) > 0) return
  }

  const { data: newTask, error } = await supabase
    .from('tasks')
    .insert({
      title: task.title,
      description: task.description,
      status: 'not_done',
      due_date: nextDate,
      timing: task.timing,
      end_time: task.end_time || null,
      require_check: task.require_check ?? false,
      tag: task.tag,
      bonus_points: task.bonus_points || 0,
      recurrence: task.recurrence,
      created_by: task.created_by,
    })
    .select()
    .single()

  if (error || !newTask) {
    console.error('Error spawning recurrence:', error)
    return
  }

  if (assigneeIds.length > 0) {
    await supabase.from('task_assignees').insert(
      assigneeIds.map(uid => ({ task_id: newTask.id, user_id: uid }))
    )
  }

  const { data: checklist } = await supabase
    .from('task_checklist_items')
    .select('text, sort_order')
    .eq('task_id', taskId)
    .order('sort_order', { ascending: true })

  if (checklist && checklist.length > 0) {
    await supabase.from('task_checklist_items').insert(
      checklist.map(c => ({ task_id: newTask.id, text: c.text, sort_order: c.sort_order }))
    )
  }
}

export async function updateTask(
  taskId: string,
  updates: Partial<Pick<Task, 'title' | 'description' | 'due_date' | 'timing' | 'end_time' | 'require_check' | 'tag' | 'bonus_points' | 'is_overdue' | 'recurrence'>>
): Promise<boolean> {
  const { error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', taskId)

  if (error) {
    console.error('Error updating task:', error)
    return false
  }
  return true
}

export async function updateTaskAssignees(taskId: string, assigneeIds: string[]): Promise<boolean> {
  // Delete existing assignees
  const { error: delErr } = await supabase
    .from('task_assignees')
    .delete()
    .eq('task_id', taskId)

  if (delErr) {
    console.error('Error deleting assignees:', delErr)
    return false
  }

  // Insert new assignees
  if (assigneeIds.length === 0) return true

  const { error: insErr } = await supabase
    .from('task_assignees')
    .insert(assigneeIds.map(uid => ({ task_id: taskId, user_id: uid })))

  if (insErr) {
    console.error('Error inserting assignees:', insErr)
    return false
  }

  return true
}

export async function updateChecklistItems(taskId: string, items: string[]): Promise<boolean> {
  // Delete existing items
  const { error: delErr } = await supabase
    .from('task_checklist_items')
    .delete()
    .eq('task_id', taskId)

  if (delErr) return false

  if (items.length === 0) return true

  const { error: insErr } = await supabase
    .from('task_checklist_items')
    .insert(items.map((text, i) => ({ task_id: taskId, text, sort_order: i })))

  return !insErr
}

export async function deleteTask(taskId: string): Promise<boolean> {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId)

  if (error) {
    console.error('Error deleting task:', error)
    return false
  }
  return true
}

// ============================================
// Task queries
// ============================================

export async function fetchTasksForUser(userId: string): Promise<TaskWithDetails[]> {
  const { data: assignees, error: aErr } = await supabase
    .from('task_assignees')
    .select('task_id')
    .eq('user_id', userId)

  if (aErr || !assignees) return []

  const taskIds = assignees.map(a => a.task_id)
  if (taskIds.length === 0) return []

  return fetchTasksByIds(taskIds)
}

export async function fetchTasksByIds(taskIds: string[]): Promise<TaskWithDetails[]> {
  if (taskIds.length === 0) return []

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .in('id', taskIds)
    .order('created_at', { ascending: false })

  if (error || !tasks) return []

  return hydrateTasks(tasks as Task[])
}

/**
 * Load the related rows (assignees, checklist, comments, creators) for a set of
 * already-fetched tasks and assemble them into TaskWithDetails. Shared by
 * fetchTasksByIds and fetchCalendarData so both produce identical, fully
 * populated task objects.
 */
async function hydrateTasks(tasks: Task[]): Promise<TaskWithDetails[]> {
  if (tasks.length === 0) return []

  const taskIds = tasks.map(t => t.id)

  const { data: allAssignees } = await supabase
    .from('task_assignees')
    .select('*, user:profiles(*)')
    .in('task_id', taskIds)

  const { data: allChecklists } = await supabase
    .from('task_checklist_items')
    .select('*')
    .in('task_id', taskIds)
    .order('sort_order', { ascending: true })

  const { data: allComments } = await supabase
    .from('task_comments')
    .select('*, user:profiles(*)')
    .in('task_id', taskIds)
    .order('created_at', { ascending: true })

  // Fetch creator profiles for permission checking
  const creatorIds = [...new Set(tasks.map(t => t.created_by))]
  const { data: creatorProfiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', creatorIds)

  const creatorMap = new Map<string, UserProfile>()
  creatorProfiles?.forEach(p => creatorMap.set(p.id, p as UserProfile))

  const todayStr = new Date().toISOString().split('T')[0]

  return tasks.map(task => ({
    ...task,
    recurrence: task.recurrence || 'none',
    require_check: task.require_check ?? false,
    end_time: task.end_time || null,
    is_overdue: !!(task.due_date && task.due_date < todayStr && task.status !== 'checked'),
    assignees: (allAssignees || []).filter(a => a.task_id === task.id),
    checklist: (allChecklists || []).filter(c => c.task_id === task.id),
    comments: (allComments || []).filter(c => c.task_id === task.id),
    creator: creatorMap.get(task.created_by),
  }))
}

/**
 * Lightweight assembly for list/grid rendering. Attaches only the comment
 * metadata the chips need (count + unread detection) and leaves the heavy
 * relations empty — assignees, checklist, full comments and creator are loaded
 * on demand via fetchTaskDetails when a task's modal is opened. This keeps the
 * calendar load cheap even when many tasks are shown (e.g. a large overdue
 * backlog), since the per-task profile/comment/checklist joins are skipped.
 */
async function hydrateTasksLight(tasks: Task[]): Promise<TaskWithDetails[]> {
  if (tasks.length === 0) return []

  const taskIds = tasks.map(t => t.id)

  // Comment metadata only: enough for the count badge and unread (red) marker.
  // No profile join and no content, so this stays small even with many comments.
  const { data: commentMeta } = await supabase
    .from('task_comments')
    .select('id, task_id, user_id, created_at')
    .in('task_id', taskIds)

  const todayStr = new Date().toISOString().split('T')[0]

  return tasks.map(task => ({
    ...task,
    recurrence: task.recurrence || 'none',
    require_check: task.require_check ?? false,
    end_time: task.end_time || null,
    is_overdue: !!(task.due_date && task.due_date < todayStr && task.status !== 'checked'),
    assignees: [],
    checklist: [],
    comments: ((commentMeta || []).filter(c => c.task_id === task.id) as unknown as TaskComment[]),
    creator: undefined,
  }))
}

export interface TaskDetails {
  assignees: (TaskAssignee & { user?: UserProfile })[]
  checklist: TaskChecklistItem[]
  comments: TaskComment[]
  creator?: UserProfile
}

/**
 * Load the full relations for a single task. Used by the detail modal so the
 * calendar list itself can stay lightweight (see hydrateTasksLight).
 */
export async function fetchTaskDetails(taskId: string, createdBy: string): Promise<TaskDetails> {
  const [assigneesRes, checklistRes, commentsRes, creatorRes] = await Promise.all([
    supabase.from('task_assignees').select('*, user:profiles(*)').eq('task_id', taskId),
    supabase.from('task_checklist_items').select('*').eq('task_id', taskId).order('sort_order', { ascending: true }),
    supabase.from('task_comments').select('*, user:profiles(*)').eq('task_id', taskId).order('created_at', { ascending: true }),
    supabase.from('profiles').select('*').eq('id', createdBy).single(),
  ])

  return {
    assignees: (assigneesRes.data || []) as (TaskAssignee & { user?: UserProfile })[],
    checklist: (checklistRes.data || []) as TaskChecklistItem[],
    comments: (commentsRes.data || []) as TaskComment[],
    creator: (creatorRes.data as UserProfile) || undefined,
  }
}

export async function fetchTodayTasks(userId: string): Promise<{ today: TaskWithDetails[]; overdueOrUndated: TaskWithDetails[] }> {
  const allTasks = await fetchTasksForUser(userId)
  const todayStr = new Date().toISOString().split('T')[0]

  const today = allTasks.filter(t => t.due_date === todayStr)
  const overdueOrUndated = allTasks.filter(t => {
    const isCompleted = t.status === 'checked' || (t.status === 'done' && !t.require_check)
    if (isCompleted) return false
    if (!t.due_date) return true
    if (t.due_date < todayStr) return true
    return false
  })

  return { today, overdueOrUndated }
}

export async function fetchWeekTasks(userId: string, weekStart: Date): Promise<TaskWithDetails[]> {
  const allTasks = await fetchTasksForUser(userId)
  // Use local date formatting to avoid UTC offset issues with toISOString()
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const startStr = fmt(weekStart)
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 6)
  const endStr = fmt(end)

  return allTasks.filter(t => t.due_date && t.due_date >= startStr && t.due_date <= endStr)
}

export async function fetchBonusTasks(userId: string): Promise<TaskWithDetails[]> {
  const allTasks = await fetchTasksForUser(userId)
  return allTasks.filter(t => t.bonus_points !== 0 || t.tag === 'bonus')
}

/**
 * Combined, DB-filtered fetch for the Weekly Calendar.
 *
 * The calendar previously called fetchWeekTasks + fetchTodayTasks + fetchBonusTasks
 * in parallel, each of which independently re-ran fetchTasksForUser — a full task
 * history pull (with assignee/checklist/comment/creator joins) that was then
 * filtered client-side. That fetched the entire history ~3× on every load.
 *
 * This makes a single pass and narrows the task set at the database so only the
 * rows the calendar can actually display are fetched (the week, anything not yet
 * completed, and bonus tasks). Old completed history is left in the DB instead of
 * being pulled over the wire on every load.
 *
 * Results are assembled with hydrateTasksLight: task rows + comment metadata for
 * the badges only. The heavy per-task relations (assignees, checklist, full
 * comments, creator) are loaded on demand via fetchTaskDetails when a modal opens,
 * so showing a large overdue backlog stays cheap.
 */
export async function fetchCalendarData(userId: string, weekStart: Date): Promise<{
  week: TaskWithDetails[]
  overdueOrUndated: TaskWithDetails[]
  bonus: TaskWithDetails[]
}> {
  // Use local date formatting to avoid UTC offset issues with toISOString()
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const startStr = fmt(weekStart)
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 6)
  const endStr = fmt(end)
  const todayStr = new Date().toISOString().split('T')[0]

  // Resolve the user's task ids first (matches existing RLS-safe access pattern).
  const { data: assignees } = await supabase
    .from('task_assignees')
    .select('task_id')
    .eq('user_id', userId)

  const taskIds = [...new Set((assignees ?? []).map(a => a.task_id))]
  if (taskIds.length === 0) return { week: [], overdueOrUndated: [], bonus: [] }

  // Only fetch tasks the calendar actually renders, filtered at the DB so old
  // completed history isn't pulled and hydrated on every load:
  //   • due within the visible week (any status), OR
  //   • still incomplete — not_done / partial, or done-awaiting-verification
  //     (status='done' with require_check=true), OR
  //   • bonus tasks (for the bonus panel, any date/status).
  // A task is "completed" when it is 'checked', or 'done' with require_check
  // false (the default). require_check defaults to false, so most completed
  // tasks are 'done' — hence we must match incomplete states explicitly rather
  // than just status != 'checked'. Completed tasks outside this week and
  // non-bonus are never shown, so they're excluded before the joins below.
  const { data: rawTasks, error } = await supabase
    .from('tasks')
    .select('*')
    .in('id', taskIds)
    .or(`and(due_date.gte.${startStr},due_date.lte.${endStr}),status.in.(not_done,partial),and(status.eq.done,require_check.is.true),bonus_points.neq.0,tag.eq.bonus`)
    .order('created_at', { ascending: false })

  if (error || !rawTasks) return { week: [], overdueOrUndated: [], bonus: [] }

  const allTasks = await hydrateTasksLight(rawTasks as Task[])

  const week = allTasks.filter(t => t.due_date && t.due_date >= startStr && t.due_date <= endStr)

  const overdueOrUndated = allTasks.filter(t => {
    const isCompleted = t.status === 'checked' || (t.status === 'done' && !t.require_check)
    if (isCompleted) return false
    if (!t.due_date) return true
    if (t.due_date < todayStr) return true
    return false
  })

  const bonus = allTasks.filter(t => t.bonus_points !== 0 || t.tag === 'bonus')

  return { week, overdueOrUndated, bonus }
}

/**
 * A task the current user assigned to someone else that the assignee has marked
 * as "Checking" (status='done' with require_check=true) and is therefore waiting
 * on the assigner (coordinator/principal/admin) to verify.
 */
export interface TaskAwaitingVerification {
  taskId: string
  title: string
  dueDate: string | null
  assigneeId: string
  assigneeName: string
  assigneeAvatarUrl: string | null
}

/**
 * Fetch tasks created by `userId` that are awaiting their verification:
 * status='done' + require_check=true (displayed as "Checking"), assigned to
 * someone other than the creator. One entry per assignee so each can link
 * straight to that assignee's calendar.
 */
export async function fetchTasksAwaitingVerification(userId: string): Promise<TaskAwaitingVerification[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, due_date, task_assignees(user_id, user:profiles(id, full_name, avatar_url))')
    .eq('created_by', userId)
    .eq('status', 'done')
    .eq('require_check', true)
    .order('due_date', { ascending: true })

  if (error || !data) return []

  const result: TaskAwaitingVerification[] = []
  for (const task of data as any[]) {
    for (const a of (task.task_assignees || [])) {
      if (a.user_id === userId) continue // skip self-assigned — only alert about others
      result.push({
        taskId: task.id,
        title: task.title,
        dueDate: task.due_date,
        assigneeId: a.user_id,
        assigneeName: a.user?.full_name || 'Unknown',
        assigneeAvatarUrl: a.user?.avatar_url ?? null,
      })
    }
  }
  return result
}

export async function fetchFilteredTasks(userId: string, filter: TaskFilter): Promise<TaskWithDetails[]> {
  const allTasks = await fetchTasksForUser(userId)

  return allTasks.filter(t => {
    if (filter.status && t.status !== filter.status) return false
    if (filter.is_overdue !== undefined && t.is_overdue !== filter.is_overdue) return false
    if (filter.due_date_from && (!t.due_date || t.due_date < filter.due_date_from)) return false
    if (filter.due_date_to && (!t.due_date || t.due_date > filter.due_date_to)) return false
    return true
  })
}

export async function fetchAnalyticsData(userId: string, period: 'week' | 'month' | 'year'): Promise<Record<TaskStatus, number>> {
  const allTasks = await fetchTasksForUser(userId)
  const now = new Date()
  let cutoff: Date

  if (period === 'week') {
    cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  } else if (period === 'month') {
    cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  } else {
    cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
  }

  const cutoffStr = cutoff.toISOString().split('T')[0]
  const filtered = allTasks.filter(t => {
    if (t.due_date && t.due_date >= cutoffStr) return true
    if (!t.due_date && t.created_at >= cutoff.toISOString()) return true
    return false
  })

  const { data: subtasks } = await supabase
    .from('subtasks')
    .select('status, due_date, created_at')
    .eq('assignee_id', userId)

  const filteredSubtasks = (subtasks || []).filter((s: any) => {
    if (s.due_date && s.due_date >= cutoffStr) return true
    if (!s.due_date && s.created_at >= cutoff.toISOString()) return true
    return false
  })

  const counts: Record<TaskStatus, number> = { not_done: 0, partial: 0, done: 0, checked: 0 }

  filtered.forEach(t => {
    // Mirror getDynamicStatusLabel: 'done' on a task that doesn't require
    // supervisor check is already Completed — count it in the checked bucket.
    if (t.status === 'done' && !t.require_check) {
      counts.checked++
    } else {
      counts[t.status]++
    }
  })

  // Subtasks have no require_check — 'done' subtask means completed.
  filteredSubtasks.forEach((s: any) => {
    if (s.status === 'done') {
      counts.checked++
    } else {
      counts[s.status as TaskStatus]++
    }
  })

  return counts
}

// ============================================
// Checklist operations
// ============================================

export async function toggleChecklistItem(itemId: string, isCompleted: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('task_checklist_items')
    .update({ is_completed: isCompleted })
    .eq('id', itemId)
  return !error
}

export async function addChecklistItem(taskId: string, text: string, sortOrder: number): Promise<TaskChecklistItem | null> {
  const { data, error } = await supabase
    .from('task_checklist_items')
    .insert({ task_id: taskId, text, sort_order: sortOrder })
    .select()
    .single()
  if (error) return null
  return data as TaskChecklistItem
}

// ============================================
// Comments
// ============================================

export async function addComment(
  taskId: string,
  userId: string,
  content: string,
  attachment?: { url: string; name: string; type: 'image' | 'document' | 'link' }
): Promise<TaskComment | null> {
  const { data, error } = await supabase
    .from('task_comments')
    .insert({
      task_id: taskId,
      user_id: userId,
      content,
      attachment_url: attachment?.url ?? null,
      attachment_name: attachment?.name ?? null,
      attachment_type: attachment?.type ?? null,
    })
    .select('*, user:profiles(*)')
    .single()
  if (error) return null
  return data as TaskComment
}

export async function uploadTaskAttachment(file: File, taskId: string, userId: string): Promise<{ url: string; name: string; type: 'image' | 'document' } | null> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `task-comments/${taskId}/${userId}/${Date.now()}_${safeName}`
  const { data, error } = await supabase.storage
    .from('classroom-files')
    .upload(path, file, { upsert: true })
  if (error) {
    console.error('Task attachment upload failed:', error)
    return null
  }
  const { data: { publicUrl } } = supabase.storage.from('classroom-files').getPublicUrl(data.path)
  const isImage = file.type.startsWith('image/')
  return { url: publicUrl, name: file.name, type: isImage ? 'image' : 'document' }
}

// ============================================
// Team queries - FIXED hierarchy
// ============================================

/**
 * Fetch accessible team members based on role hierarchy:
 * - Teacher: members of the same team(s) as the teacher (including coordinator)
 * - Coordinator: all members of teams where they are the designated coordinator,
 *   regardless of each member's global role (a coordinator-role user added as a
 *   plain member of this team is included too)
 * - Principal: all teachers + coordinators (all teams)
 * - Admin: all teachers + coordinators + principals (everyone)
 *
 * NEVER includes the current user (no duplicates)
 */
export async function fetchTeamMembers(userId: string, userRole: UserRole): Promise<UserProfile[]> {
  if (userRole === 'admin') {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .in('role', ['teacher', 'coordinator', 'principal'])
      .neq('id', userId)
      .order('full_name')

    if (error) return []
    return (data || []) as UserProfile[]
  }

  if (userRole === 'principal') {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .in('role', ['teacher', 'coordinator'])
      .neq('id', userId)
      .order('full_name')

    if (error) return []
    return (data || []) as UserProfile[]
  }

  if (userRole === 'coordinator') {
    // Only scope to teams where this user is the designated coordinator
    const { data: myTeams } = await supabase
      .from('teams')
      .select('id')
      .eq('coordinator_id', userId)

    if (!myTeams || myTeams.length === 0) return []

    const teamIds = myTeams.map(t => t.id)
    const { data: members } = await supabase
      .from('team_members')
      .select('user_id, user:profiles(*)')
      .in('team_id', teamIds)

    if (!members) return []

    const uniqueUsers = new Map<string, UserProfile>()
    members.forEach(m => {
      const profile = m.user as unknown as UserProfile
      // Include all members regardless of global role; skip self
      if (profile && m.user_id !== userId) {
        uniqueUsers.set(m.user_id, profile)
      }
    })

    return Array.from(uniqueUsers.values()).sort((a, b) =>
      (a.full_name || '').localeCompare(b.full_name || '')
    )
  }

  if (userRole === 'teacher') {
    // Teacher sees all members of their team(s), including coordinator
    const { data: myTeams } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)

    if (!myTeams || myTeams.length === 0) return []

    const teamIds = myTeams.map(t => t.team_id)
    const { data: members } = await supabase
      .from('team_members')
      .select('user_id, user:profiles(*)')
      .in('team_id', teamIds)

    if (!members) return []

    const uniqueUsers = new Map<string, UserProfile>()
    members.forEach(m => {
      const profile = m.user as unknown as UserProfile
      if (profile && m.user_id !== userId) {
        uniqueUsers.set(m.user_id, profile)
      }
    })

    return Array.from(uniqueUsers.values()).sort((a, b) =>
      (a.full_name || '').localeCompare(b.full_name || '')
    )
  }

  return []
}

export async function fetchTeamAnalytics(userId: string, userRole: UserRole, month?: string): Promise<{
  members: { user: UserProfile; stats: { completed: number; bonus: number; overdue: number; total: number; completionRate: number } }[]
  teamCompletionRate: number
}> {
  // Delegate to the server-side API route which uses the service role key to
  // bypass RLS — this is the only way to read task assignments for other users.
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { members: [], teamCompletionRate: 0 }

    const url = month ? `/api/analytics/team?month=${month}` : '/api/analytics/team'
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!res.ok) return { members: [], teamCompletionRate: 0 }
    return await res.json()
  } catch {
    return { members: [], teamCompletionRate: 0 }
  }
}
