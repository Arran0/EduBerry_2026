'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { UserProfile, UserRole } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import SmartTypeahead from '@/components/SmartTypeahead'
import { profileDirectory } from '@/lib/profileColumns'

interface UserEmailSuggestProps {
  value: string
  onChange: (value: string) => void
  roles?: UserRole[]
  placeholder?: string
  className?: string
  inputType?: string
}

export default function UserEmailSuggest({
  value,
  onChange,
  roles,
  placeholder,
  className,
}: UserEmailSuggestProps) {
  const [suggestions, setSuggestions] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const query = value.trim()
    if (query.length < 2) {
      setSuggestions([])
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      let q = profileDirectory()
        .select('id, full_name, email, role, avatar_url, grade, section, created_at, updated_at')
        .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`)
        .order('full_name')
        .limit(5)

      if (roles && roles.length > 0) q = q.in('role', roles)

      const { data } = await q
      setSuggestions((data || []) as UserProfile[])
      setLoading(false)
    }, 200)
    return () => { clearTimeout(timer); setLoading(false) }
  }, [value, roles])

  return (
    <SmartTypeahead<UserProfile>
      query={value}
      onQueryChange={onChange}
      suggestions={suggestions}
      onSelect={u => { onChange(u.email); setSuggestions([]) }}
      getKey={u => u.id}
      loading={loading}
      placeholder={placeholder}
      inputRef={inputRef}
      className={className ? `flex items-center gap-2 ${className}` : undefined}
      renderSuggestion={(u, active) => (
        <div className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${active ? 'bg-[#F4F4F5]' : 'hover:bg-[#F4F4F5]'}`}>
          <Avatar avatarUrl={u.avatar_url} name={u.full_name} size={28} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#27272A] truncate">{u.full_name}</p>
            <p className="text-xs text-[#A1A1AA] truncate">{u.email}</p>
          </div>
          <span className="text-xs px-1.5 py-0.5 bg-[#F4F4F5] text-[#71717A] capitalize flex-shrink-0">
            {u.role}
          </span>
        </div>
      )}
    />
  )
}
