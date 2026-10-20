'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  X, Edit3, Calendar, Clock, ChevronRight, FolderKanban, Square, CheckSquare, Plus, Trash2, Send, Paperclip,
  Image as ImageIcon, FileText, ExternalLink, Star, ShieldCheck, Ban, RotateCcw, ListOrdered, MessageSquare, Loader2,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import { UserProfile } from '@/lib/supabase'
import { getDynamicStatusLabel, getDynamicStatusColors, getDynamicDotColor, canVerifyTask, formatDateTime } from '@/lib/tasks'
import {
  Subtask, SubtaskWithProject, updateSubtask, updateSubtaskStatus, SubtaskChecklistItem, fetchSubtaskChecklist,
  addSubtaskChecklistItem, toggleSubtaskChecklistItem, deleteSubtaskChecklistItem, SubtaskComment,
  fetchSubtaskComments, addSubtaskComment, uploadSubtaskAttachment,
} from '@/lib/projects'
import { ATTACHMENT_ACCEPT, IMAGE_ACCEPT, attachmentProblem } from '@/lib/attachmentPolicy'
import { formatSlotTime } from '@/lib/taskSlots'
import { Btn, FormGroup, FormRow, Switch, Notice, SearchField, SX, TASK_ICON, FIELD, Fact, SubHead, safeHref, DATE_FIELD, TIME_FIELD } from './ui'

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
  projectMembers?: UserProfile[]
  /** The parent project is completed: status changes are locked. */
  locked?: boolean
}

