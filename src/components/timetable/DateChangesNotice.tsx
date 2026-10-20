'use client'

import React, { useMemo } from 'react'
import { CalendarClock } from 'lucide-react'
import { WEEKDAY_LABELS } from '@/lib/timetable'
import type { PeriodSlot, TimetableViewData } from '@/lib/timetable'
import { describeSpan, todayISO } from '@/lib/timetable/overrides'
import type { EntryOverride } from '@/lib/timetable/overrides'

type ViewOverride = TimetableViewData['overrides'][number]

// ============================================================
// "Your timetable is different on these dates."
//
// The grid above is the weekly template and stays that way: a cell cannot show
// both what normally happens and what happens on the 14th. So the exceptions
// are listed under it, in date order, with the period each one touches —
// which is also the form someone actually wants them in ("what's different
// this week?"), rather than scattered across thirty cells.
// ============================================================

export default function DateChangesNotice({
  overrides, slots, className = '',
}: {
  overrides: ViewOverride[]
  slots: PeriodSlot[]
  className?: string
}) {
  const slotLabel = useMemo(() => {
    const m = new Map(slots.map((s) => [s.id, s.label ?? 'Period']))
    return (id: string) => m.get(id) ?? 'Period'
  }, [slots])

  // Today and later only. A change that ended last term is history.
  const upcoming = useMemo(() => {
    const today = todayISO()
    return overrides
      .filter((o) => o.effective_to === null || o.effective_to >= today)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from))
  }, [overrides])

  if (upcoming.length === 0) return null

  return (
    <div className={`fx-card fx-bleed ${className}`}>
      <p className="flex items-center gap-1.5 px-4 sm:px-3.5 py-2 border-b border-[#EEEAE1] bg-[#F7F5F0] text-[12.5px] font-semibold text-slate-700">
        <CalendarClock size={13} className="text-[#B8983C]" aria-hidden />
        Changes on certain dates
      </p>
      <ul className="divide-y divide-[#F0ECE3]">
        {upcoming.map((o) => (
          <li key={o.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 sm:px-3.5 py-2.5 text-[12.5px]">
            <span className="font-semibold text-slate-900 tabular-nums">
              {describeSpan(o as EntryOverride)}
            </span>
            <span className="text-slate-500">
              {WEEKDAY_LABELS[o.day]} · {slotLabel(o.slot_id)}
            </span>
            <span className="text-slate-900 break-words">
              {o.kind === 'cancel' ? (
                <span className="text-rose-700">No lesson</span>
              ) : (
                <>
                  {o.subject?.name ?? 'Changed lesson'}
                  {o.room?.name && <span className="text-slate-500"> · {o.room.name}</span>}
                </>
              )}
            </span>
            {o.note && <span className="text-slate-400 break-words">{o.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
