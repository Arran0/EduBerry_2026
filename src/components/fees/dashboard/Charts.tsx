'use client'

import React, { useId, useState } from 'react'
import { formatINR } from '@/components/fees/FeeCollectionSummary'

/**
 * Chart primitives for the fee dashboard, in plain SVG.
 *
 * No chart library is installed and one is not worth adding for four figures.
 * These follow the house data-viz rules rather than a library's defaults:
 *
 *   • Bars for magnitude, never pie. A payment-method split is a comparison of
 *     sizes, and people cannot compare angles.
 *   • One axis, always. Never two y-scales on one chart.
 *   • Every bar carries a direct value label. The palette's mid-tones sit under
 *     3:1 against a white surface, so the label is what makes the value legible
 *     rather than the fill.
 *   • Colour follows the entity, not its rank, so a filter that reorders the
 *     list does not repaint it.
 *   • Ageing uses an ORDINAL ramp — one hue, light to dark — because the
 *     buckets are ordered severity, not unrelated categories. Status colours
 *     are reserved and are not borrowed here.
 */

// Categorical slots, in the fixed validated order. Assigned by entity key,
// never cycled by position.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

/** Ordinal blue ramp, light → dark. The lightest step clears 2:1 on white. */
const AGE_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#256abf', '#184f95']

export function seriesColor(index: number): string {
  // Past eight, everything folds into one neutral rather than inventing a hue.
  return index < SERIES.length ? SERIES[index] : '#8a8a85'
}

// ── Horizontal bars ─────────────────────────────────────────────────────────

export interface BarDatum {
  key: string
  label: string
  value: number
  /** Secondary line under the label — a count, a percentage. */
  sub?: string
}

export function BarList({
  data, max, colorFor, emptyLabel = 'Nothing to show yet', onSelect,
}: {
  data: BarDatum[]
  max?: number
  colorFor?: (d: BarDatum, i: number) => string
  emptyLabel?: string
  onSelect?: (d: BarDatum) => void
}) {
  if (!data.length) {
    return <p className="text-xs text-slate-400 py-6 text-center">{emptyLabel}</p>
  }
  const ceiling = max ?? Math.max(...data.map(d => d.value), 1)

  return (
    <ul className="space-y-2.5">
      {data.map((d, i) => {
        const pct = ceiling > 0 ? Math.max(0.5, (d.value / ceiling) * 100) : 0
        const fill = colorFor?.(d, i) ?? seriesColor(i)
        const Row = onSelect ? 'button' : 'div'
        return (
          <li key={d.key}>
            <Row
              {...(onSelect ? { onClick: () => onSelect(d), type: 'button' as const } : {})}
              className={`w-full text-left block ${onSelect ? 'hover:opacity-80 transition-opacity' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-xs font-medium text-slate-700 truncate">{d.label}</span>
                {/* Direct label — the palette's mid-tones are below 3:1 on
                    white, so the number is what carries the value. */}
                <span className="text-xs font-semibold text-slate-800 tabular-nums shrink-0">
                  {formatINR(d.value)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${pct}%`, backgroundColor: fill }}
                />
              </div>
              {d.sub && <p className="text-[10px] text-slate-400 mt-1">{d.sub}</p>}
            </Row>
          </li>
        )
      })}
    </ul>
  )
}

// ── Ageing ──────────────────────────────────────────────────────────────────

export interface AgeingDatum { label: string; value: number }

export function AgeingBar({ data }: { data: AgeingDatum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total <= 0) {
    return <p className="text-xs text-slate-400 py-6 text-center">Nothing is outstanding.</p>
  }

  return (
    <div>
      {/* A 2px surface gap between segments, so adjacent fills never touch. */}
      <div className="flex h-3 rounded-full overflow-hidden gap-[2px] bg-slate-100">
        {data.map((d, i) => d.value > 0 && (
          <div
            key={d.label}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(d.value / total) * 100}%`, backgroundColor: AGE_RAMP[i] ?? AGE_RAMP.at(-1) }}
            title={`${d.label}: ${formatINR(d.value)}`}
          />
        ))}
      </div>

      {/* A legend is always present for more than one series, and every entry
          is directly labelled — identity is never carried by colour alone. */}
      <ul className="mt-3 space-y-1.5">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0 ring-2 ring-white"
                style={{ backgroundColor: AGE_RAMP[i] ?? AGE_RAMP.at(-1) }}
              />
              <span className="text-slate-600 truncate">{d.label}</span>
            </span>
            <span className="font-semibold text-slate-800 tabular-nums shrink-0">
              {formatINR(d.value)}
              <span className="text-slate-400 font-normal ml-1.5">
                {Math.round((d.value / total) * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Collection trend ────────────────────────────────────────────────────────

export interface TrendPoint { date: string; amount: number }

export function TrendLine({ data, height = 120 }: { data: TrendPoint[]; height?: number }) {
  const gradientId = useId()
  const [hover, setHover] = useState<number | null>(null)

  if (data.length < 2) {
    return <p className="text-xs text-slate-400 py-6 text-center">Not enough days to draw a trend yet.</p>
  }

  const max = Math.max(...data.map(d => d.amount), 1)
  const W = 600
  const H = height
  const PAD = 4

  const x = (i: number) => (i / (data.length - 1)) * (W - PAD * 2) + PAD
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2)

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.amount).toFixed(1)}`).join(' ')
  const area = `${line} L${x(data.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`
  const active = hover === null ? null : data[hover]

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Daily collection over the last ${data.length} days, peaking at ${formatINR(max)}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a78d6" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#2a78d6" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke="#2a78d6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {hover !== null && (
          <>
            <line x1={x(hover)} y1={PAD} x2={x(hover)} y2={H} stroke="#cbd5e1" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(data[hover].amount)} r="4" fill="#2a78d6" stroke="#fff" strokeWidth="2" />
          </>
        )}

        {/* Hit targets are wider than the marks, so a fingertip can reach one. */}
        {data.map((d, i) => (
          <rect
            key={d.date}
            x={x(i) - (W / data.length) / 2}
            y={0}
            width={W / data.length}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
        <span>{shortDate(data[0].date)}</span>
        {active ? (
          <span className="font-semibold text-slate-700">
            {shortDate(active.date)} · {formatINR(active.amount)}
          </span>
        ) : (
          <span>Peak {formatINR(max)}</span>
        )}
        <span>{shortDate(data[data.length - 1].date)}</span>
      </div>
    </div>
  )
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  })
}

// ── Stat tile ───────────────────────────────────────────────────────────────
// Some numbers are not charts. A single headline figure is one of them.

export function StatTile({
  label, value, sub, tone = 'default', onClick,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'good' | 'warn' | 'critical'
  onClick?: () => void
}) {
  const tones = {
    default: 'border-slate-200 bg-white',
    good: 'border-emerald-200 bg-emerald-50/50',
    warn: 'border-amber-200 bg-amber-50/50',
    critical: 'border-rose-200 bg-rose-50/50',
  }
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={`text-left rounded-xl border p-3.5 ${tones[tone]} ${onClick ? 'hover:border-slate-300 transition-colors' : ''}`}
    >
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-800 mt-1 tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-1.5">{sub}</p>}
    </Tag>
  )
}
