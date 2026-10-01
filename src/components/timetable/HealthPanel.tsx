'use client'

import React, { useState } from 'react'
import { Activity, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp, Lightbulb, ArrowRight, HelpCircle } from 'lucide-react'
import type { HealthComponent, HealthReport } from '@/lib/timetable/health'

const BAND_COLOR: Record<HealthReport['band'], string> = {
  green: '#059669',
  amber: '#d97706',
  red: '#dc2626',
}

const SEVERITY_ICON = {
  critical: AlertTriangle,
  warning: AlertCircle,
  info: Info,
} as const

const SEVERITY_COLOR = {
  critical: 'text-rose-600',
  warning: 'text-amber-600',
  info: 'text-[#71717A]',
} as const

// Compact health-score panel: the score, a component breakdown, and the top issues.
export default function HealthPanel({ report }: { report: HealthReport }) {
  const [open, setOpen] = useState(false)
  const color = BAND_COLOR[report.band]

  return (
    <div className="border border-[#E4E4E7] bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#FAFAF9] transition-colors"
      >
        <Activity size={16} className="flex-shrink-0" style={{ color }} />
        <div className="flex items-baseline gap-1.5 flex-shrink-0">
          <span className="text-xl font-bold tabular-nums" style={{ color }}>{report.score}</span>
          <span className="text-[11px] text-[#A1A1AA]">/100</span>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest flex-shrink-0" style={{ color }}>
          {report.band === 'green' ? 'Healthy' : report.band === 'amber' ? 'Needs work' : 'Problems'}
        </span>
        {/* Inline mini bars */}
        <div className="hidden sm:flex items-center gap-1 flex-1 min-w-0 px-2">
          {report.components.map((c) => (
            <div key={c.key} className="flex-1 h-1.5 bg-[#F0F0F0]" title={`${c.label}: ${Math.round(c.score)}`}>
              <div className="h-full" style={{ width: `${c.score}%`, background: c.score >= 80 ? '#059669' : c.score >= 50 ? '#d97706' : '#dc2626' }} />
            </div>
          ))}
        </div>
        {report.hardViolations > 0 && (
          <span className="text-[11px] text-rose-600 font-medium flex-shrink-0">
            {report.hardViolations} blocker{report.hardViolations > 1 ? 's' : ''}
          </span>
        )}
        {/* The headline fix, so the panel is useful without opening it. */}
        {!open && report.suggestions.length > 0 && (
          <span className="hidden lg:inline-flex items-center gap-1 text-[11px] text-[#71717A] flex-shrink-0 max-w-[22rem] truncate">
            <Lightbulb size={12} className="text-[#B8983C] flex-shrink-0" />
            {report.suggestions[0].title}
          </span>
        )}
        {open ? <ChevronUp size={15} className="text-[#A1A1AA] flex-shrink-0" /> : <ChevronDown size={15} className="text-[#A1A1AA] flex-shrink-0" />}
      </button>

      {open && (
        <>
        {/* What to do, ranked. Shown above the breakdown because it is the part
            that changes the score. */}
        {report.suggestions.length > 0 && (
          <div className="border-t border-[#E4E4E7] p-3 bg-[#FAFAF9]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-2 flex items-center gap-1.5">
              <Lightbulb size={12} className="text-[#B8983C]" /> What to do
            </p>
            <ol className="space-y-2">
              {report.suggestions.map((sg, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-4 h-4 mt-px bg-[#27272A] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#18181B]">{sg.title}</p>
                    <p className="text-xs text-[#52525B] leading-snug mt-0.5">{sg.detail}</p>
                    <p className="text-[11px] text-[#A1A1AA] mt-0.5 inline-flex items-center gap-1">
                      <ArrowRight size={11} /> {sg.where}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="border-t border-[#E4E4E7] p-3 grid gap-4 md:grid-cols-2">
          {/* Component breakdown */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252]">Breakdown</p>
            {report.components.map((c) => (
              <ComponentRow key={c.key} component={c} />
            ))}
            <p className="text-[10px] text-[#A1A1AA] pt-0.5">
              Hover a category for what it measures and how much it counts.
            </p>
          </div>

          {/* Top issues */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252]">Top issues</p>
            {report.issues.length === 0 ? (
              <p className="text-xs text-emerald-600">No issues — this timetable looks great.</p>
            ) : (
              report.issues.map((issue, i) => {
                const Icon = SEVERITY_ICON[issue.severity]
                return (
                  <div key={i} className="flex items-start gap-1.5 text-xs">
                    <Icon size={13} className={`${SEVERITY_COLOR[issue.severity]} flex-shrink-0 mt-0.5`} />
                    <span className="text-[#52525B]">
                      {issue.message}
                      {issue.fix && <span className="text-[#A1A1AA]"> {issue.fix}</span>}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
        </>
      )}
    </div>
  )
}

const barColor = (score: number) => (score >= 80 ? '#059669' : score >= 50 ? '#d97706' : '#dc2626')

/**
 * One breakdown bar, with an explainer footnote on hover.
 *
 * A bare score with a one-word label is not actionable — "Spread 62" says
 * nothing about what spread is or what moves it. The footnote carries both, and
 * it is a real popover rather than a `title` attribute so it is readable, can be
 * styled, and appears on keyboard focus and on tap as well as on hover.
 */
function ComponentRow({ component: c }: { component: HealthComponent }) {
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <div
        tabIndex={0}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onClick={() => setShow((v) => !v)}
        className="flex items-center gap-2 text-xs cursor-help outline-none focus-visible:ring-1 focus-visible:ring-[#A1A1AA] rounded-sm"
        aria-describedby={show ? `help-${c.key}` : undefined}
      >
        <span className="w-28 flex-shrink-0 text-[#52525B] inline-flex items-center gap-1">
          <span className="truncate">{c.label}</span>
          <HelpCircle size={10} className={`flex-shrink-0 transition-colors ${show ? 'text-[#71717A]' : 'text-[#D4D4D8]'}`} />
        </span>
        <div className="flex-1 h-2 bg-[#F0F0F0]">
          <div className="h-full transition-[width] duration-300" style={{ width: `${c.score}%`, background: barColor(c.score) }} />
        </div>
        <span className="w-8 text-right tabular-nums text-[#71717A]">{Math.round(c.score)}</span>
      </div>

      {show && (
        <div
          id={`help-${c.key}`}
          role="tooltip"
          className="absolute left-0 right-0 top-full mt-1 z-20 border border-[#D4D4D8] bg-[#18181B] text-white px-2.5 py-2 shadow-lg"
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#B8983C] flex items-baseline justify-between gap-2">
            <span>{c.label}</span>
            <span className="font-normal normal-case tracking-normal text-[#A1A1AA] tabular-nums">
              {Math.round(c.weight * 100)}% of the score
            </span>
          </p>
          <p className="text-[11px] leading-snug mt-1 text-[#E4E4E7]">{c.help}</p>
          {c.lever && (
            <p className="text-[11px] leading-snug mt-1.5 pt-1.5 border-t border-white/15 text-[#A1A1AA]">{c.lever}</p>
          )}
        </div>
      )}
    </div>
  )
}
