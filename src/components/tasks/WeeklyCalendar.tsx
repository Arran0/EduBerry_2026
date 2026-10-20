'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence } from 'framer-motion'
import {
  Plus, AlertTriangle, FolderKanban, Star, HelpCircle, FileSpreadsheet, Maximize2, ChevronDown, Loader2,
} from 'lucide-react'
import TeamMemberSelector from './TeamMemberSelector'
import {
  fetchCalendarData, fetchOverdueTasks, fetchBonusTasksForCalendar, createTask, Task, TaskWithDetails, TaskStatus,
  getNextStatus, canVerifyTask, updateTaskStatus, needsSubmissionFirst, isTaskCompleted,
} from '@/lib/tasks'
import { fetchSubtasksForCalendar, Subtask, SubtaskWithProject, updateSubtaskStatus } from '@/lib/projects'
import { UserProfile } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useMediaQuerySync } from '@/hooks/useMediaQuery'
import { TASK_SLOTS, TaskSlot, formatSlotTime } from '@/lib/taskSlots'
import { fetchActiveTimetablePeriodSlots } from '@/lib/taskPeriods'
import { TaskDeck, Stepper, StatusMark, Btn, SX, Panel } from './ui'

// Every popup loads the first time it is opened, not with the page. The
// loaders are kept so a hover on the button that opens one can start the
// download early.
const loadNewTaskForm = () => import('./NewTaskForm')
const loadTaskDetail = () => import('./TaskDetailSheet')
const NewTaskForm = dynamic(loadNewTaskForm)
const TaskDetailSheet = dynamic(loadTaskDetail)
const SubtaskCard = dynamic(() => import('./SubtaskCard'))
const PlannerModal = dynamic(() => import('./PlannerModal'))

interface WeeklyCalendarProps {
  userId: string
  profile: UserProfile
  canCheck: boolean
  canAssignToOthers: boolean
  availableAssignees: UserProfile[]
  viewingUserId?: string
  initialDate?: string
  /** When set, the calendar jumps to the task's week and opens it. */
  focusTaskId?: string
  /** Bumped each time a focus is requested so repeat clicks re-trigger the jump. */
  focusNonce?: number
  teamMembers?: UserProfile[]
  currentUserId?: string
  currentUserName?: string
  onViewingUserChange?: (userId: string) => void
  /** Fired when a task's status changes or it is deleted (lets parents refresh). */
  onTaskActivity?: () => void
}

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  d.setHours(0, 0, 0, 0)
  return d
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getDayLabel(date: Date) {
  return { day: DAYS[date.getDay()], date: date.getDate(), month: MONTHS[date.getMonth()], full: formatDate(date) }
}

