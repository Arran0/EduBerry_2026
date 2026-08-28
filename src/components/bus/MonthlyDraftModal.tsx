'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { X, AlertCircle, Layers } from 'lucide-react'
import {
  BusTrip, BusFeeHead, BusFeeDraft,
  BusFeeDraftInput,
  createBusFeeDraft, updateBusFeeDraft, fetchBusFeeDraft,
} from '@/lib/bus'

interface MonthlyDraftModalProps {
  draft?: BusFeeDraft | null
  trips: BusTrip[]
  feeHeads: BusFeeHead[]
  onClose: () => void
  onSaved: (draft: BusFeeDraft) => void
}

export default function MonthlyDraftModal({
  draft, trips, feeHeads, onClose, onSaved,
}: MonthlyDraftModalProps) {
  const isEdit = !!draft
  const currentMonth = new Date().toISOString().slice(0, 7)

  const [title, setTitle] = useState(draft?.title ?? '')
  const [month, setMonth] = useState(draft?.month ?? currentMonth)
  const [tripId, setTripId] = useState(draft?.route_id ?? '')
  const [feeHeadId, setFeeHeadId] = useState(draft?.fee_head_id ?? '')
  const [description, setDescription] = useState(draft?.description ?? '')
  const [dueDate, setDueDate] = useState(draft?.due_date ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeHeads = feeHeads.filter(h => h.active)

  const submit = async () => {
    if (!title.trim()) { setError('Enter a title for this bulk issue'); return }
    if (!month) { setError('Select a month'); return }
    if (!dueDate) { setError('Select a due date'); return }
    setSaving(true); setError(null)

    const input: BusFeeDraftInput = {
      title: title.trim(),
      month,
      route_id: tripId || null,
      fee_head_id: feeHeadId || null,
      description: description.trim() || null,
      due_date: dueDate || null,
    }

    let savedId = draft?.id
    if (isEdit && savedId) {
      const res = await updateBusFeeDraft(savedId, input)
      if (!res.success) { setSaving(false); setError(res.error ?? 'Failed to update draft'); return }
    } else {
      const res = await createBusFeeDraft(input)
      if (!res.success || !res.id) { setSaving(false); setError(res.error ?? 'Failed to create draft'); return }
      savedId = res.id
    }

    const saved = await fetchBusFeeDraft(savedId!)
    setSaving(false)
    if (!saved) { setError('Failed to reload draft'); return }
    onSaved(saved)
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
              <Layers size={16} className="text-[#B8983C]" />
            </div>
            <h2 className="font-bold text-slate-800">
              {isEdit ? 'Edit Bulk Issue' : 'New Bulk Issue'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Title *">
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. June 2025 Bus Fee – Route A" className={inputCls}
              autoFocus />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Month *">
              <input type="month" value={month} onChange={e => setMonth(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Due date *">
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Link to trip">
              <select value={tripId} onChange={e => setTripId(e.target.value)} className={inputCls}>
                <option value="">None</option>
                {trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            {activeHeads.length > 0 && (
              <Field label="Fee head">
                <select value={feeHeadId} onChange={e => setFeeHeadId(e.target.value)} className={inputCls}>
                  <option value="">None</option>
                  {activeHeads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </Field>
            )}
          </div>

          <Field label="Description (optional)">
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Monthly bus fee for June 2025" className={inputCls} />
          </Field>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 btn-secondary text-sm">Cancel</button>
            <button onClick={submit} disabled={saving}
              className="flex-1 btn-primary text-sm disabled:opacity-50">
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create bulk issue'}
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
