'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Loader2, Star, ShieldCheck, Send, ChevronLeft, ChevronRight,
  X, Users, FileText, ExternalLink, Link2, BookOpen, Paperclip, Circle,
  CircleDot, CheckCircle2, CalendarDays, Upload, Youtube,
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

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3">
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-violet-100">
            <CalendarDays size={16} className="text-violet-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800 text-sm">Classroom Calendar</h2>
            <p className="text-xs text-slate-400">
              {tasks.length} task{tasks.length !== 1 ? 's' : ''} · {files.length} classwork item{files.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={() => { setShowForm(v => !v); setDetailTask(null); setDetailFile(null) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-colors shadow-sm bg-purple-600 hover:bg-purple-700"
          >
            <Plus size={13} /> New Homework
          </button>
        )}
      </div>

      {/* ── New homework popup ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {canManage && showForm && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowForm(false)}
          >
            <motion.div
              className="w-full max-w-md max-h-[90vh] overflow-y-auto"
              initial={{ scale: 0.92, opacity: 0, y: 24 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 24 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              onClick={e => e.stopPropagation()}
            >
              <SmartboardHomeworkForm
                createdBy={userId}
                classroomId={classroomId}
                onCancel={() => setShowForm(false)}
                onCreated={(task) => { setTasks(prev => [task, ...prev]); setShowForm(false) }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Week navigation ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
        <button
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm text-slate-500 transition-all"
          aria-label="Previous week"
        >
          <ChevronLeft size={16} />
        </button>
        <p className="text-xs font-semibold text-slate-600">{weekLabel}</p>
        <button
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm text-slate-500 transition-all"
          aria-label="Next week"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* ── Weekly calendar grid ─────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm bg-white">
        <div className="flex min-w-[560px]">
          {weekDays.map((day, i) => {
            const isToday   = isSameDay(day, today)
            const isWeekend = i >= 5
            const isLastCol = i === 6
            const dayHw  = hwForDay(day)
            const dayCw  = cwForDay(day)
            const total  = dayHw.length + dayCw.length

            return (
              <div
                key={day.toISOString()}
                className={`flex flex-col flex-1 ${!isLastCol ? 'border-r border-slate-100' : ''} ${isWeekend ? 'bg-slate-50/50' : ''}`}
              >
                {/* Day header */}
                <div className={`px-1.5 py-2.5 text-center border-b border-slate-100 select-none ${
                  isToday
                    ? 'bg-gradient-to-b from-cyan-500 to-cyan-600'
                    : isWeekend ? 'bg-slate-100/60' : 'bg-slate-50'
                }`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wide ${isToday ? 'text-cyan-100' : 'text-slate-400'}`}>
                    {DAY_NAMES[i]}
                  </p>
                  <p className={`text-sm font-bold leading-tight ${isToday ? 'text-white' : 'text-slate-700'}`}>
                    {day.getDate()}
                  </p>
                  {total > 0 && (
                    <span className={`text-[9px] font-bold inline-block px-1 rounded ${isToday ? 'text-cyan-200' : 'text-slate-400'}`}>
                      {total}
                    </span>
                  )}
                </div>

                {/* Day content */}
                <div className={`p-1 space-y-1 flex-1 min-h-[96px] ${isToday ? 'bg-cyan-50/20' : ''}`}>
                  {/* Homework chips */}
                  {dayHw.map(task => {
                    const status    = hwCompletionMap[task.id]?.status ?? 'not_done'
                    const completed = hwIsCompleted(status, task.require_check)
                    return (
                      <div
                        key={task.id}
                        onClick={() => canManage ? setEditTask(task) : setDetailTask(task)}
                        className={`w-full text-[11px] p-1.5 rounded-lg border transition-all cursor-pointer hover:shadow-sm ${HW_STATUS_BORDER[status]}`}
                      >
                        <div className="flex items-start gap-1">
                          {isStudent && (
                            <button
                              onClick={e => { e.stopPropagation(); cycleHwStatus(task) }}
                              className="flex-shrink-0 mt-0.5 hover:scale-125 transition-transform"
                              disabled={savingHwId === task.id}
                            >
                              {savingHwId === task.id
                                ? <Loader2 size={14} className="animate-spin text-slate-400" />
                                : hwStatusIcon(status, task.require_check)}
                            </button>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={`font-medium leading-tight truncate ${completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                              {task.title}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              <span className="inline-block px-1 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-600">HW</span>
                              {task.edu_points > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-600">
                                  <Star size={8} /> {task.edu_points}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {/* Classwork chips */}
                  {dayCw.map(file => {
                    const status    = cwProgressMap[file.id] ?? 'not_done'
                    const completed = status === 'completed'
                    return (
                      <div
                        key={file.id}
                        onClick={() => canManage ? setEditClasswork(file) : setDetailFile(file)}
                        className={`w-full text-[11px] p-1.5 rounded-lg border transition-all cursor-pointer hover:shadow-sm ${CW_STATUS_BORDER[status]}`}
                      >
                        <div className="flex items-start gap-1">
                          {isStudent && (
                            <button
                              onClick={e => { e.stopPropagation(); setSavingCwId(file.id); cycleCwStatus(file) }}
                              className="flex-shrink-0 mt-0.5 hover:scale-125 transition-transform"
                              disabled={savingCwId === file.id}
                            >
                              {savingCwId === file.id
                                ? <Loader2 size={14} className="animate-spin text-slate-400" />
                                : cwStatusIcon(status)}
                            </button>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={`font-medium leading-tight truncate ${completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                              {file.title}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              <span className="inline-block px-1 py-0.5 rounded text-[9px] font-bold bg-cyan-100 text-cyan-600">CW</span>
                              {file.edu_points > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-600">
                                  <Star size={8} /> {file.edu_points}
                                </span>
                              )}
                            </div>
                          </div>
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

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {tasks.length === 0 && files.length === 0 && (
        <div className="rounded-2xl bg-white border border-slate-100 p-10 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 bg-violet-50">
            <CalendarDays size={26} className="text-violet-300" />
          </div>
          <p className="text-slate-600 font-medium text-sm mb-1">No items yet</p>
          <p className="text-slate-400 text-xs">
            {canManage
              ? "Create homework above — it appears on every student's calendar."
              : 'No tasks have been set yet.'}
          </p>
        </div>
      )}

      {/* ── Undated items ────────────────────────────────────────────────────── */}
      {(undatedHw.length > 0 || undatedCw.length > 0) && (
        <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <BookOpen size={13} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-600">No Due Date</h3>
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
                        ? <Loader2 size={14} className="animate-spin text-slate-400" />
                        : hwStatusIcon(status, task.require_check)}
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                      {task.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-600">HW</span>
                      {task.edu_points > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600">
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
                        ? <Loader2 size={14} className="animate-spin text-slate-400" />
                        : cwStatusIcon(status)}
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                      {file.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-100 text-cyan-600">CW</span>
                      <span className="text-[10px] text-slate-400 truncate">{file.folder.title}</span>
                      {file.edu_points > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600">
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
      {editTask && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) setEditTask(null) }}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto"
          >
            <SmartboardHomeworkForm
              createdBy={userId}
              classroomId={classroomId}
              task={editTask}
              onCancel={() => setEditTask(null)}
              onUpdated={(t) => { setTasks(prev => prev.map(x => x.id === t.id ? t : x)); setEditTask(null) }}
              onDeleted={(id) => { setTasks(prev => prev.filter(x => x.id !== id)); setEditTask(null) }}
            />
          </motion.div>
        </div>
      )}

      {/* ── Edit classwork modal (staff/smartboard) ─────────────────────────── */}
      {editClasswork && canManage && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) setEditClasswork(null) }}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto"
          >
            <ClassroomFileEditForm
              file={editClasswork}
              onCancel={() => setEditClasswork(null)}
              onUpdated={(updated) => { setFiles(prev => prev.map(f => f.id === updated.id ? updated : f)); setEditClasswork(null) }}
              onDeleted={(id) => { setFiles(prev => prev.filter(f => f.id !== id)); setEditClasswork(null) }}
              onTrack={(fileId) => { setEditClasswork(null); openFileTracking(fileId) }}
            />
          </motion.div>
        </div>
      )}

      {/* ── Homework detail modal (student) ─────────────────────────────────── */}
      {detailTask && isStudent && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => { setDetailTask(null); setSubmitOpenId(null) }}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-white rounded-t-3xl sm:rounded-2xl p-4 space-y-3 border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-600 flex-1">Homework</p>
                <button onClick={() => { setDetailTask(null); setSubmitOpenId(null) }} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                  <X size={16} />
                </button>
              </div>

              <h2 className={`text-base font-bold leading-snug ${hwIsCompleted(hwCompletionMap[detailTask.id]?.status ?? 'not_done', detailTask.require_check) ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                {detailTask.title}
              </h2>
              {detailTask.description && (
                <p className="text-sm text-slate-600 leading-relaxed p-3 bg-slate-50 rounded-lg">{detailTask.description}</p>
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
                  <p className="text-xs font-semibold text-slate-500 mb-2">
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
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Classwork detail modal ───────────────────────────────────────────── */}
      {detailFile && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setDetailFile(null)}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-white rounded-t-3xl sm:rounded-2xl p-4 space-y-3 border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-600 flex-1">Classwork · {detailFile.folder.title}</p>
                {canManage && (
                  <button
                    onClick={() => openFileTracking(detailFile.id)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Student tracking"
                  >
                    <Users size={15} />
                  </button>
                )}
                <button onClick={() => setDetailFile(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                  <X size={16} />
                </button>
              </div>

              <h2 className={`text-base font-bold leading-snug ${(cwProgressMap[detailFile.id] ?? 'not_done') === 'completed' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                {detailFile.title}
              </h2>

              {detailFile.description && (
                <p className="text-sm text-slate-600 leading-relaxed p-3 bg-slate-50 rounded-lg">{detailFile.description}</p>
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
            </div>
          </motion.div>
        </div>
      )}

      {/* ── File tracking modal (staff/smartboard) ───────────────────────────── */}
      {trackingFileId && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => { setTrackingFileId(null); setFileTrackingData([]) }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
              <Users size={15} className="text-indigo-500" />
              <p className="text-sm font-semibold text-slate-700 flex-1">Student progress</p>
              <button onClick={() => { setTrackingFileId(null); setFileTrackingData([]) }} className="p-1 text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
              {loadingTracking ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-6 px-4">
                  <Loader2 size={13} className="animate-spin" /> Loading…
                </div>
              ) : fileTrackingData.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 px-4 text-center">No student progress recorded yet.</p>
              ) : (
                fileTrackingData.map(p => (
                  <div key={p.student_id} className="flex items-center gap-2.5 px-4 py-2.5">
                    <Avatar avatarUrl={p.student?.avatar_url} name={p.student?.full_name ?? ''} email={p.student?.email ?? ''} size={26} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{p.student?.full_name ?? 'Student'}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-1 rounded ${
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
            </div>
          </div>
        </div>
      )}
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
