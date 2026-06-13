'use client'

import React from 'react'
import { IndianRupee, CheckCircle2, Clock, Ban } from 'lucide-react'
import { FeeCollectionSummary as Summary } from '@/lib/fees'

export function formatINR(amount: number): string {
  return '₹' + (Number(amount) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

interface Props {
  summary: Summary
}

export default function FeeCollectionSummary({ summary }: Props) {
  const cards = [
    {
      label: 'Collected',
      value: formatINR(summary.collected_amount),
      sub: `${summary.paid_count} paid`,
      icon: <CheckCircle2 size={18} className="text-white" />,
      bg: 'bg-slate-800 border-slate-800',
      valueCls: 'text-white',
      labelCls: 'text-slate-300',
      subCls: 'text-slate-400',
    },
    {
      label: 'Outstanding',
      value: formatINR(summary.outstanding_amount),
      sub: `${summary.unpaid_count + summary.partial_count} pending`,
      icon: <Clock size={18} className="text-slate-500" />,
      bg: 'bg-white border-slate-200',
      valueCls: 'text-slate-800',
      labelCls: 'text-slate-500',
      subCls: 'text-slate-400',
    },
    {
      label: 'Total billed',
      value: formatINR(summary.total_amount),
      sub: `${summary.total_count} fee${summary.total_count === 1 ? '' : 's'}`,
      icon: <IndianRupee size={18} className="text-slate-600" />,
      bg: 'bg-slate-100 border-slate-200',
      valueCls: 'text-slate-800',
      labelCls: 'text-slate-500',
      subCls: 'text-slate-400',
    },
    {
      label: 'Cancelled',
      value: String(summary.cancelled_count),
      sub: 'fees voided',
      icon: <Ban size={18} className="text-slate-400" />,
      bg: 'bg-white border-slate-200',
      valueCls: 'text-slate-700',
      labelCls: 'text-slate-500',
      subCls: 'text-slate-400',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(c => (
        <div key={c.label} className={`rounded-2xl border p-4 ${c.bg}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-semibold uppercase tracking-wide ${c.labelCls}`}>{c.label}</span>
            {c.icon}
          </div>
          <p className={`text-xl font-bold tabular-nums ${c.valueCls}`}>{c.value}</p>
          <p className={`text-[11px] mt-0.5 ${c.subCls}`}>{c.sub}</p>
        </div>
      ))}
    </div>
  )
}
