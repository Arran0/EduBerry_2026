'use client'

import React from 'react'
import { IndianRupee, CheckCircle2, Clock, Ban } from 'lucide-react'
import { FeeCollectionSummary as Summary } from '@/lib/bus'

export function formatINR(amount: number): string {
  return '₹' + (Number(amount) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

/** Filter keys a summary card can map to (mirrors the issued-fees status nav). */
export type SummaryCardKey = 'all' | 'collected' | 'outstanding' | 'cancelled'

interface Props {
  summary: Summary
  /** Currently active filter — highlights the matching card. */
  activeKey?: SummaryCardKey
  /** When provided, cards become buttons that drive the issued-fees filter. */
  onSelect?: (key: SummaryCardKey) => void
}

export default function FeeCollectionSummary({ summary, activeKey, onSelect }: Props) {
  const cards: {
    key: SummaryCardKey
    label: string
    value: string
    sub: string
    icon: React.ReactNode
    tone: 'dark' | 'light' | 'muted'
  }[] = [
    {
      key: 'collected',
      label: 'Collected',
      value: formatINR(summary.collected_amount),
      sub: `${summary.paid_count} paid`,
      icon: <CheckCircle2 size={16} className="text-[#B8983C]" />,
      tone: 'dark',
    },
    {
      key: 'outstanding',
      label: 'Outstanding',
      value: formatINR(summary.outstanding_amount),
      sub: `${summary.unpaid_count + summary.partial_count} pending · ${summary.partial_count} partial`,
      icon: <Clock size={16} className="text-[#71717A]" />,
      tone: 'light',
    },
    {
      key: 'all',
      label: 'Total billed',
      value: formatINR(summary.total_amount),
      sub: `${summary.total_count} fee${summary.total_count === 1 ? '' : 's'}`,
      icon: <IndianRupee size={16} className="text-[#71717A]" />,
      tone: 'muted',
    },
    {
      key: 'cancelled',
      label: 'Cancelled',
      value: String(summary.cancelled_count),
      sub: 'fees voided',
      icon: <Ban size={16} className="text-[#A1A1AA]" />,
      tone: 'light',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
      {cards.map(c => {
        const active = activeKey === c.key
        const base =
          c.tone === 'dark'
            ? 'bg-[#27272A] border-[#27272A]'
            : c.tone === 'muted'
            ? 'bg-[#F4F2EC] border-[#E7E2D8]'
            : 'bg-white border-[#E4E4E7]'
        const labelCls = c.tone === 'dark' ? 'text-[#A1A1AA]' : 'text-[#71717A]'
        const valueCls = c.tone === 'dark' ? 'text-white' : 'text-[#18181B]'
        const subCls = c.tone === 'dark' ? 'text-[#8A8A93]' : 'text-[#A1A1AA]'
        const Tag = onSelect ? 'button' : 'div'
        return (
          <Tag
            key={c.key}
            onClick={onSelect ? () => onSelect(c.key) : undefined}
            className={`text-left rounded-xl border p-3.5 sm:p-4 shadow-sm transition-all ${base} ${
              onSelect ? 'hover:shadow-md cursor-pointer' : ''
            } ${active ? 'ring-2 ring-[#B8983C] ring-offset-1 ring-offset-[#FDFCF9]' : ''}`}
          >
            <div className="flex items-center justify-between mb-1.5 sm:mb-2">
              <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest ${labelCls}`}>{c.label}</span>
              {c.icon}
            </div>
            <p className={`text-lg sm:text-xl font-bold tabular-nums leading-tight ${valueCls}`}>{c.value}</p>
            <p className={`text-[10px] sm:text-[11px] mt-0.5 truncate ${subCls}`}>{c.sub}</p>
          </Tag>
        )
      })}
    </div>
  )
}
