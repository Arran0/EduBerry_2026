'use client'

import React, { useState, useRef } from 'react'
import {
  Loader2, Plus, Star, ShieldCheck, Send, Paperclip, Upload, X, FileText,
} from 'lucide-react'
import { Classroom } from '@/lib/classrooms'
import {
  SmartboardTask,
  createSmartboardTask,
  uploadSmartboardTaskAttachment,
} from '@/lib/smartboard'

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
  onCancel: () => void
  onCreated: (task: SmartboardTask) => void
}

/**
 * The shared "new homework" creation box — mirrors the new-file form in
 * Course Work. Used inline in the classroom Homework tab and inside a modal
 * when expanded from the smart board's weekly calendar.
 */
export default function SmartboardHomeworkForm({
  createdBy, homeroomId, classroomId, classrooms,
  defaultTitle = '', defaultDueDate = '', heading = 'New Homework',
  onCancel, onCreated,
}: SmartboardHomeworkFormProps) {
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(defaultDueDate)
  const [timing, setTiming] = useState('')
  const [selectedClassroom, setSelectedClassroom] = useState(classroomId ?? '')
  const [requireCheck, setRequireCheck] = useState(false)
  const [requiresSubmission, setRequiresSubmission] = useState(false)
  const [eduPoints, setEduPoints] = useState(0)
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [attachmentName, setAttachmentName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Show a classroom picker only when the caller offers a choice.
  const showClassroomPicker = !classroomId && !!classrooms && classrooms.length > 0
  const effectiveClassroom = classroomId ?? (selectedClassroom || null)

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
    if (created) onCreated(created)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl p-4 space-y-3 border border-slate-200 shadow-sm"
    >
      <p className="text-xs font-semibold text-slate-600">{heading}</p>

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
            <span className="flex-1 min-w-0 text-sm text-slate-600 truncate">{attachmentName || 'Attachment'}</span>
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

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700 px-2">Cancel</button>
        <button
          type="submit" disabled={!title.trim() || saving || uploading}
          className="flex items-center gap-1.5 text-sm font-semibold text-white px-3.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 bg-indigo-600 hover:bg-indigo-700"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add Homework
        </button>
      </div>
    </form>
  )
}
