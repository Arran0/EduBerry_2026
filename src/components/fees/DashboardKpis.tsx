'use client'

import React from 'react'
import { Landmark, CheckCircle2, AlertTriangle, CalendarCheck, Users } from 'lucide-react'
import { DashboardSummary } from '@/lib/fees'
import { formatINR } from './FeeCollectionSummary'

/**
 * The five at-a-glance numbers an admin should see on landing: Total Expected,
 * Collected, Outstanding, Today's Collection, Students with Dues. Scoped to the
 * selected academic year by the caller. "Students with Dues" is clickable to
 * jump to the Defaulter List.
 */
interface Props {
  summary: DashboardSummary
  onOpenDefaulters?: () => void
}

export default function DashboardKpis({ summary, onOpenDefaulters }: Props) {
  const cards: {
    label: string
    value: string
    icon: React.ReactNode
    tone: 'dark' | 'light' | 'muted'
    onClick?: () => void
  }[] = [
    {
      label: 'Total Fees Expected',
      value: formatINR(summary.total_expected),
      icon: <Landmark size={16} className="text-[#A1A1AA]" />,
      tone: 'dark',
    },
    {
      label: 'Collected',
      value: formatINR(summary.collected),
      icon: <CheckCircle2 size={16} className="text-[#16A34A]" />,
      tone: 'light',
    },
    {
      label: 'Outstanding',
      value: formatINR(summary.outstanding),
      icon: <AlertTriangle size={16} className="text-[#D97706]" />,
      tone: 'light',
    },
    {
      label: "Today's Collection",
      value: formatINR(summary.today_collection),
      icon: <CalendarCheck size={16} className="text-[#A8896B]" />,
      tone: 'muted',
    },
    {
      label: 'Students with Dues',
      value: String(summary.students_with_dues),
      icon: <Users size={16} className="text-[#71717A]" />,
      tone: 'light',
      onClick: onOpenDefaulters,
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
      {cards.map(c => {
        const base =
          c.tone === 'dark'
            ? 'bg-[#27272A] border-[#27272A]'
            : c.tone === 'muted'
            ? 'bg-[#F4F2EC] border-[#E7E2D8]'
            : 'bg-white border-[#E4E4E7]'
        const labelCls = c.tone === 'dark' ? 'text-[#A1A1AA]' : 'text-[#71717A]'
        const valueCls = c.tone === 'dark' ? 'text-white' : 'text-[#18181B]'
        const Tag = c.onClick ? 'button' : 'div'
        return (
          <Tag
            key={c.label}
            onClick={c.onClick}
            className={`text-left rounded-xl border p-3.5 sm:p-4 shadow-sm transition-all ${base} ${
              c.onClick ? 'hover:shadow-md cursor-pointer' : ''
            }`}
          >
            <div className="flex items-center justify-between mb-1.5 sm:mb-2">
              <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest ${labelCls}`}>{c.label}</span>
              {c.icon}
            </div>
            <p className={`text-lg sm:text-xl font-bold tabular-nums leading-tight ${valueCls}`}>{c.value}</p>
          </Tag>
        )
      })}
    </div>
  )
}
