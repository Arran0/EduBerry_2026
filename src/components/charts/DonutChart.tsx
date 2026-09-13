'use client'

import React, { useState } from 'react'
import Link from 'next/link'

export interface DonutSegment {
  label: string
  value: number
  /** Any CSS colour — use the semantic palette in the desktop-ui-standardizer skill. */
  color: string
  /** Optional deep link to the filtered view this segment represents. */
  href?: string
  /** Exact value shown on hover, when `display` is abbreviated. */
  title?: string
  /** Pre-formatted value for the centre read-out; falls back to the raw number. */
  display?: string
}

interface DonutChartProps {
  segments: DonutSegment[]
  /** Outer diameter in px. */
  size?: number
  /** Ring thickness in px. */
  thickness?: number
  /** Big read-out in the hole (e.g. '68%'). */
  centerValue?: string
  /** Small caption under the read-out. */
  centerLabel?: string
  /** Sentence describing the chart for screen readers. */
  ariaLabel?: string
}

/**
 * Dependency-free SVG donut. Segments are drawn clockwise from 12 o'clock as
 * dashed arcs on a single circle, so there is no path maths to get wrong and no
 * charting library to pull in (matching LineChart and the tasks donut).
 *
 * Hovering (or focusing) a segment dims the others and swaps the centre
 * read-out for that segment's own label and value, which is what makes the panel
 * readable on desktop without a separate legend hunt.
 */
export default function DonutChart({
  segments,
  size = 132,
  thickness = 14,
  centerValue,
  centerLabel,
  ariaLabel,
}: DonutChartProps) {
  const [hover, setHover] = useState<number | null>(null)

  const total = segments.reduce((s, seg) => s + (Number(seg.value) || 0), 0)
  const r = (size - thickness) / 2
  const circumference = 2 * Math.PI * r
  const c = size / 2

  // Running offset so each arc starts where the previous one ended.
  let acc = 0
  const arcs = segments.map(seg => {
    const value = Number(seg.value) || 0
    const fraction = total > 0 ? value / total : 0
    const arc = { seg, fraction, offset: acc }
    acc += fraction
    return arc
  })

  const active = hover !== null ? arcs[hover] : null
  const headline = active
    ? (active.seg.display ?? String(active.seg.value))
    : (centerValue ?? '')
  const caption = active ? active.seg.label : (centerLabel ?? '')

  const describe = ariaLabel ?? segments
    .map(s => `${s.label}: ${s.display ?? s.value}`)
    .join(', ')

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={describe}
        /* -90° so the first segment starts at 12 o'clock rather than 3. */
        style={{ transform: 'rotate(-90deg)' }}
      >
        <circle
          cx={c} cy={c} r={r}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={thickness}
        />
        {total > 0 && arcs.map((arc, i) => {
          if (arc.fraction <= 0) return null
          const isDimmed = hover !== null && hover !== i
          const strokeWidth = hover === i ? thickness + 3 : thickness
          const circle = (
            <circle
              cx={c} cy={c} r={r}
              fill="none"
              stroke={arc.seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${arc.fraction * circumference} ${circumference}`}
              strokeDashoffset={-arc.offset * circumference}
              strokeLinecap="butt"
              opacity={isDimmed ? 0.28 : 1}
              style={{ transition: 'opacity 150ms ease, stroke-width 150ms ease' }}
            />
          )
          return (
            <g
              key={arc.seg.label}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(h => (h === i ? null : h))}
              style={{ cursor: arc.seg.href ? 'pointer' : 'default' }}
            >
              <title>{arc.seg.title ?? `${arc.seg.label}: ${arc.seg.display ?? arc.seg.value}`}</title>
              {circle}
            </g>
          )
        })}
      </svg>

      {/* Centre read-out — outside the rotated <svg> so the text stays upright. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2 text-center">
        {headline && (
          <span className="font-display text-[1.35rem] font-black leading-none text-slate-900 tabular-nums">
            {headline}
          </span>
        )}
        {caption && (
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 leading-tight line-clamp-2">
            {caption}
          </span>
        )}
      </div>
    </div>
  )
}

/** A focusable wrapper so a segment's deep link is reachable by keyboard too. */
export function DonutLegendLink({
  href, children, className = '',
}: { href?: string; children: React.ReactNode; className?: string }) {
  if (!href) return <div className={className}>{children}</div>
  return <Link href={href} className={className}>{children}</Link>
}
