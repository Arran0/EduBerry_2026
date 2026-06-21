'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Loader2, Plus, Save, Trash2, Star, ShieldCheck, Send, Paperclip, Upload, X, FileText,
  Users, ChevronDown, Circle, CircleDot, CheckCircle2, Link2,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import { Classroom } from '@/lib/classrooms'
import {
  SmartboardTask,
  SmartboardTaskStatus,
  SmartboardTaskCompletion,
  createSmartboardTask,
  updateSmartboardTask,
  deleteSmartboardTask,
  uploadSmartboardTaskAttachment,
  fetchTaskCompletions,
  upsertTaskCompletion,
  getNextSmartboardStatus,
} from '@/lib/smartboard'

const STATUS_META: Record<SmartboardTaskStatus, { label: string; icon: React.ReactNode; chip: string }> = {
  not_done: { label: 'Not done', icon: <Circle size={14} className="text-slate-400" />, chip: 'bg-slate-100 text-slate-500' },
  partial:  { label: 'Partial',  icon: <CircleDot size={14} className="text-orange-500" />, chip: 'bg-orange-100 text-orange-600' },
  done:     { label: 'Done',     icon: <CheckCircle2 size={14} className="text-yellow-500" />, chip: 'bg-yellow-100 text-yellow-700' },
  checked:  { label: 'Verified', icon: <CheckCircle2 size={14} className="text-green-500" />, chip: 'bg-green-100 text-green-700' },
}

interface SmartboardHomeworkFormProps {
  createdBy: string
  /** Homeroom the task belongs to, when created from a board's calendar. */
  homeroomId?: string | null
  /** Fixed classroom (the Homework tab). */
  classroomId?: string | null
  /** Selectable classrooms (the board's weekly calendar). */
  classrooms?: Classroom[]
  defaultTitle?: string
  defaultDueDate?: string
  /** Heading shown at the top of the box. */
  heading?: string
  /** When set, the box edits this existing task instead of creating one. */
  task?: SmartboardTask
  onCancel: () => void
  onCreated?: (task: SmartboardTask) => void
  onUpdated?: (task: SmartboardTask) => void
  onDeleted?: (taskId: string) => void
}

/**
 * The shared homework card — mirrors the new-file form in Course Work. Used for
 * both creating homework (Homework tab, board calendar) and opening/editing an
 * existing one, so clicking a homework shows the same design as creating it.
 */
