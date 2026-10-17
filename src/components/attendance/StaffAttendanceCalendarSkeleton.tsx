'use client'

import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * The month calendar's own layout in grey, drawn at exactly the calendar's
 * size: same header, weekday strip, six week rows (the calendar always draws
 * six) and stats footer. It is the loading state twice over — while the
 * calendar's code arrives (the dynamic import's fallback) and while its month
 * is being fetched — so a popup that opens on it never changes height when the
 * real days land.
 *
 * Kept in its own file, outside StaffAttendanceCalendar, so a page can show it
 * without first downloading the calendar it stands in for.
 */

export const CALENDAR_DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** Six rows, every month — a five-row month would otherwise be a row shorter than a six-row one. */
export const CALENDAR_CELLS = 42

const PULSE = 'animate-pulse bg-[#EEEBE5]'

export function CalendarGridSkeleton({ fill = false }: { fill?: boolean }) {
  return (
    <div className={`grid grid-cols-7${fill ? ' flex-1 auto-rows-fr' : ''}`} aria-hidden>
      {Array.from({ length: CALENDAR_CELLS }).map((_, i) => (
        <div
          key={i}
          className={`${fill ? 'min-h-14' : 'h-14'} border-b border-r border-[#F0F0EF] last:border-r-0 flex flex-col items-center justify-center gap-1`}
        >
          <span className={`h-2.5 w-3.5 rounded ${PULSE}`} style={{ animationDelay: `${(i % 7) * 60}ms` }} />
          <span className={`h-1.5 w-2.5 rounded ${PULSE} opacity-60`} style={{ animationDelay: `${(i % 7) * 60}ms` }} />
        </div>
      ))}
    </div>
  )
}

export function CalendarStatsSkeleton() {
  return (
    <div className="border-t border-[#E4E4E7] px-4 py-3 space-y-2 bg-[#FAFAF9]" aria-hidden>
      {/* Heights match the real footer line for line: a status chip is 21px
          (10px text at 1.5 leading, 2px padding, a border), the summary line
          16.5px — so the footer does not move when the month lands. */}
      <div className="flex gap-1.5">
        {[58, 46, 64].map(w => <span key={w} className={`h-[21px] rounded-full ${PULSE}`} style={{ width: w }} />)}
      </div>
      <div className="flex items-center justify-between h-[16.5px]">
        <span className={`h-3 w-36 rounded ${PULSE}`} />
        <span className={`h-3 w-24 rounded ${PULSE}`} />
      </div>
    </div>
  )
}

export default function StaffAttendanceCalendarSkeleton({ staffName }: { staffName?: string }) {
  const now = new Date()
  const label = now.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  return (
    <div className="bg-white" aria-busy="true" aria-label="Loading calendar">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E4E4E7]">
        <span className="p-2 text-[#D4D4D8]"><ChevronLeft size={18} /></span>
        <div className="text-center">
          <h3 className="font-bold text-[#18181B] text-sm leading-tight">{label}</h3>
          {staffName && <p className="text-xs text-[#A1A1AA] mt-0.5">{staffName}</p>}
        </div>
        <span className="p-2 text-[#D4D4D8]"><ChevronRight size={18} /></span>
      </div>
      <div className="grid grid-cols-7 border-b border-[#E4E4E7] bg-[#FAFAF9]">
        {CALENDAR_DAY_HEADERS.map(h => (
          <div key={h} className="py-2 text-center text-[10px] font-bold uppercase tracking-wide text-[#A1A1AA]">{h}</div>
        ))}
      </div>
      <CalendarGridSkeleton />
      <CalendarStatsSkeleton />
    </div>
  )
}
