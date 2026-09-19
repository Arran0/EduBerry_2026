'use client'

// The one year selector for the fee module.
//
// It replaces five independent per-screen pickers. When the chosen session is
// not the school's active one it says so loudly — a clerk taking a payment
// against last year's dues must never be in any doubt about which year's books
// it will land in.

import React from 'react'
import { CalendarRange, ChevronDown, RotateCcw } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'

export default function YearScope() {
  const { years, year, isViewingPastYear, setYearId, resetToActive } = useAcademicYear()
  if (years.length === 0 || !year) return null

  return (
    <div className="flex items-center gap-1.5">
      <div className={`relative inline-flex items-center gap-1.5 pl-2 pr-1 py-[5px] border ${
        isViewingPastYear
          ? 'bg-[#FAF3DF] border-[#E7D9AE]'
          : 'bg-white border-[#E3DFD3]'
      }`}>
        <CalendarRange size={12} className={isViewingPastYear ? 'text-[#7A6220]' : 'text-[#A8A395]'} />
        <select
          value={year.id}
          onChange={e => setYearId(e.target.value)}
          aria-label="Academic session"
          className={`appearance-none bg-transparent pr-4 text-[11px] font-bold uppercase tracking-[0.06em]
                      leading-none focus:outline-none cursor-pointer ${
            isViewingPastYear ? 'text-[#7A6220]' : 'text-[#18181B]'
          }`}
        >
          {years.map(y => (
            <option key={y.id} value={y.id} className="text-[#18181B] normal-case tracking-normal">
              {y.code}{y.is_active ? ' · active' : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={11} className={`absolute right-1.5 pointer-events-none ${
          isViewingPastYear ? 'text-[#7A6220]' : 'text-[#A8A395]'}`} />
      </div>

      {isViewingPastYear && (
        <button
          onClick={resetToActive}
          title="Back to the current session"
          className="inline-flex items-center gap-1 px-1.5 py-[5px] text-[9px] font-bold uppercase
                     tracking-[0.08em] leading-none text-[#7A6220] border border-[#E7D9AE]
                     bg-[#FAF3DF] hover:bg-[#F5EBCE] transition-colors"
        >
          <RotateCcw size={10} /> <span className="hidden sm:inline">Current</span>
        </button>
      )}
    </div>
  )
}
