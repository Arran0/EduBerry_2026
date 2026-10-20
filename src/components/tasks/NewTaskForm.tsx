'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Loader2, X, Search } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { createTask, Task, checkDuplicateTaskTitle, checkTaskSlotConflict, NewTaskInput, TaskRecurrence, RECURRENCE_LABELS } from '@/lib/tasks'
import { fetchActiveTimetablePeriodSlots } from '@/lib/taskPeriods'
import { TaskSlot, TASK_SLOTS, formatSlotTime as fmt } from '@/lib/taskSlots'
import { UserProfile } from '@/lib/supabase'
import { Btn, IconBtn, FormCard, FormRow, Toggle, Notice, Seg, TaskSheet, Field } from './ui'

function toISODateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return toISODateLocal(d)
}

interface NewTaskFormProps {
  onClose: () => void
  onTaskCreated: (task: Task) => void
  currentUserId: string
  defaultAssigneeId?: string
  defaultDate?: string
  defaultTitle?: string
  defaultSlotRange?: [number, number] | null
  availableAssignees?: UserProfile[]
  canAssignToOthers: boolean
}

export default function NewTaskForm({
  onClose, onTaskCreated, currentUserId, defaultAssigneeId, defaultDate, defaultTitle, defaultSlotRange,
  availableAssignees = [], canAssignToOthers,
}: NewTaskFormProps) {
  const todayStr = toISODateLocal(new Date())

  const [title, setTitle] = useState(defaultTitle || '')
  const [dueDate, setDueDate] = useState(defaultDate || todayStr)
  const [slotRange, setSlotRange] = useState<[number, number] | null>(defaultSlotRange ?? null)
  const [timeMode, setTimeMode] = useState<'periods' | 'custom'>('periods')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [requireCheck, setRequireCheck] = useState(false)
  const [requiresSubmission, setRequiresSubmission] = useState(false)
  const [bonusPoints, setBonusPoints] = useState(0)
  const [recurrence, setRecurrence] = useState<TaskRecurrence>('none')
  const [checklistItems, setChecklistItems] = useState<string[]>([])
  const [newCheckItem, setNewCheckItem] = useState('')
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([defaultAssigneeId || currentUserId])
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ field: 'title' | 'time' | 'save'; text: string } | null>(null)

  // Real periods from the active Timetable; the generic set until they load.
  const [periodSlots, setPeriodSlots] = useState<TaskSlot[]>(TASK_SLOTS)
  useEffect(() => {
    let cancelled = false
    fetchActiveTimetablePeriodSlots()
      .then(slots => { if (!cancelled) setPeriodSlots(slots) })
      .catch(() => { if (!cancelled) setPeriodSlots(TASK_SLOTS) })
    return () => { cancelled = true }
  }, [])

  // A time error clears as soon as the date or time changes.
  useEffect(() => { setError(e => (e?.field === 'time' ? null : e)) }, [dueDate, slotRange, timeMode, customStart, customEnd])

  // Tap a period to pick it; tap the one beside the range to extend it; tap
  // inside the range to trim it from the nearer end.
  const handleSlotClick = (i: number) => {
    if (!slotRange) { setSlotRange([i, i]); return }
    const [s, e] = slotRange
    if (i === s && i === e) setSlotRange(null)
    else if (i >= s && i <= e) {
      if (i - s <= e - i) setSlotRange(i + 1 <= e ? [i + 1, e] : null)
      else setSlotRange(i - 1 >= s ? [s, i - 1] : null)
    } else if (i === s - 1) setSlotRange([i, e])
    else if (i === e + 1) setSlotRange([s, i])
    else setSlotRange([i, i])
  }

  const custom = timeMode === 'custom'
  const validRange = slotRange && slotRange[1] < periodSlots.length ? slotRange : null
  const derivedStart = custom ? customStart : (validRange ? periodSlots[validRange[0]].start : '')
  const derivedEnd = custom ? customEnd : (validRange ? periodSlots[validRange[1]].end : '')

  const addCheckItem = () => {
    const t = newCheckItem.trim()
    if (!t) return
    setChecklistItems(prev => [...prev, t])
    setNewCheckItem('')
  }

  const toggleAssignee = (id: string) =>
    setSelectedAssignees(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const filteredAssignees = useMemo(() => {
    const q = assigneeSearch.trim().toLowerCase()
    if (!q) return availableAssignees
    return availableAssignees.filter(u => u.full_name?.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q))
  }, [availableAssignees, assigneeSearch])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = title.trim()
    if (!name || submitting) return
    setError(null)
    const assignees = selectedAssignees.length > 0 ? selectedAssignees : [defaultAssigneeId || currentUserId]
    const date = dueDate || todayStr

    // Coordinators and above may leave a task untimed; everyone else maps each
    // task onto a period or a time range.
    if (!canAssignToOthers && !derivedStart) {
      setError({ field: 'time', text: 'Pick a period, or switch to Custom and set a time.' })
      return
    }
    if (custom && derivedStart && derivedEnd && derivedEnd <= derivedStart) {
      setError({ field: 'time', text: 'The end time is before the start time.' })
      return
    }

    setSubmitting(true)
    // The two checks are independent, so they go out together.
    const [isDuplicate, hasConflict] = await Promise.all([
      checkDuplicateTaskTitle(name, date, assignees),
      derivedStart && derivedEnd ? checkTaskSlotConflict(date, derivedStart, derivedEnd, assignees) : Promise.resolve(false),
    ])
    if (isDuplicate) {
      setSubmitting(false)
      setError({ field: 'title', text: 'A task with this name already exists on that day.' })
      return
    }
    if (hasConflict) {
      setSubmitting(false)
      setError({ field: 'time', text: 'This assignee already has a task in that time slot. Pick a different one.' })
      return
    }

    const input: NewTaskInput = {
      title: name,
      due_date: date,
      timing: derivedStart || undefined,
      end_time: derivedEnd || undefined,
      require_check: requireCheck,
      requires_submission: requiresSubmission,
      tag: null,
      bonus_points: canAssignToOthers ? bonusPoints : 0,
      recurrence,
      assignee_ids: assignees,
      checklist_items: checklistItems.length > 0 ? checklistItems : undefined,
    }
    const task = await createTask(input, currentUserId)
    setSubmitting(false)
    if (!task) { setError({ field: 'save', text: 'The task was not saved. Check your connection and try again.' }); return }
    onTaskCreated(task)
    onClose()
  }

  const dateLabel = dueDate === todayStr ? 'Today'
    : dueDate === shiftDate(todayStr, 1) ? 'Tomorrow'
      : dueDate === shiftDate(todayStr, -1) ? 'Yesterday'
        : new Date(dueDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

  const rangeText = validRange
    ? `${validRange[0] === validRange[1] ? periodSlots[validRange[0]].label : `${periodSlots[validRange[0]].label} to ${periodSlots[validRange[1]].label}`}, ${fmt(derivedStart)} – ${fmt(derivedEnd)}`
    : null

  const optionCount = [recurrence !== 'none', bonusPoints !== 0, requireCheck, requiresSubmission, checklistItems.length > 0, selectedAssignees.length > 1].filter(Boolean).length
  const arrow = 'w-8 h-8 inline-flex items-center justify-center rounded-full text-slate-500 hover:text-amber-700 hover:bg-amber-50 transition'

  return (
    <TaskSheet
      onClose={onClose}
      title="New task"
      icon={ClipboardList}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn onClick={onClose} disabled={submitting}>Cancel</Btn>
          <Btn tone="primary" type="submit" form="new-task-form" disabled={submitting || !title.trim()}>
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
            {submitting ? 'Creating…' : 'Create task'}
          </Btn>
        </div>
      }
    >
      <form id="new-task-form" onSubmit={handleSubmit} className="space-y-3">
        <div>
          <input
            value={title}
            onChange={e => { setTitle(e.target.value); if (error?.field === 'title') setError(null) }}
            placeholder="Task name"
            aria-label="Task name"
            className={`tk-input !h-11 !text-[15px] font-medium ${error?.field === 'title' ? '!border-red-400' : ''}`}
            required
            autoFocus
            maxLength={200}
          />
          {error?.field === 'title' && <Notice className="mt-1.5">{error.text}</Notice>}
        </div>

        <FormCard>
          <FormRow label="Due date">
            <span className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-amber-50 border border-amber-100">
              <button type="button" onClick={() => setDueDate(d => shiftDate(d, -1))} aria-label="Previous day" className={arrow}><ChevronLeft size={15} /></button>
              <label className="relative px-1.5 min-w-[6.5rem] text-center text-[13px] font-semibold text-amber-900 cursor-pointer whitespace-nowrap">
                {dateLabel}
                <input type="date" value={dueDate} onChange={e => { if (e.target.value) setDueDate(e.target.value) }} className="absolute inset-0 opacity-0 cursor-pointer w-full" aria-label="Pick a date" />
              </label>
              <button type="button" onClick={() => setDueDate(d => shiftDate(d, 1))} aria-label="Next day" className={arrow}><ChevronRight size={15} /></button>
            </span>
          </FormRow>
          <FormRow label="Time" hint={canAssignToOthers ? 'Optional' : undefined}>
            <Seg value={timeMode} onChange={setTimeMode} options={[{ value: 'periods', label: 'Periods' }, { value: 'custom', label: 'Custom' }]} />
          </FormRow>
          <div className="px-3.5 py-2.5">
            {custom ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start time"><input type="time" value={customStart} onChange={e => setCustomStart(e.target.value)} className="tk-input" /></Field>
                <Field label="End time"><input type="time" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="tk-input" /></Field>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5">
                  {periodSlots.map((slot, i) => {
                    const on = validRange !== null && i >= validRange[0] && i <= validRange[1]
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSlotClick(i)}
                        aria-pressed={on}
                        title={`${slot.label}, ${fmt(slot.start)} – ${fmt(slot.end)}`}
                        className={`h-10 sm:h-9 rounded-[10px] text-[13px] font-semibold tabular-nums border transition active:scale-95 ${
                          on
                            ? 'text-white border-transparent bg-gradient-to-br from-amber-500 to-orange-500 shadow-[0_6px_14px_-8px_rgba(234,88,12,.8)]'
                            : 'bg-white text-slate-600 border-amber-900/[0.12] hover:border-amber-400'}`}
                      >
                        {i + 1}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-start justify-between gap-2 mt-2 min-h-[20px]">
                  <p className={`text-[12px] leading-snug min-w-0 break-words ${rangeText ? 'text-amber-800 font-medium' : 'text-slate-400'}`}>
                    {rangeText ?? 'Tap a period; tap the next one to extend the range.'}
                  </p>
                  {validRange && (
                    <button type="button" onClick={() => setSlotRange(null)} className="text-[12px] font-semibold text-amber-700 flex-shrink-0 inline-flex items-center gap-0.5">
                      <X size={12} /> Clear
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </FormCard>
        {error?.field === 'time' && <Notice>{error.text}</Notice>}

        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          aria-expanded={showAdvanced}
          className="tk-card !rounded-[14px] w-full flex items-center justify-between gap-2 h-10 px-3.5 text-[13px] font-semibold text-slate-700 hover:text-amber-800 transition-colors"
        >
          <span>More options{optionCount > 0 && <span className="ml-1.5 text-[12px] font-semibold text-amber-600">{optionCount} set</span>}</span>
          <ChevronDown size={15} className={`text-slate-400 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} />
        </button>

        {showAdvanced && (
          <>
            <FormCard>
              <FormRow label="Repeat">
                <select value={recurrence} onChange={e => setRecurrence(e.target.value as TaskRecurrence)} className="tk-input !w-auto pr-8 cursor-pointer">
                  {(Object.keys(RECURRENCE_LABELS) as TaskRecurrence[]).map(r => <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}
                </select>
              </FormRow>
              {canAssignToOthers && (
                <FormRow label="Bonus points" hint="Bonus tasks always need verification">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={bonusPoints || ''}
                    placeholder="0"
                    onChange={e => {
                      const val = Number(e.target.value) || 0
                      setBonusPoints(val)
                      if (val !== 0) setRequireCheck(true)
                    }}
                    className="tk-input !w-24 text-right tabular-nums"
                  />
                </FormRow>
              )}
              <FormRow label="Needs verification" hint={requireCheck ? 'Not done, Partial, Checking, Completed' : 'Not done, Partial, Completed'}>
                <Toggle checked={requireCheck} onChange={v => { if (bonusPoints === 0) setRequireCheck(v) }} disabled={bonusPoints !== 0} label="Needs verification" />
              </FormRow>
              <FormRow label="Needs submission" hint="The work is submitted before it can be marked done">
                <Toggle checked={requiresSubmission} onChange={setRequiresSubmission} label="Needs submission" />
              </FormRow>
            </FormCard>

            {canAssignToOthers && availableAssignees.length > 0 && (
              <FormCard
                title="Assignees"
                note={selectedAssignees.length > 1 ? `Each of the ${selectedAssignees.length} people gets their own copy.` : undefined}
              >
                <div className="p-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input value={assigneeSearch} onChange={e => setAssigneeSearch(e.target.value)} placeholder="Search assignees" className="tk-input !pl-8" />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto overscroll-contain py-1">
                  {filteredAssignees.map(u => {
                    const on = selectedAssignees.includes(u.id)
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleAssignee(u.id)}
                        aria-pressed={on}
                        className={`w-full flex items-center gap-2.5 px-3.5 py-1.5 text-left transition-colors ${on ? 'bg-amber-50' : 'hover:bg-amber-50/50'}`}
                      >
                        <span className={`flex-shrink-0 w-4 h-4 rounded-[5px] inline-flex items-center justify-center ${on ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white' : 'border border-slate-300 bg-white'}`}>
                          {on && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" aria-hidden><path d="M2.5 6.2l2.2 2.2 4.8-4.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </span>
                        <Avatar avatarUrl={u.avatar_url} name={u.full_name} size={22} />
                        <span className="flex-1 min-w-0 text-[13px] text-slate-700 leading-snug break-words">{u.full_name}</span>
                        <span className="text-[11.5px] text-slate-400 capitalize flex-shrink-0">{u.role}</span>
                      </button>
                    )
                  })}
                  {filteredAssignees.length === 0 && <p className="px-3.5 py-3 text-[12.5px] text-slate-500">No one matches that.</p>}
                </div>
              </FormCard>
            )}

            <FormCard title="Checklist">
              {checklistItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 px-3.5 py-2">
                  <span className="flex-1 min-w-0 text-[13px] text-slate-700 leading-snug break-words">{item}</span>
                  <button
                    type="button"
                    onClick={() => setChecklistItems(prev => prev.filter((_, i) => i !== idx))}
                    className="w-7 h-7 -my-1 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition flex-shrink-0"
                    aria-label={`Remove ${item}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1.5 p-2">
                <input
                  value={newCheckItem}
                  onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCheckItem() } }}
                  placeholder="Add checklist item"
                  className="tk-input"
                />
                <IconBtn label="Add item" onClick={addCheckItem} disabled={!newCheckItem.trim()}><Plus size={15} /></IconBtn>
              </div>
            </FormCard>
          </>
        )}

        {error?.field === 'save' && <Notice>{error.text}</Notice>}
      </form>
    </TaskSheet>
  )
}
