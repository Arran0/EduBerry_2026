'use client'

import React, { useMemo } from 'react'
import { Coffee, CalendarClock } from 'lucide-react'
import { WEEKDAY_LABELS } from '@/lib/timetable'
import type { PeriodSlot, TimetableEntry, TimetableViewData, Weekday } from '@/lib/timetable'
import { describeSpan, todayISO } from '@/lib/timetable/overrides'
import type { EntryOverride } from '@/lib/timetable/overrides'
import { DayTabs, useDay } from './ui'

type ViewOverride = TimetableViewData['overrides'][number]

interface Props {
  days: Weekday[]
  slots: PeriodSlot[] // all slots incl. breaks, ordered by position
  entries: TimetableEntry[]
  // What the secondary line under the subject shows: the teacher (student view)
  // or the class/homeroom (staff view).
  secondary?: (entry: TimetableEntry) => string | null
  /**
   * Per-date amendments. The grid stays the weekly template — a cell a date
   * change touches is marked rather than rewritten, because one cell can be
   * one thing this Tuesday and another the next, and a week grid has no room
   * to be both. The exact day is resolved on the home card and in the list
   * under the grid.
   */
  overrides?: ViewOverride[]
}

const timeOf = (s: PeriodSlot) =>
  s.start_time && s.end_time ? `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}` : null

