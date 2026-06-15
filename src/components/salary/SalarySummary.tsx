'use client'

import React, { useEffect, useState } from 'react'
import { Banknote, Users, CalendarRange, Landmark } from 'lucide-react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN_GOLD } from '@/components/salary/adminUi'
import {
  fetchBaseSalaries, fetchCycles, fetchBankAccounts, fetchEligibleStaff,
} from '@/lib/salary'

/** Which admin section a card jumps to when clicked. */
export type SalarySummaryKey = 'cycles' | 'base' | 'bank'

interface Props {
  /** Highlights the card matching the active section. */
  activeKey?: SalarySummaryKey
  /** When provided, cards become buttons that switch the active section. */
  onSelect?: (key: SalarySummaryKey) => void
  /** Bump to force a re-fetch after edits elsewhere in the hub. */
  refreshKey?: number
}

interface Totals {
  payroll: number
  activeStaff: number
  totalStaff: number
  cycles: number
  completedCycles: number
  bankAccounts: number
}

const EMPTY: Totals = {
  payroll: 0, activeStaff: 0, totalStaff: 0, cycles: 0, completedCycles: 0, bankAccounts: 0,
}

export default function SalarySummary({ activeKey, onSelect, refreshKey = 0 }: Props) {
  const [t, setT] = useState<Totals>(EMPTY)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [bases, cycles, accounts, staff] = await Promise.all([
        fetchBaseSalaries(), fetchCycles(), fetchBankAccounts(), fetchEligibleStaff(),
      ])
      if (!alive) return
      const active = bases.filter(b => b.active)
      setT({
        payroll: active.reduce((s, b) => s + (Number(b.base_amount) || 0), 0),
        activeStaff: active.length,
        totalStaff: staff.length,
        cycles: cycles.length,
        completedCycles: cycles.filter(c => c.status === 'completed').length,
        bankAccounts: accounts.length,
      })
    })()
    return () => { alive = false }
  }, [refreshKey])

  const cards: {
    key: SalarySummaryKey
    label: string
    value: string
    sub: string
    icon: React.ReactNode
    tone: 'dark' | 'light' | 'muted'
  }[] = [
    {
      key: 'base',
      label: 'Monthly payroll',
      value: formatINR(t.payroll),
      sub: 'active base salaries',
      icon: <Banknote size={16} style={{ color: ADMIN_GOLD }} />,
      tone: 'dark',
    },
    {
      key: 'base',
      label: 'On payroll',
      value: String(t.activeStaff),
      sub: `of ${t.totalStaff} staff`,
      icon: <Users size={16} className="text-[#71717A]" />,
      tone: 'muted',
    },
    {
      key: 'cycles',
      label: 'Pay cycles',
      value: String(t.cycles),
      sub: `${t.completedCycles} completed`,
      icon: <CalendarRange size={16} className="text-[#71717A]" />,
      tone: 'light',
    },
    {
      key: 'bank',
      label: 'Bank accounts',
      value: String(t.bankAccounts),
      sub: 'on file',
      icon: <Landmark size={16} className="text-[#A1A1AA]" />,
      tone: 'light',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
      {cards.map((c, i) => {
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
            key={`${c.key}-${i}`}
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
