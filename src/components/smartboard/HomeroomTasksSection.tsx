'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MonitorPlay, Star, BookOpen, Circle, CircleDot, CheckCircle2,
  ChevronDown, Loader2, Send, Calendar,
} from 'lucide-react'
import {
  StudentHomeroomTask,
  SmartboardTaskStatus,
  fetchStudentHomeroomTasks,
  upsertTaskCompletion,
} from '@/lib/smartboard'

function formatDate(date: Date): string {
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// Students advance their own progress not_done → partial → done.
// 'checked' is reserved for board/staff verification, so we show it but don't cycle into it.
const STUDENT_CYCLE: SmartboardTaskStatus[] = ['not_done', 'partial', 'done']
const STATUS_ICON: Record<SmartboardTaskStatus, React.ReactNode> = {
  not_done: <Circle size={16} className="text-slate-400" />,
  partial:  <CircleDot size={16} className="text-orange-500" />,
  done:     <CheckCircle2 size={16} className="text-yellow-500" />,
  checked:  <CheckCircle2 size={16} className="text-green-500" />,
}
const STATUS_LABEL: Record<SmartboardTaskStatus, string> = {
  not_done: 'Not done', partial: 'Partial', done: 'Done', checked: 'Verified',
}

interface HomeroomTasksSectionProps {
  studentId: string
}

export default function HomeroomTasksSection({ studentId }: HomeroomTasksSectionProps) {
  const [tasks, setTasks] = useState<StudentHomeroomTask[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draftSubmission, setDraftSubmission] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const today = new Date()
    const start = new Date(today); start.setDate(start.getDate() - 7)
    const end = new Date(today); end.setDate(end.getDate() + 45)
    const data = await fetchStudentHomeroomTasks(studentId, formatDate(start), formatDate(end))
    setTasks(data)
    setLoading(false)
  }, [studentId])

  useEffect(() => { load() }, [load])

  const cycleStatus = async (task: StudentHomeroomTask) => {
    // From a verified state, tapping returns to not_done so the student can redo.
    const idx = STUDENT_CYCLE.indexOf(task.my_status)
    const next = idx === -1 ? STUDENT_CYCLE[0] : STUDENT_CYCLE[(idx + 1) % STUDENT_CYCLE.length]
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, my_status: next } : t))
    setSavingId(task.id)
    await upsertTaskCompletion(task.id, studentId, next)
    setSavingId(null)
  }

  const saveSubmission = async (task: StudentHomeroomTask) => {
    setSavingId(task.id)
    // Submitting also nudges status to at least 'done' if still untouched.
    const status: SmartboardTaskStatus = task.my_status === 'not_done' ? 'done' : task.my_status
    await upsertTaskCompletion(task.id, studentId, status, draftSubmission.trim() || null)
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, my_submission: draftSubmission.trim() || null, my_status: status } : t))
    setSavingId(null)
    setExpandedId(null)
  }

  // Hide the whole section when a student has no reflected board tasks.
  if (!loading && tasks.length === 0) return null

  const todayStr = formatDate(new Date())

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-4 pt-4 pb-3 border-b border-slate-100/80"
      >
        <div className="p-1.5 bg-indigo-100 rounded-lg">
          <MonitorPlay size={14} className="text-indigo-600" />
        </div>
        <h2 className="font-semibold text-slate-700 text-sm flex-1 text-left">
          Homeroom Tasks
          {!loading && <span className="ml-1.5 text-xs font-normal text-slate-400">({tasks.length})</span>}
        </h2>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 space-y-1.5">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 py-3 px-1">
                  <Loader2 size={14} className="animate-spin" /> Loading tasks…
                </div>
              ) : (
                tasks.map(task => {
                  const isExpanded = expandedId === task.id
                  const overdue = task.due_date && task.due_date < todayStr && task.my_status === 'not_done'
                  return (
                    <div key={task.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <div className="flex items-start gap-2.5 p-2.5">
                        <button
                          onClick={() => cycleStatus(task)}
                          disabled={savingId === task.id}
                          className="flex-shrink-0 mt-0.5 hover:scale-110 transition-transform"
                          title={`Status: ${STATUS_LABEL[task.my_status]} — tap to change`}
                        >
                          {savingId === task.id ? <Loader2 size={16} className="animate-spin text-slate-400" /> : STATUS_ICON[task.my_status]}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium leading-tight ${task.my_status === 'checked' || task.my_status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                            {task.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {task.due_date && (
                              <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${overdue ? 'text-rose-500' : 'text-slate-400'}`}>
                                <Calendar size={9} /> {task.due_date}{task.timing ? ` · ${task.timing}` : ''}
                              </span>
                            )}
                            {task.classroom_title && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-1 py-px">
                                <BookOpen size={9} /> {task.classroom_title}
                              </span>
                            )}
                            {task.edu_points > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600">
                                <Star size={9} /> {task.edu_points}
                              </span>
                            )}
                            {task.my_submission && (
                              <span className="text-[10px] text-emerald-600 font-medium">submitted</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => { setExpandedId(isExpanded ? null : task.id); setDraftSubmission(task.my_submission ?? '') }}
                          className="flex-shrink-0 text-[10px] font-medium text-indigo-600 hover:text-indigo-700 px-1.5 py-1"
                        >
                          {isExpanded ? 'Close' : task.my_submission ? 'Edit' : 'Submit'}
                        </button>
                      </div>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden border-t border-slate-100"
                          >
                            <div className="p-2.5 space-y-2">
                              {task.description && <p className="text-xs text-slate-500">{task.description}</p>}
                              <div className="flex items-center gap-1.5">
                                <input
                                  value={draftSubmission}
                                  onChange={e => setDraftSubmission(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveSubmission(task) } }}
                                  placeholder="Add a note or link…"
                                  className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-400"
                                />
                                <button
                                  onClick={() => saveSubmission(task)}
                                  disabled={savingId === task.id}
                                  className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                                >
                                  {savingId === task.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Submit
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
