import { supabase, UserProfile, UserRole } from './supabase'
import { compressImageIfNeeded } from './imageCompression'
import { attachmentProblem, isImageAttachment, normalizeLinkUrl } from './attachmentPolicy'
import { uploadPrivateFile } from './privateFiles'
import { taskDisplayTitle } from './taskClasses'

// ============================================
// Types
// ============================================

export type TaskStatus = 'not_done' | 'partial' | 'done' | 'checked' | 'dismissed'
export type TaskTag = 'bonus' | null
export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  is_overdue: boolean
  due_date: string | null
  timing: string | null       // custom start time; period tasks leave it null
  end_time: string | null     // custom end time
  period: number | null       // 1-based period number
  period_end: number | null   // last period of a run of several; null = one period
  classes: string[]           // grade + section labels, e.g. ['7B', '7C']
  require_check: boolean      // false = not_done>partial>done(completed); true = not_done>partial>done(await)>checked(completed)
  tag: TaskTag
  bonus_points: number
  recurrence: TaskRecurrence
  created_by: string
  created_at: string
  updated_at: string
  completed_by: string | null // who last moved this into its completed state; cleared on reopen
  completed_at: string | null
  requires_submission: boolean // if true, submission_note must be filled before the task can be marked done
  submission_note: string | null
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
  completer?: UserProfile
}

export interface NewTaskInput {
  title: string
  description?: string
  due_date?: string
  timing?: string      // custom start time
  end_time?: string    // custom end time
  period?: number
  period_end?: number
  classes?: string[]
  require_check?: boolean
  requires_submission?: boolean
  tag?: TaskTag
  bonus_points?: number
  recurrence?: TaskRecurrence
  assignee_ids: string[]
  checklist_items?: string[]
}

/**
 * The only profile fields the assignee pickers, avatars and member lists in the
 * Task Manager read. The profiles joins throughout this file have always
 * selected exactly these; the places that used to select '*' were shipping all
 * 15 columns of a profile row for the four that actually get rendered.
 */
const ASSIGNEE_PROFILE_COLUMNS = 'id, full_name, avatar_url, role'

// ============================================
// Status helpers
// ============================================

export const STATUS_LABELS: Record<TaskStatus, string> = {
  not_done: 'Not done',
  partial: 'Partial',
  done: 'Done',
  checked: 'Checked',
  dismissed: 'Dismissed',
}

/**
 * Returns the display label for a status, taking require_check into account.
 * - require_check=false: done → "Completed" (final state for everyone)
 * - require_check=true:  done → "Checking", checked → "Completed"
 */
export function getDynamicStatusLabel(status: TaskStatus, requireCheck: boolean): string {
  if (status === 'dismissed') return 'Dismissed'
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
  dismissed: 'bg-slate-100 text-slate-500 border-slate-200',
}

/** Dynamic status colors: when require_check=true, done is yellow (checking); completed is always green */
export function getDynamicStatusColors(status: TaskStatus, requireCheck: boolean): string {
  if (status === 'dismissed') return 'bg-slate-100 text-slate-500 border-slate-200'
  if (requireCheck && status === 'done') return 'bg-yellow-100 text-yellow-700 border-yellow-200'
  if (status === 'checked') return 'bg-green-100 text-green-700 border-green-200'
  return STATUS_COLORS[status]
}

export const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  not_done: 'bg-red-500',
  partial: 'bg-amber-500',
  done: 'bg-green-500',
  checked: 'bg-blue-500',
  dismissed: 'bg-slate-400',
}

