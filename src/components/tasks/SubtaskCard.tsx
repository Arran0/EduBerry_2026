'use client'

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Edit3,
  Check,
  Calendar,
  Clock,
  ChevronRight,
  FolderKanban,
  Square,
  CheckSquare,
  Plus,
  Trash2,
  Send,
  Paperclip,
  Image as ImageIcon,
  FileText,
  ExternalLink,
  Star,
} from 'lucide-react'
import {
  getDynamicStatusLabel,
  getDynamicStatusColors,
  getDynamicDotColor,
} from '@/lib/tasks'
import {
  Subtask,
  SubtaskWithProject,
  updateSubtask,
  SubtaskChecklistItem,
  fetchSubtaskChecklist,
  addSubtaskChecklistItem,
  toggleSubtaskChecklistItem,
  deleteSubtaskChecklistItem,
  SubtaskComment,
  fetchSubtaskComments,
  addSubtaskComment,
  uploadSubtaskAttachment,
} from '@/lib/projects'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'

type AnySubtask = Subtask | SubtaskWithProject

function isWithProject(s: AnySubtask): s is SubtaskWithProject {
  return 'project_title' in s
}

interface SubtaskCardProps {
  subtask: AnySubtask
  canCheck: boolean
  canEdit: boolean
  onClose: () => void
  onStatusTap: (s: AnySubtask) => void
  onSubtaskUpdated: () => void
  onDelete?: () => void
}

