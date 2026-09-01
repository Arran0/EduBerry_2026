'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { CalendarClock, PlayCircle, ClipboardCheck, Lock, Zap } from 'lucide-react'
import type { ExamPhase } from '@/lib/exam'

/**
 * Shared aesthetic tokens for the whole exam app — a sharp, editorial
 * "black & gold" examination-hall aesthetic.
 *
 * Three rules hold everywhere:
 *  1. Zero corner radius. Every surface, control and chip is square; only
 *     avatars (real photographs) stay circular.
 *  2. One hairline. `#E4E1D8` draws every border and divider, so panels,
 *     rows, inputs and tables all sit on the same grid.
 *  3. Ink carries structure and primary actions; gold is the single accent,
 *     used for emphasis, focus and the headline CTA — never for decoration.
 *
 * Controls are sized by height (h-8 / h-9 / h-11) rather than padding, so a
 * button, an input and a select always line up on the same row.
 */
export const GOLD = '#B8983C'
export const GOLD_DARK = '#9C7F2C'
export const INK = '#18181B'
/** The single hairline used for every border and divider in the exam app. */
export const RULE = '#E4E1D8'

// Buttons are composed from a shared base + one size, so a caller never has
// to append conflicting utilities to resize one (Tailwind resolves those by
// stylesheet order, not by the order classes appear in the string).
const BTN =
  'inline-flex items-center justify-center gap-1.5 font-semibold whitespace-nowrap border transition-colors duration-150 select-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/40 focus-visible:ring-offset-1 focus-visible:ring-offset-white ' +
  'disabled:opacity-40 disabled:pointer-events-none'
const BTN_SM = 'h-8 px-3 text-[11px] tracking-[0.05em]'
const BTN_MD = 'h-9 px-4 text-xs tracking-[0.04em]'
const BTN_LG = 'h-11 px-6 text-sm'

const INK_FILL = 'bg-[#18181B] border-[#18181B] text-white hover:bg-black hover:border-black'
const GOLD_FILL = 'bg-[#B8983C] border-[#B8983C] text-white hover:bg-[#9C7F2C] hover:border-[#9C7F2C]'
const QUIET =
  'bg-white border-[#E4E1D8] text-[#52525B] hover:text-[#18181B] hover:border-[#B8983C] hover:bg-[#FAF9F6]'
const DANGER =
  'bg-white border-[#E4E1D8] text-rose-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-300'

const CONTROL =
  'w-full bg-white border border-[#E4E1D8] text-sm text-[#18181B] placeholder:text-[#A8A29A] ' +
  'focus:outline-none focus:border-[#B8983C] focus:ring-1 focus:ring-[#B8983C]/25 transition-colors ' +
  'disabled:bg-[#FAF9F6] disabled:text-[#A8A29A]'

export const EXAM = {
  // ── Surfaces ───────────────────────────────────────────────
  /** The standard panel: white, one hairline, square. */
  card: 'bg-white border border-[#E4E1D8]',
  /**
   * Same panel, edge-to-edge on phones: it bleeds out of the page's
   * horizontal padding to a full-width strip, then sits inside the grid
   * from `sm:` up. Only use inside a container padded with `px-4` — the
   * negative margin is sized to cancel exactly that.
   */
  cardBleed: 'bg-white border-y sm:border border-[#E4E1D8] -mx-4 sm:mx-0',
  cardHover:
    'bg-white border border-[#E4E1D8] hover:border-[#B8983C] hover:bg-[#FAF9F6] transition-colors duration-150',
  /** A dense record list: one bordered block, hairline-divided rows. */
  listWrap: 'bg-white border border-[#E4E1D8] divide-y divide-[#E4E1D8]',
  listRow: 'flex items-center gap-3 px-3 py-2.5 hover:bg-[#FAF9F6] transition-colors',
  /** Column headings for a record list — a wide-viewport affordance. */
  listHead:
    'hidden md:flex items-center gap-3 px-3 py-2 bg-[#FAF9F6] border-b border-[#E4E1D8] text-[10px] font-bold uppercase tracking-[0.14em] text-[#8A8578]',
  /** Ink tile behind a section icon, hairline gold ring. */
  iconTile:
    'bg-gradient-to-br from-[#27272A] to-[#18181B] ring-1 ring-inset ring-[#B8983C]/70 flex items-center justify-center shrink-0',

  // ── Form controls ──────────────────────────────────────────
  /** Single-line control (input / select): fixed height, aligns with buttons. */
  field: `${CONTROL} h-9 px-3`,
  /** Alias kept for older call sites. */
  input: `${CONTROL} h-9 px-3`,
  /** Multi-line control — height comes from `rows`. */
  textarea: `${CONTROL} px-3 py-2 resize-y leading-relaxed`,
  fieldLabel: 'block text-[10px] font-bold uppercase tracking-[0.14em] text-[#8A8578] mb-1.5',
  label: 'text-[10px] font-bold uppercase tracking-[0.14em] text-[#8A8578]',
  /** Helper copy under a control. */
  hint: 'mt-1.5 text-[11px] leading-relaxed text-[#A8A29A]',
  error: 'mt-1.5 text-[11px] leading-relaxed text-rose-600',

  // ── Structure ──────────────────────────────────────────────
  /** Header strip that opens a section inside a panel. */
  sectionBand:
    'flex items-center justify-between gap-3 px-4 h-10 bg-[#FAF9F6] border-b border-[#E4E1D8]',
  /** Standalone section header above a panel, with a rule beneath. */
  sectionHeader: 'flex items-center justify-between gap-3 pb-2 mb-3 border-b border-[#E4E1D8]',
  sectionLabel: 'text-[10px] font-bold uppercase tracking-[0.16em] text-[#8A8578]',
  /** The gold eyebrow above a page title. */
  eyebrow: 'text-[10px] font-bold uppercase tracking-[0.18em] text-[#B8983C]',

  // ── Buttons ────────────────────────────────────────────────
  darkBtn: `${BTN} ${BTN_MD} ${INK_FILL}`,
  darkBtnSm: `${BTN} ${BTN_SM} ${INK_FILL}`,
  goldBtn: `${BTN} ${BTN_MD} ${GOLD_FILL}`,
  goldBtnLg: `${BTN} ${BTN_LG} ${GOLD_FILL}`,
  ghostBtn: `${BTN} ${BTN_MD} ${QUIET}`,
  ghostBtnSm: `${BTN} ${BTN_SM} ${QUIET}`,
  /** Quiet button that turns destructive on hover. */
  dangerBtnSm: `${BTN} ${BTN_SM} ${DANGER}`,
  /** Square icon-only buttons, matched to the h-9 / h-8 control heights. */
  iconBtn: `${BTN} h-9 w-9 ${QUIET}`,
  iconBtnSm: `${BTN} h-8 w-8 ${QUIET}`,
  iconBtnDark: `${BTN} h-9 w-9 ${INK_FILL}`,
  iconBtnDanger: `${BTN} h-9 w-9 ${DANGER}`,

  // ── Chips ──────────────────────────────────────────────────
  /** Square micro-tag used for metadata beside a title. */
  tag: 'inline-flex items-center gap-1 border border-[#E4E1D8] bg-[#FAF9F6] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#52525B]',
  tagGold:
    'inline-flex items-center gap-1 border border-[#E7E2D8] bg-[#F4F2EC] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9C7F2C]',
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
      className={`w-full max-h-[28rem] object-contain border border-[#E4E1D8] bg-[#FAFAF9] ${className}`}
    />
  )
}

