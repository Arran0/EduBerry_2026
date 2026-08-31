'use client'

import React, { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { SHARP } from '@/components/salary/adminUi'
import { SalaryRecord, SalaryRecordItem, addSalaryItem, deleteSalaryItem } from '@/lib/salary'

export interface PreviewItem { label: string; amount: number }

interface SalaryRecordItemsEditorProps {
  record: SalaryRecord
  onChanged: () => void
  /** Computed PF/ESI/LOP/bonus while the cycle is still open (not yet real items) — shown read-only, zero included. */
  previewItems?: PreviewItem[]
  /** The stored items to list. The caller decides which ones count, so a preview never doubles up with a stored row. */
  items: SalaryRecordItem[]
  /** Authoritative net pay for this record — computed the same way as the row's Net pay column. */
  net: number
}

export default function SalaryRecordItemsEditor({ record, onChanged, previewItems, items, net }: SalaryRecordItemsEditorProps) {
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<'bonus' | 'deduction'>('bonus')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    const amt = parseFloat(amount)
    if (!label.trim() || !amt) return
    setBusy(true)
    const signed = kind === 'deduction' ? -Math.abs(amt) : Math.abs(amt)
    const result = await addSalaryItem(record.id, label.trim(), signed)
    setBusy(false)
    if (result.success) { setLabel(''); setAmount(''); onChanged() }
  }

  const remove = async (itemId: string) => {
    setBusy(true)
    const result = await deleteSalaryItem(itemId)
    setBusy(false)
    if (result.success) onChanged()
  }

  return (
    // Two columns from sm up: the tally and the add-form sit side by side, so
    // expanding a row pushes half as much of the sheet off the screen.
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 items-start">
      {/* Base + items tally — always reflects Net pay exactly */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#71717A]">Base salary</span>
          <span className="text-[#27272A] tabular-nums">{formatINR(Number(record.base_amount))}</span>
        </div>
        {previewItems?.map(it => (
          <div key={it.label} className="flex items-center gap-2 text-xs">
            <span className="flex-1 text-[#A1A1AA] truncate italic">{it.label}</span>
            <span className={`tabular-nums ${it.amount < 0 ? 'text-[#BE123C]' : it.amount > 0 ? 'text-[#15803D]' : 'text-[#A1A1AA]'}`}>
              {it.amount < 0 ? '-' : it.amount > 0 ? '+' : ''}{formatINR(Math.abs(it.amount))}
            </span>
            <span className="w-[13px] flex-shrink-0" />
          </div>
        ))}
        {items.map(it => (
          <div key={it.id} className="flex items-center gap-2 text-xs">
            <span className="flex-1 text-[#71717A] truncate">{it.label}</span>
            <span className={`tabular-nums ${Number(it.amount) < 0 ? 'text-[#BE123C]' : 'text-[#15803D]'}`}>
              {Number(it.amount) < 0 ? '-' : '+'}{formatINR(Math.abs(Number(it.amount)))}
            </span>
            <button onClick={() => remove(it.id)} disabled={busy}
              className="p-0.5 text-[#D4D4D8] hover:text-[#BE123C] transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-[#E4E4E7]">
          <span className="text-xs font-semibold text-[#27272A]">Net pay</span>
          <span className="text-sm font-bold text-[#18181B] tabular-nums">{formatINR(net)}</span>
        </div>
      </div>

      {/* Add bonus / deduction — amount controls first, label describes it below */}
      <div className="space-y-1.5">
        <div className="flex gap-1.5">
          <select value={kind} onChange={e => setKind(e.target.value as 'bonus' | 'deduction')}
            className="border border-[#E4E4E7] px-2 py-1.5 text-xs bg-white text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors">
            <option value="bonus">+ Bonus</option>
            <option value="deduction">− Deduction</option>
          </select>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount"
            className="flex-1 min-w-0 bg-white border border-[#E4E4E7] px-2 py-1.5 text-xs tabular-nums text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors" />
          <button onClick={add} disabled={busy || !label.trim() || !amount} className={SHARP.darkBtn}>
            <Plus size={13} /> Add
          </button>
        </div>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Bonus / deduction label"
          className={SHARP.input} />
      </div>
    </div>
  )
}
