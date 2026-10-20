'use client'

import React, { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { Btn, SX } from '@/components/salary/ui'
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
      <div className="fx-card px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[12.5px]">
          <span className="text-slate-600">Base salary</span>
          <span className="text-slate-900 tabular-nums">{formatINR(Number(record.base_amount))}</span>
        </div>
        {previewItems?.map(it => (
          <div key={it.label} className="flex items-center gap-2 text-[12.5px]">
            <span className="flex-1 min-w-0 text-slate-500 break-words">{it.label} <span className="text-slate-400">(worked out)</span></span>
            <span className={`tabular-nums ${it.amount < 0 ? 'text-[#BE123C]' : it.amount > 0 ? 'text-[#15803D]' : 'text-slate-400'}`}>
              {it.amount < 0 ? '-' : it.amount > 0 ? '+' : ''}{formatINR(Math.abs(it.amount))}
            </span>
            <span className="w-7 flex-shrink-0" />
          </div>
        ))}
        {items.map(it => (
          <div key={it.id} className="flex items-center gap-2 text-[12.5px]">
            <span className="flex-1 min-w-0 text-slate-700 break-words">{it.label}</span>
            <span className={`tabular-nums ${Number(it.amount) < 0 ? 'text-[#BE123C]' : 'text-[#15803D]'}`}>
              {Number(it.amount) < 0 ? '-' : '+'}{formatINR(Math.abs(Number(it.amount)))}
            </span>
            <button onClick={() => remove(it.id)} disabled={busy} aria-label={`Remove ${it.label}`}
              className={`${SX.icon} !w-7 !h-7 hover:!text-[#BE123C]`}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 pt-1.5 mt-1 border-t border-[#EEEAE1]">
          <span className="text-[12.5px] font-semibold text-slate-900">Net pay</span>
          <span className="text-[14px] font-bold text-slate-900 tabular-nums">{formatINR(net)}</span>
        </div>
      </div>

      {/* Add bonus / deduction — amount controls first, label describes it below */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <select value={kind} onChange={e => setKind(e.target.value as 'bonus' | 'deduction')} aria-label="Bonus or deduction"
            className={`${SX.field} !w-auto flex-shrink-0 cursor-pointer`}>
            <option value="bonus">+ Bonus</option>
            <option value="deduction">− Deduction</option>
          </select>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount"
            aria-label="Amount" className={`${SX.field} flex-1 min-w-0 tabular-nums`} />
        </div>
        <div className="flex gap-2">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="What it is for"
            aria-label="Label" className={`${SX.field} flex-1 min-w-0`} />
          <Btn tone="dark" onClick={add} disabled={busy || !label.trim() || !amount} className="!h-9">
            <Plus size={14} /> Add
          </Btn>
        </div>
      </div>
    </div>
  )
}
