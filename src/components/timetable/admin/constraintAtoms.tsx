'use client'

import React, { useState, useEffect } from 'react'
import { Ban, Check } from 'lucide-react'
import { WEEKDAY_LABELS } from '@/lib/timetable'
import type { PeriodSlot, TimetableConstraint, ConstraintScope, ConstraintType, Weekday } from '@/lib/timetable'
import { INPUT } from '../ui'

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
  onToggle: (day: Weekday, slotId: string) => void
  label?: string
  onColor?: 'rose' | 'indigo'
}) {
  const on = onColor === 'rose'
    ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
    : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
  return (
    <div className="overflow-x-auto border border-[#D4D4D8]">
      <table className="w-full border-collapse text-sm min-w-[34rem] table-fixed">
        <colgroup>
          <col className="w-28" />
          {days.map((d) => <col key={d} />)}
        </colgroup>
        <thead>
          <tr className="bg-[#FAFAF9]">
            <th className="p-2 text-left text-[10px] font-bold uppercase tracking-widest text-[#525252] sticky left-0 bg-[#FAFAF9] z-10">Period</th>
            {days.map((d) => (
              <th key={d} className="p-3 text-center text-[11px] font-semibold text-[#52525B] border-l border-[#E4E4E7]">
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.id}>
              <td className="p-2 text-[11px] text-[#71717A] whitespace-nowrap sticky left-0 bg-white z-10 border-t border-[#E4E4E7]">
                <div className="font-medium text-[#52525B]">{s.label}</div>
                {s.start_time && <div className="tabular-nums text-[#A1A1AA]">{s.start_time.slice(0, 5)}</div>}
              </td>
              {days.map((d) => {
                const active = isOn(d, s.id)
                return (
                  <td key={d} className="p-1.5 border-t border-l border-[#E4E4E7]">
                    <button
                      onClick={() => onToggle(d, s.id)}
                      className={`w-full h-11 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                        active ? on : 'bg-emerald-50 text-emerald-600/70 hover:bg-emerald-100'
                      }`}
                    >
                      {active ? <><Ban size={12} /> {label}</> : <Check size={13} />}
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
  seed, onCommit, placeholder = '—',
}: {
  seed: number
  onCommit: (value: number) => void
  placeholder?: string
}) {
  const [val, setVal] = useState(seed > 0 ? String(seed) : '')
  useEffect(() => { setVal(seed > 0 ? String(seed) : '') }, [seed])
  return (
    <input
      className={`${INPUT} w-full`}
      type="number"
      min={0}
      placeholder={placeholder}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onCommit(Math.max(0, parseInt(val, 10) || 0))}
    />
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
