'use client'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'

export interface ChartSeries {
  name: string
  color: string
  /** One value per x label; null = no data point (gap). */
  values: (number | null)[]
  /** Draw the line dashed — for reference lines (a benchmark, a top score). */
  dashed?: boolean
  /** Fill a soft gradient under the line. Best on one series only. */
  area?: boolean
  /** Optional per-point note shown after the value in the tooltip (e.g. who). */
  detail?: (string | null)[]
}

interface LineChartProps {
  labels: string[]
  series: ChartSeries[]
  /** Fixed y-axis maximum (e.g. 100 for percentages). Auto when omitted. */
  yMax?: number
  /** Suffix appended to value labels/tooltip, e.g. '%' or ' EP'. */
  unit?: string
  height?: number
  /** A column to mark as selected (a soft band behind it). */
  activeIndex?: number | null
  /** Makes each column clickable, e.g. to pick that month. */
  onSelectIndex?: (i: number) => void
  /** Accessible name for the chart. */
  ariaLabel?: string
}

type Pt = { x: number; y: number }

/** Smooth path through points without overshooting (monotone cubic, Fritsch–
 *  Carlson), so a line never dips below zero between two zero months. */
function monotonePath(pts: Pt[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`
  const n = pts.length
  const dx: number[] = [], m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    m[i] = (pts[i + 1].y - pts[i].y) / (dx[i] || 1)
  }
  const t: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  t[n - 1] = m[n - 2]
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b
    if (h > 9) { const s = 3 / Math.sqrt(h); t[i] = s * a * m[i]; t[i + 1] = s * b * m[i] }
  }
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3
    d += ` C${pts[i].x + c},${pts[i].y + t[i] * c} ${pts[i + 1].x - c},${pts[i + 1].y - t[i + 1] * c} ${pts[i + 1].x},${pts[i + 1].y}`
  }
  return d
}

/** Runs of consecutive non-null points — a null breaks the line. */
function segments(values: (number | null)[], xAt: (i: number) => number, yAt: (v: number) => number): Pt[][] {
  const out: Pt[][] = []
  let cur: Pt[] = []
  values.forEach((v, i) => {
    if (v == null) { if (cur.length) out.push(cur); cur = []; return }
    cur.push({ x: xAt(i), y: yAt(v) })
  })
  if (cur.length) out.push(cur)
  return out
}

/** A y-axis maximum that lands on a round number, so ticks read 0/25/50/75/100
 *  rather than 0/29/58/87/116. */
function niceMax(v: number): number {
  if (v <= 0) return 4
  const raw = v / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(s => s * pow >= raw) ?? 10
  return Math.round(step * pow * 4 * 1000) / 1000
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

// Dependency-free SVG line chart: gridlines, axis labels, smooth lines, an
// optional area wash, and a column tooltip listing every series at that x.
// Matches the hand-rolled SVG approach used elsewhere in the app (see
// tasks/TaskAnalytics donut) so we avoid pulling in a charting library.
export default function LineChart({
  labels, series, yMax, unit = '', height = 220, activeIndex = null, onSelectIndex, ariaLabel,
}: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const gradId = useId().replace(/:/g, '')

  // Drawn at the container's real width, so labels keep their size on a phone
  // instead of shrinking with a scaled-down viewBox.
  const boxRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(640)
  const empty = labels.length === 0
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width)
      if (w > 0) setW(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [empty])

  const H = height
  const padL = 34
  const padR = 12
  const padT = 12
  const padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const n = labels.length

  const max = useMemo(() => {
    if (yMax) return yMax
    const all = series.flatMap(s => s.values.filter((v): v is number => v != null))
    return niceMax(all.length ? Math.max(...all) : 0)
  }, [series, yMax])

  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1))
  const yAt = (v: number) => padT + plotH - (plotH * v) / max
  const colW = n <= 1 ? plotW : plotW / (n - 1)

  const tickVals = Array.from({ length: 5 }, (_, k) => (max * k) / 4)

  if (n === 0) {
    return <p className="text-sm text-slate-400 text-center py-8">No data to chart yet.</p>
  }

  const step = Math.ceil(n / Math.max(2, Math.floor(plotW / 70)))
  const shown = hover ?? null

  return (
    <div className="w-full">
      <div ref={boxRef} className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block" role="img" aria-label={ariaLabel}>
          <defs>
            {series.map((s, si) => s.area && (
              <linearGradient key={si} id={`${gradId}-a${si}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          {/* Selected column */}
          {activeIndex != null && activeIndex >= 0 && activeIndex < n && (
            <rect
              x={Math.min(W - Math.min(colW, 64), Math.max(padL - 6, xAt(activeIndex) - Math.min(colW, 64) / 2))}
              y={padT - 6}
              width={Math.min(colW, 64)}
              height={plotH + 12}
              rx={10}
              fill="#f1f5f9"
            />
          )}

          {/* Gridlines + y labels */}
          {tickVals.map((tv, k) => (
            <g key={k}>
              <line
                x1={padL} y1={yAt(tv)} x2={W - padR} y2={yAt(tv)}
                stroke={k === 0 ? '#e2e8f0' : '#f1f5f9'} strokeWidth={1}
                strokeDasharray={k === 0 ? undefined : '3 4'}
              />
              <text x={padL - 8} y={yAt(tv) + 3} textAnchor="end" fontSize={10} fill="#94a3b8">
                {fmt(Math.round(tv * 10) / 10)}
              </text>
            </g>
          ))}

          {/* x labels (thinned if crowded) */}
          {labels.map((lab, i) => {
            if (i % step !== 0 && i !== n - 1) return null
            const active = i === activeIndex
            // The end labels hug the plot's edges rather than spilling past them.
            const anchor = n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'
            const maxChars = Math.max(4, Math.floor((plotW / Math.ceil(n / step)) / 6))
            return (
              <text
                key={i} x={xAt(i) + (anchor === 'start' ? -4 : anchor === 'end' ? 4 : 0)} y={H - padB + 18} textAnchor={anchor} fontSize={10}
                fill={active ? '#0f172a' : '#94a3b8'} fontWeight={active ? 600 : 400}
              >
                {lab.length > maxChars ? lab.slice(0, maxChars - 1) + '…' : lab}
              </text>
            )
          })}

          {/* Hover guide */}
          {shown != null && (
            <line x1={xAt(shown)} y1={padT} x2={xAt(shown)} y2={padT + plotH} stroke="#cbd5e1" strokeWidth={1} />
          )}

          {/* Series */}
          {series.map((s, si) => {
            const segs = segments(s.values, xAt, yAt)
            return (
              <g key={si}>
                {s.area && segs.map((seg, k) => seg.length > 1 && (
                  <path
                    key={`a${k}`}
                    d={`${monotonePath(seg)} L${seg[seg.length - 1].x},${padT + plotH} L${seg[0].x},${padT + plotH} Z`}
                    fill={`url(#${gradId}-a${si})`}
                  />
                ))}
                {segs.map((seg, k) => (
                  <path
                    key={k} d={monotonePath(seg)} fill="none" stroke={s.color}
                    strokeWidth={s.dashed ? 1.75 : 2.25} strokeLinecap="round" strokeLinejoin="round"
                    strokeDasharray={s.dashed ? '5 5' : undefined}
                  />
                ))}
                {s.values.map((v, i) => {
                  if (v == null) return null
                  const on = shown === i
                  // Points stay quiet until their column is hovered, except a
                  // lone point (no line to show it) and the selected column.
                  const lone = s.values[i - 1] == null && s.values[i + 1] == null
                  if (!on && !lone && i !== activeIndex) return null
                  return (
                    <circle
                      key={i} cx={xAt(i)} cy={yAt(v)} r={on ? 4.5 : 3.5}
                      fill="white" stroke={s.color} strokeWidth={2}
                    />
                  )
                })}
              </g>
            )
          })}

          {/* Hit columns — one per label, full height */}
          {labels.map((_, i) => (
            <rect
              key={i}
              x={n <= 1 ? padL : xAt(i) - colW / 2}
              y={0}
              width={colW}
              height={H}
              fill="transparent"
              style={{ cursor: onSelectIndex ? 'pointer' : 'default' }}
              onMouseEnter={() => setHover(i)}
              onClick={() => { setHover(i); onSelectIndex?.(i) }}
            />
          ))}
        </svg>

        {/* Tooltip — HTML so it stays crisp at any width */}
        {shown != null && (() => {
          const leftPct = (xAt(shown) / W) * 100
          const rows = series
            .map(s => ({ s, v: s.values[shown], d: s.detail?.[shown] ?? null }))
            .filter(r => r.v != null)
          if (rows.length === 0) return null
          return (
            <div
              className="pointer-events-none absolute top-1 z-10 w-max min-w-[9rem] max-w-[16rem] rounded-xl bg-slate-900/95 text-white px-3 py-2 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.6)]"
              style={{
                left: `${leftPct}%`,
                transform: `translateX(${leftPct > 66 ? 'calc(-100% - 10px)' : leftPct < 34 ? '10px' : '-50%'})`,
              }}
            >
              <p className="text-[11px] font-semibold text-white/70 mb-1">{labels[shown]}</p>
              {rows.map(({ s, v, d }) => (
                <p key={s.name} className="flex items-start gap-2 text-[12px] leading-snug py-0.5">
                  <span className="keep-round mt-[5px] w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="text-white/75">{s.name}</span>
                    {d && <span className="block text-[11px] text-white/55">{d}</span>}
                  </span>
                  <span className="font-semibold tabular-nums">{fmt(v as number)}{unit}</span>
                </p>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Legend */}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
          {series.map((s, si) => (
            <span key={si} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
              <svg width="16" height="6" aria-hidden className="flex-shrink-0">
                <line x1="1" y1="3" x2="15" y2="3" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeDasharray={s.dashed ? '3 3' : undefined} />
              </svg>
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
