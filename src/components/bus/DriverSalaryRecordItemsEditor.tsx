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
  draft: 'bg-slate-100 text-slate-600',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
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
          <span className="text-slate-600">Base salary</span>
          <span className="text-slate-700 tabular-nums">{formatINR(Number(record.base_amount))}</span>
        </div>
        {items.map(it => (
          <div key={it.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1 text-slate-600 truncate">{it.label}</span>
            <span className={`tabular-nums ${Number(it.amount) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {Number(it.amount) < 0 ? '-' : '+'}{formatINR(Math.abs(Number(it.amount)))}
            </span>
            <button onClick={() => remove(it.id)} disabled={busy}
              className="p-1 text-slate-300 hover:text-rose-500 rounded transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <span className="text-sm font-semibold text-slate-700">Net pay</span>
          <span className="text-base font-bold text-slate-900 tabular-nums">{formatINR(net)}</span>
        </div>
      </div>

      {/* Add bonus / deduction */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Bonus / deduction label"
          className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40" />
        <select value={kind} onChange={e => setKind(e.target.value as 'bonus' | 'deduction')}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="bonus">+ Bonus</option>
          <option value="deduction">- Deduction</option>
        </select>
        <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
          className="w-24 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40" />
        <button onClick={add} disabled={busy || !label.trim() || !amount}
          className="btn-primary text-xs flex items-center justify-center gap-1 disabled:opacity-50">
          <Plus size={14} /> Add
        </button>
      </div>

      {/* Status flow */}
      <div className="flex items-center gap-2 pt-1">
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[record.status]}`}>
          {record.status[0].toUpperCase() + record.status.slice(1)}
        </span>
        {record.payout_status && (
          <span className="text-[11px] font-medium px-2 py-1 rounded-full bg-amber-50 text-amber-700">
            payout: {record.payout_status}
          </span>
        )}
        <div className="flex gap-1.5 ml-auto">
          {STATUS_FLOW.map(s => (
            <button key={s} onClick={() => setStatus(s)} disabled={busy || s === record.status}
              className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                s === record.status ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'
              }`}>
              {s === 'paid' && <Check size={11} />} {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
