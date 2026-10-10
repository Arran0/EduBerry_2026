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
    <div className={`border border-[#E4E4E7] bg-white ${className}`}>
      <p className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[#E4E4E7] bg-[#FAFAF9] text-[10px] font-bold uppercase tracking-widest text-[#525252]">
        <CalendarClock size={12} className="text-[#B8983C]" aria-hidden />
        Changes on specific dates
      </p>
      <ul className="divide-y divide-[#F0F0F0]">
        {upcoming.map((o) => (
          <li key={o.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-xs">
            <span className="font-semibold text-[#18181B] tabular-nums">
              {describeSpan(o as EntryOverride)}
            </span>
            <span className="text-[#71717A]">
              {WEEKDAY_LABELS[o.day]} · {slotLabel(o.slot_id)}
            </span>
            <span className="text-[#18181B]">
              {o.kind === 'cancel' ? (
                <span className="text-rose-700">no lesson</span>
              ) : (
                <>
                  {o.subject?.name ?? 'Changed lesson'}
                  {o.room?.name && <span className="text-[#71717A]"> · {o.room.name}</span>}
                </>
              )}
            </span>
            {o.note && <span className="text-[#A1A1AA] italic">{o.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
