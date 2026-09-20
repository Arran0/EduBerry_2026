'use client'

import React from 'react'
import Link from 'next/link'

export interface MetricRow {
  label: string
  value: number
  color: string
  /** Deep link to the filtered view this row represents. */
  href?: string
  /** Pre-formatted value (e.g. '₹12.4L'); falls back to a localised number. */
  display?: string
  /** Exact value for the hover tooltip, when `display` is abbreviated. */
  title?: string
}

interface MetricBarsProps {
  rows: MetricRow[]
  /** Bar scale denominator. Defaults to the sum of the rows. */
  max?: number
  /** Show each row's share of the total beside its value. */
  showPercent?: boolean
  /** Tighter rows for panels that also carry a footer. */
  dense?: boolean
}

/**
 * The readable half of an infographic panel: one row per segment with a
 * proportional bar, so magnitude and share are legible without reading the
 * donut. Rows deep-link to the same filtered views the mobile stat tiles do.
 */
export default function MetricBars({ rows, max, showPercent = false, dense = false }: MetricBarsProps) {
  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0)
  const scale = max ?? total

  return (
    <div className={dense ? 'space-y-2' : 'space-y-2.5'}>
      {rows.map(row => {
        const value = Number(row.value) || 0
        const pct = scale > 0 ? (value / scale) * 100 : 0
        const sharePct = total > 0 ? Math.round((value / total) * 100) : 0
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: row.color }}
                  aria-hidden
                />
                <span className="text-[11px] xl:text-xs font-semibold text-slate-500 truncate">
                  {row.label}
                </span>
              </span>
              <span className="flex items-baseline gap-1.5 flex-shrink-0">
                <span className="text-sm font-bold text-slate-800 tabular-nums leading-none">
                  {row.display ?? value.toLocaleString('en-IN')}
                </span>
                {showPercent && (
                  <span className="text-[10px] font-semibold text-slate-400 tabular-nums w-8 text-right">
                    {sharePct}%
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full bg-slate-100 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(pct, value > 0 ? 2 : 0)}%`,
                  backgroundColor: row.color,
                  transition: 'width 400ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              />
            </div>
          </>
        )

        const rowClass = `block px-2 py-1.5 -mx-2 transition-colors ${
          row.href ? 'hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60' : ''
        }`

        return row.href ? (
          <Link
            key={row.label}
            href={row.href}
            className={rowClass}
            title={row.title ?? `${row.label}: ${row.display ?? value.toLocaleString('en-IN')}`}
          >
            {body}
          </Link>
        ) : (
          <div
            key={row.label}
            className={rowClass}
            title={row.title ?? `${row.label}: ${row.display ?? value.toLocaleString('en-IN')}`}
          >
            {body}
          </div>
        )
      })}
    </div>
  )
}
