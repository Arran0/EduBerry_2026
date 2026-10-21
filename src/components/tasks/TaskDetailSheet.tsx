'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  Star, Repeat, ShieldCheck, Send, CheckSquare, Square, MessageSquare, Paperclip, Link2, FileText, ExternalLink,
  Ban, RotateCcw, Trash2, Lock, ClipboardList, ChevronRight, Loader2, Plus, Pencil,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  TaskWithDetails, TaskDetails, TaskStatus, TaskChecklistItem, TaskComment, RECURRENCE_LABELS,
  fetchTaskDetails, getDynamicStatusLabel, getDynamicStatusColors, getDynamicDotColor, getNextStatus,
  canVerifyTask, updateTaskStatus, submitTaskWork, needsSubmissionFirst, toggleChecklistItem,
  addChecklistItem, addComment, deleteTask, uploadTaskAttachment, isTaskCompleted, formatDateTime, updateTaskDetails,
} from '@/lib/tasks'
import { formatSlotTime, periodRangeLongLabel } from '@/lib/taskSlots'
import { taskDisplayTitle } from '@/lib/taskClasses'
import ClassPicker from './ClassPicker'
import { ATTACHMENT_ACCEPT, attachmentProblem, normalizeLinkUrl } from '@/lib/attachmentPolicy'
import { safeHref, safeSrc } from '@/lib/safeUrl'
import { Btn, IconBtn, ConfirmSheet, Notice, TaskSheet, Fact, SubHead } from './ui'

function canDeleteTask(task: TaskWithDetails, userId: string, userRole: string): boolean {
  if (userRole === 'admin') return true
  const isAssignee = task.assignees.some(a => a.user_id === userId)
  const creatorRole = task.creator?.role
  if (userRole === 'principal') return !(isAssignee && creatorRole === 'admin')
  if (userRole === 'coordinator') return !(isAssignee && (creatorRole === 'principal' || creatorRole === 'admin'))
  if (userRole === 'teacher') return task.created_by === userId
  return false
}

