'use client'

import React from 'react'
import { CheckCircle2, Clock, CalendarCheck, Users } from 'lucide-react'
import { FeeCollectionSummary as Summary } from '@/lib/fees'

export function formatINR(amount: number): string {
  return '₹' + (Number(amount) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

/** Filter keys a summary card can map to (mirrors the issued-fees status nav). */
export type SummaryCardKey = 'collected' | 'outstanding'

interface Props {
  summary: Summary
  /** Currently active issued-fees filter — highlights the matching card. */
  activeKey?: SummaryCardKey
  /** When provided, the first four cards drive the issued-fees filter. */
  onSelect?: (key: SummaryCardKey) => void
  /** Today's verified collection (₹) — renders the fifth card when provided. */
  todayCollection?: number
  /** Distinct students with outstanding dues — renders the sixth card. */
  studentsWithDues?: number
  onOpenCollection?: () => void
  onOpenDefaulters?: () => void
}

type Tone = 'dark' | 'light' | 'muted'

export default function FeeCollectionSummary({
  summary, activeKey, onSelect, todayCollection, studentsWithDues, onOpenCollection, onOpenDefaulters,
}: Props) {
  const showExtras = todayCollection !== undefined || studentsWithDues !== undefined

  const cards: {
    key: string
    filterKey?: SummaryCardKey
    label: string
    value: string
    sub: string
    icon: React.ReactNode
    tone: Tone
    onClick?: () => void
  }[] = [
    {
      key: 'collected', filterKey: 'collected', label: 'Collected',
      value: formatINR(summary.collected_amount), sub: `${summary.paid_count} paid`,
      icon: <CheckCircle2 size={15} />, tone: 'dark',
    },
    {
      key: 'outstanding', filterKey: 'outstanding', label: 'Outstanding',
      value: formatINR(summary.outstanding_amount),
      sub: `${summary.unpaid_count + summary.partial_count} pending · ${summary.partial_count} partial`,
      icon: <Clock size={15} />, tone: 'light',
    },
  ]

  if (showExtras) {
    cards.push(
      {
        key: 'today', label: "Today's collection",
        value: formatINR(todayCollection ?? 0), sub: 'verified today',
        icon: <CalendarCheck size={15} />, tone: 'muted', onClick: onOpenCollection,
      },
      {
        key: 'students', label: 'Students with dues',
        value: String(studentsWithDues ?? 0), sub: 'view defaulters',
        icon: <Users size={15} />, tone: 'light', onClick: onOpenDefaulters,
      },
    )
  }

  const gridCols = showExtras ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2'

  return (
    <div className={`grid ${gridCols} gap-2.5`}>
      {cards.map(c => {
        const active = c.filterKey !== undefined && activeKey === c.filterKey
        const clickable = c.onClick || (c.filterKey && onSelect)
        const base =
          c.tone === 'dark'
            ? 'bg-[#27272A] border-[#B8983C]'
            : c.tone === 'muted'
            ? 'bg-[#F4F2EC] border-[#E7E2D8]'
            : 'bg-white border-[#E3DFD3]'
        const labelCls = c.tone === 'dark' ? 'text-[#8C8878]' : 'text-[#6B675A]'
        const valueCls = c.tone === 'dark' ? 'text-white' : 'text-[#18181B]'
        const subCls = c.tone === 'dark' ? 'text-[#8A8A93]' : 'text-[#8C8878]'
        const iconCls = c.tone === 'dark' ? 'text-[#B8983C]' : c.tone === 'muted' ? 'text-[#A8896B]' : 'text-[#8C8878]'
        const Tag = clickable ? 'button' : 'div'
        return (
          <Tag
            key={c.key}
            onClick={c.onClick ?? (c.filterKey && onSelect ? () => onSelect(c.filterKey!) : undefined)}
            className={`text-left border p-3.5 shadow-sm transition-all flex flex-col justify-between min-h-[88px] ${base} ${
              clickable ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : ''
            } ${active ? 'ring-2 ring-[#B8983C] ring-offset-1 ring-offset-[#FDFCF9]' : ''}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-[9px] font-bold uppercase tracking-widest ${labelCls}`}>{c.label}</span>
              <span className={iconCls}>{c.icon}</span>
            </div>
            <div>
              <p className={`text-lg sm:text-xl font-bold tabular-nums leading-tight ${valueCls}`}>{c.value}</p>
              <p className={`text-[10px] mt-0.5 truncate ${subCls}`}>{c.sub}</p>
            </div>
          </Tag>
        )
      })}
    </div>
  )
}
