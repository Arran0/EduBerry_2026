'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  Banknote, Wallet, Receipt, Send, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN_GOLD, BLEED } from '@/components/salary/adminUi'
import { formatPeriod } from '@/lib/salary'
import {
  MonthlyPayrollStats, fetchMonthlyPayrollStats, defaultPayrollMonth,
  shiftMonth, monthIndex, percentChange, comparable,
} from '@/lib/salaryStats'

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

/** Compact rupees for a stat card — ₹4.52L reads at a glance where ₹4,52,000 does not. */
function compactINR(amount: number): string {
  const n = Math.abs(Number(amount) || 0)
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 2)}Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(n >= 1e6 ? 1 : 2)}L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`
  return formatINR(n)
}

/**
 * Month-on-month change chip.
 *
 * `goodWhenUp` says which direction is worth celebrating: payroll cost rising
 * is not the same news as net pay rising, and deductions climbing is worse
 * news than either. Colour follows the news, never the arrow.
 */
function DeltaChip({ percent, goodWhenUp, dark }: { percent: number; goodWhenUp: boolean; dark?: boolean }) {
  const flat = Math.abs(percent) < 0.05
  const up = percent > 0
  const good = flat ? null : up === goodWhenUp
  const tone = flat
    ? (dark ? 'text-[#8A8A93]' : 'text-[#A1A1AA]')
    : good
    ? (dark ? 'text-emerald-400' : 'text-emerald-600')
    : (dark ? 'text-rose-400' : 'text-rose-500')
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums ${tone}`}>
      <Icon size={11} strokeWidth={2.5} />
      {flat ? '0%' : `${Math.abs(percent).toFixed(Math.abs(percent) < 10 ? 1 : 0)}%`}
    </span>
  )
}

interface Card {
  key: SalarySummaryKey
  label: string
  value: string
  sub: string
  icon: React.ReactNode
  dark?: boolean
  /** null hides the comparison entirely (a progress card has nothing to compare). */
  percent: number | null
  goodWhenUp: boolean
}