function dateLabel(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export default function TaskDetailSheet({
  task, canCheck, userId, userRole, onClose, onStatusChange, onTaskDeleted, onTaskUpdated, onDetailsChange,
}: {
  task: TaskWithDetails
  canCheck: boolean
  userId: string
  userRole: string
  onClose: () => void
  onStatusChange: (id: string, status: TaskStatus) => void
  onTaskDeleted: (id: string) => void
  onTaskUpdated: () => void
  /** A new name or classes, for the calendar to show at once. */
  onDetailsChange?: (id: string, patch: { title: string; classes: string[] }) => void
}) {
  const requireCheck = task.require_check ?? false

  // The calendar list is loaded light; the heavy relations come in on open.
  // Until they do, delete stays hidden so it's never offered to someone who
  // turns out not to be allowed it.
  const [details, setDetails] = useState<TaskDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(true)
  const assignees = details?.assignees ?? []
  const creator = details?.creator
  const completer = details?.completer
  const locked = isTaskCompleted(task)
  const canDelete = details && !locked ? canDeleteTask({ ...task, assignees, creator }, userId, userRole) : false

  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([])
  const [comments, setComments] = useState<TaskComment[]>([])
  const [newCheckItem, setNewCheckItem] = useState('')
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [attachMode, setAttachMode] = useState<'none' | 'link' | 'file'>('none')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkName, setLinkName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [commentError, setCommentError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [submissionDraft, setSubmissionDraft] = useState('')
  const [submittingWork, setSubmittingWork] = useState(false)
  const needsSubmission = task.requires_submission && !task.submission_note

  // Name and classes. A period brought in from the timetable arrives with no
  // name, so it opens ready to be named.
  const [shown, setShown] = useState({ title: task.title, classes: task.classes ?? [] })
  const [editing, setEditing] = useState(() => !task.title.trim() && !isTaskCompleted(task))
  const [draftTitle, setDraftTitle] = useState(task.title)
  const [draftClasses, setDraftClasses] = useState<string[]>(task.classes ?? [])
  const [savingDetails, setSavingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetailsLoading(true)
    fetchTaskDetails(task.id, task.created_by, task.completed_by).then(d => {
      if (cancelled) return
      setDetails(d)
      setChecklist(d.checklist)
      setComments(d.comments)
      setDetailsLoading(false)
    })
    return () => { cancelled = true }
  }, [task.id, task.created_by, task.completed_by])

  // Verifiers (supervisors who can check, or the creator) may dismiss a task
  // that needs verification, and only they can re-open a verified one.
  const isVerifier = canVerifyTask(task, userId, canCheck)
  const canDismiss = requireCheck && isVerifier
  const statusLocked = task.status === 'checked' && !isVerifier

  const handleStatusClick = async () => {
    if (statusLocked) return
    const next = getNextStatus(task.status, isVerifier, requireCheck)
    // A task that needs a submission moves on through the box below instead.
    if (next === task.status || needsSubmissionFirst(task, next)) return
    const ok = await updateTaskStatus(task.id, next, userId)
    if (ok) onStatusChange(task.id, next)
  }

  const handleDismissToggle = async () => {
    const next: TaskStatus = task.status === 'dismissed' ? 'not_done' : 'dismissed'
    const ok = await updateTaskStatus(task.id, next, userId)
    if (ok) onStatusChange(task.id, next)
  }

  const handleSubmitWork = async () => {
    if (!submissionDraft.trim()) return
    setSubmittingWork(true)
    const ok = await submitTaskWork(task.id, submissionDraft.trim())
    if (ok) {
      await updateTaskStatus(task.id, 'done', userId)
      onTaskUpdated()
    }
    setSubmittingWork(false)
  }

  // Ticked on tap; the write follows and is undone if it fails.
  const handleToggleChecklist = async (item: TaskChecklistItem) => {
    const next = !item.is_completed
    setChecklist(prev => prev.map(c => c.id === item.id ? { ...c, is_completed: next } : c))
    const ok = await toggleChecklistItem(item.id, next)
    if (!ok) setChecklist(prev => prev.map(c => c.id === item.id ? { ...c, is_completed: !next } : c))
    else onTaskUpdated()
  }

  const handleAddCheckItem = async () => {
    const text = newCheckItem.trim()
    if (!text) return
    setNewCheckItem('')
    const item = await addChecklistItem(task.id, text, checklist.length)
    if (item) { setChecklist(prev => [...prev, item]); onTaskUpdated() }
    else setNewCheckItem(text)
  }

  const canPost = !posting && (
    attachMode === 'none' ? !!newComment.trim() : attachMode === 'link' ? !!linkUrl.trim() : !!file
  )

  const handlePostComment = async () => {
    if (!canPost) return
    setCommentError(null)
    let attachment: { url: string; name: string; type: 'image' | 'document' | 'link' } | undefined
    if (attachMode === 'link') {
      const url = normalizeLinkUrl(linkUrl)
      if (!url) { setCommentError('Enter a web link, such as https://example.com'); return }
      attachment = { url, name: linkName.trim() || url, type: 'link' }
    }
    if (attachMode === 'file' && file) {
      const problem = attachmentProblem(file)
      if (problem) { setCommentError(problem); return }
    }
    setPosting(true)
    if (attachMode === 'file' && file) {
      const uploaded = await uploadTaskAttachment(file, task.id, userId)
      if (!uploaded) { setPosting(false); setCommentError('The file could not be uploaded. Try again.'); return }
      attachment = uploaded
    }
    const comment = await addComment(task.id, userId, newComment.trim(), attachment)
    setPosting(false)
    if (!comment) { setCommentError('The comment was not posted. Try again.'); return }
    setComments(prev => [...prev, comment])
    setNewComment('')
    setAttachMode('none')
    setLinkUrl('')
    setLinkName('')
    setFile(null)
    onTaskUpdated()
  }

  const startEditing = () => {
    setDraftTitle(shown.title)
    setDraftClasses(shown.classes)
    setDetailsError(null)
    setEditing(true)
  }

  const handleSaveDetails = async () => {
    const title = draftTitle.trim()
    if (!title && draftClasses.length === 0) { setDetailsError('Give the task a name or a class.'); return }
    setSavingDetails(true)
    setDetailsError(null)
    const ok = await updateTaskDetails(task.id, { title, classes: draftClasses })
    setSavingDetails(false)
    if (!ok) { setDetailsError('The change was not saved. Try again.'); return }
    setShown({ title, classes: draftClasses })
    setEditing(false)
    onDetailsChange?.(task.id, { title, classes: draftClasses })
  }

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    const ok = await deleteTask(task.id)
    setDeleting(false)
    if (!ok) { setDeleteError('The task was not deleted. Try again.'); return }
    setConfirmDelete(false)
    onClose()
    onTaskDeleted(task.id)
  }

  const done = checklist.filter(c => c.is_completed).length
  const timeText = task.period
    ? periodRangeLongLabel(task.period, task.period_end)
    : task.timing ? `${formatSlotTime(task.timing)}${task.end_time ? ` – ${formatSlotTime(task.end_time)}` : ''}` : null

  return (
    <>
      <TaskSheet
        onClose={onClose}
        title={taskDisplayTitle(shown)}
        subtitle={[task.due_date ? dateLabel(task.due_date) : 'No date', timeText].filter(Boolean).join(', ')}
        icon={ClipboardList}
        headerActions={
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {!locked && !editing && (
              <IconBtn quiet label="Rename, or change the classes" onClick={startEditing}>
                <Pencil size={15} />
              </IconBtn>
            )}
            {canDismiss && (
              <IconBtn quiet label={task.status === 'dismissed' ? 'Restore task' : 'Dismiss: leave out of the statistics'} onClick={handleDismissToggle}>
                {task.status === 'dismissed' ? <RotateCcw size={15} /> : <Ban size={15} />}
              </IconBtn>
            )}
            {canDelete && (
              <IconBtn quiet label="Delete task" onClick={() => setConfirmDelete(true)} className="hover:!text-red-600">
                <Trash2 size={15} />
              </IconBtn>
            )}
            {locked && (
              <span className="inline-flex w-9 h-9 items-center justify-center text-slate-300" title="Completed tasks can't be deleted">
                <Lock size={15} />
              </span>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          {editing && (
            <section className="tk-well p-3 space-y-2.5">
              <input
                value={draftTitle}
                onChange={e => setDraftTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveDetails() } }}
                placeholder={draftClasses.length ? `Task name for ${draftClasses.join(', ')}` : 'Task name'}
                aria-label="Task name"
                maxLength={200}
                autoFocus
                className="tk-input !h-10 !text-[14.5px] font-medium"
              />
              <ClassPicker value={draftClasses} onChange={setDraftClasses} />
              {detailsError && <Notice>{detailsError}</Notice>}
              <div className="flex items-center justify-end gap-2">
                <Btn onClick={() => setEditing(false)} disabled={savingDetails}>Cancel</Btn>
                <Btn tone="primary" onClick={handleSaveDetails} disabled={savingDetails}>
                  {savingDetails && <Loader2 size={13} className="animate-spin" />}
                  Save
                </Btn>
              </div>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={handleStatusClick}
              disabled={statusLocked}
              className={`inline-flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-full border text-[13px] font-semibold transition active:scale-[0.97] disabled:active:scale-100 ${getDynamicStatusColors(task.status, requireCheck)}`}
              title={statusLocked ? 'Only a verifier can change this' : 'Move to the next status'}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${getDynamicDotColor(task.status, requireCheck)}`} />
              {getDynamicStatusLabel(task.status, requireCheck)}
              {!statusLocked && <ChevronRight size={14} className="opacity-50" />}
            </button>
            {task.bonus_points > 0 && <Fact icon={Star} tone="amber">{task.bonus_points} bonus points</Fact>}
            {task.recurrence && task.recurrence !== 'none' && <Fact icon={Repeat} tone="violet">{RECURRENCE_LABELS[task.recurrence]}</Fact>}
            {requireCheck && <Fact icon={ShieldCheck} tone="blue">Needs verification</Fact>}
            {task.requires_submission && <Fact icon={Send} tone="indigo">Needs submission</Fact>}
          </div>

          {task.description && (
            <p className="text-[13.5px] leading-relaxed text-slate-600 whitespace-pre-wrap break-words">{task.description}</p>
          )}

          {task.requires_submission && (
            <section>
              <SubHead icon={Send}>Submission</SubHead>
              {task.submission_note ? (
                <p className="tk-well p-3 text-[13.5px] text-slate-700 whitespace-pre-wrap break-words">{task.submission_note}</p>
              ) : needsSubmission ? (
                <div className="space-y-2">
                  <textarea
                    value={submissionDraft}
                    onChange={e => setSubmissionDraft(e.target.value)}
                    placeholder="Describe or paste your work"
                    rows={3}
                    className="tk-input"
                  />
                  <Btn tone="primary" onClick={handleSubmitWork} disabled={submittingWork || !submissionDraft.trim()}>
                    {submittingWork ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {submittingWork ? 'Submitting…' : 'Submit and complete'}
                  </Btn>
                </div>
              ) : null}
            </section>
          )}

          {(assignees.length > 0 || creator || completer) && (
            <section className="space-y-2">
              {assignees.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {assignees.map(a => (
                    <span key={a.id} className="inline-flex items-center gap-1.5 min-h-[28px] py-0.5 pl-0.5 pr-2.5 rounded-full bg-amber-50 border border-amber-100 text-[12px] font-medium text-amber-900 max-w-full">
                      <Avatar avatarUrl={a.user?.avatar_url} name={a.user?.full_name} size={24} userId={a.user_id} />
                      <span className="min-w-0 break-words leading-tight">{a.user?.full_name ?? 'Unknown'}</span>
                    </span>
                  ))}
                </div>
              )}
              {creator && (
                <p className="text-[12px] text-slate-500 leading-snug">
                  Created by <span className="font-medium text-slate-700">{creator.full_name}</span>, {formatDateTime(task.created_at)}
                </p>
              )}
              {locked && completer && task.completed_at && (
                <p className="text-[12px] text-emerald-700 leading-snug">
                  Completed by <span className="font-medium">{completer.full_name}</span>, {formatDateTime(task.completed_at)}
                </p>
              )}
            </section>
          )}

          <section>
            <SubHead icon={CheckSquare} count={checklist.length > 0 ? `${done}/${checklist.length}` : null}>Checklist</SubHead>
            {checklist.length > 0 && (
              <div className="tk-card !rounded-[14px] tk-rule overflow-hidden mb-2">
                {checklist.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleToggleChecklist(item)}
                    className="flex items-start gap-2.5 w-full text-left px-3 py-2 hover:bg-amber-50/60 transition-colors"
                  >
                    {item.is_completed
                      ? <CheckSquare size={16} className="text-emerald-600 flex-shrink-0 mt-px" />
                      : <Square size={16} className="text-slate-400 flex-shrink-0 mt-px" />}
                    <span className={`text-[13.5px] leading-snug break-words min-w-0 ${item.is_completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.text}</span>
                  </button>
                ))}
              </div>
            )}
            {detailsLoading && <p className="text-[12px] text-slate-400 mb-2">Loading…</p>}
            <div className="flex items-center gap-1.5">
              <input
                value={newCheckItem}
                onChange={e => setNewCheckItem(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCheckItem() } }}
                placeholder="Add a checklist item"
                className="tk-input"
              />
              <IconBtn label="Add checklist item" onClick={handleAddCheckItem} disabled={!newCheckItem.trim()}>
                <Plus size={15} />
              </IconBtn>
            </div>
          </section>

          <section>
            <SubHead icon={MessageSquare} count={comments.length || null}>Comments</SubHead>
            {comments.length > 0 && (
              <div className="space-y-2.5 mb-2.5 max-h-60 overflow-y-auto overscroll-contain pr-1">
                {comments.map(c => <CommentRow key={c.id} comment={c} />)}
              </div>
            )}
            {detailsLoading ? (
              <p className="text-[12px] text-slate-400 mb-2">Loading…</p>
            ) : comments.length === 0 ? (
              <p className="text-[12px] text-slate-400 mb-2">No comments yet.</p>
            ) : null}

            <div className="tk-well p-2 space-y-2">
              {attachMode === 'link' && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_10rem] gap-1.5">
                  <input type="url" inputMode="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://" className="tk-input" />
                  <input value={linkName} onChange={e => setLinkName(e.target.value)} placeholder="Label (optional)" className="tk-input" />
                </div>
              )}
              {attachMode === 'file' && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full flex items-center gap-2 min-h-[36px] px-3 py-1.5 rounded-[12px] border border-dashed border-amber-300 bg-white text-[12.5px] text-slate-600 hover:border-amber-500 transition-colors text-left"
                >
                  <Paperclip size={13} className="flex-shrink-0 text-amber-600" />
                  <span className="min-w-0 break-all">{file ? file.name : 'Choose an image or document (up to 15 MB)'}</span>
                </button>
              )}
              <input ref={fileRef} type="file" className="hidden" accept={ATTACHMENT_ACCEPT} onChange={e => setFile(e.target.files?.[0] || null)} />
              <div className="flex items-center gap-1.5">
                <IconBtn label="Attach a link" aria-pressed={attachMode === 'link'} onClick={() => setAttachMode(m => m === 'link' ? 'none' : 'link')}>
                  <Link2 size={14} />
                </IconBtn>
                <IconBtn label="Attach a file" aria-pressed={attachMode === 'file'} onClick={() => setAttachMode(m => m === 'file' ? 'none' : 'file')}>
                  <Paperclip size={14} />
                </IconBtn>
                <input
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handlePostComment() } }}
                  placeholder="Write a comment"
                  className="tk-input"
                />
                <Btn tone="primary" onClick={handlePostComment} disabled={!canPost} aria-label="Post comment" className="!px-3 flex-shrink-0">
                  {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </Btn>
              </div>
              {commentError && <Notice>{commentError}</Notice>}
            </div>
          </section>
        </div>
      </TaskSheet>

      {confirmDelete && (
        <ConfirmSheet
          title="Delete this task?"
          icon={Trash2}
          confirmLabel={deleting ? 'Deleting…' : 'Delete task'}
          busy={deleting}
          error={deleteError}
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        >
          <p><span className="font-semibold text-slate-800 break-words">{taskDisplayTitle(shown)}</span> will be removed, with its checklist and comments.</p>
        </ConfirmSheet>
      )}
    </>
  )
}

