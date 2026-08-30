'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { X, AlertCircle, RotateCcw, Loader2, Receipt } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatINR } from './FeeCollectionSummary'
import { requestRefund, REFUND_REASONS, type LedgerCredit } from '@/lib/fees/refunds'

/**
 * Request a refund against a specific payment.
 *
 * The parent chose a payment, not a fee. That is deliberate: a refund names the
 * money it returns, so "we returned ₹4,500 of the ₹12,000 received on 14 August
 * by Razorpay pay_XYZ" is a sentence someone can check against a bank
 * statement. "The fee was refunded" is not.
 *
 * This only REQUESTS. Approval is a separate act by a different person —
 * enforced by a database trigger, not by this form — and the money moves only
 * after that.
 */

interface Props {
  source?: 'school' | 'bus'
  feeId: string
  studentName?: string
  onClose: () => void
  onRequested: () => void
}

export default function RefundModal({ source = 'school', feeId, studentName, onClose, onRequested }: Props) {
  const [credits, setCredits] = useState<LedgerCredit[] | null>(null)
  const [selected, setSelected] = useState<LedgerCredit | null>(null)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<(typeof REFUND_REASONS)[number]['key']>('withdrawal')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('fee_transactions')
      .select('id, amount, direction, method, gateway, gateway_payment_id, utr, occurred_at, note')
      .eq('source', source)
      .eq('fee_id', feeId)
      .order('occurred_at', { ascending: false })

    const rows = (data ?? []) as unknown as (LedgerCredit & { direction: string })[]
    // Net each credit down by what has already been returned against it, so a
    // payment that is fully refunded is not offered again.
    const refunded = new Map<string, number>()
    for (const r of rows) {
      if (r.direction === 'debit' && r.reverses_txn_id) {
        refunded.set(r.reverses_txn_id, (refunded.get(r.reverses_txn_id) ?? 0) + Number(r.amount))
      }
    }
    const available = rows
      .filter(r => r.direction === 'credit')
      .map(r => ({ ...r, refundable: Number(r.amount) - (refunded.get(r.id) ?? 0) }))
      .filter(r => r.refundable > 0.005)

    setCredits(available)
    if (available.length === 1) {
      setSelected(available[0])
      setAmount(String(available[0].refundable))
    }
  }, [source, feeId])

  useEffect(() => { load() }, [load])

  const value = parseFloat(amount)
  const valid = !!selected && Number.isFinite(value) && value > 0
    && value <= (selected.refundable ?? 0) + 0.005 && reason.trim().length > 0

  const submit = async () => {
    if (!valid || !selected) return
    setSaving(true); setError(null)
    const res = await requestRefund({
      transaction_id: selected.id,
      amount: value,
      reason: reason.trim(),
      reason_category: category,
    })
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Could not raise the refund.'); return }
    onRequested()
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
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[92dvh] sm:max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <RotateCcw size={15} className="text-slate-400" /> Refund
            </h2>
            {studentName && <p className="text-xs text-slate-400 truncate">{studentName}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="p-2 -mr-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {credits === null ? (
            <div className="py-8 text-center"><div className="spinner mx-auto" /></div>
          ) : credits.length === 0 ? (
            <div className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              There is nothing left to refund on this fee — no payment has been received, or every
              payment has already been returned in full.
            </div>
          ) : (
            <>
              <Field label="Which payment are you returning?">
                <div className="space-y-2">
                  {credits.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setSelected(c); setAmount(String(c.refundable)) }}
                      className={`w-full text-left p-3 rounded-xl border transition-colors ${
                        selected?.id === c.id
                          ? 'border-slate-800 bg-slate-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800">{formatINR(c.refundable ?? 0)}</span>
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">
                          {c.gateway ?? c.method ?? 'payment'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Received {new Date(c.occurred_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {Number(c.refundable) !== Number(c.amount) && ` · ${formatINR(Number(c.amount))} originally`}
                      </p>
                      {(c.gateway_payment_id || c.utr) && (
                        <p className="text-[10px] text-slate-400 mt-0.5 font-mono truncate">
                          {c.gateway_payment_id ?? c.utr}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Amount to refund">
                <input
                  type="number" inputMode="decimal" min="0" step="0.01"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300"
                  placeholder="0.00"
                />
                {selected && (
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Up to {formatINR(selected.refundable ?? 0)} can be returned against this payment.
                  </p>
                )}
              </Field>

              <Field label="Why?">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {REFUND_REASONS.map(r => (
                    <button
                      key={r.key} onClick={() => setCategory(r.key)}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                        category === r.key
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={reason} onChange={e => setReason(e.target.value)} rows={2}
                  placeholder="A sentence someone reviewing this in a year will understand."
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
                />
              </Field>

              <div className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 leading-relaxed">
                <Receipt size={14} className="flex-shrink-0 mt-0.5" />
                This raises a request. Someone other than you has to approve it before any money
                moves — and no money leaves until they do.
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {error}
                </div>
              )}

              <button
                onClick={submit} disabled={!valid || saving}
                className="w-full text-sm font-semibold py-3 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
                Request refund
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-2">{label}</label>
      {children}
    </div>
  )
}
