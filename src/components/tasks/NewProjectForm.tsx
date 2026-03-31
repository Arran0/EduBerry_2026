'use client'

import React, { useState, useEffect } from 'react'
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
  Check,
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
  const [submitting, setSubmitting] = useState(false)

  // Reset form when opening
  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setDescription('')
      setStartDate('')
      setEndDate('')
      setSequentialMode(false)
      setSelectedMembers([currentUserId])
    }
  }, [isOpen, currentUserId])

  const toggleMember = (userId: string) => {
    setSelectedMembers(prev => {
      // Don't allow removing the current user
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white rounded-t-3xl border-b border-slate-100 z-10">
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-mps-blue-500 to-mps-blue-600 flex items-center justify-center shadow-sm">
                      <FolderKanban size={18} className="text-white" />
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
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-5">
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
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <FileText size={12} /> Description
                  <span className="font-normal text-slate-400 normal-case tracking-normal">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What is this project about?"
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 focus:border-mps-blue-500 resize-none bg-slate-50/50"
                />
              </div>

              {/* Dates */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <Calendar size={12} /> Date Range
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 focus:border-mps-blue-500"
                  />
                  <ArrowRight size={14} className="text-slate-300 flex-shrink-0" />
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/40 focus:border-mps-blue-500"
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
                <div>
                  <p className="text-sm font-semibold">Sequential Mode</p>
                  <p className="text-xs opacity-70">Subtasks must be completed in order</p>
                </div>
                {sequentialMode && (
                  <span className="ml-auto text-xs font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">ON</span>
                )}
              </button>

              {/* Members */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Users size={12} /> Members
                  {selectedMembers.length > 0 && (
                    <span className="font-bold bg-mps-blue-100 text-mps-blue-600 px-1.5 py-0.5 rounded-full text-[10px]">
                      {selectedMembers.length} selected
                    </span>
                  )}
                </label>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {availableAssignees.map(user => {
                    const isCurrentUser = user.id === currentUserId
                    const isSelected = selectedMembers.includes(user.id)

                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => toggleMember(user.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left text-sm ${
                          isSelected
                            ? 'bg-mps-blue-50 text-mps-blue-700'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <Avatar avatarUrl={user.avatar_url} name={user.full_name} size={28} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{user.full_name}</p>
                          <p className="text-[11px] opacity-60 capitalize">{isCurrentUser ? 'You' : user.role}</p>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected ? 'bg-mps-blue-500 border-mps-blue-500' : 'border-slate-300'
                        }`}>
                          {isSelected && <Check size={11} className="text-white" strokeWidth={3} />}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-1">
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