export function getDynamicDotColor(status: TaskStatus, requireCheck: boolean): string {
  if (status === 'dismissed') return 'bg-slate-400'
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

/** A task is "completed" once it's checked (verified) or done with no verification required. */
export function isTaskCompleted(task: Pick<Task, 'status' | 'require_check'>): boolean {
  return task.status === 'checked' || (task.status === 'done' && !task.require_check)
}

/** Whether advancing `task` to `nextStatus` is blocked on a missing submission note. */
export function needsSubmissionFirst(task: Pick<Task, 'requires_submission' | 'submission_note'>, nextStatus: TaskStatus): boolean {
  return nextStatus === 'done' && task.requires_submission && !task.submission_note
}

/** "Jun 3, 4:00 PM" — used for created/completed audit timestamps. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

/**
 * Whether `userId` may verify (advance done→checked, reopen a checked item,
 * or dismiss) a task or subtask that requires verification.
 *
 * Role-based checkers (coordinator/principal/admin — the `canCheckRole` flag
 * threaded down from the page) can always verify. The creator may also
 * self-verify their own item, EXCEPT when it carries bonus points: bonus
 * tasks exist specifically so someone other than the person awarding
 * themselves the points signs off, so a bonus task's creator is stuck at
 * "Checking" until a role-based checker verifies it.
 */
export function canVerifyTask(
  item: { created_by: string | null; tag: TaskTag; bonus_points: number },
  userId: string | null | undefined,
  canCheckRole: boolean
): boolean {
  if (canCheckRole) return true
  if (!userId || item.created_by !== userId) return false
  const isBonus = item.tag === 'bonus' || item.bonus_points > 0
  return !isBonus
}

/**
 * Returns the next status in the cycle.
 *
 * require_check = false (no verification needed):
 *   not_done → partial → done ("Completed") → not_done  (everyone cycles the same)
 *
 * require_check = true (verification required):
 *   Verifier (canCheck=true):       not_done → partial → done → checked ("Completed") → not_done
 *   Everyone else (canCheck=false): not_done → partial → done ("Checking") → not_done (cycles, never reaches checked)
 *
 * Pass canVerifyTask(item, userId, canCheckRole) as `canCheck`.
 */
export function getNextStatus(current: TaskStatus, canCheck: boolean, requireCheck = true): TaskStatus {
  // Dismissed is a terminal, verifier-set state outside the normal cycle.
  // Tapping the status icon on a dismissed task restores it to Not Done.
  if (current === 'dismissed') return 'not_done'
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

/** Same name, same classes, same day, same person. The same name for another class is a different task. */
export async function checkDuplicateTaskTitle(title: string, dueDate: string, assigneeIds: string[], classes: string[] = []): Promise<boolean> {
  const { data } = await supabase
    .from('tasks')
    .select('id, classes, task_assignees!inner(user_id)')
    .eq('title', title)
    .eq('due_date', dueDate)
    .in('task_assignees.user_id', assigneeIds)
  const want = [...classes].sort().join('|')
  return (data ?? []).some(t => [...((t as { classes: string[] | null }).classes ?? [])].sort().join('|') === want)
}

/**
 * Whether any of `assigneeIds` already has a task in periods [period,
 * periodEnd] on `dueDate`, so nobody is double-booked into one period. Pass
 * `excludeTaskId` when editing a task so it doesn't conflict with itself.
 * Dismissed tasks don't count.
 */
export async function checkTaskPeriodConflict(
  dueDate: string,
  period: number,
  periodEnd: number,
  assigneeIds: string[],
  excludeTaskId?: string
): Promise<boolean> {
  if (!dueDate || !period || assigneeIds.length === 0) return false

  let query = supabase
    .from('tasks')
    .select('id, period, period_end, task_assignees!inner(user_id)')
    .eq('due_date', dueDate)
    .in('task_assignees.user_id', assigneeIds)
    .not('period', 'is', null)
    .lte('period', periodEnd)
    .neq('status', 'dismissed')

  if (excludeTaskId) query = query.neq('id', excludeTaskId)

  const { data } = await query
  return (data as { period: number; period_end: number | null }[] | null ?? []).some(
    t => (t.period_end ?? t.period) >= period
  )
}

/**
 * The same check for a task given a custom time: another custom-time task
 * overlapping [timing, endTime). Period tasks have no clock time to compare.
 */
export async function checkTaskSlotConflict(
  dueDate: string,
  timing: string,
  endTime: string,
  assigneeIds: string[],
  excludeTaskId?: string
): Promise<boolean> {
  if (!dueDate || !timing || !endTime || assigneeIds.length === 0) return false

  let query = supabase
    .from('tasks')
    .select('id, timing, end_time, task_assignees!inner(user_id)')
    .eq('due_date', dueDate)
    .in('task_assignees.user_id', assigneeIds)
    .is('period', null)
    .not('timing', 'is', null)
    .not('end_time', 'is', null)
    .neq('status', 'dismissed')

  if (excludeTaskId) query = query.neq('id', excludeTaskId)

  const { data } = await query
  if (!data) return false

  return (data as { timing: string; end_time: string }[]).some(
    t => t.timing < endTime && timing < t.end_time
  )
}

// Postgres "undefined_column" — thrown when a migration adding a column
// referenced below hasn't been run yet. Retrying without those columns keeps
// task creation/status updates working in the meantime instead of hard-failing.
const UNDEFINED_COLUMN = '42703'

export async function createTask(input: NewTaskInput, createdBy: string): Promise<Task | null> {
  const assigneeIds = input.assignee_ids.length > 0 ? input.assignee_ids : [createdBy]

  // Assigning to N people creates N independent task instances (one row each,
  // each with its own single assignee) — every row has identical content, so
  // batching the inserts is safe regardless of which returned row pairs with
  // which assignee.
  const row = {
    title: input.title,
    description: input.description || null,
    due_date: input.due_date || null,
    timing: input.period ? null : input.timing || null,
    end_time: input.period ? null : input.end_time || null,
    period: input.period ?? null,
    period_end: input.period && input.period_end && input.period_end > input.period ? input.period_end : null,
    classes: input.classes ?? [],
    require_check: input.require_check ?? false,
    requires_submission: input.requires_submission ?? false,
    tag: input.tag || null,
    bonus_points: input.bonus_points || 0,
    recurrence: input.recurrence || 'none',
    created_by: createdBy,
  }
  const rows = assigneeIds.map(() => ({ ...row }))

  let { data: tasks, error } = await supabase.from('tasks').insert(rows).select()
  if (error?.code === UNDEFINED_COLUMN) {
    const fallbackRows = rows.map(({ requires_submission: _requires_submission, ...fallbackRow }) => fallbackRow)
    ;({ data: tasks, error } = await supabase.from('tasks').insert(fallbackRows).select())
  }

  if (error || !tasks || tasks.length === 0) {
    console.error('Error creating task:', error)
    return null
  }

  // Both inserts depend on the new task rows but not on each other, so they go
  // out together — task creation is an interactive path (the grid's inline
  // quick-add), where a saved round-trip is visible.
  await Promise.all([
    supabase.from('task_assignees').insert(
      tasks.map((task, i) => ({ task_id: task.id, user_id: assigneeIds[i] }))
    ),
    input.checklist_items?.length
      ? supabase.from('task_checklist_items').insert(
          tasks.flatMap(task =>
            input.checklist_items!.map((text, i) => ({ task_id: task.id, text, sort_order: i }))
          )
        )
      : Promise.resolve(),
  ])

  return tasks[0] as Task
}

/**
 * Updates a task's status. `actorId` is recorded as `completed_by`/`completed_at`
 * whenever this transition lands the task in its completed state (checked, or
 * done with require_check=false) — cleared again if the task is reopened.
 */
export async function updateTaskStatus(taskId: string, status: TaskStatus, actorId: string): Promise<boolean> {
  const { data: t } = await supabase.from('tasks').select('require_check').eq('id', taskId).single()
  const requireCheck = t?.require_check ?? false
  const isCompleting = status === 'checked' || (status === 'done' && !requireCheck)

  let { error } = await supabase
    .from('tasks')
    .update({
      status,
      completed_by: isCompleting ? actorId : null,
      completed_at: isCompleting ? new Date().toISOString() : null,
    })
    .eq('id', taskId)

  if (error?.code === UNDEFINED_COLUMN) {
    ;({ error } = await supabase.from('tasks').update({ status }).eq('id', taskId))
  }

  if (error) {
    console.error('Error updating task status:', error)
    return false
  }

  if (isCompleting) {
    await spawnNextRecurrence(taskId)
  }

  return true
}

/** Saves the assignee's submission note for a task that requires one. */
export async function submitTaskWork(taskId: string, note: string): Promise<boolean> {
  const { error } = await supabase
    .from('tasks')
    .update({ submission_note: note })
    .eq('id', taskId)

  if (error) {
    console.error('Error submitting task work:', error)
    return false
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
      period: task.period ?? null,
      period_end: task.period_end ?? null,
      classes: task.classes ?? [],
      require_check: task.require_check ?? false,
      requires_submission: task.requires_submission ?? false,
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

/** Renames a task, or changes the classes it is for. */
export async function updateTaskDetails(
  taskId: string,
  patch: { title?: string; classes?: string[] },
): Promise<boolean> {
  const { error } = await supabase.from('tasks').update(patch).eq('id', taskId)
  if (error) {
    console.error('Error updating task:', error)
    return false
  }
  return true
}

/**
 * One unnamed task per period the timetable gives the teacher, named by its
 * classes until the teacher names it. One insert for the tasks and one for
 * their assignee, however many periods the week has.
 */
export async function createTimetableTasks(
  periods: { date: string; period: number; classes: string[] }[],
  assigneeId: string,
  createdBy: string,
): Promise<Task[] | null> {
  if (periods.length === 0) return []
  const { data: tasks, error } = await supabase
    .from('tasks')
    .insert(periods.map(p => ({
      title: '',
      due_date: p.date,
      period: p.period,
      classes: p.classes,
      created_by: createdBy,
    })))
    .select()
  if (error || !tasks) {
    console.error('Error creating timetable tasks:', error)
    return null
  }
  const { error: aErr } = await supabase
    .from('task_assignees')
    .insert(tasks.map(t => ({ task_id: t.id, user_id: assigneeId })))
  if (aErr) {
    // Unassigned tasks would be invisible to everyone, so they don't stay.
    console.error('Error assigning timetable tasks:', aErr)
    await supabase.from('tasks').delete().in('id', tasks.map(t => t.id))
    return null
  }
  return tasks as Task[]
}

// ============================================
// Task queries
// ============================================

/** Bucket rows carrying a task_id into a Map, preserving their query order. */
function groupByTaskId<T extends { task_id: string }>(rows: T[] | null): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows ?? []) {
    const bucket = map.get(row.task_id)
    if (bucket) bucket.push(row)
    else map.set(row.task_id, [row])
  }
  return map
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

  const commentsByTask = groupByTaskId(commentMeta)
  const todayStr = new Date().toISOString().split('T')[0]

  return tasks.map(task => ({
    ...task,
    recurrence: task.recurrence || 'none',
    require_check: task.require_check ?? false,
    end_time: task.end_time || null,
    is_overdue: !!(task.due_date && task.due_date < todayStr && task.status !== 'checked'),
    assignees: [],
    checklist: [],
    comments: (commentsByTask.get(task.id) ?? []) as unknown as TaskComment[],
    creator: undefined,
  }))
}

// Minimal hydration for overdue/bonus list panels — skips the comment metadata
// round-trip since those panels only need title, status, and date.
function hydrateTasksMinimal(tasks: Task[]): TaskWithDetails[] {
  const todayStr = new Date().toISOString().split('T')[0]
  return tasks.map(task => ({
    ...task,
    recurrence: task.recurrence || 'none',
    require_check: task.require_check ?? false,
    end_time: task.end_time || null,
    is_overdue: !!(task.due_date && task.due_date < todayStr && task.status !== 'checked'),
    assignees: [],
    checklist: [],
    comments: [],
    creator: undefined,
  }))
}

export interface TaskDetails {
  assignees: (TaskAssignee & { user?: UserProfile })[]
  checklist: TaskChecklistItem[]
  comments: TaskComment[]
  creator?: UserProfile
  completer?: UserProfile
}

/**
 * Load the full relations for a single task. Used by the detail modal so the
 * calendar list itself can stay lightweight (see hydrateTasksLight).
 */
export async function fetchTaskDetails(taskId: string, createdBy: string, completedBy?: string | null): Promise<TaskDetails> {
  const [assigneesRes, checklistRes, commentsRes, creatorRes, completerRes] = await Promise.all([
    supabase.from('task_assignees').select('*, user:profiles(id, full_name, avatar_url, role)').eq('task_id', taskId),
    supabase.from('task_checklist_items').select('*').eq('task_id', taskId).order('sort_order', { ascending: true }),
    supabase.from('task_comments').select('*, user:profiles(id, full_name, avatar_url, role)').eq('task_id', taskId).order('created_at', { ascending: true }),
    // Same four columns the sibling joins above select — the modal shows a
    // name, an avatar and a role label for the creator/completer, nothing more.
    supabase.from('profiles').select(ASSIGNEE_PROFILE_COLUMNS).eq('id', createdBy).single(),
    completedBy
      ? supabase.from('profiles').select(ASSIGNEE_PROFILE_COLUMNS).eq('id', completedBy).single()
      : Promise.resolve({ data: null }),
  ])

  return {
    assignees: (assigneesRes.data || []) as (TaskAssignee & { user?: UserProfile })[],
    checklist: (checklistRes.data || []) as TaskChecklistItem[],
    comments: (commentsRes.data || []) as TaskComment[],
    creator: (creatorRes.data as UserProfile) || undefined,
    completer: (completerRes.data as UserProfile) || undefined,
  }
}

/**
 * Fetches only the tasks due within the visible week for the Weekly Calendar.
 * Overdue and bonus sections are lazy-loaded on first expand via
 * fetchOverdueTasks / fetchBonusTasksForCalendar, so the initial page load is
 * limited to the handful of tasks actually visible in the grid.
 */
export async function fetchCalendarData(userId: string, weekStart: Date): Promise<{
  week: TaskWithDetails[]
}> {
  // Use local date formatting to avoid UTC offset issues with toISOString()
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const startStr = fmt(weekStart)
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 6)
  const endStr = fmt(end)

  // Still one round-trip, but driven from the user's own assignments.
  //
  // The previous form (`tasks?select=*,task_assignees!inner(user_id)`) reads the same
  // rows, but PostgREST renders it as a LATERAL whose driving side is `tasks` — so the
  // database walked every task in the range school-wide and ran the assignee lookup per
  // row. Measured at ~1.0s per call on an idle database. Eighty staff opening the app
  // at 08:45 turned that into pool exhaustion and a project-wide PGRST002 outage; see
  // supabase-migrations/perf_task_calendar_join_direction.sql.
  const { data: rawTasks, error } = await supabase.rpc('tasks_for_user_week', {
    p_user_id: userId,
    p_start: startStr,
    p_end: endStr,
  })

  if (error || !rawTasks) return { week: [] }

  const week = await hydrateTasksLight(rawTasks as Task[])
  return { week }
}

/**
 * Lazy-loaded overdue/undated tasks for the calendar's collapsible section.
 * Called only when the user expands the "Overdue" panel, so the initial
 * calendar load is not blocked by potentially large backlogs.
 */
export async function fetchOverdueTasks(userId: string): Promise<TaskWithDetails[]> {
  const todayStr = new Date().toISOString().split('T')[0]

  // Keeps both properties the hand-built filter was protecting — one round-trip, and
  // no assignee-id list in the URL — while letting the planner start from this user's
  // assignments instead of scanning every open task in the school. The status and date
  // conditions now live in SQL, so they can no longer be mangled by PostgREST's
  // single-`or=`-param limitation.
  const { data: rawTasks, error } = await supabase.rpc('tasks_overdue_for_user', {
    p_user_id: userId,
    p_today: todayStr,
  })

  if (error || !rawTasks) return []

  return hydrateTasksMinimal(rawTasks as Task[])
}

/**
 * Lazy-loaded bonus tasks for the calendar's collapsible bonus panel.
 * Called only when the user expands the "Bonus Tasks" section.
 */
export async function fetchBonusTasksForCalendar(userId: string): Promise<TaskWithDetails[]> {
  // Driven from the user's assignments for the same reason as the overdue panel above.
  const { data: rawTasks, error } = await supabase.rpc('tasks_bonus_for_user', {
    p_user_id: userId,
  })

  if (error || !rawTasks) return []

  return hydrateTasksMinimal(rawTasks as Task[])
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
    .select('id, title, classes, due_date, task_assignees(user_id, user:profiles(id, full_name, avatar_url))')
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
        title: taskDisplayTitle(task),
        dueDate: task.due_date,
        assigneeId: a.user_id,
        assigneeName: a.user?.full_name || 'Unknown',
        assigneeAvatarUrl: a.user?.avatar_url ?? null,
      })
    }
  }
  return result
}

