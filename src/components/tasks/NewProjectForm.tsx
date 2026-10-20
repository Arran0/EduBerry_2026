'use client'

import React, { useState, useMemo } from 'react'
import { X, FolderKanban, Plus, Loader2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import Avatar from '@/components/Avatar'
import { createProject, NewProjectInput } from '@/lib/projects'
import { UserProfile } from '@/lib/supabase'
import { Btn, FormGroup, FormRow, Switch, Notice, SearchField, TASK_ICON, FIELD, DATE_FIELD } from './ui'

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
    <ModalShell
      onClose={onClose}
      size="lg"
      sharp
      title="New project"
      subtitle="A shared piece of work, split into subtasks"
      icon={<FolderKanban size={16} />}
      iconClassName={TASK_ICON}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn tone="ghost" onClick={onClose} disabled={submitting}>Cancel</Btn>
          <Btn tone="dark" type="submit" form="new-project-form" disabled={submitting || !title.trim()}>
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
            {submitting ? 'Creating…' : 'Create project'}
          </Btn>
        </div>
      }
    >
      <form id="new-project-form" onSubmit={handleSubmit} className="space-y-3.5">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Project name, e.g. Science fair"
          aria-label="Project name"
          className={`${FIELD} !h-11 !text-[15px] font-medium`}
          required
          autoFocus
          maxLength={200}
        />
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What is this project about? (optional)"
          rows={2}
          className={`${FIELD} !h-auto py-2 resize-none leading-snug`}
        />

        <FormGroup>
          <FormRow label="Starts"><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={DATE_FIELD} /></FormRow>
          <FormRow label="Ends"><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={DATE_FIELD} /></FormRow>
          <FormRow label="Do subtasks in order" hint="Each one opens only when the one before it is done">
            <Switch checked={sequentialMode} onChange={setSequentialMode} label="Do subtasks in order" />
          </FormRow>
        </FormGroup>

        <FormGroup title={`Members (${selectedMembers.length})`} note="You are added automatically.">
          {selectedProfiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
              {selectedProfiles.map(u => {
                const isYou = u.id === currentUserId
                return (
                  <span key={u.id} className="inline-flex items-center gap-1.5 min-h-[28px] py-0.5 pl-0.5 pr-1 rounded-full bg-[#F4F1EA] text-[12px] font-medium text-slate-700 max-w-full">
                    <Avatar avatarUrl={u.avatar_url} name={u.full_name} size={24} />
                    <span className="min-w-0 break-words pr-1 leading-tight">{isYou ? 'You' : u.full_name}</span>
                    {!isYou && (
                      <button type="button" onClick={() => toggleMember(u.id)} className="w-5 h-5 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-rose-600 hover:bg-white transition flex-shrink-0" aria-label={`Remove ${u.full_name}`}>
                        <X size={11} />
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          )}
          <div className="p-2.5">
            <SearchField value={memberSearch} onChange={setMemberSearch} placeholder="Type a name or role to add staff" />
          </div>
          {memberSearch.trim() && (
            <div className="max-h-52 overflow-y-auto overscroll-contain pb-1">
              {suggestions.length === 0 ? (
                <p className="px-3.5 py-2.5 text-[12.5px] text-slate-500">No one matches that.</p>
              ) : suggestions.map(u => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { toggleMember(u.id); setMemberSearch('') }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-1.5 text-left hover:bg-[#FAF7F0] transition-colors"
                >
                  <Avatar avatarUrl={u.avatar_url} name={u.full_name} size={26} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] text-slate-900 leading-snug break-words">{u.full_name}</span>
                    <span className="block text-[11.5px] text-slate-400 capitalize">{u.role}</span>
                  </span>
                  <Plus size={15} className="text-[#8B6F47] flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </FormGroup>

        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </ModalShell>
  )
}
