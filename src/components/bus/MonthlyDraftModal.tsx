'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { X, AlertCircle, FileText, Search, Check, Users, Download } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import {
  BusTrip, BusFeeHead, BusFeeDraft,
  BusFeeDraftInput,
  createBusFeeDraft, updateBusFeeDraft, deleteBusFeeDraft,
  fetchDraftPassengers, setDraftPassengers,
  fetchTripPassengers,
} from '@/lib/bus'

interface MonthlyDraftModalProps {
  draft?: BusFeeDraft | null
  trips: BusTrip[]
  feeHeads: BusFeeHead[]
  assignable: UserProfile[]
  onClose: () => void
  onSaved: () => void
}

export default function MonthlyDraftModal({
  draft, trips, feeHeads, assignable, onClose, onSaved,
}: MonthlyDraftModalProps) {
  const isEdit = !!draft

  const currentMonth = new Date().toISOString().slice(0, 7)

  const [title, setTitle] = useState(draft?.title ?? '')
  const [month, setMonth] = useState(draft?.month ?? currentMonth)
  const [tripId, setTripId] = useState(draft?.trip_id ?? '')
  const [feeHeadId, setFeeHeadId] = useState(draft?.fee_head_id ?? '')
  const [amount, setAmount] = useState(draft ? String(draft.amount) : '')
  const [description, setDescription] = useState(draft?.description ?? '')
  const [dueDate, setDueDate] = useState(draft?.due_date ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tripPassengers, setTripPassengers] = useState<UserProfile[] | null>(null)
  const [loadingTripP, setLoadingTripP] = useState(false)

  const activeHeads = useMemo(() => feeHeads.filter(h => h.active), [feeHeads])

  // Load existing passengers when editing.
  useEffect(() => {
    if (!draft) return
    fetchDraftPassengers(draft.id).then(passengers => {
      setSelected(new Set(passengers.map(p => p.id)))
    })
  }, [draft])

  // Refresh trip passenger list when trip selection changes.
  useEffect(() => {
    let active = true
    if (!tripId) { setTripPassengers(null); return }
    setLoadingTripP(true)
    fetchTripPassengers(tripId).then(p => {
      if (active) { setTripPassengers(p); setLoadingTripP(false) }
    })
    return () => { active = false }
  }, [tripId])

  const pickHead = (id: string) => {
    setFeeHeadId(id)
    const head = feeHeads.find(h => h.id === id)
    if (head) {
      setAmount(String(head.default_amount))
      if (!description.trim()) setDescription(head.name)
    }
  }

  const importFromTrip = () => {
    if (!tripPassengers) return
    setSelected(new Set(tripPassengers.map(p => p.id)))
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return assignable
    return assignable.filter(p =>
      p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
    )
  }, [assignable, query])

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const submit = async () => {
    if (!title.trim()) { setError('Enter a title for this draft'); return }
    if (!month) { setError('Select a month'); return }
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    if (selected.size === 0) { setError('Add at least one student to the draft'); return }

    setSaving(true); setError(null)

    const input: BusFeeDraftInput = {
      title: title.trim(),
      month,
      trip_id: tripId || null,
      fee_head_id: feeHeadId || null,
      amount: amt,
      description: description.trim() || null,
      due_date: dueDate || null,
    }

    let draftId = draft?.id
    let createdNew = false

    if (isEdit && draftId) {
      const res = await updateBusFeeDraft(draftId, input)
      if (!res.success) { setSaving(false); setError(res.error ?? 'Failed to update draft'); return }
    } else {
      const res = await createBusFeeDraft(input)
      if (!res.success || !res.id) { setSaving(false); setError(res.error ?? 'Failed to create draft'); return }
      draftId = res.id
      createdNew = true
    }

    const passRes = await setDraftPassengers(draftId!, [...selected])
    if (!passRes.success) {
      if (createdNew) await deleteBusFeeDraft(draftId!)
      setSaving(false)
      setError(passRes.error ?? 'Failed to save student list')
      return
    }

    setSaving(false)
    onSaved()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#27272A] rounded-lg">
              <FileText size={16} className="text-[#B8983C]" />
            </div>
            <h2 className="font-bold text-slate-800">
              {isEdit ? 'Edit Monthly Draft' : 'New Monthly Draft'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">

          {/* Title */}
          <Field label="Draft title *">
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. June 2025 Bus Fee – Route A" className={inputCls} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Month *">
              <input type="month" value={month} onChange={e => setMonth(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Due date">
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
            </Field>
          </div>

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
              <input type="number" min="0" step="0.01" value={amount}
                onChange={e => setAmount(e.target.value)} placeholder="0.00" className={inputCls} />
            </Field>
            <Field label="Link to trip">
              <select value={tripId} onChange={e => setTripId(e.target.value)} className={inputCls}>
                <option value="">None</option>
                {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Description">
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Monthly bus fee for June 2025" className={inputCls} />
          </Field>

          {/* Import from trip banner */}
          {tripId && (
            <div className="flex items-center gap-2 p-3 bg-[#F4F4F5] rounded-xl border border-[#E4E4E7]">
              <Users size={14} className="text-[#71717A] flex-shrink-0" />
              <span className="text-xs text-[#71717A] flex-1">
                {loadingTripP ? 'Loading trip passengers…'
                  : tripPassengers
                    ? `${tripPassengers.length} student${tripPassengers.length === 1 ? '' : 's'} in this trip`
                    : ''}
              </span>
              <button
                type="button" onClick={importFromTrip}
                disabled={!tripPassengers || loadingTripP}
                className="flex items-center gap-1 text-xs font-semibold text-[#27272A] bg-white border border-[#E4E4E7] hover:bg-[#F4F4F5] px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <Download size={12} /> Import students
              </button>
            </div>
          )}

          {/* Passenger selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Students · {selected.size} selected
              </label>
              <button
                type="button"
                onClick={() => setSelected(new Set(filtered.map(p => p.id)))}
                className="text-xs text-[#27272A] font-medium hover:underline"
              >
                Select all shown
              </button>
            </div>
            <div className="relative mb-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search students…"
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/40 bg-white" />
              {query && (
                <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="max-h-44 overflow-y-auto space-y-1.5 pr-0.5 border border-slate-100 rounded-xl p-2">
              {filtered.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No students found.</p>
              ) : filtered.map(p => {
                const on = selected.has(p.id)
                return (
                  <button key={p.id} type="button" onClick={() => toggle(p.id)}
                    className={`w-full flex items-center gap-2.5 rounded-lg p-2 border text-left transition-colors ${
                      on ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={30} userId={p.id} />
                    <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 truncate">{p.full_name}</span>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                      on ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-transparent'
                    }`}>
                      <Check size={12} />
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 btn-secondary text-sm">Cancel</button>
            <button onClick={submit} disabled={saving}
              className="flex-1 btn-primary text-sm disabled:opacity-50">
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create draft'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/40 bg-white'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}
