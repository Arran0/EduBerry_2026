'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import { X, Calendar, Clock, Plus, Trash2, Star, Users, ChevronRight, ListOrdered, FileText, Edit3, Check, UserPlus, Search, FolderKanban, Loader2 } from 'lucide-react'
import {
  ProjectWithDetails, ProjectMember, Subtask, NewSubtaskInput, updateSubtaskStatus, addSubtask, deleteSubtask,
  deleteProject, updateProject, addProjectMember, removeProjectMember,
} from '@/lib/projects'
import { getDynamicStatusLabel, getDynamicStatusColors, getDynamicDotColor, getNextStatus, canVerifyTask } from '@/lib/tasks'
import { formatSlotTime } from '@/lib/taskSlots'
import { UserProfile } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import SubtaskCard from './SubtaskCard'
import { useAuth } from '@/contexts/AuthContext'
import { Btn, IconBtn, ConfirmSheet, FormCard, FormRow, Toggle, Notice, TaskSheet, Field, SubHead, shortDate } from './ui'

interface ProjectCardProps {
  project: ProjectWithDetails
  canEdit: boolean
  canCheck: boolean
  onClose: () => void
  onUpdated: () => void
  availableAssignees?: UserProfile[]
}

export default function ProjectCard({ project, canEdit, canCheck, onClose, onUpdated, availableAssignees = [] }: ProjectCardProps) {
  const { user } = useAuth()
  const [localProject, setLocalProject] = useState(project)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [titleDraft, setTitleDraft] = useState(project.title)
  const [descDraft, setDescDraft] = useState(project.description || '')
  const [editingDates, setEditingDates] = useState(false)
  const [startDateDraft, setStartDateDraft] = useState(project.start_date || '')
  const [endDateDraft, setEndDateDraft] = useState(project.end_date || '')
  const [showAddSubtask, setShowAddSubtask] = useState(false)
  const [selectedSubtask, setSelectedSubtask] = useState<Subtask | null>(null)
  const [sequentialTooltip, setSequentialTooltip] = useState<string | null>(null)

  const [showMemberSearch, setShowMemberSearch] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [addingMember, setAddingMember] = useState<string | null>(null)
  const [removingMember, setRemovingMember] = useState<string | null>(null)

  const [newSubTitle, setNewSubTitle] = useState('')
  const [newSubDesc, setNewSubDesc] = useState('')
  const [newSubDueDate, setNewSubDueDate] = useState('')
  const [newSubTiming, setNewSubTiming] = useState('')
  const [newSubEndTime, setNewSubEndTime] = useState('')
  const [newSubBonusPoints, setNewSubBonusPoints] = useState(0)
  const [newSubAssignee, setNewSubAssignee] = useState('')
  const [newSubRequireCheck, setNewSubRequireCheck] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [confirm, setConfirm] = useState<{ kind: 'project' } | { kind: 'subtask'; id: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Follow the parent's fresh data, including an open subtask.
  useEffect(() => {
    setLocalProject(project)
    setSelectedSubtask(prev => (prev ? project.subtasks.find(s => s.id === prev.id) ?? prev : prev))
  }, [project])

  const handleSaveTitle = async () => {
    if (!titleDraft.trim()) return
    const ok = await updateProject(localProject.id, { title: titleDraft.trim() })
    if (ok) {
      setLocalProject(prev => ({ ...prev, title: titleDraft.trim() }))
      setEditingTitle(false)
      onUpdated()
    }
  }

  const handleSaveDesc = async () => {
    const ok = await updateProject(localProject.id, { description: descDraft.trim() || null })
    if (ok) {
      setLocalProject(prev => ({ ...prev, description: descDraft.trim() || null }))
      setEditingDesc(false)
      onUpdated()
    }
  }

  const handleSaveDates = async () => {
    const ok = await updateProject(localProject.id, { start_date: startDateDraft || null, end_date: endDateDraft || null })
    if (ok) {
      setLocalProject(prev => ({ ...prev, start_date: startDateDraft || null, end_date: endDateDraft || null }))
      setEditingDates(false)
      onUpdated()
    }
  }

  const handleToggleSequential = async () => {
    const newValue = !localProject.sequential_mode
    const ok = await updateProject(localProject.id, { sequential_mode: newValue })
    if (ok) {
      setLocalProject(prev => ({ ...prev, sequential_mode: newValue }))
      onUpdated()
    }
  }

  // Dismissed subtasks count as deleted — left out of the progress figures.
  const countableSubtasks = localProject.subtasks.filter(s => s.status !== 'dismissed')
  const completedCount = countableSubtasks.filter(s => s.status === 'checked' || (!s.require_check && s.status === 'done')).length
  const totalCount = countableSubtasks.length
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
      setSequentialTooltip(result.error)
      setTimeout(() => setSequentialTooltip(null), 2500)
    }
  }

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSubTitle.trim()) return
    setSubmitting(true)
    const input: NewSubtaskInput = {
      title: newSubTitle.trim(),
      description: newSubDesc.trim() || undefined,
      due_date: newSubDueDate || undefined,
      timing: newSubTiming || undefined,
      end_time: newSubEndTime || undefined,
      require_check: newSubRequireCheck,
      bonus_points: newSubBonusPoints,
      assignee_id: newSubAssignee || undefined,
      created_by_id: user?.id,
      sort_order: localProject.subtasks.length,
    }
    const result = await addSubtask(localProject.id, input)
    setSubmitting(false)
    if (result) {
      setLocalProject(prev => ({ ...prev, subtasks: [...prev.subtasks, result] }))
      setNewSubTitle(''); setNewSubDesc(''); setNewSubDueDate(''); setNewSubTiming(''); setNewSubEndTime('')
      setNewSubBonusPoints(0); setNewSubAssignee(''); setNewSubRequireCheck(false)
      setShowAddSubtask(false)
      onUpdated()
    }
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

  const memberIds = useMemo(() => new Set(localProject.members.map(m => m.user_id)), [localProject.members])
  const filteredNonMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    return availableAssignees.filter(u => !memberIds.has(u.id) && (!q || u.full_name?.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q)))
  }, [availableAssignees, memberIds, memberSearch])

  const handleAddMember = async (userId: string) => {
    const userProfile = availableAssignees.find(u => u.id === userId)
    if (!userProfile) return
    setAddingMember(userId)
    const ok = await addProjectMember(localProject.id, userId)
    setAddingMember(null)
    if (ok) {
      const newMember: ProjectMember = { id: `temp-${Date.now()}`, project_id: localProject.id, user_id: userId, user: userProfile }
      setLocalProject(prev => ({ ...prev, members: [...prev.members, newMember] }))
      setMemberSearch('')
      onUpdated()
    }
  }

  const handleRemoveMember = async (userId: string) => {
    setRemovingMember(userId)
    const ok = await removeProjectMember(localProject.id, userId)
    setRemovingMember(null)
    if (ok) {
      setLocalProject(prev => ({ ...prev, members: prev.members.filter(m => m.user_id !== userId) }))
      onUpdated()
    }
  }

  const ok = 'w-8 h-8 inline-flex items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-50 flex-shrink-0'
  const cancel = 'w-8 h-8 inline-flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 flex-shrink-0'

  return (
    <>
      <TaskSheet
        onClose={onClose}
        size="xl"
        title={editingTitle && canEdit ? 'Rename project' : localProject.title}
        subtitle={totalCount > 0 ? `Project, ${completedCount} of ${totalCount} subtasks complete` : 'Project'}
        icon={FolderKanban}
        headerActions={canEdit ? (
          <IconBtn quiet label="Delete project" onClick={() => setConfirm({ kind: 'project' })} className="hover:!text-red-600">
            <Trash2 size={15} />
          </IconBtn>
        ) : undefined}
      >
        <div className="space-y-4">
          {/* Title */}
          {editingTitle && canEdit ? (
            <div className="flex items-center gap-1.5">
              <input
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveTitle()}
                className="tk-input !h-11 !text-[16px] font-semibold"
                autoFocus
              />
              <button onClick={handleSaveTitle} className={ok} aria-label="Save name"><Check size={16} /></button>
              <button onClick={() => { setEditingTitle(false); setTitleDraft(localProject.title) }} className={cancel} aria-label="Cancel"><X size={16} /></button>
            </div>
          ) : canEdit ? (
            <button onClick={() => setEditingTitle(true)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-700 hover:text-amber-800">
              <Edit3 size={12} /> Rename
            </button>
          ) : null}

          {/* Description */}
          {editingDesc && canEdit ? (
            <div className="space-y-2">
              <textarea value={descDraft} onChange={e => setDescDraft(e.target.value)} rows={3} className="tk-input" placeholder="Project description" autoFocus />
              <div className="flex gap-2">
                <Btn tone="primary" onClick={handleSaveDesc}>Save</Btn>
                <Btn onClick={() => { setEditingDesc(false); setDescDraft(localProject.description || '') }}>Cancel</Btn>
              </div>
            </div>
          ) : localProject.description ? (
            <p className="group text-[13.5px] text-slate-600 leading-relaxed break-words whitespace-pre-wrap">
              {localProject.description}
              {canEdit && (
                <button onClick={() => setEditingDesc(true)} className="inline-flex ml-1.5 align-middle text-slate-400 hover:text-amber-700" aria-label="Edit description"><Edit3 size={12} /></button>
              )}
            </p>
          ) : canEdit ? (
            <button onClick={() => setEditingDesc(true)} className="text-[13px] text-slate-400 hover:text-amber-700">+ Add description</button>
          ) : null}

          {/* Dates and sequential mode */}
          <div className="flex flex-wrap items-center gap-2">
            {editingDates && canEdit ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <input type="date" value={startDateDraft} onChange={e => setStartDateDraft(e.target.value)} aria-label="Start date" className="tk-input !w-[10rem]" />
                <span className="text-[12px] text-slate-400">to</span>
                <input type="date" value={endDateDraft} onChange={e => setEndDateDraft(e.target.value)} aria-label="End date" className="tk-input !w-[10rem]" />
                <button onClick={handleSaveDates} className={ok} aria-label="Save dates"><Check size={15} /></button>
                <button onClick={() => { setEditingDates(false); setStartDateDraft(localProject.start_date || ''); setEndDateDraft(localProject.end_date || '') }} className={cancel} aria-label="Cancel"><X size={15} /></button>
              </div>
            ) : (localProject.start_date || localProject.end_date) ? (
              <button
                onClick={() => canEdit && setEditingDates(true)}
                className="inline-flex items-center gap-1.5 min-h-[30px] px-3 py-1 rounded-full bg-[#fbf6ee] border border-amber-900/[0.08] text-[12.5px] font-medium text-slate-700 hover:border-amber-300 transition-colors"
              >
                <Calendar size={13} className="text-amber-600" />
                {shortDate(localProject.start_date)} – {shortDate(localProject.end_date)}
              </button>
            ) : canEdit ? (
              <button onClick={() => setEditingDates(true)} className="inline-flex items-center gap-1 text-[13px] text-slate-400 hover:text-amber-700">
                <Calendar size={13} /> + Add dates
              </button>
            ) : null}
            <button
              onClick={() => canEdit && handleToggleSequential()}
              disabled={!canEdit}
              className={`inline-flex items-center gap-1.5 min-h-[30px] px-3 py-1 rounded-full border text-[12.5px] font-medium transition-colors ${
                localProject.sequential_mode ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-white text-slate-500 border-amber-900/[0.1] hover:border-amber-300'} ${!canEdit ? 'cursor-default' : ''}`}
            >
              <ListOrdered size={13} />
              Sequential {localProject.sequential_mode ? 'on' : 'off'}
            </button>
          </div>

          {totalCount > 0 && (
            <div>
              <div className="flex items-center justify-between text-[12px] text-slate-500 mb-1.5">
                <span>Progress</span>
                <span className="font-semibold text-slate-700 tabular-nums">{completedCount}/{totalCount} subtasks, {progress}%</span>
              </div>
              <div className="h-2 bg-amber-900/[0.07] rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-[width] duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Members */}
          <section>
            <SubHead
              icon={Users}
              count={localProject.members.length}
              right={canEdit && availableAssignees.length > 0 ? (
                <button onClick={() => { setShowMemberSearch(v => !v); setMemberSearch('') }} className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-700 hover:text-amber-800">
                  <UserPlus size={13} /> {showMemberSearch ? 'Done' : 'Add member'}
                </button>
              ) : undefined}
            >
              Members
            </SubHead>
            {showMemberSearch && canEdit && (
              <div className="tk-card !rounded-[14px] overflow-hidden mb-2">
                <div className="p-2 border-b border-amber-900/[0.07]">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input autoFocus value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="Search by name or role" className="tk-input !pl-8" />
                  </div>
                </div>
                <div className="max-h-44 overflow-y-auto overscroll-contain">
                  {filteredNonMembers.length === 0 ? (
                    <p className="text-center text-[12px] text-slate-400 py-4">{memberSearch ? 'No matching users' : 'Everyone available is already a member'}</p>
                  ) : filteredNonMembers.map(u => (
                    <button
                      key={u.id}
                      onClick={() => handleAddMember(u.id)}
                      disabled={addingMember === u.id}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-amber-50/60 transition-colors disabled:opacity-60"
                    >
                      <Avatar avatarUrl={u.avatar_url} name={u.full_name} size={26} userId={u.id} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium text-slate-700 break-words">{u.full_name}</span>
                        <span className="block text-[11px] text-slate-400 capitalize">{u.role}</span>
                      </span>
                      {addingMember === u.id ? <Loader2 size={14} className="animate-spin text-amber-500" /> : <Plus size={14} className="text-amber-600 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {localProject.members.map(m => (
                <span key={m.id} className="inline-flex items-center gap-1.5 min-h-[28px] py-0.5 pl-0.5 pr-1 rounded-full bg-amber-50 border border-amber-100 text-[12px] font-medium text-amber-900 max-w-full">
                  <Avatar avatarUrl={m.user?.avatar_url} name={m.user?.full_name} size={24} userId={m.user?.id} />
                  <span className="min-w-0 break-words leading-tight pr-1">{m.user?.full_name || 'Unknown'}</span>
                  {canEdit && (
                    <button
                      onClick={() => handleRemoveMember(m.user_id)}
                      disabled={removingMember === m.user_id}
                      className="w-5 h-5 inline-flex items-center justify-center rounded-full text-amber-500 hover:text-red-500 hover:bg-white disabled:opacity-40 transition flex-shrink-0"
                      aria-label={`Remove ${m.user?.full_name || 'member'}`}
                    >
                      {removingMember === m.user_id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                    </button>
                  )}
                </span>
              ))}
            </div>
          </section>

          {sequentialTooltip && (
            <Notice tone="warn">{sequentialTooltip}</Notice>
          )}

          {/* Subtasks */}
          <section>
            <SubHead
              icon={FileText}
              count={totalCount}
              right={canEdit ? (
                <button onClick={() => setShowAddSubtask(v => !v)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-700 hover:text-amber-800">
                  <Plus size={13} /> Add
                </button>
              ) : undefined}
            >
              Subtasks
            </SubHead>
            {localProject.subtasks.length > 0 ? (
              <div className="tk-card !rounded-[14px] tk-rule overflow-hidden">
                {localProject.subtasks.map((subtask, index) => {
                  const struck = subtask.status === 'checked' || subtask.status === 'dismissed' || (!subtask.require_check && subtask.status === 'done')
                  return (
                    <div key={subtask.id} className={`flex items-center gap-2 pl-2 pr-1.5 hover:bg-amber-50/40 transition-colors ${subtask.status === 'dismissed' ? 'opacity-60' : ''}`}>
                      <button
                        onClick={() => handleSubtaskStatusTap(subtask)}
                        disabled={isProjectClosed}
                        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border-2 transition ${isProjectClosed ? 'cursor-not-allowed' : 'active:scale-95'} ${getDynamicStatusColors(subtask.status, subtask.require_check)}`}
                        title={isProjectClosed ? 'Project completed, status locked' : `${getDynamicStatusLabel(subtask.status, subtask.require_check)}: tap to change`}
                        aria-label={getDynamicStatusLabel(subtask.status, subtask.require_check)}
                      >
                        <span className={`w-3 h-3 rounded-full ${getDynamicDotColor(subtask.status, subtask.require_check)}`} />
                      </button>
                      <button onClick={() => setSelectedSubtask(subtask)} className="flex-1 min-w-0 flex items-center gap-2 py-2 text-left">
                        <span className="flex-1 min-w-0">
                          <span className={`block text-[13.5px] font-medium leading-snug break-words ${struck ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                            {localProject.sequential_mode && <span className="text-[12px] text-slate-400 mr-1 tabular-nums">#{index + 1}</span>}
                            {subtask.title}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-0.5 text-[11.5px] text-slate-500">
                            {subtask.assignee && <span className="break-words">{subtask.assignee.full_name}</span>}
                            {subtask.due_date && <span className="inline-flex items-center gap-1"><Calendar size={10} />{shortDate(subtask.due_date)}</span>}
                            {subtask.timing && <span className="inline-flex items-center gap-1"><Clock size={10} />{formatSlotTime(subtask.timing)}</span>}
                            {(subtask.bonus_points > 0 || subtask.tag === 'bonus') && (
                              <span className="inline-flex items-center gap-1 text-amber-700 font-semibold"><Star size={10} />{subtask.bonus_points > 0 ? `${subtask.bonus_points} BP` : 'Bonus'}</span>
                            )}
                          </span>
                        </span>
                        <ChevronRight size={15} className="text-slate-300 flex-shrink-0" />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : !showAddSubtask && (
              <div className="tk-well px-4 py-5 text-center text-[13px] text-slate-500">
                No subtasks yet.{' '}
                {canEdit && <button onClick={() => setShowAddSubtask(true)} className="font-semibold text-amber-700 hover:text-amber-800">Add one</button>}
              </div>
            )}
          </section>

          {/* Add subtask */}
          {showAddSubtask && canEdit && (
            <form onSubmit={handleAddSubtask} className="space-y-2.5">
              <SubHead icon={Plus}>New subtask</SubHead>
              <input value={newSubTitle} onChange={e => setNewSubTitle(e.target.value)} placeholder="Subtask title" aria-label="Subtask title" className="tk-input" required autoFocus />
              <textarea value={newSubDesc} onChange={e => setNewSubDesc(e.target.value)} placeholder="Description (optional)" rows={2} className="tk-input" />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Assignee">
                  <select value={newSubAssignee} onChange={e => setNewSubAssignee(e.target.value)} className="tk-input cursor-pointer">
                    <option value="">Unassigned</option>
                    {localProject.members.map(m => <option key={m.user_id} value={m.user_id}>{m.user?.full_name || 'Unknown'}</option>)}
                  </select>
                </Field>
                <Field label="Due date"><input type="date" value={newSubDueDate} onChange={e => setNewSubDueDate(e.target.value)} className="tk-input" /></Field>
                <Field label="Start time"><input type="time" value={newSubTiming} onChange={e => setNewSubTiming(e.target.value)} className="tk-input" /></Field>
                <Field label="End time"><input type="time" value={newSubEndTime} onChange={e => setNewSubEndTime(e.target.value)} className="tk-input" /></Field>
              </div>
              <FormCard>
                <FormRow label="Bonus points" hint="Bonus subtasks always need verification">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={newSubBonusPoints || ''}
                    placeholder="0"
                    onChange={e => { const val = Number(e.target.value) || 0; setNewSubBonusPoints(val); if (val !== 0) setNewSubRequireCheck(true) }}
                    className="tk-input !w-24 text-right tabular-nums"
                  />
                </FormRow>
                <FormRow label="Verification">
                  <Toggle checked={newSubRequireCheck} onChange={v => { if (newSubBonusPoints === 0) setNewSubRequireCheck(v) }} disabled={newSubBonusPoints !== 0} label="Require verification" />
                </FormRow>
              </FormCard>
              <div className="flex items-center justify-end gap-2">
                <Btn onClick={() => setShowAddSubtask(false)}>Cancel</Btn>
                <Btn tone="primary" type="submit" disabled={submitting || !newSubTitle.trim()}>
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
                  {submitting ? 'Adding…' : 'Add subtask'}
                </Btn>
              </div>
            </form>
          )}
        </div>
      </TaskSheet>

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

      {confirm && (
        <ConfirmSheet
          title={confirm.kind === 'project' ? 'Delete this project?' : 'Delete this subtask?'}
          icon={Trash2}
          confirmLabel={deleting ? 'Deleting…' : confirm.kind === 'project' ? 'Delete project' : 'Delete subtask'}
          busy={deleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onClose={() => { setConfirm(null); setDeleteError(null) }}
        >
          {confirm.kind === 'project'
            ? <p><span className="font-semibold text-slate-800 break-words">{localProject.title}</span> and all its subtasks will be removed.</p>
            : <p><span className="font-semibold text-slate-800 break-words">{confirm.title}</span> will be removed from the project.</p>}
        </ConfirmSheet>
      )}
    </>
  )
}
