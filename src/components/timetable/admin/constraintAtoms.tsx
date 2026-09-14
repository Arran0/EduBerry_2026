'use client'

import React, { useState, useEffect } from 'react'
import { Ban, Check, AlertTriangle } from 'lucide-react'
import { WEEKDAY_LABELS } from '@/lib/timetable'
import type { PeriodSlot, TimetableConstraint, ConstraintScope, ConstraintType, Weekday } from '@/lib/timetable'
import { INPUT, Field } from '../ui'

// Shared constraint UI atoms used by the Constraints tab and the Homeroom /
// Teacher / Subject entity modals, so every time-off grid and min/max input
// looks and behaves the same.

// ── Reusable: day × slot toggle grid ─────────────────────────

export function TimeOffGrid({
  days, slots, isOn, onToggle, label = 'Time off', onColor = 'rose',
}: {
  days: Weekday[]
  slots: PeriodSlot[]
  isOn: (day: Weekday, slotId: string) => boolean
  onToggle: (day: Weekday, slotId: string) => void | Promise<void>
  label?: string
  onColor?: 'rose' | 'indigo'
}) {
  const on = onColor === 'rose'
    ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
    : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'

  // Clicking a period in the left column applies it to the whole week: if every
  // day is already on it clears the row, otherwise it fills the gaps. Toggles
  // run one at a time so each write sees the previous one's state.
  const toggleWeek = async (slotId: string) => {
    const allOn = days.every((d) => isOn(d, slotId))
    for (const d of days) {
      if (isOn(d, slotId) === !allOn) continue
      await onToggle(d, slotId)
    }
  }

  return (
    <div className="overflow-x-auto border border-[#D4D4D8]">
      <table className="w-full border-collapse text-sm min-w-[22rem] sm:min-w-[34rem] table-fixed">
        <colgroup>
          <col className="w-16 sm:w-28" />
          {days.map((d) => <col key={d} />)}
        </colgroup>
        <thead>
          <tr className="bg-[#FAFAF9]">
            <th className="p-1 sm:p-2 text-left text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-[#525252] sticky left-0 bg-[#FAFAF9] z-10">
              Period
              <span className="block font-normal normal-case tracking-normal text-[9px] text-[#A1A1AA]">tap = whole week</span>
            </th>
            {days.map((d) => (
              <th key={d} className="p-1.5 sm:p-3 text-center text-[10px] sm:text-[11px] font-semibold text-[#52525B] border-l border-[#E4E4E7]">
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.id}>
              <td className="p-0 text-[10px] sm:text-[11px] text-[#71717A] whitespace-nowrap sticky left-0 bg-white z-10 border-t border-[#E4E4E7]">
                <button
                  onClick={() => toggleWeek(s.id)}
                  title={days.every((d) => isOn(d, s.id))
                    ? `Clear ${label.toLowerCase()} for this period all week`
                    : `Mark ${label.toLowerCase()} for this period all week`}
                  className={`w-full text-left p-1 sm:p-2 transition-colors hover:bg-[#F5F5F5] ${
                    days.length > 0 && days.every((d) => isOn(d, s.id)) ? (onColor === 'rose' ? 'bg-rose-50' : 'bg-indigo-50') : ''
                  }`}
                >
                  <div className="font-medium text-[#52525B] truncate">{s.label}</div>
                  {s.start_time && <div className="tabular-nums text-[#A1A1AA] hidden sm:block">{s.start_time.slice(0, 5)}</div>}
                </button>
              </td>
              {days.map((d) => {
                const active = isOn(d, s.id)
                return (
                  <td key={d} className="p-1 sm:p-1.5 border-t border-l border-[#E4E4E7]">
                    <button
                      onClick={() => onToggle(d, s.id)}
                      className={`w-full h-8 sm:h-11 text-[10px] sm:text-xs font-medium transition-colors flex items-center justify-center gap-1 sm:gap-1.5 ${
                        active ? on : 'bg-emerald-50 text-emerald-600/70 hover:bg-emerald-100'
                      }`}
                    >
                      {active ? <><Ban size={12} /><span className="hidden sm:inline">{label}</span></> : <Check size={13} />}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Reusable: numeric value input that commits on blur ───────

export function ValueInput({
  seed, onCommit, placeholder = '—', invalid = false,
}: {
  seed: number
  onCommit: (value: number) => void
  placeholder?: string
  invalid?: boolean
}) {
  const [val, setVal] = useState(seed > 0 ? String(seed) : '')
  useEffect(() => { setVal(seed > 0 ? String(seed) : '') }, [seed])
  return (
    <input
      className={`${INPUT} ${invalid ? 'border-rose-400 focus:border-rose-500 bg-rose-50/40' : ''}`}
      type="number"
      min={0}
      placeholder={placeholder}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onCommit(Math.max(0, parseInt(val, 10) || 0))}
    />
  )
}

// ── Reusable: the min/max load-limit block, with sanity checks ─

const LIMIT_TYPES = ['min_per_day', 'max_per_day', 'min_per_week', 'max_per_week'] as const
type LimitType = (typeof LIMIT_TYPES)[number]

const LIMIT_LABELS: Record<LimitType, string> = {
  min_per_day: 'Min / day',
  max_per_day: 'Max / day',
  min_per_week: 'Min / week',
  max_per_week: 'Max / week',
}

/**
 * The four min/max load limits (per day, per week) for one scope. A value of 0
 * means "no limit", so only pairs where BOTH ends are set can contradict.
 *
 * Returns the offending fields keyed by type, so the inputs can be flagged and
 * the impossible combination explained rather than silently saved and then
 * blamed on the generator for producing nothing.
 */
function limitConflicts(
  values: Record<LimitType, number>,
  workingDays: number,
): { fields: Set<LimitType>; messages: string[] } {
  const fields = new Set<LimitType>()
  const messages: string[] = []
  const { min_per_day: minD, max_per_day: maxD, min_per_week: minW, max_per_week: maxW } = values
  const days = Math.max(1, workingDays)

  if (minD > 0 && maxD > 0 && minD > maxD) {
    fields.add('min_per_day'); fields.add('max_per_day')
    messages.push(`Min / day (${minD}) is above max / day (${maxD}).`)
  }
  if (minW > 0 && maxW > 0 && minW > maxW) {
    fields.add('min_per_week'); fields.add('max_per_week')
    messages.push(`Min / week (${minW}) is above max / week (${maxW}).`)
  }
  if (minW > 0 && maxD > 0 && minW > maxD * days) {
    fields.add('min_per_week'); fields.add('max_per_day')
    messages.push(`Min / week (${minW}) can never be reached at ${maxD} a day across ${days} working day${days === 1 ? '' : 's'} (max ${maxD * days}).`)
  }
  if (minD > 0 && maxW > 0 && minD * days > maxW) {
    fields.add('min_per_day'); fields.add('max_per_week')
    messages.push(`Min / day (${minD}) over ${days} working day${days === 1 ? '' : 's'} needs ${minD * days}, above max / week (${maxW}).`)
  }
  return { fields, messages }
}

export function LoadLimitFields({
  constraints, scope, scopeId, homeroomId, workingDays, onCommit,
}: {
  constraints: TimetableConstraint[]
  scope: ConstraintScope
  scopeId: string | null
  homeroomId: string | null
  workingDays: number
  onCommit: (type: LimitType, value: number) => void
}) {
  const values = Object.fromEntries(
    LIMIT_TYPES.map((t) => [t, valueOf(constraints, scope, scopeId, homeroomId, t)]),
  ) as Record<LimitType, number>

  // Reject a value that would contradict what is already saved, rather than
  // storing an unsatisfiable pair. Bumping the nonce remounts the inputs so a
  // rejected edit visibly snaps back to the value that is actually stored.
  const [rejected, setRejected] = useState<string[]>([])
  const [nonce, setNonce] = useState(0)
  const guardedCommit = (type: LimitType, value: number) => {
    const next = { ...values, [type]: value }
    const { messages } = limitConflicts(next, workingDays)
    if (messages.length > 0) {
      setRejected(messages)
      setNonce((n) => n + 1)
      return
    }
    setRejected([])
    onCommit(type, value)
  }

  // Anything already stored that contradicts (e.g. saved before these checks).
  const existing = limitConflicts(values, workingDays)
  const problems = rejected.length > 0 ? rejected : existing.messages

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LIMIT_TYPES.map((type) => (
          <Field key={type} label={LIMIT_LABELS[type]}>
            <ValueInput
              key={`${type}-${nonce}`}
              seed={values[type]}
              invalid={existing.fields.has(type)}
              onCommit={(v) => guardedCommit(type, v)}
            />
          </Field>
        ))}
      </div>
      {problems.length > 0 && (
        <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <div>
            {problems.map((m) => <p key={m}>{m}</p>)}
            <p className="text-rose-600/80 mt-0.5">Not saved — leave a field blank for “no limit”.</p>
          </div>
        </div>
      )}
    </>
  )
}

/** Reads the current value of a value-constraint from the array. */
export function valueOf(
  constraints: TimetableConstraint[],
  scope: ConstraintScope, scopeId: string | null, homeroomId: string | null, type: ConstraintType,
): number {
  const c = constraints.find(
    (x) => x.scope === scope && (x.scope_id ?? null) === scopeId && (x.homeroom_id ?? null) === homeroomId && x.type === type,
  )
  return c?.value ?? 0
}
