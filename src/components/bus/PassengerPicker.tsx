'use client'

import React, { useState, useMemo } from 'react'
import { Search, Check, Users, AlertCircle } from 'lucide-react'
import Avatar from '@/components/Avatar'
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
        <p className="text-sm text-slate-500 flex items-center gap-1.5">
          <Users size={15} /> {selected.size} selected
        </p>
        <button onClick={save} disabled={!dirty || saving}
          className="btn-primary text-xs disabled:opacity-50">
          {saving ? 'Saving…' : 'Save passengers'}
        </button>
      </div>

      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or email…"
          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/40 bg-white" />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
          <AlertCircle size={14} className="flex-shrink-0" /> {error}
        </div>
      )}

      <div className="max-h-80 overflow-y-auto space-y-1.5 pr-0.5">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No matching people.</p>
        ) : filtered.map(p => {
          const on = selected.has(p.id)
          return (
            <button key={p.id} type="button" onClick={() => toggle(p.id)}
              className={`w-full flex items-center gap-3 rounded-xl p-2.5 border text-left transition-colors ${
                on ? 'bg-orange-50 border-orange-300' : 'bg-white border-slate-200 hover:border-slate-300'
              }`}>
              <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={34} userId={p.id} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{p.full_name}</p>
                <p className="text-[11px] text-slate-400 truncate">
                  {getRoleDisplayName(p.role)}{p.role === 'student' && p.grade ? ` · Gr.${p.grade}${p.section ? p.section : ''}` : ''}
                </p>
              </div>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                on ? 'bg-orange-500 text-white' : 'bg-slate-100 text-transparent'
              }`}>
                <Check size={14} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
