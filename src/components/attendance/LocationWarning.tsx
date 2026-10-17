'use client'

/**
 * The visible half of "an unverified punch still counts".
 *
 * A punch accepted without a confirmed on-campus location — off campus,
 * location access off, or the device could not get a fix — is written like any
 * other punch. What keeps that honest is that it never *looks* like any other
 * punch: the same warning, derived once in describeLocationWarning(), renders
 * here for the staff member on their own card and for the office on the
 * report. Neither side gets a version of the day the other cannot see.
 *
 * Two tones for three kinds — see LocationWarningKind for the severity
 * ordering that picks one when a day has more than one:
 *
 *   red    off campus, or location access off. In both, either a reading
 *          spoke against presence or nothing was allowed to speak for it, and
 *          the record says so plainly.
 *   amber  the device was asked and could not answer. Nobody did anything
 *          wrong, so the notice states the fact and stops there.
 *
 * Getting this backwards — red for the blameless case, or amber for one that
 * is effectively a fence opt-out — would make the flag worthless in both
 * directions, so the tone is driven off `warning.strict` and nothing else.
 */

import React from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, ShieldAlert, X, Info } from 'lucide-react'
import type { LocationWarning } from '@/lib/attendance'

interface Tone {
  chip: string
  chipHover: string
  panel: string
  badge: string
  icon: string
  title: string
  body: string
  bullet: string
  rule: string
  foot: string
}

const TONES: Record<'strict' | 'soft', Tone> = {
  strict: {
    chip: 'bg-red-50 border-red-300 text-red-700',
    chipHover: 'hover:bg-red-100 hover:border-red-400',
    panel: 'bg-red-50/80 border-red-200',
    badge: 'bg-red-100 border-red-300/70 text-red-600',
    icon: 'text-red-600',
    title: 'text-red-900',
    body: 'text-red-800/90',
    bullet: 'bg-red-400',
    rule: 'border-red-200/70',
    foot: 'text-red-700/90',
  },
  soft: {
    chip: 'bg-amber-50 border-amber-300/80 text-amber-700',
    chipHover: 'hover:bg-amber-100 hover:border-amber-400',
    panel: 'bg-amber-50/70 border-amber-200',
    badge: 'bg-amber-100 border-amber-300/70 text-amber-600',
    icon: 'text-amber-600',
    title: 'text-amber-900',
    body: 'text-amber-800/90',
    bullet: 'bg-amber-400',
    rule: 'border-amber-200/70',
    foot: 'text-amber-700/90',
  },
}

const toneFor = (warning: LocationWarning) => TONES[warning.strict ? 'strict' : 'soft']

function WarningIcon({ warning, size }: { warning: LocationWarning; size: number }) {
  return warning.strict
    ? <ShieldAlert size={size} strokeWidth={2.4} />
    : <AlertTriangle size={size} strokeWidth={2.4} />
}

// ── Chip ─────────────────────────────────────────────────────────────────────

/**
 * Dense-row badge. Sits beside the punch times in the report, where the reader
 * is scanning dozens of rows and needs the flagged ones to catch the eye
 * without shouting over the status pills next to them.
 *
 * `onClick` makes it a button that opens the detail modal — which is how this
 * reaches a phone, where the `title` tooltip never appears.
 */
export function LocationWarningChip({
  warning, onClick, className = '',
}: {
  warning: LocationWarning
  onClick?: () => void
  className?: string
}) {
  const tone = toneFor(warning)
  const label = `${warning.title}. ${warning.summary}`
  const base =
    'inline-flex items-center gap-1 px-1.5 py-[1px] text-[10px] font-bold leading-none rounded-full ' +
    `border flex-shrink-0 ${tone.chip}`

  if (!onClick) {
    return (
      <span title={label} aria-label={label} className={`${base} ${className}`}>
        <WarningIcon warning={warning} size={9} />
        {warning.short}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick() }}
      title={`${label} — tap for details`}
      className={`${base} transition-colors active:scale-95 ${tone.chipHover} ${className}`}
    >
      <WarningIcon warning={warning} size={9} />
      {warning.short}
    </button>
  )
}

// ── Banner ───────────────────────────────────────────────────────────────────

/**
 * The full notice, for somewhere with room to explain: the staff member's own
 * check-in card, and the body of the detail modal.
 */
