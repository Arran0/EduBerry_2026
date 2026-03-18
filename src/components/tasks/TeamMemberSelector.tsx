'use client'

import React from 'react'
import { UserProfile } from '@/lib/supabase'
import { ChevronDown, Eye } from 'lucide-react'

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
  onSelect,
}: TeamMemberSelectorProps) {
  const isViewingSelf = selectedUserId === currentUserId

  return (
    <div className={`relative inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-xl border transition-all shadow-sm ${
      isViewingSelf
        ? 'bg-white border-slate-200 text-slate-600'
        : 'bg-mps-blue-500 border-mps-blue-500 text-white'
    }`}>
      <Eye size={12} className={isViewingSelf ? 'text-slate-400' : 'text-white/80'} />
      <span className={`text-[11px] font-medium whitespace-nowrap ${isViewingSelf ? 'text-slate-500' : 'text-white/80'}`}>
        {isViewingSelf ? 'My space' : 'Viewing'}
      </span>
      <div className="relative flex items-center">
        <select
          value={selectedUserId}
          onChange={e => onSelect(e.target.value)}
          className={`appearance-none text-xs font-semibold bg-transparent focus:outline-none cursor-pointer pr-4 ${
            isViewingSelf ? 'text-slate-700' : 'text-white'
          }`}
        >
          <option value={currentUserId}>My Task Space</option>
          {members.map(m => (
            <option key={m.id} value={m.id}>
              {m.full_name}
            </option>
          ))}
        </select>
        <ChevronDown size={10} className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
      </div>
    </div>
  )
}