/** A shimmering placeholder block. Pass sizing via `className`. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
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

// ── Layout primitives ────────────────────────────────────────

/**
 * The header strip that opens a section inside a panel: a small uppercase
 * label on a tinted band, with room for one trailing action.
 */
export function SectionBand({
  label,
  hint,
  action,
}: {
  label: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className={EXAM.sectionBand}>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className={EXAM.sectionLabel}>{label}</span>
        {hint && <span className="truncate text-[11px] text-[#A8A29A]">{hint}</span>}
      </div>
      {action}
    </div>
  )
}

/**
 * A metric strip: equal cells split by hairlines, each a tabular figure over
 * a micro-label. Reads as the instrument panel for the page it heads.
 */
export function StatStrip({
  items,
  className = '',
}: {
  items: { label: string; value: React.ReactNode; accent?: boolean }[]
  className?: string
}) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 border border-[#E4E1D8] bg-white ${className}`}>
      {items.map((it, i) => (
        <div
          key={it.label}
          className={`px-3 py-2.5 border-[#E4E1D8] ${i % 2 === 1 ? 'border-l' : ''} ${
            i >= 2 ? 'border-t sm:border-t-0' : ''
          } ${i >= 1 ? 'sm:border-l' : ''}`}
        >
          <p className={EXAM.label}>{it.label}</p>
          <p
            className={`mt-1 font-display text-lg font-bold leading-none tabular-nums ${
              it.accent ? 'text-[#B8983C]' : 'text-[#18181B]'
            }`}
          >
            {it.value}
          </p>
        </div>
      ))}
    </div>
  )
}

/** Placeholder for a single exam list/queue card. */
export function ExamCardSkeleton() {
  return (
    <div className={`${EXAM.card} p-4`}>
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-2.5 w-3/5" />
        </div>
        <Skeleton className="h-8 w-16 shrink-0" />
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
      <Skeleton className="w-4 h-4 shrink-0" />
      <Skeleton className="h-3 w-1/3" />
      <div className="flex-1" />
      <Skeleton className="h-3 w-24 hidden md:block" />
      <Skeleton className="h-5 w-14 shrink-0" />
    </div>
  )
}

/** Placeholder for the flat excel-style list while data is loading. */
export function ExamRowListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      className="bg-white overflow-hidden shadow-[0_1px_2px_rgba(28,28,31,0.05),0_14px_36px_-24px_rgba(28,28,31,0.5)]"
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
      className="bg-white overflow-hidden shadow-[0_1px_2px_rgba(28,28,31,0.05),0_14px_36px_-24px_rgba(28,28,31,0.5)]"
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
    cls: 'bg-[#FAF9F6] text-[#71717A] border-[#E4E1D8]',
    icon: <CalendarClock size={11} />,
  },
  open: {
    label: 'Open to attempt',
    short: 'Open',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
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
    cls: 'bg-[#18181B] text-white border-[#18181B]',
    icon: <Lock size={11} />,
  },
}

/** One-word lifecycle labels, for stat cells and dense columns. */
export const PHASE_SHORT: Record<ExamPhase, string> = {
  scheduled: 'Scheduled',
  open: 'Open',
  grading: 'Grading',
  published: 'Published',
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
      className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${meta.cls}`}
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
      className={`inline-flex items-center gap-1 border border-amber-200 bg-amber-50 text-amber-700 text-[10px] font-semibold uppercase tracking-[0.08em] ${
        compact ? 'px-1 py-0.5' : 'px-1.5 py-0.5'
      }`}
    >
      <Zap size={11} />
      {!compact && 'Instant'}
    </span>
  )
}

/**
 * A status pill for record rows (the grading queue). Square, hairline
 * bordered, micro-cased — the same language as the lifecycle chips.
 */
export function StatusPill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`inline-flex items-center border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}>
      {label}
    </span>
  )
}
