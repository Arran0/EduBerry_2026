'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Calendar,
  FileText,
  Users,
  ListOrdered,
  FolderKanban,
  ArrowRight,
  Plus,
  Search,
} from 'lucide-react'
import { createProject, NewProjectInput } from '@/lib/projects'
import { UserProfile } from '@/lib/supabase'
import Avatar from '@/components/Avatar'

interface NewProjectFormProps {
  isOpen: boolean
  onClose: () => void
  onProjectCreated: () => void
  currentUserId: string
  availableAssignees: UserProfile[]
}

export default function NewProjectForm({
  isOpen,
  onClose,
  onProjectCreated,
  currentUserId,
  availableAssignees,
}: NewProjectFormProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [sequentialMode, setSequentialMode] = useState(false)
  const [selectedMembers, setSelectedMembers] = useState<string[]>([currentUserId])
  const [memberSearch, setMemberSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setDescription('')
      setStartDate('')
      setEndDate('')
      setSequentialMode(false)
      setSelectedMembers([currentUserId])
      setMemberSearch('')
    }
  }, [isOpen, currentUserId])

  // Type-ahead: only compute suggestions once the user types, exclude anyone
  // already selected, and cap the list so a large staff directory never floods
  // the form (or pays the cost of rendering hundreds of rows at once).
  const suggestions = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    if (!q) return []
    return availableAssignees
      .filter(u => !selectedMembers.includes(u.id))
      .filter(u =>
        u.full_name?.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [availableAssignees, memberSearch, selectedMembers])

  const selectedProfiles = useMemo(
    () => selectedMembers
      .map(id => availableAssignees.find(u => u.id === id))
      .filter((u): u is UserProfile => !!u),
    [selectedMembers, availableAssignees],
  )

  const toggleMember = (userId: string) => {
    setSelectedMembers(prev => {
      if (userId === currentUserId && prev.includes(userId)) return prev
      return prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setSubmitting(true)
    const input: NewProjectInput = {
      title: title.trim(),
      description: description.trim() || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      sequential_mode: sequentialMode,
      member_ids: selectedMembers,
    }

    const project = await createProject(input, currentUserId)
    setSubmitting(false)

    if (project) {
      onProjectCreated()
      onClose()
    }
  }

  const formContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex-shrink-0 px-5 pt-5 pb-4 border-b border-slate-100">
              {/* Mobile drag handle */}
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="icon-chip w-11 h-11 flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                  >
                    <FolderKanban size={20} className="relative z-10 text-white drop-shadow-sm" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">New Project</h2>
                    <p className="text-xs text-slate-400">Create a project with subtasks</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Title */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">
                  Project Title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Science Fair Preparation"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 focus:border-mps-blue-500 bg-slate-50/50"
                  required
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                  <FileText size={12} /> Description
                  <span className="font-normal text-slate-400 normal-case tracking-normal">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What is this project about?"
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 focus:border-mps-blue-500 resize-none bg-slate-50/50"
                />
              </div>

              {/* Dates */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                  <Calendar size={12} /> Date Range
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 focus:border-mps-blue-500"
                  />
                  <ArrowRight size={14} className="text-slate-300 flex-shrink-0" />
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 focus:border-mps-blue-500"
                  />
                </div>
              </div>

              {/* Sequential Mode */}
              <button
                type="button"
                onClick={() => setSequentialMode(!sequentialMode)}
                className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all text-left ${
                  sequentialMode
                    ? 'bg-purple-50 border-purple-200 text-purple-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                <div className={`w-9 h-5 rounded-full flex items-center transition-colors flex-shrink-0 ${
                  sequentialMode ? 'bg-purple-500 justify-end pr-0.5' : 'bg-slate-300 justify-start pl-0.5'
                }`}>
                  <div className="w-4 h-4 bg-white rounded-full shadow" />
                </div>
                <ListOrdered size={15} className={sequentialMode ? 'text-purple-600' : 'text-slate-500'} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">Sequential Mode</p>
                  <p className="text-xs opacity-70">Subtasks must be completed in order</p>
                </div>
                {sequentialMode && (
                  <span className="ml-auto text-xs font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full flex-shrink-0">ON</span>
                )}
              </button>

              {/* Members — type-ahead (no upfront full-staff render) */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Users size={12} /> Members
                  {selectedMembers.length > 0 && (
                    <span className="font-bold bg-mps-blue-100 text-mps-blue-600 px-1.5 py-0.5 rounded-full text-[10px]">
                      {selectedMembers.length} selected
                    </span>
                  )}
                </label>

                {/* Selected chips */}
                {selectedProfiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selectedProfiles.map(u => {
                      const isCurrent = u.id === currentUserId
                      return (
                        <span key={u.id} className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-mps-blue-50 border border-mps-blue-200 text-xs text-mps-blue-700 font-medium">
                          <Avatar avatarUrl={u.avatar_url} name={u.full_name} size={18} />
                          <span className="truncate max-w-[120px]">{isCurrent ? 'You' : u.full_name}</span>
                          {!isCurrent && (
                            <button type="button" onClick={() => toggleMember(u.id)} className="text-mps-blue-400 hover:text-mps-blue-600">
                              <X size={12} />
                            </button>
                          )}
                        </span>
                      )
                    })}
                  </div>
                )}

                {/* Search input */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={e => setMemberSearch(e.target.value)}
                    placeholder="Type a name or role to add staff…"
                    className="w-full border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 focus:border-mps-blue-500 bg-slate-50"
                  />
                </div>

                {/* Suggestions — inline so the modal's scroll never clips them */}
                {memberSearch.trim() && (
                  <div className="mt-1 rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden max-h-52 overflow-y-auto">
                    {suggestions.length === 0 ? (
                      <p className="text-center text-sm text-slate-400 py-3">No matching staff</p>
                    ) : (
                      suggestions.map(u => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => { toggleMember(u.id); setMemberSearch('') }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-mps-blue-50 transition-colors text-left text-sm text-slate-700"
                        >
                          <Avatar avatarUrl={u.avatar_url} name={u.full_name} size={28} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{u.full_name}</p>
                            <p className="text-[11px] text-slate-400 capitalize">{u.role}</p>
                          </div>
                          <Plus size={15} className="text-mps-blue-500 flex-shrink-0" />
                        </button>
                      ))
                    )}
                  </div>
                )}
                <p className="text-[11px] text-slate-400 mt-1.5">You&apos;re added automatically. Search to add teammates.</p>
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-1 pb-2">
                <button
                  type="submit"
                  disabled={submitting || !title.trim()}
                  className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50 py-3"
                >
                  <FolderKanban size={15} />
                  {submitting ? 'Creating...' : 'Create Project'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-3 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  if (typeof document === 'undefined') return null
  return createPortal(formContent, document.body)
}
