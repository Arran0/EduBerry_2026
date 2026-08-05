'use client'

import React from 'react'
import { Search, X } from 'lucide-react'

/** Name filter shared by the staff/driver sheets, so every list narrows the same way. */
export default function PersonSearch({ value, onChange, placeholder = 'Search…' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative mb-3 max-w-xs">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-[#E4E4E7] rounded-lg pl-8 pr-8 py-2 text-xs text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[#A1A1AA] hover:text-[#27272A] transition-colors"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
