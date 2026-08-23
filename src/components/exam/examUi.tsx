'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { CalendarClock, PlayCircle, ClipboardCheck, Lock, Zap } from 'lucide-react'
import type { ExamPhase } from '@/lib/exam'

/**
 * Shared aesthetic tokens for the whole exam app — a refined "black & gold"
 * examination-hall aesthetic. Ink (near-black) carries primary actions and
 * structure; gold is the single accent, used deliberately for emphasis,
 * hairline borders and highlights. Gold is set to an explicit, vivid value
 * (rather than a theme variable) so it always reads as gold and never washes
 * out against the cream/white surfaces.
 */
export const GOLD = '#B8983C'
export const GOLD_DARK = '#9C7F2C'
export const INK = '#1C1C1F'

export const EXAM = {
  // Surfaces — soft, layered, with a hairline border and gentle elevation.
  card: 'bg-white border border-[#EAE7DF] rounded-2xl',
  cardHover:
    'bg-white border border-[#EAE7DF] rounded-2xl shadow-[0_1px_2px_rgba(28,28,31,0.04)] hover:shadow-[0_8px_24px_-12px_rgba(28,28,31,0.18)] hover:border-[#D8D2C4] transition-all duration-200',
  // A premium icon tile — ink fill with a hairline gold ring + faint glow.
  iconTile:
    'rounded-xl bg-gradient-to-br from-[#27272A] to-[#18181B] ring-1 ring-inset ring-[#B8983C]/70 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.5)] flex items-center justify-center shrink-0',
  // Form controls — focus ring tinted gold for a cohesive accent.
  input:
    'w-full bg-white border border-[#E4E1D8] rounded-xl px-3.5 py-2.5 text-sm text-[#27272A] placeholder:text-[#A8A29A] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/15 transition-all',
  field:
    'w-full bg-white border border-[#E4E1D8] rounded-xl px-3.5 py-2.5 text-sm text-[#27272A] placeholder:text-[#A8A29A] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/15 transition-all',
  label: 'text-[10px] font-bold uppercase tracking-[0.14em] text-[#8A8578]',
  fieldLabel: 'block text-[11px] font-semibold uppercase tracking-wider text-[#8A8578] mb-1.5',
  // Buttons — ink primary, gold accent (the headline CTA), and quiet ghost.
  darkBtn:
    'inline-flex items-center justify-center gap-1.5 bg-[#1C1C1F] hover:bg-black text-white text-xs font-semibold px-3.5 py-2 rounded-xl shadow-[0_2px_8px_-3px_rgba(0,0,0,0.4)] transition-colors disabled:opacity-50',
  goldBtn:
    'inline-flex items-center justify-center gap-1.5 bg-[#B8983C] hover:bg-[#9C7F2C] text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-[0_4px_14px_-4px_rgba(184,152,60,0.55)] transition-colors disabled:opacity-50 disabled:shadow-none',
  ghostBtn:
    'inline-flex items-center justify-center gap-1.5 bg-white border border-[#E4E1D8] text-[#71717A] hover:text-[#27272A] hover:border-[#D8D2C4] text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50',
} as const

/**
 * A question's attached figure — always shown at full size (never a
 * collapsed thumbnail) so diagrams/graphs stay legible wherever a question
 * is rendered: the builder, taking an exam, review, grading and the answer key.
 */
export function QuestionImage({ src, alt, className = '' }: { src?: string | null; alt?: string; className?: string }) {
  if (!src) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? 'Question figure'}
      className={`w-full max-h-[28rem] object-contain rounded-xl border border-[#EAE7DF] bg-[#FAFAF9] ${className}`}
    />
  )
}

/** A shimmering placeholder block. Pass sizing/rounding via `className`. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />
}

/**
 * Smooth fade-up entrance. `index` staggers siblings without each needing its
 * own variants block — pass the map index for a gentle cascade.
 */
export function FadeIn({
  children,
  index = 0,
  className = '',
}: {
  children: React.ReactNode
  index?: number
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.04, 0.32), ease: [0.22, 0.61, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/** Placeholder for a single exam list/queue card. */
export function ExamCardSkeleton() {
  return (
    <div className={`${EXAM.card} p-4 shadow-sm`}>
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-2.5 w-3/5" />
        </div>
        <Skeleton className="h-8 w-16 rounded-lg shrink-0" />
      </div>
    </div>
  )
}

/** A vertical stack of card skeletons for list-style loading states. */
export function ExamListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <ExamCardSkeleton key={i} />
      ))}
    </div>
  )
}

// ── Excel-style paginated row list ──────────────────────────

/** The dark hairline that outlines every record in the spreadsheet list. */
const ROW_RULE = '#3F3F46'

/** A single skeleton row for the flat excel-style list. */
function ExamRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 sm:px-4 py-2">
      <Skeleton className="w-4 h-4 rounded shrink-0" />
      <Skeleton className="h-3 w-1/3" />
      <div className="flex-1" />
      <Skeleton className="h-3 w-24 hidden md:block" />
      <Skeleton className="h-5 w-14 rounded-md shrink-0" />
    </div>
  )
}