export default function SubtaskCard({
  subtask,
  canCheck,
  canEdit,
  onClose,
  onStatusTap,
  onSubtaskUpdated,
  onDelete,
}: SubtaskCardProps) {
  const { user } = useAuth()

  // ── Edit state ──────────────────────────────────────────────────────────────
  const [editing, setEditing]             = useState(false)
  const [editTitle, setEditTitle]         = useState(subtask.title)
  const [editDesc, setEditDesc]           = useState(subtask.description || '')
  const [editDueDate, setEditDueDate]     = useState(subtask.due_date || '')
  const [editTiming, setEditTiming]       = useState(subtask.timing || '')
  const [editBonusPoints, setEditBonusPoints] = useState<number>(subtask.bonus_points || 0)
  const [saving, setSaving]               = useState(false)

  // ── Checklist state ─────────────────────────────────────────────────────────
  const [checklist, setChecklist]         = useState<SubtaskChecklistItem[]>([])
  const [checklistLoading, setChecklistLoading] = useState(true)
  const [newCheckText, setNewCheckText]   = useState('')
  const [addingCheck, setAddingCheck]     = useState(false)

  // ── Comments state ──────────────────────────────────────────────────────────
  const [comments, setComments]           = useState<SubtaskComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [commentText, setCommentText]     = useState('')
  const [commentFiles, setCommentFiles]   = useState<File[]>([])
  const [sendingComment, setSendingComment] = useState(false)
  const fileInputRef                      = useRef<HTMLInputElement>(null)

  // ── Load checklist and comments ─────────────────────────────────────────────
  useEffect(() => {
    setChecklistLoading(true)
    fetchSubtaskChecklist(subtask.id).then(items => {
      setChecklist(items)
      setChecklistLoading(false)
    })
    setCommentsLoading(true)
    fetchSubtaskComments(subtask.id).then(items => {
      setComments(items)
      setCommentsLoading(false)
    })
  }, [subtask.id])

  // ── Edit handlers ────────────────────────────────────────────────────────────
  const handleStartEdit = () => {
    setEditTitle(subtask.title)
    setEditDesc(subtask.description || '')
    setEditDueDate(subtask.due_date || '')
    setEditTiming(subtask.timing || '')
    setEditBonusPoints(subtask.bonus_points || 0)
    setEditing(true)
  }

  const handleSave = async () => {
    if (!editTitle.trim()) return
    setSaving(true)
    const ok = await updateSubtask(subtask.id, {
      title: editTitle.trim(),
      description: editDesc.trim() || null,
      due_date: editDueDate || null,
      timing: editTiming || null,
      bonus_points: editBonusPoints,
      tag: editBonusPoints > 0 ? 'bonus' : null,
    })
    setSaving(false)
    if (ok) { setEditing(false); onSubtaskUpdated() }
  }

  // ── Checklist handlers ────────────────────────────────────────────────────
  const handleAddCheckItem = async () => {
    if (!newCheckText.trim()) return
    setAddingCheck(true)
    const item = await addSubtaskChecklistItem(subtask.id, newCheckText.trim(), checklist.length)
    if (item) { setChecklist(prev => [...prev, item]); setNewCheckText('') }
    setAddingCheck(false)
  }

  const handleToggleCheck = async (item: SubtaskChecklistItem) => {
    const ok = await toggleSubtaskChecklistItem(item.id, !item.is_completed)
    if (ok) {
      setChecklist(prev => prev.map(i => i.id === item.id ? { ...i, is_completed: !i.is_completed } : i))
    }
  }

  const handleDeleteCheckItem = async (itemId: string) => {
    const ok = await deleteSubtaskChecklistItem(itemId)
    if (ok) setChecklist(prev => prev.filter(i => i.id !== itemId))
  }

  // ── Comment handlers ─────────────────────────────────────────────────────────
  const handleSendComment = async () => {
    if (!commentText.trim() && commentFiles.length === 0) return
    if (!user) return
    setSendingComment(true)

    const uploaded: { url: string; name: string; type: 'image' | 'document' }[] = []
    for (const file of commentFiles) {
      const result = await uploadSubtaskAttachment(file, subtask.id, user.id)
      if (result) uploaded.push(result)
    }

    const comment = await addSubtaskComment(subtask.id, user.id, commentText.trim(), uploaded)
    if (comment) {
      // Refetch to get full author info
      const updated = await fetchSubtaskComments(subtask.id)
      setComments(updated)
      setCommentText('')
      setCommentFiles([])
    }
    setSendingComment(false)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setCommentFiles(prev => [...prev, ...files])
    e.target.value = ''
  }

  const removeFile = (idx: number) => setCommentFiles(prev => prev.filter((_, i) => i !== idx))

  const completedCount = checklist.filter(i => i.is_completed).length

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="sticky top-0 bg-white rounded-t-3xl border-b border-slate-100 p-5 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => onStatusTap(subtask)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 font-bold text-sm transition-all active:scale-95 hover:shadow-lg ${getDynamicStatusColors(subtask.status, subtask.require_check)}`}
              title="Tap to change status"
            >
              <div className={`w-3.5 h-3.5 rounded-full ${getDynamicDotColor(subtask.status, subtask.require_check)} animate-pulse`} />
              {getDynamicStatusLabel(subtask.status, subtask.require_check)}
              <ChevronRight size={14} className="opacity-50" />
            </button>
            {(subtask.bonus_points > 0 || subtask.tag === 'bonus') && !editing && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium flex items-center gap-1">
                <Star size={10} />
                {subtask.bonus_points > 0 ? `${subtask.bonus_points} BP` : 'Bonus'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canEdit && !editing && (
              <button
                onClick={handleStartEdit}
                className="p-2 text-mps-blue-500 hover:text-mps-blue-700 hover:bg-mps-blue-50 rounded-lg transition-colors"
              >
                <Edit3 size={16} />
              </button>
            )}
            {onDelete && canEdit && !editing && (
              <button
                onClick={onDelete}
                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="p-5 space-y-5">

          {/* Edit form */}
          {editing ? (
            <div className="space-y-3 border border-mps-blue-200 rounded-2xl p-4 bg-mps-blue-50/30">
              <h4 className="text-sm font-semibold text-mps-blue-700 flex items-center gap-1.5">
                <Edit3 size={14} /> Edit Subtask
              </h4>
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="Title *"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 bg-white"
              />
              <textarea
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 resize-none bg-white"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Due Date</label>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={e => setEditDueDate(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 bg-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Timing</label>
                  <input
                    type="time"
                    value={editTiming}
                    onChange={e => setEditTiming(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Bonus Points</label>
                <select
                  value={editBonusPoints}
                  onChange={e => setEditBonusPoints(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 bg-white"
                >
                  <option value={0}>None</option>
                  {[1,2,3,4,5].map(n => (
                    <option key={n} value={n}>{n} BP</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving || !editTitle.trim()}
                  className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Check size={14} />
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button onClick={() => setEditing(false)} className="btn-secondary text-sm">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Title + description */}
              <div>
                <h2 className="text-xl font-bold text-slate-800">{subtask.title}</h2>
                {subtask.description && (
                  <p className="text-slate-600 mt-2 text-sm leading-relaxed">{subtask.description}</p>
                )}
              </div>

              {/* Project badge (only when shown in calendar context) */}
              {isWithProject(subtask) && (
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2.5 py-1 bg-purple-50 text-purple-700 rounded-lg font-medium flex items-center gap-1">
                    <FolderKanban size={12} />
                    {subtask.project_title}
                  </span>
                  {subtask.project_sequential && (
                    <span className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-lg font-medium">
                      Sequential
                    </span>
                  )}
                </div>
              )}

              {/* Meta: date / timing */}
              <div className="flex flex-wrap gap-3">
                {subtask.due_date && (
                  <div className="flex items-center gap-1.5 text-sm text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg">
                    <Calendar size={14} />
                    <span>{subtask.due_date}</span>
                  </div>
                )}
                {subtask.timing && (
                  <div className="flex items-center gap-1.5 text-sm text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg">
                    <Clock size={14} />
                    <span>{subtask.timing}</span>
                  </div>
                )}
              </div>

              {/* Assignee */}
              {subtask.assignee && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-2">Assignee</h4>
                  <span className="flex items-center gap-1.5 text-xs bg-mps-blue-50 text-mps-blue-700 px-2.5 py-1 rounded-full font-medium w-fit">
                    <Avatar avatarUrl={subtask.assignee.avatar_url} name={subtask.assignee.full_name} size={20} />
                    {subtask.assignee.full_name}
                  </span>
                </div>
              )}
            </>
          )}

          {/* ── Checklist ─────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <CheckSquare size={14} className="text-slate-500" />
                Checklist
                {checklist.length > 0 && (
                  <span className="text-xs text-slate-400 font-normal ml-1">{completedCount}/{checklist.length}</span>
                )}
              </h4>
            </div>

            {checklist.length > 0 && (
              <div className="mb-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all duration-300"
                  style={{ width: `${checklist.length > 0 ? (completedCount / checklist.length) * 100 : 0}%` }}
                />
              </div>
            )}

            {checklistLoading ? (
              <p className="text-xs text-slate-400">Loading…</p>
            ) : (
              <div className="space-y-1.5">
                {checklist.map(item => (
                  <div key={item.id} className="flex items-center gap-2 group">
                    <button
                      onClick={() => handleToggleCheck(item)}
                      className="flex-shrink-0 text-slate-400 hover:text-emerald-500 transition-colors"
                    >
                      {item.is_completed
                        ? <CheckSquare size={16} className="text-emerald-500" />
                        : <Square size={16} />}
                    </button>
                    <span className={`flex-1 text-sm ${item.is_completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                      {item.text}
                    </span>
                    <button
                      onClick={() => handleDeleteCheckItem(item.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-300 hover:text-red-400 transition-all"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add checklist item */}
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                value={newCheckText}
                onChange={e => setNewCheckText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddCheckItem()}
                placeholder="Add item…"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40"
              />
              <button
                onClick={handleAddCheckItem}
                disabled={addingCheck || !newCheckText.trim()}
                className="p-1.5 text-mps-blue-500 hover:text-mps-blue-700 hover:bg-mps-blue-50 rounded-lg transition-colors disabled:opacity-40"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* ── Comments ──────────────────────────────────────────────────── */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Comments
              {comments.length > 0 && <span className="text-xs text-slate-400 font-normal">{comments.length}</span>}
            </h4>

            {commentsLoading ? (
              <p className="text-xs text-slate-400">Loading…</p>
            ) : comments.length === 0 ? (
              <p className="text-xs text-slate-400 mb-3">No comments yet.</p>
            ) : (
              <div className="space-y-3 mb-3">
                {comments.map(c => (
                  <div key={c.id} className="flex gap-3">
                    <Avatar avatarUrl={c.author?.avatar_url ?? null} name={c.author?.full_name ?? '?'} size={28} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-slate-700">{c.author?.full_name}</span>
                        <span className="text-[10px] text-slate-400">{new Date(c.created_at).toLocaleDateString()}</span>
                      </div>
                      {c.content && <p className="text-sm text-slate-600 leading-relaxed">{c.content}</p>}
                      {c.attachments && c.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {c.attachments.map(att => (
                            att.type === 'image' ? (
                              <a key={att.id} href={att.url} target="_blank" rel="noreferrer" className="block w-20 h-20 rounded-lg overflow-hidden border border-slate-100 hover:border-mps-blue-300 transition-colors">
                                <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                              </a>
                            ) : (
                              <a key={att.id} href={att.url} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1.5 text-xs text-mps-blue-600 bg-mps-blue-50 px-2.5 py-1.5 rounded-lg hover:bg-mps-blue-100 transition-colors">
                                <FileText size={12} />
                                {att.name}
                                <ExternalLink size={10} />
                              </a>
                            )
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Comment input */}
            <div className="border border-slate-200 rounded-2xl p-3 space-y-2 bg-slate-50/50">
              <textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Add a comment…"
                rows={2}
                className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none resize-none"
              />

              {/* File previews */}
              {commentFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {commentFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs bg-white border border-slate-200 rounded-lg px-2 py-1">
                      {f.type.startsWith('image/') ? <ImageIcon size={11} className="text-rose-400" /> : <FileText size={11} className="text-mps-blue-400" />}
                      <span className="max-w-[100px] truncate text-slate-600">{f.name}</span>
                      <button onClick={() => removeFile(i)} className="text-slate-300 hover:text-red-400 transition-colors">
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                <div className="flex items-center gap-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1.5 text-slate-400 hover:text-mps-blue-500 rounded-lg transition-colors"
                    title="Attach file"
                  >
                    <Paperclip size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (fileInputRef.current) { fileInputRef.current.accept = 'image/*'; fileInputRef.current.click(); fileInputRef.current.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip' }}}
                    className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
                    title="Attach image"
                  >
                    <ImageIcon size={15} />
                  </button>
                </div>
                <button
                  onClick={handleSendComment}
                  disabled={sendingComment || (!commentText.trim() && commentFiles.length === 0)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-mps-blue-500 hover:bg-mps-blue-600 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-40"
                >
                  <Send size={12} />
                  {sendingComment ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
