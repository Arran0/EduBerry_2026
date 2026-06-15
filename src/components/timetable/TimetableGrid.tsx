'use client'

import React, { useMemo } from 'react'
import { Coffee } from 'lucide-react'
import { WEEKDAY_LABELS } from '@/lib/timetable'
import type { PeriodSlot, TimetableEntry, Weekday } from '@/lib/timetable'

interface Props {
  days: Weekday[]
  slots: PeriodSlot[] // all slots incl. breaks, ordered by position
  entries: TimetableEntry[]
  // What the secondary line under the subject shows: the teacher (student view)
  // or the class/homeroom (staff view).
  secondary?: (entry: TimetableEntry) => string | null
}

// Read-only weekly grid (days × period slots) shared by the student and staff views.
export default function TimetableGrid({ days, slots, entries, secondary }: Props) {
  const byCell = useMemo(() => {
    const m = new Map<string, TimetableEntry>()
    for (const e of entries) m.set(`${e.day}__${e.slot_id}`, e)
    return m
  }, [entries])

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-sm min-w-[40rem]">
        <thead>
          <tr className="bg-slate-50">
            <th className="p-2 text-left text-xs font-semibold text-slate-400 w-28 sticky left-0 bg-slate-50 z-10">Period</th>
            {days.map((d) => (
              <th key={d} className="p-2 text-center text-xs font-semibold text-slate-600">
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.id} className={slot.is_break ? 'bg-amber-50/40' : ''}>
              <td className={`p-2 align-top text-xs text-slate-500 whitespace-nowrap border-t border-slate-100 sticky left-0 z-10 ${slot.is_break ? 'bg-amber-50/40' : 'bg-white'}`}>
                <div className="font-medium text-slate-600">{slot.label}</div>
                <div className="tabular-nums text-slate-400">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</div>
              </td>
              {days.map((day) => {
                if (slot.is_break) {
                  return (
                    <td key={day} className="p-1 border-t border-slate-100">
                      <div className="h-14 rounded-lg bg-amber-50 flex items-center justify-center text-amber-500">
                        <Coffee size={14} />
                      </div>
                    </td>
                  )
                }
                const entry = byCell.get(`${day}__${slot.id}`)
                const subj = entry?.subject
                const sub = entry && secondary ? secondary(entry) : null
                return (
                  <td key={day} className="p-1 border-t border-slate-100">
                    {entry ? (
                      <div
                        className="h-14 rounded-lg px-2 py-1 text-xs"
                        style={{
                          background: (subj?.color ?? '#64748b') + '22',
                          borderLeft: `3px solid ${subj?.color ?? '#64748b'}`,
                        }}
                      >
                        <div className="font-semibold text-slate-700 truncate">{subj?.name ?? 'Lesson'}</div>
                        {sub && <div className="text-slate-500 truncate">{sub}</div>}
                        {entry.room && <div className="text-slate-400 truncate">{entry.room.name}</div>}
                      </div>
                    ) : (
                      <div className="h-14 rounded-lg border border-dashed border-slate-100" />
                    )}
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
