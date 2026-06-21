'use client'

import React, { useState } from 'react'
import { Plus, Trash2, Check } from 'lucide-react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import {
  DriverSalaryRecord, DriverSalaryStatus,
  addDriverSalaryItem, deleteDriverSalaryItem, setDriverSalaryRecordStatus, driverSalaryNet,
} from '@/lib/driverSalary'

interface DriverSalaryRecordItemsEditorProps {
  record: DriverSalaryRecord
  onChanged: () => void
}

const STATUS_FLOW: DriverSalaryStatus[] = ['draft', 'approved', 'paid']
const STATUS_CHIP: Record<DriverSalaryStatus, string> = {
  draft: 'bg-[#F4F4F5] text-[#71717A]',
  approved: 'bg-[#FBF3DE] text-[#8A6D1F]',
  paid: 'bg-[#27272A] text-white',
}

export default function DriverSalaryRecordItemsEditor({ record, onChanged }: DriverSalaryRecordItemsEditorProps) {
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<'bonus' | 'deduction'>('bonus')
  const [busy, setBusy] = useState(false)

  const items = record.items ?? []
  const net = driverSalaryNet(record)

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

  const setStatus = async (status: DriverSalaryStatus) => {
    setBusy(true)
    const result = await setDriverSalaryRecordStatus(record.id, status)
    setBusy(false)
    if (result.success) onChanged()
  }

  return (
    <div className="space-y-3">
      {/* Base + items breakdown */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#71717A]">Base salary</span>
          <span className="text-[#52525B] tabular-nums">{formatINR(Number(record.base_amount))}</span>
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
        <div className="flex items-center justify-between pt-2 border-t border-[#F4F4F5]">
          <span className="text-sm font-semibold text-[#52525B]">Net pay</span>
          <span className="text-base font-bold text-[#18181B] tabular-nums">{formatINR(net)}</span>
        </div>
      </div>

      {/* Add bonus / deduction */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Bonus / deduction label"
          className="flex-1 border border-[#E4E4E7] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors" />
        <select value={kind} onChange={e => setKind(e.target.value as 'bonus' | 'deduction')}
          className="border border-[#E4E4E7] rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-[#27272A] transition-colors">
          <option value="bonus">+ Bonus</option>
          <option value="deduction">- Deduction</option>
        </select>
        <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
          className="w-24 border border-[#E4E4E7] rounded-lg px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:border-[#27272A] transition-colors" />
        <button onClick={add} disabled={busy || !label.trim() || !amount}
          className="flex items-center justify-center gap-1 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
          <Plus size={14} /> Add
        </button>
      </div>

      {/* Status flow */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[record.status]}`}>
          {record.status[0].toUpperCase() + record.status.slice(1)}
        </span>
        {record.payout_status && (
          <span className="text-[11px] font-medium px-2 py-1 rounded-full bg-[#FBF3DE] text-[#8A6D1F]">
            payout: {record.payout_status}
          </span>
        )}
        <div className="flex gap-1.5 ml-auto">
          {STATUS_FLOW.map(s => (
            <button key={s} onClick={() => setStatus(s)} disabled={busy || s === record.status}
              className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                s === record.status ? 'bg-[#27272A] border-[#27272A] text-white' : 'bg-white border-[#E4E4E7] text-[#71717A] hover:border-[#27272A] hover:text-[#27272A]'
              }`}>
              {s === 'paid' && <Check size={11} />} {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
