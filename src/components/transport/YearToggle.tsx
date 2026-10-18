'use client'

/**
 * The academic session the transport admin is looking at, on the banner.
 *
 * Every screen under it — routes, riders, trips, alerts, incidents, reports
 * and bus fees — reads the session chosen here (transport_r7). It is the fee
 * app's year scope (AcademicYearContext), so a session picked in one app is
 * already picked when you open the other.
 *
 * Solid white rather than glass: it sits on a photo or a gradient the school
 * chose, and a translucent control on an unknown background is a control you
 * cannot read. When the session is not the active one it turns amber and
 * offers the way back, so nobody edits last year's routes by accident.
 */

import React from 'react'
import { CalendarRange, ChevronDown, RotateCcw } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'

export default function YearToggle() {
  const { years, year, isViewingPastYear, setYearId, resetToActive } = useAcademicYear()
  if (years.length === 0 || !year) return null

  const tone = isViewingPastYear
    ? 'bg-amber-50 text-amber-900 ring-amber-300/80'
    : 'bg-white text-slate-900 ring-black/5'

  return (
    <div className="flex items-center gap-1.5">
      <label className={`relative inline-flex items-center gap-1.5 h-9 pl-3 pr-8 rounded-full ring-1 shadow-[0_8px_22px_-10px_rgba(15,23,42,.55)] cursor-pointer ${tone}`}>
        <CalendarRange size={14} className={isViewingPastYear ? 'text-amber-700' : 'text-[#8B6F47]'} />
        <span className="sr-only">Academic session</span>
        <select
          value={year.id}
          onChange={e => setYearId(e.target.value)}
          className="appearance-none bg-transparent text-[13px] font-bold tabular-nums leading-none focus:outline-none cursor-pointer"
        >
          {years.map(y => (
            <option key={y.id} value={y.id}>
              {y.code}{y.is_active ? ' · current' : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-3 pointer-events-none opacity-60" />
      </label>

      {isViewingPastYear && (
        <button
          onClick={resetToActive}
          title="Back to the current session"
          className="inline-flex items-center gap-1 h-9 px-3 rounded-full bg-white text-[12px] font-semibold text-slate-800 ring-1 ring-black/5 shadow-[0_8px_22px_-10px_rgba(15,23,42,.55)] hover:bg-slate-50 transition"
        >
          <RotateCcw size={12} /> <span className="hidden sm:inline">Current</span>
        </button>
      )}
    </div>
  )
}
