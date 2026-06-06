'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Plus,
  Calendar,
  Clock,
  Tag,
  Users,
  Trash2,
  Repeat,
  ShieldCheck,
  ChevronDown,
  Search,
} from 'lucide-react'
import { createTask, checkDuplicateTaskTitle, NewTaskInput, TaskTag, TaskRecurrence, RECURRENCE_LABELS } from '@/lib/tasks'
import { UserProfile } from '@/lib/supabase'
import Avatar from '@/components/Avatar'

// ── Time slots ────────────────────────────────────────────────────────────────

const SLOTS = [
  { label: 'Slot 1',  start: '09:10', end: '09:50' },
  { label: 'Slot 2',  start: '09:50', end: '10:30' },
  { label: 'Slot 3',  start: '10:30', end: '11:20' },
  { label: 'Slot 4',  start: '11:20', end: '12:00' },
  { label: 'Slot 5',  start: '12:00', end: '12:40' },
  { label: 'Slot 6',  start: '13:10', end: '13:50' },
  { label: 'Slot 7',  start: '13:50', end: '14:30' },
  { label: 'Slot 8',  start: '14:30', end: '15:20' },
  { label: 'Slot 9',  start: '15:20', end: '16:00' },
  { label: 'Slot 10', start: '16:00', end: '17:30' },
] as const

// Slots 5→6 have a lunch gap — treat them as non-adjacent for range purposes
const ADJACENT: Record<number, number[]> = {
  0: [1], 1: [0, 2], 2: [1, 3], 3: [2, 4], 4: [3],   // morning block
  5: [6], 6: [5, 7], 7: [6, 8], 8: [7, 9], 9: [8],   // afternoon block
}

