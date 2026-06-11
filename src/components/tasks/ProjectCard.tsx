'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Calendar,
  Clock,
  Tag,
  Plus,
  Trash2,
  Star,
  Users,
  ChevronRight,
  ListOrdered,
  FileText,
  AlertCircle,
  Edit3,
  Check,
  ShieldCheck,
  UserPlus,
  UserMinus,
  Search,
} from 'lucide-react'
import {
  ProjectWithDetails,
  ProjectMember,
  Subtask,
  NewSubtaskInput,
  updateSubtaskStatus,
  addSubtask,
  deleteSubtask,
  deleteProject,
  updateProject,
  addProjectMember,
  removeProjectMember,
} from '@/lib/projects'
import {
  TaskStatus,
  getDynamicStatusLabel,
  getDynamicStatusColors,
  getDynamicDotColor,
  getNextStatus,
} from '@/lib/tasks'
import { UserProfile } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import SubtaskCard from './SubtaskCard'
import { useAuth } from '@/contexts/AuthContext'

interface ProjectCardProps {
  project: ProjectWithDetails
  canEdit: boolean
  canCheck: boolean
  onClose: () => void
  onUpdated: () => void
  availableAssignees?: UserProfile[]
}

export default function ProjectCard({
  project,
  canEdit,
  canCheck,
  onClose,
  onUpdated,
  availableAssignees = [],
}: ProjectCardProps) {
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

  // Member search state
  const [showMemberSearch, setShowMemberSearch] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [addingMember, setAddingMember] = useState<string | null>(null)
  const [removingMember, setRemovingMember] = useState<string | null>(null)

  // Add subtask form state
  const [newSubTitle, setNewSubTitle] = useState('')
  const [newSubDesc, setNewSubDesc] = useState('')
  const [newSubDueDate, setNewSubDueDate] = useState('')
  const [newSubTiming, setNewSubTiming] = useState('')
  const [newSubEndTime, setNewSubEndTime] = useState('')
  const [newSubBonusPoints, setNewSubBonusPoints] = useState(0)
  const [newSubAssignee, setNewSubAssignee] = useState('')
  const [newSubRequireCheck, setNewSubRequireCheck] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Keep local state in sync when project prop updates
  useEffect(() => {
    setLocalProject(project)
    // Sync selectedSubtask if it's open and the project has updated data
    setSelectedSubtask(prev => {
      if (!prev) return prev
      const updated = project.subtasks.find(s => s.id === prev.id)
      return updated ?? prev
    })
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
    const ok = await updateProject(localProject.id, {
      start_date: startDateDraft || null,
      end_date: endDateDraft || null,
    })
    if (ok) {
      setLocalProject(prev => ({
        ...prev,
        start_date: startDateDraft || null,
        end_date: endDateDraft || null,
      }))
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

  const handleSubtaskStatusTap = async (subtask: Subtask) => {
    const next = getNextStatus(subtask.status, canCheck, subtask.require_check ?? false)
    if (next === subtask.status) return

    const result = await updateSubtaskStatus(
      subtask.id,
      next,
      localProject.id,
      localProject.sequential_mode
    )

    if (result.success) {
      setLocalProject(prev => ({
        ...prev,
        subtasks: prev.subtasks.map(s =>
          s.id === subtask.id ? { ...s, status: next } : s
        ),
      }))
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
      setLocalProject(prev => ({
        ...prev,
        subtasks: [...prev.subtasks, result],
      }))
      // Reset form
      setNewSubTitle('')
      setNewSubDesc('')
      setNewSubDueDate('')
      setNewSubTiming('')
      setNewSubEndTime('')
      setNewSubBonusPoints(0)
      setNewSubAssignee('')
      setNewSubRequireCheck(false)
      setShowAddSubtask(false)
      onUpdated()
    }
  }

  const handleDeleteSubtask = async (subtaskId: string) => {
    if (!confirm('Delete this subtask?')) return
    const ok = await deleteSubtask(subtaskId)
    if (ok) {
      setLocalProject(prev => ({
        ...prev,
        subtasks: prev.subtasks.filter(s => s.id !== subtaskId),
      }))
      setSelectedSubtask(null)
      onUpdated()
    }
  }

  const handleDeleteProject = async () => {
    if (!confirm('Delete this entire project and all its subtasks?')) return
    const ok = await deleteProject(localProject.id)
    if (ok) {
      onUpdated()
      onClose()
    }
  }

  // Members that aren't already in the project
  const memberIds = useMemo(
    () => new Set(localProject.members.map(m => m.user_id)),
    [localProject.members]
  )
  const filteredNonMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    return availableAssignees.filter(u => {
      if (memberIds.has(u.id)) return false
      if (!q) return true
      return u.full_name?.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q)
    })
  }, [availableAssignees, memberIds, memberSearch])

  const handleAddMember = async (userId: string) => {
    const userProfile = availableAssignees.find(u => u.id === userId)
    if (!userProfile) return
    setAddingMember(userId)
    const ok = await addProjectMember(localProject.id, userId)
    setAddingMember(null)
    if (ok) {
      const newMember: ProjectMember = {
        id: `temp-${Date.now()}`,
        project_id: localProject.id,
        user_id: userId,
        user: userProfile,
      }
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
      setLocalProject(prev => ({
        ...prev,
        members: prev.members.filter(m => m.user_id !== userId),
      }))
      onUpdated()
    }
  }

  const completedCount = localProject.subtasks.filter(s =>
    s.status === 'checked' || (!s.require_check && s.status === 'done')
  ).length
  const totalCount = localProject.subtasks.length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const modal = (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
        onClick={(e) => { e.stopPropagation(); onClose() }}
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white rounded-t-3xl border-b border-slate-100 px-5 pt-4 pb-4 z-10">
            {/* Mobile drag handle */}
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-3 sm:hidden" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <ListOrdered size={16} className="text-mps-blue-600" />
                  <span className="font-medium">Project</span>
                </div>
                {progress > 0 && (
                  <span className="text-xs font-medium text-slate-500">
                    {progress}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    onClick={handleDeleteProject}
                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="p-5 space-y-5">
            {/* Title */}
            <div>
              {editingTitle && canEdit ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveTitle()}
                    className="flex-1 text-xl font-bold text-slate-800 border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50"
                    autoFocus
                  />
                  <button onClick={handleSaveTitle} className="p-1.5 text-mps-green-600 hover:bg-mps-green-50 rounded-lg">
                    <Check size={16} />
                  </button>
                  <button onClick={() => { setEditingTitle(false); setTitleDraft(localProject.title) }} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <h2 className="text-xl font-bold text-slate-800">{localProject.title}</h2>
                  {canEdit && (
                    <button
                      onClick={() => setEditingTitle(true)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-600 rounded transition-opacity"
                    >
                      <Edit3 size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              {editingDesc && canEdit ? (
                <div className="space-y-2">
                  <textarea
                    value={descDraft}
                    onChange={e => setDescDraft(e.target.value)}
                    rows={3}
                    className="w-full text-sm text-slate-600 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 resize-none"
                    placeholder="Project description..."
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button onClick={handleSaveDesc} className="text-xs px-3 py-1.5 bg-mps-blue-500 text-white rounded-lg hover:bg-mps-blue-600">
                      Save
                    </button>
                    <button onClick={() => { setEditingDesc(false); setDescDraft(localProject.description || '') }} className="text-xs px-3 py-1.5 text-slate-500 hover:bg-slate-100 rounded-lg">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="group">
                  {localProject.description ? (
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {localProject.description}
                      {canEdit && (
                        <button
                          onClick={() => setEditingDesc(true)}
                          className="inline-block ml-2 opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-slate-600 rounded transition-opacity"
                        >
                          <Edit3 size={12} />
                        </button>
                      )}
                    </p>
                  ) : canEdit ? (
                    <button
                      onClick={() => setEditingDesc(true)}
                      className="text-sm text-slate-400 hover:text-slate-600"
                    >
                      + Add description
                    </button>
                  ) : null}
                </div>
              )}
            </div>

            {/* Dates & Sequential Mode */}
            <div className="flex flex-wrap gap-3">
              {editingDates && canEdit ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <Calendar size={14} className="text-slate-500" />
                    <input
                      type="date"
                      value={startDateDraft}
                      onChange={e => setStartDateDraft(e.target.value)}
                      className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-mps-blue-500"
                    />
                    <span className="text-slate-400 text-sm">to</span>
                    <input
                      type="date"
                      value={endDateDraft}
                      onChange={e => setEndDateDraft(e.target.value)}
                      className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-mps-blue-500"
                    />
                  </div>
                  <button onClick={handleSaveDates} className="p-1.5 text-mps-green-600 hover:bg-mps-green-50 rounded-lg">
                    <Check size={14} />
                  </button>
                  <button onClick={() => { setEditingDates(false); setStartDateDraft(localProject.start_date || ''); setEndDateDraft(localProject.end_date || '') }} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  {(localProject.start_date || localProject.end_date) && (
                    <button
                      onClick={() => canEdit && setEditingDates(true)}
                      className="flex items-center gap-1.5 text-sm text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <Calendar size={14} />
                      <span>
                        {localProject.start_date || '?'} - {localProject.end_date || '?'}
                      </span>
                    </button>
                  )}
                  {!localProject.start_date && !localProject.end_date && canEdit && (
                    <button
                      onClick={() => setEditingDates(true)}
                      className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1"
                    >
                      <Calendar size={14} /> + Add dates
                    </button>
                  )}
                </>
              )}

              {/* Sequential mode toggle */}
              <button
                onClick={() => canEdit && handleToggleSequential()}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors ${
                  localProject.sequential_mode
                    ? 'bg-purple-50 text-purple-700 border border-purple-200'
                    : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                } ${!canEdit ? 'cursor-default' : 'cursor-pointer'}`}
                disabled={!canEdit}
              >
                <ListOrdered size={14} />
                Sequential {localProject.sequential_mode ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* Progress bar */}
            {totalCount > 0 && (
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                  <span>Progress</span>
                  <span>{completedCount}/{totalCount} subtasks ({progress}%)</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-mps-blue-500 to-slate-400 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
            )}

            {/* Members */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <Users size={14} />
                  Members ({localProject.members.length})
                </h4>
                {canEdit && availableAssignees.length > 0 && (
                  <button
                    onClick={() => { setShowMemberSearch(v => !v); setMemberSearch('') }}
                    className="flex items-center gap-1 text-xs text-mps-blue-600 hover:text-mps-blue-700 font-medium"
                  >
                    <UserPlus size={13} /> Add member
                  </button>
                )}
              </div>

              {/* Member search panel */}
              <AnimatePresence>
                {showMemberSearch && canEdit && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden mb-3"
                  >
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="relative border-b border-slate-100">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                          autoFocus
                          type="text"
                          value={memberSearch}
                          onChange={e => setMemberSearch(e.target.value)}
                          placeholder="Search by name or role…"
                          className="w-full pl-8 pr-3 py-2.5 text-sm focus:outline-none bg-slate-50"
                        />
                      </div>
                      <div className="max-h-44 overflow-y-auto divide-y divide-slate-50">
                        {filteredNonMembers.length === 0 ? (
                          <p className="text-center text-xs text-slate-400 py-4">
                            {memberSearch ? 'No matching users' : 'All available users are already members'}
                          </p>
                        ) : (
                          filteredNonMembers.map(user => (
                            <button
                              key={user.id}
                              onClick={() => handleAddMember(user.id)}
                              disabled={addingMember === user.id}
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-mps-blue-50 text-left transition-colors disabled:opacity-60"
                            >
                              <Avatar avatarUrl={user.avatar_url} name={user.full_name} size={28} userId={user.id} />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-slate-700 truncate">{user.full_name}</p>
                                <p className="text-[11px] text-slate-400 capitalize">{user.role}</p>
                              </div>
                              {addingMember === user.id ? (
                                <span className="text-[10px] text-slate-400">Adding…</span>
                              ) : (
                                <Plus size={14} className="text-mps-blue-500 flex-shrink-0" />
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex flex-wrap gap-2">
                {localProject.members.map(m => (
                  <span
                    key={m.id}
                    className="flex items-center gap-1.5 text-xs bg-mps-blue-50 text-mps-blue-700 px-2.5 py-1 rounded-full font-medium"
                  >
                    <Avatar avatarUrl={m.user?.avatar_url} name={m.user?.full_name} size={20} userId={m.user?.id} />
                    {m.user?.full_name || 'Unknown'}
                    {canEdit && (
                      <button
                        onClick={() => handleRemoveMember(m.user_id)}
                        disabled={removingMember === m.user_id}
                        className="ml-0.5 text-mps-blue-400 hover:text-red-500 disabled:opacity-40 transition-colors"
                        title="Remove member"
                      >
                        {removingMember === m.user_id ? (
                          <span className="text-[9px]">…</span>
                        ) : (
                          <X size={11} />
                        )}
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>

            {/* Sequential mode tooltip */}
            <AnimatePresence>
              {sequentialTooltip && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-2.5 rounded-xl"
                >
                  <AlertCircle size={16} />
                  {sequentialTooltip}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Subtasks */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <FileText size={14} />
                  Subtasks ({totalCount})
                </h4>
                {canEdit && (
                  <button
                    onClick={() => setShowAddSubtask(!showAddSubtask)}
                    className="text-sm text-mps-blue-600 hover:text-mps-blue-700 font-medium flex items-center gap-1"
                  >
                    <Plus size={14} /> Add
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {localProject.subtasks.map((subtask, index) => (
                  <motion.div
                    key={subtask.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="glass rounded-xl p-3 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setSelectedSubtask(subtask)}
                  >
                    <div className="flex items-center gap-2.5">
                      {/* Compact circle status button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSubtaskStatusTap(subtask) }}
                        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all active:scale-95 hover:shadow-md ${getDynamicStatusColors(subtask.status, subtask.require_check)}`}
                        title={`${getDynamicStatusLabel(subtask.status, subtask.require_check)} — tap to change`}
                      >
                        <div className={`w-3 h-3 rounded-full ${getDynamicDotColor(subtask.status, subtask.require_check)}`} />
                      </button>

                      {/* Subtask info */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm truncate ${
                          (subtask.status === 'checked' || (!subtask.require_check && subtask.status === 'done'))
                            ? 'line-through text-slate-400' : 'text-slate-800'
                        }`}>
                          {localProject.sequential_mode && (
                            <span className="text-xs text-slate-400 mr-1.5">#{index + 1}</span>
                          )}
                          {subtask.title}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5 overflow-hidden">
                          {subtask.assignee && (
                            <span className="text-xs text-slate-500 truncate min-w-0 flex-shrink">
                              {subtask.assignee.full_name}
                            </span>
                          )}
                          {subtask.due_date && (
                            <span className="text-xs text-slate-400 flex items-center gap-0.5 flex-shrink-0">
                              <Calendar size={9} /> {subtask.due_date}
                            </span>
                          )}
                          {subtask.timing && (
                            <span className="hidden sm:flex text-xs text-slate-400 items-center gap-0.5 flex-shrink-0">
                              <Clock size={9} /> {subtask.timing}
                            </span>
                          )}
                          {(subtask.bonus_points > 0 || subtask.tag === 'bonus') && (
                            <span className="text-xs px-1 py-0.5 bg-amber-100 text-amber-700 rounded font-medium flex items-center gap-0.5 flex-shrink-0">
                              <Star size={8} /> {subtask.bonus_points > 0 ? `${subtask.bonus_points}BP` : 'B'}
                            </span>
                          )}
                        </div>
                      </div>

                      <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
                    </div>
                  </motion.div>
                ))}

                {totalCount === 0 && (
                  <div className="text-center py-6 text-sm text-slate-400">
                    No subtasks yet.{' '}
                    {canEdit && (
                      <button
                        onClick={() => setShowAddSubtask(true)}
                        className="text-mps-blue-600 hover:text-mps-blue-700 font-medium"
                      >
                        Add one
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Add Subtask Form */}
            <AnimatePresence>
              {showAddSubtask && canEdit && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <form onSubmit={handleAddSubtask} className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                    {/* Form header */}
                    <div className="bg-gradient-to-r from-mps-blue-50 to-slate-50 px-4 py-3 border-b border-slate-200 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-mps-blue-500 flex items-center justify-center">
                        <Plus size={14} className="text-white" />
                      </div>
                      <h5 className="text-sm font-semibold text-slate-700">New Subtask</h5>
                    </div>

                    <div className="p-4 space-y-3">
                      <input
                        type="text"
                        value={newSubTitle}
                        onChange={e => setNewSubTitle(e.target.value)}
                        placeholder="Subtask title *"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 focus:border-mps-blue-500 bg-slate-50/50"
                        required
                        autoFocus
                      />

                      <textarea
                        value={newSubDesc}
                        onChange={e => setNewSubDesc(e.target.value)}
                        placeholder="Description (optional)"
                        rows={2}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 resize-none bg-slate-50/50"
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Assignee</label>
                          <select
                            value={newSubAssignee}
                            onChange={e => setNewSubAssignee(e.target.value)}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 bg-white"
                          >
                            <option value="">Unassigned</option>
                            {localProject.members.map(m => (
                              <option key={m.user_id} value={m.user_id}>
                                {m.user?.full_name || 'Unknown'}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Due Date</label>
                          <input
                            type="date"
                            value={newSubDueDate}
                            onChange={e => setNewSubDueDate(e.target.value)}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Start Time</label>
                          <input
                            type="time"
                            value={newSubTiming}
                            onChange={e => setNewSubTiming(e.target.value)}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">End Time</label>
                          <input
                            type="time"
                            value={newSubEndTime}
                            onChange={e => setNewSubEndTime(e.target.value)}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Bonus Points</label>
                          <input
                            type="number"
                            value={newSubBonusPoints}
                            onChange={e => {
                              const val = Number(e.target.value)
                              setNewSubBonusPoints(val)
                              if (val !== 0) setNewSubRequireCheck(true)
                            }}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 bg-white"
                            placeholder="0"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Verification</label>
                          <button
                            type="button"
                            onClick={() => newSubBonusPoints === 0 && setNewSubRequireCheck(v => !v)}
                            disabled={newSubBonusPoints !== 0}
                            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                              newSubRequireCheck
                                ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-sm'
                                : 'bg-white border-slate-200 text-slate-500'
                            } ${newSubBonusPoints !== 0 ? 'cursor-not-allowed' : 'hover:border-slate-300'}`}
                          >
                            <ShieldCheck size={14} className={newSubRequireCheck ? 'text-amber-600' : 'text-slate-400'} />
                            {newSubBonusPoints !== 0 ? 'Locked ON' : newSubRequireCheck ? 'Required' : 'Not required'}
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                        <button
                          type="submit"
                          disabled={submitting || !newSubTitle.trim()}
                          className="flex-1 btn-primary text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          {submitting ? 'Adding...' : 'Add Subtask'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAddSubtask(false)}
                          className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )

  if (typeof document === 'undefined') return null

  return (
    <>
      {createPortal(modal, document.body)}
      {selectedSubtask && createPortal(
        <AnimatePresence>
          <SubtaskCard
            subtask={selectedSubtask}
            canCheck={canCheck}
            canEdit={canEdit}
            onClose={() => setSelectedSubtask(null)}
            onStatusTap={handleSubtaskStatusTap}
            onSubtaskUpdated={onUpdated}
            onDelete={() => handleDeleteSubtask(selectedSubtask.id)}
            projectMembers={localProject.members
              .map(m => m.user)
              .filter((u): u is NonNullable<typeof u> => Boolean(u))}
          />
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