function monthKeyLabel(key: string): string {
  if (key === 'undated') return 'No date'
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

/** Chip fill by status — the same colours the status legend shows. */
const CHIP_STYLE: Record<TaskStatus, string> = {
  not_done: 'border-[#E2DDD2] bg-white hover:border-[#CFC8B8]',
  partial: 'border-orange-300 bg-orange-50 hover:border-orange-400',
  done: 'border-yellow-300 bg-yellow-50 hover:border-yellow-400',
  checked: 'border-emerald-200 bg-emerald-50 hover:border-emerald-300',
  dismissed: 'border-slate-200 bg-slate-100 hover:border-slate-300',
}

export default function WeeklyCalendar({
  userId, profile, canCheck, canAssignToOthers, availableAssignees, viewingUserId, initialDate,
  focusTaskId, focusNonce, teamMembers, currentUserId, currentUserName, onViewingUserChange, onTaskActivity,
}: WeeklyCalendarProps) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(initialDate ? new Date(initialDate) : new Date()))
  const [tasks, setTasks] = useState<TaskWithDetails[]>([])
  const [subtasks, setSubtasks] = useState<SubtaskWithProject[]>([])
  const [overdueUndated, setOverdueUndated] = useState<TaskWithDetails[]>([])
  const [bonusTasksList, setBonusTasksList] = useState<TaskWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskDate, setNewTaskDate] = useState('')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskSlot, setNewTaskSlot] = useState<[number, number] | null>(null)
  const [showPlanner, setShowPlanner] = useState(false)
  const [showLegend, setShowLegend] = useState(false)

  // Captured once on mount so the red unread badges reflect the state from
  // before this visit's markAllRead() cleared the count.
  const [readAt] = useState(() => {
    if (typeof window === 'undefined') return new Date(0).toISOString()
    try {
      return localStorage.getItem(`tasks_notifications_read_at_${userId}`) ?? new Date(0).toISOString()
    } catch {
      return new Date(0).toISOString()
    }
  })

  // The focal day: the wide column on a desktop grid, the listed day on a
  // phone. Today by default.
  const [expandedDay, setExpandedDay] = useState<string>(() => initialDate || formatDate(new Date()))
  // The cell being typed into, if any.
  const [composeCell, setComposeCell] = useState<{ date: string; slot: number | null } | null>(null)

  const [openTask, setOpenTask] = useState<TaskWithDetails | null>(null)
  const [openSubtask, setOpenSubtask] = useState<SubtaskWithProject | null>(null)

  const [overdueOpen, setOverdueOpen] = useState(false)
  const [overdueMonthIdx, setOverdueMonthIdx] = useState(0)
  const [overdueLoaded, setOverdueLoaded] = useState(false)
  const [overdueLoading, setOverdueLoading] = useState(false)
  const [bonusOpen, setBonusOpen] = useState(false)
  const [bonusMonthIdx, setBonusMonthIdx] = useState(0)
  const [bonusLoaded, setBonusLoaded] = useState(false)
  const [bonusLoading, setBonusLoading] = useState(false)

  // A task to open once it has loaded (the "Waiting for you to verify" jump).
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(focusTaskId ?? null)
  // The chip that flashes so the person sees where the task sits first.
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null)

  // Real school periods from the active Timetable, seeded with the generic set
  // so the grid isn't empty while they load.
  const [periodSlots, setPeriodSlots] = useState<TaskSlot[]>(TASK_SLOTS)

  // The grid needs ~640px; below the tablet hinge a day is shown as a list.
  const wide = useMediaQuerySync('(min-width: 768px)')

  const { user } = useAuth()
  const targetUserId = viewingUserId || userId
  const todayStr = formatDate(new Date())
  const canEditSubtasks = ['coordinator', 'principal', 'admin'].includes(profile.role)

  const initialLoadDone = useRef(false)
  const overdueLoadedRef = useRef(false)
  const bonusLoadedRef = useRef(false)

  // The grid scrolls sideways only between the tablet hinge and the width the
  // seven columns need; there, keep the focal column in view.
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const expandedColRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return
    requestAnimationFrame(() => {
      const container = gridScrollRef.current
      if (!container || !node.isConnected || container.scrollWidth <= container.clientWidth) return
      const target = node.offsetLeft - (container.clientWidth - node.offsetWidth) / 2
      container.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
    })
  }, [])

  const loadTasks = useCallback(async () => {
    if (!initialLoadDone.current) setLoading(true)
    const calendarData = await fetchCalendarData(targetUserId, weekStart)
    setTasks(calendarData.week)
    setLoading(false)
    initialLoadDone.current = true
  }, [targetUserId, weekStart])

  // Subtasks are fetched for the whole person, not the visible week, so the
  // week arrows don't refetch them.
  const loadSubtasks = useCallback(async () => {
    setSubtasks(await fetchSubtasksForCalendar(targetUserId))
  }, [targetUserId])

  // Silent background refresh after an optimistic change. Overdue and bonus
  // refresh only once they have been opened.
  const refreshTasks = useCallback(async () => {
    const [calendarData, subtaskData] = await Promise.all([
      fetchCalendarData(targetUserId, weekStart),
      fetchSubtasksForCalendar(targetUserId),
    ])
    setTasks(calendarData.week)
    setSubtasks(subtaskData)
    if (overdueLoadedRef.current) fetchOverdueTasks(targetUserId).then(setOverdueUndated)
    if (bonusLoadedRef.current) fetchBonusTasksForCalendar(targetUserId).then(setBonusTasksList)
  }, [targetUserId, weekStart])

  // The new task shows at once; the refresh brings in its details.
  const handleNewTaskCreated = useCallback((task: Task) => {
    setTasks(prev => [...prev, { ...task, assignees: [], checklist: [], comments: [] }])
    refreshTasks()
  }, [refreshTasks])

  const loadOverdueTasks = useCallback(async () => {
    if (overdueLoadedRef.current) return
    overdueLoadedRef.current = true
    setOverdueLoading(true)
    setOverdueUndated(await fetchOverdueTasks(targetUserId))
    setOverdueLoaded(true)
    setOverdueLoading(false)
  }, [targetUserId])

  const loadBonusTasks = useCallback(async () => {
    if (bonusLoadedRef.current) return
    bonusLoadedRef.current = true
    setBonusLoading(true)
    setBonusTasksList(await fetchBonusTasksForCalendar(targetUserId))
    setBonusLoaded(true)
    setBonusLoading(false)
  }, [targetUserId])

  // A different person's calendar starts with their overdue and bonus lists
  // unloaded, so nothing from the last person shows before the next fetch.
  useEffect(() => {
    setOverdueUndated([])
    setOverdueLoaded(false)
    overdueLoadedRef.current = false
    setBonusTasksList([])
    setBonusLoaded(false)
    bonusLoadedRef.current = false
  }, [targetUserId])

  useEffect(() => {
    initialLoadDone.current = false
    loadTasks()
  }, [loadTasks])

  useEffect(() => { loadSubtasks() }, [loadSubtasks])

  // The periods come from the school's timetable, not the viewed person.
  useEffect(() => {
    let cancelled = false
    fetchActiveTimetablePeriodSlots()
      .then(slots => { if (!cancelled) setPeriodSlots(slots) })
      .catch(() => { if (!cancelled) setPeriodSlots(TASK_SLOTS) })
    return () => { cancelled = true }
  }, [])

  // Once the week is on screen, fetch the task popup's code in the background
  // so the first tap on a chip opens it without a wait.
  useEffect(() => {
    if (loading) return
    const t = setTimeout(() => { loadTaskDetail() }, 1200)
    return () => clearTimeout(t)
  }, [loading])

  // Re-trigger a focus jump for the same calendar (a fresh mount is covered by
  // the pendingFocusId initialiser). Skips the first run.
  const focusInitialised = useRef(false)
  useEffect(() => {
    if (!focusInitialised.current) { focusInitialised.current = true; return }
    if (focusTaskId) {
      if (initialDate) setWeekStart(getWeekStart(new Date(initialDate)))
      setPendingFocusId(focusTaskId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

  // When the focused task arrives: flash its chip, then open it.
  useEffect(() => {
    if (!pendingFocusId) return
    const target =
      tasks.find(t => t.id === pendingFocusId) ||
      overdueUndated.find(t => t.id === pendingFocusId) ||
      bonusTasksList.find(t => t.id === pendingFocusId)
    if (!target) return
    setPendingFocusId(null)
    if (target.due_date) setExpandedDay(target.due_date)
    setHighlightedTaskId(target.id)
    const openTimer = setTimeout(() => setOpenTask(target), 550)
    const clearTimer = setTimeout(() => setHighlightedTaskId(null), 2200)
    return () => { clearTimeout(openTimer); clearTimeout(clearTimer) }
  }, [tasks, overdueUndated, bonusTasksList, pendingFocusId])

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return getDayLabel(d)
  }), [weekStart])

  // Exactly one focal day per week: after a week change, today if it's in
  // view, otherwise Monday.
  useEffect(() => {
    if (weekDays.some(d => d.full === expandedDay)) return
    setExpandedDay(weekDays.some(d => d.full === todayStr) ? todayStr : weekDays[0].full)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  const shiftWeek = (dir: number) => {
    const next = new Date(weekStart)
    next.setDate(next.getDate() + dir * 7)
    setWeekStart(next)
    setComposeCell(null)
  }
  const goToThisWeek = () => setWeekStart(getWeekStart(new Date()))
  const isThisWeek = weekDays.some(d => d.full === todayStr)

  // Bucketed once per data change: the grid asks for a day's items about
  // sixty times a render.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskWithDetails[]>()
    for (const task of tasks) {
      if (!task.due_date) continue
      const bucket = map.get(task.due_date)
      if (bucket) bucket.push(task)
      else map.set(task.due_date, [task])
    }
    // Timed tasks first in clock order, untimed after in creation order.
    for (const bucket of map.values()) {
      bucket.sort((a, b) => {
        if (!a.timing && !b.timing) return a.created_at.localeCompare(b.created_at)
        if (!a.timing) return 1
        if (!b.timing) return -1
        return a.timing.localeCompare(b.timing)
      })
    }
    return map
  }, [tasks])

  const subtasksByDay = useMemo(() => {
    const map = new Map<string, SubtaskWithProject[]>()
    for (const sub of subtasks) {
      if (!sub.due_date) continue
      const bucket = map.get(sub.due_date)
      if (bucket) bucket.push(sub)
      else map.set(sub.due_date, [sub])
    }
    return map
  }, [subtasks])

  const periodStarts = useMemo(() => new Set(periodSlots.map(p => p.start)), [periodSlots])

  const EMPTY_TASKS = useMemo<TaskWithDetails[]>(() => [], [])
  const EMPTY_SUBTASKS = useMemo<SubtaskWithProject[]>(() => [], [])
  const getTasksForDay = (d: string) => tasksByDay.get(d) ?? EMPTY_TASKS
  const getSubtasksForDay = (d: string) => subtasksByDay.get(d) ?? EMPTY_SUBTASKS

  const overdueUndatedSubtasks = useMemo(() => subtasks.filter(s => {
    if (s.status === 'dismissed') return false
    if (s.status === 'checked' || (!s.require_check && s.status === 'done')) return false
    return !s.due_date || s.due_date < todayStr
  }), [subtasks, todayStr])

  const handleTaskStatusChange = (taskId: string, newStatus: TaskStatus) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
    setOverdueUndated(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
    setBonusTasksList(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
    setOpenTask(prev => prev?.id === taskId ? { ...prev, status: newStatus } : prev)
    onTaskActivity?.()
  }

  const handleTaskDeleted = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    setOverdueUndated(prev => prev.filter(t => t.id !== taskId))
    setBonusTasksList(prev => prev.filter(t => t.id !== taskId))
    setOpenTask(null)
    onTaskActivity?.()
  }

  const handleSubtaskStatusTap = async (subtask: Subtask | SubtaskWithProject) => {
    const s = subtask as SubtaskWithProject
    const next = getNextStatus(s.status, canVerifyTask(s, user?.id, canCheck), true)
    if (next === s.status) return
    const apply = (status: TaskStatus) => {
      setSubtasks(prev => prev.map(sub => sub.id === s.id ? { ...sub, status } : sub))
      setOpenSubtask(prev => prev?.id === s.id ? { ...prev, status } : prev)
    }
    // In a sequential project the server may refuse an out-of-order change,
    // so the chip waits for it. Everywhere else it changes on tap and rolls
    // back if the write fails.
    if (s.project_sequential) {
      const result = await updateSubtaskStatus(s.id, next, s.project_id, true)
      if (result.success) apply(next)
      return
    }
    const previous = s.status
    apply(next)
    const result = await updateSubtaskStatus(s.id, next, s.project_id, false)
    if (!result.success) apply(previous)
  }

  const openNewTask = (date: string, title = '', slot: [number, number] | null = null) => {
    setComposeCell(null)
    setNewTaskDate(date)
    setNewTaskTitle(title)
    setNewTaskSlot(slot)
    setShowNewTask(true)
  }

  // Quick add: the typed title, the cell's date and its period. The composer
  // stays open so several can be added in a row.
  const handleInlineCreate = useCallback(async (title: string, date: string, slotIndex: number | null) => {
    const t = title.trim()
    if (!t) return
    const period = slotIndex !== null ? periodSlots[slotIndex] : null
    const created = await createTask({
      title: t,
      due_date: date,
      timing: period?.start,
      end_time: period?.end,
      assignee_ids: [targetUserId],
    }, userId)
    if (created) handleNewTaskCreated(created)
  }, [periodSlots, targetUserId, userId, handleNewTaskCreated])

  const weekLabel = weekDays[0].month === weekDays[6].month
    ? `${weekDays[0].date} – ${weekDays[6].date} ${weekDays[6].month}`
    : `${weekDays[0].date} ${weekDays[0].month} – ${weekDays[6].date} ${weekDays[6].month}`

  const chip = (task: TaskWithDetails, extra?: { showDate?: boolean; roomy?: boolean }) => (
    <TaskGridChip
      key={task.id}
      task={task}
      canCheck={canCheck}
      onStatusChange={handleTaskStatusChange}
      onOpen={() => setOpenTask(task)}
      showDate={extra?.showDate}
      roomy={extra?.roomy}
      currentUserId={userId}
      readAt={readAt}
      highlighted={task.id === highlightedTaskId}
    />
  )
  const subChip = (sub: SubtaskWithProject, roomy?: boolean) => (
    <SubtaskGridChip key={sub.id} subtask={sub} roomy={roomy} onStatusTap={handleSubtaskStatusTap} onOpen={() => setOpenSubtask(sub)} />
  )

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const toolbar = (
    <div className="flex flex-wrap items-center gap-1.5 w-full">
      <Stepper
        label={weekLabel}
        onPrev={() => shiftWeek(-1)}
        onNext={() => shiftWeek(1)}
        prevLabel="Previous week"
        nextLabel="Next week"
        onLabelClick={isThisWeek ? undefined : goToThisWeek}
        labelTitle="Back to this week"
      />
      {!isThisWeek && (
        <Btn tone="ghost" onClick={goToThisWeek} className="!h-9">This week</Btn>
      )}
      <div className="flex items-center gap-1.5 ml-auto min-w-0">
        {teamMembers && teamMembers.length > 0 && currentUserId && onViewingUserChange && (
          <TeamMemberSelector
            members={teamMembers}
            selectedUserId={viewingUserId || currentUserId}
            currentUserId={currentUserId}
            currentUserName={currentUserName || ''}
            onSelect={onViewingUserChange}
          />
        )}
        {/* As with the person picker, the legend hangs from the toolbar on a phone. */}
        <div className="sm:relative">
          <button
            type="button"
            onClick={() => setShowLegend(v => !v)}
            className={`${SX.icon} !w-9 !h-9 bg-white border border-[#E2DDD2]`}
            aria-label="What the colours mean"
            aria-expanded={showLegend}
          >
            <HelpCircle size={15} />
          </button>
          {showLegend && <Legend onClose={() => setShowLegend(false)} />}
        </div>
        <button
          type="button"
          onClick={() => setShowPlanner(true)}
          className={`${SX.icon} !w-9 !h-9 bg-white border border-[#E2DDD2]`}
          aria-label="Planner: import or draft a week of tasks"
          title="Planner: import or draft a week of tasks"
        >
          <FileSpreadsheet size={15} />
        </button>
        <Btn
          tone="dark"
          onClick={() => openNewTask(wide ? todayStr : expandedDay)}
          onPointerEnter={() => { loadNewTaskForm() }}
          onFocus={() => { loadNewTaskForm() }}
          className="!h-9"
        >
          <Plus size={15} />
          <span className="hidden min-[400px]:inline">New task</span>
        </Btn>
      </div>
    </div>
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      <TaskDeck actions={toolbar} bodyClassName="space-y-2.5">
        {loading ? (
          <CalendarSkeleton wide={wide} />
        ) : wide ? (
          // ── Period × day grid ──────────────────────────────────────────────
          <div ref={gridScrollRef} className="fx-card overflow-x-auto">
            <div
              className="grid min-w-[640px]"
              style={{
                gridTemplateColumns: '40px ' + weekDays.map(d => d.full === expandedDay ? 'minmax(170px, 2.6fr)' : 'minmax(74px, 1fr)').join(' '),
                transition: 'grid-template-columns 350ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <div className="sticky left-0 z-10 bg-[#F7F5F0] border-b border-r border-[#EEEAE1]" />
              {weekDays.map((day, i) => {
                const isToday = day.full === todayStr
                const isExpanded = expandedDay === day.full
                return (
                  <button
                    key={day.full}
                    ref={isExpanded ? expandedColRef : undefined}
                    onClick={() => { setExpandedDay(day.full); setComposeCell(null) }}
                    aria-pressed={isExpanded}
                    className={`px-1 py-1.5 text-center border-b border-[#EEEAE1] ${i < 6 ? 'border-r' : ''} transition-colors ${
                      isExpanded ? 'bg-[#27272A] text-white' : isToday ? 'bg-amber-100/70 text-amber-900' : 'bg-[#F7F5F0] text-slate-600 hover:bg-[#EFEBE2]'}`}
                    title={isExpanded ? undefined : 'Widen this day'}
                  >
                    <span className={`block text-[11px] font-semibold leading-tight ${isExpanded ? 'text-white/70' : isToday ? 'text-amber-700' : 'text-slate-500'}`}>
                      {isToday ? 'Today' : day.day}
                    </span>
                    <span className="block text-[14px] font-bold leading-tight tabular-nums">
                      {day.date}{isExpanded ? ` ${day.month}` : ''}
                    </span>
                  </button>
                )
              })}

              {/* Tasks with no period, and project subtasks */}
              <div className="sticky left-0 z-10 flex items-center justify-center bg-[#F7F5F0] border-r border-b border-[#EEEAE1] text-[10.5px] font-semibold text-slate-400" title="No period">
                Any
              </div>
              {weekDays.map((day, i) => {
                const cellBg = day.full === todayStr ? 'bg-amber-50/50' : day.full === expandedDay ? 'bg-[#FBF8F1]' : 'bg-white'
                const unscheduled = getTasksForDay(day.full).filter(t => !t.timing || !periodStarts.has(t.timing))
                const daySubs = getSubtasksForDay(day.full)
                return (
                  <div key={day.full} className={`p-1 space-y-1 border-b border-[#EEEAE1] ${i < 6 ? 'border-r' : ''} ${cellBg} min-w-0`}>
                    {unscheduled.map(t => chip(t))}
                    {daySubs.map(s => subChip(s))}
                  </div>
                )
              })}

              {periodSlots.map((period, pIdx) => (
                <React.Fragment key={pIdx}>
                  <div
                    className="sticky left-0 z-10 flex flex-col items-center justify-center bg-[#F7F5F0] border-r border-b border-[#EEEAE1] leading-none"
                    title={`${period.label}, ${formatSlotTime(period.start)} – ${formatSlotTime(period.end)}`}
                  >
                    <span className="text-[12px] font-bold text-slate-500 tabular-nums">{pIdx + 1}</span>
                  </div>
                  {weekDays.map((day, i) => {
                    const cellTasks = getTasksForDay(day.full).filter(t => t.timing === period.start)
                    const isComposing = composeCell?.date === day.full && composeCell?.slot === pIdx
                    const cellBg = day.full === todayStr ? 'bg-amber-50/50' : day.full === expandedDay ? 'bg-[#FBF8F1]' : 'bg-white'
                    return (
                      <div key={day.full} className={`group/cell p-1 border-b border-[#EEEAE1] ${i < 6 ? 'border-r' : ''} min-h-[34px] min-w-0 flex flex-col gap-1 ${cellBg}`}>
                        {cellTasks.map(t => chip(t))}
                        {isComposing ? (
                          <InlineTaskComposer
                            onCreate={title => handleInlineCreate(title, day.full, pIdx)}
                            onExpand={title => openNewTask(day.full, title, [pIdx, pIdx])}
                            onCancel={() => setComposeCell(null)}
                          />
                        ) : cellTasks.length === 0 ? (
                          <button
                            onClick={() => setComposeCell({ date: day.full, slot: pIdx })}
                            // Quiet until the cell is hovered — but only where
                            // there is a hover: a touch tablet always shows it.
                            className="flex-1 min-h-[26px] flex items-center justify-center rounded-[8px] border border-dashed border-[#E7E2D6] text-slate-300 [@media(hover:hover)]:border-transparent [@media(hover:hover)]:text-transparent group-hover/cell:!border-[#DDD8CC] group-hover/cell:!text-slate-400 hover:!border-[#B8983C] hover:!text-[#8B6F47] focus-visible:!border-[#B8983C] focus-visible:!text-[#8B6F47] focus-visible:outline-none transition-colors"
                            aria-label={`Add a task: ${day.day} ${day.date}, period ${pIdx + 1}`}
                          >
                            <Plus size={12} />
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        ) : (
          // ── Phone: one day at a time ───────────────────────────────────────
          <>
            <DaySwitch
              days={weekDays}
              value={expandedDay}
              today={todayStr}
              countFor={d => getTasksForDay(d).length + getSubtasksForDay(d).length}
              onChange={d => { setExpandedDay(d); setComposeCell(null) }}
            />
            <DayList
              periods={periodSlots}
              tasks={getTasksForDay(expandedDay)}
              subtasks={getSubtasksForDay(expandedDay)}
              periodStarts={periodStarts}
              composeSlot={composeCell?.date === expandedDay ? composeCell.slot : undefined}
              renderChip={t => chip(t, { roomy: true })}
              renderSubChip={s => subChip(s, true)}
              onCompose={slot => setComposeCell({ date: expandedDay, slot })}
              onCancelCompose={() => setComposeCell(null)}
              onCreate={(title, slot) => handleInlineCreate(title, expandedDay, slot)}
              onExpand={(title, slot) => openNewTask(expandedDay, title, slot === null ? null : [slot, slot])}
            />
          </>
        )}
      </TaskDeck>

      {/* ── Overdue and bonus: side by side where there is room ─────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 items-start">
        <OverdueSection
          open={overdueOpen}
          onToggle={() => { if (!overdueOpen) loadOverdueTasks(); setOverdueOpen(v => !v) }}
          loading={overdueLoading}
          loaded={overdueLoaded}
          tasks={overdueUndated}
          subtasks={overdueUndatedSubtasks}
          monthIdx={overdueMonthIdx}
          setMonthIdx={setOverdueMonthIdx}
          renderChip={t => chip(t, { showDate: true, roomy: true })}
          renderSubChip={s => subChip(s, true)}
        />
        <BonusSection
          open={bonusOpen}
          onToggle={() => { if (!bonusOpen) loadBonusTasks(); setBonusOpen(v => !v) }}
          loading={bonusLoading}
          loaded={bonusLoaded}
          tasks={bonusTasksList}
          monthIdx={bonusMonthIdx}
          setMonthIdx={setBonusMonthIdx}
          renderChip={t => chip(t, { showDate: true, roomy: true })}
        />
      </div>

      <AnimatePresence>
        {openTask && (
          <TaskDetailSheet
            key={openTask.id}
            task={openTask}
            canCheck={canCheck}
            userId={user?.id || userId}
            userRole={profile.role}
            onClose={() => setOpenTask(null)}
            onStatusChange={handleTaskStatusChange}
            onTaskDeleted={handleTaskDeleted}
            onTaskUpdated={refreshTasks}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {openSubtask && (
          <SubtaskCard
            key={openSubtask.id}
            subtask={openSubtask}
            canCheck={canCheck}
            canEdit={canEditSubtasks}
            onClose={() => setOpenSubtask(null)}
            onStatusTap={handleSubtaskStatusTap}
            onSubtaskUpdated={refreshTasks}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showNewTask && (
          <NewTaskForm
            onClose={() => setShowNewTask(false)}
            onTaskCreated={handleNewTaskCreated}
            currentUserId={userId}
            defaultAssigneeId={targetUserId}
            defaultDate={newTaskDate}
            defaultTitle={newTaskTitle}
            defaultSlotRange={newTaskSlot}
            availableAssignees={availableAssignees}
            canAssignToOthers={canAssignToOthers}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPlanner && (
          <PlannerModal
            onClose={() => setShowPlanner(false)}
            currentUserId={userId}
            defaultAssigneeId={targetUserId}
            availableAssignees={availableAssignees}
            canAssignToOthers={canAssignToOthers}
            onImported={loadTasks}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Status legend ────────────────────────────────────────────────────────────

function Legend({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  // Closes on Escape or a press anywhere else, the way the menus do. The
  // button that opened it toggles it itself, so presses there are left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || ref.current?.parentElement?.contains(t)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [onClose])
  const rows: { mark: React.ReactNode; label: string }[] = [
    { mark: <StatusMark status="not_done" requireCheck={false} />, label: 'Not done' },
    { mark: <StatusMark status="partial" requireCheck={false} />, label: 'Partial' },
    { mark: <StatusMark status="done" requireCheck />, label: 'Checking' },
    { mark: <StatusMark status="checked" requireCheck />, label: 'Completed' },
    { mark: <StatusMark status="dismissed" requireCheck />, label: 'Dismissed' },
    { mark: <BonusMedal inline />, label: 'Bonus task' },
    { mark: <span className="w-[3px] h-3.5 rounded-full bg-violet-400" />, label: 'Project subtask' },
    { mark: <span className="w-[3px] h-3.5 rounded-full bg-rose-500" />, label: 'New comment' },
  ]
  return (
    <>
      <div ref={ref} className="absolute right-2 sm:right-0 top-full mt-1.5 z-30 w-[min(15rem,calc(100vw-1rem))] rounded-[14px] bg-white border border-black/[.07] shadow-[0_24px_60px_-20px_rgba(15,23,42,.45),0_2px_8px_rgba(15,23,42,.08)] p-3">
        <div className="space-y-1.5">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-2.5 text-[12.5px] text-slate-700">
              <span className="w-4 flex justify-center flex-shrink-0">{r.mark}</span>
              {r.label}
            </div>
          ))}
        </div>
        <p className="text-[11.5px] text-slate-500 mt-2.5 leading-snug">Checking means done and waiting to be verified. Tap a task&apos;s circle to move it on; tap its name to open it.</p>
      </div>
    </>
  )
}

function BonusMedal({ inline = false }: { inline?: boolean }) {
  return (
    <span
      className={`${inline ? '' : 'absolute -top-1.5 -left-1.5 z-10 ring-2 ring-white'} w-[15px] h-[15px] rounded-full flex items-center justify-center shadow-sm flex-shrink-0`}
      style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}
      title="Bonus task"
    >
      <Star size={8} className="text-white" fill="white" />
    </span>
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function CalendarSkeleton({ wide }: { wide: boolean }) {
  if (!wide) {
    return (
      <div className="space-y-2.5 animate-pulse">
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => <div key={i} className="h-[52px] rounded-[12px] bg-white/70" />)}
        </div>
        <div className="fx-card divide-y divide-[#EEEAE1]">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <div className="w-8 h-6 bg-slate-100 rounded" />
              <div className="h-7 flex-1 bg-slate-100 rounded-[8px]" style={{ maxWidth: `${40 + (i * 23) % 50}%` }} />
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="fx-card animate-pulse">
      <div className="grid grid-cols-[40px_repeat(7,minmax(0,1fr))]">
        {Array.from({ length: 8 * 6 }, (_, i) => (
          <div key={i} className={`h-10 border-b border-r border-[#EEEAE1] ${i < 8 ? 'bg-[#F7F5F0]' : ''}`}>
            {i >= 8 && i % 8 !== 0 && (i * 7) % 3 === 0 && <div className="m-1 h-7 rounded-[8px] bg-slate-100" />}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Phone: day switch and day list ───────────────────────────────────────────

function DaySwitch({ days, value, today, countFor, onChange }: {
  days: { day: string; date: number; month: string; full: string }[]
  value: string
  today: string
  countFor: (d: string) => number
  onChange: (d: string) => void
}) {
  return (
    <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Day">
      {days.map(d => {
        const on = d.full === value
        const isToday = d.full === today
        const n = countFor(d.full)
        return (
          <button
            key={d.full}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(d.full)}
            className={`relative min-w-0 flex flex-col items-center justify-center h-[52px] rounded-[12px] transition active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
              on
                ? 'bg-gradient-to-b from-[#3D3B40] to-[#27272A] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)]'
                : 'bg-white/80 text-slate-700 border border-white'}`}
          >
            <span className={`text-[10.5px] font-semibold leading-none ${on ? 'text-white/70' : isToday ? 'text-amber-700' : 'text-slate-500'}`}>{d.day}</span>
            <span className="text-[15px] font-bold leading-tight tabular-nums mt-0.5">{d.date}</span>
            <span className={`absolute bottom-1 h-1 rounded-full ${n > 0 ? (on ? 'bg-[#E9DDBB]' : 'bg-[#B8983C]') : 'bg-transparent'}`} style={{ width: n > 0 ? Math.min(4 + n * 3, 18) : 0 }} />
          </button>
        )
      })}
    </div>
  )
}

function DayList({
  periods, tasks, subtasks, periodStarts, composeSlot, renderChip, renderSubChip, onCompose, onCancelCompose, onCreate, onExpand,
}: {
  periods: TaskSlot[]
  tasks: TaskWithDetails[]
  subtasks: SubtaskWithProject[]
  periodStarts: Set<string>
  /** undefined: nothing being typed; null: the "any time" row; n: period n. */
  composeSlot: number | null | undefined
  renderChip: (t: TaskWithDetails) => React.ReactNode
  renderSubChip: (s: SubtaskWithProject) => React.ReactNode
  onCompose: (slot: number | null) => void
  onCancelCompose: () => void
  onCreate: (title: string, slot: number | null) => void
  onExpand: (title: string, slot: number | null) => void
}) {
  const unscheduled = tasks.filter(t => !t.timing || !periodStarts.has(t.timing))
  const row = (key: string, label: React.ReactNode, time: React.ReactNode, slot: number | null, items: React.ReactNode[]) => (
    <div key={key} className="flex items-stretch gap-2.5 px-2.5 py-1.5 min-h-[44px]">
      <div className="w-11 flex-shrink-0 flex flex-col justify-center leading-tight">
        <span className="text-[12.5px] font-bold text-slate-700 tabular-nums">{label}</span>
        {time && <span className="text-[10.5px] text-slate-400 tabular-nums">{time}</span>}
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        {items}
        {composeSlot === slot ? (
          <InlineTaskComposer
            onCreate={title => onCreate(title, slot)}
            onExpand={title => onExpand(title, slot)}
            onCancel={onCancelCompose}
          />
        ) : items.length === 0 ? (
          <button
            onClick={() => onCompose(slot)}
            className="h-8 w-full flex items-center gap-1.5 px-2.5 rounded-[9px] border border-dashed border-[#DDD8CC] text-[12px] text-slate-400 active:bg-[#FAF7F0] transition-colors"
          >
            <Plus size={12} /> Add
          </button>
        ) : null}
      </div>
    </div>
  )
  return (
    <div className="fx-card divide-y divide-[#EEEAE1]">
      {(unscheduled.length > 0 || subtasks.length > 0 || composeSlot === null) &&
        row('any', 'Any', 'time', null, [...unscheduled.map(renderChip), ...subtasks.map(renderSubChip)])}
      {periods.map((p, i) =>
        row(String(i), `P${i + 1}`, formatSlotTime(p.start), i, tasks.filter(t => t.timing === p.start).map(renderChip)),
      )}
    </div>
  )
}

// ─── Overdue and bonus sections ───────────────────────────────────────────────

function SectionToggle({ icon, title, count, countTone, open, onToggle, right }: {
  icon: React.ReactNode
  title: string
  count: number | null
  countTone: string
  open: boolean
  onToggle: () => void
  right?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 min-h-[44px] py-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-2 min-w-0 flex-1 basis-[150px] h-9 px-1.5 rounded-full text-left hover:bg-[#FAF7F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 transition-colors"
      >
        {icon}
        <span className="text-[13.5px] font-semibold text-slate-900 leading-snug">{title}</span>
        {count != null && <span className={`text-[12.5px] font-bold tabular-nums ${countTone}`}>{count}</span>}
        <ChevronDown size={15} className={`ml-auto text-slate-400 transition-transform duration-200 flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {right}
    </div>
  )
}

function MonthPager({ months, idx, setIdx }: { months: string[]; idx: number; setIdx: (fn: (i: number) => number) => void }) {
  if (months.length < 2) return null
  return (
    <Stepper
      label={monthKeyLabel(months[idx])}
      onPrev={() => setIdx(i => Math.min(i + 1, months.length - 1))}
      onNext={() => setIdx(i => Math.max(i - 1, 0))}
      prevLabel="Older month"
      nextLabel="Newer month"
      canNext={idx > 0}
      className="!bg-[#F4F1EA] !shadow-none"
    />
  )
}

function OverdueSection({ open, onToggle, loading, loaded, tasks, subtasks, monthIdx, setMonthIdx, renderChip, renderSubChip }: {
  open: boolean
  onToggle: () => void
  loading: boolean
  loaded: boolean
  tasks: TaskWithDetails[]
  subtasks: SubtaskWithProject[]
  monthIdx: number
  setMonthIdx: (fn: (i: number) => number) => void
  renderChip: (t: TaskWithDetails) => React.ReactNode
  renderSubChip: (s: SubtaskWithProject) => React.ReactNode
}) {
  // One month at a time, newest first, then the undated ones.
  const { months, byMonth } = useMemo(() => {
    const map: Record<string, { tasks: TaskWithDetails[]; subtasks: SubtaskWithProject[] }> = {}
    const bucket = (k: string) => (map[k] ??= { tasks: [], subtasks: [] })
    for (const t of tasks) bucket(t.due_date ? t.due_date.slice(0, 7) : 'undated').tasks.push(t)
    for (const s of subtasks) bucket(s.due_date ? s.due_date.slice(0, 7) : 'undated').subtasks.push(s)
    const dated = Object.keys(map).filter(k => k !== 'undated').sort().reverse()
    return { months: [...dated, ...(map.undated ? ['undated'] : [])], byMonth: map }
  }, [tasks, subtasks])
  const idx = months.length > 0 ? Math.min(Math.max(monthIdx, 0), months.length - 1) : -1
  const active = idx >= 0 ? byMonth[months[idx]] : { tasks: [], subtasks: [] }
  const total = tasks.length + subtasks.length

  return (
    <Panel className="min-w-0">
      <SectionToggle
        icon={<AlertTriangle size={15} className="text-rose-500 flex-shrink-0" />}
        title="Overdue"
        count={loaded ? total : null}
        countTone={total > 0 ? 'text-rose-600' : 'text-slate-400'}
        open={open}
        onToggle={onToggle}
        right={open && loaded ? <MonthPager months={months} idx={idx} setIdx={setMonthIdx} /> : undefined}
      />
      {open && (
        <div className="border-t border-[#EEEAE1] px-2.5 py-2.5">
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-slate-400" /></div>
          ) : total === 0 ? (
            <p className="text-[12.5px] text-slate-500 py-1">Nothing overdue.</p>
          ) : (
            <div className="space-y-1.5">
              {active.tasks.map(renderChip)}
              {active.subtasks.map(renderSubChip)}
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

function BonusSection({ open, onToggle, loading, loaded, tasks, monthIdx, setMonthIdx, renderChip }: {
  open: boolean
  onToggle: () => void
  loading: boolean
  loaded: boolean
  tasks: TaskWithDetails[]
  monthIdx: number
  setMonthIdx: (fn: (i: number) => number) => void
  renderChip: (t: TaskWithDetails) => React.ReactNode
}) {
  const { months, byMonth } = useMemo(() => {
    const map: Record<string, TaskWithDetails[]> = {}
    for (const t of tasks) (map[t.due_date ? t.due_date.slice(0, 7) : 'undated'] ??= []).push(t)
    return { months: Object.keys(map).sort().reverse(), byMonth: map }
  }, [tasks])
  const idx = months.length > 0 ? Math.min(Math.max(monthIdx, 0), months.length - 1) : -1
  const list = idx >= 0 ? byMonth[months[idx]] : []
  // Only points that have been signed off count as earned.
  const earned = list.reduce((sum, t) => sum + (isTaskCompleted(t) ? (t.bonus_points || 0) : 0), 0)

  return (
    <Panel className="min-w-0">
      <SectionToggle
        icon={<Star size={15} className="text-amber-500 flex-shrink-0" />}
        title="Bonus tasks"
        count={loaded ? tasks.length : null}
        countTone={tasks.length > 0 ? 'text-amber-600' : 'text-slate-400'}
        open={open}
        onToggle={onToggle}
        right={open && loaded ? <MonthPager months={months} idx={idx} setIdx={setMonthIdx} /> : undefined}
      />
      {open && (
        <div className="border-t border-[#EEEAE1] px-2.5 py-2.5">
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-slate-400" /></div>
          ) : tasks.length === 0 ? (
            <p className="text-[12.5px] text-slate-500 py-1">No bonus tasks yet.</p>
          ) : (
            <>
              <p className="flex flex-wrap items-center justify-between gap-x-3 text-[12px] text-slate-500 mb-2">
                <span>{list.length} task{list.length !== 1 ? 's' : ''}</span>
                <span className="font-semibold text-amber-700">{earned} points earned</span>
              </p>
              <div className="space-y-1.5">{list.map(renderChip)}</div>
            </>
          )}
        </div>
      )}
    </Panel>
  )
}

// ─── Inline composer ──────────────────────────────────────────────────────────
// Type a task name straight into a cell. Enter adds it and keeps the box open
// for the next; the expand button opens the full form with what's typed.

function InlineTaskComposer({ onCreate, onExpand, onCancel }: {
  onCreate: (title: string) => void
  onExpand: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const submit = () => {
    const t = value.trim()
    if (!t) return
    onCreate(t)
    setValue('')
    inputRef.current?.focus()
  }
  return (
    <div className="flex items-center gap-1 rounded-[9px] border border-[#B8983C] bg-white px-1.5 h-8 shadow-[0_0_0_3px_rgba(184,152,60,.15)] min-w-0">
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        onBlur={() => { if (!value.trim()) onCancel() }}
        placeholder="Task name, then Enter"
        enterKeyHint="done"
        className="min-w-0 flex-1 bg-transparent text-[12px] text-slate-800 placeholder-slate-400 focus:outline-none"
      />
      <button
        type="button"
        // Keep the input focused so its blur doesn't cancel before this fires.
        onMouseDown={e => e.preventDefault()}
        onClick={() => onExpand(value)}
        className="flex-shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-[#8B6F47] hover:bg-[#FAF7F0] transition-colors"
        aria-label="Open the full task form"
        title="More options"
      >
        <Maximize2 size={11} />
      </button>
    </div>
  )
}

// ─── Chips ────────────────────────────────────────────────────────────────────

function TaskGridChip({ task, canCheck, onStatusChange, onOpen, showDate, roomy, currentUserId, readAt, highlighted }: {
  task: TaskWithDetails
  canCheck: boolean
  onStatusChange: (id: string, status: TaskStatus) => void
  onOpen: () => void
  showDate?: boolean
  /** Phone lists and the overdue panel: taller, and the name wraps. */
  roomy?: boolean
  currentUserId?: string
  readAt?: string
  highlighted?: boolean
}) {
  const isVerifier = canVerifyTask(task, currentUserId, canCheck)

  const handleIconClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentUserId) return
    // Only a verifier can re-open a verified task.
    if (task.status === 'checked' && !isVerifier) return
    const next = getNextStatus(task.status, isVerifier, task.require_check ?? true)
    if (next === task.status) return
    // A task that needs a submission opens instead, where there's room to write it.
    if (needsSubmissionFirst(task, next)) { onOpen(); return }
    const ok = await updateTaskStatus(task.id, next, currentUserId)
    if (ok) onStatusChange(task.id, next)
  }

  const hasComments = task.comments.length > 0
  const hasUnread = hasComments && task.comments.some(c => c.user_id !== currentUserId && (readAt ? c.created_at > readAt : true))
  const isBonus = task.tag === 'bonus' || task.bonus_points > 0
  const isDismissed = task.status === 'dismissed'
  const doneNoCheck = task.status === 'done' && !task.require_check
  const isCompleted = task.status === 'checked' || doneNoCheck
  const chipClass = doneNoCheck ? CHIP_STYLE.checked : CHIP_STYLE[task.status]
  const accent = hasUnread ? 'border-l-[3px] border-l-rose-500' : hasComments ? 'border-l-[3px] border-l-sky-400' : ''
  const ring = highlighted ? 'ring-2 ring-amber-400 ring-offset-1 animate-pulse' : ''

  return (
    <div className={`relative w-full min-w-0 rounded-[9px] border transition-colors ${roomy ? 'text-[13px]' : 'text-[11.5px]'} ${chipClass} ${accent} ${ring} ${isDismissed ? 'opacity-60' : ''}`}>
      {isBonus && !isDismissed && <BonusMedal />}
      <div className={`flex items-start gap-1 ${roomy ? 'p-1.5 pl-1' : 'p-1'}`}>
        <button
          onClick={handleIconClick}
          className={`flex-shrink-0 inline-flex items-center justify-center rounded-full hover:bg-black/[.05] active:scale-90 transition ${roomy ? 'w-7 h-7 -my-0.5' : 'w-5 h-5'}`}
          aria-label="Move to the next status"
        >
          <StatusMark status={task.status} requireCheck={!!task.require_check} size={roomy ? 16 : 14} />
        </button>
        <button onClick={onOpen} className={`min-w-0 flex-1 text-left ${roomy ? 'py-0.5' : 'py-px'}`}>
          <span className={`block font-medium leading-snug break-words [overflow-wrap:anywhere] hyphens-auto ${isCompleted || isDismissed ? 'line-through text-slate-400' : 'text-slate-800'}`}>
            {task.title}
          </span>
          {showDate && task.due_date && (
            <span className="block text-[11px] text-rose-600 font-medium leading-tight">{shortDate(task.due_date)}</span>
          )}
        </button>
      </div>
      {hasComments && (
        <span className={`absolute -top-1.5 -right-1.5 inline-flex items-center justify-center rounded-full px-1 min-w-[15px] h-[15px] shadow-sm text-white text-[9.5px] font-bold leading-none ${hasUnread ? 'bg-rose-500' : 'bg-sky-500'}`}>
          {task.comments.length}
        </span>
      )}
    </div>
  )
}

function SubtaskGridChip({ subtask, roomy, onStatusTap, onOpen }: {
  subtask: SubtaskWithProject
  roomy?: boolean
  onStatusTap: (s: SubtaskWithProject) => void
  onOpen: () => void
}) {
  const doneNoCheck = subtask.status === 'done' && !subtask.require_check
  const dismissed = subtask.status === 'dismissed'
  const isBonus = subtask.tag === 'bonus' || (subtask.bonus_points ?? 0) > 0
  const struck = subtask.status === 'checked' || doneNoCheck || dismissed
  return (
    <div className={`relative w-full min-w-0 rounded-[9px] border border-l-[3px] border-l-violet-400 transition-colors ${roomy ? 'text-[13px]' : 'text-[11.5px]'} ${doneNoCheck ? CHIP_STYLE.checked : CHIP_STYLE[subtask.status]} ${dismissed ? 'opacity-60' : ''}`}>
      {isBonus && !dismissed && <BonusMedal />}
      <div className={`flex items-start gap-1 ${roomy ? 'p-1.5 pl-1' : 'p-1'}`}>
        <button
          onClick={e => { e.stopPropagation(); onStatusTap(subtask) }}
          className={`flex-shrink-0 inline-flex items-center justify-center rounded-full hover:bg-black/[.05] active:scale-90 transition ${roomy ? 'w-7 h-7 -my-0.5' : 'w-5 h-5'}`}
          aria-label="Move to the next status"
        >
          <StatusMark status={subtask.status} requireCheck={!!subtask.require_check} size={roomy ? 16 : 14} />
        </button>
        <button onClick={onOpen} className={`min-w-0 flex-1 text-left ${roomy ? 'py-0.5' : 'py-px'}`}>
          <span className={`block font-medium leading-snug break-words [overflow-wrap:anywhere] hyphens-auto ${struck ? 'line-through text-slate-400' : 'text-slate-800'}`}>
            {subtask.title}
          </span>
          <span className="flex items-center gap-1 mt-0.5 min-w-0 text-[10.5px] text-violet-700 leading-tight">
            <FolderKanban size={10} className="flex-shrink-0" />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{subtask.project_title}</span>
          </span>
        </button>
      </div>
    </div>
  )
}
