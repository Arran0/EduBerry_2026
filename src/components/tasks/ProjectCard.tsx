'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  Calendar, Plus, Trash2, Star, Users, ChevronRight, ListOrdered, AlertCircle, Edit3, UserPlus, FolderKanban, X, Loader2, Clock,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import { UserProfile } from '@/lib/supabase'
import {
  ProjectWithDetails, ProjectMember, Subtask, NewSubtaskInput, updateSubtaskStatus, addSubtask, deleteSubtask,
  deleteProject, updateProject, addProjectMember, removeProjectMember,
} from '@/lib/projects'
import { getDynamicStatusLabel, getDynamicStatusColors, getDynamicDotColor, getNextStatus, canVerifyTask } from '@/lib/tasks'
import { formatSlotTime } from '@/lib/taskSlots'
import SubtaskCard from './SubtaskCard'
import { Btn, ConfirmModal, FormGroup, FormRow, Switch, Notice, SearchField, SX, TASK_ICON, FIELD, ROW_FIELD, Fact, SubHead, DATE_FIELD, TIME_FIELD } from './ui'

interface ProjectCardProps {
  project: ProjectWithDetails
  canEdit: boolean
  canCheck: boolean
  onClose: () => void
  onUpdated: () => void
  availableAssignees?: UserProfile[]
}

