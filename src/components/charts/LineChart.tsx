'use client'

import React, { useState } from 'react'

export interface ChartSeries {
  name: string
  color: string
  /** One value per x label; null = no data point (gap). */
  values: (number | null)[]
}

interface LineChartProps {
  labels: string[]
  series: ChartSeries[]
  /** Fixed y-axis maximum (e.g. 100 for percentages). Auto when omitted. */
  yMax?: number
  /** Suffix appended to value labels/tooltip, e.g. '%' or ' EP'. */
  unit?: string
  height?: number
}

// Dependency-free SVG line chart: gridlines, axis labels, polylines, dots and a
// hover tooltip. Matches the hand-rolled SVG approach used elsewhere in the app
// (see tasks/TaskAnalytics donut) so we avoid pulling in a charting library.
export default function LineChart({
  labels, series, yMax, unit = '', height = 220,
}: LineChartProps) {
  const [hover, setHover] = useState<{ s: number; i: number } | null>(null)

  const W = 640
  const H = height
  const padL = 38
  const padR = 14
  const padT = 14
  const padB = 34
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const allValues = series.flatMap(s => s.values.filter((v): v is number => v != null))
  const computedMax = yMax ?? (allValues.length ? Math.max(...allValues) : 0)
  const max = computedMax > 0 ? computedMax : 1
  const n = labels.length

  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1))
  const yAt = (v: number) => padT + plotH - (plotH * v) / max

  const yTicks = 4
  const tickVals = Array.from({ length: yTicks + 1 }, (_, k) => (max * k) / yTicks)

  if (n === 0) {
    return <p className="text-sm text-slate-400 text-center py-8">No data to chart yet.</p>
  }

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }} role="img">
        {/* Gridlines + y labels */}
        {tickVals.map((tv, k) => (
          <g key={k}>
            <line x1={padL} y1={yAt(tv)} x2={W - padR} y2={yAt(tv)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={padL - 6} y={yAt(tv) + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
              {Math.round(tv)}
            </text>
          </g>
        ))}

        {/* x labels (thinned if crowded) */}
        {labels.map((lab, i) => {
          const step = Math.ceil(n / 8)
          if (i % step !== 0 && i !== n - 1) return null
          return (
            <text key={i} x={xAt(i)} y={H - padB + 16} textAnchor="middle" fontSize={9} fill="#94a3b8">
              {lab.length > 10 ? lab.slice(0, 9) + '…' : lab}
            </text>
          )
        })}

        {/* Series */}
        {series.map((s, si) => {
          const pts = s.values
            .map((v, i) => (v == null ? null : `${xAt(i)},${yAt(v)}`))
            .filter((p): p is string => p != null)
            .join(' ')
          return (
            <g key={si}>
              {pts && <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {s.values.map((v, i) =>
                v == null ? null : (
                  <circle
                    key={i}
                    cx={xAt(i)} cy={yAt(v)}
                    r={hover && hover.s === si && hover.i === i ? 5 : 3}
                    fill="white" stroke={s.color} strokeWidth={2}
                    onMouseEnter={() => setHover({ s: si, i })}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'pointer' }}
                  />
                )
              )}
            </g>
          )
        })}

        {/* Tooltip */}
        {hover && series[hover.s]?.values[hover.i] != null && (() => {
          const v = series[hover.s].values[hover.i] as number
          const x = xAt(hover.i)
          const y = yAt(v)
          const label = `${series[hover.s].name}: ${v}${unit}`
          const w = Math.max(54, label.length * 5.4)
          const tx = Math.min(Math.max(x - w / 2, padL), W - padR - w)
          const ty = Math.max(y - 30, 2)
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width={w} height={20} rx={4} fill="#0f172a" opacity={0.92} />
              <text x={tx + w / 2} y={ty + 13} textAnchor="middle" fontSize={9} fill="white">{label}</text>
            </g>
          )
        })()}
      </svg>

      {/* Legend */}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
          {series.map((s, si) => (
            <span key={si} className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <span className="w-3 h-0.5 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