// Read-only week (days × periods) shared by the student, staff and person views.
// A phone gets one day at a time as a list; the table starts at sm, where the
// whole week fits without scrolling sideways.
export default function TimetableGrid({ days, slots, entries, secondary, overrides = [] }: Props) {
  const [day, setDay] = useDay(days)

  // Cells amended today or at any point in future. A change that finished last
  // term is history and would only add noise to this week.
  const amended = useMemo(() => {
    const today = todayISO()
    const m = new Map<string, ViewOverride[]>()
    for (const o of overrides) {
      if (o.effective_to !== null && o.effective_to < today) continue
      const k = `${o.day}__${o.slot_id}`
      m.set(k, [...(m.get(k) ?? []), o])
    }
    return m
  }, [overrides])
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

  const changeNote = (changes: ViewOverride[]) =>
    changes
      .map((o) => `${describeSpan(o as EntryOverride)}: ${
        o.kind === 'cancel' ? 'no lesson' : o.subject?.name ?? 'changed lesson'
      }${o.note ? ` (${o.note})` : ''}`)
      .join('\n')

  return (
    <>
      {/* ── Phone: one day ─────────────────────────────────── */}
      <div className="sm:hidden space-y-2">
        <DayTabs days={days} value={day} onChange={setDay} />
        <div className="fx-card fx-bleed divide-y divide-[#F0ECE3]">
          {slots.map((slot) => {
            const time = timeOf(slot)
            if (slot.is_break) {
              return (
                <div key={slot.id} className="flex items-center gap-3 px-4 py-2 bg-[#FBF6E9]">
                  <span className="w-[4.5rem] flex-shrink-0 text-[12px] text-amber-700 tabular-nums">{time ?? ''}</span>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-amber-700">
                    <Coffee size={13} /> {slot.label || 'Break'}
                  </span>
                </div>
              )
            }
            const cell = byCell.get(`${day}__${slot.id}`) ?? []
            const changes = amended.get(`${day}__${slot.id}`) ?? []
            return (
              <div key={slot.id} className="flex items-stretch gap-3 px-4 py-2.5">
                <div className="w-[4.5rem] flex-shrink-0">
                  <p className="text-[13px] font-semibold text-slate-700 leading-snug break-words">{slot.label}</p>
                  {time && <p className="text-[11.5px] text-slate-400 tabular-nums">{time}</p>}
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  {cell.length === 0 ? (
                    <p className="text-[13px] text-slate-300 py-1">Free</p>
                  ) : cell.map((entry) => {
                    const subj = entry.subject
                    const sub = secondary ? secondary(entry) : null
                    return (
                      <div key={entry.id} className="relative pl-3">
                        <span aria-hidden className="absolute left-0 top-0.5 bottom-0.5 w-[3px] rounded-full" style={{ background: subj?.color ?? '#52525B' }} />
                        <p className="text-[14px] font-semibold text-slate-900 leading-snug break-words">
                          {subj?.name ?? 'Lesson'}
                          {entry.group && <span className="font-normal text-slate-500"> · {entry.group.name}</span>}
                        </p>
                        {(sub || entry.room) && (
                          <p className="text-[12.5px] text-slate-500 leading-snug break-words">
                            {[sub, entry.room?.name].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                    )
                  })}
                  {changes.length > 0 && (
                    <p className="flex items-start gap-1 text-[12px] text-[#7A5D12] leading-snug">
                      <CalendarClock size={12} className="flex-shrink-0 mt-px" />
                      <span className="whitespace-pre-line break-words">{changeNote(changes)}</span>
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── sm up: the week ─────────────────────────────────── */}
      <div className="hidden sm:block fx-card overflow-x-auto">
        <table className="w-full border-collapse text-sm table-fixed">
          <colgroup>
            <col className="w-24 lg:w-28" />
            {days.map((d) => <col key={d} />)}
          </colgroup>
          <thead>
            <tr className="bg-[#F7F5F0]">
              <th className="p-2 text-left text-[12px] font-semibold text-slate-500">Period</th>
              {days.map((d) => (
                <th key={d} className="p-2 text-center text-[12px] font-semibold text-slate-600 border-l border-[#EEEAE1]">
                  <span className="lg:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
                  <span className="hidden lg:inline">{WEEKDAY_LABELS[d]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot.id} className={slot.is_break ? 'bg-[#FBF6E9]' : ''}>
                <td className="p-2 align-top text-[11.5px] text-slate-500 border-t border-[#EEEAE1]">
                  <div className="font-semibold text-slate-700 leading-snug break-words">{slot.label}</div>
                  {timeOf(slot) && <div className="tabular-nums text-slate-400">{timeOf(slot)}</div>}
                </td>
                {days.map((d) => {
                  if (slot.is_break) {
                    return (
                      <td key={d} className="p-1 border-t border-l border-[#EEEAE1]">
                        <div className="h-12 flex items-center justify-center text-amber-500">
                          <Coffee size={14} />
                        </div>
                      </td>
                    )
                  }
                  const cellKey = `${d}__${slot.id}`
                  const cellEntries = byCell.get(cellKey) ?? []
                  const changes = amended.get(cellKey) ?? []
                  return (
                    <td key={d} className="relative p-1 border-t border-l border-[#EEEAE1] align-top">
                      {changes.length > 0 && (
                        <span className="absolute top-1 right-1 z-10 text-[#B8983C]" title={changeNote(changes)}>
                          <CalendarClock size={11} />
                        </span>
                      )}
                      {cellEntries.length === 0 ? (
                        <div className="h-12" />
                      ) : (
                        <div className="space-y-0.5">
                          {cellEntries.map((entry) => {
                            const subj = entry.subject
                            const sub = secondary ? secondary(entry) : null
                            return (
                              <div
                                key={entry.id}
                                className="min-h-[3rem] rounded-[6px] px-2 py-1 text-[12px] leading-tight"
                                style={{
                                  background: (subj?.color ?? '#52525B') + '1f',
                                  boxShadow: `inset 3px 0 0 ${subj?.color ?? '#52525B'}`,
                                }}
                                title={[subj?.name, sub, entry.room?.name].filter(Boolean).join(' · ')}
                              >
                                <div className="font-semibold text-slate-900 break-words">
                                  {subj?.name ?? 'Lesson'}
                                  {entry.group && <span className="font-normal text-slate-500"> · {entry.group.name}</span>}
                                </div>
                                {sub && <div className="text-slate-600 break-words">{sub}</div>}
                                {entry.room && <div className="text-slate-400 break-words">{entry.room.name}</div>}
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
    </>
  )
}
