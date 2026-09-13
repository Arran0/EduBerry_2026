'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { Chip, MonthStepper, StatTile } from '@/components/salary/ui'
import { useSchoolClock } from '@/hooks/useSchoolClock'
import { formatPeriod } from '@/lib/salary'
import { recomputePendingAttendance } from '@/lib/attendance'
import { MonthlyPayrollStats, PayrollContext, fetchMonthlyPayrollStats, fetchPayrollContext, defaultPayrollMonth, shiftMonth, monthIndex, percentChange, comparable } from '@/lib/salaryStats'

/** Which admin section a tile jumps to when clicked. */
export type SalarySummaryKey = 'cycles' | 'base' | 'bank'

interface Props {
  /** When provided, tiles become buttons that jump to the section behind the figure. */
  onSelect?: (key: SalarySummaryKey) => void
  /** Bump to force a re-fetch after edits elsewhere in the hub. */
  refreshKey?: number
}

/** Compact rupees for a stat tile — ₹4.52L reads at a glance where ₹4,52,000 does not. */
export function compactINR(amount: number): string {
  const n = Math.abs(Number(amount) || 0)
  const sign = amount < 0 ? '−' : ''
  if (n >= 1e7) return `${sign}₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 2)}Cr`
  if (n >= 1e5) return `${sign}₹${(n / 1e5).toFixed(n >= 1e6 ? 1 : 2)}L`
  if (n >= 1e3) return `${sign}₹${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`
  return sign + formatINR(n)
}

