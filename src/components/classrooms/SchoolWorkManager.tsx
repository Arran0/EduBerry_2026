'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Circle, CircleDot, CheckCircle2,
  AlertTriangle, Clock, ChevronDown, X, BookOpen, Folder,
  FileText, ExternalLink, Link2, Upload, CalendarDays, Star, Loader2, Send, ShieldCheck,
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkItem extends ClassroomFile {
  folder: ClassroomFolder
  classroomId: string
  classroomTitle: string
}

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

// ─── Date helpers ─────────────────────────────────────────────────────────────

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

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

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CalendarSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Week nav */}
      <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
        <div className="w-7 h-7 bg-slate-200 rounded-lg" />
        <div className="w-32 h-4 bg-slate-200 rounded" />
        <div className="w-7 h-7 bg-slate-200 rounded-lg" />
      </div>
      {/* Calendar grid */}
      <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm bg-white">
        <div className="flex min-w-[560px]">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className={`flex-1 ${i < 6 ? 'border-r border-slate-100' : ''}`}>
              <div className="px-1.5 py-2.5 border-b border-slate-100 bg-slate-50 text-center space-y-1.5">
                <div className="w-6 h-2 bg-slate-200 rounded mx-auto" />
                <div className="w-5 h-4 bg-slate-200 rounded mx-auto" />
              </div>
              <div className="p-1 space-y-1 min-h-[96px]">
                {i % 3 === 0 && <div className="w-full h-8 bg-slate-100 rounded-lg" />}
                {i % 4 === 1 && <div className="w-full h-8 bg-slate-100 rounded-lg" />}
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Overdue placeholder */}
      <div className="rounded-2xl border border-red-100 bg-red-50/40 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 bg-red-200 rounded" />
          <div className="w-16 h-3.5 bg-red-200 rounded" />
        </div>
        <div className="w-full h-10 bg-red-100 rounded-xl" />
        <div className="w-3/4 h-10 bg-red-100 rounded-xl" />
      </div>
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

