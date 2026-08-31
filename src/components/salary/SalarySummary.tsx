'use client'

import React, { useEffect, useState } from 'react'
import { Banknote, Users, CalendarRange, Sparkles } from 'lucide-react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN_GOLD } from '@/components/salary/adminUi'
import {
  fetchBaseSalaries, fetchCycles, fetchCycleTallies, fetchEligibleStaff, fetchHiddenSalaryMemberIds,
  fetchMonthlyBonusPoints,
} from '@/lib/salary'
import {
  fetchDriverBaseSalaries, fetchDriverCycles, fetchDriverCycleTallies, fetchEligibleDrivers,
} from '@/lib/driverSalary'
import { fetchPayrollCalibration, computeBonusAmounts } from '@/lib/payroll'

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
  incompleteCycles: number
  bonusSpend: number
  bonusPoints: number
}

const EMPTY: Totals = {
  payroll: 0, activeStaff: 0, totalStaff: 0, cycles: 0, incompleteCycles: 0, bonusSpend: 0, bonusPoints: 0,
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function SalarySummary({ activeKey, onSelect, refreshKey = 0 }: Props) {
  const [t, setT] = useState<Totals>(EMPTY)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [bases, cycles, tallies, staff, driverBases, driverCycles, driverTallies, allDrivers, calibration, hiddenIds] =
        await Promise.all([
          fetchBaseSalaries(), fetchCycles(), fetchCycleTallies(), fetchEligibleStaff(),
          fetchDriverBaseSalaries(), fetchDriverCycles(), fetchDriverCycleTallies(), fetchEligibleDrivers(),
          fetchPayrollCalibration(), fetchHiddenSalaryMemberIds(),
        ])
      if (!alive) return

      const hidden = new Set(hiddenIds)
      const drivers = allDrivers.filter(d => !hidden.has(d.id) && !d.is_banned)

      // Task-bonus spend for the month in progress. Read live from the points
      // earned so far rather than from closed cycles, so the figure is useful
      // before the month's payroll has been locked.
      const now = new Date()
      const everyone = [...staff, ...drivers].map(p => p.id)
      const points = await fetchMonthlyBonusPoints(everyone, now.getFullYear(), now.getMonth() + 1)
      if (!alive) return
      const bonusSpend = Object.values(computeBonusAmounts(points, calibration.bonus))
        .reduce((sum, amount) => sum + amount, 0)
      const bonusPoints = Object.values(points).reduce((sum, p) => sum + (p > 0 ? p : 0), 0)

      const allTallies = { ...tallies, ...driverTallies }
      const allCycles = [...cycles, ...driverCycles]
      // Scoped to who's actually eligible right now (and not hidden) — a
      // stale base-salary row left over from a role change or a hidden
      // member is otherwise counted in "on payroll" without being counted
      // in "of N people", which can push the numerator past the denominator.
      const staffIds = new Set(staff.map(s => s.id))
      const driverIds = new Set(drivers.map(d => d.id))
      const active = [
        ...bases.filter(b => b.active && staffIds.has(b.staff_id)),
        ...driverBases.filter(b => b.active && driverIds.has(b.driver_id)),
      ]
      setT({
        payroll: active.reduce((s, b) => s + (Number(b.base_amount) || 0), 0),
        activeStaff: active.length,
        totalStaff: staff.length + drivers.length,
        cycles: allCycles.length,
        // A cycle counts as incomplete until every record in it has been paid.
        incompleteCycles: allCycles.filter(c => {
          const t = allTallies[c.id]
          return !t || t.total === 0 || t.paid < t.total
        }).length,
        bonusSpend,
        bonusPoints,
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
      sub: `of ${t.totalStaff} people`,
      icon: <Users size={16} className="text-[#71717A]" />,
      tone: 'muted',
    },
    {
      key: 'cycles',
      label: 'Incomplete cycles',
      value: String(t.incompleteCycles),
      sub: `of ${t.cycles} cycle${t.cycles === 1 ? '' : 's'}`,
      icon: <CalendarRange size={16} className="text-[#71717A]" />,
      tone: 'light',
    },
    {
      key: 'cycles',
      label: 'Task bonus',
      value: formatINR(t.bonusSpend),
      // Naming the month and the point count keeps a legitimate zero (nobody
      // has earned points yet this month) from reading like a broken figure.
      sub: `${t.bonusPoints} pt${t.bonusPoints === 1 ? '' : 's'} · ${MONTH_NAMES[new Date().getMonth()]}`,
      icon: <Sparkles size={16} className="text-[#A1A1AA]" />,
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
