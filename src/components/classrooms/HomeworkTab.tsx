'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen, Plus, Loader2, Star, ShieldCheck, Send, Paperclip,
  Calendar, Clock, Trash2, FileText,
} from 'lucide-react'
import { UserRole } from '@/lib/supabase'
import { ClassroomWithDetails } from '@/lib/classrooms'
import SmartboardHomeworkForm from '@/components/smartboard/SmartboardHomeworkForm'
import {
  SmartboardTask,
  fetchClassroomHomeworkTasks,
  deleteSmartboardTask,
} from '@/lib/smartboard'

const PAGE_SIZE = 10

// ── Date grouping ─────────────────────────────────────────────────────────────

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
}

function dateGroupLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const now  = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  if (sameDay(date, now))       return 'Today'
  if (sameDay(date, yesterday)) return 'Yesterday'

  const diffDays = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
     new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000
  )
  if (diffDays < 7)
    return date.toLocaleDateString('en-US', { weekday: 'long' })
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: diffDays > 365 ? 'numeric' : undefined,
  })
}

function groupByDate(items: SmartboardTask[]) {
  const groups: { label: string; items: SmartboardTask[] }[] = []
  const indexMap = new Map<string, number>()

  for (const task of items) {
    const label = dateGroupLabel(task.created_at)
    if (!indexMap.has(label)) {
      indexMap.set(label, groups.length)
      groups.push({ label, items: [] })
    }
    groups[indexMap.get(label)!].items.push(task)
  }
  return groups
}

interface HomeworkTabProps {
  classroomId: string
  userId: string
  userRole: UserRole
  classroom: ClassroomWithDetails
}

function HomeworkSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="h-4 w-2/3 bg-slate-100 rounded animate-pulse" />
          <div className="h-3 w-1/3 bg-slate-100 rounded animate-pulse mt-2.5" />
          <div className="flex gap-2 mt-3">
            <div className="h-4 w-16 bg-slate-100 rounded-full animate-pulse" />
            <div className="h-4 w-12 bg-slate-100 rounded-full animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function HomeworkTab({ classroomId, userId, userRole }: HomeworkTabProps) {
  const canManage = userRole !== 'student'

  const [tasks, setTasks] = useState<SmartboardTask[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [showForm, setShowForm] = useState(false)
  // The homework opened for editing (same card design as creation).
  const [editTask, setEditTask] = useState<SmartboardTask | null>(null)

  const loadInitial = useCallback(async () => {
    setLoading(true)
    const data = await fetchClassroomHomeworkTasks(classroomId, PAGE_SIZE, 0)
    setTasks(data)
    setHasMore(data.length === PAGE_SIZE)
    setLoading(false)
  }, [classroomId])

  useEffect(() => { loadInitial() }, [loadInitial])

  const loadMore = async () => {
    setLoadingMore(true)
    const data = await fetchClassroomHomeworkTasks(classroomId, PAGE_SIZE, tasks.length)
    setTasks(prev => [...prev, ...data])
    setHasMore(data.length === PAGE_SIZE)
    setLoadingMore(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this homework? It disappears from every student’s calendar.')) return
    if (await deleteSmartboardTask(id)) setTasks(prev => prev.filter(t => t.id !== id))
  }

  const isOverdue = (d: string | null) =>
    !!d && new Date(d) < new Date(new Date().toDateString())

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-purple-100">
            <BookOpen size={16} className="text-purple-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800 text-sm">Homework</h2>
            <p className="text-xs text-slate-400">
              {loading ? 'Loading…' : `${tasks.length}${hasMore ? '+' : ''} task${tasks.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-colors shadow-sm bg-purple-600 hover:bg-purple-700"
          >
            <Plus size={13} /> New Homework
          </button>
        )}
      </div>

      {/* New homework box */}
      <AnimatePresence>
        {canManage && showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <SmartboardHomeworkForm
              createdBy={userId}
              classroomId={classroomId}
              onCancel={() => setShowForm(false)}
              onCreated={(task) => { setTasks(prev => [task, ...prev]); setShowForm(false) }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stream */}
      {loading ? (
        <HomeworkSkeleton />
      ) : tasks.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-100 p-10 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 bg-purple-50">
            <BookOpen size={26} className="text-purple-300" />
          </div>
          <p className="text-slate-600 font-medium text-sm mb-1">No homework yet</p>
          <p className="text-slate-400 text-xs">
            {canManage
              ? 'Create homework above — it appears on every student’s weekly calendar.'
              : 'No homework has been set yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groupByDate(tasks).map(group => (
            <div key={group.label}>
              {/* Date divider */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{group.label}</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>

              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {group.items.map(task => {
                    const overdue = isOverdue(task.due_date)
                    return (
                      <motion.div
                        key={task.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        onClick={() => { if (canManage) setEditTask(task) }}
                        className={`rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden group ${canManage ? 'cursor-pointer hover:border-purple-300' : ''}`}
                      >
                        <div className="h-1 bg-purple-200" />
                        <div className="flex items-start gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-slate-800 text-sm">{task.title}</span>
                              {overdue && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full font-semibold">Overdue</span>
                              )}
                            </div>
                            {task.description && (
                              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{task.description}</p>
                            )}
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              {task.due_date ? (
                                <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${overdue ? 'text-rose-500' : 'text-slate-400'}`}>
                                  <Calendar size={11} />
                                  {new Date(task.due_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                                  {task.timing && <><Clock size={11} className="ml-1" /> {task.timing}</>}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                                  <Calendar size={11} /> No due date
                                </span>
                              )}
                              {task.edu_points > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                                  <Star size={10} /> {task.edu_points} EP
                                </span>
                              )}
                              {task.require_check && (
                                <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
                                  <ShieldCheck size={10} /> Verification
                                </span>
                              )}
                              {task.requires_submission && (
                                <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-1.5 py-0.5">
                                  <Send size={10} /> Submission
                                </span>
                              )}
                              {task.attachment_url && (
                                <a
                                  href={task.attachment_url} target="_blank" rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-1.5 py-0.5 hover:text-purple-600"
                                >
                                  <Paperclip size={10} /> {task.attachment_name || 'Attachment'}
                                </a>
                              )}
                            </div>
                          </div>
                          {canManage && (
                            <button
                              onClick={e => { e.stopPropagation(); handleDelete(task.id) }}
                              className="flex-shrink-0 p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                              title="Delete homework"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            </div>
          ))}

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-2.5 text-xs font-semibold text-purple-600 hover:text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-100 rounded-xl transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {loadingMore ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
              {loadingMore ? 'Loading…' : `Load ${PAGE_SIZE} more`}
            </button>
          )}
        </div>
      )}

      {/* Open / edit homework — same card design as creation */}
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
    </div>
  )
}
