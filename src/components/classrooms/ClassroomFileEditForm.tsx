'use client'

import React, { useState, useRef } from 'react'
import { askConfirm } from '@/components/ui/sheet'
import { safeHref } from '@/lib/safeUrl'
import {
  Loader2, Save, Trash2, ShieldCheck, Send, Paperclip,
  Upload, X, FileText, Users, Link2, Youtube, ExternalLink,
} from 'lucide-react'
import {
  ClassroomFile, ClassroomFolder,
  updateFile, deleteFile, uploadClassroomFile,
} from '@/lib/classrooms'
import {
  FormHeader, HeaderAction, FieldLabel, ToggleCard, PointsPicker, FormFooter, INPUT_CLASS, FORM_SHELL, FORM_BODY,
} from '@/components/classrooms/WorkFormKit'

type WorkFile = ClassroomFile & { folder: ClassroomFolder }
type AttachMode = 'none' | 'youtube' | 'link' | 'upload'

function guessMode(file: WorkFile): AttachMode {
  if (!file.attachment_url) return 'none'
  if (/youtube\.com|youtu\.be/i.test(file.attachment_url)) return 'youtube'
  const name = file.attachment_name ?? ''
  if (name && /\.[a-z]{2,5}$/i.test(name) && !name.startsWith('http')) return 'upload'
  return 'link'
}

interface Props {
  file: WorkFile
  onCancel: () => void
  onUpdated: (file: WorkFile) => void
  onDeleted: (fileId: string) => void
  onTrack?: (fileId: string) => void
}

