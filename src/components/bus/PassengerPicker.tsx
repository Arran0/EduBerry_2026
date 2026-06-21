'use client'

import React, { useState, useMemo } from 'react'
import { Search, Check, Users, AlertCircle } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN, SHEET } from '@/components/bus/adminUI'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import { setTripPassengers } from '@/lib/bus'

interface PassengerPickerProps {
  tripId: string
  assignable: UserProfile[]
  initialSelectedIds: string[]
  onSaved: () => void
}

export default function PassengerPicker({ tripId, assignable, initialSelectedIds, onSaved }: PassengerPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelectedIds))
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initial = useMemo(() => new Set(initialSelectedIds), [initialSelectedIds])
  const dirty = selected.size !== initial.size || [...selected].some(id => !initial.has(id))

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return assignable
    return assignable.filter(p =>
      p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
  }, [assignable, query])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const save = async () => {
    setSaving(true); setError(null)
    const result = await setTripPassengers(tripId, [...selected])
    setSaving(false)
    if (!result.success) { setError(result.error ?? 'Failed to save passengers'); return }
    onSaved()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-[#71717A] flex items-center gap-1.5">
          <Users size={15} /> <span className="font-semibold text-[#27272A] tabular-nums">{selected.size}</span> selected
        </p>
        <button onClick={save} disabled={!dirty || saving} className={`${ADMIN.darkBtn} disabled:opacity-50`}>
          {saving ? 'Saving…' : 'Save passengers'}
        </button>
      </div>

      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or email…"
          className={ADMIN.input} />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
          <AlertCircle size={14} className="flex-shrink-0" /> {error}
        </div>
      )}

      <div className={`${SHEET.wrap} max-h-80 overflow-y-auto`}>
        {filtered.length === 0 ? (
          <p className="text-sm text-[#A1A1AA] text-center py-8">No matching people.</p>
        ) : filtered.map(p => {
          const on = selected.has(p.id)
          return (
            <button key={p.id} type="button" onClick={() => toggle(p.id)}
              className={`w-full ${SHEET.row} text-left ${on ? 'bg-[#FBF8EF] hover:bg-[#FBF8EF]' : ''}`}>
              <div className={`${SHEET.bar} ${on ? 'bg-[#B8983C]' : 'bg-transparent'}`} />
              <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
                <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={32} userId={p.id} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#18181B] truncate">{p.full_name}</p>
                  <p className="text-[11px] text-[#A1A1AA] truncate">
                    {getRoleDisplayName(p.role)}{p.role === 'student' && p.grade ? ` · Gr.${p.grade}${p.section ? p.section : ''}` : ''}
                  </p>
                </div>
                <span className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-colors ${
                  on ? 'bg-[#27272A] text-white' : 'bg-[#F4F4F5] border border-[#E4E4E7] text-transparent'
                }`}>
                  <Check size={13} />
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
