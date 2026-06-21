'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { X, AlertCircle, IndianRupee, Check, Search } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import { BusTrip, BusFeeHead, FeeInput, createFeesBulk, fetchTripPassengers } from '@/lib/bus'

interface FeeIssueModalProps {
  trips: BusTrip[]
  assignable: UserProfile[]
  feeHeads?: BusFeeHead[]
  onClose: () => void
  onIssued: () => void
}

export default function FeeIssueModal({ trips, assignable, feeHeads = [], onClose, onIssued }: FeeIssueModalProps) {
  const [tripId, setTripId] = useState('')
  const [tripPassengers, setTripPassengers] = useState<UserProfile[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [feeHeadId, setFeeHeadId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeHeads = useMemo(() => feeHeads.filter(h => h.active), [feeHeads])

  // Picking a fee head prefills amount + description (admin can still override).
  const pickHead = (id: string) => {
    setFeeHeadId(id)
    const head = feeHeads.find(h => h.id === id)
    if (head) {
      setAmount(String(head.default_amount))
      if (!description.trim()) setDescription(head.name)
    }
  }

  // When a trip is chosen, restrict the candidate list to its passengers.
  useEffect(() => {
    let active = true
    if (!tripId) { setTripPassengers(null); setSelected(new Set()); return }
    fetchTripPassengers(tripId).then(p => { if (active) { setTripPassengers(p); setSelected(new Set()) } })
    return () => { active = false }
  }, [tripId])

  const candidates = tripPassengers ?? assignable
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter(p => p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
  }, [candidates, query])

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const selectAll = () => setSelected(new Set(filtered.map(p => p.id)))

  const submit = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    if (selected.size === 0) { setError('Select at least one passenger'); return }
    setSaving(true); setError(null)
    const inputs: FeeInput[] = [...selected].map(passenger_id => ({
      passenger_id,
      trip_id: tripId || null,
      fee_head_id: feeHeadId || null,
      amount: amt,
      description: description.trim() || null,
      due_date: dueDate || null,
    }))
    const result = await createFeesBulk(inputs)
    setSaving(false)
    if (!result.success) { setError(result.error ?? 'Failed to issue fees'); return }
    onIssued()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[78vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-shrink-0 bg-[#27272A] rounded-t-2xl px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-lg"><IndianRupee size={16} className="text-[#D8B967]" /></div>
            <h2 className="font-bold text-white">Issue Fee</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0" style={{ backgroundColor: '#FDFCF9' }}>
          {activeHeads.length > 0 && (
            <Field label="Fee head">
              <select value={feeHeadId} onChange={e => pickHead(e.target.value)} className={inputCls}>
                <option value="">— Custom (no head) —</option>
                {activeHeads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹) *">
              <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00" className={inputCls} />
            </Field>
            <Field label="Due date">
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Description">
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="e.g. June bus fee" className={inputCls} />
          </Field>

          <Field label="Scope to trip">
            <select value={tripId} onChange={e => setTripId(e.target.value)} className={inputCls}>
              <option value="">Any passenger (no trip)</option>
              {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-bold text-[#525252] uppercase tracking-widest">
                Passengers · {selected.size} selected
              </label>
              <button onClick={selectAll} className="text-xs text-[#8A6D1F] font-semibold hover:underline">Select all shown</button>
            </div>
            <div className="relative mb-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…"
                className="w-full pl-9 pr-3 py-2 border border-[#E4E4E7] rounded-lg text-sm focus:outline-none focus:border-[#27272A] transition-colors bg-white" />
            </div>
            <div className="max-h-40 overflow-y-auto border border-[#E4E4E7] rounded-lg overflow-hidden bg-white">
              {filtered.length === 0 ? (
                <p className="text-sm text-[#A1A1AA] text-center py-5">No people.</p>
              ) : filtered.map(p => {
                const on = selected.has(p.id)
                return (
                  <button key={p.id} type="button" onClick={() => toggle(p.id)}
                    className={`w-full flex items-stretch border-b border-[#F4F4F5] last:border-b-0 text-left transition-colors ${
                      on ? 'bg-[#FBF8EF]' : 'hover:bg-[#FAFAFA]'
                    }`}>
                    <div className={`w-1 flex-shrink-0 ${on ? 'bg-[#B8983C]' : 'bg-transparent'}`} />
                    <div className="flex items-center gap-2.5 flex-1 min-w-0 px-2.5 py-2">
                      <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={28} userId={p.id} />
                      <span className="flex-1 min-w-0 text-sm font-medium text-[#18181B] truncate">{p.full_name}</span>
                      <span className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${
                        on ? 'bg-[#27272A] text-white' : 'bg-[#F4F4F5] border border-[#E4E4E7] text-transparent'
                      }`}><Check size={12} /></span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm font-medium rounded-lg hover:bg-[#F4F4F5] transition-colors">
              Cancel
            </button>
            <button onClick={submit} disabled={saving || selected.size === 0}
              className="flex-1 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
              {saving ? 'Issuing…' : `Issue ${selected.size || ''} fee${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

const inputCls = 'w-full border border-[#E4E4E7] rounded-lg px-3 py-2 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors bg-white'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-[#525252] mb-1.5 block uppercase tracking-widest">{label}</label>
      {children}
    </div>
  )
}
