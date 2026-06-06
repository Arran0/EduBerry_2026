'use client'

import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'

export const CBSE_SUBJECTS: string[] = [
  'Accountancy',
  'Art Education',
  'Bengali',
  'Biology',
  'Business Studies',
  'Chemistry',
  'Computer Applications',
  'Computer Science',
  'Dance',
  'Economics',
  'Engineering Graphics',
  'English Communicative',
  'English Language & Literature',
  'Environmental Studies',
  'Fine Arts',
  'Geography',
  'Gujarati',
  'Health & Physical Education',
  'Hindi (Course A)',
  'Hindi (Course B)',
  'History',
  'Home Science',
  'Information Technology',
  'Kannada',
  'Legal Studies',
  'Malayalam',
  'Marathi',
  'Mathematics',
  'Music',
  'NCC',
  'Philosophy',
  'Physical Education',
  'Physics',
  'Political Science',
  'Psychology',
  'Punjabi',
  'Sanskrit',
  'Science',
  'Social Science',
  'Sociology',
  'Tamil',
  'Telugu',
  'Urdu',
  'Work Experience',
]

interface SubjectPickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  size?: 'sm' | 'md'
}

export default function SubjectPicker({
  value,
  onChange,
  placeholder = 'Select or type a subject…',
  className = '',
  size = 'md',
}: SubjectPickerProps) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setQuery(value) }, [value])

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(value)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [value])

  const filtered = query.trim()
    ? CBSE_SUBJECTS.filter(s => s.toLowerCase().includes(query.toLowerCase()))
    : CBSE_SUBJECTS

  const exactMatch = CBSE_SUBJECTS.some(s => s.toLowerCase() === query.trim().toLowerCase())
  const showCreate = query.trim() !== '' && !exactMatch

  function select(subject: string) {
    onChange(subject)
    setQuery(subject)
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered.length > 0 && !showCreate) {
        select(filtered[0])
      } else if (query.trim()) {
        select(query.trim())
      }
    }
    if (e.key === 'Escape') {
      setOpen(false)
      setQuery(value)
    }
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    setQuery('')
    setOpen(false)
    inputRef.current?.focus()
  }

  const sizeClass = size === 'sm' ? 'text-sm py-1.5 px-3' : 'text-sm py-2 px-3'

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className={`flex items-center gap-1 border border-slate-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-indigo-400/50 focus-within:border-indigo-400 transition-all cursor-text ${sizeClass}`}
        onClick={() => { setOpen(true); inputRef.current?.focus() }}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent focus:outline-none text-slate-700 placeholder:text-slate-400 min-w-0"
        />
        {value && (
          <button type="button" onClick={handleClear} className="p-0.5 text-slate-400 hover:text-slate-600 flex-shrink-0">
            <X size={13} />
          </button>
        )}
        <ChevronDown
          size={14}
          className={`text-slate-400 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          <div className="max-h-52 overflow-y-auto py-1">
            {showCreate && (
              <button
                type="button"
                onClick={() => select(query.trim())}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors border-b border-slate-100"
              >
                <Plus size={14} className="flex-shrink-0" />
                <span className="truncate">Create &ldquo;{query.trim()}&rdquo;</span>
              </button>
            )}
            {filtered.length === 0 && !showCreate ? (
              <p className="text-sm text-slate-400 px-3 py-2 italic">No subjects match</p>
            ) : (
              filtered.map(s => (
                <button
                  type="button"
                  key={s}
                  onClick={() => select(s)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    s === value
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {s}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
