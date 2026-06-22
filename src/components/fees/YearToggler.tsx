'use client'

import React from 'react'
import { CalendarRange } from 'lucide-react'

/**
 * Compact academic-year selector for the Fee Manager header. Scopes every
 * fetch / summary / statement on the page to the chosen 'YYYY-YY' year.
 */
interface Props {
  years: string[]
  value: string
  onChange: (year: string) => void
  /** 'dark' for the admin zinc header, 'light' for the student banner. */
  tone?: 'dark' | 'light'
}

export default function YearToggler({ years, value, onChange, tone = 'dark' }: Props) {
  // Always offer the current selection even if it isn't in the fetched list yet.
  const options = years.includes(value) ? years : [value, ...years]

  const wrap =
    tone === 'dark'
      ? 'bg-white border-[#E4E4E7] text-[#27272A]'
      : 'bg-white/15 border-white/25 text-white backdrop-blur-sm'
  const icon = tone === 'dark' ? 'text-[#A8896B]' : 'text-white/80'

  return (
    <label
      className={`inline-flex items-center gap-1.5 rounded-lg border pl-2.5 pr-1.5 py-1.5 text-xs font-semibold shadow-sm cursor-pointer ${wrap}`}
      title="Academic year"
    >
      <CalendarRange size={14} className={icon} />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-transparent focus:outline-none cursor-pointer pr-1 appearance-none font-semibold"
      >
        {options.map(y => (
          <option key={y} value={y} className="text-[#27272A]">
            {y}
          </option>
        ))}
      </select>
    </label>
  )
}