export interface TaskAnalyticsSummary {
  counts: Record<TaskStatus, number>
  total: number
  completionRate: number
  overdue: number
  bonusPoints: number
}

export async function fetchAnalyticsData(userId: string, period: 'week' | 'month' | 'year'): Promise<TaskAnalyticsSummary> {
  const now = new Date()
  let cutoff: Date

  if (period === 'week') {
    cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  } else if (period === 'month') {
    cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  } else {
    cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
  }

  const todayStr = now.toISOString().split('T')[0]
  const cutoffStr = cutoff.toISOString().split('T')[0]
  const cutoffISO = cutoff.toISOString()
  // Dismissed tasks/subtasks are treated as deleted — excluded from every count.
  const dateFilter = `due_date.gte.${cutoffStr},and(due_date.is.null,created_at.gte.${cutoffISO})`

  // Push the date/status filters into the query and page past Supabase's
  // 1000-row response cap with .range(). The previous version pulled this
  // user's ENTIRE task history via a two-step task_assignees→tasks lookup
  // with no server-side date filter, then filtered client-side — for anyone
  // with a long task history (recurring daily tasks especially) that silently
  // truncated to an arbitrary 1000 rows before the date filter ever ran,
  // undercounting every period.
  const PAGE = 1000

  type Row = { status: TaskStatus; require_check: boolean | null; due_date: string | null; bonus_points: number | null }

  /** Page through one table until a short page signals the end. */
  const fetchAllPages = async (
    label: string,
    page: (from: number) => PromiseLike<{ data: unknown; error: unknown }>,
  ): Promise<Row[]> => {
    const rows: Row[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await page(from)
      if (error) {
        console.error(`fetchAnalyticsData ${label} error:`, error)
        break
      }
      const batch = (data ?? []) as Row[]
      rows.push(...batch)
      if (batch.length < PAGE) break
    }
    return rows
  }

  // Tasks and subtasks are independent tables — page through both at once so
  // the Analytics tab waits on the slower of the two, not on their sum.
  const [taskRows, subtaskRows] = await Promise.all([
    // Driven from the user's assignments, like the calendar reads — the embedded
    // `task_assignees!inner` form this replaces made PostgREST scan every task in the
    // window school-wide and run the assignee lookup per row (94.3ms mean). The page
    // ordering is total (created_at, then id) so pages cannot overlap or skip a row
    // when two tasks share a created_at.
    fetchAllPages('tasks', from =>
      supabase.rpc('task_stats_rows_for_user', {
        p_user_id: userId,
        p_cutoff_date: cutoffStr,
        p_cutoff_ts: cutoffISO,
        p_offset: from,
        p_limit: PAGE,
      })),
    fetchAllPages('subtasks', from =>
      supabase
        .from('subtasks')
        .select('status, require_check, due_date, bonus_points')
        .eq('assignee_id', userId)
        .neq('status', 'dismissed')
        .or(dateFilter)
        .range(from, from + PAGE - 1)),
  ])

  const counts: Record<TaskStatus, number> = { not_done: 0, partial: 0, done: 0, checked: 0, dismissed: 0 }
  let overdue = 0
  let bonusPoints = 0

  const tally = (r: Row) => {
    // Mirror getDynamicStatusLabel: 'done' on an item that doesn't require
    // supervisor check is already Completed — count it in the checked bucket.
    const isCheckedComplete = r.status === 'checked' || (r.status === 'done' && !r.require_check)
    if (isCheckedComplete) {
      counts.checked++
      bonusPoints += r.bonus_points ?? 0
    } else {
      counts[r.status]++
      if (r.due_date && r.due_date < todayStr) overdue++
    }
  }

  taskRows.forEach(tally)
  subtaskRows.forEach(tally)

  const total = taskRows.length + subtaskRows.length
  const completionRate = total > 0 ? Math.round((counts.checked / total) * 100) : 0

  return { counts, total, completionRate, overdue, bonusPoints }
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
  // A link attachment is rendered as an href for everyone on the task, so
  // only a web link is ever stored as one.
  if (attachment?.type === 'link') {
    const url = normalizeLinkUrl(attachment.url)
    if (!url) return null
    attachment = { ...attachment, url }
  }
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
    .select('*, user:profiles(id, full_name, avatar_url, role)')
    .single()
  if (error) return null
  return data as TaskComment
}

