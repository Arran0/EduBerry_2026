'use client'

/**
 * The visible half of "a device problem does not cost you your attendance".
 *
 * A punch accepted without a confirmed location — no fix at all, or a fix too
 * coarse to place the person on campus — is written like any other punch. What
 * keeps that honest is that it never *looks* like any other punch: the same
 * warning, derived once in describeLocationWarning(), renders here for the
 * staff member on their own card and for the office on the report. Neither
 * side gets a version of the day the other cannot see.
 *
 * The palette is amber throughout, never red. Red would read as "you did
 * something wrong", and nobody did — the point of the flag is that the question
 * went unanswered, not that the answer was bad.
 */

import React from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, Satellite, X, Info } from 'lucide-react'
import type { LocationWarning } from '@/lib/attendance'

/** device_issue had no position at all; uncertain had one that proved nothing. */
function WarningIcon({ warning, size }: { warning: LocationWarning; size: number }) {
  return warning.kind === 'device_issue'
    ? <AlertTriangle size={size} strokeWidth={2.4} />
    : <Satellite size={size} strokeWidth={2.4} />
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
  const label = `${warning.title}. ${warning.summary}`
  const base =
    'inline-flex items-center gap-1 px-1.5 py-[1px] text-[10px] font-bold leading-none rounded-full border ' +
    'bg-amber-50 border-amber-300/80 text-amber-700 flex-shrink-0'

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
      className={`${base} transition-colors hover:bg-amber-100 hover:border-amber-400 active:scale-95 ${className}`}
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
  return (
    <div className={`p-3.5 border rounded-2xl bg-amber-50/70 border-amber-200 ${className}`}>
      <div className="flex items-start gap-3">
        <span className="w-7 h-7 rounded-full bg-amber-100 border border-amber-300/70 flex items-center justify-center flex-shrink-0 text-amber-600">
          <WarningIcon warning={warning} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-900 leading-snug">{warning.title}</p>
          <p className="text-xs text-amber-800/90 mt-0.5 leading-relaxed">{warning.summary}</p>

          <ul className="mt-2.5 space-y-1.5">
            {warning.punches.map(p => (
              <li key={p.label} className="flex items-start gap-2 text-[11px] text-amber-800 leading-relaxed">
                <span className="mt-[5px] w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />
                <span>{p.line}</span>
              </li>
            ))}
          </ul>

          {footnote && (
            <p className="flex items-start gap-1.5 mt-2.5 pt-2.5 border-t border-amber-200/70 text-[11px] text-amber-700/90 leading-relaxed">
              <Info size={11} className="flex-shrink-0 mt-[3px]" />
              <span>{footnote}</span>
            </p>
          )}
        </div>
      </div>
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

  // Mounted only while open, so there is no exit animation to run — hence no
  // AnimatePresence, rather than one that quietly never fires.
  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={warning.title}
      >
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100">
          <span className="w-8 h-8 rounded-full bg-amber-100 border border-amber-300/70 flex items-center justify-center flex-shrink-0 text-amber-600">
            <WarningIcon warning={warning} size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-800 text-sm truncate">{title ?? 'Location notice'}</p>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4">
          <LocationWarningBanner
            warning={warning}
            footnote="Attendance was still recorded. The warning stays on this day so the office can see the location was never confirmed."
          />
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
