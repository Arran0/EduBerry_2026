'use client'

import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Academic-year selector for the Fee Manager banner. A dropdown flanked by
 * prev/next buttons that step through the available 'YYYY-YY' years. Scopes
 * every fetch / summary / statement on the page to the chosen year.
 */
interface Props {
  years: string[]
  value: string
  onChange: (year: string) => void
  /** 'dark' for a light surface, 'light' for the coloured banner. */
  tone?: 'dark' | 'light'
}

export default function YearToggler({ years, value, onChange, tone = 'dark' }: Props) {
  // Always offer the current selection, newest first.
  const options = (years.includes(value) ? years : [value, ...years]).slice().sort((a, b) => b.localeCompare(a))
  const idx = options.indexOf(value)
  const newer = idx > 0 ? options[idx - 1] : null            // sorted desc → newer is lower index
  const older = idx < options.length - 1 ? options[idx + 1] : null

  const onLight = tone === 'light'
  const shell = onLight
    ? 'bg-white/15 border-white/25 text-white backdrop-blur-sm'
    : 'bg-white border-[#E3DFD3] text-[#18181B]'
  const btn = onLight
    ? 'text-white/80 hover:text-white hover:bg-white/15 disabled:opacity-30'
    : 'text-[#A8896B] hover:text-[#18181B] hover:bg-[#F4F2EC] disabled:opacity-30'

  return (
    <div className={`inline-flex items-center border shadow-sm overflow-hidden ${shell}`}>
      <button
        type="button"
        aria-label="Previous year"
        disabled={!older}
        onClick={() => older && onChange(older)}
        className={`px-1.5 py-2 transition-colors disabled:cursor-not-allowed ${btn}`}
      >
        <ChevronLeft size={15} />
      </button>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="bg-transparent focus:outline-none cursor-pointer text-xs font-bold tracking-wide appearance-none text-center px-1.5 py-2"
        >
          {options.map(y => (
            <option key={y} value={y} className="text-[#18181B]">{y}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        aria-label="Next year"
        disabled={!newer}
        onClick={() => newer && onChange(newer)}
        className={`px-1.5 py-2 transition-colors disabled:cursor-not-allowed ${btn}`}
      >
        <ChevronRight size={15} />
      </button>
    </div>
  )
}
