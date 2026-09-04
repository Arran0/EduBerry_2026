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

export default function YearScope({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { years, year, isViewingPastYear, setYearId, resetToActive } = useAcademicYear()
  if (years.length === 0 || !year) return null

  const dark = tone === 'dark'

  return (
    <div className="flex items-center gap-2">
      <div className={`relative inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 rounded-lg border ${
        isViewingPastYear
          ? 'bg-[#FBF6E9] border-[#EFE3C4]'
          : dark ? 'bg-[#3F3F46] border-[#52525B]' : 'bg-white border-[#E4E4E7]'
      }`}>
        <CalendarRange size={13} className={
          isViewingPastYear ? 'text-[#8A6D1F]' : dark ? 'text-zinc-400' : 'text-[#A1A1AA]'} />
        <select
          value={year.id}
          onChange={e => setYearId(e.target.value)}
          aria-label="Academic session"
          className={`appearance-none bg-transparent pr-5 text-xs font-semibold focus:outline-none cursor-pointer ${
            isViewingPastYear ? 'text-[#8A6D1F]' : dark ? 'text-white' : 'text-[#27272A]'
          }`}
        >
          {years.map(y => (
            <option key={y.id} value={y.id} className="text-[#27272A]">
              {y.code}{y.is_active ? ' · active' : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={12} className={`absolute right-2 pointer-events-none ${
          isViewingPastYear ? 'text-[#8A6D1F]' : dark ? 'text-zinc-400' : 'text-[#A1A1AA]'}`} />
      </div>

      {isViewingPastYear && (
        <button
          onClick={resetToActive}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#8A6D1F] hover:underline"
        >
          <RotateCcw size={11} /> Back to the current session
        </button>
      )}
    </div>
  )
}
