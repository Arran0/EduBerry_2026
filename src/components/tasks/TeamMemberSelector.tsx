'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { UserProfile } from '@/lib/supabase'
import { ChevronDown, Eye, User } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { SearchField } from './ui'

interface TeamMemberSelectorProps {
  members: UserProfile[]
  selectedUserId: string
  currentUserId: string
  currentUserName: string
  onSelect: (userId: string) => void
  /** Label on the closed button when viewing your own (defaults to "You"). */
  selfLabel?: string
}

/**
 * Whose tasks are on screen. The capsule turns dark while someone else's are,
 * so it is always clear the calendar is not your own.
 */
export default function TeamMemberSelector({
  members, selectedUserId, currentUserId, currentUserName, onSelect, selfLabel,
}: TeamMemberSelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const isViewingSelf = selectedUserId === currentUserId
  const selected = members.find(m => m.id === selectedUserId)
  const label = isViewingSelf ? (selfLabel || 'You') : (selected?.full_name || 'Unknown')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? members.filter(m => m.full_name?.toLowerCase().includes(q)) : members
  }, [members, query])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery('') }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setQuery('') } }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (id: string) => { onSelect(id); setOpen(false); setQuery('') }

  return (
    // Positioned only from sm up: on a phone the menu hangs from the whole
    // toolbar instead of this button, so it can't run off either edge.
    <div ref={ref} className="sm:relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={isViewingSelf ? 'Showing your tasks' : `Showing ${label}'s tasks`}
        className={`inline-flex items-center gap-1.5 min-h-9 py-1 min-w-0 max-w-[11rem] sm:max-w-[15rem] px-3 rounded-full text-[12.5px] font-semibold text-left leading-tight transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
          isViewingSelf
            ? 'text-slate-700 bg-white border border-[#E2DDD2] shadow-[0_1px_2px_rgba(15,23,42,.05)] hover:border-[#CFC8B8]'
            : 'text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)]'}`}
      >
        {isViewingSelf ? <User size={14} className="flex-shrink-0 text-slate-500" /> : <Eye size={14} className="flex-shrink-0 text-[#E9DDBB]" />}
        <span className="min-w-0 break-words">{label}</span>
        <ChevronDown size={13} className={`flex-shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-2 sm:right-0 top-full z-40 mt-1.5 w-[min(17rem,calc(100vw-1rem))] flex flex-col max-h-[60vh] rounded-[14px] bg-white border border-black/[.07] shadow-[0_24px_60px_-20px_rgba(15,23,42,.45),0_2px_8px_rgba(15,23,42,.08)] overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <SearchField value={query} onChange={setQuery} placeholder="Search by name" />
          </div>
          <div className="overflow-y-auto overscroll-contain py-1" role="listbox">
            {!query && (
              <Option selected={isViewingSelf} onClick={() => pick(currentUserId)}>
                <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0"><User size={12} className="text-slate-500" /></span>
                <span className="flex-1 min-w-0 break-words">{currentUserName || 'You'} <span className="text-slate-400 font-normal">(you)</span></span>
              </Option>
            )}
            {!query && members.length > 0 && <div className="mx-3 my-1 border-t border-slate-100" />}
            {filtered.length === 0 && query ? (
              <p className="px-3.5 py-3 text-[12.5px] text-slate-500">No one matches that name.</p>
            ) : filtered.map(m => (
              <Option key={m.id} selected={selectedUserId === m.id} onClick={() => pick(m.id)}>
                <Avatar avatarUrl={m.avatar_url} name={m.full_name} size={24} />
                <span className="flex-1 min-w-0 break-words">{m.full_name}</span>
              </Option>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-1.5 text-left text-[13.5px] leading-snug transition-colors hover:bg-[#FAF7F0] focus-visible:bg-[#FAF7F0] focus-visible:outline-none ${
        selected ? 'font-semibold text-slate-900 bg-[#FBF6E9]' : 'text-slate-800'}`}
    >
      {children}
    </button>
  )
}
