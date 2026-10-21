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

  // A compact capsule — the session code and a chevron, 30px tall — so it sits
  // beside the title on the narrowest phone instead of pushing past the edge.
  return (
    <div className="flex items-center gap-1">
      <label className={`relative inline-flex items-center gap-1 h-[30px] pl-2.5 pr-6 rounded-full ring-1 shadow-[0_6px_16px_-8px_rgba(15,23,42,.55)] cursor-pointer focus-within:ring-2 focus-within:ring-[color:var(--bus-accent,#B8983C)] ${tone}`}>
        <CalendarRange size={12} className={`flex-shrink-0 ${isViewingPastYear ? 'text-amber-700' : 'text-[color:var(--bus-year-icon,#8B6F47)]'}`} />
        <span className="text-[12px] font-bold tabular-nums leading-none">{year.code}</span>
        {/* The real control, invisible over the capsule: the capsule keeps the
            width of the code alone, and the option list still names the
            current session. */}
        <select
          value={year.id}
          onChange={e => setYearId(e.target.value)}
          aria-label="Academic session"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        >
          {years.map(y => (
            <option key={y.id} value={y.id}>
              {y.code}{y.is_active ? ' (current)' : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={12} className="absolute right-2 pointer-events-none opacity-60" />
      </label>

      {isViewingPastYear && (
        <button
          onClick={resetToActive}
          title="Back to the current session"
          aria-label="Back to the current session"
          className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-full bg-white text-slate-700 ring-1 ring-black/5 shadow-[0_6px_16px_-8px_rgba(15,23,42,.55)] hover:bg-slate-50 transition"
        >
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  )
}
