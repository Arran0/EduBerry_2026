'use client'

import React, { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN } from '@/components/salary/adminUi'
import { DriverSalaryRecord, addDriverSalaryItem, deleteDriverSalaryItem } from '@/lib/driverSalary'

export interface PreviewItem { label: string; amount: number }

interface DriverSalaryRecordItemsEditorProps {
  record: DriverSalaryRecord
  onChanged: () => void
  /** Computed PF/ESI/LOP/bonus while the cycle is still open (not yet real items) — shown read-only, zero included. */
  previewItems?: PreviewItem[]
  /** Authoritative net pay for this record — computed the same way as the row's Net pay column. */
  net: number
}

export default function DriverSalaryRecordItemsEditor({ record, onChanged, previewItems, net }: DriverSalaryRecordItemsEditorProps) {
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<'bonus' | 'deduction'>('bonus')
  const [busy, setBusy] = useState(false)

  const items = record.items ?? []

  const add = async () => {
    const amt = parseFloat(amount)
    if (!label.trim() || !amt) return
    setBusy(true)
    const signed = kind === 'deduction' ? -Math.abs(amt) : Math.abs(amt)
    const result = await addDriverSalaryItem(record.id, label.trim(), signed)
    setBusy(false)
    if (result.success) { setLabel(''); setAmount(''); onChanged() }
  }

  const remove = async (itemId: string) => {
    setBusy(true)
    const result = await deleteDriverSalaryItem(itemId)
    setBusy(false)
    if (result.success) onChanged()
  }

  return (
    <div className="space-y-3">
      {/* Base + items tally — always reflects Net pay exactly */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#71717A]">Base salary</span>
          <span className="text-[#27272A] tabular-nums">{formatINR(Number(record.base_amount))}</span>
        </div>
        {previewItems?.map(it => (
          <div key={it.label} className="flex items-center gap-2 text-sm">
            <span className="flex-1 text-[#A1A1AA] truncate italic">{it.label}</span>
            <span className={`tabular-nums ${it.amount < 0 ? 'text-rose-500' : it.amount > 0 ? 'text-emerald-500' : 'text-[#A1A1AA]'}`}>
              {it.amount < 0 ? '-' : it.amount > 0 ? '+' : ''}{formatINR(Math.abs(it.amount))}
            </span>
            <span className="w-[13px] flex-shrink-0" />
          </div>
        ))}
        {items.map(it => (
          <div key={it.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1 text-[#71717A] truncate">{it.label}</span>
            <span className={`tabular-nums ${Number(it.amount) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {Number(it.amount) < 0 ? '-' : '+'}{formatINR(Math.abs(Number(it.amount)))}
            </span>
            <button onClick={() => remove(it.id)} disabled={busy}
              className="p-1 text-[#D4D4D8] hover:text-rose-500 rounded transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2 border-t border-[#E4E4E7]">
          <span className="text-sm font-semibold text-[#27272A]">Net pay</span>
          <span className="text-base font-bold text-[#18181B] tabular-nums">{formatINR(net)}</span>
        </div>
      </div>

      {/* Add bonus / deduction — amount controls first, label describes it below */}
      <div className="space-y-1.5">
        <div className="flex gap-1.5">
          <select value={kind} onChange={e => setKind(e.target.value as 'bonus' | 'deduction')}
            className="border border-[#E4E4E7] rounded-lg px-2 py-1.5 text-xs bg-white text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors">
            <option value="bonus">+ Bonus</option>
            <option value="deduction">− Deduction</option>
          </select>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount"
            className="flex-1 bg-white border border-[#E4E4E7] rounded-lg px-3 py-1.5 text-xs tabular-nums text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors" />
          <button onClick={add} disabled={busy || !label.trim() || !amount} className={ADMIN.darkBtn}>
            <Plus size={13} /> Add
          </button>
        </div>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Bonus / deduction label"
          className={`${ADMIN.inputPlain} !py-1.5 !text-xs`} />
      </div>
    </div>
  )
}