export default function SalarySummary({ activeKey, onSelect, refreshKey = 0 }: Props) {
  // Opens on the month payroll is most likely being worked on — the previous
  // month during the first ten days, when last month's salaries are processed.
  const [period, setPeriod] = useState(() => defaultPayrollMonth())
  const [stats, setStats] = useState<MonthlyPayrollStats | null>(null)
  const [prev, setPrev] = useState<MonthlyPayrollStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const before = shiftMonth(period.year, period.month, -1)
    Promise.all([
      fetchMonthlyPayrollStats(period.year, period.month),
      fetchMonthlyPayrollStats(before.year, before.month),
    ]).then(([current, previous]) => {
      if (!alive) return
      setStats(current)
      setPrev(previous)
      setLoading(false)
    })
    return () => { alive = false }
  }, [period, refreshKey])

  // Nothing to see past the month in progress — no cycle can exist there yet.
  const now = new Date()
  const atLatest = monthIndex(period.year, period.month) >= monthIndex(now.getFullYear(), now.getMonth() + 1)

  const cards: Card[] = useMemo(() => {
    const s = stats
    const canCompare = !!s && !!prev && comparable(s, prev)
    const delta = (pick: (x: MonthlyPayrollStats) => number) =>
      canCompare && s && prev ? percentChange(pick(s), pick(prev)) : null

    const paid = s?.paidCount ?? 0
    const total = s?.totalCount ?? 0

    return [
      {
        key: 'base',
        label: 'Payroll cost',
        value: compactINR(s?.gross ?? 0),
        sub: s?.headcount ? `${s.headcount} on payroll` : 'nobody on payroll',
        icon: <Banknote size={15} style={{ color: ADMIN_GOLD }} />,
        dark: true,
        percent: delta(x => x.gross),
        goodWhenUp: false,
      },
      {
        key: 'cycles',
        label: 'Net pay',
        value: compactINR(s?.net ?? 0),
        sub: s?.bonus ? `incl. ${compactINR(s.bonus)} task bonus` : 'after deductions',
        icon: <Wallet size={15} className="text-[#71717A]" />,
        percent: delta(x => x.net),
        goodWhenUp: true,
      },
      {
        key: 'cycles',
        label: 'Deductions',
        value: compactINR(s?.deductions ?? 0),
        sub: s && (s.pf || s.esi || s.lop)
          ? [
              s.pf ? `PF ${compactINR(s.pf)}` : null,
              s.esi ? `ESI ${compactINR(s.esi)}` : null,
              s.lop ? `LOP ${compactINR(s.lop)}` : null,
            ].filter(Boolean).join(' · ')
          : 'PF, ESI & loss of pay',
        icon: <Receipt size={15} className="text-[#71717A]" />,
        percent: delta(x => x.deductions),
        goodWhenUp: false,
      },
      {
        key: 'cycles',
        label: 'Disbursed',
        value: total > 0 ? `${paid}/${total}` : '—',
        sub: total === 0
          ? (s?.projected ? 'cycle not run yet' : 'no records this month')
          : paid === total
          ? 'everyone paid'
          : `${compactINR(s?.pendingAmount ?? 0)} still to pay`,
        icon: <Send size={15} className="text-[#71717A]" />,
        // A payout count is progress through one month, not a trend across two.
        percent: null,
        goodWhenUp: true,
      },
    ]
  }, [stats, prev])

  const previousLabel = useMemo(() => {
    const b = shiftMonth(period.year, period.month, -1)
    return formatPeriod(b.month, b.year)
  }, [period])

  return (
    <div className={`${BLEED} bg-white border-y border-[#E4E4E7] sm:border sm:rounded-xl overflow-hidden shadow-sm`}>
      {/* Month toggler — one strip, the same dark as every sheet header. */}
      <div className="flex items-center bg-[#27272A]">
        <button
          type="button"
          onClick={() => setPeriod(p => shiftMonth(p.year, p.month, -1))}
          aria-label="Previous month"
          className="px-3 py-2.5 text-[#A1A1AA] hover:text-white transition-colors"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="flex-1 min-w-0 flex items-baseline justify-center gap-2">
          <span className="text-xs sm:text-sm font-bold tracking-wide text-white truncate">
            {formatPeriod(period.month, period.year)}
          </span>
          <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-widest text-[#71717A]">
            vs {previousLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5 pr-2">
          {stats?.projected && (
            <span
              className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border border-[#8A6D1F] text-[#D8BC6A]"
              title="No pay cycle has been run for this month yet — figures are projected from active base salaries and the bonus points earned so far."
            >
              Projected
            </span>
          )}
          <button
            type="button"
            onClick={() => setPeriod(p => shiftMonth(p.year, p.month, 1))}
            disabled={atLatest}
            aria-label="Next month"
            className="px-1.5 py-2.5 text-[#A1A1AA] hover:text-white transition-colors disabled:opacity-25 disabled:hover:text-[#A1A1AA]"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Hairline dividers instead of gaps, so the four figures read as one panel. */}
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {cards.map((c, i) => {
          const active = activeKey === c.key
          const Tag = onSelect ? 'button' : 'div'
          return (
            <Tag
              key={`${c.label}-${i}`}
              onClick={onSelect ? () => onSelect(c.key) : undefined}
              className={`relative text-left p-3 sm:p-3.5 border-[#F0EFEA] transition-colors ${
                i % 2 === 0 ? 'border-r' : ''
              } lg:border-r lg:last:border-r-0 ${i < 2 ? 'border-b lg:border-b-0' : ''} ${
                c.dark ? 'bg-[#27272A]' : 'bg-white'
              } ${onSelect && !c.dark ? 'hover:bg-[#FAFAF8]' : ''} ${
                onSelect && c.dark ? 'hover:bg-[#18181B]' : ''
              }`}
            >
              {active && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#B8983C]" />}

              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span
                  className={`text-[9.5px] sm:text-[10px] font-bold uppercase tracking-widest truncate ${
                    c.dark ? 'text-[#A1A1AA]' : 'text-[#71717A]'
                  }`}
                >
                  {c.label}
                </span>
                <span className="flex-shrink-0">{c.icon}</span>
              </div>

              <div className="flex items-baseline gap-1.5 flex-wrap">
                <p
                  className={`text-lg sm:text-xl font-bold tabular-nums leading-tight ${
                    loading ? 'opacity-30' : ''
                  } ${c.dark ? 'text-white' : 'text-[#18181B]'}`}
                >
                  {c.value}
                </p>
                {!loading && c.percent !== null && (
                  <DeltaChip percent={c.percent} goodWhenUp={c.goodWhenUp} dark={c.dark} />
                )}
              </div>

              <p
                className={`text-[10px] sm:text-[11px] mt-0.5 truncate ${
                  c.dark ? 'text-[#8A8A93]' : 'text-[#A1A1AA]'
                }`}
              >
                {c.sub}
              </p>
            </Tag>
          )
        })}
      </div>
    </div>
  )
}
