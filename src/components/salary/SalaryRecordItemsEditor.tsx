'use client'

import React, { useState } from 'react'
import { Plus, Trash2, Check } from 'lucide-react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN, RECORD_CHIP } from '@/components/salary/adminUi'
import {
  SalaryRecord, SalaryStatus,
  addSalaryItem, deleteSalaryItem, setSalaryRecordStatus, salaryNet,
} from '@/lib/salary'

interface SalaryRecordItemsEditorProps {
  record: SalaryRecord
  onChanged: () => void
}

const STATUS_FLOW: SalaryStatus[] = ['draft', 'approved', 'paid']

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

  const setStatus = async (status: SalaryStatus) => {
    setBusy(true)
    const result = await setSalaryRecordStatus(record.id, status)
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

      {/* Add bonus / penalty */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Bonus / penalty label"
          className={`flex-1 ${ADMIN.inputPlain}`} />
        <select value={kind} onChange={e => setKind(e.target.value as 'bonus' | 'penalty')}
          className="border border-[#E4E4E7] rounded-lg px-2 py-2 text-sm bg-white text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors">
          <option value="bonus">+ Bonus</option>
          <option value="penalty">- Penalty</option>
        </select>
        <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
          className="w-24 bg-white border border-[#E4E4E7] rounded-lg px-3 py-2 text-sm tabular-nums text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors" />
        <button onClick={add} disabled={busy || !label.trim() || !amount} className={ADMIN.darkBtn}>
          <Plus size={14} /> Add
        </button>
      </div>

      {/* Status flow */}
      <div className="flex items-center gap-2 pt-1">
        <span className={`text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full ${RECORD_CHIP[record.status]}`}>
          {record.status[0].toUpperCase() + record.status.slice(1)}
        </span>
        {record.payout_status && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]">
            payout: {record.payout_status}
          </span>
        )}
        <div className="flex gap-1.5 ml-auto">
          {STATUS_FLOW.map(s => (
            <button key={s} onClick={() => setStatus(s)} disabled={busy || s === record.status}
              className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                s === record.status ? 'bg-[#F4F4F5] border-[#E4E4E7] text-[#A1A1AA]' : 'bg-white border-[#E4E4E7] text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8]'
              }`}>
              {s === 'paid' && <Check size={11} />} {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
