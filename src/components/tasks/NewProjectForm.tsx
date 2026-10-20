'use client'

import React, { useState, useMemo } from 'react'
import { X, FolderKanban, Plus, Search, ArrowRight, Loader2 } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { createProject, NewProjectInput } from '@/lib/projects'
import { UserProfile } from '@/lib/supabase'
import { Btn, FormCard, FormRow, Toggle, Notice, TaskSheet, Field } from './ui'

interface NewProjectFormProps {
  onClose: () => void
  onProjectCreated: () => void
  currentUserId: string
  availableAssignees: UserProfile[]
}

export default function NewProjectForm({ onClose, onProjectCreated, currentUserId, availableAssignees }: NewProjectFormProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [sequentialMode, setSequentialMode] = useState(false)
  const [selectedMembers, setSelectedMembers] = useState<string[]>([currentUserId])
  const [memberSearch, setMemberSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Suggestions only once something is typed, never the people already in,
  // and capped, so a large staff list never floods the form.
  const suggestions = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    if (!q) return []
    return availableAssignees
      .filter(u => !selectedMembers.includes(u.id))
      .filter(u => u.full_name?.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q))
      .slice(0, 8)
  }, [availableAssignees, memberSearch, selectedMembers])

  const selectedProfiles = useMemo(
    () => selectedMembers.map(id => availableAssignees.find(u => u.id === id)).filter((u): u is UserProfile => !!u),
    [selectedMembers, availableAssignees],
  )

  const toggleMember = (userId: string) => {
    if (userId === currentUserId) return
    setSelectedMembers(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || submitting) return
    if (startDate && endDate && endDate < startDate) { setError('The end date is before the start date.'); return }
    setSubmitting(true)
    setError(null)
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
    if (!project) { setError('The project was not created. Try again.'); return }
    onProjectCreated()
  }

  return (
    <TaskSheet
      onClose={onClose}
      title="New project"
      subtitle="A project with subtasks"
      icon={FolderKanban}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn onClick={onClose} disabled={submitting}>Cancel</Btn>
          <Btn tone="primary" type="submit" form="new-project-form" disabled={submitting || !title.trim()}>
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <FolderKanban size={14} />}
            {submitting ? 'Creating…' : 'Create project'}
          </Btn>
        </div>
      }
    >
      <form id="new-project-form" onSubmit={handleSubmit} className="space-y-3">
        <Field label="Project title">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Science fair preparation" className="tk-input !h-11 !text-[15px] font-medium" required autoFocus maxLength={200} />
        </Field>
        <Field label="Description (optional)">
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this project about?" rows={2} className="tk-input" />
        </Field>
        <Field label="Date range">
          <span className="flex items-center gap-2">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} aria-label="Start date" className="tk-input" />
            <ArrowRight size={14} className="text-amber-400 flex-shrink-0" />
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} aria-label="End date" className="tk-input" />
          </span>
        </Field>

        <FormCard>
          <FormRow label="Sequential mode" hint="Subtasks must be completed in order">
            <Toggle checked={sequentialMode} onChange={setSequentialMode} label="Sequential mode" />
          </FormRow>
        </FormCard>

        <FormCard title={`Members (${selectedMembers.length})`} note="You're added automatically. Search to add teammates.">
          {selectedProfiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-2.5">
              {selectedProfiles.map(u => {
                const isYou = u.id === currentUserId
                return (
                  <span key={u.id} className="inline-flex items-center gap-1.5 min-h-[28px] py-0.5 pl-0.5 pr-1 rounded-full bg-amber-50 border border-amber-100 text-[12px] font-medium text-amber-900 max-w-full">
                    <Avatar avatarUrl={u.avatar_url} name={u.full_name} size={22} />
                    <span className="min-w-0 break-words leading-tight pr-1">{isYou ? 'You' : u.full_name}</span>
                    {!isYou && (
                      <button type="button" onClick={() => toggleMember(u.id)} className="w-5 h-5 inline-flex items-center justify-center rounded-full text-amber-500 hover:text-red-500 hover:bg-white transition flex-shrink-0" aria-label={`Remove ${u.full_name}`}>
                        <X size={11} />
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          )}
          <div className="p-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="Type a name or role to add staff" className="tk-input !pl-8" />
            </div>
          </div>
          {memberSearch.trim() && (
            <div className="max-h-52 overflow-y-auto overscroll-contain">
              {suggestions.length === 0 ? (
                <p className="px-3.5 py-3 text-[12.5px] text-slate-500">No matching staff</p>
              ) : suggestions.map(u => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { toggleMember(u.id); setMemberSearch('') }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left hover:bg-amber-50/60 transition-colors"
                >
                  <Avatar avatarUrl={u.avatar_url} name={u.full_name} size={26} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium text-slate-700 break-words">{u.full_name}</span>
                    <span className="block text-[11px] text-slate-400 capitalize">{u.role}</span>
                  </span>
                  <Plus size={15} className="text-amber-600 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </FormCard>

        {error && <Notice>{error}</Notice>}
      </form>
    </TaskSheet>
  )
}
