'use client'

import React, { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN } from '@/components/salary/adminUi'
import { SalaryRecord, addSalaryItem, deleteSalaryItem, salaryNet } from '@/lib/salary'

interface SalaryRecordItemsEditorProps {
  record: SalaryRecord
  onChanged: () => void
}

export default function SalaryRecordItemsEditor({ record, onChanged }: SalaryRecordItemsEditorProps) {
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<'bonus' | 'penalty'>('bonus')
  const [busy, setBusy] = useState(false)

  const items = record.items ?? []
  const net = salaryNet(record)

  const add = async () => {
    const amt = parseFloat(amount)
    if (!label.trim() || !amt) return
    setBusy(true)
    const signed = kind === 'penalty' ? -Math.abs(amt) : Math.abs(amt)
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
    <div className="space-y-3">
      {/* Base + items breakdown */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#71717A]">Base salary</span>
          <span className="text-[#27272A] tabular-nums">{formatINR(Number(record.base_amount))}</span>
        </div>
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

      {/* Add bonus / penalty — label on first row, controls on second */}
      <div className="space-y-1.5">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Bonus / penalty label"
          className={`${ADMIN.inputPlain} !py-1.5 !text-xs`} />
        <div className="flex gap-1.5">
          <select value={kind} onChange={e => setKind(e.target.value as 'bonus' | 'penalty')}
            className="border border-[#E4E4E7] rounded-lg px-2 py-1.5 text-xs bg-white text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors">
            <option value="bonus">+ Bonus</option>
            <option value="penalty">– Penalty</option>
          </select>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount"
            className="flex-1 bg-white border border-[#E4E4E7] rounded-lg px-3 py-1.5 text-xs tabular-nums text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors" />
          <button onClick={add} disabled={busy || !label.trim() || !amount} className={ADMIN.darkBtn}>
            <Plus size={13} /> Add
          </button>
        </div>
      </div>
    </div>
  )
}
