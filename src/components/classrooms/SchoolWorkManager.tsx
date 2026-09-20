'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronRight, Circle, CircleDot, CheckCircle2,
  AlertTriangle, Clock, ChevronDown, X, BookOpen, Folder,
  FileText, ExternalLink, Link2, CalendarDays, Star, Loader2, Send, ShieldCheck,
} from 'lucide-react'
import {
  ClassroomWithDetails, ClassroomFile, ClassroomFolder,
  FileStatus, fetchClassroomFilesBatch, fetchProgressForStudent,
  updateFileProgress,
} from '@/lib/classrooms'
import {
  StudentHomeroomTask,
  SmartboardTaskStatus,
  fetchStudentHomeroomTasks,
  getNextSmartboardStatus,
  upsertTaskCompletion,
} from '@/lib/smartboard'
import WorkWeekCalendar, {
  CalendarViewMode, WorkWeekCalendarSkeleton, BLEED_CARD_INSET,
  addDays, formatDate, getWeekStart, parseDate, themeFromGradient,
} from '@/components/calendar/WorkWeekCalendar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkItem extends ClassroomFile {
  folder: ClassroomFolder
  classroomId: string
  classroomTitle: string
}

/** One dated row on the calendar — classroom work, or homeroom homework. */
type CalendarEntry =
  | { kind: 'cw'; item: WorkItem }
  | { kind: 'hw'; task: StudentHomeroomTask }

const NO_ENTRIES: CalendarEntry[] = []

// ─── Unified visual status ────────────────────────────────────────────────────
// Both FileStatus and SmartboardTaskStatus map to this for consistent styling.

type VisualStatus = 'not_done' | 'partial' | 'awaiting' | 'done'

const VSTATUS_ICON: Record<VisualStatus, React.ReactNode> = {
  not_done: <Circle       size={14} className="text-slate-400" />,
  partial:  <CircleDot    size={14} className="text-orange-500" />,
  awaiting: <CheckCircle2 size={14} className="text-yellow-500" />,
  done:     <CheckCircle2 size={14} className="text-emerald-500" />,
}

const VSTATUS_BORDER: Record<VisualStatus, string> = {
  not_done: 'border-slate-200 bg-white',
  partial:  'border-orange-300 bg-orange-50',
  awaiting: 'border-yellow-300 bg-yellow-50',
  done:     'border-emerald-200 bg-emerald-50',
}

const VSTATUS_LABEL: Record<VisualStatus, string> = {
  not_done: 'Not Done',
  partial:  'In Progress',
  awaiting: 'Awaiting Review',
  done:     'Completed',
}

const VSTATUS_CHIP: Record<VisualStatus, string> = {
  not_done: 'border-slate-200 bg-white text-slate-600',
  partial:  'border-orange-200 bg-orange-50 text-orange-700',
  awaiting: 'border-yellow-200 bg-yellow-50 text-yellow-700',
  done:     'border-emerald-200 bg-emerald-50 text-emerald-700',
}

function fileVS(status: FileStatus): VisualStatus {
  if (status === 'completed') return 'done'
  if (status === 'done') return 'awaiting'
  return status as 'not_done' | 'partial'
}

function hwVS(status: SmartboardTaskStatus, requireCheck: boolean): VisualStatus {
  if (status === 'checked') return 'done'
  if (status === 'done' && !requireCheck) return 'done'
  if (status === 'done' && requireCheck) return 'awaiting'
  return status as 'not_done' | 'partial'
}

// ─── EduPoints earned logic ───────────────────────────────────────────────────
// Points are NOT earned if: awaiting verification OR completed after due date.

function fileEarned(status: FileStatus, dueDate: string | null, today: Date): boolean {
  if (status !== 'completed') return false
  if (dueDate && parseDate(dueDate) < today) return false
  return true
}