export default function SalarySummary({ onSelect, refreshKey = 0 }: Props) {
  // Opens on the month payroll is most likely being worked on — the previous
  // month during the first ten days, when last month's salaries are processed.
  const [period, setPeriod] = useState(() => defaultPayrollMonth())
  const [ctx, setCtx] = useState<PayrollContext | null>(null)
  const [stats, setStats] = useState<MonthlyPayrollStats | null>(null)
  const [prev, setPrev] = useState<MonthlyPayrollStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { today, ready } = useSchoolClock()

  // The payroll setup (calibration, everyone's base salary) is the same
  // whichever month is on screen, so it is fetched once and handed to each.
  //
  // It waits for the clock rather than firing once against a null date and
  // again against the real one: the second fetch replaces the context object,
  // which restarts every month below it. One school date, one context, one
  // pass over the months.
  //
  // Settling any pending attendance recompute is gated behind the same fetch:
  // an open month's loss of pay is computed live from the day statuses, so a
  // cutoff or holiday added after the fact would otherwise show here as a
  // deduction the attendance app no longer agrees with. It runs once per load,
  // ahead of every month drawn from this context, and costs one read of an
  // empty queue when no rule has changed. It never rejects on its own (a
  // missing RPC is logged and swallowed), so it can't short-circuit the catch
  // below.
  useEffect(() => {
    if (!ready) return
    let alive = true
    recomputePendingAttendance()
      .then(() => fetchPayrollContext(today))
      .then(c => { if (alive) setCtx(c) })
      .catch(e => {
        console.error('fetchPayrollContext failed:', e)
        if (!alive) return
        setError('Could not load the payroll settings.')
        setLoading(false)
      })
    return () => { alive = false }
  }, [ready, today, refreshKey, attempt])

  // The selected month lands first and renders on its own; last month follows
  // only to fill in the change chips. Waiting for both would leave the whole
  // panel blank for the slower of two multi-query months.
  const run = useRef(0)
  useEffect(() => {
    if (!ctx) return
    const token = ++run.current
    let alive = true
    setLoading(true)
    setError(null)
    setPrev(null)
    ;(async () => {
      try {
        const current = await fetchMonthlyPayrollStats(period.year, period.month, ctx)
        if (!alive || token !== run.current) return
        setStats(current)
        setLoading(false)

        const before = shiftMonth(period.year, period.month, -1)
        const previous = await fetchMonthlyPayrollStats(before.year, before.month, ctx)
        if (!alive || token !== run.current) return
        setPrev(previous)
      } catch (e) {
        // Without this the panel sat at four silent ₹0 tiles and a Loading
        // chip forever, which reads as "payroll is zero this month" — the one
        // wrong answer a payroll dashboard must never give quietly.
        console.error('fetchMonthlyPayrollStats failed:', e)
        if (!alive || token !== run.current) return
        setStats(null)
        setError(e instanceof Error ? e.message : 'Could not load this month.')
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [ctx, period, attempt])

  const retry = useCallback(() => {
    setError(null)
    setLoading(true)
    setAttempt(n => n + 1)
  }, [])

  // Nothing to see past the month in progress — no cycle can exist there yet.
  const now = new Date()
  const atLatest = monthIndex(period.year, period.month) >= monthIndex(now.getFullYear(), now.getMonth() + 1)

  const tiles = useMemo(() => {
    const s = stats
    const canCompare = !!s && !!prev && comparable(s, prev)
    const delta = (pick: (x: MonthlyPayrollStats) => number) =>
      canCompare && s && prev ? percentChange(pick(s), pick(prev)) : null

    const paid = s?.paidCount ?? 0
    const total = s?.totalCount ?? 0

    return [
      {
        key: 'base' as const,
        label: 'Payroll cost',
        value: compactINR(s?.gross ?? 0),
        sub: s?.headcount ? `${s.headcount} on payroll` : 'nobody on payroll',
        percent: delta(x => x.gross),
        goodWhenUp: false,
        shade: 0 as const,
      },
      {
        key: 'cycles' as const,
        label: 'Net pay',
        value: compactINR(s?.net ?? 0),
        sub: s?.bonus ? `incl. ${compactINR(s.bonus)} task bonus` : 'after deductions',
        percent: delta(x => x.net),
        goodWhenUp: true,
        shade: 1 as const,
      },
      {
        key: 'cycles' as const,
        label: 'Deductions',
        value: compactINR(s?.deductions ?? 0),
        sub: s && (s.pf || s.esi || s.lop)
          ? [
              s.pf ? `PF ${compactINR(s.pf)}` : null,
              s.esi ? `ESI ${compactINR(s.esi)}` : null,
              s.lop ? `LOP ${compactINR(s.lop)}` : null,
            ].filter(Boolean).join(' · ')
          : 'PF, ESI & loss of pay',
        percent: delta(x => x.deductions),
        goodWhenUp: false,
        shade: 2 as const,
      },
      {
        key: 'cycles' as const,
        label: 'Disbursed',
        value: total > 0 ? `${paid}/${total}` : '—',
        sub: total === 0
          ? (s?.projected ? 'cycle not run yet' : 'no records this month')
          : paid === total
          ? 'everyone paid'
          : `${compactINR(s?.pendingAmount ?? 0)} still to pay`,
        // A payout count is progress through one month, not a trend across two.
        percent: null,
        goodWhenUp: true,
        shade: 3 as const,
      },
    ]
  }, [stats, prev])

  const previousLabel = useMemo(() => {
    const b = shiftMonth(period.year, period.month, -1)
    return formatPeriod(b.month, b.year)
  }, [period])

  return (
    <div>
      {/* Naming the month the arrows compare against saves anyone having to
          work out what a "▲6.4%" on the tiles below is measured from. */}
      <MonthStepper
        className="mb-1.5"
        label={formatPeriod(period.month, period.year)}
        sub={prev ? `vs ${previousLabel}` : undefined}
        onPrev={() => setPeriod(p => shiftMonth(p.year, p.month, -1))}
        onNext={() => setPeriod(p => shiftMonth(p.year, p.month, 1))}
        canNext={!atLatest}
        right={
          error ? (
            <Chip tone="bad">Unavailable</Chip>
          ) : loading ? (
            <Chip tone="neutral">Loading</Chip>
          ) : stats?.projected ? (
            <Chip tone="gold">Projected</Chip>
          ) : stats?.actual ? (
            <Chip tone={stats.locked ? 'dark' : 'neutral'}>{stats.locked ? 'Locked' : 'Open'}</Chip>
          ) : (
            <Chip tone="neutral">No cycle</Chip>
          )
        }
      />

      {error && (
        <div className="flex items-start gap-1.5 border border-[#EFCCCC] bg-[#FCECEC] px-2.5 py-2 mb-1.5">
          <TriangleAlert size={13} className="text-[#A93232] flex-shrink-0 mt-px" />
          <p className="flex-1 text-[11px] text-[#A93232] leading-snug">
            <span className="font-semibold">These figures did not load.</span> They are not zero — nothing was
            read. {error}
          </p>
          <button
            onClick={retry}
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#A93232] hover:text-[#7A1F1F] flex-shrink-0"
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      )}

      <div className={`grid grid-cols-2 lg:grid-cols-4 gap-1.5 ${error ? 'opacity-40' : ''}`}>
        {tiles.map(t => (
          <StatTile
            key={t.label}
            label={t.label}
            value={t.value}
            sub={t.sub}
            percent={t.percent}
            goodWhenUp={t.goodWhenUp}
            shade={t.shade}
            loading={loading}
            onClick={onSelect ? () => onSelect(t.key) : undefined}
          />
        ))}
      </div>
    </div>
  )
}