function CommentRow({ comment }: { comment: TaskComment }) {
  // Links saved before the http(s) check still read the way new ones are
  // checked; anything that isn't a web, mail or phone link renders as text.
  const href = safeHref(comment.attachment_url)
  const src = safeSrc(comment.attachment_url)
  return (
    <div className="flex gap-2.5 min-w-0">
      <Avatar avatarUrl={comment.user?.avatar_url} name={comment.user?.full_name} size={28} userId={comment.user?.id} />
      <div className="flex-1 min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-snug">
          <span className="font-semibold text-slate-800 break-words">{comment.user?.full_name || 'Unknown'}</span>
          <span className="text-[11.5px] text-slate-400">{formatDateTime(comment.created_at)}</span>
        </p>
        {comment.content && <p className="text-[13.5px] text-slate-600 leading-snug break-words whitespace-pre-wrap mt-0.5">{comment.content}</p>}
        {comment.attachment_url && (
          <div className="mt-1.5">
            {comment.attachment_type === 'image' && src ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploads on a public bucket; next/image would need every storage host listed */}
                <img src={src} alt={comment.attachment_name || 'Attached image'} loading="lazy" className="max-h-36 max-w-full rounded-[10px] border border-amber-900/10 object-cover" />
              </a>
            ) : href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1.5 max-w-full min-h-[30px] px-2.5 py-1 rounded-full bg-amber-50 border border-amber-100 text-[12px] font-medium text-amber-900 hover:bg-amber-100 transition-colors"
              >
                {comment.attachment_type === 'link' ? <ExternalLink size={12} className="flex-shrink-0" /> : <FileText size={12} className="flex-shrink-0" />}
                <span className="min-w-0 break-all">{comment.attachment_name || (comment.attachment_type === 'link' ? href : 'Document')}</span>
              </a>
            ) : (
              <span className="text-[12px] text-slate-400 break-all">{comment.attachment_name || 'Attachment'} (link blocked)</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