function hwEarned(
  status: SmartboardTaskStatus,
  requireCheck: boolean,
  dueDate: string | null,
  today: Date,
): boolean {
  if (status === 'done' && requireCheck) return false
  const completed = status === 'checked' || (status === 'done' && !requireCheck)
  if (!completed) return false
  if (dueDate && parseDate(dueDate) < today) return false
  return true
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function getNextStatus(current: FileStatus, requiresCheck: boolean): FileStatus {
  const cycle: FileStatus[] = requiresCheck
    ? ['not_done', 'partial', 'done', 'completed']
    : ['not_done', 'partial', 'completed']
  return cycle[(cycle.indexOf(current) + 1) % cycle.length]
}

function hwIsCompleted(status: SmartboardTaskStatus, requireCheck: boolean): boolean {
  return status === 'checked' || (status === 'done' && !requireCheck)
}

// ─── EduPoints Badge ──────────────────────────────────────────────────────────

function EduPointsBadge({
  points, earned, reason,
}: { points: number; earned: boolean; reason?: string }) {
  return (
    <span
      title={reason}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold leading-tight border cursor-default ${
        earned
          ? 'bg-amber-500 text-white border-amber-500'
          : 'bg-amber-50 text-amber-600 border-amber-200'
      }`}
    >
      <Star size={8} className={earned ? 'fill-current' : ''} />
      {earned ? `+${points}` : points} EP
    </span>
  )
}

// ─── Collapsible, paged work list ─────────────────────────────────────────────

interface ListTone {
  /** Card border, header wash and the count pill. */
  border: string
  wash: string
  chip: string
  chipIcon: string
  title: string
  pill: string
  hoverRow: string
  action: string
}

const TONE_OVERDUE: ListTone = {
  border: 'border-rose-200/80',
  wash: 'linear-gradient(to bottom, rgba(255,241,242,0.95), rgba(255,255,255,0))',
  chip: 'bg-rose-100',
  chipIcon: 'text-rose-600',
  title: 'text-rose-700',
  pill: 'bg-rose-500 text-white',
  hoverRow: 'hover:bg-rose-50/40',
  action: 'text-rose-600 hover:text-rose-800',
}

const TONE_UNDATED: ListTone = {
  border: 'border-slate-200',
  wash: 'linear-gradient(to bottom, rgba(248,250,252,0.95), rgba(255,255,255,0))',
  chip: 'bg-slate-100',
  chipIcon: 'text-slate-500',
  title: 'text-slate-700',
  pill: 'bg-slate-500 text-white',
  hoverRow: 'hover:bg-slate-50',
  action: 'text-slate-600 hover:text-slate-900',
}

/**
 * A titled list of work that collapses and pages. Both the Overdue and the
 * No-Due-Date panels are this, so they look and behave identically: a header
 * that toggles the body, only `page` rows mounted at a time however long the
 * list runs, and a footer that grows the page rather than dumping the lot.
 */
function WorkListPanel<T>({
  tone, icon: Icon, title, countLabel, countTitle, entries, page,
  defaultOpen = true, rowKey, renderRow,
}: {
  tone: ListTone
  icon: React.ElementType
  title: string
  /** What the count pill reads — "9+" for a capped tally. */
  countLabel: string
  /** Tooltip for the pill, where the exact number lives. */
  countTitle: string
  entries: T[]
  page: number
  defaultOpen?: boolean
  rowKey: (entry: T) => string
  renderRow: (entry: T) => React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [shown, setShown] = useState(page)
  if (entries.length === 0) return null

  return (
    <div className={`-mx-4 sm:mx-0 border-y sm:border sm:rounded-2xl ${tone.border} bg-white overflow-hidden`}>
      <button
        onClick={() => { setOpen(o => !o); setShown(page) }}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-3 sm:px-4 py-3 text-left transition-colors hover:brightness-[0.98]"
        style={{ background: open ? tone.wash : undefined }}
      >
        <span className={`w-7 h-7 !rounded-xl flex items-center justify-center flex-shrink-0 ${tone.chip}`}>
          <Icon size={14} className={tone.chipIcon} />
        </span>
        <h3 className={`text-sm font-semibold ${tone.title}`}>{title}</h3>
        <span
          title={countTitle}
          className={`text-[11px] font-bold px-2 py-0.5 !rounded-full tabular-nums flex-shrink-0 ${tone.pill}`}
        >
          {countLabel}
        </span>
        <span className="flex-1" />
        <span className={`text-[11px] font-semibold ${tone.title} opacity-70`}>{open ? 'Hide' : 'Show'}</span>
        <ChevronDown size={14} className={`${tone.chipIcon} transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className={`border-t ${tone.border} divide-y divide-slate-100`}>
            {entries.slice(0, shown).map(entry => (
              <div key={rowKey(entry)} className={`transition-colors ${tone.hoverRow}`}>
                {renderRow(entry)}
              </div>
            ))}
          </div>

          {/* Paging — "show more" mounts another page rather than the whole
              list, and the exact remainder stays uncounted. */}
          {(entries.length > shown || shown > page) && (
            <div className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 border-t ${tone.border} bg-slate-50/60`}>
              {entries.length > shown && (
                <button
                  onClick={() => setShown(n => n + page)}
                  className={`text-xs font-semibold flex items-center gap-1 ${tone.action}`}
                >
                  Show more <ChevronDown size={12} />
                </button>
              )}
              {shown > page && (
                <button
                  onClick={() => setShown(page)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  Collapse
                </button>
              )}
              <span className="flex-1" />
              <span className="text-[11px] text-slate-400 tabular-nums">
                {shown >= entries.length ? 'All shown' : `${shown} of ${countLabel}`}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SchoolWorkManagerProps {
  classrooms: ClassroomWithDetails[]
  userId: string
  /** Hex colors from the admin-configured academics banner theme. */
  themeGradFrom?: string
  themeGradTo?: string
}

/** Rows per page in the No-Due-Date panel. */
const LIST_LIMIT = 5
/** How far either side of today homework is loaded in one go. */
const WINDOW_DAYS = 180
/** Overdue is shown as "9+" past this — an exact count of a long backlog is
 *  neither useful to a student nor worth the render churn. */
const OVERDUE_COUNT_CAP = 9
/** Overdue rows are mounted a page at a time, so a backlog of hundreds still
 *  costs a handful of DOM nodes. */
const OVERDUE_PAGE = 6

/** One missed piece of work — classwork or homework — with its due date
 *  resolved once, so the list can be sorted without re-parsing. */
type OverdueEntry =
  | { kind: 'cw'; item: WorkItem; dueMs: number }
  | { kind: 'hw'; task: StudentHomeroomTask; dueMs: number }

/** Whole days between a due date and today, for the "3d late" chip. */
function daysLate(dueMs: number, today: Date): number {
  return Math.max(1, Math.round((today.getTime() - dueMs) / 86_400_000))
}

/** The chip darkens with the delay: a day late is a nudge, a month is not. */
function lateTone(days: number): string {
  if (days <= 2)  return 'bg-amber-50 text-amber-700 border-amber-200'
  if (days <= 7)  return 'bg-orange-50 text-orange-700 border-orange-200'
  if (days <= 30) return 'bg-rose-50 text-rose-700 border-rose-200'
  return 'bg-rose-600 text-white border-rose-600'
}

export default function SchoolWorkManager({
  classrooms, userId,
  themeGradFrom = '#0891b2',
  themeGradTo   = '#0f766e',
}: SchoolWorkManagerProps) {
  const [weekStart, setWeekStart]   = useState(() => getWeekStart(new Date()))
  const [workItems, setWorkItems]   = useState<WorkItem[]>([])
  const [progressMap, setProgressMap] = useState<Record<string, FileStatus>>({})
  const [filesLoading, setFilesLoading] = useState(true)
  const [hwLoading, setHwLoading]   = useState(true)
  const [detailItem, setDetailItem] = useState<WorkItem | null>(null)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  // Phone-only layout: one day at a time (default) or the whole week stacked.
  const [viewMode, setViewMode] = useState<CalendarViewMode>('daily')

  const [homeworkItems, setHomeworkItems] = useState<StudentHomeroomTask[]>([])
  const [hwSavingId, setHwSavingId]       = useState<string | null>(null)
  const [detailHomework, setDetailHomework] = useState<StudentHomeroomTask | null>(null)
  const [hwExpandedSubmit, setHwExpandedSubmit] = useState<string | null>(null)
  const [hwDraftSubmission, setHwDraftSubmission] = useState('')

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadFiles = useCallback(async () => {
    if (classrooms.length === 0) { setWorkItems([]); setFilesLoading(false); return }
    setFilesLoading(true)
    const titleById = new Map(classrooms.map(c => [c.id, c.title]))
    const files = await fetchClassroomFilesBatch(classrooms.map(c => c.id))
    const all = files.map(f => ({
      ...f,
      classroomId: f.folder.classroom_id,
      classroomTitle: titleById.get(f.folder.classroom_id) ?? '',
    } as WorkItem))
    setWorkItems(all)
    if (all.length > 0) {
      const progress = await fetchProgressForStudent(userId, all.map(f => f.id))
      const map: Record<string, FileStatus> = {}
      for (const p of progress) map[p.file_id] = p.status as FileStatus
      setProgressMap(map)
    }
    setFilesLoading(false)
  }, [classrooms, userId])

  useEffect(() => { loadFiles() }, [loadFiles])

  const loadHomework = useCallback(async () => {
    setHwLoading(true)
    const now = new Date()
    // Wide enough either side of today that stepping through weeks keeps
    // finding homework without a refetch.
    const data = await fetchStudentHomeroomTasks(
      userId,
      formatDate(addDays(now, -WINDOW_DAYS)),
      formatDate(addDays(now, WINDOW_DAYS)),
    )
    setHomeworkItems(data)
    setHwLoading(false)
  }, [userId])

  useEffect(() => { loadHomework() }, [loadHomework])

  // ── Actions ─────────────────────────────────────────────────────────────────

  const cycleHwStatus = async (task: StudentHomeroomTask) => {
    const next = getNextSmartboardStatus(task.my_status, false, task.require_check)
    if (next === task.my_status) return
    if (next === 'done' && task.requires_submission && !task.my_submission) {
      setHwExpandedSubmit(task.id)
      setHwDraftSubmission(task.my_submission ?? '')
      return
    }
    setHomeworkItems(prev => prev.map(t => t.id === task.id ? { ...t, my_status: next } : t))
    if (detailHomework?.id === task.id) setDetailHomework(prev => prev ? { ...prev, my_status: next } : prev)
    setHwSavingId(task.id)
    await upsertTaskCompletion(task.id, userId, next)
    setHwSavingId(null)
  }

  const saveHwSubmission = async (task: StudentHomeroomTask) => {
    setHwSavingId(task.id)
    const status: SmartboardTaskStatus = task.my_status === 'not_done' ? 'done' : task.my_status
    await upsertTaskCompletion(task.id, userId, status, hwDraftSubmission.trim() || null)
    setHomeworkItems(prev => prev.map(t => t.id === task.id
      ? { ...t, my_status: status, my_submission: hwDraftSubmission.trim() || null } : t))
    if (detailHomework?.id === task.id) setDetailHomework(prev => prev
      ? { ...prev, my_status: status, my_submission: hwDraftSubmission.trim() || null } : prev)
    setHwSavingId(null)
    setHwExpandedSubmit(null)
  }

  const handleToggle = async (item: WorkItem) => {
    const current = progressMap[item.id] || 'not_done'
    const next    = getNextStatus(current, item.requires_check)
    const ok      = await updateFileProgress(item.id, userId, next)
    if (ok) setProgressMap(prev => ({ ...prev, [item.id]: next }))
  }

  // ── Computed ─────────────────────────────────────────────────────────────────

  const today = new Date(); today.setHours(0, 0, 0, 0)
  // A stable dependency for the memo below — `today` is a new object every
  // render, but midnight-anchored, so this number only moves with the date.
  const todayMs = today.getTime()

  // Bucket every dated item by day up front, so the calendar's repeated
  // per-day lookups (pickers, counts, columns) are map reads rather than a
  // fresh scan of both lists each time.
  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>()
    const push = (due: string, entry: CalendarEntry) => {
      const key = formatDate(parseDate(due))
      const bucket = map.get(key)
      if (bucket) bucket.push(entry)
      else map.set(key, [entry])
    }
    for (const item of workItems) if (item.due_date) push(item.due_date, { kind: 'cw', item })
    for (const task of homeworkItems) if (task.due_date) push(task.due_date, { kind: 'hw', task })
    return map
  }, [workItems, homeworkItems])

  const entriesForDay = useCallback(
    (day: Date) => entriesByDay.get(formatDate(day)) ?? NO_ENTRIES,
    [entriesByDay],
  )

  // Overdue work, classwork and homework merged into one list, most recently
  // missed first. Memoised and built in a single pass per source: a student
  // with a long backlog can have hundreds of these, and this used to re-filter
  // both lists on every render (every status toggle, every day tap).
  const overdue = useMemo(() => {
    const entries: OverdueEntry[] = []
    for (const item of workItems) {
      if (!item.due_date) continue
      if ((progressMap[item.id] || 'not_done') === 'completed') continue
      const due = parseDate(item.due_date)
      if (due.getTime() >= todayMs) continue
      entries.push({ kind: 'cw', item, dueMs: due.getTime() })
    }
    for (const task of homeworkItems) {
      if (!task.due_date) continue
      if (hwIsCompleted(task.my_status, task.require_check)) continue
      const due = parseDate(task.due_date)
      if (due.getTime() >= todayMs) continue
      entries.push({ kind: 'hw', task, dueMs: due.getTime() })
    }
    entries.sort((a, b) => b.dueMs - a.dueMs)
    return {
      entries,
      total: entries.length,
      // Past the cap the exact number stops being useful and starts being
      // discouraging — "9+" says "a backlog" without counting it out.
      label: entries.length > OVERDUE_COUNT_CAP ? `${OVERDUE_COUNT_CAP}+` : String(entries.length),
      capped: entries.length > OVERDUE_COUNT_CAP,
    }
  }, [workItems, homeworkItems, progressMap, todayMs])

  // Work with no due date at all, both sources in one list — same shape as
  // `overdue` above, so both feed the same panel.
  const undated = useMemo(() => {
    const entries: CalendarEntry[] = []
    for (const item of workItems) {
      if (item.due_date) continue
      if ((progressMap[item.id] || 'not_done') === 'completed') continue
      entries.push({ kind: 'cw', item })
    }
    for (const task of homeworkItems) {
      if (task.due_date) continue
      if (hwIsCompleted(task.my_status, task.require_check)) continue
      entries.push({ kind: 'hw', task })
    }
    return entries
  }, [workItems, homeworkItems, progressMap])

  // ── Item renderers ───────────────────────────────────────────────────────────
  // Shared by the phone agenda and the desktop per-day columns, so both stay in
  // sync: `compact` swaps the full wrapped-title row for a narrower stacked
  // card (used for a desktop column that isn't the expanded day). Neither ever
  // truncates a title — it wraps onto another line instead.

  const renderCwItem = (item: WorkItem, compact: boolean) => {
    const status = progressMap[item.id] || 'not_done'
    const vs     = fileVS(status)
    const earned = fileEarned(status, item.due_date, today)

    if (compact) {
      return (
        <button
          onClick={() => setDetailItem(item)}
          className={`block w-full text-left text-[10px] p-1.5 rounded-lg border transition-all hover:shadow-sm ${VSTATUS_BORDER[vs]}`}
        >
          <div className="flex items-start gap-1">
            <button
              onClick={e => { e.stopPropagation(); handleToggle(item) }}
              className="flex-shrink-0 mt-0.5 hover:scale-125 transition-transform"
              aria-label="Change status"
            >
              {VSTATUS_ICON[vs]}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`font-semibold leading-tight ${vs === 'done' ? 'line-through text-slate-500' : 'text-slate-800'}`}>
                {item.title}
              </p>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                <span className="inline-block px-1 py-0.5 rounded text-[8px] font-bold bg-cyan-100 text-cyan-700">CW</span>
                {item.edu_points > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-700">
                    <Star size={8} /> {item.edu_points}
                  </span>
                )}
              </div>
            </div>
          </div>
        </button>
      )
    }

    return (
      <div
        onClick={() => setDetailItem(item)}
        className="flex items-start gap-3 px-3 sm:px-4 py-3 cursor-pointer hover:bg-slate-50 active:bg-slate-100 transition-colors"
      >
        <span className="self-stretch w-1 rounded-full bg-cyan-400 flex-shrink-0" />
        <button
          onClick={e => { e.stopPropagation(); handleToggle(item) }}
          className="flex-shrink-0 mt-0.5 hover:scale-110 transition-transform"
          aria-label="Change status"
        >
          {VSTATUS_ICON[vs]}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold leading-snug ${vs === 'done' ? 'line-through text-slate-500' : 'text-slate-800'}`}>
            {item.title}
          </p>
          {item.description && (
            <p className="text-xs text-slate-600 leading-snug line-clamp-2 mt-0.5">{item.description}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-100 text-cyan-700">CLASSWORK</span>
            {item.edu_points > 0 && <EduPointsBadge points={item.edu_points} earned={earned} />}
            <span className="text-[10px] text-slate-600 truncate max-w-[10rem]">{item.classroomTitle}</span>
          </div>
        </div>
        <ChevronRight size={15} className="text-slate-400 flex-shrink-0 mt-1" />
      </div>
    )
  }

  const renderHwItem = (task: StudentHomeroomTask, compact: boolean) => {
    const vs     = hwVS(task.my_status, task.require_check)
    const earned = hwEarned(task.my_status, task.require_check, task.due_date, today)
    const saving = hwSavingId === task.id

    if (compact) {
      return (
        <button
          onClick={() => setDetailHomework(task)}
          className={`block w-full text-left text-[10px] p-1.5 rounded-lg border transition-all hover:shadow-sm ${VSTATUS_BORDER[vs]}`}
        >
          <div className="flex items-start gap-1">
            <button
              onClick={e => { e.stopPropagation(); cycleHwStatus(task) }}
              className="flex-shrink-0 mt-0.5 hover:scale-125 transition-transform"
              disabled={saving}
              aria-label="Change status"
            >
              {saving ? <Loader2 size={12} className="animate-spin text-slate-500" /> : VSTATUS_ICON[vs]}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`font-semibold leading-tight ${vs === 'done' ? 'line-through text-slate-500' : 'text-slate-800'}`}>
                {task.title}
              </p>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                <span className="inline-block px-1 py-0.5 rounded text-[8px] font-bold bg-purple-100 text-purple-700">HW</span>
                {task.edu_points > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-700">
                    <Star size={8} /> {task.edu_points}
                  </span>
                )}
              </div>
            </div>
          </div>
        </button>
      )
    }

    return (
      <div
        onClick={() => setDetailHomework(task)}
        className="flex items-start gap-3 px-3 sm:px-4 py-3 cursor-pointer hover:bg-slate-50 active:bg-slate-100 transition-colors"
      >
        <span className="self-stretch w-1 rounded-full bg-purple-400 flex-shrink-0" />
        <button
          onClick={e => { e.stopPropagation(); cycleHwStatus(task) }}
          className="flex-shrink-0 mt-0.5 hover:scale-110 transition-transform"
          disabled={saving}
          aria-label="Change status"
        >
          {saving ? <Loader2 size={16} className="animate-spin text-slate-500" /> : VSTATUS_ICON[vs]}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold leading-snug ${vs === 'done' ? 'line-through text-slate-500' : 'text-slate-800'}`}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs text-slate-600 leading-snug line-clamp-2 mt-0.5">{task.description}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700">HOMEWORK</span>
            {task.timing && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-600">
                <Clock size={10} /> {task.timing}
              </span>
            )}
            {task.edu_points > 0 && <EduPointsBadge points={task.edu_points} earned={earned} />}
            {task.require_check && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700">
                <ShieldCheck size={10} /> Verified
              </span>
            )}
            <span className="text-[10px] text-slate-600 truncate max-w-[10rem]">
              {task.classroom_title ?? task.homeroom_name}
            </span>
          </div>
        </div>
        <ChevronRight size={15} className="text-slate-400 flex-shrink-0 mt-1" />
      </div>
    )
  }

  /** One compact row for the Overdue / No-Due-Date panels: status toggle,
   *  title with its source line, and whatever the panel puts on the right. */
  const renderListRow = (entry: CalendarEntry, trailing?: React.ReactNode) => {
    const isCw   = entry.kind === 'cw'
    const vs     = isCw
      ? fileVS(progressMap[entry.item.id] || 'not_done')
      : hwVS(entry.task.my_status, entry.task.require_check)
    const saving = !isCw && hwSavingId === entry.task.id
    const points = isCw ? entry.item.edu_points : entry.task.edu_points
    const earned = isCw
      ? fileEarned(progressMap[entry.item.id] || 'not_done', entry.item.due_date, today)
      : hwEarned(entry.task.my_status, entry.task.require_check, entry.task.due_date, today)

    return (
      <div className="flex items-center gap-3 py-2.5 px-3 sm:px-4">
        <button
          onClick={() => isCw ? handleToggle(entry.item) : cycleHwStatus(entry.task)}
          className="flex-shrink-0 hover:scale-110 transition-transform"
          disabled={saving}
          aria-label="Change status"
        >
          {saving ? <Loader2 size={14} className="animate-spin text-slate-400" /> : VSTATUS_ICON[vs]}
        </button>
        <button
          onClick={() => isCw ? setDetailItem(entry.item) : setDetailHomework(entry.task)}
          className="flex-1 min-w-0 text-left"
        >
          <p className={`text-sm font-medium truncate ${vs === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
            {isCw ? entry.item.title : entry.task.title}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
            <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold leading-tight ${
              isCw ? 'bg-cyan-100 text-cyan-700' : 'bg-purple-100 text-purple-600'
            }`}>
              {isCw ? 'CW' : 'HW'}
            </span>
            {points > 0 && (
              <EduPointsBadge
                points={points}
                earned={earned}
                reason={earned ? undefined : 'Points not awarded — completed after due date'}
              />
            )}
            <span className="truncate">
              {isCw ? entry.item.classroomTitle : (entry.task.classroom_title ?? entry.task.homeroom_name)}
            </span>
          </div>
        </button>
        {trailing}
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (filesLoading || hwLoading) {
    return (
      <WorkWeekCalendarSkeleton
        weekStart={weekStart}
        theme={themeFromGradient(themeGradFrom, themeGradTo)}
        rootClassName={BLEED_CARD_INSET}
      />
    )
  }

  if (workItems.length === 0 && homeworkItems.length === 0) {
    return (
      <div className={`${BLEED_CARD_INSET} px-6 py-10 text-center`}>
        <div
          className="w-12 h-12 !rounded-2xl flex items-center justify-center mx-auto mb-3"
          style={{ background: themeFromGradient(themeGradFrom, themeGradTo).primaryLight }}
        >
          <CheckCircle2 size={24} style={{ color: themeGradFrom }} />
        </div>
        <p className="text-sm font-semibold text-slate-700">All clear</p>
        <p className="text-xs text-slate-500 mt-1">
          Nothing has been set across your classrooms yet — work shows up here the moment it is.
        </p>
      </div>
    )
  }

  const calendarTheme = themeFromGradient(themeGradFrom, themeGradTo)

  return (
    <div className="space-y-4">

      {/* ── Calendar ──────────────────────────────────────────────────────────
           The same week calendar the classroom Calendar tab uses: on phones a
           Daily (default) / Weekly toggle over a full-width agenda, on desktop
           seven columns with the selected day expanded. Themed with the
           admin-set academics banner colours. ── */}
      <WorkWeekCalendar<CalendarEntry>
        weekStart={weekStart}
        onWeekStartChange={setWeekStart}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        itemsForDay={entriesForDay}
        itemKey={entry => entry.kind === 'hw' ? entry.task.id : entry.item.id}
        renderItem={(entry, compact) => entry.kind === 'hw'
          ? renderHwItem(entry.task, compact)
          : renderCwItem(entry.item, compact)}
        itemLabel={entry => entry.kind === 'hw' ? entry.task.title : entry.item.title}
        emptyDayLabel="Nothing due on this day."
        theme={calendarTheme}
        rootClassName={BLEED_CARD_INSET}
      />

      {/* ── Overdue ───────────────────────────────────────────────────────────
           Collapsible and paged (see WorkListPanel): however deep the backlog
           runs only a page of rows is ever mounted, and the badge stops
           counting at 9+. Rows carry a "days late" chip that darkens with the
           delay, which reads faster than a bare date and sorts the urgent from
           the ancient. ── */}
      <WorkListPanel
        tone={TONE_OVERDUE}
        icon={AlertTriangle}
        title="Overdue"
        countLabel={overdue.label}
        countTitle={`${overdue.total} overdue item${overdue.total === 1 ? '' : 's'}`}
        entries={overdue.entries}
        page={OVERDUE_PAGE}
        // A big backlog opens collapsed — a wall of red is not a to-do list.
        defaultOpen={!overdue.capped}
        rowKey={entry => entry.kind === 'cw' ? entry.item.id : entry.task.id}
        renderRow={entry => {
          const late = daysLate(entry.dueMs, today)
          return renderListRow(entry, (
            <span
              title={new Date(entry.dueMs).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              className={`text-[10px] font-bold flex-shrink-0 whitespace-nowrap border px-2 py-0.5 !rounded-full tabular-nums ${lateTone(late)}`}
            >
              {late}d late
            </span>
          ))
        }}
      />

      {/* ── No due date ──────────────────────────────────────────────────────── */}
      <WorkListPanel
        tone={TONE_UNDATED}
        icon={Clock}
        title="No Due Date"
        countLabel={String(undated.length)}
        countTitle={`${undated.length} item${undated.length === 1 ? '' : 's'} with no due date`}
        entries={undated}
        page={LIST_LIMIT}
        rowKey={entry => entry.kind === 'cw' ? entry.item.id : entry.task.id}
        renderRow={entry => renderListRow(entry)}
      />

      {/* ── Homework Detail Popup ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {detailHomework && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { setDetailHomework(null); setHwExpandedSubmit(null) }}
          >
            <motion.div
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
              initial={{ scale: 0.92, opacity: 0, y: 24 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 24 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700">Homework</span>
                  {detailHomework.due_date && parseDate(detailHomework.due_date) < today &&
                    !hwIsCompleted(detailHomework.my_status, detailHomework.require_check) && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600 flex items-center gap-1">
                      <AlertTriangle size={10} /> Overdue
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { setDetailHomework(null); setHwExpandedSubmit(null) }}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors flex-shrink-0"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="px-6 py-5 space-y-5">
                {/* Title + status cycle button */}
                <div>
                  <h2 className={`text-xl font-bold leading-snug mb-3 ${hwVS(detailHomework.my_status, detailHomework.require_check) === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                    {detailHomework.title}
                  </h2>
                  <button
                    onClick={() => cycleHwStatus(detailHomework)}
                    disabled={hwSavingId === detailHomework.id}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl border-2 text-sm font-semibold transition-all active:scale-95 disabled:opacity-70 ${VSTATUS_CHIP[hwVS(detailHomework.my_status, detailHomework.require_check)]}`}
                  >
                    {hwSavingId === detailHomework.id
                      ? <Loader2 size={14} className="animate-spin" />
                      : VSTATUS_ICON[hwVS(detailHomework.my_status, detailHomework.require_check)]}
                    <span>{VSTATUS_LABEL[hwVS(detailHomework.my_status, detailHomework.require_check)]}</span>
                    <span className="text-xs opacity-50 font-normal">tap to change</span>
                  </button>
                </div>

                {/* Awaiting verification notice */}
                {detailHomework.my_status === 'done' && detailHomework.require_check && (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-yellow-50 border border-yellow-200">
                    <ShieldCheck size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-yellow-700 font-medium leading-relaxed">
                      Awaiting teacher verification. EduPoints will be awarded only after your teacher reviews and approves this work.
                    </p>
                  </div>
                )}

                {/* Description */}
                {detailHomework.description && (
                  <p className="text-sm text-slate-600 leading-relaxed p-4 bg-slate-50 rounded-2xl">
                    {detailHomework.description}
                  </p>
                )}

                {/* Meta */}
                <div className="space-y-2.5">
                  {(detailHomework.classroom_title || detailHomework.homeroom_name) && (
                    <div className="flex items-center gap-3 text-sm text-slate-600">
                      <div className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                        <BookOpen size={14} className="text-purple-500" />
                      </div>
                      <span>{detailHomework.classroom_title ?? detailHomework.homeroom_name}</span>
                    </div>
                  )}
                  {detailHomework.due_date && (
                    <div className="flex items-center gap-3 text-sm">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${parseDate(detailHomework.due_date) < today ? 'bg-red-50' : 'bg-slate-50'}`}>
                        <CalendarDays size={14} className={parseDate(detailHomework.due_date) < today ? 'text-red-500' : 'text-slate-500'} />
                      </div>
                      <span className={`font-medium ${parseDate(detailHomework.due_date) < today ? 'text-red-600' : 'text-slate-700'}`}>
                        Due {parseDate(detailHomework.due_date).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })}
                        {parseDate(detailHomework.due_date) < today && ' · Overdue'}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {detailHomework.require_check && (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1">
                        <ShieldCheck size={10} /> Needs verification
                      </span>
                    )}
                    {detailHomework.requires_submission && (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 font-medium flex items-center gap-1">
                        <Send size={10} /> Submission required
                      </span>
                    )}
                  </div>
                </div>

                {/* EduPoints section */}
                {detailHomework.edu_points > 0 && (() => {
                  const vs       = hwVS(detailHomework.my_status, detailHomework.require_check)
                  const earned   = hwEarned(detailHomework.my_status, detailHomework.require_check, detailHomework.due_date, today)
                  const overdue  = detailHomework.due_date && parseDate(detailHomework.due_date) < today
                  return (
                    <div className={`p-4 rounded-2xl border ${earned ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <Star size={16} className={earned ? 'text-amber-500 fill-amber-500' : 'text-amber-400'} />
                        <span className={`text-sm font-bold ${earned ? 'text-amber-700' : 'text-slate-600'}`}>
                          {earned ? `+${detailHomework.edu_points} EduPoints Earned!` : `${detailHomework.edu_points} EduPoints`}
                        </span>
                      </div>
                      {!earned && (
                        <p className="text-xs text-slate-500 leading-relaxed">
                          {vs === 'awaiting'
                            ? 'Points awarded only after teacher verifies your submission.'
                            : overdue
                              ? 'Points not awarded — work was completed after the due date.'
                              : 'Complete this task on time to earn EduPoints.'}
                        </p>
                      )}
                    </div>
                  )
                })()}

                {/* Submission */}
                {detailHomework.requires_submission && (
                  <div className="border-t border-slate-100 pt-5">
                    <p className="text-xs font-semibold text-slate-500 mb-3 flex items-center gap-1.5">
                      <Send size={11} />
                      {detailHomework.my_submission ? 'Your Submission' : 'Submit Your Work'}
                    </p>
                    {hwExpandedSubmit === detailHomework.id ? (
                      <div className="space-y-2.5">
                        <textarea
                          value={hwDraftSubmission}
                          onChange={e => setHwDraftSubmission(e.target.value)}
                          placeholder="Add a note, link, or answer…"
                          rows={3}
                          className="w-full text-sm border border-slate-200 rounded-2xl px-4 py-3 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 resize-none"
                        />
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => setHwExpandedSubmit(null)} className="text-sm text-slate-400 hover:text-slate-600 px-2 py-1">
                            Cancel
                          </button>
                          <button
                            onClick={() => saveHwSubmission(detailHomework)}
                            disabled={hwSavingId === detailHomework.id}
                            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
                          >
                            {hwSavingId === detailHomework.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                            Submit
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setHwExpandedSubmit(detailHomework.id)
                          setHwDraftSubmission(detailHomework.my_submission ?? '')
                        }}
                        className="text-sm text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1.5 py-1"
                      >
                        {detailHomework.my_submission
                          ? `"${detailHomework.my_submission.slice(0, 60)}${detailHomework.my_submission.length > 60 ? '…' : ''}" — Edit`
                          : '+ Add submission'}
                      </button>
                    )}
                  </div>
                )}

                {/* Attachment */}
                {detailHomework.attachment_url && (
                  <div className="border-t border-slate-100 pt-5">
                    <p className="text-xs font-semibold text-slate-500 mb-3">Attachment</p>
                    <a
                      href={detailHomework.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-100 transition-colors"
                    >
                      <FileText size={16} className="text-slate-500 flex-shrink-0" />
                      <span className="flex-1 truncate">{detailHomework.attachment_name || 'View Attachment'}</span>
                      <ExternalLink size={13} className="text-slate-400 flex-shrink-0" />
                    </a>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Classwork Detail Popup ────────────────────────────────────────────── */}
      <AnimatePresence>
        {detailItem && (() => {
          const status    = progressMap[detailItem.id] || 'not_done'
          const vs        = fileVS(status)
          const earned    = fileEarned(status, detailItem.due_date, today)
          const isOverdue = detailItem.due_date && parseDate(detailItem.due_date) < today

          return (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetailItem(null)}
            >
              <motion.div
                className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
                initial={{ scale: 0.92, opacity: 0, y: 24 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.92, opacity: 0, y: 24 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-cyan-100 text-cyan-700">Classwork</span>
                    {isOverdue && vs !== 'done' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600 flex items-center gap-1">
                        <AlertTriangle size={10} /> Overdue
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setDetailItem(null)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors flex-shrink-0"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="px-6 py-5 space-y-5">
                  {/* Title + status cycle button */}
                  <div>
                    <h2 className={`text-xl font-bold leading-snug mb-3 ${vs === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                      {detailItem.title}
                    </h2>
                    <button
                      onClick={() => handleToggle(detailItem)}
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl border-2 text-sm font-semibold transition-all active:scale-95 ${VSTATUS_CHIP[vs]}`}
                    >
                      {VSTATUS_ICON[vs]}
                      <span>{VSTATUS_LABEL[vs]}</span>
                      <span className="text-xs opacity-50 font-normal">tap to change</span>
                    </button>
                  </div>

                  {/* Awaiting verification notice */}
                  {status === 'done' && detailItem.requires_check && (
                    <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-yellow-50 border border-yellow-200">
                      <ShieldCheck size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-yellow-700 font-medium leading-relaxed">
                        Awaiting teacher verification. EduPoints will be awarded only after your teacher reviews and approves this work.
                      </p>
                    </div>
                  )}

                  {/* Description */}
                  {detailItem.description && (
                    <p className="text-sm text-slate-600 leading-relaxed p-4 bg-slate-50 rounded-2xl">
                      {detailItem.description}
                    </p>
                  )}

                  {/* Meta */}
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-3 text-sm text-slate-600">
                      <div className="w-8 h-8 rounded-xl bg-cyan-50 flex items-center justify-center flex-shrink-0">
                        <BookOpen size={14} className="text-cyan-500" />
                      </div>
                      <span>{detailItem.classroomTitle}</span>
                    </div>
                    {detailItem.folder.title && (
                      <div className="flex items-center gap-3 text-sm text-slate-600">
                        <div className="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center flex-shrink-0">
                          <Folder size={14} className="text-slate-400" />
                        </div>
                        <span>{detailItem.folder.title}</span>
                      </div>
                    )}
                    {detailItem.due_date && (
                      <div className="flex items-center gap-3 text-sm">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${isOverdue ? 'bg-red-50' : 'bg-slate-50'}`}>
                          <CalendarDays size={14} className={isOverdue ? 'text-red-500' : 'text-slate-500'} />
                        </div>
                        <span className={`font-medium ${isOverdue ? 'text-red-600' : 'text-slate-700'}`}>
                          Due {parseDate(detailItem.due_date).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })}
                          {isOverdue && ' · Overdue'}
                        </span>
                      </div>
                    )}
                    {(detailItem.requires_check || detailItem.requires_submission) && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {detailItem.requires_check && (
                          <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1">
                            <ShieldCheck size={10} /> Needs verification
                          </span>
                        )}
                        {detailItem.requires_submission && (
                          <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 font-medium flex items-center gap-1">
                            <Send size={10} /> Submission required
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* EduPoints section */}
                  {detailItem.edu_points > 0 && (
                    <div className={`p-4 rounded-2xl border ${earned ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <Star size={16} className={earned ? 'text-amber-500 fill-amber-500' : 'text-amber-400'} />
                        <span className={`text-sm font-bold ${earned ? 'text-amber-700' : 'text-slate-600'}`}>
                          {earned ? `+${detailItem.edu_points} EduPoints Earned!` : `${detailItem.edu_points} EduPoints`}
                        </span>
                      </div>
                      {!earned && (
                        <p className="text-xs text-slate-500 leading-relaxed">
                          {vs === 'awaiting'
                            ? 'Points awarded only after teacher verifies your submission.'
                            : isOverdue
                              ? 'Points not awarded — work was completed after the due date.'
                              : 'Complete this task on time to earn EduPoints.'}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Attachment */}
                  {detailItem.attachment_url && (
                    <div className="border-t border-slate-100 pt-5">
                      <p className="text-xs font-semibold text-slate-500 mb-3">Attachment</p>
                      {detailItem.attachment_name === 'Link' ? (
                        <a
                          href={detailItem.attachment_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors"
                        >
                          <Link2 size={16} className="flex-shrink-0" />
                          <span className="flex-1 truncate">{detailItem.attachment_url}</span>
                          <ExternalLink size={13} className="flex-shrink-0" />
                        </a>
                      ) : detailItem.attachment_url.includes('youtube') || detailItem.attachment_url.includes('youtu.be') ? (
                        <a
                          href={detailItem.attachment_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors"
                        >
                          <ExternalLink size={16} className="flex-shrink-0" />
                          <span className="flex-1">YouTube Video</span>
                          <ExternalLink size={13} className="flex-shrink-0" />
                        </a>
                      ) : (
                        <a
                          href={detailItem.attachment_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-100 transition-colors"
                        >
                          <FileText size={16} className="text-slate-500 flex-shrink-0" />
                          <span className="flex-1 truncate">{detailItem.attachment_name || 'View Attachment'}</span>
                          <ExternalLink size={13} className="text-slate-400 flex-shrink-0" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>
    </div>
  )
}
