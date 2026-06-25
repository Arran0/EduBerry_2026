'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { X, AlertCircle, IndianRupee, Search, Users } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import { BusFeeHead, FeeInput, createFeesBulk } from '@/lib/bus'

interface FeeIssueModalProps {
  assignable: UserProfile[]
  feeHeads?: BusFeeHead[]
  onClose: () => void
  onIssued: () => void
}

export default function FeeIssueModal({ assignable, feeHeads = [], onClose, onIssued }: FeeIssueModalProps) {
  const [selected, setSelected] = useState<UserProfile[]>([])
  const [feeHeadId, setFeeHeadId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Smart-search add box (typeahead) — mirrors the Bulk Issue student picker.
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)

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

  // Close the typeahead dropdown on an outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selectedIds = useMemo(() => new Set(selected.map(p => p.id)), [selected])
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assignable
      .filter(p => !selectedIds.has(p.id))
      .filter(p => !q || p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
  }, [assignable, selectedIds, query])

  const add = (p: UserProfile) => { setSelected(prev => [...prev, p]); setQuery(''); setOpen(false) }
  const remove = (id: string) => setSelected(prev => prev.filter(p => p.id !== id))

  const submit = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    if (selected.length === 0) { setError('Add at least one passenger'); return }
    setSaving(true); setError(null)
    const inputs: FeeInput[] = selected.map(p => ({
      passenger_id: p.id,
      trip_id: null,
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[88vh] overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 sm:hidden flex-shrink-0" />
        {/* Header */}
        <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#27272A] rounded-lg">
              <IndianRupee size={16} className="text-[#B8983C]" />
            </div>
            <h2 className="font-bold text-slate-800">Issue Fee</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
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

          {/* Smart-search passenger picker */}
          <Field label={`Passengers${selected.length ? ` · ${selected.length}` : ''}`}>
            <div className="relative" ref={addRef}>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setOpen(true) }}
                onFocus={() => setOpen(true)}
                placeholder="Search to add passengers…"
                className={`${inputCls} pl-9`}
              />
              {open && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-52 overflow-y-auto">
                  {candidates.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-4">
                      {query ? 'No matches' : 'All passengers added'}
                    </p>
                  ) : (
                    <>
                      {candidates.slice(0, 20).map(p => (
                        <button key={p.id} type="button" onClick={() => add(p)}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 text-left transition-colors">
                          <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={28} userId={p.id} />
                          <span className="text-sm font-medium text-slate-700 truncate">{p.full_name}</span>
                        </button>
                      ))}
                      {candidates.length > 20 && (
                        <p className="text-xs text-slate-400 text-center py-2 border-t border-slate-100">
                          +{candidates.length - 20} more · refine search
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {selected.length === 0 ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-400 px-1">
                <Users size={13} /> No passengers added yet.
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selected.map(p => (
                  <span key={p.id} className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-1 bg-[#F4F2EC] border border-[#E7E2D8] rounded-full">
                    <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={20} userId={p.id} />
                    <span className="text-xs font-medium text-[#52525B] max-w-[140px] truncate">{p.full_name}</span>
                    <button type="button" onClick={() => remove(p.id)} className="text-[#A1A1AA] hover:text-rose-600">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Field>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 btn-secondary text-sm">Cancel</button>
            <button onClick={submit} disabled={saving || selected.length === 0}
              className="flex-1 btn-primary text-sm disabled:opacity-50">
              {saving ? 'Issuing…' : `Issue ${selected.length || ''} fee${selected.length === 1 ? '' : 's'}`}
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
