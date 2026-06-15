'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Search, X, Home, Check } from 'lucide-react'
import { Homeroom, fetchAllHomerooms } from '@/lib/homerooms'

// A smart homeroom picker that loads the full list ONCE and filters in-memory.
// No per-keystroke network calls → no debounce, no stutter.

interface Props {
  selected: Homeroom | null
  onSelect: (hr: Homeroom | null) => void
  placeholder?: string
  className?: string
}

// Mirrors searchHomerooms() but runs locally for instant feedback.
function matchHomeroom(hr: Homeroom, raw: string): boolean {
  const q = raw.trim().toLowerCase()
  if (!q) return true

  const gradeSec = q.match(/^(?:grade\s*)?(\d{1,2})\s*([a-f]?)$/)
  if (gradeSec) {
    const grade = parseInt(gradeSec[1], 10)
    const section = gradeSec[2].toUpperCase()
    if (hr.grade !== grade) return false
    if (section && (hr.section ?? '').toUpperCase() !== section) return false
    return true
  }

  const haystack = [
    hr.name,
    hr.grade ? `grade ${hr.grade}` : '',
    hr.section ? `section ${hr.section}` : '',
    hr.academic_year ?? '',
  ].join(' ').toLowerCase()
  return haystack.includes(q)
}

export default function HomeroomSearchField({ selected, onSelect, placeholder = 'Filter by homeroom…', className = '' }: Props) {
  const [all, setAll] = useState<Homeroom[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchAllHomerooms().then(data => {
      if (!cancelled) { setAll(data); setLoaded(true) }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const results = useMemo(() => {
    if (selected) return []
    return all.filter(hr => matchHomeroom(hr, query)).slice(0, 50)
  }, [all, query, selected])

  useEffect(() => { setActive(0) }, [query])

  const choose = (hr: Homeroom) => {
    onSelect(hr)
    setQuery('')
    setOpen(false)
  }

  const clear = () => {
    onSelect(null)
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (selected) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) choose(results[active]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <div className={`flex items-center gap-2 h-10 px-3 rounded-lg border bg-white transition-colors ${
        selected ? 'border-violet-400 bg-violet-50/60' : 'border-slate-300 focus-within:border-violet-400'
      }`}>
        <Search size={15} className={selected ? 'text-violet-500' : 'text-slate-400'} />
        <input
          ref={inputRef}
          type="text"
          value={selected ? selected.name : query}
          readOnly={!!selected}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { if (!selected) setOpen(true) }}
          onKeyDown={onKeyDown}
          placeholder={loaded ? placeholder : 'Loading homerooms…'}
          className={`flex-1 min-w-0 text-sm bg-transparent focus:outline-none placeholder:text-slate-400 ${
            selected ? 'text-violet-700 font-medium cursor-default' : 'text-slate-700'
          }`}
        />
        {(selected || query) && (
          <button onClick={clear} className="text-slate-400 hover:text-slate-600 flex-shrink-0" aria-label="Clear homeroom filter">
            <X size={15} />
          </button>
        )}
      </div>

      {open && !selected && (
        <div className="absolute z-30 top-full mt-1.5 w-full bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); clear(); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left transition-colors"
            >
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                <Home size={13} className="text-slate-500" />
              </div>
              <span className="text-sm font-medium text-slate-700">Whole school</span>
              {!selected && <Check size={14} className="ml-auto text-violet-500" />}
            </button>

            {results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-400">No matching homerooms</p>
            ) : results.map((hr, i) => (
              <button
                key={hr.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); choose(hr) }}
                onMouseEnter={() => setActive(i)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  i === active ? 'bg-violet-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <Home size={13} className="text-violet-600" />
                </div>
                <div className="min-w-0">
                  <span className="block text-sm text-slate-800 font-medium truncate">{hr.name}</span>
                  {(hr.grade || hr.section || hr.academic_year) && (
                    <span className="block text-[11px] text-slate-400 truncate">
                      {hr.grade ? `Grade ${hr.grade}` : ''}{hr.grade && hr.section ? ' · ' : ''}{hr.section ? `Sec ${hr.section}` : ''}
                      {hr.academic_year ? `${hr.grade || hr.section ? ' · ' : ''}AY ${hr.academic_year}` : ''}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
