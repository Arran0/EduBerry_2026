'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { X, AlertCircle, Wallet } from 'lucide-react'
import {
  BusFee, BusOfflineMethod, BUS_OFFLINE_METHODS, BUS_METHOD_LABELS, recordBusOfflinePayment,
} from '@/lib/bus'
import { formatINR } from '@/components/bus/FeeCollectionSummary'

interface Props {
  fee: BusFee
  /** Already-verified amount paid so far; used to pre-fill the remaining balance. */
  paid?: number
  onClose: () => void
  onRecorded: () => void
}

export default function BusRecordPaymentModal({ fee, paid = 0, onClose, onRecorded }: Props) {
  const billed = Number(fee.amount) || 0
  const remaining = Math.max(0, billed - paid)
  const [method, setMethod] = useState<BusOfflineMethod>('cash')
  const [amount, setAmount] = useState(String(remaining || billed))
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amt = parseFloat(amount)
  const valid = !!amt && amt > 0
  const totalPaid = paid + (valid ? amt : 0)
  const willBePartial = valid && totalPaid < billed

  const submit = async () => {
    if (!valid) { setError('Enter a valid amount'); return }
    setSaving(true); setError(null)
    const result = await recordBusOfflinePayment(fee.id, { method, amount: amt, reference })
    setSaving(false)
    if (!result.success) { setError(result.error ?? 'Failed to record payment'); return }
    onRecorded()
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
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
        <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-slate-100 rounded-lg"><Wallet size={16} className="text-slate-700" /></div>
            <h2 className="font-bold text-slate-800">Record payment</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
            <p className="text-sm font-semibold text-slate-800 truncate">
              {fee.description || fee.fee_head?.name || 'Bus fee'}
              {fee.passenger?.full_name ? ` · ${fee.passenger.full_name}` : ''}
            </p>
            <p className="text-xs text-slate-400 truncate">
            Billed {formatINR(billed)}{paid > 0 ? ` · Paid ${formatINR(paid)} · Remaining ${formatINR(remaining)}` : ''} · ref {fee.upi_reference}
          </p>
          </div>

          <Field label="Method">
            <div className="grid grid-cols-3 gap-1.5">
              {BUS_OFFLINE_METHODS.map(m => {
                const on = method === m
                return (
                  <button key={m} type="button" onClick={() => setMethod(m)}
                    className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      on ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}>
                    {BUS_METHOD_LABELS[m]}
                  </button>
                )
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹) *">
              <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00" className={inputCls} />
            </Field>
            <Field label="Reference">
              <input value={reference} onChange={e => setReference(e.target.value)}
                placeholder="Txn / cheque no." className={inputCls} />
            </Field>
          </div>

          {valid && (
            <div className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${
              willBePartial ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            }`}>
              <span>{willBePartial ? `Short by ${formatINR(billed - totalPaid)} → marks as Partial` : 'Covers the fee in full → marks as Paid'}</span>
              <span className="font-bold uppercase tracking-wide">{willBePartial ? 'Partial' : 'Paid'}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 btn-secondary text-sm">Cancel</button>
            <button onClick={submit} disabled={saving}
              className="flex-1 text-sm font-semibold py-2 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-colors disabled:opacity-50">
              {saving ? 'Recording…' : 'Record payment'}
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
