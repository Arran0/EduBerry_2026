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
  // A cell can hold several parallel split-group lessons.
  const byCell = useMemo(() => {
    const m = new Map<string, TimetableEntry[]>()
    for (const e of entries) {
      const k = `${e.day}__${e.slot_id}`
      const arr = m.get(k) ?? []
      arr.push(e)
      m.set(k, arr)
    }
    return m
  }, [entries])

  return (
    <div className="overflow-x-auto border border-[#D4D4D8] bg-white">
      <table className="w-full border-collapse text-sm min-w-[40rem]">
        <thead>
          <tr className="bg-[#FAFAF9]">
            <th className="p-2 text-left text-[10px] font-bold uppercase tracking-widest text-[#525252] w-28 sticky left-0 bg-[#FAFAF9] z-10">Period</th>
            {days.map((d) => (
              <th key={d} className="p-2 text-center text-[11px] font-semibold text-[#52525B] border-l border-[#E4E4E7]">
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.id} className={slot.is_break ? 'bg-amber-50/40' : ''}>
              <td className={`p-2 align-top text-[11px] text-[#71717A] whitespace-nowrap border-t border-[#E4E4E7] sticky left-0 z-10 ${slot.is_break ? 'bg-amber-50/40' : 'bg-white'}`}>
                <div className="font-medium text-[#52525B]">{slot.label}</div>
                {slot.start_time && slot.end_time && (
                  <div className="tabular-nums text-[#A1A1AA]">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</div>
                )}
              </td>
              {days.map((day) => {
                if (slot.is_break) {
                  return (
                    <td key={day} className="p-1 border-t border-l border-[#E4E4E7]">
                      <div className="h-14 bg-amber-50 flex items-center justify-center text-amber-500">
                        <Coffee size={14} />
                      </div>
                    </td>
                  )
                }
                const cellEntries = byCell.get(`${day}__${slot.id}`) ?? []
                const split = cellEntries.length > 1
                return (
                  <td key={day} className="p-1 border-t border-l border-[#E4E4E7] align-top">
                    {cellEntries.length === 0 ? (
                      <div className="h-14" />
                    ) : (
                      <div className={split ? 'space-y-0.5' : ''}>
                        {cellEntries.map((entry) => {
                          const subj = entry.subject
                          const sub = secondary ? secondary(entry) : null
                          return (
                            <div
                              key={entry.id}
                              className={`${split ? 'px-2 py-0.5' : 'h-14 px-2 py-1'} text-xs`}
                              style={{
                                background: (subj?.color ?? '#52525B') + '1f',
                                borderLeft: `3px solid ${subj?.color ?? '#52525B'}`,
                              }}
                            >
                              <div className="font-semibold text-[#18181B] truncate">
                                {subj?.name ?? 'Lesson'}
                                {entry.group && <span className="font-normal text-[#71717A]"> · {entry.group.name}</span>}
                              </div>
                              {sub && <div className="text-[#52525B] truncate">{sub}</div>}
                              {entry.room && <div className="text-[#A1A1AA] truncate">{entry.room.name}</div>}
                            </div>
                          )
                        })}
                      </div>
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
