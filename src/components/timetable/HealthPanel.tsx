'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp, Lightbulb,
  ArrowRight, HelpCircle, ArrowUp, ArrowDown, Minus,
} from 'lucide-react'
import type { HealthComponent, HealthReport } from '@/lib/timetable/health'
import { TAP, FOCUS } from './ui'

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

/**
 * The health score, its breakdown, and the ranked fixes.
 *
 * It recomputes on every change to the week, and that was the problem: the
 * score is dominated by coverage and hard clashes, so two good generates in a
 * row produce the same number and the panel looked frozen — indistinguishable
 * from a panel that had not refreshed at all. So it now SAYS that it refreshed:
 * a brief flash on each recompute and the change since the last one, including
 * when that change is zero.
 */
export default function HealthPanel({ report }: { report: HealthReport }) {
  const [open, setOpen] = useState(false)
  const color = BAND_COLOR[report.band]

  const prev = useRef<number | null>(null)
  const [delta, setDelta] = useState<number | null>(null)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    const before = prev.current
    prev.current = report.score
    if (before === null) return
    setDelta(report.score - before)
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 1000)
    return () => clearTimeout(t)
    // Keyed on the report object, not the score: an unchanged score after a
    // regenerate still has to read as "this is the new week's score".
  }, [report])

  return (
    <div
      className={`border bg-white transition-colors duration-700 ${
        flash ? 'border-[#B8983C] bg-[#FDFBF4]' : 'border-[#E4E4E7]'
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#FAFAF9] ${TAP} ${FOCUS}`}
      >
        <Activity size={15} className="flex-shrink-0" style={{ color }} aria-hidden />
        <span className="flex items-baseline gap-1 flex-shrink-0">
          <span className="text-lg font-bold tabular-nums leading-none" style={{ color }}>
            {report.score}
          </span>
          <span className="text-[10px] text-[#A1A1AA]">/100</span>
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest flex-shrink-0" style={{ color }}>
          {report.band === 'green' ? 'Healthy' : report.band === 'amber' ? 'Needs work' : 'Problems'}
        </span>
        {delta !== null && <Delta value={delta} />}

        {/* Mini bars — one per component. Kept at every width: it is the only
            shape in the header that says WHERE the score comes from. */}
        <div className="flex items-center gap-0.5 sm:gap-1 flex-1 min-w-[3rem] px-1">
          {report.components.map((c) => (
            <div
              key={c.key}
              className="flex-1 h-1.5 bg-[#F0F0F0]"
              title={`${c.label}: ${Math.round(c.score)}`}
            >
              <div
                className="h-full transition-[width] duration-500"
                style={{
                  width: `${c.score}%`,
                  background: c.score >= 80 ? '#059669' : c.score >= 50 ? '#d97706' : '#dc2626',
                }}
              />
            </div>
          ))}
        </div>

        {report.hardViolations > 0 && (
          <span className="text-[11px] text-rose-600 font-semibold flex-shrink-0 tabular-nums">
            {report.hardViolations} blocker{report.hardViolations > 1 ? 's' : ''}
          </span>
        )}
        {!open && report.suggestions.length > 0 && (
          <span className="hidden lg:inline-flex items-center gap-1 text-[11px] text-[#71717A] flex-shrink-0 max-w-[20rem] truncate">
            <Lightbulb size={12} className="text-[#B8983C] flex-shrink-0" aria-hidden />
            {report.suggestions[0].title}
          </span>
        )}
        {open
          ? <ChevronUp size={15} className="text-[#A1A1AA] flex-shrink-0" aria-hidden />
          : <ChevronDown size={15} className="text-[#A1A1AA] flex-shrink-0" aria-hidden />}
      </button>

      {open && (
        <>
          {/* What to do, ranked — above the breakdown, because it is the part
              that moves the score. */}
          {report.suggestions.length > 0 && (
            <div className="border-t border-[#E4E4E7] p-3 bg-[#FAFAF9]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-2 flex items-center gap-1.5">
                <Lightbulb size={12} className="text-[#B8983C]" aria-hidden /> What to do
              </p>
              <ol className="space-y-1.5">
                {report.suggestions.map((sg, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-4 h-4 mt-px bg-[#27272A] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#18181B]">{sg.title}</p>
                      <p className="text-xs text-[#52525B] leading-snug">{sg.detail}</p>
                      <p className="text-[11px] text-[#A1A1AA] inline-flex items-center gap-1">
                        <ArrowRight size={11} aria-hidden /> {sg.where}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="border-t border-[#E4E4E7] p-3 grid gap-3 md:gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252]">Breakdown</p>
              {report.components.map((c) => (
                <ComponentRow key={c.key} component={c} />
              ))}
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252]">Top issues</p>
              {report.issues.length === 0 ? (
                <p className="text-xs text-emerald-600">None.</p>
              ) : (
                report.issues.map((issue, i) => {
                  const Icon = SEVERITY_ICON[issue.severity]
                  return (
                    <div key={i} className="flex items-start gap-1.5 text-xs">
                      <Icon size={13} className={`${SEVERITY_COLOR[issue.severity]} flex-shrink-0 mt-0.5`} aria-hidden />
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

/** The change since the last recompute — zero included, so "no change" is said. */
function Delta({ value }: { value: number }) {
  const same = value === 0
  const up = value > 0
  const Icon = same ? Minus : up ? ArrowUp : ArrowDown
  return (
    <span
      title={same ? 'Unchanged since the last version of this week' : 'Change since the last version of this week'}
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums flex-shrink-0 ${
        same ? 'text-[#A1A1AA]' : up ? 'text-emerald-600' : 'text-rose-600'
      }`}
    >
      <Icon size={11} aria-hidden />
      {same ? 'same' : `${up ? '+' : ''}${value}`}
    </span>
  )
}

const barColor = (score: number) => (score >= 80 ? '#059669' : score >= 50 ? '#d97706' : '#dc2626')

/**
 * One breakdown bar, with an explainer on hover, focus or tap.
 *
 * A bare score with a one-word label is not actionable — "Spread 62" says
 * nothing about what spread is or what moves it. It is a real popover rather
 * than a `title` so it is readable, styleable, and reachable by keyboard.
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
        className={`flex items-center gap-2 text-xs cursor-help ${FOCUS}`}
        aria-describedby={show ? `help-${c.key}` : undefined}
      >
        <span className="w-24 sm:w-28 flex-shrink-0 text-[#52525B] inline-flex items-center gap-1">
          <span className="truncate">{c.label}</span>
          <HelpCircle size={10} className={`flex-shrink-0 transition-colors ${show ? 'text-[#71717A]' : 'text-[#D4D4D8]'}`} />
        </span>
        <div className="flex-1 h-2 bg-[#F0F0F0]">
          <div className="h-full transition-[width] duration-500" style={{ width: `${c.score}%`, background: barColor(c.score) }} />
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
