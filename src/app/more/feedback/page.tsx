'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare,
  Send,
  Paperclip,
  X,
  ChevronDown,
  ChevronUp,
  Download,
  Reply,
  Clock,
  CheckCircle,
  Trash2,
  AlertTriangle,
  FileText,
  ImageIcon,
  Plus,
  Inbox,
  MailCheck,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import PageBanner from '@/components/PageBanner'
import { FEEDBACK_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  FeedbackWithDetails,
  NewFeedbackInput,
  submitFeedback,
  fetchMyFeedbacks,
  fetchAllFeedbacks,
  replyToFeedback,
  deleteFeedback,
  getSignedFileUrl,
  formatFileSize,
  validateFile,
} from '@/lib/feedback'

// ---------- helpers ----------

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHrs = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHrs / 24)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHrs < 24) return `${diffHrs}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---------- File Attachment / Preview ----------

function isImage(name: string) {
  return /\.(jpe?g|png|gif|webp|svg)$/i.test(name)
}

interface AttachmentViewProps {
  filePath: string
  fileName: string
  fileSize: number | null
  signed?: boolean
}

function AttachmentView({ filePath, fileName, fileSize, signed = true }: AttachmentViewProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const img = isImage(fileName)

  useEffect(() => {
    if (!img || !signed) return
    setLoading(true)
    getSignedFileUrl(filePath).then(url => { setSignedUrl(url); setLoading(false) })
  }, [filePath, img, signed])

  if (img) {
    const src = signed ? signedUrl : filePath
    return (
      <div className="space-y-1.5">
        {loading && <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />}
        {src && (
          <a href={src} target="_blank" rel="noopener noreferrer">
            <img src={src} alt={fileName}
              className="rounded-xl max-h-60 max-w-full object-contain border border-slate-100 hover:opacity-90 transition-opacity" />
          </a>
        )}
        {fileSize != null && <p className="text-xs text-slate-400">{formatFileSize(fileSize)}</p>}
      </div>
    )
  }

  return (
    <FileDownloadButton filePath={filePath} fileName={fileName} fileSize={fileSize} />
  )
}

type FilterType = 'all' | 'pending' | 'replied'

// ---------- File Download Button ----------

interface FileDownloadButtonProps {
  filePath: string
  fileName: string
  fileSize: number | null
}

function FileDownloadButton({ filePath, fileName, fileSize }: FileDownloadButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleDownload = async () => {
    setLoading(true)
    const url = await getSignedFileUrl(filePath)
    if (url) {
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
    setLoading(false)
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
    >
      {isImage(fileName) ? <ImageIcon size={14} /> : <FileText size={14} />}
      <span className="max-w-[160px] truncate">{fileName}</span>
      {fileSize != null && (
        <span className="text-slate-400 flex-shrink-0">({formatFileSize(fileSize)})</span>
      )}
      <Download size={12} className="flex-shrink-0" />
      {loading && <span className="flex-shrink-0 text-slate-400">…</span>}
    </button>
  )
}

// ---------- New Feedback Form ----------

interface NewFeedbackFormProps {
  onSubmitted: () => void
  onCancel: () => void
  userId: string
}

function NewFeedbackForm({ onSubmitted, onCancel, userId }: NewFeedbackFormProps) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null
    setFileError(null)
    if (selected) {
      const err = validateFile(selected)
      if (err) { setFileError(err); return }
    }
    setFile(selected)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim() || !message.trim()) return
    setSubmitting(true)
    setError(null)

    const input: NewFeedbackInput = { subject, message, file: file || undefined }
    const { error: submitError } = await submitFeedback(input, userId)

    if (submitError) {
      setError(submitError)
      setSubmitting(false)
      return
    }

    setSubject('')
    setMessage('')
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    onSubmitted()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
    >
      {/* Form header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-purple-50">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-indigo-100 rounded-lg">
            <MessageSquare size={15} className="text-indigo-600" />
          </div>
          <h2 className="font-semibold text-slate-800 text-sm">New Feedback</h2>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white/80 rounded-lg transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">
            Subject <span className="text-red-400 normal-case font-normal tracking-normal">*</span>
          </label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Brief subject of your feedback"
            required
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 bg-slate-50 focus:bg-white transition-colors"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">
            Message <span className="text-red-400 normal-case font-normal tracking-normal">*</span>
          </label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Describe your feedback, suggestion, or concern in detail…"
            rows={5}
            required
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 bg-slate-50 focus:bg-white transition-colors resize-none"
          />
        </div>

        {/* File attachment */}
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">
            Attachment <span className="text-slate-400 font-normal normal-case tracking-normal">(optional — max 10 MB)</span>
          </label>
          {file ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                {isImage(file.name) ? <ImageIcon size={14} className="text-indigo-500 flex-shrink-0" /> : <FileText size={14} className="text-slate-400 flex-shrink-0" />}
                <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">{file.name}</span>
                <span className="text-xs text-slate-400 flex-shrink-0">{formatFileSize(file.size)}</span>
                <button type="button"
                  onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                  className="p-1 text-slate-400 hover:text-red-500 transition-colors rounded">
                  <X size={14} />
                </button>
              </div>
              {isImage(file.name) && (
                <img src={URL.createObjectURL(file)} alt={file.name}
                  className="rounded-xl max-h-56 max-w-full object-contain border border-slate-100" />
              )}
            </div>
          ) : (
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-400 hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50/50 transition-colors w-full">
              <Paperclip size={15} />
              Attach an image or document
            </button>
          )}
          <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden"
            accept="image/*,.pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx,.zip" />
          {fileError && (
            <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
              <AlertTriangle size={12} /> {fileError}
            </p>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <AlertTriangle size={15} className="flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={submitting || !subject.trim() || !message.trim()}
            className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <Send size={15} />
                Submit Feedback
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </motion.div>
  )
}

// ---------- User Feedback Card ----------

function UserFeedbackCard({ feedback }: { feedback: FeedbackWithDetails }) {
  const [expanded, setExpanded] = useState(false)
  const replied = !!feedback.reply

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white border rounded-2xl overflow-hidden shadow-sm ${replied ? 'border-green-200' : 'border-slate-200'}`}
    >
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full p-4 flex items-start justify-between gap-3 text-left hover:bg-slate-50/60 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Status dot */}
          <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${replied ? 'bg-green-100' : 'bg-amber-100'}`}>
            {replied
              ? <MailCheck size={16} className="text-green-600" />
              : <Clock size={16} className="text-amber-600" />}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 text-sm truncate">{feedback.subject}</p>
            <p className="text-xs text-slate-400 mt-0.5">{formatRelativeDate(feedback.created_at)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
            replied ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {replied ? 'Replied' : 'Pending'}
          </span>
          {expanded ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-slate-100 pt-3">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Your Message</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 rounded-xl p-3">{feedback.message}</p>
              </div>

              {feedback.file_url && feedback.file_name && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Attachment</p>
                  <AttachmentView filePath={feedback.file_url} fileName={feedback.file_name} fileSize={feedback.file_size} />
                </div>
              )}

              {replied ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <Reply size={13} className="text-green-600" />
                    <p className="text-xs font-semibold text-green-700">
                      Admin Reply
                      {feedback.replied_at && (
                        <span className="font-normal text-green-500 ml-1.5">
                          · {formatRelativeDate(feedback.replied_at)}
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{feedback.reply}</p>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
                  <Clock size={13} className="text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-700">Awaiting a response from admin.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ---------- Admin Feedback Card ----------

interface AdminFeedbackCardProps {
  feedback: FeedbackWithDetails
  adminId: string
  onDeleted: (id: string) => void
  onReplied: (id: string, reply: string) => void
}

function AdminFeedbackCard({ feedback, adminId, onDeleted, onReplied }: AdminFeedbackCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [replyText, setReplyText] = useState(feedback.reply || '')
  const [editing, setEditing] = useState(!feedback.reply)
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)

  const handleReply = async () => {
    if (!replyText.trim()) return
    setSaving(true)
    setReplyError(null)
    const ok = await replyToFeedback(feedback.id, replyText, adminId)
    if (ok) {
      onReplied(feedback.id, replyText.trim())
      setEditing(false)
    } else {
      setReplyError('Failed to save reply. Please try again.')
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    setDeleting(true)
    const ok = await deleteFeedback(feedback.id)
    if (ok) onDeleted(feedback.id)
    setDeleting(false)
  }

  const submitter = feedback.submitter
  const replied = !!feedback.reply

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white border rounded-2xl overflow-hidden shadow-sm ${replied ? 'border-green-200' : 'border-slate-200'}`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full p-4 flex items-start justify-between gap-3 text-left hover:bg-slate-50/60 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Avatar avatarUrl={submitter?.avatar_url} name={submitter?.full_name} size={38} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-slate-800 text-sm">{submitter?.full_name || 'Unknown'}</p>
              <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-md capitalize">
                {submitter?.role || '—'}
              </span>
            </div>
            <p className="text-xs text-slate-500 truncate mt-0.5">{feedback.subject}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
            replied ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {replied ? 'Replied' : 'Pending'}
          </span>
          <p className="text-xs text-slate-400 hidden sm:block">{formatRelativeDate(feedback.created_at)}</p>
          {expanded ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
        </div>
      </button>

      {/* Body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-slate-100 pt-3">
              {/* Submitter meta */}
              <p className="text-xs text-slate-400">
                {submitter?.email} · {new Date(feedback.created_at).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })}
              </p>

              {/* Message */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Message</p>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{feedback.message}</p>
                </div>
              </div>

              {/* File */}
              {feedback.file_url && feedback.file_name && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Attachment</p>
                  <AttachmentView filePath={feedback.file_url} fileName={feedback.file_name} fileSize={feedback.file_size} />
                </div>
              )}

              {/* Reply */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Reply</p>
                  {replied && !editing && (
                    <button
                      onClick={e => { e.stopPropagation(); setEditing(true) }}
                      className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      Edit reply
                    </button>
                  )}
                </div>

                {editing ? (
                  <div className="space-y-2" onClick={e => e.stopPropagation()}>
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder="Write your reply…"
                      rows={3}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 bg-slate-50 focus:bg-white transition-colors resize-none"
                    />
                    {replyError && (
                      <p className="text-xs text-red-600 flex items-center gap-1">
                        <AlertTriangle size={12} /> {replyError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleReply}
                        disabled={saving || !replyText.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                      >
                        {saving ? (
                          <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : <Send size={13} />}
                        {saving ? 'Saving…' : 'Send Reply'}
                      </button>
                      {replied && (
                        <button
                          onClick={() => { setEditing(false); setReplyText(feedback.reply || '') }}
                          className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3.5">
                    <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{feedback.reply}</p>
                    {feedback.replied_at && (
                      <p className="text-xs text-green-500 mt-1.5">
                        Replied {formatRelativeDate(feedback.replied_at)}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Delete */}
              <div className="pt-1 border-t border-slate-100">
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-slate-600 flex-1">Delete this feedback permanently?</p>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      {deleting ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Trash2 size={12} />}
                      Delete
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={13} />
                    Delete feedback
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ---------- Main Page ----------

export default function FeedbackPage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const isAdmin = profile?.role === 'admin'

  const [feedbacks, setFeedbacks] = useState<FeedbackWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState<FilterType>('all')

  const loadFeedbacks = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    const data = isAdmin
      ? await fetchAllFeedbacks()
      : await fetchMyFeedbacks(user.id)
    setFeedbacks(data)
    setLoading(false)
  }, [user, profile, isAdmin])

  useEffect(() => { loadFeedbacks() }, [loadFeedbacks])

  const handleSubmitted = () => {
    setShowForm(false)
    loadFeedbacks()
  }

  const handleDeleted = (id: string) => {
    setFeedbacks(prev => prev.filter(f => f.id !== id))
  }

  const handleReplied = (id: string, reply: string) => {
    setFeedbacks(prev => prev.map(f =>
      f.id === id
        ? { ...f, reply, replied_by: user!.id, replied_at: new Date().toISOString() }
        : f
    ))
  }

  const pendingCount = feedbacks.filter(f => !f.reply).length
  const repliedCount = feedbacks.filter(f => !!f.reply).length

  const filtered = feedbacks.filter(f => {
    if (filter === 'pending') return !f.reply
    if (filter === 'replied') return !!f.reply
    return true
  })

  const filterMeta: Record<FilterType, { label: string; color: string; bg: string; activeBg: string }> = {
    all:     { label: `All (${feedbacks.length})`,      color: 'text-slate-700',  bg: 'bg-slate-100',  activeBg: 'bg-slate-200' },
    pending: { label: `Pending (${pendingCount})`,       color: 'text-amber-700',  bg: 'bg-amber-50',   activeBg: 'bg-amber-100' },
    replied: { label: `Replied (${repliedCount})`,       color: 'text-green-700',  bg: 'bg-green-50',   activeBg: 'bg-green-100' },
  }

  return (
    <ProtectedLayout>
      <div data-page-theme="feedback">

        <PageBanner
          settingKey="feedback_banner"
          defaultBanner={FEEDBACK_BANNER_DEFAULT}
          icon={<MessageSquare size={26} className="text-white" />}
          title={isAdmin ? 'All Feedback' : 'Feedback'}
          subtitle={isAdmin ? 'Review and respond to feedback from users' : 'Share your thoughts, suggestions, or concerns'}
          isAdmin={isAdmin}
          onBack={() => router.back()}
          maxWidth="max-w-3xl"
          actions={!isAdmin ? (
            <>
              <button
                onClick={() => setShowForm(p => !p)}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white font-medium text-sm rounded-xl border border-white/30 transition-colors"
              >
                {showForm ? <X size={15} /> : <Plus size={15} />}
                {showForm ? 'Cancel' : 'New Feedback'}
              </button>
              <button
                onClick={() => setShowForm(p => !p)}
                className="sm:hidden w-10 h-10 bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center text-white transition-colors"
              >
                {showForm ? <X size={16} /> : <Plus size={18} />}
              </button>
            </>
          ) : undefined}
        />

        {/* ── Content area ── */}
        <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">

          {/* Admin stats row */}
          {isAdmin && feedbacks.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-3.5 text-center shadow-sm">
                <p className="text-2xl font-bold text-slate-800">{feedbacks.length}</p>
                <p className="text-xs text-slate-500 mt-0.5">Total</p>
              </div>
              <div className="bg-white border border-amber-200 rounded-2xl p-3.5 text-center shadow-sm">
                <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
                <p className="text-xs text-slate-500 mt-0.5">Pending</p>
              </div>
              <div className="bg-white border border-green-200 rounded-2xl p-3.5 text-center shadow-sm">
                <p className="text-2xl font-bold text-green-600">{repliedCount}</p>
                <p className="text-xs text-slate-500 mt-0.5">Replied</p>
              </div>
            </div>
          )}

          {/* New Feedback Form */}
          <AnimatePresence>
            {showForm && user && (
              <div className="mb-4">
                <NewFeedbackForm userId={user.id} onSubmitted={handleSubmitted} onCancel={() => setShowForm(false)} />
              </div>
            )}
          </AnimatePresence>

          {/* Filter tabs (admin only) */}
          {isAdmin && feedbacks.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-1.5 flex gap-1 mb-4 shadow-sm">
              {(['all', 'pending', 'replied'] as FilterType[]).map(f => {
                const meta = filterMeta[f]
                const isActive = filter === f
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium capitalize transition-all ${
                      isActive
                        ? `${meta.activeBg} ${meta.color} shadow-sm`
                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {meta.label}
                  </button>
                )
              })}
            </div>
          )}

          {/* Feedback list */}
          {loading ? (
            <div className="text-center py-16">
              <div className="spinner mx-auto mb-3" />
              <p className="text-sm text-slate-500">Loading feedback…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
              <Inbox size={40} className="text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 text-sm font-medium">
                {filter !== 'all'
                  ? `No ${filter} feedback.`
                  : isAdmin
                  ? 'No feedback received yet.'
                  : 'You haven\'t submitted any feedback yet.'}
              </p>
              {!isAdmin && !showForm && filter === 'all' && (
                <button
                  onClick={() => setShowForm(true)}
                  className="mt-4 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Submit your first feedback
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {filtered.map(f =>
                  isAdmin ? (
                    <AdminFeedbackCard
                      key={f.id}
                      feedback={f}
                      adminId={user!.id}
                      onDeleted={handleDeleted}
                      onReplied={handleReplied}
                    />
                  ) : (
                    <UserFeedbackCard key={f.id} feedback={f} />
                  )
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
