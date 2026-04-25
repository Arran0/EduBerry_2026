'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bookmark, Plus, Search, X } from 'lucide-react'
import {
  DEFAULT_REPORT_CARD_TITLES,
  fetchAllReportCardTitles,
  createReportCardTitle,
} from '@/lib/classrooms'

interface ReportCardTitlePickerProps {
  value: string | null
  onChange: (value: string | null) => void
  userId: string
  allowStaffCreate?: boolean
  placeholder?: string
  className?: string
}

/** Smart search input + dropdown for choosing a report card title. Users can
 *  type to filter; if the typed text doesn't match any existing title an
 *  "Add new tag …" option appears. Selecting a value writes back via
 *  onChange; clearing the input writes null. */
export default function ReportCardTitlePicker({
  value,
  onChange,
  userId,
  allowStaffCreate = true,
  placeholder = 'Search or create report card tag…',
  className,
}: ReportCardTitlePickerProps) {
  const [titles, setTitles] = useState<string[]>([...DEFAULT_REPORT_CARD_TITLES])
  const [query, setQuery] = useState(value ?? '')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pos, setPos] = useState<React.CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchAllReportCardTitles().then(setTitles)
  }, [])

  // Keep input in sync when parent changes value externally.
  useEffect(() => {
    setQuery(value ?? '')
  }, [value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return titles
    return titles.filter(t => t.toLowerCase().includes(q))
  }, [titles, query])

  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return titles.some(t => t.toLowerCase() === q)
  }, [titles, query])

  const reposition = () => {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    setPos({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    })
  }

  useEffect(() => {
    if (!open) return
    reposition()
    const onScroll = () => reposition()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (title: string) => {
    setQuery(title)
    onChange(title)
    setOpen(false)
  }

  const handleCreate = async () => {
    const trimmed = query.trim()
    if (!trimmed || creating) return
    setCreating(true)
    const ok = await createReportCardTitle(trimmed, userId)
    if (ok) {
      setTitles(prev => prev.includes(trimmed) ? prev : [...prev, trimmed])
      onChange(trimmed)
      setOpen(false)
    }
    setCreating(false)
  }

  const dropdown = open ? (
    <div
      ref={dropdownRef}
      style={pos}
      className="bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-64 overflow-y-auto"
    >
      {filtered.length === 0 && !query.trim() && (
        <p className="px-3 py-2 text-xs text-slate-400">No tags yet.</p>
      )}
      {filtered.map(t => (
        <button
          key={t}
          type="button"
          onMouseDown={() => handleSelect(t)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
            value === t
              ? 'bg-indigo-50 text-indigo-700'
              : 'hover:bg-slate-50 text-slate-700'
          }`}
        >
          <Bookmark size={12} className="flex-shrink-0 opacity-60" />
          <span className="truncate">{t}</span>
        </button>
      ))}
      {!exactMatch && query.trim() && allowStaffCreate && (
        <button
          type="button"
          onMouseDown={handleCreate}
          disabled={creating}
          className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-emerald-700 bg-emerald-50/60 hover:bg-emerald-100/80 transition-colors border-t border-slate-100 disabled:opacity-60"
        >
          <Plus size={12} />
          <span>{creating ? 'Adding…' : `Add new tag “${query.trim()}”`}</span>
        </button>
      )}
    </div>
  ) : null

  return (
    <div className="relative">
      <div
        className={
          className ??
          'flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-indigo-400/50 bg-white'
        }
      >
        <Search size={13} className="text-slate-400 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            // If user clears the input completely, propagate null up immediately.
            if (e.target.value.trim() === '') onChange(null)
          }}
          onFocus={() => { setOpen(true); reposition() }}
          placeholder={placeholder}
          className="flex-1 bg-transparent focus:outline-none text-slate-700 placeholder:text-slate-400"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); onChange(null); setOpen(true); inputRef.current?.focus() }}
            className="text-slate-300 hover:text-slate-500 flex-shrink-0"
            title="Clear"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {typeof document !== 'undefined' && dropdown
        ? createPortal(dropdown, document.body)
        : null}
    </div>
  )
}
