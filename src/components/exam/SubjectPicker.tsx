'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { CBSE_SUBJECTS, searchSubjects } from '@/lib/cbseSubjects'

const field =
  'w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200'

/**
 * Subject combobox with smart search over the official CBSE subject list.
 * The teacher can pick a suggestion or type any custom subject name — the
 * typed text is always the value, suggestions are just a convenience.
 */
export default function SubjectPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close the dropdown when clicking outside.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const matches = searchSubjects(value)
  const trimmed = value.trim()
  const isCustom =
    trimmed.length > 0 &&
    !CBSE_SUBJECTS.some(s => s.toLowerCase() === trimmed.toLowerCase())

  const pick = (s: string) => {
    onChange(s)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        className={field}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search CBSE subjects or type your own"
      />

      {open && (matches.length > 0 || isCustom) && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {matches.map(s => {
            const selected = s.toLowerCase() === trimmed.toLowerCase()
            return (
              <button
                key={s}
                type="button"
                onClick={() => pick(s)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left text-slate-700 hover:bg-amber-50"
              >
                <span className="truncate">{s}</span>
                {selected && <Check size={14} className="text-amber-600 shrink-0" />}
              </button>
            )
          })}
          {isCustom && (
            <div className="px-3 py-2 text-xs text-slate-400 border-t border-slate-100">
              Using custom subject “{trimmed}”
            </div>
          )}
        </div>
      )}
    </div>
  )
}
