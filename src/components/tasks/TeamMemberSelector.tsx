'use client'

import React, { useState, useRef, useEffect } from 'react'
import { UserProfile } from '@/lib/supabase'
import { ChevronDown, Eye, User } from 'lucide-react'

interface TeamMemberSelectorProps {
  members: UserProfile[]
  selectedUserId: string
  currentUserId: string
  currentUserName: string
  onSelect: (userId: string) => void
}

export default function TeamMemberSelector({
  members,
  selectedUserId,
  currentUserId,
  currentUserName,
  onSelect,
}: TeamMemberSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isViewingSelf = selectedUserId === currentUserId
  const selectedMember = members.find(m => m.id === selectedUserId)
  const displayName = isViewingSelf
    ? (currentUserName || 'My Space')
    : (selectedMember?.full_name || 'Unknown')

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 pl-2.5 pr-3 py-2 rounded-xl border transition-all shadow-sm text-sm font-medium ${
          isViewingSelf
            ? 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
            : 'bg-indigo-500 border-indigo-500 text-white hover:bg-indigo-600'
        }`}
      >
        <span className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
          isViewingSelf ? 'bg-slate-100 text-slate-500' : 'bg-white/20 text-white'
        }`}>
          {isViewingSelf ? <User size={12} /> : <Eye size={12} />}
        </span>
        <span className="flex flex-col items-start leading-none gap-0.5">
          <span className={`text-[9px] font-normal ${isViewingSelf ? 'text-slate-400' : 'text-white/70'}`}>
            {isViewingSelf ? 'My Tasks' : 'Viewing'}
          </span>
          <span className="text-xs font-semibold">{displayName}</span>
        </span>
        <ChevronDown size={12} className={`ml-0.5 transition-transform opacity-60 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-white rounded-2xl shadow-xl border border-slate-100 py-1.5 min-w-[180px]">
          <button
            type="button"
            onClick={() => { onSelect(currentUserId); setOpen(false) }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${
              isViewingSelf ? 'text-indigo-600 font-semibold' : 'text-slate-700'
            }`}
          >
            <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
              <User size={11} className="text-slate-500" />
            </span>
            <span className="truncate">{currentUserName || 'My Task Space'}</span>
            {isViewingSelf && <span className="ml-auto text-[9px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-medium">You</span>}
          </button>
          {members.length > 0 && (
            <>
              <div className="mx-3 my-1 border-t border-slate-100" />
              {members.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onSelect(m.id); setOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${
                    selectedUserId === m.id ? 'text-indigo-600 font-semibold' : 'text-slate-700'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-indigo-600">
                    {(m.full_name || '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate">{m.full_name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
