'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Collection Center's four drawings.
//
// All four are SVG or CSS grid, no chart library — the shapes are simple
// enough that a dependency would cost more than it saved, and each one has to
// keep working for a reader whose amounts are masked. That is the constraint
// that shaped them: a bar whose length comes from a NULL rupee figure would
// collapse to nothing and read as "no dues", which is a lie. So where a value
// may be masked, the bar is sized by a count the reader is allowed to see and
// only the label goes to dots.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import { ADMIN, inr } from '@/components/fees/ui'
import { AGING_LABEL, AGING_ORDER, type AgingRow, type CollectionDayRow, type DefaulterClassRow } from '@/lib/fees/reports'
import { gradeLabel } from '@/lib/grades'

// ── The efficiency bar ────────────────────────────────────────────────────
/**
 * Collected against payable, with a marker showing how far into the session we
 * are. 62% collected is neither good nor bad on its own; 62% collected with
 * the year half gone is good, and with the year nearly over it is a problem.
 * The marker is the whole point of the drawing.
 */
export function EfficiencyBar({
  efficiency, sessionProgress,
}: { efficiency: number | null; sessionProgress: number | null }) {
  const pct = efficiency === null ? 0 : Math.max(0, Math.min(100, efficiency))
  const marker = sessionProgress === null ? null : Math.max(0, Math.min(100, sessionProgress))
  const ahead = marker !== null && efficiency !== null && efficiency >= marker

  return (
    <div className={`${ADMIN.card} p-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={ADMIN.label}>Collection efficiency</span>
        <span className="text-xl font-bold text-[#27272A]">
          {efficiency === null ? '—' : `${efficiency}%`}
        </span>
      </div>

      <div className="relative mt-3 h-3 bg-[#F4F4F5]">
        <div className={`h-full ${ahead ? 'bg-emerald-500' : 'bg-[#B8983C]'}`}
             style={{ width: `${pct}%` }} />
        {marker !== null && (
          <div className="absolute top-[-4px] bottom-[-4px] w-px bg-[#27272A]"
               style={{ left: `${marker}%` }}
               title={`The session is ${marker}% through`} />
        )}
      </div>

      <p className="mt-2 text-[11px] text-[#71717A] leading-relaxed">
        {marker === null
          ? 'Set the session start and end dates to see how this compares with the calendar.'
          : efficiency === null
            ? `The session is ${marker}% through.`
            : ahead
              ? `The session is ${marker}% through, so collection is running ahead of the calendar.`
              : `The session is ${marker}% through, so collection is behind the calendar by ${(marker - efficiency).toFixed(1)} points.`}
      </p>
    </div>
  )
}

// ── The aging cliff ───────────────────────────────────────────────────────
/**
 * Dues stacked by how late they are. Bars are sized by the number of bills,
 * not by the rupees, so the shape survives masking; the rupee figure rides
 * alongside as a label.
 */
export function AgingCliff({ rows, showAmounts }: { rows: AgingRow[]; showAmounts: boolean }) {
  const byBucket = new Map(rows.map(r => [r.bucket, r]))
  const peak = Math.max(1, ...rows.map(r => r.bills))

  return (
    <div className={`${ADMIN.card} p-4`}>
      <div className="flex items-center justify-between">
        <span className={ADMIN.label}>How late the dues are</span>
        <span className="text-[11px] text-[#A1A1AA]">Bar height is the number of bills</span>
      </div>

      <div className="mt-4 flex items-end gap-2 h-40">
        {AGING_ORDER.map(bucket => {
          const row = byBucket.get(bucket)
          const bills = row?.bills ?? 0
          const height = Math.round((bills / peak) * 100)
          const late = bucket !== 'not_yet_due'
          return (
            <div key={bucket} className="flex-1 flex flex-col items-center justify-end h-full">
              <span className="text-[11px] font-semibold text-[#27272A] mb-1">
                {bills || ''}
              </span>
              <div className={
                    bills === 0 ? 'w-full bg-[#F4F4F5]'
                      : bucket === 'd90_plus' ? 'w-full bg-rose-500'
                      : late ? 'w-full bg-[#B8983C]'
                      : 'w-full bg-[#D4D4D8]'}
                   title={`${AGING_LABEL[bucket]} · ${bills} bills`}
                   style={{ height: `${Math.max(bills > 0 ? 4 : 2, height)}%` }} />
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex gap-2">
        {AGING_ORDER.map(bucket => {
          const row = byBucket.get(bucket)
          return (
            <div key={bucket} className="flex-1 text-center">
              <div className="text-[10px] text-[#71717A] leading-tight">{AGING_LABEL[bucket]}</div>
              <div className="text-[11px] font-semibold text-[#27272A]">
                {row ? inr(row.outstanding, showAmounts) : '—'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── The defaulter heatmap ─────────────────────────────────────────────────
/**
 * Not just how much is owed, but where. Colour comes from the share of that
 * class's students who owe something — a proportion, which a masked reader is
 * allowed to see and which compares a class of twelve fairly against one of
 * forty.
 */
export function DefaulterHeatmap({
  rows, showAmounts, onPick,
}: {
  rows: DefaulterClassRow[]
  showAmounts: boolean
  onPick?: (row: DefaulterClassRow) => void
}) {
  const peak = Math.max(1, ...rows.map(r => r.students_owing))
  const sorted = [...rows].sort((a, b) =>
    (a.grade ?? 99) - (b.grade ?? 99) || (a.section ?? '').localeCompare(b.section ?? ''))

  if (sorted.length === 0) {
    return (
      <div className={`${ADMIN.card} p-8 text-center`}>
        <p className="text-sm text-[#A1A1AA]">Nothing outstanding in any class.</p>
      </div>
    )
  }

  return (
    <div className={`${ADMIN.card} p-4`}>
      <div className="flex items-center justify-between">
        <span className={ADMIN.label}>Where the dues are</span>
        <span className="text-[11px] text-[#A1A1AA]">Darker is more students owing</span>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
        {sorted.map(r => {
          const intensity = r.students_owing / peak
          return (
            <button key={`${r.grade}-${r.section}`}
                    onClick={onPick ? () => onPick(r) : undefined}
                    title={`${r.students_owing} students, ${r.bills} bills`}
                    className="p-2 text-left border border-[#E4E4E7] hover:border-[#27272A] transition-colors"
                    style={{ backgroundColor: heat(intensity) }}>
              <div className={`text-xs font-bold ${intensity > 0.55 ? 'text-white' : 'text-[#27272A]'}`}>
                {gradeLabel(r.grade)}{r.section ?? ''}
              </div>
              <div className={`text-[10px] ${intensity > 0.55 ? 'text-white/80' : 'text-[#71717A]'}`}>
                {r.students_owing} owing
              </div>
              <div className={`text-[11px] font-semibold ${intensity > 0.55 ? 'text-white' : 'text-[#27272A]'}`}>
                {inr(r.outstanding, showAmounts)}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Zinc through to the honey gold, so the grid stays in the module's palette. */
function heat(t: number): string {
  const stops: [number, number, number][] = [
    [244, 244, 245], [228, 228, 231], [212, 212, 216], [184, 152, 60], [140, 112, 40],
  ]
  const scaled = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(scaled))
  const f = scaled - i
  const [r1, g1, b1] = stops[i]
  const [r2, g2, b2] = stops[i + 1]
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f)
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`
}

// ── The year calendar ─────────────────────────────────────────────────────
/**
 * A cell per day of the session, coloured by how many receipts were written.
 * Receipts rather than rupees again, for the same reason as the cliff: the
 * pattern of busy and quiet days is the thing worth seeing, and it is the same
 * pattern whether or not the reader may see the amounts.
 */
export function CollectionCalendar({
  rows, startsOn, endsOn, showAmounts,
}: {
  rows: CollectionDayRow[]
  startsOn: string
  endsOn: string
  showAmounts: boolean
}) {
  const byDay = new Map<string, { receipts: number; collected: number | null }>()
  rows.forEach(r => {
    const seen = byDay.get(r.day) ?? { receipts: 0, collected: null }
    byDay.set(r.day, {
      receipts: seen.receipts + r.receipts,
      collected: r.collected === null
        ? seen.collected
        : (seen.collected ?? 0) + Number(r.collected),
    })
  })

  const days = daysBetweenInclusive(startsOn, endsOn)
  const peak = Math.max(1, ...Array.from(byDay.values()).map(v => v.receipts))
  const best = rows.length === 0 ? null
    : Array.from(byDay.entries()).sort((a, b) => b[1].receipts - a[1].receipts)[0]

  return (
    <div className={`${ADMIN.card} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={ADMIN.label}>Every day of the session</span>
        {best && (
          <span className="text-[11px] text-[#71717A]">
            Busiest day {best[0]} · {best[1].receipts} receipts
            {best[1].collected !== null && ` · ${inr(best[1].collected, showAmounts)}`}
          </span>
        )}
      </div>

      <div className="mt-3 overflow-x-auto">
        <div className="grid grid-flow-col gap-[3px]"
             style={{ gridTemplateRows: 'repeat(7, 10px)' }}>
          {days.map(day => {
            const v = byDay.get(day)
            const t = v ? v.receipts / peak : 0
            return (
              <div key={day}
                   title={v
                     ? `${day} · ${v.receipts} receipts${v.collected !== null ? ` · ${inr(v.collected, showAmounts)}` : ''}`
                     : `${day} · nothing`}
                   className="w-[10px] h-[10px]"
                   style={{ backgroundColor: v ? heat(0.15 + t * 0.85) : '#FAFAFA' }} />
            )
          })}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-[#A1A1AA]">
        One square per day, top to bottom by week. Darker squares are busier counters.
      </p>
    </div>
  )
}

/**
 * Every date from start to end.
 *
 * Built on epoch days rather than by mutating a Date, for the same reason the
 * rest of the module does: a `setDate` loop across a DST boundary in a browser
 * set to another zone silently repeats or skips a day.
 */
function daysBetweenInclusive(from: string, to: string): string[] {
  const day = (iso: string) => Math.floor(Date.UTC(
    Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000)
  const iso = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10)
  const start = day(from)
  const end = day(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  // A session is a year; anything longer is bad data, and drawing 4,000 cells
  // would freeze the tab rather than tell anyone anything.
  const span = Math.min(end - start, 400)
  return Array.from({ length: span + 1 }, (_, i) => iso(start + i))
}