export default function SmartboardHomeworkForm({
  createdBy, homeroomId, classroomId, classrooms,
  defaultTitle = '', defaultDueDate = '', heading,
  task, onCancel, onCreated, onUpdated, onDeleted,
}: SmartboardHomeworkFormProps) {
  const isEdit = !!task
  const [title, setTitle] = useState(task?.title ?? defaultTitle)
  const [description, setDescription] = useState(task?.description ?? '')
  const [dueDate, setDueDate] = useState(task?.due_date ?? defaultDueDate)
  const [timing, setTiming] = useState(task?.timing ?? '')
  const [selectedClassroom, setSelectedClassroom] = useState(task?.classroom_id ?? classroomId ?? '')
  const [requireCheck, setRequireCheck] = useState(task?.require_check ?? false)
  const [requiresSubmission, setRequiresSubmission] = useState(task?.requires_submission ?? false)
  const [eduPoints, setEduPoints] = useState(task?.edu_points ?? 0)
  const [attachmentUrl, setAttachmentUrl] = useState(task?.attachment_url ?? '')
  const [attachmentName, setAttachmentName] = useState(task?.attachment_name ?? '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Member completions (edit mode only)
  const [showMembers, setShowMembers] = useState(false)
  const [completions, setCompletions] = useState<SmartboardTaskCompletion[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)

  // Show a classroom picker only when the caller offers a choice.
  const showClassroomPicker = !classroomId && !!classrooms && classrooms.length > 0
  const effectiveClassroom = classroomId ?? (selectedClassroom || null)

  const loadMembers = useCallback(async () => {
    if (!task) return
    setLoadingMembers(true)
    const data = await fetchTaskCompletions(task)
    setCompletions(data)
    setLoadingMembers(false)
  }, [task])

  useEffect(() => {
    if (showMembers && completions.length === 0) loadMembers()
  }, [showMembers, completions.length, loadMembers])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const res = await uploadSmartboardTaskAttachment(file, homeroomId ?? effectiveClassroom ?? 'classroom')
    setUploading(false)
    if (res) { setAttachmentUrl(res.url); setAttachmentName(res.name) }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)

    if (isEdit && task) {
      const ok = await updateSmartboardTask(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        timing: timing || null,
        classroom_id: classroomId ?? (selectedClassroom || null),
        require_check: requireCheck,
        requires_submission: requiresSubmission,
        edu_points: eduPoints,
        attachment_url: attachmentUrl || null,
        attachment_name: attachmentName || null,
      })
      setSaving(false)
      if (ok) onUpdated?.({
        ...task,
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        timing: timing || null,
        classroom_id: classroomId ?? (selectedClassroom || null),
        require_check: requireCheck,
        requires_submission: requiresSubmission,
        edu_points: eduPoints,
        attachment_url: attachmentUrl || null,
        attachment_name: attachmentName || null,
      })
      return
    }

    const created = await createSmartboardTask({
      homeroom_id: homeroomId ?? null,
      classroom_id: effectiveClassroom,
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      timing: timing || null,
      require_check: requireCheck,
      requires_submission: requiresSubmission,
      edu_points: eduPoints,
      attachment_url: attachmentUrl || null,
      attachment_name: attachmentName || null,
    }, createdBy)
    setSaving(false)
    if (created) onCreated?.(created)
  }

  const handleDelete = async () => {
    if (!task) return
    if (!confirm('Delete this homework? It disappears from every student’s calendar.')) return
    setDeleting(true)
    const ok = await deleteSmartboardTask(task.id)
    setDeleting(false)
    if (ok) onDeleted?.(task.id)
  }

  // Board/staff verification: cycle a member's status (edit mode).
  const cycleStatus = async (c: SmartboardTaskCompletion) => {
    if (!task) return
    const next = getNextSmartboardStatus(c.status, true, requireCheck)
    setCompletions(prev => prev.map(x => x.student_id === c.student_id ? { ...x, status: next } : x))
    await upsertTaskCompletion(task.id, c.student_id, next)
  }

  const doneCount = completions.filter(c => c.status === 'done' || c.status === 'checked').length
  const submittedCount = completions.filter(c => c.submission).length

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl p-4 space-y-3 border border-slate-200 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-slate-600 flex-1">{heading ?? (isEdit ? 'Homework' : 'New Homework')}</p>
        {isEdit && (
          <button
            type="button" onClick={handleDelete} disabled={deleting}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50"
            title="Delete homework"
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </button>
        )}
        <button type="button" onClick={onCancel} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
          <X size={16} />
        </button>
      </div>

      <input
        type="text" value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Homework title"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
        autoFocus
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)" rows={2}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50 resize-none"
      />

      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
        />
        <input type="time" value={timing}
          onChange={e => setTiming(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
        />
        {showClassroomPicker && (
          <select
            value={selectedClassroom}
            onChange={e => setSelectedClassroom(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
          >
            <option value="">No classroom</option>
            {classrooms!.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </div>

      {/* Requirement toggles */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={requireCheck} onChange={e => setRequireCheck(e.target.checked)} className="rounded" />
          <ShieldCheck size={14} className={requireCheck ? 'text-green-600' : 'text-slate-400'} /> Needs verification
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={requiresSubmission} onChange={e => setRequiresSubmission(e.target.checked)} className="rounded" />
          <Send size={14} className={requiresSubmission ? 'text-indigo-600' : 'text-slate-400'} /> Needs submission
        </label>
      </div>

      {/* Edu points */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
          <Star size={12} className="text-amber-500" /> Edu Points
          <span className="text-slate-400 font-normal">— awarded on completion</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {[0, 1, 2, 3, 4, 5].map(n => (
            <button
              key={n} type="button" onClick={() => setEduPoints(n)}
              className={`min-w-[34px] px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                eduPoints === n
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'text-slate-600 border-slate-200 hover:bg-amber-50 hover:border-amber-200'
              }`}
            >
              {n === 0 ? 'None' : n}
            </button>
          ))}
        </div>
      </div>

      {/* Attachment */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1"><Paperclip size={12} /> Attachment (optional)</p>
        {attachmentUrl ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <FileText size={14} className="text-indigo-500 flex-shrink-0" />
            <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-sm text-indigo-600 hover:underline truncate">{attachmentName || 'Attachment'}</a>
            <button type="button" onClick={() => { setAttachmentUrl(''); setAttachmentName('') }} className="p-1 text-slate-400 hover:text-rose-600 flex-shrink-0">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button" onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors w-full"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Uploading…' : 'Choose file (max 20 MB)'}
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
          </button>
        )}
      </div>

      {/* Member completions (edit mode only) */}
      {isEdit && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <button type="button" onClick={() => setShowMembers(v => !v)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 transition-colors">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Users size={13} className="text-indigo-500" /> Student progress
              {completions.length > 0 && <span className="text-slate-400 font-normal">· {doneCount}/{completions.length} done · {submittedCount} submitted</span>}
            </span>
            <ChevronDown size={14} className={`text-slate-400 transition-transform ${showMembers ? 'rotate-180' : ''}`} />
          </button>
          {showMembers && (
            <div className="border-t border-slate-100 max-h-56 overflow-y-auto divide-y divide-slate-50">
              {loadingMembers ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-4 px-3"><Loader2 size={13} className="animate-spin" /> Loading…</div>
              ) : completions.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 px-3 text-center">No students.</p>
              ) : (
                completions.map(c => (
                  <div key={c.student_id} className="flex items-center gap-2.5 px-3 py-2">
                    <Avatar avatarUrl={c.student?.avatar_url} name={c.student?.full_name ?? ''} email={c.student?.email ?? ''} size={26} />
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
                      type="button" onClick={() => cycleStatus(c)}
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
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700 px-2">Cancel</button>
        <button
          type="submit" disabled={!title.trim() || saving || uploading}
          className="flex items-center gap-1.5 text-sm font-semibold text-white px-3.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 bg-indigo-600 hover:bg-indigo-700"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : isEdit ? <Save size={14} /> : <Plus size={14} />}
          {isEdit ? 'Save changes' : 'Add Homework'}
        </button>
      </div>
    </form>
  )
}
