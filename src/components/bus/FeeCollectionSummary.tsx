'use client'

import React from 'react'
import { CheckCircle2, Clock, CalendarCheck, Users } from 'lucide-react'
import { FeeCollectionSummary as Summary } from '@/lib/bus'

export function formatINR(amount: number): string {
  return '₹' + (Number(amount) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

/** Filter keys a summary card can map to (mirrors the issued-fees status nav). */
export type SummaryCardKey = 'collected' | 'outstanding'

interface Props {
  summary: Summary
  /** Currently active filter — highlights the matching card. */
  activeKey?: SummaryCardKey
  /** When provided, cards become buttons that drive the issued-fees filter. */
  onSelect?: (key: SummaryCardKey) => void
  /** Today's collected amount for the selected academic year. */
  todayCollected?: number
  /** Count of unique passengers with outstanding dues for the selected year. */
  studentsWithDue?: number
}

export default function FeeCollectionSummary({ summary, activeKey, onSelect, todayCollected, studentsWithDue }: Props) {
  type Tone = 'dark' | 'light' | 'muted'
  const cards: {
    key: string
    filterKey?: SummaryCardKey
    label: string
    value: string
    sub: string
    icon: React.ReactNode
    tone: Tone
  }[] = [
    {
      key: 'collected',
      filterKey: 'collected',
      label: 'Collected',
      value: formatINR(summary.collected_amount),
      sub: `${summary.paid_count} paid`,
      icon: <CheckCircle2 size={16} />,
      tone: 'dark',
    },
    {
      key: 'outstanding',
      filterKey: 'outstanding',
      label: 'Outstanding',
      value: formatINR(summary.outstanding_amount),
      sub: `${summary.unpaid_count + summary.partial_count} pending · ${summary.partial_count} partial`,
      icon: <Clock size={16} />,
      tone: 'light',
    },
    {
      key: 'today',
      label: "Today's collection",
      value: formatINR(todayCollected ?? 0),
      sub: 'verified today',
      icon: <CalendarCheck size={16} />,
      tone: 'muted',
    },
    {
      key: 'students',
      label: 'Students with due',
      value: String(studentsWithDue ?? 0),
      sub: 'have outstanding fees',
      icon: <Users size={16} />,
      tone: 'light',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
      {cards.map(c => {
        const active = c.filterKey !== undefined && activeKey === c.filterKey
        const clickable = c.filterKey && onSelect
        const base =
          c.tone === 'dark'
            ? 'bg-[#27272A] border-[#27272A]'
            : c.tone === 'muted'
            ? 'bg-[#F4F2EC] border-[#E7E2D8]'
            : 'bg-white border-[#E4E4E7]'
        const labelCls = c.tone === 'dark' ? 'text-[#A1A1AA]' : 'text-[#71717A]'
        const valueCls = c.tone === 'dark' ? 'text-white' : 'text-[#18181B]'
        const subCls = c.tone === 'dark' ? 'text-[#8A8A93]' : 'text-[#A1A1AA]'
        const iconCls = c.tone === 'dark' ? 'text-[#B8983C]' : c.tone === 'muted' ? 'text-[#A8896B]' : 'text-[#A1A1AA]'
        const Tag = clickable ? 'button' : 'div'
        return (
          <Tag
            key={c.key}
            onClick={clickable ? () => onSelect!(c.filterKey!) : undefined}
            className={`text-left rounded-xl border p-3.5 sm:p-4 shadow-sm transition-all flex flex-col justify-between min-h-[88px] ${base} ${
              clickable ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : ''
            } ${active ? 'ring-2 ring-[#B8983C] ring-offset-1 ring-offset-[#FDFCF9]' : ''}`}
          >
            <div className="flex items-center justify-between mb-1.5 sm:mb-2">
              <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest ${labelCls}`}>{c.label}</span>
              <span className={iconCls}>{c.icon}</span>
            </div>
            <div>
              <p className={`text-lg sm:text-xl font-bold tabular-nums leading-tight ${valueCls}`}>{c.value}</p>
              <p className={`text-[10px] sm:text-[11px] mt-0.5 truncate ${subCls}`}>{c.sub}</p>
            </div>
          </Tag>
        )
      })}
    </div>
  )
}
