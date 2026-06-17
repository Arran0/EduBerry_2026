'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { X, AlertCircle, IndianRupee, Check, Search, Users, UserPlus, Trash2 } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import { Homeroom, homeroomGradeSectionBadge } from '@/lib/homerooms'
import { FeeHead, FeeInput, createFeesBulk, fetchStudentsForHomerooms, fetchAllStudents } from '@/lib/fees'

interface IssueFeeModalProps {
  feeHeads: FeeHead[]
  homerooms: Homeroom[]
  onClose: () => void
  onIssued: () => void
}

export default function IssueFeeModal({ feeHeads, homerooms, onClose, onIssued }: IssueFeeModalProps) {
  const [feeHeadId, setFeeHeadId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')

  // Bulk-by-homeroom: a set of selected homerooms, with their student lists cached.
  const [selectedHomerooms, setSelectedHomerooms] = useState<Set<string>>(new Set())
  const [hrStudents, setHrStudents] = useState<Record<string, UserProfile[]>>({})
  const [loadingHr, setLoadingHr] = useState(false)

  // Individually added students, and any recipients explicitly removed.
  const [extra, setExtra] = useState<Map<string, UserProfile>>(new Map())
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  // The pool used by the "add individual" picker.
  const [allStudents, setAllStudents] = useState<UserProfile[]>([])
  const [query, setQuery] = useState('')
  const [showPicker, setShowPicker] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchAllStudents().then(setAllStudents) }, [])

  // Picking a fee head prefills the (still editable) amount and a default description.
  const onPickHead = (id: string) => {
    setFeeHeadId(id)
    const head = feeHeads.find(h => h.id === id)
    if (head) {
      setAmount(String(head.default_amount))
      if (!description.trim()) setDescription(head.name)
    }
  }

  const toggleHomeroom = useCallback(async (id: string) => {
    setSelectedHomerooms(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    if (!hrStudents[id]) {
      setLoadingHr(true)
      const students = await fetchStudentsForHomerooms([id])
      setHrStudents(prev => ({ ...prev, [id]: students }))
      setLoadingHr(false)
    }
  }, [hrStudents])

  // Recipients = (∪ selected homerooms' students ∪ individually added) − excluded.
  const recipients = useMemo(() => {
    const map = new Map<string, UserProfile>()
    for (const hid of selectedHomerooms) for (const s of hrStudents[hid] ?? []) map.set(s.id, s)
    for (const [id, p] of extra) map.set(id, p)
    for (const id of excluded) map.delete(id)
    return [...map.values()].sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [selectedHomerooms, hrStudents, extra, excluded])

  const removeRecipient = (id: string) => {
    setExtra(prev => { const n = new Map(prev); n.delete(id); return n })
    setExcluded(prev => new Set(prev).add(id))
  }

  const addIndividual = (p: UserProfile) => {
    setExcluded(prev => { const n = new Set(prev); n.delete(p.id); return n })
    setExtra(prev => new Map(prev).set(p.id, p))
  }

  const pickerResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    const recipientIds = new Set(recipients.map(r => r.id))
    return allStudents
      .filter(p => !recipientIds.has(p.id))
      .filter(p => !q || p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 30)
  }, [allStudents, query, recipients])

  const submit = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    if (recipients.length === 0) { setError('Select at least one student'); return }
    setSaving(true); setError(null)
    const inputs: FeeInput[] = recipients.map(r => ({
      student_id: r.id,
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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[70vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white rounded-t-2xl border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-slate-100 rounded-lg"><IndianRupee size={16} className="text-slate-700" /></div>
            <h2 className="font-bold text-slate-800">Issue Fee</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Fee head">
            <select value={feeHeadId} onChange={e => onPickHead(e.target.value)} className={inputCls}>
              <option value="">Custom (no fee head)</option>
              {feeHeads.filter(h => h.active || h.id === feeHeadId).map(h => (
                <option key={h.id} value={h.id}>{h.name} · ₹{h.default_amount}</option>
              ))}
            </select>
          </Field>

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
              placeholder="e.g. June tuition fee" className={inputCls} />
          </Field>

          {/* Homerooms (bulk) */}
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5 uppercase tracking-wide">
              <Users size={13} /> Homerooms {loadingHr && <span className="text-slate-400 normal-case">· loading…</span>}
            </label>
            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-0.5 border border-slate-100 rounded-xl p-2">
              {homerooms.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-3">No homerooms.</p>
              ) : homerooms.map(h => {
                const on = selectedHomerooms.has(h.id)
                const badge = homeroomGradeSectionBadge(h)
                return (
                  <button key={h.id} type="button" onClick={() => toggleHomeroom(h.id)}
                    className={`w-full flex items-center gap-2.5 rounded-lg p-2 border text-left transition-colors ${
                      on ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 hover:border-slate-300 text-slate-800'
                    }`}>
                    <span className="flex-1 min-w-0 text-sm font-medium truncate">
                      {h.name}{badge ? <span className={on ? 'text-slate-300' : 'text-slate-400'}> · {badge}</span> : null}
                    </span>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                      on ? 'bg-white text-slate-800' : 'bg-slate-100 text-transparent'
                    }`}><Check size={12} /></span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Recipients */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Recipients · {recipients.length} student{recipients.length === 1 ? '' : 's'}
              </label>
              <button onClick={() => setShowPicker(s => !s)}
                className="text-xs text-slate-700 font-medium hover:underline flex items-center gap-1">
                <UserPlus size={13} /> Add individual
              </button>
            </div>

            {showPicker && (
              <div className="mb-2 border border-slate-200 rounded-xl p-2">
                <div className="relative mb-2">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search students…"
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white" />
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {pickerResults.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-3">No matching students.</p>
                  ) : pickerResults.map(p => (
                    <button key={p.id} type="button" onClick={() => addIndividual(p)}
                      className="w-full flex items-center gap-2.5 rounded-lg p-2 border border-slate-200 bg-white hover:border-slate-300 text-left transition-colors">
                      <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={28} userId={p.id} />
                      <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 truncate">{p.full_name}</span>
                      <UserPlus size={14} className="text-slate-400 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5 border border-slate-100 rounded-xl p-2">
              {recipients.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">Pick homerooms or add students.</p>
              ) : recipients.map(p => (
                <div key={p.id} className="w-full flex items-center gap-2.5 rounded-lg p-2 border border-slate-200 bg-white">
                  <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={28} userId={p.id} />
                  <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 truncate">{p.full_name}</span>
                  <button onClick={() => removeRecipient(p.id)}
                    className="p-1 text-slate-300 hover:text-rose-500 flex-shrink-0" title="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 btn-secondary text-sm">Cancel</button>
            <button onClick={submit} disabled={saving || recipients.length === 0}
              className="flex-1 text-sm font-semibold py-2 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-colors disabled:opacity-50">
              {saving ? 'Issuing…' : `Issue ${recipients.length || ''} fee${recipients.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}
