'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  X, Loader2, Trash2, Save, Star, BookOpen, Users, Link2, FileText,
  Circle, CircleDot, CheckCircle2, ChevronDown, Calendar, Clock,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import { Classroom } from '@/lib/classrooms'
import {
  SmartboardTask,
  SmartboardTaskStatus,
  SmartboardTaskCompletion,
  updateSmartboardTask,
  deleteSmartboardTask,
  fetchTaskCompletions,
  upsertTaskCompletion,
} from '@/lib/smartboard'

const STATUS_META: Record<SmartboardTaskStatus, { label: string; icon: React.ReactNode; chip: string }> = {
  not_done: { label: 'Not done', icon: <Circle size={14} className="text-slate-400" />, chip: 'bg-slate-100 text-slate-500' },
  partial:  { label: 'Partial',  icon: <CircleDot size={14} className="text-orange-500" />, chip: 'bg-orange-100 text-orange-600' },
  done:     { label: 'Done',     icon: <CheckCircle2 size={14} className="text-yellow-500" />, chip: 'bg-yellow-100 text-yellow-700' },
  checked:  { label: 'Verified', icon: <CheckCircle2 size={14} className="text-green-500" />, chip: 'bg-green-100 text-green-700' },
}
const STATUS_CYCLE: SmartboardTaskStatus[] = ['not_done', 'partial', 'done', 'checked']

interface SmartboardTaskDetailProps {
  task: SmartboardTask
  classrooms: Classroom[]
  onClose: () => void
  onUpdated: () => void
  onDeleted: () => void
}

export default function SmartboardTaskDetail({
  task, classrooms, onClose, onUpdated, onDeleted,
}: SmartboardTaskDetailProps) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [dueDate, setDueDate] = useState(task.due_date ?? '')
  const [timing, setTiming] = useState(task.timing ?? '')
  const [classroomId, setClassroomId] = useState(task.classroom_id ?? '')
  const [eduPoints, setEduPoints] = useState(task.edu_points)
  const [showPoints, setShowPoints] = useState(task.edu_points > 0)

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [showMembers, setShowMembers] = useState(false)
  const [completions, setCompletions] = useState<SmartboardTaskCompletion[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)

  const dirty =
    title.trim() !== task.title ||
    (description.trim() || '') !== (task.description ?? '') ||
    (dueDate || null) !== (task.due_date ?? null) ||
    (timing || null) !== (task.timing ?? null) ||
    (classroomId || null) !== (task.classroom_id ?? null) ||
    eduPoints !== task.edu_points

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true)
    const data = await fetchTaskCompletions(task)
    setCompletions(data)
    setLoadingMembers(false)
  }, [task])

  useEffect(() => {
    if (showMembers && completions.length === 0) loadMembers()
  }, [showMembers, completions.length, loadMembers])

  const handleSave = async () => {
    if (!title.trim()) return
    setSaving(true)
    const ok = await updateSmartboardTask(task.id, {
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      timing: timing || null,
      classroom_id: classroomId || null,
      edu_points: showPoints ? Math.max(0, Math.round(eduPoints)) : 0,
    })
    setSaving(false)
    if (ok) onUpdated()
  }

  const handleDelete = async () => {
    if (!confirm('Delete this task? It will disappear from every homeroom member’s calendar.')) return
    setDeleting(true)
    const ok = await deleteSmartboardTask(task.id)
    setDeleting(false)
    if (ok) onDeleted()
  }

  // Board/staff verification: cycle a member's status.
  const cycleStatus = async (c: SmartboardTaskCompletion) => {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(c.status) + 1) % STATUS_CYCLE.length]
    setCompletions(prev => prev.map(x => x.student_id === c.student_id ? { ...x, status: next } : x))
    await upsertTaskCompletion(task.id, c.student_id, next)
    onUpdated()
  }

  const submittedCount = completions.filter(c => c.submission).length
  const doneCount = completions.filter(c => c.status === 'done' || c.status === 'checked').length

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92dvh]"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 flex-shrink-0">
          <h2 className="flex-1 text-sm font-bold text-slate-800">Task details</h2>
          <button onClick={handleDelete} disabled={deleting} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50" title="Delete task">
            {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {/* Title */}
          <input
            value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Task title"
            className="w-full text-base font-semibold text-slate-800 border-b border-slate-200 pb-1.5 focus:outline-none focus:border-indigo-400"
          />

          {/* Description */}
          <textarea
            value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Add a description…" rows={2}
            className="w-full text-sm text-slate-600 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-indigo-400"
          />

          {/* Due date + timing */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"><Calendar size={11} /> Due</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400" />
            </div>
            <div>
              <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"><Clock size={11} /> Time</label>
              <input type="time" value={timing} onChange={e => setTiming(e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400" />
            </div>
          </div>

          {/* Classroom selector */}
          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1"><BookOpen size={11} /> From classroom</label>
            <select value={classroomId} onChange={e => setClassroomId(e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400 text-slate-700">
              <option value="">No classroom (homeroom task)</option>
              {classrooms.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>

          {/* EduPoints (expandable) */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <button onClick={() => setShowPoints(v => !v)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 transition-colors">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><Star size={13} className="text-amber-500" /> EduPoints {eduPoints > 0 && !showPoints ? `· ${eduPoints}` : ''}</span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform ${showPoints ? 'rotate-180' : ''}`} />
            </button>
            {showPoints && (
              <div className="px-3 py-2.5 border-t border-slate-100 flex items-center gap-2">
                <button onClick={() => setEduPoints(p => Math.max(0, p - 1))} className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">–</button>
                <input
                  type="number" min={0} value={eduPoints}
                  onChange={e => setEduPoints(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-16 text-center text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-400"
                />
                <button onClick={() => setEduPoints(p => p + 1)} className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">+</button>
                <span className="text-xs text-slate-400">points awarded on completion</span>
              </div>
            )}
          </div>

          {/* Member completions (expandable) */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <button onClick={() => setShowMembers(v => !v)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 transition-colors">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <Users size={13} className="text-indigo-500" /> Homeroom completions
                {completions.length > 0 && <span className="text-slate-400 font-normal">· {doneCount}/{completions.length} done · {submittedCount} submitted</span>}
              </span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform ${showMembers ? 'rotate-180' : ''}`} />
            </button>
            {showMembers && (
              <div className="border-t border-slate-100 max-h-60 overflow-y-auto divide-y divide-slate-50">
                {loadingMembers ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500 py-4 px-3"><Loader2 size={13} className="animate-spin" /> Loading members…</div>
                ) : completions.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 px-3 text-center">No homeroom members.</p>
                ) : (
                  completions.map(c => (
                    <div key={c.student_id} className="flex items-center gap-2.5 px-3 py-2">
                      <Avatar avatarUrl={c.student?.avatar_url} name={c.student?.full_name ?? ''} email={c.student?.email ?? ''} size={28} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{c.student?.full_name ?? 'Unknown'}</p>
                        {c.submission && (
                          <p className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                            {/^https?:\/\//.test(c.submission) ? <Link2 size={10} /> : <FileText size={10} />}
                            {c.submission}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => cycleStatus(c)}
                        className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded ${STATUS_META[c.status].chip}`}
                        title="Tap to change status"
                      >
                        {STATUS_META[c.status].icon}
                        {STATUS_META[c.status].label}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Close</button>
          <button
            onClick={handleSave} disabled={saving || !dirty || !title.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
