'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  AlertTriangle,
  FolderKanban,
  Calendar,
  Clock,
  Star,
  X,
  Edit3,
  Check,
  Circle,
  CircleDot,
  CheckCircle2,
  CheckSquare,
  Square,
  MessageSquare,
  Send,
  ShieldCheck,
  Repeat,
  Trash2,
  Paperclip,
  Link2,
  Image as ImageIcon,
  FileText,
  ExternalLink,
  Search,
  Ban,
  MinusCircle,
  RotateCcw,
  HelpCircle,
  FileSpreadsheet,
} from 'lucide-react'
import NewTaskForm from './NewTaskForm'
import TeamMemberSelector from './TeamMemberSelector'
import SubtaskCard from './SubtaskCard'
import {
  fetchCalendarData,
  fetchOverdueTasks,
  fetchBonusTasksForCalendar,
  fetchTaskDetails,
  TaskDetails,
  Task,
  TaskWithDetails,
  TaskStatus,
  STATUS_DOT_COLORS,
  STATUS_LABELS,
  STATUS_COLORS,
  RECURRENCE_LABELS,
  getDynamicStatusLabel,
  getDynamicStatusColors,
  getDynamicDotColor,
  getNextStatus,
  updateTaskStatus,
  updateTask,
  updateTaskAssignees,
  toggleChecklistItem,
  addChecklistItem,
  addComment,
  deleteTask,
  uploadTaskAttachment,
  createTask,
  checkDuplicateTaskTitle,
  NewTaskInput,
  TaskRecurrence,
  TaskTag,
  TaskChecklistItem,
  TaskComment,
} from '@/lib/tasks'
import {
  fetchSubtasksForCalendar,
  Subtask,
  SubtaskWithProject,
  updateSubtaskStatus,
} from '@/lib/projects'
import { UserProfile } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import Avatar from '@/components/Avatar'
import { TASK_SLOTS } from '@/lib/taskSlots'
import PlannerModal from './PlannerModal'

function canEditTaskFn(task: TaskWithDetails, userId: string, userRole: string): boolean {
  if (userRole === 'admin') return true
  const isAssignee = task.assignees.some(a => a.user_id === userId)
  const creatorRole = task.creator?.role
  if (userRole === 'principal') {
    if (isAssignee && creatorRole === 'admin') return false
    return true
  }
  if (userRole === 'coordinator') {
    if (isAssignee && (creatorRole === 'principal' || creatorRole === 'admin')) return false
    return true
  }
  if (userRole === 'teacher') {
    return task.created_by === userId
  }
  return false
}

interface WeeklyCalendarProps {
  userId: string
  profile: UserProfile
  canCheck: boolean
  canAssignToOthers: boolean
  availableAssignees: UserProfile[]
  viewingUserId?: string
  initialDate?: string
  /** When set, the calendar jumps to the task's week and opens its detail modal. */
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
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatDate(date: Date): string {
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function getDayLabel(date: Date): { day: string; date: number; month: string; full: string } {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return {
    day: days[date.getDay()],
    date: date.getDate(),
    month: months[date.getMonth()],
    full: formatDate(date),
  }
}

// Chip border/bg colours mapped to task status (similar to SchoolWorkManager)
const CHIP_STYLE: Record<TaskStatus, string> = {
  not_done: 'border-slate-200 bg-white hover:border-slate-300',
  partial:  'border-orange-400 bg-orange-100 hover:border-orange-500',
  done:     'border-yellow-300 bg-yellow-50 hover:border-yellow-400',
  checked:  'border-green-200 bg-green-50 hover:border-green-300',
  dismissed: 'border-slate-200 bg-slate-100 hover:border-slate-300',
}

// Time slots for quick-add picker (mirrors NewTaskForm SLOTS)
const QUICK_SLOTS = TASK_SLOTS.map(s => ({ label: s.shortLabel, start: s.start, end: s.end }))

export default function WeeklyCalendar({
  userId,
  profile,
  canCheck,
  canAssignToOthers,
  availableAssignees,
  viewingUserId,
  initialDate,
  focusTaskId,
  focusNonce,
  teamMembers,
  currentUserId,
  currentUserName,
  onViewingUserChange,
  onTaskActivity,
}: WeeklyCalendarProps) {
  const [weekStart, setWeekStart] = useState(() =>
    initialDate ? getWeekStart(new Date(initialDate)) : getWeekStart(new Date())
  )
  const [tasks, setTasks] = useState<TaskWithDetails[]>([])
  const [subtasks, setSubtasks] = useState<SubtaskWithProject[]>([])
  const [overdueUndated, setOverdueUndated] = useState<TaskWithDetails[]>([])
  const [bonusTasksList, setBonusTasksList] = useState<TaskWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskDate, setNewTaskDate] = useState('')
  const [showPlanner, setShowPlanner] = useState(false)

  // Capture the readAt timestamp once on mount so red badges reflect the state
  // from before the current visit's markAllRead() clears the count.
  const [readAt] = useState(() => {
    if (typeof window === 'undefined') return new Date(0).toISOString()
    return localStorage.getItem(`tasks_notifications_read_at_${userId}`) ?? new Date(0).toISOString()
  })
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  // Modal state
  const [openTask, setOpenTask]       = useState<TaskWithDetails | null>(null)
  const [openSubtask, setOpenSubtask] = useState<SubtaskWithProject | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [overdueCollapsed, setOverdueCollapsed] = useState(true)
  const [overdueMonthIdx, setOverdueMonthIdx] = useState(0)
  const [overdueLoaded, setOverdueLoaded] = useState(false)
  const [overdueLoading, setOverdueLoading] = useState(false)
  const [bonusCollapsed, setBonusCollapsed] = useState(true)
  const [bonusMonthIdx, setBonusMonthIdx] = useState(0)
  const [bonusLoaded, setBonusLoaded] = useState(false)
  const [bonusLoading, setBonusLoading] = useState(false)

  // Task to auto-open once it has loaded (driven by focusTaskId from the parent's
  // "Awaiting Your Verification" buttons). Initialised here so a fresh mount —
  // which happens when switching to another assignee's calendar — focuses too.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(focusTaskId ?? null)
  // Briefly highlighted task chip (amber ring) so the user sees WHERE the task
  // lives in the grid before the detail modal opens.
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null)

