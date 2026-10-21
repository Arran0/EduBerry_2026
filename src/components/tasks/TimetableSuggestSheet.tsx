'use client'

import React, { useMemo } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import type { SuggestedPeriod } from '@/lib/taskTimetable'
import { Btn, Notice, TaskSheet } from './ui'

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * "Fill this week from the timetable?" — shown when someone opens an empty
 * week of a teacher who has lessons in the published timetable. Each period
 * becomes an unnamed task carrying its classes.
 */
export default function TimetableSuggestSheet({ periods, whose, fromToday, busy, error, onAccept, onClose }: {
  periods: SuggestedPeriod[]
  /** "your" or "Priya's". */
  whose: string
  /** The week is under way, so only today onwards is offered. */
  fromToday: boolean
  busy: boolean
  error: string | null
  onAccept: () => void
  onClose: () => void
}) {
  const days = useMemo(() => {
    const map = new Map<string, SuggestedPeriod[]>()
    for (const p of periods) {
      const list = map.get(p.date)
      if (list) list.push(p)
      else map.set(p.date, [p])
    }
    return [...map.entries()]
  }, [periods])

  return (
    <TaskSheet
      onClose={onClose}
      size="md"
      title="Fill this week from the timetable?"
      icon={CalendarClock}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn onClick={onClose} disabled={busy}>Not now</Btn>
          <Btn tone="primary" onClick={onAccept} disabled={busy}>
            {busy && <Loader2 size={13} className="animate-spin" />}
            Add {periods.length} period{periods.length === 1 ? '' : 's'}
          </Btn>
        </div>
      }
    >
      <p className="text-[13.5px] text-slate-600 leading-relaxed">
        This week is empty. The published timetable has {periods.length} period{periods.length === 1 ? '' : 's'} in {whose} week
        {fromToday ? ' from today' : ''}. Each one becomes a task named after its class, ready for a task name.
      </p>
      <div className="mt-3 tk-card !rounded-[14px] divide-y divide-amber-900/[0.06]">
        {days.map(([date, list]) => {
          const d = new Date(date + 'T12:00:00')
          return (
            <div key={date} className="flex items-start gap-3 px-3 py-2">
              <span className="w-14 flex-shrink-0 pt-0.5 leading-tight">
                <span className="block text-[12.5px] font-semibold text-slate-800">{DAY[d.getDay()]} {d.getDate()}</span>
                <span className="block text-[11px] text-slate-400 tabular-nums">{list.length} period{list.length === 1 ? '' : 's'}</span>
              </span>
              <div className="flex flex-wrap gap-1 min-w-0">
                {list.map(p => (
                  <span key={p.period} className="inline-flex items-baseline gap-1 h-6 px-2 rounded-[8px] bg-amber-50 border border-amber-100 text-[12px] leading-6">
                    <span className="font-bold text-amber-700/70 tabular-nums">P{p.period}</span>
                    <span className="font-semibold text-slate-700">{p.classes.join(', ')}</span>
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {error && <Notice className="mt-3">{error}</Notice>}
    </TaskSheet>
  )
}
