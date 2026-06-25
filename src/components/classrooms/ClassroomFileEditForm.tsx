'use client'

import React, { useState, useRef } from 'react'
import {
  Loader2, Save, Trash2, Star, ShieldCheck, Send, Paperclip,
  Upload, X, FileText, Users, Link2, Youtube, ExternalLink,
} from 'lucide-react'
import {
  ClassroomFile, ClassroomFolder,
  updateFile, deleteFile, uploadClassroomFile,
} from '@/lib/classrooms'

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
    if (!confirm('Delete this classwork? Students will lose their progress.')) return
    setDeleting(true)
    const ok = await deleteFile(file.id)
    setDeleting(false)
    if (ok) onDeleted(file.id)
  }

  return (
    <form onSubmit={handleSave} className="bg-white rounded-2xl p-4 space-y-3 border border-slate-200 shadow-sm">

      {/* Header */}
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-slate-600 flex-1">Classwork · {file.folder.title}</p>
        {onTrack && (
          <button type="button" onClick={() => onTrack(file.id)}
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Student tracking">
            <Users size={15} />
          </button>
        )}
        <button type="button" onClick={handleDelete} disabled={deleting}
          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50" title="Delete classwork">
          {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
        </button>
        <button type="button" onClick={onCancel} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
          <X size={16} />
        </button>
      </div>

      <input
        type="text" value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Classwork title" autoFocus
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
      />
      <textarea
        value={description} onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)" rows={2}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50 resize-none"
      />

      <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
        className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
      />

      {/* Toggles */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={requiresCheck} onChange={e => setRequiresCheck(e.target.checked)} className="rounded" />
          <ShieldCheck size={14} className={requiresCheck ? 'text-green-600' : 'text-slate-400'} /> Needs staff check
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={requiresSubmission} onChange={e => setRequiresSubmission(e.target.checked)} className="rounded" />
          <Send size={14} className={requiresSubmission ? 'text-indigo-600' : 'text-slate-400'} /> Needs submission
        </label>
      </div>

      {/* Edu Points */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
          <Star size={12} className="text-amber-500" /> Edu Points
          <span className="text-slate-400 font-normal">— awarded on completion</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" onClick={() => { setEduPoints(n); setBonusPoints('') }}
              className={`min-w-[34px] px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                eduPoints === n && bonusPoints === ''
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'text-slate-600 border-slate-200 hover:bg-amber-50 hover:border-amber-200'
              }`}
            >
              {n}
            </button>
          ))}
          <input
            type="number" min={0} step={1} value={bonusPoints}
            onChange={e => setBonusPoints(e.target.value)} placeholder="Custom"
            className={`w-20 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/50 ${
              bonusPoints !== '' ? 'bg-amber-500 text-white border-amber-500 placeholder-amber-200' : 'text-slate-600 border-slate-200'
            }`}
          />
        </div>
      </div>

      {/* Attachment */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
          <Paperclip size={12} /> Attachment (optional)
        </p>
        {attachMode === 'none' ? (
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => setAttachMode('youtube')}
              className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-red-400 hover:text-red-600 transition-colors">
              <Youtube size={13} /> YouTube
            </button>
            <button type="button" onClick={() => setAttachMode('link')}
              className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
              <ExternalLink size={13} /> Link
            </button>
            <button type="button" onClick={() => setAttachMode('upload')}
              className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
              <Upload size={13} /> Doc / Image
            </button>
          </div>
        ) : attachMode === 'youtube' ? (
          <div className="flex items-center gap-2">
            <Youtube size={14} className="text-red-500 flex-shrink-0" />
            <input type="url" value={youtubeInput} onChange={e => setYoutubeInput(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/50" />
            <button type="button" onClick={clearAttachment} className="p-1.5 text-slate-400 hover:text-rose-600 flex-shrink-0"><X size={14} /></button>
          </div>
        ) : attachMode === 'link' ? (
          <div className="flex items-center gap-2">
            <Link2 size={14} className="text-blue-500 flex-shrink-0" />
            <input type="url" value={linkInput} onChange={e => setLinkInput(e.target.value)}
              placeholder="https://..."
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/50" />
            <button type="button" onClick={clearAttachment} className="p-1.5 text-slate-400 hover:text-rose-600 flex-shrink-0"><X size={14} /></button>
          </div>
        ) : attachmentUrl ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <FileText size={14} className="text-indigo-500 flex-shrink-0" />
            <a href={attachmentUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 min-w-0 text-sm text-indigo-600 hover:underline truncate">{attachmentName || 'Attachment'}</a>
            <button type="button" onClick={clearAttachment} className="p-1 text-slate-400 hover:text-rose-600 flex-shrink-0"><X size={14} /></button>
          </div>
        ) : (
          <>
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors w-full">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? 'Uploading…' : 'Choose file (max 20 MB)'}
              <X size={14} className="ml-auto text-slate-300" onClick={e => { e.stopPropagation(); clearAttachment() }} />
            </button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700 px-2">Cancel</button>
        <button type="submit" disabled={!title.trim() || saving || uploading}
          className="flex items-center gap-1.5 text-sm font-semibold text-white px-3.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 bg-indigo-600 hover:bg-indigo-700">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save changes
        </button>
      </div>
    </form>
  )
}