export async function uploadTaskAttachment(file: File, taskId: string, userId: string): Promise<{ url: string; name: string; type: 'image' | 'document' } | null> {
  if (attachmentProblem(file)) return null
  const isImage = isImageAttachment(file.name)
  const compressed = isImage ? await compressImageIfNeeded(file) : file
  const safeName = compressed.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  // Private: readable by whoever can read the comment (see lib/privateFiles).
  const ref = await uploadPrivateFile(`task-comments/${taskId}/${userId}/${Date.now()}_${safeName}`, compressed)
  if (!ref) return null
  return { url: ref, name: compressed.name, type: isImage ? 'image' : 'document' }
}

// ============================================
// Team queries - FIXED hierarchy
// ============================================

/**
 * Fetch accessible team members based on role hierarchy:
 * - Teacher: members of the same team(s) as the teacher (including coordinator)
 * - Coordinator: members of teams where they are a designated coordinator,
 *   excluding principals/admins — teams auto-add every principal/admin as a
 *   member, but a coordinator should never see their superiors here
 * - Principal: all teachers + coordinators (all teams) — never admins
 * - Admin: all teachers + coordinators + principals (everyone)
 *
 * NEVER includes the current user (no duplicates)
 */
export async function fetchTeamMembers(userId: string, userRole: UserRole): Promise<UserProfile[]> {
  if (userRole === 'admin') {
    const { data, error } = await supabase
      .from('profiles')
      .select(ASSIGNEE_PROFILE_COLUMNS)
      .in('role', ['teacher', 'coordinator', 'principal'])
      .neq('id', userId)
      .order('full_name')

    if (error) return []
    return (data || []) as unknown as UserProfile[]
  }

  if (userRole === 'principal') {
    const { data, error } = await supabase
      .from('profiles')
      .select(ASSIGNEE_PROFILE_COLUMNS)
      .in('role', ['teacher', 'coordinator'])
      .neq('id', userId)
      .order('full_name')

    if (error) return []
    return (data || []) as unknown as UserProfile[]
  }

  if (userRole === 'coordinator') {
    // Only scope to teams where this user is a designated coordinator
    const { data: myTeams } = await supabase
      .from('team_coordinators')
      .select('team_id')
      .eq('user_id', userId)

    if (!myTeams || myTeams.length === 0) return []

    const teamIds = myTeams.map(t => t.team_id)
    const { data: members } = await supabase
      .from('team_members')
      .select('user_id, user:profiles(id, full_name, avatar_url, role)')
      .in('team_id', teamIds)

    if (!members) return []

    const uniqueUsers = new Map<string, UserProfile>()
    members.forEach(m => {
      const profile = m.user as unknown as UserProfile
      // Include teammates regardless of role, but never a superior — teams
      // auto-add every principal/admin as a member, which would otherwise
      // put them in a coordinator's assignee/toggle list.
      if (profile && m.user_id !== userId && profile.role !== 'principal' && profile.role !== 'admin') {
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
      .select('user_id, user:profiles(id, full_name, avatar_url, role)')
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
