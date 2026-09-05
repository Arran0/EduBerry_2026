'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  Plus, Loader2, Star, ShieldCheck, Send, ChevronLeft, ChevronRight,
  Users, FileText, ExternalLink, Link2, BookOpen, Paperclip, Circle,
  CircleDot, CheckCircle2, CalendarDays, Upload, Youtube, Clock,
} from 'lucide-react'
import { UserRole } from '@/lib/supabase'
import {
  ClassroomWithDetails, ClassroomFile, ClassroomFolder,
  FileStatus, FileProgress,
  fetchAllFilesForClassroom, fetchProgressForStudent,
  fetchFileProgress, updateFileProgress,
} from '@/lib/classrooms'
import SmartboardHomeworkForm from '@/components/smartboard/SmartboardHomeworkForm'
import ClassroomFileEditForm from '@/components/classrooms/ClassroomFileEditForm'
import Avatar from '@/components/Avatar'
import ModalShell from '@/components/ui/ModalShell'
import {
  SmartboardTask,
  SmartboardTaskStatus,
  fetchClassroomHomeworkTasks,
  fetchStudentCompletionsForTasks,
  upsertTaskCompletion,
  getNextSmartboardStatus,
} from '@/lib/smartboard'

// ── Types ─────────────────────────────────────────────────────────────────────

type WorkFile = ClassroomFile & { folder: ClassroomFolder }

// ── Date helpers ──────────────────────────────────────────────────────────────

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

