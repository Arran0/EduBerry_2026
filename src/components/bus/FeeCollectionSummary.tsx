'use client'

import React from 'react'
import { IndianRupee, CheckCircle2, Clock, Ban } from 'lucide-react'
import { FeeCollectionSummary as Summary } from '@/lib/bus'

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
      icon: <CheckCircle2 size={18} className="text-emerald-600" />,
      bg: 'bg-emerald-50 border-emerald-100',
    },
    {
      label: 'Outstanding',
      value: formatINR(summary.outstanding_amount),
      sub: `${summary.unpaid_count + summary.partial_count} pending`,
      icon: <Clock size={18} className="text-amber-600" />,
      bg: 'bg-amber-50 border-amber-100',
    },
    {
      label: 'Total billed',
      value: formatINR(summary.total_amount),
      sub: `${summary.total_count} fee${summary.total_count === 1 ? '' : 's'}`,
      icon: <IndianRupee size={18} className="text-slate-600" />,
      bg: 'bg-slate-50 border-slate-100',
    },
    {
      label: 'Cancelled',
      value: String(summary.cancelled_count),
      sub: 'fees voided',
      icon: <Ban size={18} className="text-rose-500" />,
      bg: 'bg-rose-50 border-rose-100',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(c => (
        <div key={c.label} className={`rounded-2xl border p-4 ${c.bg}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{c.label}</span>
            {c.icon}
          </div>
          <p className="text-xl font-bold text-slate-800 tabular-nums">{c.value}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">{c.sub}</p>
        </div>
      ))}
    </div>
  )
}
