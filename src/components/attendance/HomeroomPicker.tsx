'use client'

import React, { useState, useEffect } from 'react'
import { Search, X, Clock, Home } from 'lucide-react'
import { Homeroom, searchHomerooms, homeroomGradeSectionBadge } from '@/lib/homerooms'

interface RecentEntry { id: string; name: string; grade: number | null; section: string | null }

function recentKey(staffId: string) { return `hr_recent_${staffId}` }

export function saveRecentHomeroom(staffId: string, homeroom: Homeroom) {
  if (typeof window === 'undefined') return
  const existing: RecentEntry[] = JSON.parse(localStorage.getItem(recentKey(staffId)) ?? '[]')
  const updated = [
    { id: homeroom.id, name: homeroom.name, grade: homeroom.grade, section: homeroom.section },
    ...existing.filter(r => r.id !== homeroom.id),
  ].slice(0, 8)
  localStorage.setItem(recentKey(staffId), JSON.stringify(updated))
}

interface HomeroomPickerProps {
  currentStaffId: string
  onSelect: (homeroom: Homeroom) => void
}

export default function HomeroomPicker({ currentStaffId, onSelect }: HomeroomPickerProps) {
  const [recents, setRecents] = useState<RecentEntry[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Homeroom[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setRecents(JSON.parse(localStorage.getItem(recentKey(currentStaffId)) ?? '[]'))
  }, [currentStaffId])

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); setShowDropdown(false); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const data = await searchHomerooms(query)
      setResults(data)
      setSearching(false)
      setShowDropdown(true)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const handleSelect = (homeroom: Homeroom) => {
    saveRecentHomeroom(currentStaffId, homeroom)
    setRecents(JSON.parse(localStorage.getItem(recentKey(currentStaffId)) ?? '[]'))
    setQuery('')
    setShowDropdown(false)
    onSelect(homeroom)
  }

  const badge = (entry: RecentEntry) => {
    if (entry.grade && entry.section) return `Grade ${entry.grade} • ${entry.section}`
    if (entry.grade) return `Grade ${entry.grade}`
    return null
  }

  return (
    <div className="space-y-5">
      {/* Search */}
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Open Homeroom Sheet</label>
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => query.trim() && setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            placeholder="Search by name, grade, or section (e.g. 7A)…"
            className="w-full pl-10 pr-9 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 shadow-sm transition-colors"
          />
          {query && (
            <button onClick={() => { setQuery(''); setShowDropdown(false) }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5">
              <X size={14} />
            </button>
          )}
          {showDropdown && (
            <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
              {searching ? (
                <div className="px-4 py-3 text-sm text-slate-400 text-center">Searching…</div>
              ) : results.length === 0 ? (
                <div className="px-4 py-3 text-sm text-slate-400 text-center">No homerooms found</div>
              ) : (
                <div className="max-h-52 overflow-y-auto py-1">
                  {results.map(hr => (
                    <button
                      key={hr.id}
                      onMouseDown={() => handleSelect(hr)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-violet-50 text-left transition-colors"
                    >
                      <Home size={14} className="text-slate-400 flex-shrink-0" />
                      <span className="text-sm text-slate-800 flex-1">{hr.name}</span>
                      {homeroomGradeSectionBadge(hr) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100 flex-shrink-0">
                          {homeroomGradeSectionBadge(hr)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Recently opened */}
      {recents.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2.5">
            <Clock size={12} className="text-slate-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Recently Opened</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {recents.map(r => (
              <button
                key={r.id}
                onClick={() => {
                  // Reconstruct a Homeroom object from cached data
                  const hr: Homeroom = { id: r.id, name: r.name, grade: r.grade, section: r.section, academic_year: null, expiry_date: null, created_by: null, created_at: '', updated_at: '' }
                  handleSelect(hr)
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700 transition-colors shadow-sm"
              >
                <Home size={12} className="text-slate-400" />
                <span>{r.name}</span>
                {badge(r) && (
                  <span className="text-[10px] px-1.5 rounded-full bg-slate-100 text-slate-500">{badge(r)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
