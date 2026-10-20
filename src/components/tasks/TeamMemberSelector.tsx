'use client'

import React, { useState, useRef, useEffect } from 'react'
import { UserProfile } from '@/lib/supabase'
import { ChevronDown, Eye, User, Search, X } from 'lucide-react'

interface TeamMemberSelectorProps {
  members: UserProfile[]
  selectedUserId: string
  currentUserId: string
  currentUserName: string
  onSelect: (userId: string) => void
  /** Label shown on the collapsed button when viewing self (defaults to "You"). */
  selfLabel?: string
}

export default function TeamMemberSelector({
  members,
  selectedUserId,
  currentUserId,
  currentUserName,
  onSelect,
  selfLabel,
}: TeamMemberSelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isViewingSelf = selectedUserId === currentUserId
  const selectedMember = members.find(m => m.id === selectedUserId)
  const displayName = isViewingSelf
    ? (currentUserName || 'You')
    : (selectedMember?.full_name || 'Unknown')

  const filtered = query.trim()
    ? members.filter(m => m.full_name?.toLowerCase().includes(query.toLowerCase()))
    : members

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  function handleSelect(userId: string) {
    onSelect(userId)
    setOpen(false)
    setQuery('')
  }

  return (
    // Positioned only from sm up: on a phone the menu hangs from the toolbar
    // instead of this button, so it can't run off either edge.
    <div ref={ref} className="sm:relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={isViewingSelf ? 'Showing your tasks' : `Showing ${displayName}'s tasks`}
        className={`tk-btn !px-3 max-w-[11rem] sm:max-w-[15rem] min-h-9 !h-auto py-1 !whitespace-normal text-left leading-tight ${
          isViewingSelf ? 'tk-btn-soft' : 'text-white bg-gradient-to-br from-amber-500 to-orange-500 shadow-[0_6px_14px_-8px_rgba(234,88,12,.8)]'
        }`}
      >
        {isViewingSelf ? <User size={14} className="flex-shrink-0 text-amber-600" /> : <Eye size={14} className="flex-shrink-0" />}
        <span className="min-w-0 break-words">
          {isViewingSelf ? (selfLabel || 'You') : displayName}
        </span>
        <ChevronDown size={11} className={`flex-shrink-0 transition-transform opacity-50 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-2 sm:right-0 top-full mt-1.5 z-50 tk-card w-[min(16rem,calc(100vw-1rem))] overflow-hidden">
          {/* Search box */}
          <div className="px-2 pt-2 pb-1">
            <div className="flex items-center gap-1.5 px-2.5 h-9 bg-white rounded-[12px] border border-amber-900/[0.14] focus-within:border-amber-400 focus-within:ring-[3px] focus-within:ring-amber-400/15 transition">
              <Search size={12} className="text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by name..."
                className="flex-1 text-[13px] bg-transparent focus:outline-none text-slate-700 placeholder-slate-400 min-w-0"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="text-slate-300 hover:text-slate-500">
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          <div className="py-1 max-h-56 overflow-y-auto">
            {/* My Tasks option — hidden when searching */}
            {!query && (
              <button
                type="button"
                onClick={() => handleSelect(currentUserId)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left hover:bg-amber-50/70 transition-colors ${
                  isViewingSelf ? 'text-amber-800 font-semibold bg-amber-50/60' : 'text-slate-700'
                }`}
              >
                <span className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <User size={11} className="text-amber-700" />
                </span>
                <span className="min-w-0 break-words">{currentUserName || 'You'}</span>
                {isViewingSelf && (
                  <span className="ml-auto text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0">You</span>
                )}
              </button>
            )}

            {!query && members.length > 0 && (
              <div className="mx-3 my-1 border-t border-amber-900/[0.07]" />
            )}

            {filtered.length === 0 && query ? (
              <p className="px-3 py-3 text-xs text-slate-400 text-center">No match for &quot;{query}&quot;</p>
            ) : (
              filtered.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelect(m.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left hover:bg-amber-50/70 transition-colors ${
                    selectedUserId === m.id ? 'text-amber-800 font-semibold bg-amber-50/60' : 'text-slate-700'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-amber-800">
                    {(m.full_name || '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 break-words">{m.full_name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