function fmt(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
  return m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface NewTaskFormProps {
  isOpen: boolean
  onClose: () => void
  onTaskCreated: () => void
  currentUserId: string
  defaultAssigneeId?: string
  defaultDate?: string
  defaultTitle?: string
  defaultSlotRange?: [number, number] | null
  availableAssignees?: UserProfile[]
  canAssignToOthers: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewTaskForm({
  isOpen,
  onClose,
  onTaskCreated,
  currentUserId,
  defaultAssigneeId,
  defaultDate,
  defaultTitle,
  defaultSlotRange,
  availableAssignees = [],
  canAssignToOthers,
}: NewTaskFormProps) {
  const [title, setTitle]               = useState(defaultTitle || '')
  const [description, setDescription]   = useState('')
  const [dueDate, setDueDate]           = useState(defaultDate || '')
  const [slotRange, setSlotRange]       = useState<[number, number] | null>(null)
  const [useCustomTime, setUseCustomTime] = useState(false)
  const [customStart, setCustomStart]   = useState('')
  const [customEnd, setCustomEnd]       = useState('')
  const [requireCheck, setRequireCheck] = useState(false)
  const [tag, setTag]                   = useState<TaskTag>(null)
  const [bonusPoints, setBonusPoints]   = useState<number>(0)
  const [recurrence, setRecurrence]     = useState<TaskRecurrence>('none')
  const [checklistItems, setChecklistItems] = useState<string[]>([])
  const [newCheckItem, setNewCheckItem] = useState('')
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>(
    [defaultAssigneeId || currentUserId]
  )
  const [submitting, setSubmitting]     = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [duplicateError, setDuplicateError] = useState(false)
  const [assigneeSearch, setAssigneeSearch] = useState('')

  useEffect(() => {
    if (isOpen) {
      setTitle(defaultTitle || '')
      setDueDate(defaultDate || '')
      setSelectedAssignees([defaultAssigneeId || currentUserId])
      setSlotRange(defaultSlotRange ?? null)
      setUseCustomTime(false)
      setCustomStart('')
      setCustomEnd('')
      setShowAdvanced(false)
    }
  }, [isOpen, defaultDate, defaultTitle, defaultSlotRange, defaultAssigneeId, currentUserId])

  // ── Slot selection ──────────────────────────────────────────────────────────

  const handleSlotClick = (i: number) => {
    if (!slotRange) { setSlotRange([i, i]); return }
    const [s, e] = slotRange
    if (i === s && i === e) {
      setSlotRange(null)
    } else if (i >= s && i <= e) {
      const distToStart = i - s
      const distToEnd   = e - i
      if (distToStart <= distToEnd) {
        i + 1 <= e ? setSlotRange([i + 1, e]) : setSlotRange(null)
      } else {
        i - 1 >= s ? setSlotRange([s, i - 1]) : setSlotRange(null)
      }
    } else if (i === s - 1 && ADJACENT[i]?.includes(s)) {
      setSlotRange([i, e])
    } else if (i === e + 1 && ADJACENT[e]?.includes(i)) {
      setSlotRange([s, i])
    } else {
      setSlotRange([i, i])
    }
  }

  const slotInRange = (i: number) => slotRange !== null && i >= slotRange[0] && i <= slotRange[1]
  const derivedStart = useCustomTime ? customStart : (slotRange ? SLOTS[slotRange[0]].start : '')
  const derivedEnd   = useCustomTime ? customEnd   : (slotRange ? SLOTS[slotRange[1]].end   : '')

  // ── Checklist ───────────────────────────────────────────────────────────────

  const handleAddCheckItem = () => {
    if (!newCheckItem.trim()) return
    setChecklistItems([...checklistItems, newCheckItem.trim()])
    setNewCheckItem('')
  }
  const handleRemoveCheckItem = (index: number) =>
    setChecklistItems(checklistItems.filter((_, i) => i !== index))

  const toggleAssignee = (userId: string) =>
    setSelectedAssignees(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    )

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setDuplicateError(false)
    setSubmitting(true)
    if (dueDate) {
      const assignees = selectedAssignees.length > 0 ? selectedAssignees : [defaultAssigneeId || currentUserId]
      const isDuplicate = await checkDuplicateTaskTitle(title.trim(), dueDate, assignees)
      if (isDuplicate) {
        setDuplicateError(true)
        setSubmitting(false)
        return
      }
    }
    const input: NewTaskInput = {
      title:           title.trim(),
      description:     description.trim() || undefined,
      due_date:        dueDate || undefined,
      timing:          derivedStart || undefined,
      end_time:        derivedEnd   || undefined,
      require_check:   requireCheck,
      tag,
      bonus_points:    bonusPoints,
      recurrence,
      assignee_ids:    selectedAssignees.length > 0 ? selectedAssignees : [defaultAssigneeId || currentUserId],
      checklist_items: checklistItems.length > 0 ? checklistItems : undefined,
    }
    const task = await createTask(input, currentUserId)
    setSubmitting(false)
    if (task) {
      setTitle(''); setDescription(''); setDueDate(defaultDate || '')
      setSlotRange(null); setRequireCheck(false); setTag(null)
      setBonusPoints(0); setRecurrence('none'); setChecklistItems([])
      setSelectedAssignees([defaultAssigneeId || currentUserId])
      onTaskCreated(); onClose()
    }
  }

  // ── Date shortcuts ──────────────────────────────────────────────────────────

  const todayStr    = new Date().toISOString().split('T')[0]
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const nextWeekStr = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

  const chipBase     = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all'
  const chipActive   = 'bg-mps-blue-500 text-white'
  const chipInactive = 'bg-slate-100 text-slate-600 active:bg-slate-200'

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
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
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 40, stiffness: 320 }}
            // flex column so we can have a scrollable body + sticky footer
            className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg flex flex-col"
            style={{ maxHeight: '92dvh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle — mobile only */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-slate-300" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 flex-shrink-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-800">New Task</h2>
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable body — grows to fill available space */}
            <form
              id="new-task-form"
              onSubmit={handleSubmit}
              className="overflow-y-auto flex-1 px-4 sm:px-5 py-4 space-y-4"
            >
              {/* Title */}
              <input
                type="text"
                value={title}
                onChange={e => { setTitle(e.target.value); setDuplicateError(false) }}
                placeholder="Task title *"
                className={`w-full border rounded-xl px-4 py-3 text-base sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500 placeholder:font-normal ${duplicateError ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}
                required
              />
              {duplicateError && (
                <p className="text-xs text-red-500 -mt-1">A task with this title already exists on the selected date.</p>
              )}

              {/* Description */}
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500 resize-none"
              />

              {/* Due Date */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Calendar size={12} /> Due Date
                </label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { label: 'Today',     value: todayStr    },
                    { label: 'Tomorrow',  value: tomorrowStr },
                    { label: 'Next Week', value: nextWeekStr },
                    { label: 'No Date',   value: ''          },
                  ].map(opt => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setDueDate(opt.value)}
                      className={`${chipBase} ${dueDate === opt.value ? chipActive : chipInactive}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500"
                />
              </div>

              {/* Time */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Clock size={12} /> Time
                  </label>
                  {/* Periods / Custom toggle */}
                  <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setUseCustomTime(false)}
                      className={`px-2.5 py-1 rounded-md transition-all ${!useCustomTime ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                    >
                      Periods
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseCustomTime(true)}
                      className={`px-2.5 py-1 rounded-md transition-all ${useCustomTime ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                    >
                      Custom
                    </button>
                  </div>
                </div>

                {useCustomTime ? (
                  /* Custom time inputs */
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <p className="text-[10px] text-slate-400 mb-1 font-medium">Start</p>
                      <input
                        type="time"
                        value={customStart}
                        onChange={e => setCustomStart(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] text-slate-400 mb-1 font-medium">End</p>
                      <input
                        type="time"
                        value={customEnd}
                        onChange={e => setCustomEnd(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500"
                      />
                    </div>
                  </div>
                ) : (
                  /* School period slot picker */
                  <>
                    <div className="grid grid-cols-2 gap-1.5">
                      {SLOTS.map((slot, i) => {
                        const inRange = slotInRange(i)
                        const isFirst = slotRange !== null && i === slotRange[0]
                        const isLast  = slotRange !== null && i === slotRange[1]
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => handleSlotClick(i)}
                            className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                              inRange
                                ? 'bg-mps-blue-500 text-white border-mps-blue-500 shadow-sm'
                                : 'bg-slate-50 text-slate-600 border-slate-200 active:bg-slate-100'
                            }`}
                          >
                            <span className={inRange ? 'text-white/70' : 'text-slate-400'}>{slot.label}</span>
                            <span className="ml-1">
                              {isFirst && !isLast
                                ? `${fmt(slot.start)} →`
                                : isLast && !isFirst
                                ? `→ ${fmt(slot.end)}`
                                : `${fmt(slot.start)}–${fmt(slot.end)}`
                              }
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    {slotRange && (
                      <div className="flex items-center justify-between px-3 py-2 bg-mps-blue-50 border border-mps-blue-100 rounded-xl text-xs">
                        <span className="text-mps-blue-700 font-medium">
                          {slotRange[0] === slotRange[1]
                            ? SLOTS[slotRange[0]].label
                            : `${SLOTS[slotRange[0]].label} – ${SLOTS[slotRange[1]].label}`
                          }
                        </span>
                        <span className="text-mps-blue-600 font-semibold">
                          {fmt(derivedStart)} – {fmt(derivedEnd)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSlotRange(null)}
                          className="ml-2 p-1 text-mps-blue-400 hover:text-mps-blue-600"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    {!slotRange && (
                      <p className="text-[11px] text-slate-400 pl-0.5">Tap a period to select; tap adjacent periods to extend the range.</p>
                    )}
                  </>
                )}
              </div>

              {/* More options toggle */}
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-slate-50 active:bg-slate-100 transition-colors text-sm font-medium text-slate-600"
              >
                <span>More options</span>
                <ChevronDown
                  size={16}
                  className={`text-slate-400 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Advanced options */}
              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden space-y-4"
                  >
                    {/* Repeat & Bonus Points */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                          <Repeat size={12} /> Repeat
                        </label>
                        <select
                          value={recurrence}
                          onChange={e => setRecurrence(e.target.value as TaskRecurrence)}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500 bg-white"
                        >
                          {(Object.keys(RECURRENCE_LABELS) as TaskRecurrence[]).map(r => (
                            <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                          <Tag size={12} /> Bonus Points
                        </label>
                        <select
                          value={bonusPoints}
                          onChange={e => setBonusPoints(Number(e.target.value))}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500 bg-white"
                        >
                          <option value="0">None</option>
                          <option value="1">1 Point</option>
                          <option value="2">2 Points</option>
                          <option value="3">3 Points</option>
                          <option value="4">4 Points</option>
                          <option value="5">5 Points</option>
                        </select>
                      </div>
                    </div>

                    {/* Require Verification — full-width tappable row */}
                    <button
                      type="button"
                      onClick={() => setRequireCheck(prev => !prev)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors text-left ${
                        requireCheck ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ShieldCheck
                          size={16}
                          className={requireCheck ? 'text-mps-blue-600 flex-shrink-0' : 'text-slate-400 flex-shrink-0'}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700">Require Verification</p>
                          <p className="text-xs text-slate-400 truncate">
                            {requireCheck
                              ? 'Not Done → Partial → Checking → Completed'
                              : 'Not Done → Partial → Completed'}
                          </p>
                        </div>
                      </div>
                      <div className={`relative inline-flex h-6 w-11 flex-shrink-0 ml-3 items-center rounded-full transition-colors ${
                        requireCheck ? 'bg-mps-blue-500' : 'bg-slate-300'
                      }`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                          requireCheck ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </div>
                    </button>

                    {/* Assignees */}
                    {canAssignToOthers && availableAssignees.length > 0 && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                          <Users size={12} /> Assignees
                        </label>
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="relative border-b border-slate-100">
                            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input
                              type="text"
                              value={assigneeSearch}
                              onChange={e => setAssigneeSearch(e.target.value)}
                              placeholder="Search assignees…"
                              className="w-full pl-8 pr-3 py-2 text-sm focus:outline-none bg-slate-50"
                            />
                          </div>
                          <div className="max-h-36 overflow-y-auto p-1.5 space-y-1">
                            {availableAssignees
                              .filter(u => !assigneeSearch || u.full_name?.toLowerCase().includes(assigneeSearch.toLowerCase()) || u.role?.toLowerCase().includes(assigneeSearch.toLowerCase()))
                              .map(user => (
                                <button
                                  key={user.id}
                                  type="button"
                                  onClick={() => toggleAssignee(user.id)}
                                  className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors text-left text-sm ${
                                    selectedAssignees.includes(user.id)
                                      ? 'bg-mps-blue-50 text-mps-blue-700 border border-mps-blue-200'
                                      : 'hover:bg-slate-50 text-slate-700'
                                  }`}
                                >
                                  <Avatar avatarUrl={user.avatar_url} name={user.full_name} size={24} />
                                  <span className="flex-1 truncate">{user.full_name}</span>
                                  <span className="text-xs text-slate-400">{user.role}</span>
                                </button>
                              ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Checklist */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">
                        Checklist
                      </label>
                      {checklistItems.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {checklistItems.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
                              <span className="text-sm text-slate-700 flex-1">{item}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveCheckItem(idx)}
                                className="p-1 text-slate-400 hover:text-red-500"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newCheckItem}
                          onChange={e => setNewCheckItem(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCheckItem() } }}
                          placeholder="Add checklist item…"
                          className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-1 focus:ring-mps-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleAddCheckItem}
                          className="p-2.5 text-mps-blue-600 hover:bg-mps-blue-50 active:bg-mps-blue-100 rounded-xl transition-colors"
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Bottom spacer so content clears the sticky footer */}
              <div className="h-1" />
            </form>

            {/* Sticky submit footer — always visible, never buried in scroll */}
            <div
              className="px-4 sm:px-5 py-3 border-t border-slate-100 flex-shrink-0"
              style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
            >
              <button
                type="submit"
                form="new-task-form"
                disabled={submitting || !title.trim()}
                className="w-full bg-mps-blue-500 hover:bg-mps-blue-600 active:bg-mps-blue-700 text-white font-semibold py-3 rounded-2xl transition-colors disabled:opacity-50 text-sm"
              >
                {submitting ? 'Creating…' : 'Create Task'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