export function LocationWarningBanner({
  warning, footnote, className = '',
}: {
  warning: LocationWarning
  /** Extra line under the punch list — used to say who else can see this. */
  footnote?: string
  className?: string
}) {
  const tone = toneFor(warning)
  return (
    <div className={`p-3.5 border rounded-2xl ${tone.panel} ${className}`}>
      <div className="flex items-start gap-3">
        <span className={`w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0 ${tone.badge}`}>
          <WarningIcon warning={warning} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-bold leading-snug ${tone.title}`}>{warning.title}</p>
          <p className={`text-xs mt-0.5 leading-relaxed ${tone.body}`}>{warning.summary}</p>

          {/* Usually absent: the summary already names every punch and its
              cause. These appear only when one day mixed both causes, which is
              the one thing a single sentence cannot say. */}
          {warning.details.length > 0 && (
            <ul className="mt-2.5 space-y-1.5">
              {warning.details.map(line => (
                <li key={line} className={`flex items-start gap-2 text-[11px] leading-relaxed ${tone.body}`}>
                  <span className={`mt-[5px] w-1 h-1 rounded-full flex-shrink-0 ${tone.bullet}`} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}

          {footnote && (
            <p className={`flex items-start gap-1.5 mt-2.5 pt-2.5 border-t text-[11px] leading-relaxed ${tone.rule} ${tone.foot}`}>
              <Info size={11} className="flex-shrink-0 mt-[3px]" />
              <span>{footnote}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── One-time "this is reported" notice ───────────────────────────────────────

/**
 * Shown once, immediately after a punch recorded with location access off.
 *
 * This is the moment the trade is actually made — the staff member gets their
 * attendance, and the school gets a record saying it was never verified — so it
 * is the moment to say so, in the second person, without hedging. It is not
 * persisted: repeating it on every page load afterwards would turn a clear
 * statement into background noise, and the permanent record of the day is the
 * flag on the report, not this.
 */
export function LocationReportedNotice({
  copy, onAcknowledge,
}: {
  copy: { title: string; detail: string; remedy: string; acknowledge: string }
  onAcknowledge: () => void
}) {
  return (
    <div
      role="alert"
      className="p-4 border-2 rounded-2xl bg-red-50 border-red-300"
      style={{ boxShadow: '0 12px 28px -18px rgba(220,38,38,0.65)' }}
    >
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center flex-shrink-0 text-white">
          <ShieldAlert size={16} strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-red-900 leading-snug">{copy.title}</p>
          <p className="text-xs text-red-800 mt-1 leading-relaxed">{copy.detail}</p>
          <p className="flex items-start gap-1.5 mt-2 pt-2 border-t border-red-200 text-[11px] text-red-700 leading-relaxed">
            <Info size={11} className="flex-shrink-0 mt-[3px]" />
            <span>{copy.remedy}</span>
          </p>
        </div>
      </div>
      <button
        onClick={onAcknowledge}
        className="mt-3 w-full py-2.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors active:scale-[0.98] rounded-xl"
      >
        {copy.acknowledge}
      </button>
    </div>
  )
}

// ── Detail modal ─────────────────────────────────────────────────────────────

/**
 * Opened from a chip. Exists mainly for phones — the chip's tooltip is
 * desktop-only, and a warning nobody on a phone can read is not a warning.
 */
export function LocationWarningModal({
  warning, title, subtitle, onClose,
}: {
  warning: LocationWarning
  /** Whose day this is — the staff member's name on the report, omitted on your own. */
  title?: string
  /** The day itself, e.g. "Mon, Mar 4". */
  subtitle?: string
  onClose: () => void
}) {
  if (typeof document === 'undefined') return null
  const tone = toneFor(warning)

  // Mounted only while open, so there is no exit animation to run — hence no
  // AnimatePresence, rather than one that quietly never fires.
  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-[#1c1a1e]/45"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        className="lg-sheet relative rounded-[28px] w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={warning.title}
      >
        <div className="relative z-[3] flex items-center gap-3 px-4 sm:px-5 pt-4 pb-3">
          <span className={`w-10 h-10 rounded-[0.85rem] border flex items-center justify-center flex-shrink-0 ${tone.badge}`}>
            <WarningIcon warning={warning} size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-display text-[1.05rem] font-bold text-slate-900 leading-tight headline truncate">{title ?? 'Location notice'}</p>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="lg-control w-9 h-9 flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="lg-sheet-card relative z-[3] mx-2 mb-2 p-4">
          <LocationWarningBanner
            warning={warning}
            footnote={warning.strict
              ? 'Attendance still counts. The day stays flagged at the top of the report for the admin to review.'
              : 'Attendance still counts. The day stays flagged on the report.'}
          />
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