function dateText(iso: string | null): string {
  if (!iso) return 'not set'
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ProjectCard({ project, canEdit, canCheck, onClose, onUpdated, availableAssignees = [] }: ProjectCardProps) {
  const { user } = useAuth()
  const [localProject, setLocalProject] = useState(project)
  const [selectedSubtask, setSelectedSubtask] = useState<Subtask | null>(null)
  const [showAddSubtask, setShowAddSubtask] = useState(false)
  const [orderNotice, setOrderNotice] = useState<string | null>(null)

  // Details edit
  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(project.title)
  const [descDraft, setDescDraft] = useState(project.description || '')
  const [startDraft, setStartDraft] = useState(project.start_date || '')
  const [endDraft, setEndDraft] = useState(project.end_date || '')
  const [seqDraft, setSeqDraft] = useState(project.sequential_mode)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Members
  const [showMemberSearch, setShowMemberSearch] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [busyMember, setBusyMember] = useState<string | null>(null)

  // Deletes
  const [confirm, setConfirm] = useState<{ kind: 'project' } | { kind: 'subtask'; id: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Follow the parent's fresh data, including an open subtask.
  useEffect(() => {
    setLocalProject(project)
    setSelectedSubtask(prev => (prev ? project.subtasks.find(s => s.id === prev.id) ?? prev : prev))
  }, [project])

  const startEdit = () => {
    setTitleDraft(localProject.title)
    setDescDraft(localProject.description || '')
    setStartDraft(localProject.start_date || '')
    setEndDraft(localProject.end_date || '')
    setSeqDraft(localProject.sequential_mode)
    setSaveError(null)
    setEditing(true)
  }

  const handleSaveDetails = async () => {
    const title = titleDraft.trim()
    if (!title) return
    if (startDraft && endDraft && endDraft < startDraft) { setSaveError('The end date is before the start date.'); return }
    setSaving(true)
    setSaveError(null)
    const patch = {
      title,
      description: descDraft.trim() || null,
      start_date: startDraft || null,
      end_date: endDraft || null,
      sequential_mode: seqDraft,
    }
    const ok = await updateProject(localProject.id, patch)
    setSaving(false)
    if (!ok) { setSaveError('The changes were not saved. Try again.'); return }
    setLocalProject(prev => ({ ...prev, ...patch }))
    setEditing(false)
    onUpdated()
  }

  // Dismissed subtasks count as deleted — left out of the progress figures.
  const countable = localProject.subtasks.filter(s => s.status !== 'dismissed')
  const completedCount = countable.filter(s => s.status === 'checked' || (!s.require_check && s.status === 'done')).length
  const totalCount = countable.length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  // A fully completed project locks its subtasks' status.
  const isProjectClosed = totalCount > 0 && completedCount === totalCount

  const handleSubtaskStatusTap = async (subtask: Subtask) => {
    if (isProjectClosed) return
    const isVerifier = canVerifyTask(subtask, user?.id, canCheck)
    if (subtask.status === 'checked' && !isVerifier) return
    const next = getNextStatus(subtask.status, isVerifier, subtask.require_check ?? false)
    if (next === subtask.status) return
    const result = await updateSubtaskStatus(subtask.id, next, localProject.id, localProject.sequential_mode)
    if (result.success) {
      setLocalProject(prev => ({ ...prev, subtasks: prev.subtasks.map(s => s.id === subtask.id ? { ...s, status: next } : s) }))
      setSelectedSubtask(prev => prev?.id === subtask.id ? { ...prev, status: next } : prev)
      onUpdated()
    } else if (result.error) {
      setOrderNotice(result.error)
      setTimeout(() => setOrderNotice(null), 3000)
    }
  }

  const memberIds = useMemo(() => new Set(localProject.members.map(m => m.user_id)), [localProject.members])
  const nonMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    return availableAssignees.filter(u => !memberIds.has(u.id) && (!q || u.full_name?.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q)))
  }, [availableAssignees, memberIds, memberSearch])

  const handleAddMember = async (profile: UserProfile) => {
    setBusyMember(profile.id)
    const ok = await addProjectMember(localProject.id, profile.id)
    setBusyMember(null)
    if (!ok) return
    const member: ProjectMember = { id: `temp-${Date.now()}`, project_id: localProject.id, user_id: profile.id, user: profile }
    setLocalProject(prev => ({ ...prev, members: [...prev.members, member] }))
    setMemberSearch('')
    onUpdated()
  }

  const handleRemoveMember = async (userId: string) => {
    setBusyMember(userId)
    const ok = await removeProjectMember(localProject.id, userId)
    setBusyMember(null)
    if (!ok) return
    setLocalProject(prev => ({ ...prev, members: prev.members.filter(m => m.user_id !== userId) }))
    onUpdated()
  }

  const handleConfirmDelete = async () => {
    if (!confirm) return
    setDeleting(true)
    setDeleteError(null)
    if (confirm.kind === 'project') {
      const ok = await deleteProject(localProject.id)
      setDeleting(false)
      if (!ok) { setDeleteError('The project was not deleted. Try again.'); return }
      setConfirm(null)
      onUpdated()
      onClose()
      return
    }
    const ok = await deleteSubtask(confirm.id)
    setDeleting(false)
    if (!ok) { setDeleteError('The subtask was not deleted. Try again.'); return }
    setLocalProject(prev => ({ ...prev, subtasks: prev.subtasks.filter(s => s.id !== confirm.id) }))
    setSelectedSubtask(null)
    setConfirm(null)
    onUpdated()
  }

  const handleSubtaskAdded = (sub: Subtask) => {
    setLocalProject(prev => ({ ...prev, subtasks: [...prev.subtasks, sub] }))
    setShowAddSubtask(false)
    onUpdated()
  }

  return (
    <>
      <ModalShell
        onClose={onClose}
        size="xl"
        sharp
        title={editing ? 'Edit project' : localProject.title}
        subtitle={editing ? undefined : totalCount > 0 ? `${completedCount} of ${totalCount} subtasks done, ${progress}%` : 'No subtasks yet'}
        icon={<FolderKanban size={16} />}
        iconClassName={TASK_ICON}
        headerActions={canEdit && !editing ? (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={startEdit} className={SX.icon} aria-label="Edit project" title="Edit project"><Edit3 size={15} /></button>
            <button onClick={() => setConfirm({ kind: 'project' })} className={`${SX.icon} hover:!text-rose-600`} aria-label="Delete project" title="Delete project"><Trash2 size={15} /></button>
          </div>
        ) : undefined}
        footer={editing ? (
          <div className="flex items-center justify-end gap-2">
            <Btn tone="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Btn>
            <Btn tone="dark" onClick={handleSaveDetails} disabled={saving || !titleDraft.trim()}>
              {saving && <Loader2 size={13} className="animate-spin" />}
              {saving ? 'Saving…' : 'Save changes'}
            </Btn>
          </div>
        ) : undefined}
      >
        {editing ? (
          <div className="space-y-3">
            <input value={titleDraft} onChange={e => setTitleDraft(e.target.value)} aria-label="Project name" placeholder="Project name" className={`${FIELD} !h-11 !text-[15px] font-medium`} autoFocus />
            <textarea value={descDraft} onChange={e => setDescDraft(e.target.value)} placeholder="What is this project about? (optional)" rows={3} className={`${FIELD} !h-auto py-2 resize-none leading-snug`} />
            <FormGroup>
              <FormRow label="Starts"><input type="date" value={startDraft} onChange={e => setStartDraft(e.target.value)} className={DATE_FIELD} /></FormRow>
              <FormRow label="Ends"><input type="date" value={endDraft} onChange={e => setEndDraft(e.target.value)} className={DATE_FIELD} /></FormRow>
              <FormRow label="Do subtasks in order" hint="Each one opens only when the one before it is done">
                <Switch checked={seqDraft} onChange={setSeqDraft} label="Do subtasks in order" />
              </FormRow>
            </FormGroup>
            {saveError && <Notice tone="error">{saveError}</Notice>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Fact icon={Calendar}>{dateText(localProject.start_date)} to {dateText(localProject.end_date)}</Fact>
              {localProject.sequential_mode && <Fact icon={ListOrdered} tone="violet">In order</Fact>}
            </div>
            {localProject.description && (
              <p className="text-[13.5px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">{localProject.description}</p>
            )}
            {totalCount > 0 && (
              <div className="h-1.5 bg-[#EEEAE1] rounded-full overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
                <div className="h-full rounded-full bg-gradient-to-r from-[#B45309] to-[#EA580C] transition-[width] duration-500" style={{ width: `${progress}%` }} />
              </div>
            )}

            {/* Members */}
            <section>
              <SubHead
                icon={Users}
                count={localProject.members.length}
                right={canEdit && availableAssignees.length > 0 ? (
                  <Btn tone="ghost" onClick={() => { setShowMemberSearch(v => !v); setMemberSearch('') }} aria-expanded={showMemberSearch} className="!h-7 !px-2.5 !text-[12px]">
                    {showMemberSearch ? <X size={13} /> : <UserPlus size={13} />}
                    {showMemberSearch ? 'Done' : 'Add'}
                  </Btn>
                ) : undefined}
              >
                Members
              </SubHead>
              {showMemberSearch && canEdit && (
                <div className="fx-card mb-2">
                  <div className="p-2 pb-1.5">
                    <SearchField value={memberSearch} onChange={setMemberSearch} placeholder="Search staff by name or role" />
                  </div>
                  <div className="max-h-48 overflow-y-auto overscroll-contain py-1">
                    {nonMembers.length === 0 ? (
                      <p className="px-3.5 py-3 text-[12.5px] text-slate-500">{memberSearch ? 'No one matches that.' : 'Everyone you can add is already a member.'}</p>
                    ) : nonMembers.map(u => (
                      <button
                        key={u.id}
                        onClick={() => handleAddMember(u)}
                        disabled={busyMember === u.id}
                        className="w-full flex items-center gap-2.5 px-3.5 py-1.5 text-left hover:bg-[#FAF7F0] transition-colors disabled:opacity-60"
                      >
                        <Avatar avatarUrl={u.avatar_url} name={u.full_name} size={26} userId={u.id} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13.5px] text-slate-900 leading-snug break-words">{u.full_name}</span>
                          <span className="block text-[11.5px] text-slate-400 capitalize">{u.role}</span>
                        </span>
                        {busyMember === u.id ? <Loader2 size={14} className="animate-spin text-slate-400" /> : <Plus size={15} className="text-[#8B6F47] flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {localProject.members.map(m => (
                  <span key={m.id} className="inline-flex items-center gap-1.5 min-h-[28px] py-0.5 pl-0.5 pr-1 rounded-full bg-[#F4F1EA] text-[12px] font-medium text-slate-700 max-w-full">
                    <Avatar avatarUrl={m.user?.avatar_url} name={m.user?.full_name} size={24} userId={m.user?.id} />
                    <span className="min-w-0 break-words pr-1 leading-tight">{m.user?.full_name || 'Unknown'}</span>
                    {canEdit && (
                      <button
                        onClick={() => handleRemoveMember(m.user_id)}
                        disabled={busyMember === m.user_id}
                        className="w-5 h-5 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-rose-600 hover:bg-white disabled:opacity-40 transition flex-shrink-0"
                        aria-label={`Remove ${m.user?.full_name || 'member'}`}
                      >
                        {busyMember === m.user_id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </section>

            {orderNotice && (
              <Notice tone="warn"><span className="inline-flex items-start gap-1.5"><AlertCircle size={14} className="flex-shrink-0 mt-px" />{orderNotice}</span></Notice>
            )}

            {/* Subtasks */}
            <section>
              <SubHead
                icon={ListOrdered}
                count={totalCount}
                right={canEdit ? (
                  <Btn tone="ghost" onClick={() => setShowAddSubtask(true)} className="!h-7 !px-2.5 !text-[12px]">
                    <Plus size={13} /> Add subtask
                  </Btn>
                ) : undefined}
              >
                Subtasks
              </SubHead>
              {localProject.subtasks.length === 0 ? (
                <div className="fx-card px-4 py-6 text-center">
                  <p className="text-[13px] text-slate-500">No subtasks yet.</p>
                  {canEdit && <Btn tone="dark" onClick={() => setShowAddSubtask(true)} className="mt-2.5"><Plus size={13} /> Add the first subtask</Btn>}
                </div>
              ) : (
                <div className="fx-card divide-y divide-[#EEEAE1]">
                  {localProject.subtasks.map((subtask, index) => {
                    const struck = subtask.status === 'checked' || subtask.status === 'dismissed' || (!subtask.require_check && subtask.status === 'done')
                    const isBonus = subtask.bonus_points > 0 || subtask.tag === 'bonus'
                    return (
                      <div key={subtask.id} className={`flex items-center gap-2 pl-2 pr-1.5 ${subtask.status === 'dismissed' ? 'opacity-60' : ''}`}>
                        <button
                          onClick={() => handleSubtaskStatusTap(subtask)}
                          disabled={isProjectClosed}
                          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border transition ${isProjectClosed ? 'cursor-not-allowed' : 'active:scale-95'} ${getDynamicStatusColors(subtask.status, subtask.require_check)}`}
                          aria-label={`${getDynamicStatusLabel(subtask.status, subtask.require_check)}${isProjectClosed ? '' : ': move to the next status'}`}
                          title={isProjectClosed ? 'The project is complete, so status is locked' : getDynamicStatusLabel(subtask.status, subtask.require_check)}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full ${getDynamicDotColor(subtask.status, subtask.require_check)}`} />
                        </button>
                        <button onClick={() => setSelectedSubtask(subtask)} className="flex-1 min-w-0 flex items-center gap-2 py-2 text-left">
                          <span className="flex-1 min-w-0">
                            <span className={`block text-[13.5px] font-medium leading-snug break-words ${struck ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                              {localProject.sequential_mode && <span className="text-[12px] text-slate-400 mr-1 tabular-nums">{index + 1}.</span>}
                              {subtask.title}
                            </span>
                            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-0.5 text-[11.5px] text-slate-500">
                              {subtask.assignee && <span className="break-words">{subtask.assignee.full_name}</span>}
                              {subtask.due_date && <span className="inline-flex items-center gap-1"><Calendar size={10} />{dateText(subtask.due_date)}</span>}
                              {subtask.timing && <span className="inline-flex items-center gap-1"><Clock size={10} />{formatSlotTime(subtask.timing)}</span>}
                              {isBonus && <span className="inline-flex items-center gap-1 text-amber-700 font-semibold"><Star size={10} />{subtask.bonus_points > 0 ? `${subtask.bonus_points} pts` : 'Bonus'}</span>}
                            </span>
                          </span>
                          <ChevronRight size={15} className="text-slate-300 flex-shrink-0" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </ModalShell>

      <AnimatePresence>
        {selectedSubtask && (
          <SubtaskCard
            key={selectedSubtask.id}
            subtask={selectedSubtask}
            canCheck={canCheck}
            canEdit={canEdit}
            onClose={() => setSelectedSubtask(null)}
            onStatusTap={handleSubtaskStatusTap}
            onSubtaskUpdated={onUpdated}
            onDelete={() => setConfirm({ kind: 'subtask', id: selectedSubtask.id, title: selectedSubtask.title })}
            locked={isProjectClosed}
            projectMembers={localProject.members.map(m => m.user).filter((u): u is NonNullable<typeof u> => Boolean(u))}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAddSubtask && (
          <NewSubtaskSheet
            projectId={localProject.id}
            members={localProject.members}
            sortOrder={localProject.subtasks.length}
            createdBy={user?.id}
            onClose={() => setShowAddSubtask(false)}
            onAdded={handleSubtaskAdded}
          />
        )}
      </AnimatePresence>

      {confirm && (
        <ConfirmModal
          title={confirm.kind === 'project' ? 'Delete this project?' : 'Delete this subtask?'}
          icon={<Trash2 size={16} />}
          tone="danger"
          confirmLabel={confirm.kind === 'project' ? 'Delete project' : 'Delete subtask'}
          busyLabel="Deleting…"
          busy={deleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onClose={() => { setConfirm(null); setDeleteError(null) }}
        >
          {confirm.kind === 'project' ? (
            <p><span className="font-semibold text-slate-900 break-words">{localProject.title}</span> and all {localProject.subtasks.length} of its subtasks will be removed for every member.</p>
          ) : (
            <p><span className="font-semibold text-slate-900 break-words">{confirm.title}</span> will be removed from the project, with its checklist and comments.</p>
          )}
        </ConfirmModal>
      )}
    </>
  )
}

function NewSubtaskSheet({ projectId, members, sortOrder, createdBy, onClose, onAdded }: {
  projectId: string
  members: ProjectMember[]
  sortOrder: number
  createdBy?: string
  onClose: () => void
  onAdded: (s: Subtask) => void
}) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [assignee, setAssignee] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [bonus, setBonus] = useState(0)
  const [requireCheck, setRequireCheck] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!title.trim() || submitting) return
    if (start && end && end <= start) { setError('The end time is before the start time.'); return }
    setSubmitting(true)
    setError(null)
    const input: NewSubtaskInput = {
      title: title.trim(),
      description: desc.trim() || undefined,
      due_date: dueDate || undefined,
      timing: start || undefined,
      end_time: end || undefined,
      require_check: requireCheck,
      bonus_points: bonus,
      assignee_id: assignee || undefined,
      created_by_id: createdBy,
      sort_order: sortOrder,
    }
    const result = await addSubtask(projectId, input)
    setSubmitting(false)
    if (!result) { setError('The subtask was not added. Try again.'); return }
    onAdded(result)
  }

  return (
    <ModalShell
      onClose={onClose}
      size="lg"
      sharp
      title="New subtask"
      icon={<Plus size={16} />}
      iconClassName={TASK_ICON}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn tone="ghost" onClick={onClose} disabled={submitting}>Cancel</Btn>
          <Btn tone="dark" type="submit" form="new-subtask-form" disabled={submitting || !title.trim()}>
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
            {submitting ? 'Adding…' : 'Add subtask'}
          </Btn>
        </div>
      }
    >
      <form id="new-subtask-form" onSubmit={handleSubmit} className="space-y-3">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Subtask name" aria-label="Subtask name" className={`${FIELD} !h-11 !text-[15px] font-medium`} required autoFocus maxLength={200} />
        <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" rows={2} className={`${FIELD} !h-auto py-2 resize-none leading-snug`} />
        <FormGroup>
          <FormRow label="Assigned to">
            <select value={assignee} onChange={e => setAssignee(e.target.value)} className={`${ROW_FIELD} pr-1 cursor-pointer max-w-[14rem]`}>
              <option value="">No one yet</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.user?.full_name || 'Unknown'}</option>)}
            </select>
          </FormRow>
          <FormRow label="Due date"><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={DATE_FIELD} /></FormRow>
          <FormRow label="Time">
            <span className="flex flex-wrap items-center gap-1.5">
              <input type="time" value={start} onChange={e => setStart(e.target.value)} aria-label="Starts" className={TIME_FIELD} />
              <span className="text-[12px] text-slate-400">to</span>
              <input type="time" value={end} onChange={e => setEnd(e.target.value)} aria-label="Ends" className={TIME_FIELD} />
            </span>
          </FormRow>
          <FormRow label="Bonus points" hint="Bonus subtasks always need a check">
            <input
              type="number"
              inputMode="numeric"
              value={bonus || ''}
              placeholder="0"
              onChange={e => { const v = Number(e.target.value) || 0; setBonus(v); if (v !== 0) setRequireCheck(true) }}
              className={`${FIELD} !w-24 text-right tabular-nums`}
            />
          </FormRow>
          <FormRow label="Needs a check">
            <Switch checked={requireCheck} onChange={v => { if (bonus === 0) setRequireCheck(v) }} disabled={bonus !== 0} label="Needs a check" />
          </FormRow>
        </FormGroup>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </ModalShell>
  )
}