export default function SubtaskCard({
  subtask, canCheck, canEdit, onClose, onStatusTap, onSubtaskUpdated, onDelete, projectMembers = [], locked = false,
}: SubtaskCardProps) {
  const { user } = useAuth()

  // Only a verifier (a supervisor who can check, or the creator) may re-open a
  // verified subtask. In a closed project, status is locked for everyone.
  const isVerifier = canVerifyTask(subtask, user?.id, canCheck)
  const statusLocked = locked || (subtask.status === 'checked' && !isVerifier)

  // ── Edit ────────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(subtask.title)
  const [editDesc, setEditDesc] = useState(subtask.description || '')
  const [editDueDate, setEditDueDate] = useState(subtask.due_date || '')
  const [editTiming, setEditTiming] = useState(subtask.timing || '')
  const [editBonusPoints, setEditBonusPoints] = useState<number>(subtask.bonus_points || 0)
  const [editRequireCheck, setEditRequireCheck] = useState<boolean>(subtask.require_check ?? false)
  const [editAssigneeId, setEditAssigneeId] = useState<string>(subtask.assignee_id || '')
  const [memberSearch, setMemberSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Checklist ───────────────────────────────────────────────────────────────
  const [checklist, setChecklist] = useState<SubtaskChecklistItem[]>([])
  const [checklistLoading, setChecklistLoading] = useState(true)
  const [newCheckText, setNewCheckText] = useState('')

  // ── Comments ────────────────────────────────────────────────────────────────
  const [comments, setComments] = useState<SubtaskComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [commentFiles, setCommentFiles] = useState<File[]>([])
  const [sendingComment, setSendingComment] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setChecklistLoading(true)
    setCommentsLoading(true)
    // Independent reads: both go out at once.
    fetchSubtaskChecklist(subtask.id).then(items => { if (!cancelled) { setChecklist(items); setChecklistLoading(false) } })
    fetchSubtaskComments(subtask.id).then(items => { if (!cancelled) { setComments(items); setCommentsLoading(false) } })
    return () => { cancelled = true }
  }, [subtask.id])

  const startEdit = () => {
    setEditTitle(subtask.title)
    setEditDesc(subtask.description || '')
    setEditDueDate(subtask.due_date || '')
    setEditTiming(subtask.timing || '')
    setEditBonusPoints(subtask.bonus_points || 0)
    setEditRequireCheck(subtask.require_check ?? false)
    setEditAssigneeId(subtask.assignee_id || '')
    setSaveError(null)
    setEditing(true)
  }

  const handleSave = async () => {
    if (!editTitle.trim()) return
    setSaving(true)
    setSaveError(null)
    const ok = await updateSubtask(subtask.id, {
      title: editTitle.trim(),
      description: editDesc.trim() || null,
      due_date: editDueDate || null,
      timing: editTiming || null,
      bonus_points: editBonusPoints,
      tag: editBonusPoints !== 0 ? 'bonus' : null,
      require_check: editRequireCheck,
      assignee_id: editAssigneeId || null,
    })
    setSaving(false)
    if (!ok) { setSaveError('The changes were not saved. Try again.'); return }
    setEditing(false)
    onSubtaskUpdated()
  }

  const handleAddCheckItem = async () => {
    const text = newCheckText.trim()
    if (!text) return
    setNewCheckText('')
    const item = await addSubtaskChecklistItem(subtask.id, text, checklist.length)
    if (item) setChecklist(prev => [...prev, item])
    else setNewCheckText(text)
  }

  // Ticked on tap; undone if the write fails.
  const handleToggleCheck = async (item: SubtaskChecklistItem) => {
    const next = !item.is_completed
    setChecklist(prev => prev.map(i => i.id === item.id ? { ...i, is_completed: next } : i))
    const ok = await toggleSubtaskChecklistItem(item.id, next)
    if (!ok) setChecklist(prev => prev.map(i => i.id === item.id ? { ...i, is_completed: !next } : i))
  }

  const handleDeleteCheckItem = async (itemId: string) => {
    const before = checklist
    setChecklist(prev => prev.filter(i => i.id !== itemId))
    const ok = await deleteSubtaskChecklistItem(itemId)
    if (!ok) setChecklist(before)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    const problems = files.map(attachmentProblem).filter(Boolean)
    setCommentError(problems.length ? problems.join(' ') : null)
    setCommentFiles(prev => [...prev, ...files.filter(f => !attachmentProblem(f))])
  }

  const handleSendComment = async () => {
    if ((!commentText.trim() && commentFiles.length === 0) || !user) return
    setSendingComment(true)
    setCommentError(null)
    // The uploads don't depend on each other, so they go up together.
    const results = await Promise.all(commentFiles.map(f => uploadSubtaskAttachment(f, subtask.id, user.id)))
    const uploaded = results.filter((r): r is NonNullable<typeof r> => !!r)
    if (uploaded.length < commentFiles.length) {
      setSendingComment(false)
      setCommentError('A file could not be uploaded. Try again.')
      return
    }
    const comment = await addSubtaskComment(subtask.id, user.id, commentText.trim(), uploaded)
    if (comment) {
      setComments(await fetchSubtaskComments(subtask.id))
      setCommentText('')
      setCommentFiles([])
    } else {
      setCommentError('The comment was not posted. You may not be allowed to comment on this subtask.')
    }
    setSendingComment(false)
  }

  // Verifiers may dismiss a subtask that needs a check: it greys out and
  // leaves every statistic, as if deleted.
  const canDismiss = (subtask.require_check ?? false) && canCheck
  const [dismissing, setDismissing] = useState(false)
  const handleDismissToggle = async () => {
    setDismissing(true)
    const next = subtask.status === 'dismissed' ? 'not_done' : 'dismissed'
    const res = await updateSubtaskStatus(subtask.id, next, subtask.project_id, isWithProject(subtask) ? subtask.project_sequential : false)
    setDismissing(false)
    if (res.success) { onSubtaskUpdated(); onClose() }
  }

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    return q ? projectMembers.filter(m => m.full_name?.toLowerCase().includes(q)) : projectMembers
  }, [projectMembers, memberSearch])

  const completedCount = checklist.filter(i => i.is_completed).length
  const isBonus = subtask.bonus_points > 0 || subtask.tag === 'bonus'

  return (
    <ModalShell
      onClose={onClose}
      size="lg"
      sharp
      title={editing ? 'Edit subtask' : subtask.title}
      subtitle={isWithProject(subtask) ? subtask.project_title : undefined}
      icon={<FolderKanban size={16} />}
      iconClassName={TASK_ICON}
      headerActions={!editing ? (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {canDismiss && !locked && (
            <button
              onClick={handleDismissToggle}
              disabled={dismissing}
              className={SX.icon}
              aria-label={subtask.status === 'dismissed' ? 'Restore subtask' : 'Dismiss subtask'}
              title={subtask.status === 'dismissed' ? 'Restore subtask' : 'Dismiss: leave it out of the statistics'}
            >
              {subtask.status === 'dismissed' ? <RotateCcw size={15} /> : <Ban size={15} />}
            </button>
          )}
          {canEdit && (
            <button onClick={startEdit} className={SX.icon} aria-label="Edit subtask" title="Edit subtask">
              <Edit3 size={15} />
            </button>
          )}
          {onDelete && canEdit && (
            <button onClick={onDelete} className={`${SX.icon} hover:!text-rose-600`} aria-label="Delete subtask" title="Delete subtask">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ) : undefined}
      footer={editing ? (
        <div className="flex items-center justify-end gap-2">
          <Btn tone="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Btn>
          <Btn tone="dark" onClick={handleSave} disabled={saving || !editTitle.trim()}>
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? 'Saving…' : 'Save changes'}
          </Btn>
        </div>
      ) : undefined}
    >
      <div className="space-y-4">
        {editing ? (
          <>
            <input value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Subtask name" aria-label="Subtask name" className={`${FIELD} !h-11 !text-[15px] font-medium`} />
            <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description (optional)" rows={2} className={`${FIELD} !h-auto py-2 resize-none leading-snug`} />
            <FormGroup>
              <FormRow label="Due date">
                <input type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} className={DATE_FIELD} />
              </FormRow>
              <FormRow label="Time">
                <input type="time" value={editTiming} onChange={e => setEditTiming(e.target.value)} className={TIME_FIELD} />
              </FormRow>
              <FormRow label="Bonus points" hint="Bonus subtasks always need a check">
                <input
                  type="number"
                  inputMode="numeric"
                  value={editBonusPoints || ''}
                  placeholder="0"
                  onChange={e => {
                    const val = Number(e.target.value) || 0
                    setEditBonusPoints(val)
                    if (val !== 0) setEditRequireCheck(true)
                  }}
                  className={`${FIELD} !w-24 text-right tabular-nums`}
                />
              </FormRow>
              <FormRow label="Needs a check">
                <Switch checked={editRequireCheck} onChange={v => { if (editBonusPoints === 0) setEditRequireCheck(v) }} disabled={editBonusPoints !== 0} label="Needs a check" />
              </FormRow>
            </FormGroup>
            {projectMembers.length > 0 && (
              <FormGroup title="Assigned to">
                <div className="px-2.5 pt-2.5 pb-1.5">
                  <SearchField value={memberSearch} onChange={setMemberSearch} placeholder="Search members" />
                </div>
                <div className="max-h-44 overflow-y-auto overscroll-contain py-1">
                  {[{ id: '', full_name: 'No one yet', avatar_url: undefined } as Pick<UserProfile, 'id' | 'full_name' | 'avatar_url'>, ...filteredMembers].map(m => {
                    const on = editAssigneeId === m.id
                    return (
                      <button
                        key={m.id || 'none'}
                        type="button"
                        onClick={() => setEditAssigneeId(m.id)}
                        aria-pressed={on}
                        className="w-full flex items-center gap-2.5 px-3.5 py-1.5 text-left hover:bg-[#FAF7F0] transition-colors"
                      >
                        <span className={`flex-shrink-0 w-4 h-4 rounded-full inline-flex items-center justify-center ${on ? 'bg-[#27272A]' : 'border border-slate-300 bg-white'}`}>
                          {on && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </span>
                        {m.id && <Avatar avatarUrl={m.avatar_url} name={m.full_name} size={22} />}
                        <span className={`flex-1 min-w-0 text-[13.5px] leading-snug break-words ${m.id ? 'text-slate-900' : 'text-slate-500'}`}>{m.full_name}</span>
                      </button>
                    )
                  })}
                </div>
              </FormGroup>
            )}
            {saveError && <Notice tone="error">{saveError}</Notice>}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => { if (!statusLocked) onStatusTap(subtask) }}
                disabled={statusLocked}
                className={`inline-flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-full border text-[13px] font-semibold transition active:scale-[0.97] disabled:active:scale-100 ${getDynamicStatusColors(subtask.status, subtask.require_check)}`}
                title={statusLocked ? (locked ? 'The project is complete, so status is locked' : 'Only a verifier can change this') : 'Move to the next status'}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${getDynamicDotColor(subtask.status, subtask.require_check)}`} />
                {getDynamicStatusLabel(subtask.status, subtask.require_check)}
                {!statusLocked && <ChevronRight size={14} className="opacity-50" />}
              </button>
              {subtask.due_date && <Fact icon={Calendar}>{new Date(subtask.due_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</Fact>}
              {subtask.timing && <Fact icon={Clock}>{formatSlotTime(subtask.timing)}</Fact>}
              {isBonus && <Fact icon={Star} tone="amber">{subtask.bonus_points > 0 ? `${subtask.bonus_points} bonus points` : 'Bonus'}</Fact>}
              {subtask.require_check && <Fact icon={ShieldCheck} tone="blue">Needs a check</Fact>}
              {isWithProject(subtask) && subtask.project_sequential && <Fact icon={ListOrdered} tone="violet">In order</Fact>}
            </div>

            {subtask.description && (
              <p className="text-[13.5px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">{subtask.description}</p>
            )}

            {(subtask.assignee || subtask.creator) && (
              <div className="space-y-1.5">
                {subtask.assignee && (
                  <span className="inline-flex items-center gap-1.5 min-h-[28px] py-0.5 pl-0.5 pr-2.5 rounded-full bg-[#F4F1EA] text-[12px] font-medium text-slate-700 max-w-full">
                    <Avatar avatarUrl={subtask.assignee.avatar_url} name={subtask.assignee.full_name} size={24} userId={subtask.assignee_id ?? undefined} />
                    <span className="min-w-0 break-words leading-tight">{subtask.assignee.full_name}</span>
                  </span>
                )}
                {subtask.creator && (
                  <p className="text-[12px] text-slate-500">Assigned by <span className="font-medium text-slate-700">{subtask.creator.full_name}</span></p>
                )}
              </div>
            )}
          </>
        )}

        {/* Checklist */}
        <section>
          <SubHead icon={CheckSquare} count={checklist.length > 0 ? `${completedCount}/${checklist.length}` : null}>Checklist</SubHead>
          {checklistLoading ? (
            <p className="text-[12px] text-slate-400 mb-2">Loading…</p>
          ) : checklist.length > 0 && (
            <div className="fx-card divide-y divide-[#EEEAE1] mb-2">
              {checklist.map(item => (
                <div key={item.id} className="group flex items-start gap-1 pr-1">
                  <button onClick={() => handleToggleCheck(item)} className="flex-1 min-w-0 flex items-start gap-2.5 px-3 py-2 text-left hover:bg-[#FAF7F0] transition-colors">
                    {item.is_completed
                      ? <CheckSquare size={16} className="text-emerald-600 flex-shrink-0 mt-px" />
                      : <Square size={16} className="text-slate-400 flex-shrink-0 mt-px" />}
                    <span className={`text-[13.5px] leading-snug break-words min-w-0 ${item.is_completed ? 'line-through text-slate-400' : 'text-slate-800'}`}>{item.text}</span>
                  </button>
                  <button
                    onClick={() => handleDeleteCheckItem(item.id)}
                    className="mt-1 w-7 h-7 inline-flex items-center justify-center rounded-full text-slate-300 hover:text-rose-600 hover:bg-rose-50 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition flex-shrink-0"
                    aria-label={`Remove ${item.text}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <input
              value={newCheckText}
              onChange={e => setNewCheckText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCheckItem() } }}
              placeholder="Add a checklist item"
              className={FIELD}
            />
            <Btn tone="ghost" onClick={handleAddCheckItem} disabled={!newCheckText.trim()} aria-label="Add checklist item" className="!px-2.5 flex-shrink-0">
              <Plus size={15} />
            </Btn>
          </div>
        </section>

        {/* Comments */}
        <section>
          <SubHead icon={MessageSquare} count={comments.length || null}>Comments</SubHead>
          {commentsLoading ? (
            <p className="text-[12px] text-slate-400 mb-2">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="text-[12px] text-slate-400 mb-2">No comments yet.</p>
          ) : (
            <div className="space-y-2.5 mb-2.5">
              {comments.map(c => (
                <div key={c.id} className="flex gap-2.5 min-w-0">
                  <Avatar avatarUrl={c.author?.avatar_url ?? null} name={c.author?.full_name ?? '?'} size={28} userId={c.author_id} />
                  <div className="flex-1 min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-snug">
                      <span className="font-semibold text-slate-900 break-words">{c.author?.full_name}</span>
                      <span className="text-[11.5px] text-slate-400">{formatDateTime(c.created_at)}</span>
                    </p>
                    {c.content && <p className="text-[13.5px] text-slate-700 leading-snug break-words whitespace-pre-wrap mt-0.5">{c.content}</p>}
                    {c.attachments && c.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {c.attachments.map(att => {
                          const href = safeHref(att.url)
                          if (!href) return null
                          return att.type === 'image' ? (
                            <a key={att.id} href={href} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-[10px] overflow-hidden border border-[#E2DDD2]">
                              {/* eslint-disable-next-line @next/next/no-img-element -- user uploads on a public bucket */}
                              <img src={href} alt={att.name} loading="lazy" className="w-full h-full object-cover" />
                            </a>
                          ) : (
                            <a key={att.id} href={href} target="_blank" rel="noopener noreferrer nofollow"
                              className="inline-flex items-center gap-1.5 max-w-full min-h-[30px] px-2.5 py-1 rounded-full bg-[#F4F1EA] text-[12px] font-medium text-slate-700 hover:bg-[#ECE7DC] transition-colors">
                              <FileText size={12} className="flex-shrink-0" />
                              <span className="min-w-0 break-all">{att.name}</span>
                              <ExternalLink size={11} className="flex-shrink-0" />
                            </a>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="fx-card p-2 space-y-2">
            <textarea
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder="Write a comment"
              rows={2}
              className="w-full bg-transparent px-1 text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none leading-snug"
            />
            {commentFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {commentFiles.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 max-w-full min-h-[28px] py-0.5 pl-2.5 pr-1 rounded-full bg-[#F4F1EA] text-[12px] text-slate-700">
                    {f.type.startsWith('image/') ? <ImageIcon size={12} className="flex-shrink-0" /> : <FileText size={12} className="flex-shrink-0" />}
                    <span className="min-w-0 break-all leading-tight">{f.name}</span>
                    <button onClick={() => setCommentFiles(prev => prev.filter((_, j) => j !== i))} className="w-5 h-5 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-rose-600" aria-label={`Remove ${f.name}`}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 border-t border-[#EEEAE1] pt-1.5">
              <input ref={fileInputRef} type="file" accept={ATTACHMENT_ACCEPT} multiple className="hidden" onChange={handleFileSelect} />
              <input ref={imageInputRef} type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={handleFileSelect} />
              <button type="button" onClick={() => fileInputRef.current?.click()} className={SX.icon} aria-label="Attach a file">
                <Paperclip size={14} />
              </button>
              <button type="button" onClick={() => imageInputRef.current?.click()} className={SX.icon} aria-label="Attach an image">
                <ImageIcon size={14} />
              </button>
              <Btn
                tone="dark"
                onClick={handleSendComment}
                disabled={sendingComment || (!commentText.trim() && commentFiles.length === 0)}
                className="ml-auto"
              >
                {sendingComment ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {sendingComment ? 'Posting…' : 'Post'}
              </Btn>
            </div>
            {commentError && <Notice tone="error">{commentError}</Notice>}
          </div>
        </section>
      </div>
    </ModalShell>
  )
}
