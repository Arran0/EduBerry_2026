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
  FileStatus, fetchAllFilesForClassroom, fetchProgressForStudent,
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

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_ICON: Record<FileStatus, React.ReactNode> = {
  not_done:  <Circle       size={14} className="text-red-400" />,
  partial:   <CircleDot    size={14} className="text-orange-500" />,
  done:      <CheckCircle2 size={14} className="text-yellow-500" />,
  completed: <CheckCircle2 size={14} className="text-emerald-500" />,
}

const STATUS_BORDER: Record<FileStatus, string> = {
  not_done:  'border-slate-200 bg-white',
  partial:   'border-orange-300 bg-orange-50',
  done:      'border-yellow-300 bg-yellow-50',
  completed: 'border-emerald-200 bg-emerald-50',
}

const STATUS_LABEL: Record<FileStatus, string> = {
  not_done:  'Not Done',
  partial:   'Partial',
  done:      'Checking',
  completed: 'Completed',
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function EduPointsBadge({ points, earned }: { points: number; earned: boolean }) {
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold leading-tight border ${
      earned ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-50 text-amber-600 border-amber-200'
    }`}>
      <Star size={8} className={earned ? 'fill-current' : ''} />
      {earned ? `+${points}` : points} EP
    </span>
  )
}

const HW_STATUS_ICON: Record<SmartboardTaskStatus, React.ReactNode> = {
  not_done: <Circle      size={14} className="text-slate-400" />,
  partial:  <CircleDot   size={14} className="text-orange-500" />,
  done:     <CheckCircle2 size={14} className="text-yellow-500" />,
  checked:  <CheckCircle2 size={14} className="text-emerald-500" />,
}

function hwStatusIcon(status: SmartboardTaskStatus, requireCheck: boolean): React.ReactNode {
  if (status === 'done' && !requireCheck) return <CheckCircle2 size={14} className="text-emerald-500" />
  return HW_STATUS_ICON[status]
}

const HW_STATUS_BORDER: Record<SmartboardTaskStatus, string> = {
  not_done: 'border-slate-200 bg-white',
  partial:  'border-orange-300 bg-orange-50',
  done:     'border-yellow-300 bg-yellow-50',
  checked:  'border-emerald-200 bg-emerald-50',
}

function hwIsCompleted(status: SmartboardTaskStatus, requireCheck: boolean): boolean {
  return status === 'checked' || (status === 'done' && !requireCheck)
}

function WorkItemRow({
  item, status, onToggle, onExpand, showDate,
}: {
  item: WorkItem
  status: FileStatus
  onToggle: () => void
  onExpand: () => void
  showDate: boolean
}) {
  return (
    <div className={`flex items-center gap-3 py-2.5 px-3 rounded-xl transition-colors hover:bg-slate-50 ${
      status === 'completed' ? 'opacity-60' : ''
    }`}>
      <button onClick={onToggle} className="flex-shrink-0 hover:scale-110 transition-transform" title="Tap to change status">
        {STATUS_ICON[status]}
      </button>
      <button onClick={onExpand} className="flex-1 min-w-0 text-left">
        <p className={`text-sm font-medium truncate ${
          status === 'completed' ? 'line-through text-slate-400' : 'text-slate-700'
        }`}>
          {item.title}
        </p>
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
          {item.edu_points > 0 && <EduPointsBadge points={item.edu_points} earned={status === 'completed'} />}
          <span className="truncate">{item.classroomTitle}</span>
          {item.folder.title && (
            <span className="truncate text-slate-300">· {item.folder.title}</span>
          )}
        </div>
      </button>
      {showDate && item.due_date && (
        <span className="text-xs text-red-500 flex-shrink-0 font-semibold whitespace-nowrap bg-red-50 px-2 py-0.5 rounded-lg">
          {parseDate(item.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SchoolWorkManagerProps {
  classrooms: ClassroomWithDetails[]
  userId: string
}

const LIST_LIMIT = 5

export default function SchoolWorkManager({ classrooms, userId }: SchoolWorkManagerProps) {
  const [weekStart, setWeekStart]       = useState(() => getWeekStart(new Date()))
  const [workItems, setWorkItems]       = useState<WorkItem[]>([])
  const [progressMap, setProgressMap]   = useState<Record<string, FileStatus>>({})
  const [filesLoading, setFilesLoading] = useState(true)
  const [hwLoading, setHwLoading]       = useState(true)
  const [showMoreOverdue, setShowMoreOverdue] = useState(false)
  const [showMoreUndated, setShowMoreUndated] = useState(false)
  const [detailItem, setDetailItem]     = useState<WorkItem | null>(null)
  const [selectedDay, setSelectedDay]   = useState<Date | null>(null)

  // Homework tasks from smartboard (homeroom + classroom tasks for this student)
  const [homeworkItems, setHomeworkItems] = useState<StudentHomeroomTask[]>([])
  const [hwSavingId, setHwSavingId]       = useState<string | null>(null)
  const [detailHomework, setDetailHomework] = useState<StudentHomeroomTask | null>(null)
  const [hwExpandedSubmit, setHwExpandedSubmit] = useState<string | null>(null)
  const [hwDraftSubmission, setHwDraftSubmission] = useState('')

  const loadFiles = useCallback(async () => {
    if (classrooms.length === 0) {
      setWorkItems([])
      setFilesLoading(false)
      return
    }
    setFilesLoading(true)

    const arrays = await Promise.all(
      classrooms.map(c =>
        fetchAllFilesForClassroom(c.id).then(files =>
          files.map(f => ({ ...f, classroomId: c.id, classroomTitle: c.title } as WorkItem))
        )
      )
    )
    const all = arrays.flat()
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
    setHomeworkItems(prev => prev.map(t => t.id === task.id ? { ...t, my_status: status, my_submission: hwDraftSubmission.trim() || null } : t))
    if (detailHomework?.id === task.id) setDetailHomework(prev => prev ? { ...prev, my_status: status, my_submission: hwDraftSubmission.trim() || null } : prev)
    setHwSavingId(null)
    setHwExpandedSubmit(null)
  }

  const handleToggle = async (item: WorkItem) => {
    const current = progressMap[item.id] || 'not_done'
    const next    = getNextStatus(current, item.requires_check)
    const ok      = await updateFileProgress(item.id, userId, next)
    if (ok) setProgressMap(prev => ({ ...prev, [item.id]: next }))
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  const today   = new Date(); today.setHours(0, 0, 0, 0)
  const weekEnd = addDays(weekStart, 6)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const getFilesForDay = (day: Date) =>
    workItems.filter(f => f.due_date && isSameDay(parseDate(f.due_date), day))

  const getHomeworkForDay = (day: Date) =>
    homeworkItems.filter(t => t.due_date && isSameDay(parseDate(t.due_date), day))

  const overdueItems = workItems.filter(f => {
    if (!f.due_date) return false
    return parseDate(f.due_date) < today && (progressMap[f.id] || 'not_done') !== 'completed'
  })

  const overdueHomework = homeworkItems.filter(t => {
    if (!t.due_date) return false
    return parseDate(t.due_date) < today && !hwIsCompleted(t.my_status, t.require_check)
  })

  const undatedItems = workItems.filter(f => {
    if (f.due_date) return false
    return (progressMap[f.id] || 'not_done') !== 'completed'
  })

  const undatedHomework = homeworkItems.filter(t => {
    if (t.due_date) return false
    return !hwIsCompleted(t.my_status, t.require_check)
  })

  const weekLabel = (() => {
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return `${fmt(weekStart)} – ${fmt(weekEnd)}`
  })()

  // ── Render ────────────────────────────────────────────────────────────────

  if (filesLoading || hwLoading) {
    return (
      <div className="text-center py-8">
        <div className="spinner mx-auto mb-2" />
        <p className="text-sm text-slate-400">Loading school work…</p>
      </div>
    )
  }

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

  const visibleOverdue = showMoreOverdue ? overdueItems : overdueItems.slice(0, LIST_LIMIT)
  const visibleUndated = showMoreUndated ? undatedItems : undatedItems.slice(0, LIST_LIMIT)

  return (
    <div className="space-y-4">

      {/* ── Week Navigation ──────────────────────────────────────────────────── */}
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

      {/* ── Weekly Calendar ───────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm bg-white">
        <div className="flex min-w-[560px]">
          {weekDays.map((day, i) => {
            const isToday    = isSameDay(day, today)
            const isSelected = selectedDay ? isSameDay(day, selectedDay) : false
            const dayFiles   = getFilesForDay(day)
            const isLastCol  = i === 6
            const isWeekend  = i >= 5

            return (
              <div
                key={day.toISOString()}
                style={{ flex: isSelected ? 2 : 1, transition: 'flex 0.3s ease', minWidth: 0 }}
                className={`flex flex-col ${!isLastCol ? 'border-r border-slate-100' : ''} ${isWeekend && !isSelected ? 'bg-slate-50/50' : ''}`}
              >
                {/* Day header — click to select/deselect */}
                <div
                  onClick={() => setSelectedDay(prev => prev && isSameDay(prev, day) ? null : day)}
                  className={`px-1.5 py-2.5 text-center border-b border-slate-100 cursor-pointer select-none transition-colors ${
                    isSelected
                      ? 'bg-gradient-to-b from-violet-500 to-violet-600'
                      : isToday
                        ? 'bg-gradient-to-b from-cyan-500 to-cyan-600'
                        : isWeekend ? 'bg-slate-100/60 hover:bg-slate-200/60' : 'bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <p className={`text-[10px] font-bold uppercase tracking-wide ${
                    isSelected ? 'text-violet-100' : isToday ? 'text-cyan-100' : 'text-slate-400'
                  }`}>
                    {DAY_NAMES[i]}
                  </p>
                  <p className={`text-sm font-bold leading-tight ${
                    isSelected || isToday ? 'text-white' : 'text-slate-700'
                  }`}>
                    {day.getDate()}
                  </p>
                  {(dayFiles.length + getHomeworkForDay(day).length) > 0 && (
                    <span className={`text-[9px] font-bold leading-none mt-0.5 inline-block px-1 rounded ${
                      isSelected ? 'text-violet-200' : isToday ? 'text-cyan-200' : 'text-slate-400'
                    }`}>
                      {dayFiles.length + getHomeworkForDay(day).length}
                    </span>
                  )}
                </div>

                {/* Files and homework for this day */}
                <div className={`p-1 space-y-1 flex-1 min-h-[96px] ${isSelected ? 'bg-violet-50/30' : isToday ? 'bg-cyan-50/30' : ''}`}>
                  {dayFiles.map(item => {
                    const status = progressMap[item.id] || 'not_done'
                    return (
                      <div
                        key={item.id}
                        className={`w-full text-[11px] p-1.5 rounded-lg border transition-all cursor-pointer ${STATUS_BORDER[status]}`}
                      >
                        <div className="flex items-start gap-1">
                          <button
                            onClick={e => { e.stopPropagation(); handleToggle(item) }}
                            className="flex-shrink-0 mt-0.5 hover:scale-125 transition-transform"
                            title="Tap to cycle status"
                          >
                            {STATUS_ICON[status]}
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setDetailItem(item) }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className={`font-medium leading-tight ${
                              isSelected ? '' : 'truncate'
                            } ${status === 'completed' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                              {item.title}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              {item.edu_points > 0 && <EduPointsBadge points={item.edu_points} earned={status === 'completed'} />}
                              <span className={`text-slate-400 text-[10px] ${isSelected ? '' : 'truncate'}`}>
                                {item.classroomTitle}
                              </span>
                            </div>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {getHomeworkForDay(day).map(task => {
                    const completed = hwIsCompleted(task.my_status, task.require_check)
                    return (
                      <div
                        key={task.id}
                        className={`w-full text-[11px] p-1.5 rounded-lg border transition-all ${HW_STATUS_BORDER[task.my_status]}`}
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
                              : hwStatusIcon(task.my_status, task.require_check)}
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setDetailHomework(task) }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className={`font-medium leading-tight ${isSelected ? '' : 'truncate'} ${completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                              {task.title}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              {task.edu_points > 0 && <EduPointsBadge points={task.edu_points} earned={completed} />}
                              {(task.classroom_title || task.homeroom_name) && (
                                <span className={`text-slate-400 text-[10px] ${isSelected ? '' : 'truncate'}`}>
                                  {task.classroom_title ?? task.homeroom_name}
                                </span>
                              )}
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
      </div>

      {/* ── Selected Day Task Panel ───────────────────────────────────────────── */}
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
                  {(getFilesForDay(selectedDay).length + getHomeworkForDay(selectedDay).length) === 0
                    ? 'No tasks'
                    : `${getFilesForDay(selectedDay).length + getHomeworkForDay(selectedDay).length} task${getFilesForDay(selectedDay).length + getHomeworkForDay(selectedDay).length !== 1 ? 's' : ''}`}
                </span>
              </div>
              <button
                onClick={() => setSelectedDay(null)}
                className="p-1.5 rounded-lg text-violet-400 hover:text-violet-600 hover:bg-violet-100 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {getFilesForDay(selectedDay).length === 0 && getHomeworkForDay(selectedDay).length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 size={24} className="text-violet-200 mx-auto mb-2" />
                <p className="text-sm text-violet-400">No tasks due on this day.</p>
              </div>
            ) : (
              <div className="px-1 py-1">
                {getFilesForDay(selectedDay).map(item => (
                  <WorkItemRow
                    key={item.id}
                    item={item}
                    status={progressMap[item.id] || 'not_done'}
                    onToggle={() => handleToggle(item)}
                    onExpand={() => setDetailItem(item)}
                    showDate={false}
                  />
                ))}
                {getHomeworkForDay(selectedDay).map(task => {
                  const completed = hwIsCompleted(task.my_status, task.require_check)
                  return (
                    <div key={task.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl transition-colors hover:bg-slate-50">
                      <button onClick={() => cycleHwStatus(task)} className="flex-shrink-0 hover:scale-110 transition-transform" disabled={hwSavingId === task.id}>
                        {hwSavingId === task.id ? <Loader2 size={14} className="animate-spin text-slate-400" /> : hwStatusIcon(task.my_status, task.require_check)}
                      </button>
                      <button onClick={() => setDetailHomework(task)} className="flex-1 min-w-0 text-left">
                        <p className={`text-sm font-medium truncate ${completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>{task.title}</p>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                          {task.edu_points > 0 && <EduPointsBadge points={task.edu_points} earned={completed} />}
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

      {/* ── Overdue Tasks ─────────────────────────────────────────────────────── */}
      {(overdueItems.length > 0 || overdueHomework.length > 0) && (
        <div className="rounded-2xl border border-red-100 bg-red-50/40 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-red-100">
            <AlertTriangle size={14} className="text-red-500" />
            <h3 className="text-sm font-semibold text-red-700">Overdue</h3>
            <span className="text-xs font-bold text-white bg-red-400 px-2 py-0.5 rounded-full ml-0.5">{overdueItems.length + overdueHomework.length}</span>
          </div>
          <div className="px-1 py-1">
            {(showMoreOverdue ? overdueItems : overdueItems.slice(0, LIST_LIMIT)).map(item => (
              <WorkItemRow
                key={item.id}
                item={item}
                status={progressMap[item.id] || 'not_done'}
                onToggle={() => handleToggle(item)}
                onExpand={() => setDetailItem(item)}
                showDate
              />
            ))}
            {(showMoreOverdue ? overdueHomework : overdueHomework.slice(0, Math.max(0, LIST_LIMIT - overdueItems.length))).map(task => {
              const completed = hwIsCompleted(task.my_status, task.require_check)
              return (
                <div key={task.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <button onClick={() => cycleHwStatus(task)} className="flex-shrink-0 hover:scale-110 transition-transform" disabled={hwSavingId === task.id}>
                    {hwSavingId === task.id ? <Loader2 size={14} className="animate-spin text-slate-400" /> : hwStatusIcon(task.my_status, task.require_check)}
                  </button>
                  <button onClick={() => setDetailHomework(task)} className="flex-1 min-w-0 text-left">
                    <p className={`text-sm font-medium truncate ${completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>{task.title}</p>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold leading-tight bg-purple-100 text-purple-600">HW</span>
                      {task.edu_points > 0 && <EduPointsBadge points={task.edu_points} earned={completed} />}
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

      {/* ── Undated Tasks ─────────────────────────────────────────────────────── */}
      {(undatedItems.length > 0 || undatedHomework.length > 0) && (
        <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <Clock size={14} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-600">No Due Date</h3>
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full ml-0.5">{undatedItems.length + undatedHomework.length}</span>
          </div>
          <div className="px-1 py-1">
            {(showMoreUndated ? undatedItems : undatedItems.slice(0, LIST_LIMIT)).map(item => (
              <WorkItemRow
                key={item.id}
                item={item}
                status={progressMap[item.id] || 'not_done'}
                onToggle={() => handleToggle(item)}
                onExpand={() => setDetailItem(item)}
                showDate={false}
              />
            ))}
            {(showMoreUndated ? undatedHomework : undatedHomework.slice(0, Math.max(0, LIST_LIMIT - undatedItems.length))).map(task => {
              const completed = hwIsCompleted(task.my_status, task.require_check)
              return (
                <div key={task.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <button onClick={() => cycleHwStatus(task)} className="flex-shrink-0 hover:scale-110 transition-transform" disabled={hwSavingId === task.id}>
                    {hwSavingId === task.id ? <Loader2 size={14} className="animate-spin text-slate-400" /> : hwStatusIcon(task.my_status, task.require_check)}
                  </button>
                  <button onClick={() => setDetailHomework(task)} className="flex-1 min-w-0 text-left">
                    <p className={`text-sm font-medium truncate ${completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>{task.title}</p>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold leading-tight bg-purple-100 text-purple-600">HW</span>
                      {task.edu_points > 0 && <EduPointsBadge points={task.edu_points} earned={completed} />}
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

      {/* ── Homework Detail Modal ─────────────────────────────────────────────── */}
      {detailHomework && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => { setDetailHomework(null); setHwExpandedSubmit(null) }}
        >
          <div
            className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <button
                onClick={() => cycleHwStatus(detailHomework)}
                disabled={hwSavingId === detailHomework.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 text-sm font-semibold transition-all active:scale-95 ${HW_STATUS_BORDER[detailHomework.my_status]}`}
              >
                {hwSavingId === detailHomework.id
                  ? <Loader2 size={14} className="animate-spin" />
                  : hwStatusIcon(detailHomework.my_status, detailHomework.require_check)}
                <span>
                  {detailHomework.my_status === 'done' && detailHomework.require_check
                    ? 'Awaiting verification'
                    : hwIsCompleted(detailHomework.my_status, detailHomework.require_check)
                      ? 'Completed'
                      : detailHomework.my_status === 'partial' ? 'Partial' : 'Not Done'}
                </span>
              </button>
              <button
                onClick={() => { setDetailHomework(null); setHwExpandedSubmit(null) }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <h2 className={`text-lg font-bold mb-3 leading-snug ${
              hwIsCompleted(detailHomework.my_status, detailHomework.require_check) ? 'line-through text-slate-400' : 'text-slate-800'
            }`}>
              {detailHomework.title}
            </h2>

            {detailHomework.description && (
              <p className="text-sm text-slate-600 leading-relaxed mb-4 p-3 bg-slate-50 rounded-xl">{detailHomework.description}</p>
            )}

            <div className="space-y-2 mb-4">
              {(detailHomework.classroom_title || detailHomework.homeroom_name) && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <BookOpen size={14} className="text-purple-500 flex-shrink-0" />
                  <span>{detailHomework.classroom_title ?? detailHomework.homeroom_name}</span>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-600">Homework</span>
                {detailHomework.due_date && (
                  <span className="text-xs text-red-500 font-semibold bg-red-50 px-2 py-0.5 rounded-lg">
                    Due {parseDate(detailHomework.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                )}
                {detailHomework.require_check && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1">
                    <ShieldCheck size={10} /> Needs verification
                  </span>
                )}
                {detailHomework.requires_submission && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium flex items-center gap-1">
                    <Send size={10} /> Submission required
                  </span>
                )}
              </div>
            </div>

            {detailHomework.requires_submission && (
              <div className="pt-3 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 mb-2">
                  {detailHomework.my_submission ? 'Your submission' : 'Submit your work'}
                </p>
                {hwExpandedSubmit === detailHomework.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={hwDraftSubmission}
                      onChange={e => setHwDraftSubmission(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveHwSubmission(detailHomework) } }}
                      placeholder="Add a note or link…"
                      className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-purple-400"
                    />
                    <button
                      onClick={() => saveHwSubmission(detailHomework)}
                      disabled={hwSavingId === detailHomework.id}
                      className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                    >
                      {hwSavingId === detailHomework.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Submit
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setHwExpandedSubmit(detailHomework.id); setHwDraftSubmission(detailHomework.my_submission ?? '') }}
                    className="text-sm text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
                  >
                    {detailHomework.my_submission ? `"${detailHomework.my_submission}" — Edit` : '+ Add submission'}
                  </button>
                )}
              </div>
            )}

            {detailHomework.attachment_url && (
              <div className="pt-3 border-t border-slate-100 mt-4">
                <a
                  href={detailHomework.attachment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-100 transition-colors"
                >
                  <FileText size={14} />
                  <span className="flex-1 truncate">{detailHomework.attachment_name || 'Attachment'}</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Work Item Detail Modal ────────────────────────────────────────────── */}
      {detailItem && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setDetailItem(null)}
        >
          <div
            className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Status badge */}
            <div className="flex items-center justify-between mb-5">
              <button
                onClick={() => { handleToggle(detailItem); setDetailItem(null) }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 text-sm font-semibold transition-all active:scale-95 ${STATUS_BORDER[progressMap[detailItem.id] || 'not_done']}`}
              >
                {STATUS_ICON[progressMap[detailItem.id] || 'not_done']}
                <span className="capitalize">{STATUS_LABEL[progressMap[detailItem.id] || 'not_done']}</span>
              </button>
              <button
                onClick={() => setDetailItem(null)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Title */}
            <h2 className={`text-lg font-bold mb-3 leading-snug ${
              (progressMap[detailItem.id] || 'not_done') === 'completed'
                ? 'line-through text-slate-400'
                : 'text-slate-800'
            }`}>
              {detailItem.title}
            </h2>

            {/* Description */}
            {detailItem.description && (
              <p className="text-sm text-slate-600 leading-relaxed mb-4 p-3 bg-slate-50 rounded-xl">{detailItem.description}</p>
            )}

            {/* Meta */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <BookOpen size={14} className="text-cyan-500 flex-shrink-0" />
                <span>{detailItem.classroomTitle}</span>
              </div>
              {detailItem.folder.title && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Folder size={14} className="text-slate-400 flex-shrink-0" />
                  <span>{detailItem.folder.title}</span>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {detailItem.due_date && (
                  <span className="text-xs text-red-500 font-semibold bg-red-50 px-2 py-0.5 rounded-lg">
                    Due {parseDate(detailItem.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                )}
                {detailItem.requires_submission && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium flex items-center gap-1">
                    <Upload size={10} /> Submission Required
                  </span>
                )}
              </div>
            </div>

            {/* Attachment */}
            {detailItem.attachment_url && (
              <div className="pt-3 border-t border-slate-100">
                {detailItem.attachment_name === 'Link' ? (
                  <a
                    href={detailItem.attachment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors"
                  >
                    <Link2 size={14} />
                    <span className="flex-1 truncate">{detailItem.attachment_url}</span>
                    <ExternalLink size={12} />
                  </a>
                ) : detailItem.attachment_url.includes('youtube') || detailItem.attachment_url.includes('youtu.be') ? (
                  <a
                    href={detailItem.attachment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors"
                  >
                    <ExternalLink size={14} />
                    <span className="flex-1 truncate">YouTube Video</span>
                  </a>
                ) : (
                  <a
                    href={detailItem.attachment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-100 transition-colors"
                  >
                    <FileText size={14} />
                    <span className="flex-1 truncate">{detailItem.attachment_name || 'Attachment'}</span>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
