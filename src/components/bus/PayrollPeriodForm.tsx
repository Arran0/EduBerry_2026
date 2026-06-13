'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { X, AlertCircle, Banknote } from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import { PayrollInput, createPayroll } from '@/lib/bus'

interface PayrollPeriodFormProps {
  drivers: UserProfile[]
  onClose: () => void
  onSaved: () => void
}

export default function PayrollPeriodForm({ drivers, onClose, onSaved }: PayrollPeriodFormProps) {
  const [driverId, setDriverId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [base, setBase] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!driverId) { setError('Select a driver'); return }
    if (!start || !end) { setError('Pick a pay period'); return }
    if (end < start) { setError('End date is before start date'); return }
    setSaving(true); setError(null)
    const input: PayrollInput = {
      driver_id: driverId,
      period_start: start,
      period_end: end,
      base_amount: parseFloat(base) || 0,
      notes: notes.trim() || null,
    }
    const result = await createPayroll(input)
    setSaving(false)
    if (!result.success) { setError(result.error ?? 'Failed to create payroll'); return }
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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white rounded-t-2xl border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-100 rounded-lg"><Banknote size={16} className="text-emerald-600" /></div>
            <h2 className="font-bold text-slate-800">New Pay Period</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Driver *">
            <select value={driverId} onChange={e => setDriverId(e.target.value)} className={inputCls}>
              <option value="">— Select driver —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
            {drivers.length === 0 && <p className="text-[11px] text-amber-600 mt-1">No driver accounts yet.</p>}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Period start *">
              <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Period end *">
              <input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Base amount (₹)">
            <input type="number" min="0" step="0.01" value={base} onChange={e => setBase(e.target.value)}
              placeholder="0.00" className={inputCls} />
          </Field>

          <Field label="Notes">
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className={inputCls} />
          </Field>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 btn-secondary text-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 btn-primary text-sm disabled:opacity-50">
              {saving ? 'Creating…' : 'Create period'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 bg-white'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}
