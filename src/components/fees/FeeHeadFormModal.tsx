'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { X, AlertCircle, Tag } from 'lucide-react'
import { FeeHead, createFeeHead, updateFeeHead } from '@/lib/fees'

interface FeeHeadFormModalProps {
  head?: FeeHead | null      // when present, edit; otherwise create
  onClose: () => void
  onSaved: () => void
}

export default function FeeHeadFormModal({ head, onClose, onSaved }: FeeHeadFormModalProps) {
  const editing = !!head
  const [name, setName] = useState(head?.name ?? '')
  const [description, setDescription] = useState(head?.description ?? '')
  const [amount, setAmount] = useState(head ? String(head.default_amount) : '')
  const [active, setActive] = useState(head?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) { setError('Enter a name'); return }
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt < 0) { setError('Enter a valid default amount'); return }
    setSaving(true); setError(null)
    const input = {
      name: name.trim(),
      description: description.trim() || null,
      default_amount: amt,
      active,
    }
    const result = editing ? await updateFeeHead(head!.id, input) : await createFeeHead(input)
    setSaving(false)
    if (!result.success) { setError(result.error ?? 'Failed to save fee head'); return }
    onSaved()
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
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-slate-100 rounded-lg"><Tag size={16} className="text-slate-600" /></div>
            <h2 className="font-bold text-slate-800">{editing ? 'Edit fee head' : 'New fee head'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Name *">
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Tuition · Term 1" className={inputCls} />
          </Field>

          <Field label="Description">
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Optional details" className={inputCls} />
          </Field>

          <Field label="Default amount (₹) *">
            <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00" className={inputCls} />
          </Field>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-slate-700">Active (available when issuing)</span>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
              className="w-5 h-5 accent-slate-700" />
          </label>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 btn-secondary text-sm">Cancel</button>
            <button onClick={submit} disabled={saving}
              className="flex-1 text-sm font-semibold py-2 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create fee head'}
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
