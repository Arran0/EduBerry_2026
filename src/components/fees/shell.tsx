'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Fee module's screen shell.
//
// Every fee screen was drawing its own header bar, its own stat cards and its
// own tab strip. Eight copies drift, and they had: three container widths, two
// card radii and two tab styles across nine pages.
//
// This is one copy, and it speaks the Salary Manager's vocabulary rather than
// a second one of its own — `salary/ui.tsx` is imported, not re-implemented.
// Sharp corners, the warm paper ramp, hairlines instead of shadow. The two
// modules are one product and should read like it.
//
// Desktop gets `max-w-[1600px]`, the same as the payroll sheet: a fee ledger
// is a table, and a 1,152px column on a 2,560px monitor wastes half the screen
// and then makes the reader scroll horizontally inside what is left.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { LABEL, BLEED } from '@/components/salary/ui'

export { LABEL, BLEED, Panel, PanelHead, SectionBar, SearchField, Btn, Chip }
  from '@/components/salary/ui'

/**
 * The page frame: paper background, the wide container, a back link, and a
 * title row that wraps rather than squeezes.
 */
export function FeeScreen({
  title, subtitle, icon, back, actions, children,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon: React.ReactNode
  /** Omitted on the hub, which is itself the top of the module. */
  back?: { href: string; label: string }
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-[#FDFCF9]" style={{ minHeight: '100vh' }}>
      {/* Phones give a dense sheet the whole viewport; the gutter returns at
          the `sm` breakpoint where there is room to spare. */}
      <div className="max-w-[1600px] mx-auto px-0 sm:px-6 lg:px-8 py-3 sm:py-6">
        {back && (
          <div className="px-3 sm:px-0">
            <Link href={back.href}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase
                             tracking-[0.08em] text-[#8C8878] hover:text-[#18181B] mb-2.5 transition-colors">
              <ArrowLeft size={13} /> {back.label}
            </Link>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-2.5 px-3 sm:px-0">
          <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
          <div className="flex-1 min-w-[150px]">
            <h1 className="font-display text-lg font-bold text-[#18181B] leading-none truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[10.5px] text-[#8C8878] mt-1 leading-tight">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0">{actions}</div>
          )}
        </div>

        {children}
      </div>
    </div>
  )
}

export interface Stat {
  label: string
  /** Pre-formatted — the strip never decides how money is written. */
  value: string
  /** Colours the figure. Used sparingly: an amount that needs chasing. */
  tone?: string
  /** Renders larger, for the one figure a row is really about. */
  strong?: boolean
}

/**
 * The summary strip: figures in a hairline grid, value over label.
 *
 * Not cards. Six floating rounded tiles cost a row of vertical space each and
 * push the actual list off the screen — this is the payroll strip's shape,
 * where the gaps are the grid's background showing through a 1px gutter.
 *
 * `loading` renders the same cells with pulsing placeholders, so the strip is
 * exactly as tall before the figures land as after. The old cards used a
 * fixed-height skeleton that did not match the loaded card, and the whole page
 * jumped when a query returned.
 */
/**
 * Tailwind needs the finished class name in the source, so the shapes are
 * spelled out rather than interpolated.
 *
 * Past the `sm` breakpoint a cell is capped at 240px and a filler column takes
 * the rest. Four figures stretched across a 1,600px container put 380px of
 * empty paper between a number and its label, which reads as four unrelated
 * panels rather than one strip.
 */
const STRIP_COLS: Record<number, string> = {
  1: 'grid-cols-1 sm:grid-cols-[minmax(0,240px)_1fr]',
  2: 'grid-cols-2 sm:grid-cols-[repeat(2,minmax(0,240px))_1fr]',
  3: 'grid-cols-3 sm:grid-cols-[repeat(3,minmax(0,240px))_1fr]',
  4: 'grid-cols-2 sm:grid-cols-[repeat(4,minmax(0,240px))_1fr]',
  5: 'grid-cols-2 sm:grid-cols-[repeat(5,minmax(0,220px))_1fr]',
  6: 'grid-cols-3 sm:grid-cols-[repeat(6,minmax(0,200px))_1fr]',
  7: 'grid-cols-3 sm:grid-cols-[repeat(7,minmax(0,180px))_1fr]',
  8: 'grid-cols-3 sm:grid-cols-[repeat(8,minmax(0,170px))_1fr]',
}

export function StatStrip({ stats, loading }: { stats: Stat[]; loading?: boolean }) {
  const cols = STRIP_COLS[stats.length] ?? 'grid-cols-2 sm:grid-cols-[repeat(4,minmax(0,240px))_1fr]'
  return (
    <div className={`bg-white border-[#E3DFD3] ${BLEED} border-y sm:border mb-2.5`}>
      {/* 1px hairlines in both directions: the grid's own background shows
          through a one-pixel gap between the white cells. */}
      <div className={`grid ${cols} gap-px bg-[#F0ECE2]`}>
        {stats.map(s => (
          <div key={s.label} className="px-2.5 py-2 min-w-0 bg-white">
            {loading ? (
              // Same box, same height. The old skeleton was a fixed 74px card
              // that did not match the loaded one, so the page jumped every
              // time a query returned.
              <>
                <div className="h-[19px] w-20 max-w-full bg-[#F4F1E7] animate-pulse" />
                <div className="h-[11px] w-14 max-w-full bg-[#F4F1E7] animate-pulse mt-[3px]" />
              </>
            ) : (
              <>
                <p className={`${s.strong ? 'text-[15px]' : 'text-[12.5px]'} font-bold tabular-nums truncate leading-[19px] text-[#18181B]`}
                   style={s.tone ? { color: s.tone } : undefined}>
                  {s.value}
                </p>
                <p className={`${LABEL} mt-[3px] leading-[11px] truncate`}>{s.label}</p>
              </>
            )}
          </div>
        ))}
        {/* Fills the rest of the row so the grid's hairline colour does not
            show as a stripe where the cells stop. */}
        <div className="hidden sm:block bg-white" />
      </div>
    </div>
  )
}

export interface TabDef<K extends string> {
  key: K
  label: string
  /**
   * What the tab is called when there is not room for `label`. A phone has
   * room for "Collection" and not for "Collection Center", and the strip is
   * better off saying the shorter thing than scrolling to say the longer one.
   */
  short?: string
  icon?: React.ElementType
  /** Shown beside the label — a count of what is waiting. */
  badge?: number
}

/**
 * Underline tabs with a gold rule under the live one, the same control the
 * Salary hub uses to switch sections.
 *
 * The strip fits whatever width it is given. It never scrolls and never wraps:
 * the tabs share the row (`flex-1`), each may shrink below its text (`min-w-0`)
 * and clip rather than push, and on a phone each shows its `short` name. A
 * sideways-scrolling tab strip on a touchscreen is the worst of the three —
 * the tabs out of view are invisible rather than merely narrow, and the strip
 * fights the page's own vertical scroll for the same drag.
 */
export function TabBar<K extends string>({
  tabs, active, onChange,
}: {
  tabs: TabDef<K>[]
  active: K
  onChange: (key: K) => void
}) {
  return (
    <div className={`flex border-b border-[#E3DFD3] mb-3 ${BLEED} sm:mx-0 px-3 sm:px-0`}>
      {tabs.map(t => {
        const on = t.key === active
        const Icon = t.icon
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-1.5 sm:px-3 pb-1.5
                        text-[11px] font-bold uppercase tracking-[0.06em] border-b-2 -mb-px
                        transition-colors ${
              on ? 'border-[#B8983C] text-[#18181B]' : 'border-transparent text-[#A8A395] hover:text-[#6B675A]'
            }`}
          >
            {Icon && <Icon size={13} className="flex-shrink-0" />}
            <span className="truncate">
              {t.short ? <><span className="sm:hidden">{t.short}</span>
                           <span className="hidden sm:inline">{t.label}</span></> : t.label}
            </span>
            {t.badge !== undefined && t.badge > 0 && (
              <span className={`flex-shrink-0 px-1 py-px text-[9px] leading-none tabular-nums ${
                on ? 'bg-[#B8983C] text-white' : 'bg-[#F4F1E7] text-[#8C8878]'}`}>
                {t.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** A full-width notice. `tone` decides whether it reads as news or as a problem. */
export function Notice({
  tone = 'info', children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'good'
  children: React.ReactNode
}) {
  const tones = {
    info:  'bg-[#FAF8F2] border-[#E3DFD3] text-[#52525B]',
    warn:  'bg-[#FAF3DF] border-[#E7D9AE] text-[#7A6220]',
    error: 'bg-[#FCECEC] border-[#EFCCCC] text-[#A93232]',
    good:  'bg-[#EAF5EE] border-[#C6E3D2] text-[#1F6B42]',
  }
  return (
    <div className={`border px-3 py-2 text-[12.5px] leading-relaxed mb-2.5 ${BLEED} sm:mx-0 ${tones[tone]}`}>
      {children}
    </div>
  )
}

/** Centred placeholder for an empty list, sized so a panel does not collapse. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-10 text-[12.5px] text-[#8C8878] text-center">{children}</p>
}

/** The module's one spinner position, so every screen loads the same way. */
export function Loading() {
  return (
    <div className="py-16 text-center">
      <div className="spinner mx-auto mb-3" />
      <p className="text-[12.5px] text-[#8C8878]">Loading…</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Row lists — a table on a laptop, a card on a phone
//
// Every list in this module was a `<table>` in an `overflow-x-auto` box. On a
// laptop that is right. On a 375px phone a seven-column ledger becomes a
// seven-column ledger you drag sideways through, and the two figures a clerk
// needs at the same time — who this is and what they owe — are the two columns
// furthest apart. You cannot see a name and its amount together, and the
// Collect button is off the right edge entirely.
//
// So the same cells are laid out twice from one piece of markup: a 2-column
// card on phones, the real column template from `sm` up. One copy of the row,
// so the two layouts cannot drift apart — the only list in the module that
// really is drawn twice is the search answer, whose columns are whatever the
// question asked for and so cannot be folded by CSS at all.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a cell sits while the row is a card.
 *
 * `A1`–`A3` are the left column, top to bottom: who or what this row is.
 * `B1`–`B3` are the right, right-aligned: the money and the state.
 * `END` pins a cell to a third column beside the first two lines, which is
 * where a trailing action button belongs.
 *
 * All of them are `max-sm:` so there is nothing to undo at the breakpoint —
 * past `sm` the row's own template places the cells in source order, and two
 * rules never fight over which wins. Spelled out as literals because Tailwind
 * only emits CSS for class names it can read in the source.
 */
export const CELL = {
  A1: 'max-sm:col-start-1 max-sm:row-start-1 min-w-0',
  A2: 'max-sm:col-start-1 max-sm:row-start-2 min-w-0',
  A3: 'max-sm:col-start-1 max-sm:row-start-3 min-w-0',
  B1: 'max-sm:col-start-2 max-sm:row-start-1 max-sm:justify-self-end min-w-0',
  B2: 'max-sm:col-start-2 max-sm:row-start-2 max-sm:justify-self-end min-w-0',
  B3: 'max-sm:col-start-2 max-sm:row-start-3 max-sm:justify-self-end min-w-0',
  /**
   * `row-span-2`, not `row-span-full`: the card's rows are implicit (the cells
   * above make them by asking for row 2), and a negative line index like
   * `1 / -1` counts from the end of the *explicit* grid, which here has no rows
   * at all. Two is the height of every card that carries a trailing action.
   */
  END: 'max-sm:col-start-3 max-sm:row-start-1 max-sm:row-span-2 max-sm:self-center max-sm:justify-self-end',
  /** A fact worth a column on a laptop and not worth a line on a phone. */
  DESKTOP: 'max-sm:hidden',
} as const

/**
 * The same slots, shifted one column right, for a list whose first column is a
 * control the row cannot do without — a selection checkbox. `PICK` is that
 * control, pinned left beside the name it selects; `A`/`B` are the two columns
 * beside it. Pass `lead` to `Row` to widen the phone grid for it.
 */
export const CELL_LEAD = {
  PICK: 'max-sm:col-start-1 max-sm:row-start-1 max-sm:row-span-2 max-sm:self-center',
  A1: 'max-sm:col-start-2 max-sm:row-start-1 min-w-0',
  A2: 'max-sm:col-start-2 max-sm:row-start-2 min-w-0',
  A3: 'max-sm:col-start-2 max-sm:row-start-3 min-w-0',
  B1: 'max-sm:col-start-3 max-sm:row-start-1 max-sm:justify-self-end min-w-0',
  B2: 'max-sm:col-start-3 max-sm:row-start-2 max-sm:justify-self-end min-w-0',
  B3: 'max-sm:col-start-3 max-sm:row-start-3 max-sm:justify-self-end min-w-0',
} as const

/**
 * The frame a row list sits in. Full-bleed on phones for the same reason the
 * payroll sheet is: a ledger cannot spare 24px of gutter on a 360px screen.
 */
export function List({ className = '', children }: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`bg-white border-[#E3DFD3] ${BLEED} border-y sm:border ${className}`}>
      {children}
    </div>
  )
}

/**
 * The heading row. Phones do not get one: the rows there are cards, and a
 * header would be naming columns that are not on the screen.
 */
export function ListHead({ cols, children }: {
  /** The `sm:grid-cols-[…]` literal this list's rows use. */
  cols: string
  children: React.ReactNode
}) {
  return (
    <div className={`hidden sm:grid ${cols} items-center gap-x-2 gap-y-1 px-3 py-[7px]
                     bg-[#FAF8F2] border-b border-[#E3DFD3]`}>
      {children}
    </div>
  )
}

/** A column heading, in the one type size every column heading uses. */
export function Col({ right, className = '', children }: {
  right?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span className={`${LABEL} truncate ${right ? 'text-right' : ''} ${className}`}>{children}</span>
  )
}

/**
 * The width a trailing action column takes on a phone: one, two or three `TAP`
 * squares and the 4px gutters between them.
 *
 * Fixed, not `auto`. A column sized to its contents is a different width on
 * every row — a bill that can still be cancelled has a button, the one beside
 * it does not — and that walks the amounts in and out by 28px down the list.
 * Reserving the space costs 28px and buys a straight edge.
 */
const TRAIL = {
  1: 'grid-cols-[minmax(0,1fr)_auto_28px]',
  2: 'grid-cols-[minmax(0,1fr)_auto_60px]',
  3: 'grid-cols-[minmax(0,1fr)_auto_92px]',
} as const

/**
 * One row. Two columns and as many lines as its cells ask for on a phone; from
 * `sm` up, whatever `cols` says.
 *
 * `trailing` is how many icon buttons the row's `CELL.END` holds, and reserves
 * a column that wide for them.
 */
export function Row({ cols, trailing, lead, below, className = '', children }: {
  cols: string
  trailing?: 1 | 2 | 3
  /** The row opens with a control that keeps its own column — see `CELL_LEAD`. */
  lead?: boolean
  /** Full-width content under the cells — a bill's lines, a reason, a note. */
  below?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`border-b border-[#F0ECE2] last:border-b-0 hover:bg-[#FAF8F2] transition-colors ${className}`}>
      <div className={`grid ${lead
                        ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
                        : trailing
                        ? TRAIL[trailing]
                        : 'grid-cols-[minmax(0,1fr)_auto]'} ${cols}
                       items-center gap-x-2 gap-y-[3px] sm:gap-y-0 px-3 py-[7px]`}>
        {children}
      </div>
      {below && <div className="px-3 pb-2 -mt-px">{below}</div>}
    </div>
  )
}

/**
 * An icon-only button: the square version of the module's text button, exactly
 * as tall, so a row of actions lines up whether its buttons carry words or not.
 *
 * `ADMIN.ghostBtn` is 10.5px of leading-none text in `py-[7px]` inside a 1px
 * border — 28px. This is 28px square, at every width. The icon buttons it
 * replaces were a 26px target with 3px between them, which is how a payment
 * gets reversed by somebody reaching for the printer; 28px with a 4px gutter is
 * not a generous target, but it is the one that matches the rest of the module,
 * and a button that is bigger than the type around it reads as a mistake.
 */
export const TAP = 'inline-flex items-center justify-center w-7 h-7 flex-shrink-0 transition-colors'