const LIST_LIMIT = 5

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
  const [showMoreOverdue, setShowMoreOverdue] = useState(false)
  const [showMoreUndated, setShowMoreUndated] = useState(false)
  const [detailItem, setDetailItem] = useState<WorkItem | null>(null)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

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
    const pad = (n: number) => String(n).padStart(2, '0')
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const start = new Date(now); start.setDate(start.getDate() - 14)
    const end   = new Date(now); end.setDate(end.getDate() + 90)
    const data = await fetchStudentHomeroomTasks(userId, fmt(start), fmt(end))
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

  const today   = new Date(); today.setHours(0, 0, 0, 0)
  const weekEnd = addDays(weekStart, 6)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const getFilesForDay  = (day: Date) => workItems.filter(f => f.due_date && isSameDay(parseDate(f.due_date), day))
  const getHwForDay     = (day: Date) => homeworkItems.filter(t => t.due_date && isSameDay(parseDate(t.due_date), day))

  const overdueItems = workItems.filter(f =>
    f.due_date && parseDate(f.due_date) < today && (progressMap[f.id] || 'not_done') !== 'completed'
  )
  const overdueHomework = homeworkItems.filter(t =>
    t.due_date && parseDate(t.due_date) < today && !hwIsCompleted(t.my_status, t.require_check)
  )
  const undatedItems = workItems.filter(f =>
    !f.due_date && (progressMap[f.id] || 'not_done') !== 'completed'
  )
  const undatedHomework = homeworkItems.filter(t =>
    !t.due_date && !hwIsCompleted(t.my_status, t.require_check)
  )

  const weekLabel = (() => {
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return `${fmt(weekStart)} – ${fmt(weekEnd)}`
  })()

  // ── Render ───────────────────────────────────────────────────────────────────

  if (filesLoading || hwLoading) return <CalendarSkeleton />

  if (workItems.length === 0 && homeworkItems.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 bg-cyan-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <CheckCircle2 size={24} className="text-cyan-300" />
        </div>
        <p className="text-sm text-slate-500 font-medium">All clear!</p>
        <p className="text-xs text-slate-400 mt-1">No tasks found across your classrooms.</p>
      </div>
    )
  }

  const todayHeaderBg = { background: `linear-gradient(to bottom, ${themeGradFrom}, ${themeGradTo})` }
  const todayBodyBg   = { backgroundColor: `${themeGradFrom}18` }  // ~10% opacity tint

  return (
    <div className="space-y-4">

      {/* ── Week Navigation ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
        <button
          onClick={() => { setWeekStart(addDays(weekStart, -7)); setSelectedDay(null) }}
          className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm text-slate-500 transition-all"
          aria-label="Previous week"
        >
          <ChevronLeft size={16} />
        </button>
        <p className="text-xs font-semibold text-slate-600">{weekLabel}</p>
        <button
          onClick={() => { setWeekStart(addDays(weekStart, 7)); setSelectedDay(null) }}
          className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm text-slate-500 transition-all"
          aria-label="Next week"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* ── Weekly Calendar ──────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm bg-white"
      >
        <div className="flex min-w-[560px]">
          {weekDays.map((day, i) => {
            const isToday    = isSameDay(day, today)
            const isSelected = selectedDay ? isSameDay(day, selectedDay) : false
            const dayFiles   = getFilesForDay(day)
            const dayHw      = getHwForDay(day)
            const isLastCol  = i === 6
            const isWeekend  = i >= 5

            return (
              <div
                key={day.toISOString()}
                style={{ flex: isSelected ? 2 : 1, transition: 'flex 0.3s ease', minWidth: 0 }}
                className={`flex flex-col ${!isLastCol ? 'border-r border-slate-100' : ''} ${isWeekend && !isSelected && !isToday ? 'bg-slate-50/50' : ''}`}
              >
                {/* Day header */}
                <div
                  onClick={() => setSelectedDay(prev => prev && isSameDay(prev, day) ? null : day)}
                  className="px-1.5 py-2.5 text-center border-b border-slate-100 cursor-pointer select-none transition-colors"
                  style={
                    isToday ? todayHeaderBg
                    : isSelected ? { background: 'linear-gradient(to bottom, #7c3aed, #6d28d9)' }
                    : isWeekend ? {}
                    : {}
                  }
                >
                  <p className={`text-[10px] font-bold uppercase tracking-wide ${
                    isSelected ? 'text-violet-100'
                    : isToday  ? 'text-white/80'
                    : isWeekend ? 'text-slate-400'
                    : 'text-slate-400'
                  }`}>
                    {DAY_NAMES[i]}
                  </p>
                  <p className={`text-sm font-bold leading-tight ${
                    isSelected || isToday ? 'text-white' : 'text-slate-700'
                  }`}>
                    {day.getDate()}
                  </p>
                  {/* No task count badge */}
                </div>

                {/* Day content */}
                <div
                  className={`p-1 space-y-1 flex-1 min-h-[96px] ${isSelected ? 'bg-violet-50/30' : ''}`}
                  style={isToday && !isSelected ? todayBodyBg : {}}
                >
                  {dayFiles.map(item => {
                    const status = progressMap[item.id] || 'not_done'
                    const vs     = fileVS(status)
                    const earned = fileEarned(status, item.due_date, today)
                    return (
                      <div
                        key={item.id}
                        className={`w-full text-[11px] p-1.5 rounded-lg border transition-all cursor-pointer ${VSTATUS_BORDER[vs]}`}
                      >
                        <div className="flex items-start gap-1">
                          <button
                            onClick={e => { e.stopPropagation(); handleToggle(item) }}
                            className="flex-shrink-0 mt-0.5 hover:scale-125 transition-transform"
                            title="Tap to cycle status"
                          >
                            {VSTATUS_ICON[vs]}
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setDetailItem(item) }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className={`font-medium leading-tight ${isSelected ? '' : 'truncate'} ${vs === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                              {item.title}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              {item.edu_points > 0 && <EduPointsBadge points={item.edu_points} earned={earned} />}
                              <span className={`text-slate-400 text-[10px] ${isSelected ? '' : 'truncate'}`}>
                                {item.classroomTitle}
                              </span>
                            </div>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {dayHw.map(task => {
                    const vs     = hwVS(task.my_status, task.require_check)
                    const earned = hwEarned(task.my_status, task.require_check, task.due_date, today)
                    return (
                      <div
                        key={task.id}
                        className={`w-full text-[11px] p-1.5 rounded-lg border transition-all ${VSTATUS_BORDER[vs]}`}
                      >
                        <div className="flex items-start gap-1">
                          <button
                            onClick={e => { e.stopPropagation(); cycleHwStatus(task) }}
                            className="flex-shrink-0 mt-0.5 hover:scale-125 transition-transform"
                            title="Tap to cycle status"
                            disabled={hwSavingId === task.id}
                          >
                            {hwSavingId === task.id
                              ? <Loader2 size={14} className="animate-spin text-slate-400" />
                              : VSTATUS_ICON[vs]}
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setDetailHomework(task) }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className={`font-medium leading-tight ${isSelected ? '' : 'truncate'} ${vs === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                              {task.title}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              {task.edu_points > 0 && <EduPointsBadge points={task.edu_points} earned={earned} />}
                              <span className={`text-slate-400 text-[10px] ${isSelected ? '' : 'truncate'}`}>
                                {task.classroom_title ?? task.homeroom_name}
                              </span>
                            </div>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </motion.div>

      {/* ── Selected Day Panel ───────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {selectedDay && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl border border-violet-100 bg-violet-50/40 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-violet-100">
              <div className="flex items-center gap-2">
                <CalendarDays size={14} className="text-violet-500" />
                <h3 className="text-sm font-semibold text-violet-700">
                  {selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                </h3>
                <span className="text-xs text-violet-400 font-medium">
                  {(getFilesForDay(selectedDay).length + getHwForDay(selectedDay).length) === 0
                    ? 'No tasks'
                    : `${getFilesForDay(selectedDay).length + getHwForDay(selectedDay).length} task${(getFilesForDay(selectedDay).length + getHwForDay(selectedDay).length) !== 1 ? 's' : ''}`}
                </span>
              </div>
              <button
                onClick={() => setSelectedDay(null)}
                className="p-1.5 rounded-lg text-violet-400 hover:text-violet-600 hover:bg-violet-100 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {getFilesForDay(selectedDay).length === 0 && getHwForDay(selectedDay).length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 size={24} className="text-violet-200 mx-auto mb-2" />
                <p className="text-sm text-violet-400">No tasks due on this day.</p>
              </div>
            ) : (
              <div className="px-1 py-1">
                {getFilesForDay(selectedDay).map(item => {
                  const status = progressMap[item.id] || 'not_done'
                  const vs     = fileVS(status)
                  return (
                    <div key={item.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl transition-colors hover:bg-slate-50">
                      <button onClick={() => handleToggle(item)} className="flex-shrink-0 hover:scale-110 transition-transform">
                        {VSTATUS_ICON[vs]}
                      </button>
                      <button onClick={() => setDetailItem(item)} className="flex-1 min-w-0 text-left">
                        <p className={`text-sm font-medium truncate ${vs === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.title}</p>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                          {item.edu_points > 0 && <EduPointsBadge points={item.edu_points} earned={fileEarned(status, item.due_date, today)} />}
                          <span className="truncate">{item.classroomTitle}</span>
                        </div>
                      </button>
                    </div>
                  )
                })}
                {getHwForDay(selectedDay).map(task => {
                  const vs = hwVS(task.my_status, task.require_check)
                  return (
                    <div key={task.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl transition-colors hover:bg-slate-50">
                      <button onClick={() => cycleHwStatus(task)} className="flex-shrink-0 hover:scale-110 transition-transform" disabled={hwSavingId === task.id}>
                        {hwSavingId === task.id ? <Loader2 size={14} className="animate-spin text-slate-400" /> : VSTATUS_ICON[vs]}
                      </button>
                      <button onClick={() => setDetailHomework(task)} className="flex-1 min-w-0 text-left">
                        <p className={`text-sm font-medium truncate ${vs === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{task.title}</p>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                          {task.edu_points > 0 && <EduPointsBadge points={task.edu_points} earned={hwEarned(task.my_status, task.require_check, task.due_date, today)} />}
                          <span className="truncate">{task.classroom_title ?? task.homeroom_name}</span>
                        </div>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Overdue Tasks ────────────────────────────────────────────────────── */}
      {(overdueItems.length > 0 || overdueHomework.length > 0) && (
        <div className="rounded-2xl border border-red-100 bg-red-50/40 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-red-100">
            <AlertTriangle size={14} className="text-red-500" />
            <h3 className="text-sm font-semibold text-red-700">Overdue</h3>
            <span className="text-xs font-bold text-white bg-red-400 px-2 py-0.5 rounded-full ml-0.5">
              {overdueItems.length + overdueHomework.length}
            </span>
          </div>
          <div className="px-1 py-1">
            {(showMoreOverdue ? overdueItems : overdueItems.slice(0, LIST_LIMIT)).map(item => {
              const status = progressMap[item.id] || 'not_done'
              const vs     = fileVS(status)
              return (
                <div key={item.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <button onClick={() => handleToggle(item)} className="flex-shrink-0 hover:scale-110 transition-transform">
                    {VSTATUS_ICON[vs]}
                  </button>
                  <button onClick={() => setDetailItem(item)} className="flex-1 min-w-0 text-left">
                    <p className={`text-sm font-medium truncate ${vs === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.title}</p>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                      {item.edu_points > 0 && (
                        <EduPointsBadge points={item.edu_points} earned={false} reason="Points not awarded — completed after due date" />
                      )}
                      <span className="truncate">{item.classroomTitle}</span>
                    </div>
                  </button>
                  {item.due_date && (
                    <span className="text-xs text-red-500 flex-shrink-0 font-semibold whitespace-nowrap bg-red-50 px-2 py-0.5 rounded-lg">
                      {parseDate(item.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              )
            })}
            {(showMoreOverdue ? overdueHomework : overdueHomework.slice(0, Math.max(0, LIST_LIMIT - overdueItems.length))).map(task => {
              const vs = hwVS(task.my_status, task.require_check)
              return (
                <div key={task.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <button onClick={() => cycleHwStatus(task)} className="flex-shrink-0 hover:scale-110 transition-transform" disabled={hwSavingId === task.id}>
                    {hwSavingId === task.id ? <Loader2 size={14} className="animate-spin text-slate-400" /> : VSTATUS_ICON[vs]}
                  </button>
                  <button onClick={() => setDetailHomework(task)} className="flex-1 min-w-0 text-left">
                    <p className={`text-sm font-medium truncate ${vs === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{task.title}</p>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold leading-tight bg-purple-100 text-purple-600">HW</span>
                      {task.edu_points > 0 && (
                        <EduPointsBadge points={task.edu_points} earned={false} reason="Points not awarded — completed after due date" />
                      )}
                      <span className="truncate">{task.classroom_title ?? task.homeroom_name}</span>
                    </div>
                  </button>
                  {task.due_date && (
                    <span className="text-xs text-red-500 flex-shrink-0 font-semibold whitespace-nowrap bg-red-50 px-2 py-0.5 rounded-lg">
                      {parseDate(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {(overdueItems.length + overdueHomework.length) > LIST_LIMIT && (
            <div className="px-4 pb-3">
              <button
                onClick={() => setShowMoreOverdue(v => !v)}
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 font-medium"
              >
                {showMoreOverdue ? 'Show less' : `Show ${overdueItems.length + overdueHomework.length - LIST_LIMIT} more`}
                <ChevronDown size={12} className={`transition-transform ${showMoreOverdue ? 'rotate-180' : ''}`} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Undated Tasks ────────────────────────────────────────────────────── */}
      {(undatedItems.length > 0 || undatedHomework.length > 0) && (
        <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <Clock size={14} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-600">No Due Date</h3>
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full ml-0.5">
              {undatedItems.length + undatedHomework.length}
            </span>
          </div>
          <div className="px-1 py-1">
            {(showMoreUndated ? undatedItems : undatedItems.slice(0, LIST_LIMIT)).map(item => {
              const status = progressMap[item.id] || 'not_done'
              const vs     = fileVS(status)
              return (
                <div key={item.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <button onClick={() => handleToggle(item)} className="flex-shrink-0 hover:scale-110 transition-transform">
                    {VSTATUS_ICON[vs]}
                  </button>
                  <button onClick={() => setDetailItem(item)} className="flex-1 min-w-0 text-left">
                    <p className={`text-sm font-medium truncate ${vs === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.title}</p>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                      {item.edu_points > 0 && <EduPointsBadge points={item.edu_points} earned={fileEarned(status, item.due_date, today)} />}
                      <span className="truncate">{item.classroomTitle}</span>
                    </div>
                  </button>
                </div>
              )
            })}
            {(showMoreUndated ? undatedHomework : undatedHomework.slice(0, Math.max(0, LIST_LIMIT - undatedItems.length))).map(task => {
              const vs = hwVS(task.my_status, task.require_check)
              return (
                <div key={task.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <button onClick={() => cycleHwStatus(task)} className="flex-shrink-0 hover:scale-110 transition-transform" disabled={hwSavingId === task.id}>
                    {hwSavingId === task.id ? <Loader2 size={14} className="animate-spin text-slate-400" /> : VSTATUS_ICON[vs]}
                  </button>
                  <button onClick={() => setDetailHomework(task)} className="flex-1 min-w-0 text-left">
                    <p className={`text-sm font-medium truncate ${vs === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{task.title}</p>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold leading-tight bg-purple-100 text-purple-600">HW</span>
                      {task.edu_points > 0 && <EduPointsBadge points={task.edu_points} earned={hwEarned(task.my_status, task.require_check, task.due_date, today)} />}
                      <span className="truncate">{task.classroom_title ?? task.homeroom_name}</span>
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
          {(undatedItems.length + undatedHomework.length) > LIST_LIMIT && (
            <div className="px-4 pb-3">
              <button
                onClick={() => setShowMoreUndated(v => !v)}
                className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 font-medium"
              >
                {showMoreUndated ? 'Show less' : `Show ${undatedItems.length + undatedHomework.length - LIST_LIMIT} more`}
                <ChevronDown size={12} className={`transition-transform ${showMoreUndated ? 'rotate-180' : ''}`} />
              </button>
            </div>
          )}
        </div>
      )}

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
