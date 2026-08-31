'use client'

import React from 'react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { OUTLAY_COLORS } from '@/components/salary/adminUi'

export interface CycleTotals {
  /** How many rows these figures cover. */
  count: number
  /** Contracted base salary before anything is added or withheld. */
  base: number
  /** Task bonus plus any hand-added items — negative if the adjustments net out as a deduction. */
  additions: number
  /** PF + ESI. */
  statutory: number
  /** Loss of pay withheld for late arrivals, leave and half days. */
  lop: number
  /** What actually leaves the account: base + additions − statutory − lop. */
  net: number
}

/** Sum of the three slices the composition bar divides — the gross outlay. */
function grossOf(t: CycleTotals): number {
  return Math.max(0, t.net) + Math.max(0, t.statutory) + Math.max(0, t.lop)
}

/**
 * The money summary for a pay cycle, in one strip.
 *
 * Six figures and a composition bar in the vertical space the old three-stat
 * card used, because on this page the numbers are the point and every row of
 * chrome above the sheet is a row of staff pushed off the screen.
 *
 * The bar answers the one question the figures alone don't: how much of the
 * payroll is actually reaching people versus being withheld. It is a single
 * stacked bar of the gross outlay — take-home, statutory, loss of pay — never
 * a pie and never a second axis. Bonus is deliberately *not* a slice: it is an
 * addition to the gross, not a division of it, so it stays a plain figure.
 *
 * Every slice is named and given its own rupee figure in the tiles beneath, so
 * the colours are a second reading of the numbers rather than the only one.
 */
export default function CycleStatsStrip({ totals, filtered }: {
  totals: CycleTotals
  /** True when a search/filter is narrowing the sheet, so the label can say so. */
  filtered?: boolean
}) {
  const gross = grossOf(totals)
  const slices = [
    { key: 'net', label: 'Take-home', value: Math.max(0, totals.net), color: OUTLAY_COLORS.net },
    { key: 'statutory', label: 'Statutory', value: Math.max(0, totals.statutory), color: OUTLAY_COLORS.statutory },
    { key: 'lop', label: 'Loss of pay', value: Math.max(0, totals.lop), color: OUTLAY_COLORS.lop },
  ].filter(s => s.value > 0)

  const withheldPct = gross > 0 ? ((totals.statutory + totals.lop) / gross) * 100 : 0

  return (
    <div className="bg-white border-y sm:border border-[#E4E4E7] mb-2.5">
      {/* 1px hairlines in both directions: the grid's background shows through
          a one-pixel gap between white cells. `divide-x` can't do this — it
          wraps to three columns on a phone and would draw a stray rule down
          the card's own left edge on the second row. */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-[#F4F4F5]">
        <Cell label={filtered ? 'Shown' : 'Staff'} value={String(totals.count)} />
        <Cell label="Base total" value={formatINR(totals.base)} />
        <Cell label="Bonus & adj." value={formatINR(totals.additions)}
          tone={totals.additions > 0 ? OUTLAY_COLORS.bonus : totals.additions < 0 ? OUTLAY_COLORS.lop : undefined} />
        <Cell label="Statutory" value={formatINR(totals.statutory)} tone={totals.statutory > 0 ? OUTLAY_COLORS.statutory : undefined} swatch />
        <Cell label="Loss of pay" value={formatINR(totals.lop)} tone={totals.lop > 0 ? OUTLAY_COLORS.lop : undefined} swatch />
        <Cell label="Net payable" value={formatINR(totals.net)} strong />
      </div>

      {gross > 0 && (
        <div className="border-t border-[#F4F4F5] px-3 py-2.5">
          {/* Stacked composition of the gross outlay. The 2px gaps are drawn as
              surface-coloured borders rather than flex gaps so the segments
              always add up to exactly 100% of the track. */}
          <div className="flex h-2 w-full overflow-hidden bg-[#F4F4F5]" role="img"
            aria-label={slices.map(s => `${s.label} ${formatINR(s.value)}`).join(', ')}>
            {slices.map((s, i) => (
              <div
                key={s.key}
                title={`${s.label} · ${formatINR(s.value)} · ${((s.value / gross) * 100).toFixed(1)}%`}
                style={{
                  width: `${(s.value / gross) * 100}%`,
                  background: s.color,
                  borderLeft: i > 0 ? '2px solid #fff' : undefined,
                }}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            {slices.map(s => (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-[10px] text-[#71717A]">
                <span className="w-2 h-2 flex-shrink-0" style={{ background: s.color }} />
                {s.label}
                <span className="tabular-nums text-[#A1A1AA]">{((s.value / gross) * 100).toFixed(1)}%</span>
              </span>
            ))}
            <span className="ml-auto text-[10px] text-[#A1A1AA] tabular-nums">
              {withheldPct.toFixed(1)}% withheld of {formatINR(gross)} gross
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function Cell({ label, value, tone, strong, swatch }: {
  label: string
  value: string
  /** Colour for the figure — matches its slice in the bar where it has one. */
  tone?: string
  strong?: boolean
  swatch?: boolean
}) {
  return (
    <div className="px-2.5 py-2 min-w-0 bg-white">
      <p className={`${strong ? 'text-[15px]' : 'text-[13px]'} font-bold tabular-nums truncate text-[#18181B]`}
        style={tone ? { color: tone } : undefined}>
        {value}
      </p>
      <p className="text-[9px] text-[#A1A1AA] uppercase tracking-[0.12em] font-bold mt-0.5 truncate flex items-center gap-1">
        {swatch && tone && <span className="w-1.5 h-1.5 flex-shrink-0" style={{ background: tone }} />}
        {label}
      </p>
    </div>
  )
}
