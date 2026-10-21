'use client'

import React, { useMemo, useRef, useState } from 'react'
import { Plus, Search, UserPlus } from 'lucide-react'
import { UserProfile } from '@/lib/supabase'

/**
 * Adds individual teachers to an override group, alongside (or instead of)
 * whole teams: a search field, and the matching people not already in the
 * group. Picking one adds them; the field stays open so several can be added
 * in a row.
 */
export default function StaffAdder({ allStaff, selectedIds, onAdd }: {
  allStaff: UserProfile[]
  selectedIds: Set<string>
  onAdd: (staffId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allStaff
      .filter(s => !selectedIds.has(s.id) && !s.attendance_hidden)
      .filter(s => !q || s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .slice(0, 8)
  }, [allStaff, selectedIds, query])

  return (
    <div className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          // Let a click on a result land before the list closes.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Add individual teachers — search by name or email"
          aria-label="Add individual teachers"
          className="w-full rounded-lg border border-[#D4D4D8] bg-white pl-8 pr-3 py-2 text-sm text-[#18181B] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] focus:ring-1 focus:ring-[#B8983C]/40 transition-colors"
        />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-[#D4D4D8] shadow-[0_14px_30px_-12px_rgba(24,24,27,.45)] max-h-56 overflow-y-auto">
          {matches.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-[#71717A]">
              {query.trim() ? 'No one else matches.' : 'Everyone is already in this group.'}
            </p>
          ) : matches.map(s => (
            <button
              key={s.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onAdd(s.id); setQuery(''); inputRef.current?.focus() }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#F5F5F5] transition-colors border-b border-[#F5F5F5] last:border-b-0"
            >
              <UserPlus size={13} className="text-[#B8983C] flex-shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[#18181B] truncate">{s.full_name}</span>
                <span className="block text-[11px] text-[#71717A] truncate"><span className="capitalize">{s.role}</span> · {s.email}</span>
              </span>
              <Plus size={13} className="text-[#A1A1AA] flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
