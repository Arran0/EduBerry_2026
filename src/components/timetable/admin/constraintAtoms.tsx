'use client'

import React, { useState, useEffect } from 'react'
import { Ban, Check } from 'lucide-react'
import { WEEKDAY_LABELS } from '@/lib/timetable'
import type { PeriodSlot, TimetableConstraint, ConstraintScope, ConstraintType, Weekday } from '@/lib/timetable'
import { INPUT, Field, Notice } from '../ui'

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
  // day is already on it clears the row, otherwise it fills the gaps. Each day
  // is its own constraint row, so which days need toggling is decided up front
  // and the writes go out together — running them one at a time cost a full
  // round trip per working day for no benefit.
  const toggleWeek = async (slotId: string) => {
    const allOn = days.every((d) => isOn(d, slotId))
    const changing = days.filter((d) => isOn(d, slotId) !== !allOn)
    await Promise.all(changing.map((d) => onToggle(d, slotId)))
  }

  return (
    <div className="fx-card overflow-hidden">
      <table className="w-full border-collapse text-sm table-fixed">
        <colgroup>
          <col className="w-[4.25rem] sm:w-28" />
          {days.map((d) => <col key={d} />)}
        </colgroup>
        <thead>
          <tr className="bg-[#F7F5F0]">
            <th className="p-1.5 sm:p-2 text-left text-[11px] sm:text-[12px] font-semibold text-slate-600 leading-tight">
              Period
              <span className="block font-normal text-[10.5px] text-slate-400">tap: all week</span>
            </th>
            {days.map((d) => (
              <th key={d} className="p-1.5 sm:p-2.5 text-center text-[11px] sm:text-[12px] font-semibold text-slate-600 border-l border-[#EEEAE1]">
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.id}>
              <td className="p-0 text-[11px] text-slate-500 bg-white border-t border-[#EEEAE1]">
                <button
                  onClick={() => toggleWeek(s.id)}
                  title={days.every((d) => isOn(d, s.id))
                    ? `Clear ${label.toLowerCase()} for this period all week`
                    : `Mark ${label.toLowerCase()} for this period all week`}
                  className={`w-full text-left p-1.5 sm:p-2 transition-colors hover:bg-[#F4F1EA] ${
                    days.length > 0 && days.every((d) => isOn(d, s.id)) ? (onColor === 'rose' ? 'bg-rose-50' : 'bg-indigo-50') : ''
                  }`}
                >
                  <div className="font-medium text-slate-700 leading-tight break-words">{s.label}</div>
                  {s.start_time && <div className="tabular-nums text-slate-400 hidden sm:block">{s.start_time.slice(0, 5)}</div>}
                </button>
              </td>
              {days.map((d) => {
                const active = isOn(d, s.id)
                return (
                  <td key={d} className="p-1 sm:p-1.5 border-t border-l border-[#EEEAE1]">
                    <button
                      onClick={() => onToggle(d, s.id)}
                      className={`w-full h-9 sm:h-11 rounded-md text-[11px] sm:text-xs font-medium transition-colors flex items-center justify-center gap-1 sm:gap-1.5 ${
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
      className={`${INPUT} tabular-nums ${invalid ? '!border-rose-400 focus:!border-rose-500 !bg-rose-50/40' : ''}`}
      type="number"
      inputMode="numeric"
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
  min_per_day: 'Fewest a day',
  max_per_day: 'Most a day',
  min_per_week: 'Fewest a week',
  max_per_week: 'Most a week',
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
    messages.push(`Fewest a day (${minD}) is more than most a day (${maxD}).`)
  }
  if (minW > 0 && maxW > 0 && minW > maxW) {
    fields.add('min_per_week'); fields.add('max_per_week')
    messages.push(`Fewest a week (${minW}) is more than most a week (${maxW}).`)
  }
  if (minW > 0 && maxD > 0 && minW > maxD * days) {
    fields.add('min_per_week'); fields.add('max_per_day')
    messages.push(`Fewest a week (${minW}) cannot be reached at ${maxD} a day over ${days} working day${days === 1 ? '' : 's'} (${maxD * days} at most).`)
  }
  if (minD > 0 && maxW > 0 && minD * days > maxW) {
    fields.add('min_per_day'); fields.add('max_per_week')
    messages.push(`Fewest a day (${minD}) over ${days} working day${days === 1 ? '' : 's'} needs ${minD * days}, more than most a week (${maxW}).`)
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
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
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
        <Notice tone="error" className="mt-2">
          {problems.map((m) => <p key={m}>{m}</p>)}
          <p className="opacity-80 mt-0.5">Not saved. Leave a box empty for no limit.</p>
        </Notice>
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