export default function ClassroomFileEditForm({ file, onCancel, onUpdated, onDeleted, onTrack }: Props) {
  const [title, setTitle] = useState(file.title)
  const [description, setDescription] = useState(file.description ?? '')
  const [dueDate, setDueDate] = useState(file.due_date ?? '')
  const [requiresCheck, setRequiresCheck] = useState(file.requires_check)
  const [requiresSubmission, setRequiresSubmission] = useState(file.requires_submission)
  const [eduPoints, setEduPoints] = useState(file.edu_points || 1)
  const [bonusPoints, setBonusPoints] = useState('')

  const initMode = guessMode(file)
  const [attachMode, setAttachMode] = useState<AttachMode>(initMode)
  const [attachmentUrl, setAttachmentUrl] = useState(file.attachment_url ?? '')
  const [attachmentName, setAttachmentName] = useState(file.attachment_name ?? '')
  const [youtubeInput, setYoutubeInput] = useState(initMode === 'youtube' ? (file.attachment_url ?? '') : '')
  const [linkInput, setLinkInput] = useState(initMode === 'link' ? (file.attachment_url ?? '') : '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const clearAttachment = () => {
    setAttachmentUrl(''); setAttachmentName('')
    setYoutubeInput(''); setLinkInput('')
    setAttachMode('none')
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    const res = await uploadClassroomFile(file.folder.classroom_id, f)
    setUploading(false)
    if ('url' in res) { setAttachmentUrl(res.url); setAttachmentName(res.name) }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const resolvedUrl = attachMode === 'youtube' ? youtubeInput.trim() || null
    : attachMode === 'link' ? linkInput.trim() || null
    : attachMode === 'upload' ? attachmentUrl || null : null

  const resolvedName = attachMode === 'youtube' ? youtubeInput.trim() || null
    : attachMode === 'link' ? linkInput.trim() || null
    : attachMode === 'upload' ? attachmentName || null : null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)

    const customPts = bonusPoints !== '' ? Number(bonusPoints) : null
    const finalPts = customPts !== null && !isNaN(customPts) ? customPts : eduPoints

    const ok = await updateFile(file.id, {
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      requires_submission: requiresSubmission,
      requires_check: requiresCheck,
      edu_points: finalPts,
      attachment_url: resolvedUrl,
      attachment_name: resolvedName,
    })
    setSaving(false)
    if (ok) {
      onUpdated({
        ...file,
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        requires_submission: requiresSubmission,
        requires_check: requiresCheck,
        edu_points: finalPts,
        attachment_url: resolvedUrl,
        attachment_name: resolvedName,
      })
    }
  }

  const handleDelete = async () => {
    if (!(await askConfirm({ title: 'Delete this classwork?', body: 'Students lose their progress on it.', danger: true }))) return
    setDeleting(true)
    const ok = await deleteFile(file.id)
    setDeleting(false)
    if (ok) onDeleted(file.id)
  }

  return (
    <form
      onSubmit={handleSave}
      className={FORM_SHELL}
    >
      {/* Header */}
      <FormHeader
        icon={<FileText size={17} />}
        title="Classwork"
        subtitle={file.folder.title}
        actions={
          <>
            {onTrack && (
              <HeaderAction onClick={() => onTrack(file.id)} title="Student tracking">
                <Users size={16} />
              </HeaderAction>
            )}
            <HeaderAction onClick={handleDelete} title="Delete classwork" disabled={deleting}>
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            </HeaderAction>
            <HeaderAction onClick={onCancel} title="Close">
              <X size={17} />
            </HeaderAction>
          </>
        }
      />

      <div className={FORM_BODY}>

      <div>
        <FieldLabel>Title</FieldLabel>
        <input
          type="text" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Classwork title" autoFocus
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <FieldLabel hint="(optional)">Description</FieldLabel>
        <textarea
          value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Extra instructions for students…" rows={2}
          className={`${INPUT_CLASS} resize-none`}
        />
      </div>

      <div>
        <FieldLabel>Due date</FieldLabel>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      {/* Toggles */}
      <div>
        <FieldLabel>Requirements</FieldLabel>
        <div className="flex flex-wrap gap-2">
          <ToggleCard
            checked={requiresCheck}
            onChange={setRequiresCheck}
            icon={<ShieldCheck size={16} />}
            label="Needs staff check"
            description="Staff confirm before it counts as done"
            activeClass="border-emerald-400 bg-emerald-50/70"
          />
          <ToggleCard
            checked={requiresSubmission}
            onChange={setRequiresSubmission}
            icon={<Send size={16} />}
            label="Needs submission"
            description="Students attach a note or file"
          />
        </div>
      </div>

      {/* Edu Points */}
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
            <button type="button" onClick={() => setAttachMode('youtube')}
              className="flex flex-col items-center justify-center gap-0.5 py-2 border border-dashed border-slate-200 bg-white rounded-lg text-[10px] font-semibold text-slate-600 hover:border-red-400 hover:text-red-600 transition-colors">
              <Youtube size={14} /> YouTube
            </button>
            <button type="button" onClick={() => setAttachMode('link')}
              className="flex flex-col items-center justify-center gap-0.5 py-2 border border-dashed border-slate-200 bg-white rounded-lg text-[10px] font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors">
              <ExternalLink size={14} /> Link
            </button>
            <button type="button" onClick={() => setAttachMode('upload')}
              className="flex flex-col items-center justify-center gap-0.5 py-2 border border-dashed border-slate-200 bg-white rounded-lg text-[10px] font-semibold text-slate-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
              <Upload size={14} /> Doc / Image
            </button>
          </div>
        ) : attachMode === 'youtube' ? (
          <div className="flex items-center gap-2">
            <Youtube size={14} className="text-red-500 flex-shrink-0" />
            <input type="url" value={youtubeInput} onChange={e => setYoutubeInput(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className={`flex-1 ${INPUT_CLASS}`} />
            <button type="button" onClick={clearAttachment} className="p-1.5 text-slate-500 hover:text-rose-600 flex-shrink-0"><X size={14} /></button>
          </div>
        ) : attachMode === 'link' ? (
          <div className="flex items-center gap-2">
            <Link2 size={14} className="text-blue-500 flex-shrink-0" />
            <input type="url" value={linkInput} onChange={e => setLinkInput(e.target.value)}
              placeholder="https://..."
              className={`flex-1 ${INPUT_CLASS}`} />
            <button type="button" onClick={clearAttachment} className="p-1.5 text-slate-500 hover:text-rose-600 flex-shrink-0"><X size={14} /></button>
          </div>
        ) : attachmentUrl ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <FileText size={15} className="text-indigo-500 flex-shrink-0" />
            <a href={safeHref(attachmentUrl)} target="_blank" rel="noopener noreferrer"
              className="flex-1 min-w-0 text-sm font-medium text-indigo-700 hover:underline break-words">{attachmentName || 'Attachment'}</a>
            <button type="button" onClick={clearAttachment} className="p-1 text-slate-500 hover:text-rose-600 flex-shrink-0"><X size={14} /></button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-dashed border-slate-200 bg-white rounded-lg text-xs font-semibold text-slate-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {uploading ? 'Uploading…' : 'Choose file (max 20 MB)'}
            </button>
            <button type="button" onClick={clearAttachment} className="p-2 text-slate-500 hover:text-rose-600 flex-shrink-0"><X size={15} /></button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
          </div>
        )}
      </div>
      </div>

      <FormFooter
        onCancel={onCancel}
        disabled={!title.trim() || saving || uploading}
        submitIcon={saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        submitLabel="Save changes"
      />
    </form>
  )
}