/** Placeholder for the flat excel-style list while data is loading. */
export function ExamRowListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      className="rounded-2xl bg-white overflow-hidden shadow-[0_1px_2px_rgba(28,28,31,0.05),0_14px_36px_-24px_rgba(28,28,31,0.5)]"
      style={{ border: `1px solid ${ROW_RULE}` }}
    >
      <div className="hidden md:block h-9 bg-[#F2F0EA]" style={{ borderBottom: `1px solid ${ROW_RULE}` }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ borderBottom: i === rows - 1 ? undefined : `1px solid ${ROW_RULE}` }}>
          <ExamRowSkeleton />
        </div>
      ))}
    </div>
  )
}

/**
 * A flat, spreadsheet-style list: a pinned column-header strip over records
 * outlined with dark hairlines (no per-item card), scrolling inside its own
 * well and revealing `pageSize` records at a time — more either via the
 * footer affordance or by scrolling near the bottom.
 */
export function ExamRowList<T>({
  items,
  renderRow,
  keyOf,
  header,
  pageSize = 10,
  maxHeightClass = 'max-h-[62vh]',
}: {
  items: T[]
  renderRow: (item: T, index: number) => React.ReactNode
  keyOf: (item: T) => string
  /** Column-header strip, pinned to the top of the scroll well. */
  header?: React.ReactNode
  pageSize?: number
  maxHeightClass?: string
}) {
  const [visible, setVisible] = React.useState(pageSize)

  // Reset the page whenever the underlying list changes (e.g. switching tabs
  // or narrowing with a search).
  React.useEffect(() => { setVisible(pageSize) }, [items, pageSize])

  const shown = items.slice(0, visible)
  const hasMore = visible < items.length
  const loadMore = () => setVisible(v => Math.min(v + pageSize, items.length))

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!hasMore) return
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) loadMore()
  }

  return (
    <div
      className="rounded-2xl bg-white overflow-hidden shadow-[0_1px_2px_rgba(28,28,31,0.05),0_14px_36px_-24px_rgba(28,28,31,0.5)]"
      style={{ border: `1px solid ${ROW_RULE}` }}
    >
      <div className={`slim-scroll overflow-y-auto ${maxHeightClass}`} onScroll={onScroll}>
        {/* Column headers are a wide-viewport affordance — on phones the row
            itself folds those columns inline, so the strip stays out of the way. */}
        {header && (
          <div
            className="hidden md:block sticky top-0 z-10 bg-[#F2F0EA]/95 backdrop-blur-md"
            style={{ borderBottom: `1px solid ${ROW_RULE}` }}
          >
            {header}
          </div>
        )}
        {shown.map((item, i) => (
          <div
            key={keyOf(item)}
            className={i % 2 === 1 ? 'bg-[#FBFAF8]' : 'bg-white'}
            style={{ borderBottom: `1px solid ${ROW_RULE}` }}
          >
            {renderRow(item, i)}
          </div>
        ))}
      </div>
      {/* Footer appears only while records are still held back — once the list
          is fully revealed the table ends on its last row. */}
      {hasMore && (
        <div
          className="bg-[#F2F0EA] px-3 sm:px-4 py-1.5 text-center"
          style={{ borderTop: `1px solid ${ROW_RULE}` }}
        >
          <button
            onClick={loadMore}
            className="text-[11px] font-bold uppercase tracking-wide text-[#9C7F2C] hover:text-[#7A631F] transition-colors"
          >
            Load {Math.min(pageSize, items.length - visible)} more
          </button>
        </div>
      )}
    </div>
  )
}


// ── Lifecycle chips ──────────────────────────────────────────

const PHASE_CHIP: Record<ExamPhase, { label: string; short: string; cls: string; icon: React.ReactNode }> = {
  scheduled: {
    label: 'Not open yet',
    short: 'Scheduled',
    cls: 'bg-[#F4F4F5] text-[#71717A] border-[#E4E4E7]',
    icon: <CalendarClock size={11} />,
  },
  open: {
    label: 'Open to attempt',
    short: 'Open',
    cls: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    icon: <PlayCircle size={11} />,
  },
  grading: {
    label: 'Grading',
    short: 'Grading',
    cls: 'bg-[#F4F2EC] text-[#9C7F2C] border-[#E7E2D8]',
    icon: <ClipboardCheck size={11} />,
  },
  published: {
    label: 'Results published',
    short: 'Published',
    cls: 'bg-[#F4F4F5] text-[#71717A] border-[#E4E4E7]',
    icon: <Lock size={11} />,
  },
}

/**
 * The exam's lifecycle stage, as a small labelled chip. `compact` swaps in the
 * one-word label for dense table columns, keeping the full phrase on hover.
 */
export function ExamPhaseChip({ phase, compact = false }: { phase: ExamPhase; compact?: boolean }) {
  const meta = PHASE_CHIP[phase]
  return (
    <span
      title={compact ? meta.label : undefined}
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border ${meta.cls}`}
    >
      {meta.icon} {compact ? meta.short : meta.label}
    </span>
  )
}

/**
 * Marks an exam that publishes each student's result the moment they submit.
 * `compact` drops to the bolt alone — enough of a tell inside a dense row,
 * where the words would crowd out the exam's own title.
 */
export function ImmediateResultsChip({ compact = false }: { compact?: boolean }) {
  return (
    <span
      title={compact ? 'Instant results' : undefined}
      className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-md bg-amber-50 text-amber-600 border border-amber-100 ${
        compact ? 'px-1 py-0.5' : 'px-2 py-0.5'
      }`}
    >
      <Zap size={11} />
      {!compact && 'Instant results'}
    </span>
  )
}
