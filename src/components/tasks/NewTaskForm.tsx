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
  Send,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  ClipboardList,
  AlertTriangle,
} from 'lucide-react'
import { createTask, Task, checkDuplicateTaskTitle, checkTaskSlotConflict, NewTaskInput, TaskTag, TaskRecurrence, RECURRENCE_LABELS } from '@/lib/tasks'
import { fetchActiveTimetablePeriodSlots } from '@/lib/taskPeriods'
import { TaskSlot, TASK_SLOTS, formatSlotTime as fmt } from '@/lib/taskSlots'
import { UserProfile } from '@/lib/supabase'
import Avatar from '@/components/Avatar'

// ── Date helpers ──────────────────────────────────────────────────────────────

function toISODateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return toISODateLocal(d)
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface NewTaskFormProps {
  isOpen: boolean
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
  const todayStr = toISODateLocal(new Date())

  const [title, setTitle]               = useState(defaultTitle || '')
  const [dueDate, setDueDate]           = useState(defaultDate || todayStr)
  const [slotRange, setSlotRange]       = useState<[number, number] | null>(null)
  const [useCustomTime, setUseCustomTime] = useState(false)
  const [customStart, setCustomStart]   = useState('')
  const [customEnd, setCustomEnd]       = useState('')
  const [requireCheck, setRequireCheck] = useState(false)
  const [requiresSubmission, setRequiresSubmission] = useState(false)
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
  const [slotError, setSlotError]       = useState('')
  const [assigneeSearch, setAssigneeSearch] = useState('')

  // Real school periods from the active Timetable — seeded with the generic
  // fallback so the picker isn't empty while this resolves.
  const [periodSlots, setPeriodSlots] = useState<TaskSlot[]>(TASK_SLOTS)

  useEffect(() => {
    if (isOpen) {
      setTitle(defaultTitle || '')
      setDueDate(defaultDate || todayStr)
      setSelectedAssignees([defaultAssigneeId || currentUserId])
      setSlotRange(defaultSlotRange ?? null)
      setUseCustomTime(false)
      setCustomStart('')
      setCustomEnd('')
      setShowAdvanced(false)
      setSlotError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultDate, defaultTitle, defaultSlotRange, defaultAssigneeId, currentUserId])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    fetchActiveTimetablePeriodSlots().then(slots => {
      if (!cancelled) setPeriodSlots(slots)
    }).catch(() => {
      if (!cancelled) setPeriodSlots(TASK_SLOTS)
    })
    return () => { cancelled = true }
  }, [isOpen])

  // Clear any slot validation error as soon as the user changes date/time —
  // otherwise a stale "select a slot" message lingers after they've fixed it.
  useEffect(() => { setSlotError('') }, [dueDate, slotRange, useCustomTime, customStart, customEnd])

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
    } else if (i === s - 1) {
      setSlotRange([i, e])
    } else if (i === e + 1) {
      setSlotRange([s, i])
    } else {
      setSlotRange([i, i])
    }
  }

  const slotInRange = (i: number) => slotRange !== null && i >= slotRange[0] && i <= slotRange[1]
  const derivedStart = useCustomTime ? customStart : (slotRange ? periodSlots[slotRange[0]].start : '')
  const derivedEnd   = useCustomTime ? customEnd   : (slotRange ? periodSlots[slotRange[1]].end   : '')

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
    setSlotError('')

    const assignees = selectedAssignees.length > 0 ? selectedAssignees : [defaultAssigneeId || currentUserId]
    const effectiveDate = dueDate || todayStr

    // Coordinators/principals/admins may assign tasks without pinning a slot;
    // everyone else must map every task onto a period (or a custom time range).
    if (!canAssignToOthers && !derivedStart) {
      setSlotError('Pick a slot or use custom timing for your task.')
      return
    }

    setSubmitting(true)

    const isDuplicate = await checkDuplicateTaskTitle(title.trim(), effectiveDate, assignees)
    if (isDuplicate) {
      setDuplicateError(true)
      setSubmitting(false)
      return
    }

    if (derivedStart && derivedEnd) {
      const hasConflict = await checkTaskSlotConflict(effectiveDate, derivedStart, derivedEnd, assignees)
      if (hasConflict) {
        setSlotError('This assignee already has a task in that time slot — pick a different one.')
        setSubmitting(false)
        return
      }
    }

    const input: NewTaskInput = {
      title:               title.trim(),
      due_date:            effectiveDate,
      timing:              derivedStart || undefined,
      end_time:            derivedEnd   || undefined,
      require_check:       requireCheck,
      requires_submission: requiresSubmission,
      tag:                 canAssignToOthers ? tag : null,
      bonus_points:        canAssignToOthers ? bonusPoints : 0,
      recurrence,
      assignee_ids:        assignees,
      checklist_items:     checklistItems.length > 0 ? checklistItems : undefined,
    }
    const task = await createTask(input, currentUserId)
    setSubmitting(false)
    if (task) {
      setTitle(''); setDueDate(defaultDate || todayStr)
      setSlotRange(null); setRequireCheck(false); setRequiresSubmission(false); setTag(null)
      setBonusPoints(0); setRecurrence('none'); setChecklistItems([])
      setSelectedAssignees([defaultAssigneeId || currentUserId])
      onTaskCreated(task); onClose()
    }
  }

  // ── Date toggler ──────────────────────────────────────────────────────────

  const dateInputId = 'new-task-date-input'
  const dateLabel = dueDate === todayStr
    ? 'Today'
    : dueDate === shiftDate(todayStr, 1)
    ? 'Tomorrow'
    : dueDate === shiftDate(todayStr, -1)
    ? 'Yesterday'
    : new Date(dueDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  const slotBanner = slotError && (
    <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-300 rounded-xl">
      <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
      <p className="text-xs font-semibold text-red-700">{slotError}</p>
    </div>
  )

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
            className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: '92dvh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle — mobile only */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-slate-300" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div
                  className="icon-chip w-8 h-8 flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                >
                  <ClipboardList size={16} className="relative z-10 text-white drop-shadow-sm" />
                </div>
                <h2 className="text-sm font-bold text-slate-800 leading-tight">New Task</h2>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable body — grows to fill available space */}
            <form
              id="new-task-form"
              onSubmit={handleSubmit}
              className="overflow-y-auto flex-1 px-4 sm:px-5 py-4 space-y-3.5"
            >
              {/* Title */}
              <input
                type="text"
                value={title}
                onChange={e => { setTitle(e.target.value); setDuplicateError(false) }}
                placeholder="Task name *"
                className={`w-full border rounded-xl px-3.5 py-2.5 text-base sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500 placeholder:font-normal ${duplicateError ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}
                required
              />
              {duplicateError && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-300 rounded-xl -mt-1">
                  <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs font-semibold text-red-700">A task with this name already exists on the selected date.</p>
                </div>
              )}

              {/* Due Date — slim toggler (prev/next day + tap to pick) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Calendar size={12} /> Due Date
                </label>
                <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setDueDate(d => shiftDate(d, -1))}
                    className="w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors flex-shrink-0"
                    aria-label="Previous day"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <label
                    htmlFor={dateInputId}
                    className="relative flex-1 h-8 flex items-center justify-center border-x border-slate-200 text-slate-700 cursor-pointer"
                  >
                    <span className="text-sm font-semibold whitespace-nowrap">{dateLabel}</span>
                    <input
                      id={dateInputId}
                      type="date"
                      value={dueDate}
                      onChange={e => { if (e.target.value) setDueDate(e.target.value) }}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setDueDate(d => shiftDate(d, 1))}
                    className="w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors flex-shrink-0"
                    aria-label="Next day"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
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

                {/* Animate height between the two modes so the card grows/shrinks
                    smoothly instead of snapping to the new content's size. The two
                    modes overlap during the transition (no `mode="wait"`) so the
                    height interpolates directly from one to the other. */}
                <AnimatePresence initial={false}>
                  <motion.div
                    key={useCustomTime ? 'custom' : 'periods'}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    {useCustomTime ? (
                      /* Custom time inputs */
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-slate-500 mb-1 font-medium">Start time</p>
                          <input
                            type="time"
                            value={customStart}
                            onChange={e => setCustomStart(e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base sm:text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500 transition-colors"
                          />
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1 font-medium">End time</p>
                          <input
                            type="time"
                            value={customEnd}
                            onChange={e => setCustomEnd(e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base sm:text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500 transition-colors"
                          />
                        </div>
                      </div>
                    ) : (
                      /* School period picker — compact, number-only squares.
                         The exact timing lives in the tooltip + selection summary. */
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {periodSlots.map((slot, i) => {
                            const inRange = slotInRange(i)
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => handleSlotClick(i)}
                                title={`${slot.label} · ${fmt(slot.start)}–${fmt(slot.end)}`}
                                className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-semibold border transition-all ${
                                  inRange
                                    ? 'bg-mps-blue-500 text-white border-mps-blue-500 shadow-sm'
                                    : 'bg-slate-50 text-slate-600 border-slate-200 active:bg-slate-100'
                                }`}
                              >
                                {i + 1}
                              </button>
                            )
                          })}
                        </div>
                        {slotRange ? (
                          <div className="flex items-center justify-between px-3 py-1.5 bg-mps-blue-50 border border-mps-blue-100 rounded-lg text-xs">
                            <span className="text-mps-blue-700 font-medium truncate">
                              {slotRange[0] === slotRange[1]
                                ? periodSlots[slotRange[0]].label
                                : `${periodSlots[slotRange[0]].label} – ${periodSlots[slotRange[1]].label}`
                              }
                            </span>
                            <span className="text-mps-blue-600 font-semibold whitespace-nowrap ml-2">
                              {fmt(derivedStart)} – {fmt(derivedEnd)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSlotRange(null)}
                              className="ml-1.5 p-0.5 text-mps-blue-400 hover:text-mps-blue-600 flex-shrink-0"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 pl-0.5">Tap a period to select; tap adjacent periods to extend the range.</p>
                        )}
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
                {slotBanner}
              </div>

              {/* More options toggle */}
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 active:bg-slate-100 transition-colors text-xs font-semibold text-slate-600"
              >
                <span>More options</span>
                <ChevronDown
                  size={14}
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
                    className="overflow-hidden space-y-3"
                  >
                    {/* Repeat & Bonus Points (bonus points: coordinator/principal/admin only) */}
                    <div className={canAssignToOthers ? 'grid grid-cols-2 gap-3' : ''}>
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                          <Repeat size={12} /> Repeat
                        </label>
                        <select
                          value={recurrence}
                          onChange={e => setRecurrence(e.target.value as TaskRecurrence)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500 bg-white"
                        >
                          {(Object.keys(RECURRENCE_LABELS) as TaskRecurrence[]).map(r => (
                            <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>
                          ))}
                        </select>
                      </div>
                      {canAssignToOthers && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                            <Tag size={12} /> Bonus Points
                          </label>
                          <input
                            type="number"
                            value={bonusPoints}
                            onChange={e => {
                              const val = Number(e.target.value)
                              setBonusPoints(val)
                              if (val !== 0) setRequireCheck(true)
                            }}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-500/50 focus:border-mps-blue-500 bg-white"
                            placeholder="0"
                          />
                        </div>
                      )}
                    </div>

                    {/* Require Verification — full-width tappable row */}
                    <button
                      type="button"
                      onClick={() => bonusPoints === 0 && setRequireCheck(prev => !prev)}
                      disabled={bonusPoints !== 0}
                      className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition-colors text-left ${
                        requireCheck ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'
                      } ${bonusPoints !== 0 ? 'cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ShieldCheck
                          size={14}
                          className={requireCheck ? 'text-mps-blue-600 flex-shrink-0' : 'text-slate-400 flex-shrink-0'}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 leading-tight">Needs Verification</p>
                          <p className="text-xs text-slate-400 truncate">
                            {bonusPoints !== 0
                              ? 'Locked ON — bonus tasks require verification'
                              : requireCheck
                              ? 'Not Done → Partial → Checking → Completed'
                              : 'Not Done → Partial → Completed'}
                          </p>
                        </div>
                      </div>
                      <div className={`relative inline-flex h-5 w-9 flex-shrink-0 ml-3 items-center rounded-full transition-colors ${
                        requireCheck ? 'bg-mps-blue-500' : 'bg-slate-300'
                      }`}>
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                          requireCheck ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`} />
                      </div>
                    </button>

                    {/* Needs Submission — full-width tappable row */}
                    <button
                      type="button"
                      onClick={() => setRequiresSubmission(prev => !prev)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition-colors text-left ${
                        requiresSubmission ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Send
                          size={14}
                          className={requiresSubmission ? 'text-indigo-600 flex-shrink-0' : 'text-slate-400 flex-shrink-0'}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 leading-tight">Needs Submission</p>
                          <p className="text-xs text-slate-400 truncate">Assignee must submit their work before marking it done</p>
                        </div>
                      </div>
                      <div className={`relative inline-flex h-5 w-9 flex-shrink-0 ml-3 items-center rounded-full transition-colors ${
                        requiresSubmission ? 'bg-indigo-500' : 'bg-slate-300'
                      }`}>
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                          requiresSubmission ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`} />
                      </div>
                    </button>

                    {/* Assignees */}
                    {canAssignToOthers && availableAssignees.length > 0 && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                          <Users size={12} /> Assignees
                        </label>
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                          <div className="relative border-b border-slate-100">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input
                              type="text"
                              value={assigneeSearch}
                              onChange={e => setAssigneeSearch(e.target.value)}
                              placeholder="Search assignees…"
                              className="w-full pl-7 pr-3 py-1.5 text-xs focus:outline-none bg-slate-50"
                            />
                          </div>
                          <div className="max-h-32 overflow-y-auto p-1 space-y-0.5">
                            {availableAssignees
                              .filter(u => !assigneeSearch || u.full_name?.toLowerCase().includes(assigneeSearch.toLowerCase()) || u.role?.toLowerCase().includes(assigneeSearch.toLowerCase()))
                              .map(user => (
                                <button
                                  key={user.id}
                                  type="button"
                                  onClick={() => toggleAssignee(user.id)}
                                  className={`w-full flex items-center gap-2 p-1.5 rounded-lg transition-colors text-left text-sm ${
                                    selectedAssignees.includes(user.id)
                                      ? 'bg-mps-blue-50 text-mps-blue-700 border border-mps-blue-200'
                                      : 'hover:bg-slate-50 text-slate-700'
                                  }`}
                                >
                                  <Avatar avatarUrl={user.avatar_url} name={user.full_name} size={20} />
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
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">
                        Checklist
                      </label>
                      {checklistItems.length > 0 && (
                        <div className="space-y-1 mb-1.5">
                          {checklistItems.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5">
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
                          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-1 focus:ring-mps-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleAddCheckItem}
                          className="p-2 text-mps-blue-600 hover:bg-mps-blue-50 active:bg-mps-blue-100 rounded-lg transition-colors"
                        >
                          <Plus size={16} />
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
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-mps-blue-500 to-mps-blue-600 hover:from-mps-blue-600 hover:to-mps-blue-700 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 text-sm shadow-lg shadow-mps-blue-500/25 active:scale-[0.98]"
              >
                {submitting
                  ? <>Creating…</>
                  : <><Plus size={16} /> Create Task</>}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