  // Quick-add inline state
  const [quickAddDay, setQuickAddDay] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskSlot, setNewTaskSlot] = useState<[number, number] | null>(null)
  const [quickAddDuplicateDay, setQuickAddDuplicateDay] = useState<string | null>(null)

  const { user } = useAuth()
  const targetUserId = viewingUserId || userId
  const todayStr = formatDate(new Date())
  // canEdit for subtasks uses simpler role-based check
  const canEditSubtasks = ['coordinator', 'principal', 'admin'].includes(profile.role)

  const initialLoadDone = useRef(false)
  // Maps real task id → stable render key so AnimatePresence never sees a key
  // change when an optimistic id is swapped for the real DB id after createTask.
  const taskRenderKeys = useRef(new Map<string, string>())
  // Refs so refreshTasks can check loaded state without capturing stale closure values
  const overdueLoadedRef = useRef(false)
  const bonusLoadedRef = useRef(false)
  // Horizontal-scroll container + today's column, so phones open with today in view.
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const todayColRef = useRef<HTMLDivElement>(null)

  const loadTasks = useCallback(async () => {
    if (!initialLoadDone.current) setLoading(true)
    const [calendarData, subtaskData] = await Promise.all([
      fetchCalendarData(targetUserId, weekStart),
      fetchSubtasksForCalendar(targetUserId),
    ])
    taskRenderKeys.current.clear()
    setTasks(calendarData.week)
    setSubtasks(subtaskData)
    setLoading(false)
    initialLoadDone.current = true
  }, [targetUserId, weekStart])

  // Silent background refresh — never clears taskRenderKeys or sets loading state.
  // Use this after optimistic inserts so existing items don't blink.
  // Overdue and bonus are only refreshed if the user has already expanded them.
  const refreshTasks = useCallback(async () => {
    const [calendarData, subtaskData] = await Promise.all([
      fetchCalendarData(targetUserId, weekStart),
      fetchSubtasksForCalendar(targetUserId),
    ])
    setTasks(calendarData.week)
    setSubtasks(subtaskData)
    if (overdueLoadedRef.current) {
      fetchOverdueTasks(targetUserId).then(setOverdueUndated)
    }
    if (bonusLoadedRef.current) {
      fetchBonusTasksForCalendar(targetUserId).then(setBonusTasksList)
    }
  }, [targetUserId, weekStart])

  // Optimistic handler for the NewTaskForm — task appears instantly, syncs silently.
  const handleNewTaskCreated = useCallback((task: Task) => {
    const newTask: TaskWithDetails = { ...task, assignees: [], checklist: [], comments: [] }
    setTasks(prev => [...prev, newTask])
    refreshTasks()
  }, [refreshTasks])

  // Lazy-load handlers: fetch overdue/bonus only when the section is first expanded.
  const loadOverdueTasks = useCallback(async () => {
    if (overdueLoadedRef.current) return
    setOverdueLoading(true)
    const data = await fetchOverdueTasks(targetUserId)
    setOverdueUndated(data)
    setOverdueLoaded(true)
    overdueLoadedRef.current = true
    setOverdueLoading(false)
  }, [targetUserId])

  const loadBonusTasks = useCallback(async () => {
    if (bonusLoadedRef.current) return
    setBonusLoading(true)
    const data = await fetchBonusTasksForCalendar(targetUserId)
    setBonusTasksList(data)
    setBonusLoaded(true)
    bonusLoadedRef.current = true
    setBonusLoading(false)
  }, [targetUserId])

  // Reset lazy-loaded sections when the viewed user changes so stale data
  // from a previous user isn't shown before the next lazy fetch.
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

  // On phones the 7-day grid overflows horizontally; bring today's (wider)
  // column into view once the grid has rendered so the user doesn't have to
  // scroll right to find it. No-op on desktop where everything fits.
  useEffect(() => {
    if (loading) return
    const id = requestAnimationFrame(() => {
      const container = gridScrollRef.current
      const todayEl = todayColRef.current
      if (!container || !todayEl) return
      if (container.scrollWidth <= container.clientWidth) return // fully visible
      const target = todayEl.offsetLeft - (container.clientWidth - todayEl.offsetWidth) / 2
      container.scrollTo({ left: Math.max(0, target), behavior: 'auto' })
    })
    return () => cancelAnimationFrame(id)
  }, [loading, weekStart])

  // Re-trigger a focus jump when the parent requests one for the same calendar
  // (a fresh mount is handled by the pendingFocusId initialiser). Skip the very
  // first run so it doesn't double-fire on mount.
  const focusInitialised = useRef(false)
  useEffect(() => {
    if (!focusInitialised.current) {
      focusInitialised.current = true
      return
    }
    if (focusTaskId) {
      if (initialDate) setWeekStart(getWeekStart(new Date(initialDate)))
      setPendingFocusId(focusTaskId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

  // Once the focused task is present in any loaded set:
  // 1. Highlight its chip in the grid with an amber ring so the user sees WHERE it is.
  // 2. After a short beat, open the detail modal smoothly.
  // 3. Clear the highlight after the ring animation finishes.
  useEffect(() => {
    if (!pendingFocusId) return
    const target =
      tasks.find(t => t.id === pendingFocusId) ||
      overdueUndated.find(t => t.id === pendingFocusId) ||
      bonusTasksList.find(t => t.id === pendingFocusId)
    if (!target) return

    setPendingFocusId(null)
    if (target.due_date) setSelectedDay(target.due_date)

    // Flash the chip so it's visible in the grid before the modal takes over.
    setHighlightedTaskId(target.id)
    const openTimer    = setTimeout(() => setOpenTask(target), 550)
    const clearTimer   = setTimeout(() => setHighlightedTaskId(null), 2200)
    return () => { clearTimeout(openTimer); clearTimeout(clearTimer) }
  }, [tasks, overdueUndated, bonusTasksList, pendingFocusId])

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return getDayLabel(d)
  })

  const goToPrevWeek = () => {
    const prev = new Date(weekStart)
    prev.setDate(prev.getDate() - 7)
    setWeekStart(prev)
  }

  const goToNextWeek = () => {
    const next = new Date(weekStart)
    next.setDate(next.getDate() + 7)
    setWeekStart(next)
  }

  const goToThisWeek = () => setWeekStart(getWeekStart(new Date()))

  const getTasksForDay    = (dateStr: string) => tasks
    .filter(t => t.due_date === dateStr)
    .sort((a, b) => {
      if (!a.timing && !b.timing) return a.created_at.localeCompare(b.created_at)
      if (!a.timing) return 1
      if (!b.timing) return -1
      return a.timing.localeCompare(b.timing)
    })
  const getSubtasksForDay = (dateStr: string) => subtasks.filter(s => s.due_date === dateStr)

  // Subtasks that are undated or overdue (and not completed)
  const overdueUndatedSubtasks = subtasks.filter(s => {
    if (s.status === 'dismissed') return false   // dismissed = deleted
    const isCompleted = s.status === 'checked' || (!s.require_check && s.status === 'done')
    if (isCompleted) return false
    if (!s.due_date) return true
    return s.due_date < todayStr
  })

  const handleTaskStatusChange = (taskId: string, newStatus: TaskStatus) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
    setOverdueUndated(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
    // Sync open task if visible
    setOpenTask(prev => prev?.id === taskId ? { ...prev, status: newStatus } : prev)
    onTaskActivity?.()
  }

  const handleTaskDeleted = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    setOverdueUndated(prev => prev.filter(t => t.id !== taskId))
    setOpenTask(null)
    onTaskActivity?.()
  }

  const handleSubtaskStatusTap = async (subtask: Subtask | SubtaskWithProject) => {
    const s = subtask as SubtaskWithProject
    const next = getNextStatus(s.status, user?.id === s.created_by, true)
    if (next === s.status) return
    const result = await updateSubtaskStatus(s.id, next, s.project_id, s.project_sequential)
    if (result.success) {
      setSubtasks(prev => prev.map(sub => sub.id === s.id ? { ...sub, status: next } : sub))
      setOpenSubtask(prev => prev?.id === s.id ? { ...prev, status: next } : prev)
    }
  }

  const handleQuickCreate = async (title: string, date: string, slotIndex: number | null) => {
    if (!title.trim()) return
    const slot = slotIndex !== null ? QUICK_SLOTS[slotIndex] : null

    // Optimistic update + chip close happen synchronously before any awaits so
    // the user never sees an empty chip hanging open during network calls.
    const optimisticId = `optimistic-${Date.now()}`
    const now = new Date().toISOString()
    const optimisticTask: TaskWithDetails = {
      id: optimisticId,
      title: title.trim(),
      description: null,
      status: 'not_done',
      is_overdue: false,
      due_date: date,
      timing: slot?.start ?? null,
      end_time: slot?.end ?? null,
      require_check: false,
      tag: null,
      bonus_points: 0,
      recurrence: 'none',
      created_by: userId,
      created_at: now,
      updated_at: now,
      assignees: [],
      checklist: [],
      comments: [],
    }
    setTasks(prev => [...prev, optimisticTask])
    setQuickAddDay(null)

    // Duplicate check after the fact; roll back and re-open chip if needed.
    const isDuplicate = await checkDuplicateTaskTitle(title.trim(), date, [targetUserId])
    if (isDuplicate) {
      setTasks(prev => prev.filter(t => t.id !== optimisticId))
      setQuickAddDay(date)
      setQuickAddDuplicateDay(date)
      setTimeout(() => setQuickAddDuplicateDay(null), 2500)
      return
    }

    const input: NewTaskInput = {
      title: title.trim(),
      due_date: date,
      timing: slot?.start,
      end_time: slot?.end,
      assignee_ids: [targetUserId],
    }
    const created = await createTask(input, userId)
    if (created) {
      // Pin the stable render key to the real id so the motion.div key stays
      // the same and AnimatePresence doesn't replay the enter animation.
      taskRenderKeys.current.set(created.id, optimisticId)
      setTasks(prev => prev.map(t =>
        t.id === optimisticId
          ? { ...created, assignees: [], checklist: [], comments: [] }
          : t
      ))
    } else {
      setTasks(prev => prev.filter(t => t.id !== optimisticId))
    }
  }

  const handleQuickCreateAndContinue = async (title: string, date: string, slotIndex: number | null) => {
    if (!title.trim()) return
    const slot = slotIndex !== null ? QUICK_SLOTS[slotIndex] : null

    // Show the task immediately; chip stays open for the next entry.
    const optimisticId = `optimistic-${Date.now()}`
    const now = new Date().toISOString()
    const optimisticTask: TaskWithDetails = {
      id: optimisticId,
      title: title.trim(),
      description: null,
      status: 'not_done',
      is_overdue: false,
      due_date: date,
      timing: slot?.start ?? null,
      end_time: slot?.end ?? null,
      require_check: false,
      tag: null,
      bonus_points: 0,
      recurrence: 'none',
      created_by: userId,
      created_at: now,
      updated_at: now,
      assignees: [],
      checklist: [],
      comments: [],
    }
    setTasks(prev => [...prev, optimisticTask])

    const isDuplicate = await checkDuplicateTaskTitle(title.trim(), date, [targetUserId])
    if (isDuplicate) {
      setTasks(prev => prev.filter(t => t.id !== optimisticId))
      setQuickAddDuplicateDay(date)
      setTimeout(() => setQuickAddDuplicateDay(null), 2500)
      return
    }

    const input: NewTaskInput = {
      title: title.trim(),
      due_date: date,
      timing: slot?.start,
      end_time: slot?.end,
      assignee_ids: [targetUserId],
    }
    const created = await createTask(input, userId)
    if (created) {
      taskRenderKeys.current.set(created.id, optimisticId)
      setTasks(prev => prev.map(t =>
        t.id === optimisticId
          ? { ...created, assignees: [], checklist: [], comments: [] }
          : t
      ))
    } else {
      setTasks(prev => prev.filter(t => t.id !== optimisticId))
    }
  }

  const handleQuickExpand = (title: string, date: string, slotIndex: number | null) => {
    setQuickAddDay(null)
    setNewTaskDate(date)
    setNewTaskTitle(title)
    setNewTaskSlot(slotIndex !== null ? [slotIndex, slotIndex] : null)
    setShowNewTask(true)
  }

  const weekLabel = `${weekDays[0].month} ${weekDays[0].date} – ${weekDays[6].month} ${weekDays[6].date}`

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h2 className="font-display text-lg sm:text-xl font-bold text-slate-800 whitespace-nowrap">Weekly Calendar</h2>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowGuide(v => !v)}
              className="p-1 text-slate-300 hover:text-slate-500 transition-colors"
              title="Status legend"
              aria-label="Status legend"
            >
              <HelpCircle size={16} />
            </button>
            <AnimatePresence>
              {showGuide && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowGuide(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.14 }}
                    className="absolute left-0 top-full mt-1.5 z-30 w-56 rounded-xl border border-slate-200 bg-white shadow-xl p-3"
                  >
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Legend</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {[
                        { label: 'Not Done',  dot: 'bg-slate-400' },
                        { label: 'Partial',   dot: 'bg-orange-600' },
                        { label: 'Checking',  dot: 'bg-yellow-400' },
                        { label: 'Completed', dot: 'bg-green-500' },
                        { label: 'Dismissed', dot: 'bg-slate-300' },
                      ].map(s => (
                        <div key={s.label} className="flex items-center gap-1.5">
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot}`} />
                          <span className="text-xs text-slate-600">{s.label}</span>
                        </div>
                      ))}
                      <div className="flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}>
                          <Star size={7} className="text-white" fill="white" />
                        </span>
                        <span className="text-xs text-slate-600">Bonus</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-3 rounded-sm bg-purple-400 flex-shrink-0" />
                        <span className="text-xs text-slate-600">Project</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2.5 leading-snug">Tap a chip&apos;s dot to advance its status. Verifiers can dismiss tasks awaiting verification.</p>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {teamMembers && teamMembers.length > 0 && currentUserId && onViewingUserChange && (
            <TeamMemberSelector
              members={teamMembers}
              selectedUserId={viewingUserId || currentUserId}
              currentUserId={currentUserId}
              currentUserName={currentUserName || ''}
              onSelect={onViewingUserChange}
            />
          )}
          <button
            onClick={() => setShowPlanner(true)}
            className="flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-emerald-600 flex-shrink-0 active:scale-95 transition-all"
            title="Import or draft a planner"
            aria-label="Planner"
          >
            <FileSpreadsheet size={16} />
          </button>
          <button
            onClick={() => { setNewTaskDate(todayStr); setShowNewTask(true) }}
            className="btn-primary hidden sm:flex items-center gap-2 text-sm !py-1.5"
          >
            <Plus size={16} /> New Task
          </button>
          <button
            onClick={() => { setNewTaskDate(todayStr); setShowNewTask(true) }}
            className="sm:hidden flex items-center justify-center w-9 h-9 rounded-full text-white shadow-lg flex-shrink-0 active:scale-95 transition-transform"
            style={{ background: 'linear-gradient(135deg, var(--page-gradient-from, #3B82F6), var(--page-gradient-to, #2563EB))' }}
            title="New Task"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={goToPrevWeek}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
          aria-label="Previous week"
        >
          <ChevronLeft size={18} />
        </button>
        <button onClick={goToThisWeek} className="text-sm font-semibold text-slate-700 hover:text-cyan-600 transition-colors">
          {weekLabel}
        </button>
        <button
          onClick={goToNextWeek}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
          aria-label="Next week"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <AnimatePresence mode="wait">
      {loading ? (
        <motion.div
          key="cal-loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="space-y-4"
        >
          {/* Skeleton grid — same structure as the real grid, real day headers already known */}
          <div className="overflow-x-auto rounded-xl border border-slate-100 shadow-sm">
            <div className="flex min-w-[700px]">
              {weekDays.map((day, i) => {
                const isToday = day.full === todayStr
                const isLast  = i === 6
                const chipCount = [2, 1, 2, 3, 1, 2, 1][i]
                return (
                  <div
                    key={day.full}
                    className={`min-w-0 flex flex-col flex-1 ${!isLast ? 'border-r border-slate-100' : ''}`}
                  >
                    <div className={`px-1.5 py-2 text-center border-b border-slate-100 ${isToday ? 'bg-cyan-100' : 'bg-slate-50'}`}>
                      <p className={`text-[10px] font-semibold uppercase tracking-wide ${isToday ? 'text-cyan-600' : 'text-slate-400'}`}>
                        {day.day}
                      </p>
                      <p className={`text-base font-bold leading-tight ${isToday ? 'text-cyan-700' : 'text-slate-700'}`}>
                        {day.date}
                      </p>
                    </div>
                    <div className={`p-1 space-y-1 flex-1 min-h-[96px] ${isToday ? 'bg-cyan-50/40' : 'bg-white'}`}>
                      {Array.from({ length: chipCount }).map((_, j) => (
                        <div
                          key={j}
                          className="w-full h-8 rounded-lg bg-slate-100 animate-pulse"
                          style={{ animationDelay: `${(i * 3 + j) * 60}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="cal-content"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="space-y-4"
        >
          {/* ── 7-Column Grid ─────────────────────────────────────────────────── */}
          <div ref={gridScrollRef} className="overflow-x-auto rounded-xl border border-slate-100 shadow-sm">
            <div className="flex min-w-[700px]">
              {weekDays.map((day, i) => {
                const dayTasks = getTasksForDay(day.full)
                const daySubs  = getSubtasksForDay(day.full)
                const isToday  = day.full === todayStr
                const isLast   = i === 6

                const isSelected = selectedDay === day.full
                const isExpanded = isSelected || quickAddDay === day.full

                return (
                  <div
                    key={day.full}
                    ref={isToday ? todayColRef : undefined}
                    style={{ flex: (isExpanded || isToday) ? '2 2 0%' : '1 1 0%', transition: 'flex 280ms ease' }}
                    className={`min-w-0 flex flex-col ${!isLast ? 'border-r border-slate-100' : ''}`}
                  >
                    {/* Day header — clickable */}
                    <button
                      onClick={() => setSelectedDay(isSelected ? null : day.full)}
                      className={`px-1.5 py-2 text-center border-b border-slate-100 w-full transition-colors ${
                        isSelected ? 'bg-mps-blue-100' : isToday ? 'bg-cyan-100' : 'bg-slate-50 hover:bg-slate-100'
                      }`}
                    >
                      <p className={`text-[10px] font-semibold uppercase tracking-wide ${
                        isSelected ? 'text-mps-blue-600' : isToday ? 'text-cyan-600' : 'text-slate-400'
                      }`}>
                        {day.day}
                      </p>
                      <p className={`text-base font-bold leading-tight ${
                        isSelected ? 'text-mps-blue-700' : isToday ? 'text-cyan-700' : 'text-slate-700'
                      }`}>
                        {day.date}
                      </p>
                    </button>

                    {/* Tasks for this day */}
                    <div className={`p-1 space-y-1 flex-1 min-h-[96px] ${
                      isToday ? 'bg-cyan-50/40' : 'bg-white'
                    }`}>
                      <AnimatePresence initial={false}>
                        {quickAddDuplicateDay === day.full && (
                          <motion.div
                            key="dup-error"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.15 }}
                            className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1 font-medium"
                          >
                            Already exists on this day
                          </motion.div>
                        )}
                        {dayTasks.map(task => (
                          <div key={taskRenderKeys.current.get(task.id) ?? task.id}>
                            <TaskGridChip
                              task={task}
                              canCheck={canCheck}
                              onStatusChange={handleTaskStatusChange}
                              onOpen={() => setOpenTask(task)}
                              currentUserId={userId}
                              readAt={readAt}
                              highlighted={task.id === highlightedTaskId}
                            />
                          </div>
                        ))}
                        {daySubs.map(sub => (
                          <div key={sub.id}>
                            <SubtaskGridChip
                              subtask={sub}
                              canCheck={canCheck}
                              onStatusTap={handleSubtaskStatusTap}
                              onOpen={() => setOpenSubtask(sub)}
                            />
                          </div>
                        ))}
                      </AnimatePresence>
                      <QuickAddChip
                        date={day.full}
                        isActive={quickAddDay === day.full}
                        onActivate={() => { setQuickAddDay(day.full) }}
                        onSubmit={(title, slotIndex) => handleQuickCreate(title, day.full, slotIndex)}
                        onContinue={(title, slotIndex) => handleQuickCreateAndContinue(title, day.full, slotIndex)}
                        onExpand={(title, slotIndex) => handleQuickExpand(title, day.full, slotIndex)}
                        onCancel={() => setQuickAddDay(null)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Selected Day Panel ───────────────────────────────────────────── */}
          <AnimatePresence>
            {selectedDay && (() => {
              const dayLabel = weekDays.find(d => d.full === selectedDay)
              const dayTasks = getTasksForDay(selectedDay)
              const daySubs  = getSubtasksForDay(selectedDay)
              const total    = dayTasks.length + daySubs.length
              return (
                <motion.div
                  key={selectedDay}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="rounded-xl border border-mps-blue-100 bg-mps-blue-50/40 p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-mps-blue-700 uppercase tracking-wide">
                      {dayLabel?.day} {dayLabel?.date} · {total} item{total !== 1 ? 's' : ''}
                    </p>
                    <button
                      onClick={() => { setNewTaskDate(selectedDay); setShowNewTask(true) }}
                      className="text-xs text-mps-blue-600 hover:text-mps-blue-800 font-medium flex items-center gap-1"
                    >
                      <Plus size={12} /> Add Task
                    </button>
                  </div>
                  {total === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-2">No tasks for this day</p>
                  ) : (
                    <div className="space-y-1">
                      {dayTasks.map(task => (
                        <TaskGridChip
                          key={task.id}
                          task={task}
                          canCheck={canCheck}
                          onStatusChange={handleTaskStatusChange}
                          onOpen={() => setOpenTask(task)}
                          currentUserId={userId}
                          readAt={readAt}
                          highlighted={task.id === highlightedTaskId}
                        />
                      ))}
                      {daySubs.map(sub => (
                        <SubtaskGridChip
                          key={sub.id}
                          subtask={sub}
                          canCheck={canCheck}
                          onStatusTap={handleSubtaskStatusTap}
                          onOpen={() => setOpenSubtask(sub)}
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              )
            })()}
          </AnimatePresence>

          {/* ── Overdue & Bonus — minimal text-button toggles. Always present so an
               empty list reads as an explicit zero state instead of vanishing. ── */}
          <div className="pt-1 space-y-2">

          {/* ── Overdue & Undated ─────────────────────────────────────────────── */}
          {(() => {
            // Group overdue items by month so only one month renders at a time.
            const monthMap: Record<string, { tasks: TaskWithDetails[]; subtasks: SubtaskWithProject[] }> = {}
            const bucket = (key: string) => (monthMap[key] ??= { tasks: [], subtasks: [] })
            for (const task of overdueUndated) {
              bucket(task.due_date ? task.due_date.slice(0, 7) : 'undated').tasks.push(task)
            }
            for (const sub of overdueUndatedSubtasks) {
              bucket(sub.due_date ? sub.due_date.slice(0, 7) : 'undated').subtasks.push(sub)
            }
            const datedMonths = Object.keys(monthMap).filter(k => k !== 'undated').sort().reverse()
            const months = [...datedMonths, ...(monthMap['undated'] ? ['undated'] : [])]
            const safeIdx = months.length > 0 ? Math.min(Math.max(overdueMonthIdx, 0), months.length - 1) : -1
            const activeKey = safeIdx >= 0 ? months[safeIdx] : undefined
            const active = activeKey ? (monthMap[activeKey] || { tasks: [], subtasks: [] }) : { tasks: [], subtasks: [] }
            const activeCount = active.tasks.length + active.subtasks.length
            const totalOverdue = overdueUndated.length + overdueUndatedSubtasks.length
            const activeLabel = !activeKey || activeKey === 'undated'
              ? 'Undated'
              : (() => {
                  const [y, m] = activeKey.split('-')
                  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                })()
            const handleOverdueToggle = () => {
              setOverdueCollapsed(prev => {
                if (prev) loadOverdueTasks()
                return !prev
              })
            }
            return (
              <div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOverdueToggle}
                    className="group inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                    Overdue
                    {overdueLoaded && (
                      <span className={`font-bold ${totalOverdue > 0 ? 'text-red-500' : 'text-slate-400'}`}>· {totalOverdue}</span>
                    )}
                    <ChevronRight
                      size={14}
                      className={`text-slate-400 transition-transform duration-200 ${overdueCollapsed ? '' : 'rotate-90'}`}
                    />
                  </button>
                  {!overdueCollapsed && overdueLoaded && months.length > 1 && (
                    <div className="flex items-center gap-1 bg-red-50 border border-red-100 rounded-lg px-1.5 py-0.5">
                      <button type="button" onClick={() => setOverdueMonthIdx(i => Math.min(i + 1, months.length - 1))} disabled={safeIdx >= months.length - 1} className="p-0.5 text-red-400 hover:text-red-600 disabled:opacity-30 transition-colors" title="Older month">
                        <ChevronLeft size={13} />
                      </button>
                      <span className="text-[11px] font-semibold text-red-700 min-w-[64px] text-center">{activeLabel}</span>
                      <button type="button" onClick={() => setOverdueMonthIdx(i => Math.max(i - 1, 0))} disabled={safeIdx <= 0} className="p-0.5 text-red-400 hover:text-red-600 disabled:opacity-30 transition-colors" title="Newer month">
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {!overdueCollapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      {overdueLoading ? (
                        <div className="flex items-center justify-center py-5">
                          <div className="h-4 w-4 border-2 border-red-200 border-t-red-500 rounded-full animate-spin" />
                        </div>
                      ) : totalOverdue === 0 ? (
                        <p className="text-xs text-slate-400 pl-5 py-2">No overdue tasks — you&apos;re all caught up.</p>
                      ) : (
                        <div className="pl-5 pt-2 space-y-1.5">
                          {active.tasks.map(task => (
                            <TaskGridChip
                              key={task.id}
                              task={task}
                              canCheck={canCheck}
                              onStatusChange={handleTaskStatusChange}
                              onOpen={() => setOpenTask(task)}
                              showDate
                              currentUserId={userId}
                              readAt={readAt}
                              highlighted={task.id === highlightedTaskId}
                            />
                          ))}
                          {active.subtasks.map(subtask => (
                            <SubtaskGridChip
                              key={subtask.id}
                              subtask={subtask}
                              onStatusTap={handleSubtaskStatusTap}
                              onOpen={() => setOpenSubtask(subtask)}
                            />
                          ))}
                          {activeCount === 0 && (
                            <p className="text-xs text-slate-400 py-1">Nothing overdue in {activeLabel}.</p>
                          )}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })()}

          {/* ── Bonus Tasks ───────────────────────────────────────────────────── */}
          {(() => {
            const monthMap: Record<string, TaskWithDetails[]> = {}
            for (const task of bonusTasksList) {
              const key = task.due_date ? task.due_date.slice(0, 7) : 'undated'
              if (!monthMap[key]) monthMap[key] = []
              monthMap[key].push(task)
            }
            const months = Object.keys(monthMap).sort().reverse()
            const safeIdx = months.length > 0 ? Math.min(Math.max(bonusMonthIdx, 0), months.length - 1) : -1
            const activeMonthKey = safeIdx >= 0 ? months[safeIdx] : undefined
            const activeMonthTasks = activeMonthKey ? (monthMap[activeMonthKey] || []) : []
            const activeMonthTotal = activeMonthTasks.reduce((sum, t) => sum + (t.bonus_points || 0), 0)
            const activeMonthLabel = !activeMonthKey || activeMonthKey === 'undated'
              ? 'Undated'
              : (() => {
                  const [y, m] = activeMonthKey.split('-')
                  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                })()
            const handleBonusToggle = () => {
              setBonusCollapsed(prev => {
                if (prev) loadBonusTasks()
                return !prev
              })
            }
            return (
              <div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleBonusToggle}
                    className="group inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    <Star size={14} className="text-amber-500 flex-shrink-0" />
                    Bonus Tasks
                    {bonusLoaded && (
                      <span className={`font-bold ${bonusTasksList.length > 0 ? 'text-amber-500' : 'text-slate-400'}`}>· {bonusTasksList.length}</span>
                    )}
                    <ChevronRight
                      size={14}
                      className={`text-slate-400 transition-transform duration-200 ${bonusCollapsed ? '' : 'rotate-90'}`}
                    />
                  </button>
                  {!bonusCollapsed && bonusLoaded && months.length > 1 && (
                    <div className="flex items-center gap-1 bg-amber-50 border border-amber-100 rounded-lg px-1.5 py-0.5">
                      <button type="button" onClick={() => setBonusMonthIdx(i => Math.min(i + 1, months.length - 1))} disabled={safeIdx >= months.length - 1} className="p-0.5 text-amber-400 hover:text-amber-600 disabled:opacity-30 transition-colors" title="Older month">
                        <ChevronLeft size={13} />
                      </button>
                      <span className="text-[11px] font-semibold text-amber-700 min-w-[64px] text-center">{activeMonthLabel}</span>
                      <button type="button" onClick={() => setBonusMonthIdx(i => Math.max(i - 1, 0))} disabled={safeIdx <= 0} className="p-0.5 text-amber-400 hover:text-amber-600 disabled:opacity-30 transition-colors" title="Newer month">
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {!bonusCollapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      {bonusLoading ? (
                        <div className="flex items-center justify-center py-5">
                          <div className="h-4 w-4 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
                        </div>
                      ) : bonusTasksList.length === 0 ? (
                        <p className="text-xs text-slate-400 pl-5 py-2">No bonus tasks yet.</p>
                      ) : (
                        <div className="pl-5 pt-2">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-slate-500">{activeMonthTasks.length} task{activeMonthTasks.length !== 1 ? 's' : ''}</span>
                            <span className="text-xs font-semibold text-amber-600 flex items-center gap-1">
                              <Star size={10} /> {activeMonthTotal} BP total
                            </span>
                          </div>
                          <div className="space-y-1">
                            {activeMonthTasks.map(task => (
                              <TaskGridChip
                                key={task.id}
                                task={task}
                                canCheck={canCheck}
                                onStatusChange={handleTaskStatusChange}
                                onOpen={() => setOpenTask(task)}
                                showDate
                                currentUserId={userId}
                                readAt={readAt}
                                highlighted={task.id === highlightedTaskId}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })()}
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Task Detail Modal ────────────────────────────────────────────────── */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {openTask && (
            <TaskCalendarModal
              task={openTask}
              canCheck={canCheck}
              userId={user?.id || userId}
              userRole={profile.role}
              onClose={() => setOpenTask(null)}
              onStatusChange={handleTaskStatusChange}
              onTaskDeleted={handleTaskDeleted}
              onTaskUpdated={loadTasks}
              availableAssignees={availableAssignees}
            />
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Subtask Detail Modal ─────────────────────────────────────────────── */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {openSubtask && (
            <SubtaskCard
              subtask={openSubtask}
              canCheck={canCheck}
              canEdit={canEditSubtasks}
              onClose={() => setOpenSubtask(null)}
              onStatusTap={handleSubtaskStatusTap}
              onSubtaskUpdated={loadTasks}
            />
          )}
        </AnimatePresence>,
        document.body
      )}

      <NewTaskForm
        isOpen={showNewTask}
        onClose={() => { setShowNewTask(false); setNewTaskTitle(''); setNewTaskSlot(null) }}
        onTaskCreated={handleNewTaskCreated}
        currentUserId={userId}
        defaultAssigneeId={targetUserId}
        defaultDate={newTaskDate}
        defaultTitle={newTaskTitle}
        defaultSlotRange={newTaskSlot}
        availableAssignees={availableAssignees}
        canAssignToOthers={canAssignToOthers}
      />

      <PlannerModal
        isOpen={showPlanner}
        onClose={() => setShowPlanner(false)}
        currentUserId={userId}
        defaultAssigneeId={targetUserId}
        availableAssignees={availableAssignees}
        canAssignToOthers={canAssignToOthers}
        onImported={loadTasks}
      />
    </div>
  )
}

// Status icons matching SchoolWorkManager style
const TASK_STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  not_done: <Circle       size={14} className="text-slate-400" />,
  partial:  <CircleDot    size={14} className="text-orange-600" />,
  done:     <CheckCircle2 size={14} className="text-yellow-500" />,
  checked:  <CheckCircle2 size={14} className="text-green-500" />,
  dismissed: <MinusCircle size={14} className="text-slate-400" />,
}

// ─── Task Grid Chip ────────────────────────────────────────────────────────────

function TaskGridChip({
  task,
  canCheck,
  onStatusChange,
  onOpen,
  showDate,
  currentUserId,
  readAt,
  highlighted,
}: {
  task: TaskWithDetails
  canCheck: boolean
  onStatusChange: (id: string, status: TaskStatus) => void
  onOpen: () => void
  showDate?: boolean
  currentUserId?: string
  readAt?: string
  highlighted?: boolean
}) {
  const isVerifier = canCheck || currentUserId === task.created_by

  const handleIconClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    // A verified ('checked') task can only be re-opened by a verifier.
    if (task.status === 'checked' && !isVerifier) return
    const next = getNextStatus(task.status, currentUserId === task.created_by, task.require_check ?? true)
    if (next === task.status) return
    const ok = await updateTaskStatus(task.id, next)
    if (ok) onStatusChange(task.id, next)
  }

  const hasComments = task.comments.length > 0
  const hasUnread = hasComments && task.comments.some(c =>
    c.user_id !== currentUserId &&
    (readAt ? c.created_at > readAt : true)
  )
  const isBonus = task.tag === 'bonus' || task.bonus_points > 0
  const isDismissed = task.status === 'dismissed'

  // done + no require_check = fully completed → green
  const doneNoCheck = task.status === 'done' && !task.require_check
  const isCompleted = task.status === 'checked' || doneNoCheck
  const chipClass = doneNoCheck
    ? 'border-green-200 bg-green-50 hover:border-green-300'
    : CHIP_STYLE[task.status]
  const statusIcon = doneNoCheck
    ? <CheckCircle2 size={14} className="text-green-500" />
    : TASK_STATUS_ICON[task.status]

  const leftBorderClass = hasUnread
    ? 'border-l-[3px] border-l-red-500'
    : hasComments
      ? 'border-l-[3px] border-l-blue-400'
      : ''

  // Highlighted: pulsing amber ring (focus jump). Bonus is no longer a ring —
  // it now reads as a gold "medal" star pinned to the top-left corner.
  const ringClass = highlighted
    ? 'ring-2 ring-amber-400 ring-offset-1 shadow-md shadow-amber-200 animate-pulse'
    : ''

  return (
    <div
      className={`w-full text-[11px] p-1.5 rounded-lg border transition-all relative ${chipClass} ${leftBorderClass} ${ringClass} ${isDismissed ? 'opacity-60' : ''}`}
    >
      {/* Bonus medal — gold star pinned top-left (clears the comment badge on the right) */}
      {isBonus && !isDismissed && (
        <span
          className="absolute -top-1.5 -left-1.5 z-10 w-[15px] h-[15px] rounded-full flex items-center justify-center shadow-sm ring-2 ring-white"
          style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}
          title="Bonus task"
        >
          <Star size={8} className="text-white" fill="white" />
        </span>
      )}
      <div className="flex items-start gap-1">
        <button
          onClick={handleIconClick}
          className="flex-shrink-0 mt-0.5 hover:scale-125 transition-transform"
          title="Tap to cycle status"
        >
          {statusIcon}
        </button>
        <button
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
          title="Tap to see details"
        >
          <p className={`font-medium leading-tight truncate ${
            isCompleted || isDismissed ? 'line-through text-slate-400' : 'text-slate-700'
          }`}>
            {task.title}
          </p>
          {(showDate && task.due_date) && (
            <p className="text-[9px] text-red-400 font-medium">{task.due_date}</p>
          )}
        </button>
      </div>
      {/* Comment count badge — top-right corner */}
      {hasComments && (
        <span className={`absolute -top-1.5 -right-1.5 flex items-center gap-0.5 rounded-full px-1 min-w-[14px] h-[14px] justify-center shadow-sm ${hasUnread ? 'bg-red-500' : 'bg-blue-500'} text-white`}>
          <span className="text-[9px] font-bold leading-none">{task.comments.length}</span>
        </span>
      )}
    </div>
  )
}

// ─── Subtask Grid Chip ────────────────────────────────────────────────────────

function SubtaskGridChip({
  subtask,
  onStatusTap,
  onOpen,
}: {
  subtask: SubtaskWithProject
  canCheck?: boolean
  onStatusTap: (s: SubtaskWithProject) => void
  onOpen: () => void
}) {
  const handleIconClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onStatusTap(subtask)
  }

  const subDoneNoCheck = subtask.status === 'done' && !subtask.require_check
  const subDismissed = subtask.status === 'dismissed'
  const subChipClass = subDoneNoCheck
    ? 'border-green-200 bg-green-50 hover:border-green-300'
    : CHIP_STYLE[subtask.status]
  const subIcon = subDoneNoCheck
    ? <CheckCircle2 size={14} className="text-green-500" />
    : TASK_STATUS_ICON[subtask.status]
  const subIsBonus = subtask.tag === 'bonus' || (subtask.bonus_points ?? 0) > 0

  return (
    <div
      className={`relative w-full text-[11px] p-1.5 pl-2 rounded-lg border border-l-[3px] border-l-purple-400 transition-all ${subChipClass} ${subDismissed ? 'opacity-60' : ''}`}
    >
      {/* Bonus medal — gold star pinned top-left */}
      {subIsBonus && !subDismissed && (
        <span
          className="absolute -top-1.5 -left-1.5 z-10 w-[15px] h-[15px] rounded-full flex items-center justify-center shadow-sm ring-2 ring-white"
          style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}
          title="Bonus subtask"
        >
          <Star size={8} className="text-white" fill="white" />
        </span>
      )}
      <div className="flex items-start gap-1">
        <button
          onClick={handleIconClick}
          className="flex-shrink-0 mt-0.5 hover:scale-125 transition-transform"
          title="Tap to cycle status"
        >
          {subIcon}
        </button>
        <button
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
          title="Tap to see details"
        >
          <p className={`font-medium leading-tight truncate ${
            (subtask.status === 'checked' || subDoneNoCheck || subDismissed) ? 'line-through text-slate-400' : 'text-slate-700'
          }`}>
            {subtask.title}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="inline-flex items-center gap-0.5 px-1 rounded text-[9px] font-bold leading-tight bg-purple-100 text-purple-600">
              <FolderKanban size={8} /> Project
            </span>
            <span className="text-slate-400 truncate text-[10px]">
              {subtask.project_title}
            </span>
          </div>
        </button>
      </div>
    </div>
  )
}

// ─── Quick Add Chip ───────────────────────────────────────────────────────────

function QuickAddChip({
  isActive,
  onActivate,
  onSubmit,
  onContinue,
  onExpand,
  onCancel,
}: {
  date: string
  isActive: boolean
  onActivate: () => void
  onSubmit: (title: string, slotIndex: number | null) => void
  onContinue: (title: string, slotIndex: number | null) => void
  onExpand: (title: string, slotIndex: number | null) => void
  onCancel: () => void
}) {
  const [localTitle, setLocalTitle] = useState('')
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isActive) {
      setLocalTitle('')
      setSelectedSlot(null)
      // Small delay so the element is rendered before focusing
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [isActive])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (localTitle.trim()) {
        onSubmit(localTitle.trim(), selectedSlot)
        setLocalTitle('')
        setSelectedSlot(null)
      }
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  const handleContainerBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    // Only act when focus moves completely outside this chip
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
      if (localTitle.trim()) {
        onSubmit(localTitle.trim(), selectedSlot)
      } else {
        onCancel()
      }
    }
  }

  if (!isActive) {
    return (
      <button
        onClick={onActivate}
        className="w-full text-[11px] p-1 rounded-lg border border-dashed border-slate-200 text-slate-300 hover:border-blue-300 hover:text-blue-400 hover:bg-blue-50/40 transition-all flex items-center justify-center"
        title="Add task"
      >
        <Plus size={11} />
      </button>
    )
  }

  return (
    <>
      <div
        ref={containerRef}
        onBlur={handleContainerBlur}
        className="w-full text-[11px] rounded-lg border border-blue-300 bg-white shadow-sm"
      >
        {/* Title input row */}
        <div className="flex items-center gap-1 px-1.5 pt-1.5 pb-1">
          <Circle size={12} className="text-slate-300 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={localTitle}
            onChange={e => setLocalTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Task title…"
            className="flex-1 min-w-0 bg-transparent text-[11px] text-slate-700 placeholder-slate-300 outline-none font-medium"
          />
          <button
            tabIndex={0}
            onMouseDown={e => { e.preventDefault(); onExpand(localTitle.trim(), selectedSlot) }}
            className="flex-shrink-0 text-slate-300 hover:text-blue-500 transition-colors"
            title="Expand to full form"
          >
            <ExternalLink size={10} />
          </button>
        </div>
        {/* Mini slot picker */}
        <div className="px-1.5 pb-1.5 flex flex-wrap gap-0.5">
          {QUICK_SLOTS.map((slot, i) => (
            <button
              key={i}
              tabIndex={0}
              onMouseDown={e => { e.preventDefault(); setSelectedSlot(selectedSlot === i ? null : i) }}
              className={`px-1 py-0.5 rounded text-[9px] font-semibold leading-tight transition-colors ${
                selectedSlot === i
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
              title={`${slot.start}–${slot.end}`}
            >
              {slot.label}
            </button>
          ))}
        </div>
      </div>
      {/* Save & add another */}
      <button
        tabIndex={-1}
        onMouseDown={e => {
          e.preventDefault() // keep focus in the input above
          const title = localTitle.trim()
          const slot  = selectedSlot
          setLocalTitle('')
          setSelectedSlot(null)
          if (title) onContinue(title, slot)
          inputRef.current?.focus()
        }}
        className="w-full p-1 rounded-lg border border-dashed border-blue-200 text-blue-300 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/40 transition-all flex items-center justify-center"
        title="Save and add another"
      >
        <Plus size={11} />
      </button>
    </>
  )
}

// ─── Task Calendar Modal ──────────────────────────────────────────────────────

function TaskCalendarModal({
  task,
  canCheck,
  userId,
  userRole,
  onClose,
  onStatusChange,
  onTaskDeleted,
  onTaskUpdated,
  availableAssignees = [],
}: {
  task: TaskWithDetails
  canCheck: boolean
  userId: string
  userRole: string
  onClose: () => void
  onStatusChange: (id: string, status: TaskStatus) => void
  onTaskDeleted: (id: string) => void
  onTaskUpdated: () => void
  availableAssignees?: UserProfile[]
}) {
  const requireCheck = task.require_check ?? false

  // The calendar list is loaded lightweight, so the task's heavy relations
  // (assignees, checklist, full comments, creator) are fetched on open. Until
  // they arrive, edit/delete stay hidden (canEdit=false) so we never show an
  // action the user might not be permitted to take.
  const [details, setDetails] = useState<TaskDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(true)
  const assignees = details?.assignees ?? []
  const creator = details?.creator
  const canEdit = details
    ? canEditTaskFn({ ...task, assignees, creator }, userId, userRole)
    : false

  const [editing, setEditing]             = useState(false)
  const [editTitle, setEditTitle]         = useState(task.title)
  const [editDesc, setEditDesc]           = useState(task.description || '')
  const [editDate, setEditDate]           = useState(task.due_date || '')
  const [editStartTime, setEditStartTime] = useState(task.timing || '')
  const [editEndTime, setEditEndTime]     = useState(task.end_time || '')
  const [editRequireCheck, setEditRequireCheck] = useState(requireCheck)
  const [editRecurrence, setEditRecurrence] = useState<TaskRecurrence>(task.recurrence || 'none')
  const [editBonusPoints, setEditBonusPoints] = useState(task.bonus_points || 0)
  const [editTag, setEditTag]             = useState<TaskTag>(task.tag)
  const [editAssigneeIds, setEditAssigneeIds] = useState<string[]>([])
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [editChecklistItems, setEditChecklistItems] = useState<string[]>([])
  const [newEditCheckItem, setNewEditCheckItem] = useState('')
  const [saving, setSaving]               = useState(false)

  // Live checklist / comments interaction
  const [newCheckItem, setNewCheckItem]   = useState('')
  const [newComment, setNewComment]       = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [localChecklist, setLocalChecklist] = useState<TaskChecklistItem[]>([])
  const [localComments, setLocalComments]   = useState<TaskComment[]>([])

  // Comment attachment
  const [commentAttachMode, setCommentAttachMode] = useState<'none' | 'link' | 'file'>('none')
  const [commentLinkUrl, setCommentLinkUrl]       = useState('')
  const [commentLinkName, setCommentLinkName]     = useState('')
  const [commentFile, setCommentFile]             = useState<File | null>(null)
  const [uploadingAttach, setUploadingAttach]     = useState(false)
  const commentFileRef = useRef<HTMLInputElement>(null)

  const canEditAssignees = ['coordinator', 'principal', 'admin'].includes(userRole)

  // Load the heavy relations once the modal opens, then seed the live and edit
  // states from them.
  useEffect(() => {
    let cancelled = false
    setDetailsLoading(true)
    fetchTaskDetails(task.id, task.created_by).then(d => {
      if (cancelled) return
      setDetails(d)
      setLocalChecklist(d.checklist)
      setLocalComments(d.comments)
      setEditAssigneeIds(d.assignees.map(a => a.user_id))
      setEditChecklistItems(d.checklist.map(c => c.text))
      setDetailsLoading(false)
    })
    return () => { cancelled = true }
  }, [task.id, task.created_by])

  // Verifiers (supervisors who can check, or the task's creator) may dismiss a
  // task that requires verification, and are the only ones who can re-open a
  // verified ('checked') task.
  const isVerifier = canCheck || userId === task.created_by

  const handleStatusClick = async () => {
    if (task.status === 'checked' && !isVerifier) return
    const next = getNextStatus(task.status, userId === task.created_by, requireCheck)
    if (next === task.status) return
    const ok = await updateTaskStatus(task.id, next)
    if (ok) onStatusChange(task.id, next)
  }

  const canDismiss = requireCheck && isVerifier
  const handleDismissToggle = async () => {
    const next: TaskStatus = task.status === 'dismissed' ? 'not_done' : 'dismissed'
    const ok = await updateTaskStatus(task.id, next)
    if (ok) onStatusChange(task.id, next)
  }

  const handleToggleChecklist = async (itemId: string, current: boolean) => {
    await toggleChecklistItem(itemId, !current)
    setLocalChecklist(prev => prev.map(c => c.id === itemId ? { ...c, is_completed: !current } : c))
    onTaskUpdated()
  }

  const handleAddCheckItem = async () => {
    if (!newCheckItem.trim()) return
    const item = await addChecklistItem(task.id, newCheckItem.trim(), localChecklist.length)
    if (item) {
      setLocalChecklist(prev => [...prev, item])
      setNewCheckItem('')
      onTaskUpdated()
    }
  }

  const handleAddComment = async () => {
    if (!newComment.trim() && commentAttachMode === 'none') return
    if (commentAttachMode === 'link' && !commentLinkUrl.trim()) return
    if (commentAttachMode === 'file' && !commentFile) return
    setSubmitting(true)
    let attachment: { url: string; name: string; type: 'image' | 'document' | 'link' } | undefined
    if (commentAttachMode === 'file' && commentFile) {
      setUploadingAttach(true)
      const uploaded = await uploadTaskAttachment(commentFile, task.id, userId)
      setUploadingAttach(false)
      if (uploaded) attachment = uploaded
    } else if (commentAttachMode === 'link' && commentLinkUrl.trim()) {
      attachment = { url: commentLinkUrl.trim(), name: commentLinkName.trim() || commentLinkUrl.trim(), type: 'link' }
    }
    const comment = await addComment(task.id, userId, newComment.trim(), attachment)
    if (comment) {
      setLocalComments(prev => [...prev, comment])
      setNewComment('')
      setCommentAttachMode('none')
      setCommentLinkUrl('')
      setCommentLinkName('')
      setCommentFile(null)
      onTaskUpdated()
    }
    setSubmitting(false)
  }

  const handleDelete = async () => {
    if (!confirm('Delete this task?')) return
    const ok = await deleteTask(task.id)
    if (ok) {
      onClose()
      onTaskDeleted(task.id)
    }
  }

  const handleSave = async () => {
    if (!editTitle.trim()) return
    setSaving(true)
    const ok = await updateTask(task.id, {
      title: editTitle.trim(),
      description: editDesc.trim() || null,
      due_date: editDate || null,
      timing: editStartTime || null,
      end_time: editEndTime || null,
      require_check: editRequireCheck,
      recurrence: editRecurrence,
      bonus_points: editBonusPoints,
      tag: editTag,
    })

    if (canEditAssignees) {
      const origIds = assignees.map(a => a.user_id).sort()
      const newIds = [...editAssigneeIds].sort()
      if (JSON.stringify(origIds) !== JSON.stringify(newIds)) {
        await updateTaskAssignees(task.id, editAssigneeIds)
      }
    }

    setSaving(false)
    if (ok) {
      setEditing(false)
      onTaskUpdated()
    }
  }

  const statusLabel = getDynamicStatusLabel(task.status, requireCheck)
  const statusColorClass = getDynamicStatusColors(task.status, requireCheck)
  const dotColorClass = getDynamicDotColor(task.status, requireCheck)

  const completedChecklist = localChecklist.filter(c => c.is_completed).length

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.93, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white rounded-t-3xl border-b border-slate-100 p-5 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={handleStatusClick}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 font-bold text-sm transition-all active:scale-95 hover:shadow-lg ${statusColorClass}`}
              title="Tap to change status"
            >
              <div className={`w-3.5 h-3.5 rounded-full ${dotColorClass} animate-pulse`} />
              {statusLabel}
              <ChevronRight size={14} className="opacity-50" />
            </button>
            {task.bonus_points > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium">
                {task.bonus_points} BP
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {canDismiss && (
              <button
                onClick={handleDismissToggle}
                className={`p-2 rounded-lg transition-colors ${
                  task.status === 'dismissed'
                    ? 'text-mps-blue-500 hover:text-mps-blue-700 hover:bg-mps-blue-50'
                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                }`}
                title={task.status === 'dismissed' ? 'Restore task' : 'Dismiss — exclude from stats'}
              >
                {task.status === 'dismissed' ? <RotateCcw size={16} /> : <Ban size={16} />}
              </button>
            )}
            {canEdit && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="p-2 text-mps-blue-500 hover:text-mps-blue-700 hover:bg-mps-blue-50 rounded-lg transition-colors"
                title="Edit task"
              >
                <Edit3 size={16} />
              </button>
            )}
            {canEdit && (
              <button
                onClick={handleDelete}
                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete task"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {editing ? (
            <div className="space-y-3 border border-mps-blue-200 rounded-2xl p-4 bg-mps-blue-50/30">
              <h4 className="text-sm font-semibold text-mps-blue-700 flex items-center gap-1.5">
                <Edit3 size={14} /> Edit Task
              </h4>
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="Title *"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 bg-white"
              />
              <textarea
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 resize-none bg-white"
              />
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Due Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Start Time</label>
                  <input
                    type="time"
                    value={editStartTime}
                    onChange={e => setEditStartTime(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 bg-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">End Time</label>
                  <input
                    type="time"
                    value={editEndTime}
                    onChange={e => setEditEndTime(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 bg-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Recurrence</label>
                  <select
                    value={editRecurrence}
                    onChange={e => setEditRecurrence(e.target.value as TaskRecurrence)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 bg-white"
                  >
                    {(Object.keys(RECURRENCE_LABELS) as TaskRecurrence[]).map(r => (
                      <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Bonus Points</label>
                  <select
                    value={editBonusPoints}
                    onChange={e => setEditBonusPoints(Number(e.target.value))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 bg-white"
                  >
                    <option value="0">None</option>
                    <option value="1">1 Point</option>
                    <option value="2">2 Points</option>
                    <option value="3">3 Points</option>
                    <option value="4">4 Points</option>
                    <option value="5">5 Points</option>
                  </select>
                </div>
              </div>
              {/* Require Check */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} className={editRequireCheck ? 'text-mps-blue-600' : 'text-slate-400'} />
                  <p className="text-xs font-medium text-slate-700">Require Verification</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditRequireCheck(prev => !prev)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${editRequireCheck ? 'bg-mps-blue-500' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${editRequireCheck ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
              {/* Assignees edit */}
              {canEditAssignees && availableAssignees.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Assignees</label>
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <div className="relative border-b border-slate-100">
                      <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        value={assigneeSearch}
                        onChange={e => setAssigneeSearch(e.target.value)}
                        placeholder="Search assignees…"
                        className="w-full pl-7 pr-2 py-1.5 text-xs focus:outline-none bg-transparent"
                      />
                    </div>
                    <div className="max-h-28 overflow-y-auto p-1 space-y-0.5">
                      {availableAssignees
                        .filter(u => !assigneeSearch || u.full_name?.toLowerCase().includes(assigneeSearch.toLowerCase()) || u.role?.toLowerCase().includes(assigneeSearch.toLowerCase()))
                        .map(u => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => setEditAssigneeIds(prev =>
                              prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]
                            )}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition-colors ${
                              editAssigneeIds.includes(u.id)
                                ? 'bg-mps-blue-50 text-mps-blue-700 border border-mps-blue-200'
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${editAssigneeIds.includes(u.id) ? 'bg-mps-blue-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                              {u.full_name?.charAt(0) || '?'}
                            </div>
                            <span>{u.full_name}</span>
                            <span className="text-slate-400 ml-auto">{u.role}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              )}
              {/* Checklist edit */}
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Checklist Items</label>
                <div className="space-y-1 mb-1.5">
                  {editChecklistItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                      <span className="text-xs text-slate-700 flex-1">{item}</span>
                      <button
                        type="button"
                        onClick={() => setEditChecklistItems(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newEditCheckItem}
                    onChange={e => setNewEditCheckItem(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (newEditCheckItem.trim()) {
                          setEditChecklistItems(prev => [...prev, newEditCheckItem.trim()])
                          setNewEditCheckItem('')
                        }
                      }
                    }}
                    placeholder="Add item..."
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-mps-blue-500 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newEditCheckItem.trim()) {
                        setEditChecklistItems(prev => [...prev, newEditCheckItem.trim()])
                        setNewEditCheckItem('')
                      }
                    }}
                    className="p-1.5 text-mps-blue-600 hover:bg-mps-blue-50 rounded-lg"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving || !editTitle.trim()}
                  className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Check size={14} />
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button onClick={() => setEditing(false)} className="btn-secondary text-sm">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-xl font-bold text-slate-800">{task.title}</h2>
                {task.description && (
                  <p className="text-slate-600 mt-2 text-sm leading-relaxed">{task.description}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                {task.due_date && (
                  <div className="flex items-center gap-1.5 text-sm text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg">
                    <Calendar size={14} /> {task.due_date}
                  </div>
                )}
                {task.timing && (
                  <div className="flex items-center gap-1.5 text-sm text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg">
                    <Clock size={14} /> {task.timing}{task.end_time ? ` – ${task.end_time}` : ''}
                  </div>
                )}
                {task.bonus_points > 0 && (
                  <div className="flex items-center gap-1.5 text-sm bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg">
                    <Star size={14} /> {task.bonus_points} BP
                  </div>
                )}
                {task.recurrence && task.recurrence !== 'none' && (
                  <div className="flex items-center gap-1.5 text-sm text-purple-600 bg-purple-50 px-3 py-1.5 rounded-lg">
                    <Repeat size={14} /> {RECURRENCE_LABELS[task.recurrence]}
                  </div>
                )}
                {requireCheck && (
                  <div className="flex items-center gap-1.5 text-sm text-mps-blue-600 bg-mps-blue-50 px-3 py-1.5 rounded-lg font-medium">
                    <ShieldCheck size={14} /> Verification Required
                  </div>
                )}
              </div>

              {assignees.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-1.5">Assignees</h4>
                  <div className="flex flex-wrap gap-2">
                    {assignees.map(a => (
                      <span key={a.id} className="flex items-center gap-1.5 text-xs bg-mps-blue-50 text-mps-blue-700 px-2 py-1 rounded-full font-medium">
                        <Avatar
                          avatarUrl={a.user?.avatar_url}
                          name={a.user?.full_name}
                          size={18}
                          userId={a.user_id}
                        />
                        {a.user?.full_name ?? a.user_id}
                      </span>
                    ))}
                  </div>
                  {creator && (
                    <p className="text-xs text-slate-400 mt-1.5">
                      Assigned by: <span className="font-medium text-slate-500">{creator.full_name}</span>
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Checklist (always shown in view mode) */}
          {!editing && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <CheckSquare size={14} />
                Checklist
                {localChecklist.length > 0 && (
                  <span className="text-xs font-normal text-slate-500">({completedChecklist}/{localChecklist.length})</span>
                )}
              </h4>
              <div className="space-y-1.5">
                {localChecklist.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleToggleChecklist(item.id, item.is_completed)}
                    className="flex items-center gap-2 w-full text-left p-2 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    {item.is_completed ? (
                      <CheckSquare size={16} className="text-mps-green-600 flex-shrink-0" />
                    ) : (
                      <Square size={16} className="text-slate-400 flex-shrink-0" />
                    )}
                    <span className={`text-sm ${item.is_completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                      {item.text}
                    </span>
                  </button>
                ))}
                {detailsLoading ? (
                  <p className="text-xs text-slate-400 italic">Loading…</p>
                ) : localChecklist.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No checklist items yet</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  value={newCheckItem}
                  onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCheckItem()}
                  placeholder="Add checklist item..."
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-mps-blue-500"
                />
                <button onClick={handleAddCheckItem} className="text-mps-blue-600 hover:text-mps-blue-700 p-1.5">
                  <CheckSquare size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Comments (always shown in view mode) */}
          {!editing && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <MessageSquare size={14} />
                Comments ({localComments.length})
              </h4>
              <div className="space-y-3 max-h-40 overflow-y-auto">
                {localComments.map(comment => (
                  <div key={comment.id} className="bg-slate-50 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Avatar avatarUrl={comment.user?.avatar_url} name={comment.user?.full_name} size={22} userId={comment.user?.id} />
                      <span className="text-xs font-medium text-slate-700">{comment.user?.full_name || 'Unknown'}</span>
                      <span className="text-xs text-slate-400">{new Date(comment.created_at).toLocaleDateString()}</span>
                    </div>
                    {comment.content && (
                      <p className="text-sm text-slate-600 pl-8">{comment.content}</p>
                    )}
                    {comment.attachment_url && (
                      <div className="pl-8 mt-1.5">
                        {comment.attachment_type === 'image' ? (
                          <a href={comment.attachment_url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={comment.attachment_url}
                              alt={comment.attachment_name || 'Image'}
                              className="max-h-36 rounded-lg border border-slate-200 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            />
                          </a>
                        ) : comment.attachment_type === 'link' ? (
                          <a
                            href={comment.attachment_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-mps-blue-600 hover:text-mps-blue-700 bg-mps-blue-50 px-3 py-1.5 rounded-lg border border-mps-blue-100"
                          >
                            <ExternalLink size={11} />
                            {comment.attachment_name || comment.attachment_url}
                          </a>
                        ) : (
                          <a
                            href={comment.attachment_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-800 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200"
                          >
                            <FileText size={11} />
                            {comment.attachment_name || 'Document'}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {detailsLoading ? (
                  <p className="text-sm text-slate-400 text-center py-2">Loading…</p>
                ) : localComments.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-2">No comments yet</p>
                ) : null}
              </div>

              {/* Attachment preview */}
              {commentAttachMode === 'link' && (
                <div className="mt-2 flex gap-2">
                  <input
                    type="url"
                    value={commentLinkUrl}
                    onChange={e => setCommentLinkUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-mps-blue-400"
                  />
                  <input
                    type="text"
                    value={commentLinkName}
                    onChange={e => setCommentLinkName(e.target.value)}
                    placeholder="Label (optional)"
                    className="w-28 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-mps-blue-400"
                  />
                </div>
              )}
              {commentAttachMode === 'file' && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => commentFileRef.current?.click()}
                    className="w-full flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-mps-blue-400 hover:text-mps-blue-600 transition-colors"
                  >
                    {commentFile
                      ? <><ImageIcon size={12} className="flex-shrink-0" />{commentFile.name}</>
                      : <><Paperclip size={12} className="flex-shrink-0" />Choose image or document</>
                    }
                  </button>
                  <input
                    ref={commentFileRef}
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                    onChange={e => setCommentFile(e.target.files?.[0] || null)}
                  />
                </div>
              )}

              <div className="flex items-center gap-2 mt-2">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setCommentAttachMode(m => m === 'link' ? 'none' : 'link')}
                    className={`p-1.5 rounded-lg transition-colors ${commentAttachMode === 'link' ? 'bg-mps-blue-100 text-mps-blue-600' : 'text-slate-400 hover:text-mps-blue-500 hover:bg-slate-100'}`}
                    title="Attach link"
                  >
                    <Link2 size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommentAttachMode(m => m === 'file' ? 'none' : 'file')}
                    className={`p-1.5 rounded-lg transition-colors ${commentAttachMode === 'file' ? 'bg-mps-blue-100 text-mps-blue-600' : 'text-slate-400 hover:text-mps-blue-500 hover:bg-slate-100'}`}
                    title="Attach file or image"
                  >
                    <Paperclip size={13} />
                  </button>
                </div>
                <input
                  type="text"
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !submitting && !uploadingAttach && handleAddComment()}
                  placeholder="Write a comment..."
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-mps-blue-500"
                />
                <button
                  onClick={handleAddComment}
                  disabled={submitting || uploadingAttach || (!newComment.trim() && commentAttachMode === 'none') || (commentAttachMode === 'link' && !commentLinkUrl.trim()) || (commentAttachMode === 'file' && !commentFile)}
                  className="p-2 bg-mps-blue-500 text-white rounded-lg hover:bg-mps-blue-600 disabled:opacity-50 transition-colors"
                >
                  {uploadingAttach ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Subtask Detail Modal ─────────────────────────────────────────────────────

