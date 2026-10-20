'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Plus, X, Loader2, Star, BookOpen, Maximize2, FileText } from 'lucide-react'
import {
  Classroom, ClassroomFile, ClassroomFolder,
  fetchClassroomFilesForDateRange,
} from '@/lib/classrooms'
import ModalShell from '@/components/ui/ModalShell'
import SmartboardHomeworkForm from './SmartboardHomeworkForm'
import ClassroomFileEditForm from '@/components/classrooms/ClassroomFileEditForm'
import {
  SmartboardTask,
  fetchSmartboardBoardTasks,
  createSmartboardTask,
} from '@/lib/smartboard'

// ── Date helpers (week starts Monday, matching the staff calendar) ──
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
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface SmartboardWeeklyCalendarProps {
  homeroomId: string
  createdBy: string
  classrooms: Classroom[]
  /** Opens the task detail panel. */
  onOpenTask?: (task: SmartboardTask) => void
  /** Lets the parent refresh other panels after a task changes. */
  onTaskActivity?: () => void
  /** Bumped by the parent (e.g. after a detail-panel edit/delete) to force a reload. */
  reloadSignal?: number
}

export default function SmartboardWeeklyCalendar({
  homeroomId,
  createdBy,
  classrooms,
  onOpenTask,
  onTaskActivity,
  reloadSignal,
}: SmartboardWeeklyCalendarProps) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [tasks, setTasks] = useState<SmartboardTask[]>([])
  const [cwFiles, setCwFiles] = useState<(ClassroomFile & { folder: ClassroomFolder })[]>([])
  const [loading, setLoading] = useState(true)
  // The day column that is expanded. Defaults to today; clicking any day header
  // makes that day the expanded column instead.
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  // Quick-add inline state
  const [quickAddDay, setQuickAddDay] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftClassroom, setDraftClassroom] = useState<string>('')
  const [creating, setCreating] = useState(false)
  // Full homework box expanded from the quick-add (carries the typed title/day).
  const [expandDay, setExpandDay] = useState<string | null>(null)
  // Edit classwork from the homeroom calendar.
  const [editCwFile, setEditCwFile] = useState<(ClassroomFile & { folder: ClassroomFolder }) | null>(null)

  const todayStr = formatDate(new Date())
  const classroomById = useMemo(
    () => new Map(classrooms.map(c => [c.id, c])),
    [classrooms],
  )

  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + i)
        return { day: DAY_NAMES[d.getDay()], date: d.getDate(), month: MONTHS[d.getMonth()], full: formatDate(d) }
      }),
    [weekStart],
  )

  const load = useCallback(async () => {
    setLoading(true)
    const start = formatDate(weekStart)
    const endD = new Date(weekStart)
    endD.setDate(endD.getDate() + 6)
    const end = formatDate(endD)
    const classroomIds = classrooms.map(c => c.id)
    const [hwData, cwData] = await Promise.all([
      fetchSmartboardBoardTasks(homeroomId, classroomIds, start, end),
      fetchClassroomFilesForDateRange(classroomIds, start, end),
    ])
    setTasks(hwData)
    setCwFiles(cwData)
    setLoading(false)
  }, [homeroomId, weekStart, classrooms])

  useEffect(() => { load() }, [load])
  // Reload when the parent signals an external change (detail-panel edit/delete).
  useEffect(() => {
    if (reloadSignal !== undefined) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal])

  const tasksForDay = (dateStr: string) =>
    tasks
      .filter(t => t.due_date === dateStr)
      .sort((a, b) => (a.timing ?? '~').localeCompare(b.timing ?? '~'))

  const cwForDay = (dateStr: string) =>
    cwFiles.filter(f => f.due_date === dateStr)

  const openQuickAdd = (dateStr: string) => {
    setQuickAddDay(dateStr)
    setDraftTitle('')
    setDraftClassroom('')
  }

  const handleCreate = async () => {
    if (!quickAddDay || !draftTitle.trim()) return
    setCreating(true)
    const created = await createSmartboardTask(
      {
        homeroom_id: homeroomId,
        classroom_id: draftClassroom || null,
        title: draftTitle.trim(),
        due_date: quickAddDay,
      },
      createdBy,
    )
    setCreating(false)
    if (created) {
      setTasks(prev => [...prev, created])
      setDraftTitle('')
      setDraftClassroom('')
      onTaskActivity?.()
    }
  }

  const goPrev = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d) }
  const goNext = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d) }
  const goToday = () => { setWeekStart(getWeekStart(new Date())); setSelectedDay(null) }

  const weekLabel = `${weekDays[0].month} ${weekDays[0].date} – ${weekDays[6].month} ${weekDays[6].date}`
  // The expanded column: the day the user picked, else today.
  const expandedDay = selectedDay ?? todayStr

  return (
    <div className="space-y-3">
      {/* Header / week nav */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-slate-800">Homeroom Calendar</h2>
        <div className="flex items-center gap-1">
          <button onClick={goPrev} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors" aria-label="Previous week">
            <ChevronLeft size={18} />
          </button>
          <button onClick={goToday} className="text-sm font-semibold text-slate-700 hover:text-indigo-600 transition-colors px-2">
            {weekLabel}
          </button>
          <button onClick={goNext} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors" aria-label="Next week">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm bg-white">
        <div className="flex min-w-[820px]">
          {weekDays.map((day, i) => {
            const isToday = day.full === todayStr
            const isExpanded = day.full === expandedDay
            const isActiveAdd = quickAddDay === day.full
            // The expanded day is shown 4×; a non-expanded column being
            // quick-added expands too so the inline form has room.
            const flexWeight = isExpanded ? 4 : isActiveAdd ? 4 : 1
            const isLast = i === 6
            const dayTasks = tasksForDay(day.full)
            const dayCw = cwForDay(day.full)
            const totalItems = dayTasks.length + dayCw.length

            return (
              <div
                key={day.full}
                style={{ flex: `${flexWeight} ${flexWeight} 0%`, transition: 'flex 280ms ease' }}
                className={`min-w-0 flex flex-col ${!isLast ? 'border-r border-slate-100' : ''}`}
              >
                {/* Day header — click to expand this day */}
                <button
                  onClick={() => setSelectedDay(day.full)}
                  className={`w-full px-2 py-2 text-center border-b transition-colors ${
                    isExpanded ? 'bg-indigo-100 border-indigo-100' : isToday ? 'bg-indigo-50 border-slate-100 hover:bg-indigo-100' : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                  }`}
                >
                  <p className={`text-[10px] font-semibold uppercase tracking-wide ${isExpanded || isToday ? 'text-indigo-600' : 'text-slate-400'}`}>
                    {day.day}
                  </p>
                  <p className={`text-base font-bold leading-tight ${isExpanded ? 'text-indigo-700' : isToday ? 'text-indigo-600' : 'text-slate-700'}`}>
                    {day.date}
                  </p>
                  {totalItems > 0 && (
                    <span className={`text-[9px] font-bold inline-block px-1 rounded ${isExpanded || isToday ? 'text-indigo-400' : 'text-slate-400'}`}>
                      {totalItems}
                    </span>
                  )}
                </button>

                {/* Tasks + quick add */}
                <div className={`p-1.5 space-y-1.5 flex-1 min-h-[140px] ${isExpanded ? 'bg-indigo-50/40' : 'bg-white'}`}>
                  {loading ? (
                    <div className="h-8 rounded-lg bg-slate-100 animate-pulse" />
                  ) : (
                    <AnimatePresence initial={false}>
                      {dayTasks.map(task => {
                        const cls = task.classroom_id ? classroomById.get(task.classroom_id) : null
                        return (
                          <motion.button
                            key={task.id}
                            layout
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            onClick={() => onOpenTask?.(task)}
                            className="w-full text-left p-1.5 rounded-lg border border-indigo-100 bg-white hover:border-indigo-300 hover:shadow-sm transition-all"
                          >
                            <p className="text-[11px] font-medium leading-tight text-slate-700 line-clamp-2">{task.title}</p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {task.timing && <span className="text-[9px] text-slate-400 font-medium">{task.timing}</span>}
                              {cls && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-1 py-px max-w-full truncate">
                                  <BookOpen size={8} className="flex-shrink-0" /> <span className="truncate">{cls.title}</span>
                                </span>
                              )}
                              {task.edu_points > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-600">
                                  <Star size={8} /> {task.edu_points}
                                </span>
                              )}
                            </div>
                          </motion.button>
                        )
                      })}
                      {dayCw.map(file => {
                        const cls = classroomById.get(file.folder.classroom_id)
                        return (
                          <motion.button
                            key={file.id}
                            layout
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setEditCwFile(file)}
                            className="w-full text-left p-1.5 rounded-lg border border-cyan-100 bg-cyan-50/60 hover:border-cyan-300 hover:shadow-sm transition-all"
                          >
                            <p className="text-[11px] font-medium leading-tight text-slate-700 line-clamp-2">{file.title}</p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <span className="inline-block px-1 py-px rounded text-[9px] font-bold bg-cyan-100 text-cyan-600">CW</span>
                              {cls && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-cyan-700 bg-cyan-50 border border-cyan-100 rounded px-1 py-px max-w-full truncate">
                                  <FileText size={8} className="flex-shrink-0" /> <span className="truncate">{cls.title}</span>
                                </span>
                              )}
                              {file.edu_points > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-600">
                                  <Star size={8} /> {file.edu_points}
                                </span>
                              )}
                            </div>
                          </motion.button>
                        )
                      })}
                    </AnimatePresence>
                  )}

                  {/* Inline quick-add */}
                  {isActiveAdd ? (
                    <div className="rounded-lg border border-indigo-300 bg-white p-1.5 space-y-1.5 shadow-sm">
                      <input
                        autoFocus
                        value={draftTitle}
                        onChange={e => setDraftTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); handleCreate() }
                          if (e.key === 'Escape') setQuickAddDay(null)
                        }}
                        placeholder="Task title…"
                        className="w-full text-[11px] px-1.5 py-1 border border-slate-200 rounded focus:outline-none focus:border-indigo-400"
                      />
                      {classrooms.length > 0 && (
                        <select
                          value={draftClassroom}
                          onChange={e => setDraftClassroom(e.target.value)}
                          className="w-full text-[11px] px-1 py-1 border border-slate-200 rounded focus:outline-none focus:border-indigo-400 text-slate-600"
                        >
                          <option value="">No classroom</option>
                          {classrooms.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                        </select>
                      )}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleCreate}
                          disabled={creating || !draftTitle.trim()}
                          className="flex-1 flex items-center justify-center gap-1 text-[11px] font-medium px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50 transition-colors"
                        >
                          {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add
                        </button>
                        <button
                          onClick={() => setExpandDay(day.full)}
                          className="p-1 text-slate-400 hover:text-indigo-600"
                          title="More options — open homework box"
                        >
                          <Maximize2 size={13} />
                        </button>
                        <button onClick={() => setQuickAddDay(null)} className="p-1 text-slate-400 hover:text-slate-600">
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => openQuickAdd(day.full)}
                      className="w-full flex items-center justify-center gap-1 py-1 rounded-lg border border-dashed border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50/50 transition-colors"
                      title="Add task"
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Edit classwork — opened when a CW chip is clicked */}
      <AnimatePresence>
        {editCwFile && (
          <ModalShell onClose={() => setEditCwFile(null)} size="lg" bare glass>
            <ClassroomFileEditForm
              file={editCwFile}
              onCancel={() => setEditCwFile(null)}
              onUpdated={(updated) => { setCwFiles(prev => prev.map(f => f.id === updated.id ? updated : f)); setEditCwFile(null) }}
              onDeleted={(id) => { setCwFiles(prev => prev.filter(f => f.id !== id)); setEditCwFile(null) }}
            />
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Expanded homework box — opened mid-typing from the quick-add */}
      <AnimatePresence>
        {expandDay && (
          <ModalShell onClose={() => setExpandDay(null)} size="lg" bare glass>
            <SmartboardHomeworkForm
              createdBy={createdBy}
              homeroomId={homeroomId}
              classrooms={classrooms}
              defaultTitle={draftTitle}
              defaultDueDate={expandDay}
              heading="New homework"
              onCancel={() => setExpandDay(null)}
              onCreated={(task) => {
                setTasks(prev => [...prev, task])
                setExpandDay(null)
                setQuickAddDay(null)
                setDraftTitle('')
                setDraftClassroom('')
                onTaskActivity?.()
              }}
            />
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  )
}
