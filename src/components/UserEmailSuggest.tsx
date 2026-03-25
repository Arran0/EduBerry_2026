'use client'

import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { UserProfile, UserRole } from '@/lib/supabase'
import Avatar from '@/components/Avatar'

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
  inputType = 'text',
}: UserEmailSuggestProps) {
  const [suggestions, setSuggestions] = useState<UserProfile[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const query = value.trim()
    if (query.length < 2) {
      setSuggestions([])
      setShowDropdown(false)
      return
    }

    const timer = setTimeout(async () => {
      let q = supabase
        .from('profiles')
        .select('id, full_name, email, role, avatar_url, grade, section, created_at, updated_at')
        .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`)
        .order('full_name')
        .limit(6)

      if (roles && roles.length > 0) {
        q = q.in('role', roles)
      }

      const { data } = await q
      const results = (data || []) as UserProfile[]
      setSuggestions(results)
      setShowDropdown(results.length > 0)
    }, 200)

    return () => clearTimeout(timer)
  }, [value, roles])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (user: UserProfile) => {
    onChange(user.email)
    setShowDropdown(false)
    setSuggestions([])
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type={inputType}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
        className={className || 'input-field'}
        placeholder={placeholder}
        autoComplete="off"
      />
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {suggestions.map(user => (
            <button
              key={user.id}
              type="button"
              onMouseDown={() => handleSelect(user)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
            >
              <Avatar avatarUrl={user.avatar_url} name={user.full_name} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-700 truncate">{user.full_name}</p>
                <p className="text-xs text-slate-400 truncate">{user.email}</p>
              </div>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 capitalize flex-shrink-0">
                {user.role}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
