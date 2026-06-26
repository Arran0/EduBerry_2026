'use client'

import React, { useState, useMemo } from 'react'
import { Search, Check, Users, AlertCircle } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN, SHEET } from '@/components/bus/adminUI'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import { TripPassengerDetail, setTripPassengersDetailed } from '@/lib/bus'

interface PassengerPickerProps {
  tripId: string
  assignable: UserProfile[]
  /** Currently-assigned passengers with their per-trip fee + pickup location. */
  initialDetails: TripPassengerDetail[]
  onSaved: () => void
}

export default function PassengerPicker({ tripId, assignable, initialDetails, onSaved }: PassengerPickerProps) {
  const initialSelected = useMemo(() => new Set(initialDetails.map(d => d.passenger_id)), [initialDetails])
  const initialFee = useMemo(() => {
    const m: Record<string, string> = {}
    for (const d of initialDetails) m[d.passenger_id] = d.fee_amount != null ? String(d.fee_amount) : ''
    return m
  }, [initialDetails])
  const initialLoc = useMemo(() => {
    const m: Record<string, string> = {}
    for (const d of initialDetails) m[d.passenger_id] = d.location ?? ''
    return m
  }, [initialDetails])

  const [selected, setSelected] = useState<Set<string>>(initialSelected)
  const [feeById, setFeeById] = useState<Record<string, string>>(initialFee)
  const [locById, setLocById] = useState<Record<string, string>>(initialLoc)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A clean serialization of the current selection + values, to detect edits.
  const snapshot = (sel: Set<string>, fee: Record<string, string>, loc: Record<string, string>) =>
    [...sel].sort().map(id => `${id}:${(fee[id] ?? '').trim()}:${(loc[id] ?? '').trim()}`).join('|')
  const initialSnapshot = useMemo(() => snapshot(initialSelected, initialFee, initialLoc), [initialSelected, initialFee, initialLoc])
  const dirty = snapshot(selected, feeById, locById) !== initialSnapshot

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return assignable.filter(p => selected.has(p.id))
    return assignable.filter(p =>
      p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
  }, [assignable, query, selected])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const save = async () => {
    setSaving(true); setError(null)
    const rows = [...selected].map(passenger_id => {
      const raw = (feeById[passenger_id] ?? '').trim()
      const n = parseFloat(raw)
      return {
        passenger_id,
        fee_amount: raw !== '' && !isNaN(n) && n > 0 ? n : null,
        location: (locById[passenger_id] ?? '').trim() || null,
      }
    })
    const result = await setTripPassengersDetailed(tripId, rows)
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

      <p className="text-[11px] text-[#A1A1AA] mb-3">
        Set each passenger&apos;s monthly fee and pickup location here — a linked Bulk Issue imports them automatically.
      </p>

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

      <div className={`${SHEET.wrap} max-h-96 overflow-y-auto`}>
        {filtered.length === 0 ? (
          <p className="text-sm text-[#A1A1AA] text-center py-8">
            {query.trim() ? 'No matching people.' : 'No passengers selected. Search to add passengers.'}
          </p>
        ) : filtered.map(p => {
          const on = selected.has(p.id)
          return (
            <div key={p.id} className={`${SHEET.row} ${on ? 'bg-[#FBF8EF]' : ''}`}>
              <div className={`${SHEET.bar} ${on ? 'bg-[#B8983C]' : 'bg-transparent'}`} />
              <div className="flex-1 min-w-0 px-3 py-2.5">
                <button type="button" onClick={() => toggle(p.id)} className="flex items-center gap-3 w-full text-left min-w-0">
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
                </button>

                {on && (
                  <div className="grid grid-cols-2 gap-2 mt-2 ml-[44px]">
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#71717A] text-xs pointer-events-none select-none">₹</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={feeById[p.id] ?? ''}
                        onChange={e => setFeeById(prev => ({ ...prev, [p.id]: e.target.value }))}
                        placeholder="Monthly fee"
                        className="w-full pl-6 pr-2 py-1.5 text-sm border border-[#E4E4E7] rounded-lg text-right tabular-nums bg-white focus:outline-none focus:border-[#27272A] placeholder:text-[#D4D4D8] transition-colors"
                      />
                    </div>
                    <input
                      type="text"
                      value={locById[p.id] ?? ''}
                      onChange={e => setLocById(prev => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder="Pickup location"
                      className="w-full px-2.5 py-1.5 text-sm border border-[#E4E4E7] rounded-lg bg-white focus:outline-none focus:border-[#27272A] placeholder:text-[#D4D4D8] transition-colors"
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
