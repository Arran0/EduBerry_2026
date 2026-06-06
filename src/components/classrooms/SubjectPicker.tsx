'use client'

import React, { useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronDown, Plus, X } from 'lucide-react'

// Standard CBSE subject list (covers all streams + common electives)
export const CBSE_SUBJECTS: string[] = [
  // Languages
  'English',
  'Hindi',
  'Sanskrit',
  'Urdu',
  'Bengali',
  'Tamil',
  'Telugu',
  'Malayalam',
  'Kannada',
  'Gujarati',
  'Marathi',
  'Punjabi',
  'Odia',
  // Core
  'Mathematics',
  'Science',
  'Environmental Studies',
  // Science stream
  'Physics',
  'Chemistry',
  'Biology',
  'Computer Science',
  'Information Technology',
  'Biotechnology',
  // Social studies
  'Social Studies',
  'History',
  'Geography',
  'Political Science',
  'Economics',
  'Sociology',
  'Psychology',
  // Commerce
  'Business Studies',
  'Accountancy',
  // Arts / Vocational
  'Physical Education',
  'Fine Arts',
  'Music',
  'Home Science',
  'Legal Studies',
  'Entrepreneurship',
  'Media Studies',
  'Agriculture',
  'Engineering Graphics',
  'Applied Mathematics',
]

interface SubjectPickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export default function SubjectPicker({
  value,
  onChange,
  placeholder = 'Select or type a subject…',
  className = '',
}: SubjectPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? CBSE_SUBJECTS.filter(s => s.toLowerCase().includes(query.toLowerCase()))
    : CBSE_SUBJECTS

  const isCustom =
    query.trim() &&
    !CBSE_SUBJECTS.some(s => s.toLowerCase() === query.trim().toLowerCase())

  useEffect(() => {
    if (open) {
      setQuery(value || '')
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open, value])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const select = (subject: string) => {
    onChange(subject)
    setOpen(false)
    setQuery('')
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-colors text-left"
      >
        <BookOpen size={14} className="text-slate-400 flex-shrink-0" />
        <span className={`flex-1 truncate ${value ? 'text-slate-800' : 'text-slate-400'}`}>
          {value || placeholder}
        </span>
        {value ? (
          <button
            type="button"
            onClick={clear}
            className="text-slate-300 hover:text-slate-500 flex-shrink-0"
          >
            <X size={13} />
          </button>
        ) : (
          <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-slate-100">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && query.trim()) {
                  select(query.trim())
                } else if (e.key === 'Escape') {
                  setOpen(false)
                }
              }}
              placeholder="Type to search or create…"
              className="w-full text-sm px-2 py-1.5 focus:outline-none text-slate-700 placeholder:text-slate-400"
            />
          </div>

          <div className="max-h-52 overflow-y-auto">
            {/* Create custom option */}
            {isCustom && (
              <button
                type="button"
                onClick={() => select(query.trim())}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-purple-700 hover:bg-purple-50 transition-colors text-left border-b border-slate-100"
              >
                <Plus size={13} className="flex-shrink-0" />
                <span>Create &ldquo;<strong>{query.trim()}</strong>&rdquo;</span>
              </button>
            )}

            {filtered.length > 0 ? (
              filtered.map(subject => (
                <button
                  key={subject}
                  type="button"
                  onClick={() => select(subject)}
                  className={`w-full px-3 py-2 text-sm text-left hover:bg-slate-50 transition-colors ${
                    value === subject ? 'text-purple-700 font-semibold bg-purple-50/60' : 'text-slate-700'
                  }`}
                >
                  {subject}
                </button>
              ))
            ) : (
              <p className="px-3 py-4 text-xs text-slate-400 text-center">
                No matches — press Enter to create &ldquo;{query.trim()}&rdquo;
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