function formatDate(date: Date): string {
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// ── Status helpers ────────────────────────────────────────────────────────────

const HW_STATUS_BORDER: Record<SmartboardTaskStatus, string> = {
  not_done: 'border-slate-200 bg-white',
  partial:  'border-orange-300 bg-orange-50',
  done:     'border-yellow-300 bg-yellow-50',
  checked:  'border-emerald-200 bg-emerald-50',
}

const CW_STATUS_BORDER: Record<FileStatus, string> = {
  not_done:  'border-slate-200 bg-white',
  partial:   'border-orange-300 bg-orange-50',
  done:      'border-yellow-300 bg-yellow-50',
  completed: 'border-emerald-200 bg-emerald-50',
}

function hwStatusIcon(status: SmartboardTaskStatus, requireCheck: boolean): React.ReactNode {
  if (status === 'done' && !requireCheck) return <CheckCircle2 size={14} className="text-emerald-500" />
  const icons: Record<SmartboardTaskStatus, React.ReactNode> = {
    not_done: <Circle      size={14} className="text-slate-400" />,
    partial:  <CircleDot   size={14} className="text-orange-500" />,
    done:     <CheckCircle2 size={14} className="text-yellow-500" />,
    checked:  <CheckCircle2 size={14} className="text-emerald-500" />,
  }
  return icons[status]
}

function cwStatusIcon(status: FileStatus): React.ReactNode {
  const icons: Record<FileStatus, React.ReactNode> = {
    not_done:  <Circle      size={14} className="text-slate-400" />,
    partial:   <CircleDot   size={14} className="text-orange-500" />,
    done:      <CheckCircle2 size={14} className="text-yellow-500" />,
    completed: <CheckCircle2 size={14} className="text-emerald-500" />,
  }
  return icons[status]
}

function hwIsCompleted(status: SmartboardTaskStatus, requireCheck: boolean): boolean {
  return status === 'checked' || (status === 'done' && !requireCheck)
}

function cwGetNextStatus(current: FileStatus, requiresCheck: boolean): FileStatus {
  const cycle: FileStatus[] = requiresCheck
    ? ['not_done', 'partial', 'done', 'completed']
    : ['not_done', 'partial', 'completed']
  return cycle[(cycle.indexOf(current) + 1) % cycle.length]
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface HomeworkTabProps {
  classroomId: string
  userId: string
  userRole: UserRole
  classroom: ClassroomWithDetails
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function HomeworkTab({ classroomId, userId, userRole }: HomeworkTabProps) {
  const isStudent    = userRole === 'student'
  const isSmartboard = userRole === 'smartboard'
  const canManage    = !isStudent

  // ── Data state ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks]     = useState<SmartboardTask[]>([])
  const [files, setFiles]     = useState<WorkFile[]>([])

  // Student completions
  const [hwCompletionMap, setHwCompletionMap] = useState<Record<string, { status: SmartboardTaskStatus; submission: string | null }>>({})
  const [cwProgressMap, setCwProgressMap]     = useState<Record<string, FileStatus>>({})
  const [savingHwId, setSavingHwId]     = useState<string | null>(null)
  const [savingCwId, setSavingCwId]     = useState<string | null>(null)
  const [submitOpenId, setSubmitOpenId] = useState<string | null>(null)
  const [submitDraft, setSubmitDraft]   = useState('')

  // ── UI state ───────────────────────────────────────────────────────────────
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [showForm, setShowForm]   = useState(false)
  const [newHwDate, setNewHwDate] = useState('')
  // The day column shown expanded (2x width). Defaults to today; clicking any
  // day header expands that day instead.
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  // Modals
  const [detailTask, setDetailTask]     = useState<SmartboardTask | null>(null)
  const [editTask, setEditTask]         = useState<SmartboardTask | null>(null)
  const [detailFile, setDetailFile]     = useState<WorkFile | null>(null)
  const [editClasswork, setEditClasswork] = useState<WorkFile | null>(null)

  // File tracking modal (staff)
  const [trackingFileId, setTrackingFileId]       = useState<string | null>(null)
  const [fileTrackingData, setFileTrackingData]   = useState<FileProgress[]>([])
  const [loadingTracking, setLoadingTracking]     = useState(false)

  // ── Load data ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    const [hwData, cwData] = await Promise.all([
      fetchClassroomHomeworkTasks(classroomId, 200, 0),
      fetchAllFilesForClassroom(classroomId),
    ])
    setTasks(hwData)
    setFiles(cwData)

    if (isStudent) {
      const [hwComp, cwProg] = await Promise.all([
        hwData.length > 0 ? fetchStudentCompletionsForTasks(hwData.map(t => t.id), userId) : Promise.resolve({}),
        cwData.length > 0 ? fetchProgressForStudent(userId, cwData.map(f => f.id)) : Promise.resolve([]),
      ])
      setHwCompletionMap(hwComp)
      const cwMap: Record<string, FileStatus> = {}
      for (const p of cwProg) cwMap[p.file_id] = p.status
      setCwProgressMap(cwMap)
    }

    setLoading(false)
  }, [classroomId, userId, isStudent])

  useEffect(() => { load() }, [load])

  // ── File tracking ──────────────────────────────────────────────────────────
  const openFileTracking = async (fileId: string) => {
    setTrackingFileId(fileId)
    setLoadingTracking(true)
    const data = await fetchFileProgress(fileId)
    setFileTrackingData(data)
    setLoadingTracking(false)
  }

  // ── Homework status ────────────────────────────────────────────────────────
  const cycleHwStatus = async (task: SmartboardTask) => {
    const current = hwCompletionMap[task.id]?.status ?? 'not_done'
    const next = getNextSmartboardStatus(current, false, task.require_check)
    if (next === current) return
    if (next === 'done' && task.requires_submission && !hwCompletionMap[task.id]?.submission) {
      setSubmitOpenId(task.id)
      setSubmitDraft(hwCompletionMap[task.id]?.submission ?? '')
      return
    }
    setHwCompletionMap(prev => ({ ...prev, [task.id]: { status: next, submission: prev[task.id]?.submission ?? null } }))
    setSavingHwId(task.id)
    await upsertTaskCompletion(task.id, userId, next)
    setSavingHwId(null)
  }

  const saveHwSubmission = async (task: SmartboardTask) => {
    setSavingHwId(task.id)
    const current = hwCompletionMap[task.id]?.status ?? 'not_done'
    const status: SmartboardTaskStatus = current === 'not_done' ? 'done' : current
    await upsertTaskCompletion(task.id, userId, status, submitDraft.trim() || null)
    setHwCompletionMap(prev => ({ ...prev, [task.id]: { status, submission: submitDraft.trim() || null } }))
    setSavingHwId(null)
    setSubmitOpenId(null)
    if (detailTask?.id === task.id) setDetailTask(prev => prev ? { ...prev } : null)
  }

  // ── Classwork status ───────────────────────────────────────────────────────
  const cycleCwStatus = async (file: WorkFile) => {
    const current = cwProgressMap[file.id] ?? 'not_done'
    const next = cwGetNextStatus(current, file.requires_check)
    const ok = await updateFileProgress(file.id, userId, next)
    if (ok) setCwProgressMap(prev => ({ ...prev, [file.id]: next }))
    setSavingCwId(null)
  }

  // ── Calendar helpers ───────────────────────────────────────────────────────
  const today   = new Date(); today.setHours(0, 0, 0, 0)
  const weekEnd = addDays(weekStart, 6)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const hwForDay  = (day: Date) => tasks.filter(t => t.due_date && isSameDay(parseDate(t.due_date), day))
  const cwForDay  = (day: Date) => files.filter(f => f.due_date && isSameDay(parseDate(f.due_date), day))

  const undatedHw = tasks.filter(t => !t.due_date)
  const undatedCw = files.filter(f => !f.due_date)

  const weekLabel = (() => {
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return `${fmt(weekStart)} – ${fmt(weekEnd)}`
  })()

  // The agenda always has a concrete day; the picker defaults to today when the
  // shown week contains it, otherwise to the first day of that week.
  const activeDay = selectedDay ?? (
    today >= weekStart && today <= weekEnd ? today : weekStart
  )
  const agendaHw = hwForDay(activeDay)
  const agendaCw = cwForDay(activeDay)
  const agendaCount = agendaHw.length + agendaCw.length
  const weekCount = weekDays.reduce((n, d) => n + hwForDay(d).length + cwForDay(d).length, 0)

  const goToToday = () => { setWeekStart(getWeekStart(new Date())); setSelectedDay(today) }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3 px-2 sm:px-0">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="h-4 w-2/3 bg-slate-100 rounded animate-pulse" />
            <div className="h-3 w-1/3 bg-slate-100 rounded animate-pulse mt-2.5" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-3 sm:px-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-2 rounded-xl bg-violet-100">
            <CalendarDays size={16} className="text-violet-600" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-800 text-sm">Classroom Calendar</h2>
            <p className="text-xs text-slate-500 truncate">
              {tasks.length} task{tasks.length !== 1 ? 's' : ''} · {files.length} classwork item{files.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={() => { setNewHwDate(''); setShowForm(v => !v); setDetailTask(null); setDetailFile(null) }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold text-white transition-all shadow-lg shadow-purple-600/25 bg-purple-600 hover:bg-purple-700 active:scale-95 flex-shrink-0"
          >
            <Plus size={13} /> New Homework
          </button>
        )}
      </div>

      {/* ── New homework popup ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {canManage && showForm && (
          <ModalShell onClose={() => { setShowForm(false); setNewHwDate('') }} bare>
            <SmartboardHomeworkForm
              createdBy={userId}
              classroomId={classroomId}
              defaultDueDate={newHwDate}
              onCancel={() => { setShowForm(false); setNewHwDate('') }}
              onCreated={(task) => { setTasks(prev => [task, ...prev]); setShowForm(false); setNewHwDate('') }}
            />
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ── Calendar: compact week picker + full-width schedule ───────────────
           Chips inside seven narrow grid cells truncated every title, so the
           week is now a date picker and the day's items are listed below it at
           full width — nothing gets cut off. Runs edge-to-edge on phones. ── */}
      <div className="bg-white border-y border-slate-200 sm:border sm:rounded-2xl sm:shadow-sm overflow-hidden">

        {/* Week navigation */}
        <div className="flex items-center gap-2 px-2 py-2.5 bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600">
          <button
            onClick={() => { setWeekStart(addDays(weekStart, -7)); setSelectedDay(null) }}
            className="p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/15 active:scale-90 transition-all flex-shrink-0"
            aria-label="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={goToToday}
            className="flex-1 min-w-0 text-center leading-tight"
            title="Jump to this week"
          >
            <span className="block text-sm font-bold text-white truncate">{weekLabel}</span>
            <span className="block text-[10px] font-medium text-white/80">
              {weekCount} item{weekCount !== 1 ? 's' : ''} this week · tap for today
            </span>
          </button>
          <button
            onClick={() => { setWeekStart(addDays(weekStart, 7)); setSelectedDay(null) }}
            className="p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/15 active:scale-90 transition-all flex-shrink-0"
            aria-label="Next week"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Day picker */}
        <div className="grid grid-cols-7 gap-1 px-1.5 py-2 bg-slate-50 border-b border-slate-200">
          {weekDays.map((day, i) => {
            const isToday    = isSameDay(day, today)
            const isActive   = isSameDay(day, activeDay)
            const total      = hwForDay(day).length + cwForDay(day).length
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                className={`flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-all active:scale-95 ${
                  isActive
                    ? 'bg-gradient-to-b from-violet-500 to-purple-600 text-white shadow-md shadow-purple-600/25'
                    : isToday
                      ? 'bg-white ring-1 ring-violet-300 text-violet-700 hover:bg-violet-50'
                      : 'text-slate-700 hover:bg-white'
                }`}
              >
                <span className={`text-[9px] font-bold uppercase tracking-wide ${isActive ? 'text-white/80' : 'text-slate-500'}`}>
                  {DAY_NAMES[i]}
                </span>
                <span className="text-[15px] font-bold leading-none">{day.getDate()}</span>
                <span className="h-1.5 flex items-center gap-0.5">
                  {total > 0 && Array.from({ length: Math.min(total, 3) }).map((_, d) => (
                    <span
                      key={d}
                      className={`w-1 h-1 rounded-full ${isActive ? 'bg-white/90' : 'bg-violet-400'}`}
                    />
                  ))}
                </span>
              </button>
            )
          })}
        </div>

        {/* Selected day heading */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 truncate">
            {activeDay.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
            {isSameDay(activeDay, today) && (
              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-violet-600">Today</span>
            )}
          </h3>
          <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 rounded-full px-2 py-0.5 flex-shrink-0">
            {agendaCount} scheduled
          </span>
        </div>

        {/* Schedule list — full width rows, titles wrap instead of truncating */}
        <div className="divide-y divide-slate-100">
          {agendaCount === 0 && (
            <p className="px-4 py-7 text-center text-sm text-slate-500">Nothing scheduled for this day.</p>
          )}

          {agendaHw.map(task => {
            const status    = hwCompletionMap[task.id]?.status ?? 'not_done'
            const completed = hwIsCompleted(status, task.require_check)
            return (
              <div
                key={task.id}
                onClick={() => canManage ? setEditTask(task) : setDetailTask(task)}
                className="flex items-start gap-3 px-3 sm:px-4 py-3 cursor-pointer hover:bg-slate-50 active:bg-slate-100 transition-colors"
              >
                <span className="self-stretch w-1 rounded-full bg-purple-400 flex-shrink-0" />
                {isStudent && (
                  <button
                    onClick={e => { e.stopPropagation(); cycleHwStatus(task) }}
                    className="flex-shrink-0 mt-0.5 hover:scale-110 transition-transform"
                    disabled={savingHwId === task.id}
                    aria-label="Change status"
                  >
                    {savingHwId === task.id
                      ? <Loader2 size={16} className="animate-spin text-slate-500" />
                      : hwStatusIcon(status, task.require_check)}
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold leading-snug ${completed ? 'line-through text-slate-500' : 'text-slate-800'}`}>
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
                    {task.edu_points > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700">
                        <Star size={10} /> {task.edu_points} EP
                      </span>
                    )}
                    {task.require_check && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700">
                        <ShieldCheck size={10} /> Verified
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight size={15} className="text-slate-400 flex-shrink-0 mt-1" />
              </div>
            )
          })}

          {agendaCw.map(file => {
            const status    = cwProgressMap[file.id] ?? 'not_done'
            const completed = status === 'completed'
            return (
              <div
                key={file.id}
                onClick={() => canManage ? setEditClasswork(file) : setDetailFile(file)}
                className="flex items-start gap-3 px-3 sm:px-4 py-3 cursor-pointer hover:bg-slate-50 active:bg-slate-100 transition-colors"
              >
                <span className="self-stretch w-1 rounded-full bg-cyan-400 flex-shrink-0" />
                {isStudent && (
                  <button
                    onClick={e => { e.stopPropagation(); setSavingCwId(file.id); cycleCwStatus(file) }}
                    className="flex-shrink-0 mt-0.5 hover:scale-110 transition-transform"
                    disabled={savingCwId === file.id}
                    aria-label="Change status"
                  >
                    {savingCwId === file.id
                      ? <Loader2 size={16} className="animate-spin text-slate-500" />
                      : cwStatusIcon(status)}
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold leading-snug ${completed ? 'line-through text-slate-500' : 'text-slate-800'}`}>
                    {file.title}
                  </p>
                  {file.description && (
                    <p className="text-xs text-slate-600 leading-snug line-clamp-2 mt-0.5">{file.description}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-100 text-cyan-700">CLASSWORK</span>
                    <span className="text-[10px] text-slate-600 truncate max-w-[10rem]">{file.folder.title}</span>
                    {file.edu_points > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700">
                        <Star size={10} /> {file.edu_points} EP
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight size={15} className="text-slate-400 flex-shrink-0 mt-1" />
              </div>
            )
          })}
        </div>

        {/* Quick add for the selected day (staff only) */}
        {canManage && (
          <button
            onClick={() => { setNewHwDate(formatDate(activeDay)); setShowForm(true) }}
            className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-semibold text-violet-700 bg-violet-50/60 hover:bg-violet-100 border-t border-slate-100 transition-colors"
          >
            <Plus size={14} /> Add homework for {activeDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </button>
        )}
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {tasks.length === 0 && files.length === 0 && (
        <div className="bg-white border-y border-slate-200 sm:border sm:rounded-2xl p-10 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 bg-violet-50">
            <CalendarDays size={26} className="text-violet-400" />
          </div>
          <p className="text-slate-700 font-semibold text-sm mb-1">No items yet</p>
          <p className="text-slate-600 text-xs">
            {canManage
              ? "Create homework above — it appears on every student's calendar."
              : 'No tasks have been set yet.'}
          </p>
        </div>
      )}

      {/* ── Undated items ────────────────────────────────────────────────────── */}
      {(undatedHw.length > 0 || undatedCw.length > 0) && (
        <div className="bg-white border-y border-slate-200 sm:border sm:rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 sm:px-4 py-3 border-b border-slate-100">
            <BookOpen size={13} className="text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">No Due Date</h3>
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full ml-0.5">
              {undatedHw.length + undatedCw.length}
            </span>
          </div>
          <div className="px-1 py-1 divide-y divide-slate-50">
            {undatedHw.map(task => {
              const status    = hwCompletionMap[task.id]?.status ?? 'not_done'
              const completed = hwIsCompleted(status, task.require_check)
              return (
                <div
                  key={task.id}
                  onClick={() => canManage ? setEditTask(task) : setDetailTask(task)}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  {isStudent && (
                    <button
                      onClick={e => { e.stopPropagation(); cycleHwStatus(task) }}
                      className="flex-shrink-0 hover:scale-110 transition-transform"
                      disabled={savingHwId === task.id}
                    >
                      {savingHwId === task.id
                        ? <Loader2 size={14} className="animate-spin text-slate-500" />
                        : hwStatusIcon(status, task.require_check)}
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold leading-snug ${completed ? 'line-through text-slate-500' : 'text-slate-800'}`}>
                      {task.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700">HW</span>
                      {task.edu_points > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700">
                          <Star size={9} /> {task.edu_points} EP
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {undatedCw.map(file => {
              const status    = cwProgressMap[file.id] ?? 'not_done'
              const completed = status === 'completed'
              return (
                <div
                  key={file.id}
                  onClick={() => canManage ? setEditClasswork(file) : setDetailFile(file)}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  {isStudent && (
                    <button
                      onClick={e => { e.stopPropagation(); setSavingCwId(file.id); cycleCwStatus(file) }}
                      className="flex-shrink-0 hover:scale-110 transition-transform"
                      disabled={savingCwId === file.id}
                    >
                      {savingCwId === file.id
                        ? <Loader2 size={14} className="animate-spin text-slate-500" />
                        : cwStatusIcon(status)}
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold leading-snug ${completed ? 'line-through text-slate-500' : 'text-slate-800'}`}>
                      {file.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-100 text-cyan-700">CW</span>
                      <span className="text-[10px] text-slate-600 truncate">{file.folder.title}</span>
                      {file.edu_points > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700">
                          <Star size={9} /> {file.edu_points} EP
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Edit homework modal (staff/smartboard) ───────────────────────────── */}
      <AnimatePresence>
        {editTask && (
          <ModalShell onClose={() => setEditTask(null)} size="lg" bare>
            <SmartboardHomeworkForm
              createdBy={userId}
              classroomId={classroomId}
              task={editTask}
              onCancel={() => setEditTask(null)}
              onUpdated={(t) => { setTasks(prev => prev.map(x => x.id === t.id ? t : x)); setEditTask(null) }}
              onDeleted={(id) => { setTasks(prev => prev.filter(x => x.id !== id)); setEditTask(null) }}
            />
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ── Edit classwork modal (staff/smartboard) ─────────────────────────── */}
      <AnimatePresence>
        {editClasswork && canManage && (
          <ModalShell onClose={() => setEditClasswork(null)} size="lg" bare>
            <ClassroomFileEditForm
              file={editClasswork}
              onCancel={() => setEditClasswork(null)}
              onUpdated={(updated) => { setFiles(prev => prev.map(f => f.id === updated.id ? updated : f)); setEditClasswork(null) }}
              onDeleted={(id) => { setFiles(prev => prev.filter(f => f.id !== id)); setEditClasswork(null) }}
              onTrack={(fileId) => { setEditClasswork(null); openFileTracking(fileId) }}
            />
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ── Homework detail modal (student) ─────────────────────────────────── */}
      <AnimatePresence>
        {detailTask && isStudent && (
          <ModalShell
            onClose={() => { setDetailTask(null); setSubmitOpenId(null) }}
            size="lg"
            title="Homework"
            icon={<BookOpen size={16} />}
            iconClassName="bg-purple-100 text-purple-600"
            bodyClassName="space-y-3"
          >
              <h2 className={`text-lg font-bold leading-snug ${hwIsCompleted(hwCompletionMap[detailTask.id]?.status ?? 'not_done', detailTask.require_check) ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                {detailTask.title}
              </h2>
              {detailTask.description && (
                <p className="text-sm text-slate-600 leading-relaxed p-3.5 bg-slate-50 rounded-2xl">{detailTask.description}</p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {detailTask.due_date && (
                  <span className="text-xs text-red-500 font-semibold bg-red-50 px-2 py-0.5 rounded-lg">
                    Due {parseDate(detailTask.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                )}
                {detailTask.require_check && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1">
                    <ShieldCheck size={10} /> Needs verification
                  </span>
                )}
                {detailTask.requires_submission && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium flex items-center gap-1">
                    <Send size={10} /> Submission required
                  </span>
                )}
                {detailTask.edu_points > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                    <Star size={10} /> {detailTask.edu_points} EP
                  </span>
                )}
              </div>

              {detailTask.attachment_url && (
                <AttachmentDisplay url={detailTask.attachment_url} name={detailTask.attachment_name} />
              )}

              {detailTask.requires_submission && (
                <div className="pt-1 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-600 mb-2">
                    {hwCompletionMap[detailTask.id]?.submission ? 'Your submission' : 'Submit your work'}
                  </p>
                  {submitOpenId === detailTask.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        value={submitDraft}
                        onChange={e => setSubmitDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveHwSubmission(detailTask) } }}
                        placeholder="Add a note or link…"
                        className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
                      />
                      <button
                        onClick={() => saveHwSubmission(detailTask)}
                        disabled={savingHwId === detailTask.id}
                        className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                      >
                        {savingHwId === detailTask.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Submit
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setSubmitOpenId(detailTask.id); setSubmitDraft(hwCompletionMap[detailTask.id]?.submission ?? '') }}
                      className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                    >
                      {hwCompletionMap[detailTask.id]?.submission ? `"${hwCompletionMap[detailTask.id]?.submission}" — Edit` : '+ Add submission'}
                    </button>
                  )}
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  onClick={() => cycleHwStatus(detailTask)}
                  disabled={savingHwId === detailTask.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 text-sm font-semibold transition-all active:scale-95 ${HW_STATUS_BORDER[hwCompletionMap[detailTask.id]?.status ?? 'not_done']}`}
                >
                  {savingHwId === detailTask.id
                    ? <Loader2 size={14} className="animate-spin" />
                    : hwStatusIcon(hwCompletionMap[detailTask.id]?.status ?? 'not_done', detailTask.require_check)}
                  <span>
                    {(() => {
                      const s = hwCompletionMap[detailTask.id]?.status ?? 'not_done'
                      if (s === 'not_done') return 'Not Done'
                      if (s === 'partial')  return 'Partial'
                      if (s === 'done')     return detailTask.require_check ? 'Awaiting verification' : 'Completed'
                      return 'Verified'
                    })()}
                  </span>
                </button>
              </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ── Classwork detail modal ───────────────────────────────────────────── */}
      <AnimatePresence>
        {detailFile && (
          <ModalShell
            onClose={() => setDetailFile(null)}
            size="lg"
            title="Classwork"
            subtitle={detailFile.folder.title}
            icon={<FileText size={16} />}
            iconClassName="bg-cyan-100 text-cyan-600"
            bodyClassName="space-y-3"
            headerActions={canManage ? (
              <button
                onClick={() => openFileTracking(detailFile.id)}
                className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-indigo-50 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700 active:scale-95 transition-all"
                title="Student tracking"
              >
                <Users size={15} />
              </button>
            ) : undefined}
          >
              <h2 className={`text-lg font-bold leading-snug ${(cwProgressMap[detailFile.id] ?? 'not_done') === 'completed' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                {detailFile.title}
              </h2>

              {detailFile.description && (
                <p className="text-sm text-slate-600 leading-relaxed p-3.5 bg-slate-50 rounded-2xl">{detailFile.description}</p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {detailFile.due_date && (
                  <span className="text-xs text-red-500 font-semibold bg-red-50 px-2 py-0.5 rounded-lg">
                    Due {parseDate(detailFile.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                )}
                {detailFile.edu_points > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                    <Star size={10} /> {detailFile.edu_points} EP
                  </span>
                )}
                {detailFile.requires_submission && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium flex items-center gap-1">
                    <Upload size={10} /> Submission required
                  </span>
                )}
              </div>

              {detailFile.attachment_url && (
                <AttachmentDisplay url={detailFile.attachment_url} name={detailFile.attachment_name} />
              )}

              {isStudent && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => { setSavingCwId(detailFile.id); cycleCwStatus(detailFile) }}
                    disabled={savingCwId === detailFile.id}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 text-sm font-semibold transition-all active:scale-95 ${CW_STATUS_BORDER[cwProgressMap[detailFile.id] ?? 'not_done']}`}
                  >
                    {savingCwId === detailFile.id ? <Loader2 size={14} className="animate-spin" /> : cwStatusIcon(cwProgressMap[detailFile.id] ?? 'not_done')}
                    <span className="capitalize">{(cwProgressMap[detailFile.id] ?? 'not_done').replace('_', ' ')}</span>
                  </button>
                </div>
              )}
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ── File tracking modal (staff/smartboard) ───────────────────────────── */}
      <AnimatePresence>
        {trackingFileId && (
          <ModalShell
            onClose={() => { setTrackingFileId(null); setFileTrackingData([]) }}
            size="sm"
            zClass="z-[60]"
            title="Student progress"
            icon={<Users size={15} />}
            iconClassName="bg-indigo-100 text-indigo-600"
            bodyClassName="divide-y divide-slate-50 !px-2 !py-1"
          >
            {loadingTracking ? (
              <div className="flex items-center justify-center gap-2 text-xs text-slate-500 py-8">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : fileTrackingData.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 px-4 text-center">No student progress recorded yet.</p>
            ) : (
              fileTrackingData.map(p => (
                <div key={p.student_id} className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar avatarUrl={p.student?.avatar_url} name={p.student?.full_name ?? ''} email={p.student?.email ?? ''} size={30} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{p.student?.full_name ?? 'Student'}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full capitalize ${
                    p.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
                      : p.status === 'done'  ? 'bg-yellow-100 text-yellow-700'
                      : p.status === 'partial' ? 'bg-orange-100 text-orange-600'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {p.status.replace('_', ' ')}
                  </span>
                </div>
              ))
            )}
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Attachment display helper ──────────────────────────────────────────────────

function AttachmentDisplay({ url, name }: { url: string; name: string | null }) {
  const isYoutube = /youtube\.com|youtu\.be/i.test(url)
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  const embedUrl = m ? `https://www.youtube.com/embed/${m[1]}` : null

  if (isYoutube && embedUrl) {
    return (
      <div className="space-y-2">
        <div className="rounded-xl overflow-hidden border border-slate-200 aspect-video">
          <iframe src={embedUrl} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-red-600 hover:underline">
          <Youtube size={13} /> Open on YouTube
        </a>
      </div>
    )
  }

  const isLink = !name || name.startsWith('http')
  if (isLink) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors">
        <Link2 size={14} />
        <span className="flex-1 truncate">{name || url}</span>
        <ExternalLink size={12} />
      </a>
    )
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-100 transition-colors">
      <FileText size={14} />
      <span className="flex-1 truncate"><Paperclip size={12} className="inline mr-1" />{name || 'Attachment'}</span>
      <ExternalLink size={12} />
    </a>
  )
}
