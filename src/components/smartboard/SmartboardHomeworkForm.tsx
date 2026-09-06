'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Loader2, Plus, Save, Trash2, ShieldCheck, Send, Paperclip, Upload, X, FileText,
  Users, Circle, CircleDot, CheckCircle2, Link2, Youtube, ExternalLink,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  FormHeader, HeaderAction, FieldLabel, ToggleCard, PointsPicker, FormFooter, INPUT_CLASS,
} from '@/components/classrooms/WorkFormKit'
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

type AttachMode = 'none' | 'youtube' | 'link' | 'upload'

function guessInitialMode(task?: SmartboardTask): AttachMode {
  if (!task?.attachment_url) return 'none'
  const url = task.attachment_url
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube'
  // If attachment_name looks like a plain filename (has extension), treat as upload
  const name = task.attachment_name ?? ''
  if (name && /\.[a-z]{2,5}$/i.test(name) && !name.startsWith('http')) return 'upload'
  return 'link'
}

function youtubeEmbedUrl(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? `https://www.youtube.com/embed/${m[1]}` : null
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
  const [eduPoints, setEduPoints] = useState(task?.edu_points ?? 1)
  const [bonusPoints, setBonusPoints] = useState<string>('')

  // Attachment state
  const [attachMode, setAttachMode] = useState<AttachMode>(guessInitialMode(task))
  const [attachmentUrl, setAttachmentUrl] = useState(task?.attachment_url ?? '')
  const [attachmentName, setAttachmentName] = useState(task?.attachment_name ?? '')
  const [youtubeInput, setYoutubeInput] = useState(
    task?.attachment_url && /youtube\.com|youtu\.be/i.test(task.attachment_url) ? task.attachment_url : ''
  )
  const [linkInput, setLinkInput] = useState(
    task?.attachment_url && !/youtube\.com|youtu\.be/i.test(task.attachment_url) && guessInitialMode(task) === 'link'
      ? task.attachment_url : ''
  )
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dueDateError, setDueDateError] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Tracking modal (edit mode only)
  const [showTracking, setShowTracking] = useState(false)
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
    if (showTracking && completions.length === 0) loadMembers()
  }, [showTracking, completions.length, loadMembers])

  // Sync attachment url/name from attachment mode inputs
  const resolvedAttachmentUrl = (() => {
    if (attachMode === 'youtube') return youtubeInput.trim() || null
    if (attachMode === 'link') return linkInput.trim() || null
    if (attachMode === 'upload') return attachmentUrl || null
    return null
  })()

  const resolvedAttachmentName = (() => {
    if (attachMode === 'youtube') {
      const trimmed = youtubeInput.trim()
      return trimmed ? (attachmentName || trimmed) : null
    }
    if (attachMode === 'link') {
      const trimmed = linkInput.trim()
      return trimmed ? (attachmentName || trimmed) : null
    }
    if (attachMode === 'upload') return attachmentName || null
    return null
  })()

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const res = await uploadSmartboardTaskAttachment(file, homeroomId ?? effectiveClassroom ?? 'classroom')
    setUploading(false)
    if (res) { setAttachmentUrl(res.url); setAttachmentName(res.name) }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const clearAttachment = () => {
    setAttachmentUrl('')
    setAttachmentName('')
    setYoutubeInput('')
    setLinkInput('')
    setAttachMode('none')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || saving) return
    if (!dueDate) { setDueDateError(true); return }
    setDueDateError(false)
    setSaving(true)

    const customPoints = bonusPoints !== '' ? Number(bonusPoints) : null
    const finalEduPoints = customPoints !== null && !isNaN(customPoints) ? customPoints : eduPoints

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      timing: timing || null,
      classroom_id: classroomId ?? (selectedClassroom || null),
      require_check: requireCheck,
      requires_submission: requiresSubmission,
      edu_points: finalEduPoints,
      attachment_url: resolvedAttachmentUrl ?? null,
      attachment_name: resolvedAttachmentName ?? null,
    }

    if (isEdit && task) {
      const ok = await updateSmartboardTask(task.id, payload)
      setSaving(false)
      if (ok) onUpdated?.({ ...task, ...payload })
      return
    }

    const created = await createSmartboardTask({
      homeroom_id: homeroomId ?? null,
      ...payload,
    }, createdBy)
    setSaving(false)
    if (created) onCreated?.(created)
  }

  const handleDelete = async () => {
    if (!task) return
    if (!confirm("Delete this homework? It disappears from every student's calendar.")) return
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

  const embedUrl = attachMode === 'youtube' ? youtubeEmbedUrl(youtubeInput) : null

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-t-[1.75rem] sm:rounded-[1.75rem] overflow-hidden shadow-[0_-12px_48px_-12px_rgba(15,23,42,0.32)] sm:shadow-[0_32px_80px_-20px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/[0.06]"
      >
        {/* Header */}
        <FormHeader
          accent="purple"
          icon={isEdit ? <Save size={17} /> : <Plus size={17} />}
          title={heading ?? (isEdit ? 'Homework' : 'New Homework')}
          subtitle={isEdit ? 'Edit this homework for the whole class' : 'Appears on every student’s calendar'}
          actions={
            <>
              {isEdit && (
                <HeaderAction onClick={() => setShowTracking(true)} title="Student tracking">
                  <Users size={16} />
                </HeaderAction>
              )}
              {isEdit && (
                <HeaderAction onClick={handleDelete} title="Delete homework" disabled={deleting}>
                  {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </HeaderAction>
              )}
              <HeaderAction onClick={onCancel} title="Close">
                <X size={17} />
              </HeaderAction>
            </>
          }
        />

        <div className="max-h-[70dvh] sm:max-h-[62dvh] overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 space-y-4 bg-slate-50/60">

        <div>
          <FieldLabel>Title</FieldLabel>
          <input
            type="text" value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Chapter 4 — questions 1 to 8"
            className={INPUT_CLASS}
            autoFocus
          />
        </div>
        <div>
          <FieldLabel hint="(optional)">Description</FieldLabel>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Extra instructions for students…" rows={2}
            className={`${INPUT_CLASS} resize-none`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <FieldLabel>Due date</FieldLabel>
            <input type="date" value={dueDate}
              onChange={e => { setDueDate(e.target.value); setDueDateError(false) }}
              className={`${INPUT_CLASS} ${dueDateError ? '!border-red-400 focus:!ring-red-500/10' : ''}`}
              required
            />
            {dueDateError && <span className="block text-[11px] text-red-600 font-semibold mt-1">Due date is required</span>}
          </div>
          <div>
            <FieldLabel hint="(optional)">Time</FieldLabel>
            <input type="time" value={timing}
              onChange={e => setTiming(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          {showClassroomPicker && (
            <div className="col-span-2">
              <FieldLabel>Classroom</FieldLabel>
              <select
                value={selectedClassroom}
                onChange={e => setSelectedClassroom(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">No classroom</option>
                {classrooms!.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Requirement toggles */}
        <div>
          <FieldLabel>Requirements</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <ToggleCard
              checked={requireCheck}
              onChange={setRequireCheck}
              icon={<ShieldCheck size={16} />}
              label="Needs verification"
              description="Staff confirm before it counts as done"
              activeClass="border-emerald-400 bg-emerald-50/70"
            />
            <ToggleCard
              checked={requiresSubmission}
              onChange={setRequiresSubmission}
              icon={<Send size={16} />}
              label="Needs submission"
              description="Students attach a note or link"
            />
          </div>
        </div>

        {/* Edu points */}
        <PointsPicker
          value={eduPoints}
          custom={bonusPoints}
          onPreset={n => { setEduPoints(n); setBonusPoints('') }}
          onCustom={setBonusPoints}
        />

        {/* Attachment */}
        <div>
          <FieldLabel icon={<Paperclip size={12} />} hint="(optional)">Attachment</FieldLabel>

          {attachMode === 'none' ? (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setAttachMode('youtube')}
                className="flex flex-col items-center justify-center gap-1 py-3 border-2 border-dashed border-slate-200 bg-white rounded-xl text-[11px] font-semibold text-slate-600 hover:border-red-400 hover:text-red-600 transition-colors"
              >
                <Youtube size={16} /> YouTube
              </button>
              <button
                type="button"
                onClick={() => setAttachMode('link')}
                className="flex flex-col items-center justify-center gap-1 py-3 border-2 border-dashed border-slate-200 bg-white rounded-xl text-[11px] font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
              >
                <ExternalLink size={16} /> Link
              </button>
              <button
                type="button"
                onClick={() => setAttachMode('upload')}
                className="flex flex-col items-center justify-center gap-1 py-3 border-2 border-dashed border-slate-200 bg-white rounded-xl text-[11px] font-semibold text-slate-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
              >
                <Upload size={16} /> Doc / Image
              </button>
            </div>
          ) : attachMode === 'youtube' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Youtube size={14} className="text-red-500 flex-shrink-0" />
                <input
                  type="url"
                  value={youtubeInput}
                  onChange={e => setYoutubeInput(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className={`flex-1 ${INPUT_CLASS}`}
                />
                <button type="button" onClick={clearAttachment} className="p-1.5 text-slate-500 hover:text-rose-600 flex-shrink-0">
                  <X size={14} />
                </button>
              </div>
              {embedUrl && (
                <div className="rounded-xl overflow-hidden border border-slate-200 aspect-video shadow-sm">
                  <iframe src={embedUrl} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                </div>
              )}
            </div>
          ) : attachMode === 'link' ? (
            <div className="flex items-center gap-2">
              <Link2 size={14} className="text-blue-500 flex-shrink-0" />
              <input
                type="url"
                value={linkInput}
                onChange={e => setLinkInput(e.target.value)}
                placeholder="https://..."
                className={`flex-1 ${INPUT_CLASS}`}
              />
              <button type="button" onClick={clearAttachment} className="p-1.5 text-slate-500 hover:text-rose-600 flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          ) : /* upload */ attachmentUrl ? (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
              <FileText size={15} className="text-indigo-500 flex-shrink-0" />
              <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-sm font-medium text-indigo-700 hover:underline truncate">{attachmentName || 'Attachment'}</a>
              <button type="button" onClick={clearAttachment} className="p-1 text-slate-500 hover:text-rose-600 flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button" onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-3 border-2 border-dashed border-slate-200 bg-white rounded-xl text-sm font-semibold text-slate-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
              >
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {uploading ? 'Uploading…' : 'Choose file (max 20 MB)'}
              </button>
              <button type="button" onClick={clearAttachment} className="p-2 text-slate-500 hover:text-rose-600 flex-shrink-0">
                <X size={15} />
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
            </div>
          )}
        </div>
        </div>

        <FormFooter
          accent="purple"
          onCancel={onCancel}
          disabled={!title.trim() || saving || uploading}
          submitIcon={saving ? <Loader2 size={15} className="animate-spin" /> : isEdit ? <Save size={15} /> : <Plus size={15} />}
          submitLabel={isEdit ? 'Save changes' : 'Add Homework'}
        />
      </form>

      {/* Student tracking modal */}
      {showTracking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowTracking(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full sm:max-w-3xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
              <Users size={15} className="text-indigo-500" />
              <p className="text-sm font-semibold text-slate-700 flex-1">Student progress</p>
              {completions.length > 0 && (
                <span className="text-xs text-slate-500">{doneCount}/{completions.length} done · {submittedCount} submitted</span>
              )}
              <button type="button" onClick={() => setShowTracking(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {loadingMembers ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-6 px-4"><Loader2 size={13} className="animate-spin" /> Loading…</div>
              ) : completions.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 px-4 text-center">No students.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2">
                  {completions.map(c => (
                    <div key={c.student_id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-50">
                      <Avatar avatarUrl={c.student?.avatar_url} name={c.student?.full_name ?? ''} email={c.student?.email ?? ''} size={26} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{c.student?.full_name ?? 'Unknown'}</p>
                        {c.submission && (
                          <p className="text-[11px] text-slate-500 truncate flex items-center gap-1">
                            {/^https?:\/\//.test(c.submission) ? <Link2 size={10} /> : <FileText size={10} />}
                            {c.submission}
                          </p>
                        )}
                      </div>
                      <button
                        type="button" onClick={() => cycleStatus(c)}
                        className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded flex-shrink-0 ${STATUS_META[c.status].chip}`}
                        title="Tap to change status"
                      >
                        {STATUS_META[c.status].icon}
                        {STATUS_META[c.status].label}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
