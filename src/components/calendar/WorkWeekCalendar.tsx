'use client'

import React, { useRef, useState, useLayoutEffect } from 'react'
import { ChevronLeft, ChevronRight, Plus, CalendarDays, LayoutList } from 'lucide-react'

// ── Date helpers (shared by every surface that renders this calendar) ─────────

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Parses a `YYYY-MM-DD` due date as a *local* date (never UTC-shifted). */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Formats a Date back to the `YYYY-MM-DD` shape due dates are stored in. */
export function formatDate(date: Date): string {
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// ── Theme ────────────────────────────────────────────────────────────────────

export interface CalendarTheme {
  gradFrom: string
  gradTo: string
  primary: string
  primaryLight: string
  primaryDark: string
}

/** Defaults to the per-page palette (see globals.css), so the calendar simply
 *  takes on the colours of whatever page it is dropped into. */
export const PAGE_THEME: CalendarTheme = {
  gradFrom:     'var(--page-gradient-from, #06b6d4)',
  gradTo:       'var(--page-gradient-to, #14b8a6)',
  primary:      'var(--page-primary, #06b6d4)',
  primaryLight: 'var(--page-primary-light, #cffafe)',
  primaryDark:  'var(--page-primary-dark, #0891b2)',
}

/** Builds a theme from two brand hex colours (e.g. an admin-set banner). */
export function themeFromGradient(from: string, to: string): CalendarTheme {
  return {
    gradFrom: from,
    gradTo: to,
    primary: from,
    // 8-digit hex — a ~12% tint of the primary, for "today" backgrounds.
    primaryLight: `${from}1f`,
    primaryDark: to,
  }
}

// ── Props ────────────────────────────────────────────────────────────────────

/** Phone layout: one day at a time, or the whole week stacked. */
export type CalendarViewMode = 'daily' | 'weekly'

interface WorkWeekCalendarProps<T> {
  weekStart: Date
  onWeekStartChange: (weekStart: Date) => void
  /** The day the agenda/expanded column shows; null means "today, or the first
   *  day of the shown week". */
  selectedDay: Date | null
  onSelectDay: (day: Date | null) => void
  /** Phone-only view mode, owned by the caller so it survives re-renders. */
  viewMode: CalendarViewMode
  onViewModeChange: (mode: CalendarViewMode) => void
  itemsForDay: (day: Date) => T[]
  itemKey: (item: T) => string
  /** `compact` is true for the narrow desktop columns that aren't expanded. */
  renderItem: (item: T, compact: boolean) => React.ReactNode
  /**
   * Plain-text title, used for the sliver preview a collapsed column shows on
   * phones — at a twelfth of the screen there is no room for the compact card,
   * only a couple of truncated words. Without it a collapsed phone column
   * shows just its count.
   */
  itemLabel?: (item: T) => string
  /** Staff-only "add work on this day" affordance. */
  onAddForDay?: (day: Date) => void
  /** Noun used in the add button, e.g. "homework". */
  addNoun?: string
  emptyDayLabel?: string
  theme?: CalendarTheme
  /** Chrome for the outer card. The default runs edge-to-edge on phones (only
   *  top/bottom borders) for a full-bleed page; pass BLEED_CARD_INSET when the
   *  page keeps a gutter the calendar should break out of. */
  rootClassName?: string
}

/* The `!` on every radius below (and on the controls inside the calendar) keeps
   the soft corners even on the square-cornered staff pages — the calendar is a
   shared student/staff surface, so it holds its own shape rather than taking
   the page's. See the pro-chrome block in globals.css. */

/** The calendar's card: soft corners at every width, inset from the screen
 *  edge on phones like every other card in Academics and Classrooms. (The
 *  names are the ones the callers have always imported; neither bleeds any
 *  more.) */
export const BLEED_CARD = 'bg-white border border-slate-200 !rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,.05),0_10px_24px_-18px_rgba(15,23,42,.4)] overflow-hidden'
export const BLEED_CARD_INSET = BLEED_CARD

/** Below this width a column strip can't fit six readable columns beside an
 *  expanded one at 3x, so the expanded column takes 6x instead — the ratio the
 *  home page's swipeable week card uses at the same width (MiniWeekCalendar). */
const NARROW_WIDTH = 480

// ── Component ────────────────────────────────────────────────────────────────

/**
 * The week calendar shared by the classroom Calendar tab and the academics
 * School Work Calendar, so both read and behave identically.
 *
 * Phones (up to `lg`) get a Daily/Weekly toggle: Daily — the default — pairs a
 * compact week picker with a full-width agenda for one day, and Weekly shows
 * the swipeable day-column strip, sized exactly like the home page's week card
 * (MiniWeekCalendar): all seven days on screen at once, the open one 6x the
 * width of the rest below NARROW_WIDTH and 3x above it, easing between days on
 * a tap rather than stacking every day's agenda vertically. Closed columns are
 * a sliver at 6x, so they preview titles instead of the compact card.
 *
 * Desktop has room for all seven days at a gentler ratio, so it renders the
 * same strip with the open column at 4x: full rows in the open column, and a
 * compact wrapped card (never truncated) in every other.
 */
export default function WorkWeekCalendar<T>({
  weekStart, onWeekStartChange,
  selectedDay, onSelectDay,
  viewMode, onViewModeChange,
  itemsForDay, itemKey, renderItem, itemLabel,
  onAddForDay, addNoun = 'homework',
  emptyDayLabel = 'Nothing scheduled for this day.',
  theme = PAGE_THEME,
  rootClassName = BLEED_CARD,
}: WorkWeekCalendarProps<T>) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const weekEnd  = addDays(weekStart, 6)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const weekLabel = (() => {
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return `${fmt(weekStart)} – ${fmt(weekEnd)}`
  })()

  // The agenda always has a concrete day; it defaults to today when the shown
  // week contains it, otherwise to the first day of that week.
  const activeDay = selectedDay ?? (today >= weekStart && today <= weekEnd ? today : weekStart)
  const agendaItems = itemsForDay(activeDay)
  const weekCount = weekDays.reduce((n, d) => n + itemsForDay(d).length, 0)

  const goToToday = () => { onWeekStartChange(getWeekStart(new Date())); onSelectDay(today) }

  const gradient = `linear-gradient(to bottom, ${theme.gradFrom}, ${theme.gradTo})`

  /** One day's rows, used by the phone agenda (daily) and each week section. */
  const dayRows = (day: Date, items: T[]) => (
    <div className="divide-y divide-slate-100">
      {items.length === 0 && (
        <p className="px-4 py-7 text-center text-sm text-slate-500">{emptyDayLabel}</p>
      )}
      {items.map(item => (
        <React.Fragment key={itemKey(item)}>{renderItem(item, false)}</React.Fragment>
      ))}
    </div>
  )

  const addButton = (day: Date, label: string, slim = false) => onAddForDay && (
    <button
      onClick={() => onAddForDay(day)}
      className={`w-full flex items-center justify-center gap-1.5 font-semibold border-t border-slate-100 transition-all hover:brightness-95 ${
        slim ? 'py-2 text-[11px]' : 'py-3 text-xs'
      }`}
      style={slim
        ? { color: theme.primaryDark }
        : { color: theme.primaryDark, background: theme.primaryLight }}
    >
      <Plus size={slim ? 12 : 14} /> {label}
    </button>
  )

  // The phone strip sizes its columns off its own width, the way the home
  // page's week card does: below NARROW_WIDTH the open column takes 6x the
  // others, above it 3x. Measured rather than assumed, since the same strip
  // renders inside a full-bleed page and inside a classroom tab.
  const stripRef = useRef<HTMLDivElement>(null)
  const [stripNarrow, setStripNarrow] = useState(true)
  useLayoutEffect(() => {
    const el = stripRef.current
    if (!el) return
    const measure = () => setStripNarrow(el.offsetWidth < NARROW_WIDTH)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [viewMode])

  /** One day's column for the swipeable day strip, shared by the phone weekly
   *  view and the desktop layout. `expandRatio` is how many times wider the
   *  open column runs than a closed one; `sliver` says the closed columns are
   *  too narrow for the compact card and show a title preview instead. */
  const dayColumn = (
    day: Date, i: number,
    { expandRatio, sliver = false }: { expandRatio: number; sliver?: boolean },
  ) => {
    const isToday    = isSameDay(day, today)
    const isExpanded = isSameDay(day, activeDay)
    const isLastCol  = i === 6
    const items      = itemsForDay(day)

    return (
      <div
        key={day.toISOString()}
        style={{
          flex: `${isExpanded ? expandRatio : 1} ${isExpanded ? expandRatio : 1} 0%`,
          // Matches the home page's week card, so switching days eases open at
          // the same rate wherever the strip is used.
          transition: 'flex 0.35s ease',
        }}
        className={`min-w-0 flex flex-col ${!isLastCol ? 'border-r border-slate-100' : ''}`}
      >
        {/* Day header — click to expand this day. Every column renders the
            same two lines at the same sizes, so expanding one day never
            leaves the header row ragged. No per-day count line: the column
            below already shows the day's work, and dropping it buys back a
            row of height across all seven columns. */}
        <button
          onClick={() => onSelectDay(day)}
          className={`px-2 py-2.5 text-center border-b transition-all ${
            isExpanded
              ? 'border-transparent'
              : isToday
                ? 'border-slate-200 hover:brightness-95'
                : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
          }`}
          style={
            isExpanded
              ? { background: gradient }
              : isToday
                ? { background: theme.primaryLight }
                : undefined
          }
        >
          <p
            className={`text-[10px] font-bold uppercase tracking-wide ${isExpanded ? 'text-white/80' : 'text-slate-500'}`}
            style={!isExpanded && isToday ? { color: theme.primary } : undefined}
          >
            {DAY_NAMES[i]}
          </p>
          <p className={`text-sm font-bold leading-tight ${isExpanded ? 'text-white' : 'text-slate-700'}`}>
            {day.getDate()}
            {isExpanded && isToday && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-white/80 align-middle">Today</span>}
          </p>
        </button>

        {/* Day content. A closed sliver column is a twelfth of the screen, so
            it previews titles the way the home page's week card does; every
            other closed column has room for the compact card. */}
        <div className={`flex-1 overflow-y-auto max-h-[32rem] ${
          isExpanded ? 'divide-y divide-slate-100' : sliver ? 'px-0.5 py-1 space-y-1 bg-slate-50/30' : 'p-1.5 space-y-1.5 bg-slate-50/30'
        }`}>
          {/* An empty narrow column says nothing — an empty strip reads as
              "nothing due" on its own, so the add button sits straight under
              the header instead of below a placeholder dash. */}
          {items.length === 0 && isExpanded && (
            <p className="text-slate-500 text-center py-7 text-sm">{emptyDayLabel}</p>
          )}
          {!isExpanded && sliver
            ? itemLabel && items.slice(0, 3).map(item => (
                <p
                  key={itemKey(item)}
                  title={itemLabel(item)}
                  className="text-[8px] leading-tight text-center text-slate-500 truncate"
                >
                  {itemLabel(item)}
                </p>
              ))
            : items.map(item => (
                <React.Fragment key={itemKey(item)}>{renderItem(item, !isExpanded)}</React.Fragment>
              ))}
          {!isExpanded && sliver && items.length > 3 && (
            <p className="text-[8px] leading-tight text-center font-semibold" style={{ color: theme.primary }}>
              +{items.length - 3}
            </p>
          )}
          {onAddForDay && !(sliver && !isExpanded) && (
            <button
              onClick={() => onAddForDay(day)}
              className={`flex items-center justify-center gap-1 !rounded-lg border border-dashed border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 ${
                isExpanded ? 'w-[calc(100%-0.75rem)] m-1.5 py-2.5 text-xs font-semibold' : 'w-full py-1'
              }`}
              title={`Add ${addNoun} for this day`}
            >
              <Plus size={isExpanded ? 13 : 12} /> {isExpanded ? `Add ${addNoun}` : null}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={rootClassName}>

      {/* Week navigation — shared by both layouts. Deliberately unpainted: the
          themed strip used to shout louder than the week itself, so the bar is
          transparent and carries only the week label (one line, no count
          subtext — the day columns already show the week's work). */}
      <div className="flex items-center gap-2 px-2 py-2 bg-transparent border-b border-slate-200">
        <button
          onClick={() => { onWeekStartChange(addDays(weekStart, -7)); onSelectDay(null) }}
          className="p-1.5 !rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:scale-90 transition-all flex-shrink-0"
          aria-label="Previous week"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={goToToday}
          className="flex-1 min-w-0 text-center !rounded-full py-0.5 hover:bg-slate-50 transition-colors"
          title="Jump to this week"
        >
          <span className="block text-sm font-bold text-slate-800 truncate">{weekLabel}</span>
        </button>
        <button
          onClick={() => { onWeekStartChange(addDays(weekStart, 7)); onSelectDay(null) }}
          className="p-1.5 !rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:scale-90 transition-all flex-shrink-0"
          aria-label="Next week"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* ── Phone/tablet: Daily ⇄ Weekly ── */}
      <div className="lg:hidden">

        {/* View toggle */}
        <div className="flex items-center justify-between gap-2 px-2.5 py-2 bg-slate-50 border-b border-slate-200">
          <div className="inline-flex !rounded-full bg-white p-0.5 ring-1 ring-slate-200">
            {(['daily', 'weekly'] as const).map(mode => {
              const on = viewMode === mode
              const Icon = mode === 'daily' ? CalendarDays : LayoutList
              return (
                <button
                  key={mode}
                  onClick={() => onViewModeChange(mode)}
                  className={`flex items-center gap-1 px-2.5 py-1 !rounded-full text-[11px] font-bold capitalize transition-all active:scale-95 ${
                    on ? 'text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                  style={on ? { background: gradient } : undefined}
                  aria-pressed={on}
                >
                  <Icon size={12} /> {mode}
                </button>
              )
            })}
          </div>
          <span className="text-[11px] font-semibold text-slate-600 flex-shrink-0">
            {viewMode === 'daily'
              ? `${agendaItems.length} scheduled`
              : `${weekCount} this week`}
          </span>
        </div>

        {viewMode === 'daily' ? (
          <>
            {/* Day picker */}
            <div className="grid grid-cols-7 gap-1 px-1.5 py-2 bg-slate-50 border-b border-slate-200">
              {weekDays.map((day, i) => {
                const isToday  = isSameDay(day, today)
                const isActive = isSameDay(day, activeDay)
                const total    = itemsForDay(day).length
                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => onSelectDay(day)}
                    className={`flex flex-col items-center gap-0.5 py-1.5 !rounded-xl transition-all active:scale-95 ${
                      isActive
                        ? 'text-white shadow-md'
                        : isToday
                          ? 'hover:brightness-95'
                          : 'text-slate-700 hover:bg-white'
                    }`}
                    style={
                      isActive
                        ? { background: gradient }
                        : isToday
                          ? {
                              color: theme.primary,
                              background: theme.primaryLight,
                              boxShadow: `inset 0 0 0 1px ${theme.primary}`,
                            }
                          : undefined
                    }
                  >
                    <span className={`text-[9px] font-bold uppercase tracking-wide ${isActive ? 'text-white/80' : 'text-slate-500'}`}>
                      {DAY_NAMES[i]}
                    </span>
                    <span className="text-[15px] font-bold leading-none">{day.getDate()}</span>
                    <span className="h-1.5 flex items-center gap-0.5">
                      {total > 0 && Array.from({ length: Math.min(total, 3) }).map((_, d) => (
                        <span
                          key={d}
                          className={`w-1 h-1 !rounded-full ${isActive ? 'bg-white/90' : ''}`}
                          style={isActive ? undefined : { background: theme.primary }}
                        />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Selected day heading */}
            <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800 truncate">
                {activeDay.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                {isSameDay(activeDay, today) && (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: theme.primary }}>Today</span>
                )}
              </h3>
              <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 !rounded-full px-2 py-0.5 flex-shrink-0">
                {agendaItems.length} scheduled
              </span>
            </div>

            {/* Schedule list — full width rows, titles wrap instead of truncating */}
            {dayRows(activeDay, agendaItems)}

            {addButton(activeDay, `Add ${addNoun} for ${activeDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`)}
          </>
        ) : (
          /* Weekly — the swipeable day-column strip, sized exactly like the
             home page's week card: all seven days on screen at once, the open
             one 6x the others on a phone (3x once there is room), easing
             between days instead of stacking every day's agenda vertically. */
          <div ref={stripRef} className="flex">
            {weekDays.map((day, i) =>
              dayColumn(day, i, { expandRatio: stripNarrow ? 6 : 3, sliver: stripNarrow }))}
          </div>
        )}
      </div>

      {/* ── Desktop: seven columns, the active day expanded to 4x width ── */}
      <div className="hidden lg:flex">
        {weekDays.map((day, i) => dayColumn(day, i, { expandRatio: 4 }))}
      </div>
    </div>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

/** How many chips each day of the skeleton week shows — an uneven week reads as
 *  a calendar filling in rather than a loading bar. */
const SKELETON_CHIPS = [2, 1, 2, 3, 1, 2, 1]

/** A shimmering placeholder block. `delay` staggers its sweep so a row or
 *  column of them fills in left to right (see `--sk-delay` in globals.css). */
function Sk({ className = '', delay = 0 }: { className?: string; delay?: number }) {
  return (
    <span
      className={`block skeleton skeleton-cool ${className}`}
      style={{ '--sk-delay': `${delay}ms` } as React.CSSProperties}
    />
  )
}

/** One placeholder agenda row — the shape of a real full-width work row: colour
 *  rail, status circle, title, and a meta line of chips. */
function SkAgendaRow({ delay, width }: { delay: number; width: string }) {
  return (
    <div className="flex items-start gap-3 px-3 sm:px-4 py-3">
      <Sk className="self-stretch w-1 !rounded-full" delay={delay} />
      <Sk className="w-3.5 h-3.5 !rounded-full mt-0.5 flex-shrink-0" delay={delay} />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Sk className={`h-3 !rounded-full ${width}`} delay={delay} />
        <div className="flex items-center gap-1.5 pt-0.5">
          <Sk className="h-3 w-14 !rounded" delay={delay + 60} />
          <Sk className="h-3 w-10 !rounded-full" delay={delay + 120} />
          <Sk className="h-3 w-20 !rounded-full" delay={delay + 180} />
        </div>
      </div>
    </div>
  )
}

/**
 * Placeholder for the calendar while its work loads. It renders the real shell
 * — the week bar with the real week label and this week's actual day headers —
 * and, crucially, the *same layout per breakpoint* as the loaded calendar:
 * phones get the Daily view (toggle, day picker, day heading, agenda rows) the
 * calendar opens on, desktop gets seven columns with today's expanded to 4x. So
 * nothing jumps when the data lands, and the shape on screen is already the
 * shape the user is waiting for.
 */
export function WorkWeekCalendarSkeleton({
  weekStart = getWeekStart(new Date()),
  theme = PAGE_THEME,
  rootClassName = BLEED_CARD,
}: {
  weekStart?: Date
  theme?: CalendarTheme
  rootClassName?: string
} = {}) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekLabel = (() => {
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return `${fmt(weekDays[0])} – ${fmt(weekDays[6])}`
  })()
  // The day the loaded calendar would open on — today when this week holds it,
  // otherwise the first day, exactly as `activeDay` resolves above.
  const todayIdx = weekDays.findIndex(d => isSameDay(d, today))
  const openIdx  = todayIdx === -1 ? 0 : todayIdx
  const openDay  = weekDays[openIdx]

  /** A day header, matching the loaded calendar's two-line header exactly. */
  const dayHeader = (day: Date, i: number, open: boolean) => {
    const isToday = isSameDay(day, today)
    return (
      <div
        className={`px-2 py-2.5 text-center border-b ${
          open ? 'border-transparent' : isToday ? 'border-slate-200' : 'bg-slate-50 border-slate-200'
        }`}
        style={open
          ? { background: `linear-gradient(to bottom, ${theme.gradFrom}, ${theme.gradTo})` }
          : isToday ? { background: theme.primaryLight } : undefined}
      >
        <p
          className={`text-[10px] font-bold uppercase tracking-wide ${open ? 'text-white/80' : 'text-slate-500'}`}
          style={!open && isToday ? { color: theme.primary } : undefined}
        >
          {DAY_NAMES[i]}
        </p>
        <p className={`text-sm font-bold leading-tight ${open ? 'text-white' : 'text-slate-700'}`}>
          {day.getDate()}
        </p>
      </div>
    )
  }

  return (
    <div className={rootClassName} aria-busy="true">
      <span className="sr-only">Loading this week&rsquo;s school work…</span>

      {/* Week bar — transparent, with the real label, as the loaded one is */}
      <div className="flex items-center gap-2 px-2 py-2 border-b border-slate-200">
        <ChevronLeft size={18} className="text-slate-300 flex-shrink-0" />
        <span className="flex-1 min-w-0 text-center text-sm font-bold text-slate-800 truncate">
          {weekLabel}
        </span>
        <ChevronRight size={18} className="text-slate-300 flex-shrink-0" />
      </div>

      {/* ── Phone/tablet: the Daily view the calendar opens on ── */}
      <div className="lg:hidden">
        {/* Toggle row */}
        <div className="flex items-center justify-between gap-2 px-2.5 py-2 bg-slate-50 border-b border-slate-200">
          <Sk className="h-6 w-32 !rounded-full" />
          <Sk className="h-3 w-16 !rounded-full" delay={120} />
        </div>

        {/* Day picker — real day names and dates, dots pulsing in */}
        <div className="grid grid-cols-7 gap-1 px-1.5 py-2 bg-slate-50 border-b border-slate-200">
          {weekDays.map((day, i) => {
            const open = i === openIdx
            return (
              <div
                key={day.toISOString()}
                className="flex flex-col items-center gap-0.5 py-1.5 !rounded-xl"
                style={open
                  ? { background: `linear-gradient(to bottom, ${theme.gradFrom}, ${theme.gradTo})` }
                  : undefined}
              >
                <span className={`text-[9px] font-bold uppercase tracking-wide ${open ? 'text-white/80' : 'text-slate-500'}`}>
                  {DAY_NAMES[i]}
                </span>
                <span className={`text-[15px] font-bold leading-none ${open ? 'text-white' : 'text-slate-700'}`}>
                  {day.getDate()}
                </span>
                <span className="h-1.5 flex items-center gap-0.5">
                  {Array.from({ length: Math.min(SKELETON_CHIPS[i], 3) }).map((_, d) => (
                    <Sk key={d} className="w-1 h-1 !rounded-full" delay={i * 70 + d * 40} />
                  ))}
                </span>
              </div>
            )
          })}
        </div>

        {/* Selected day heading — the real date, so it doesn't change */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 truncate">
            {openDay.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </h3>
          <Sk className="h-4 w-20 !rounded-full flex-shrink-0" delay={140} />
        </div>

        {/* Agenda rows */}
        <div className="divide-y divide-slate-100">
          {['w-3/4', 'w-1/2', 'w-2/3'].map((w, i) => (
            <SkAgendaRow key={i} width={w} delay={i * 140} />
          ))}
        </div>
      </div>

      {/* ── Desktop: seven columns, today's expanded to 4x ── */}
      <div className="hidden lg:flex">
        {weekDays.map((day, i) => {
          const open = i === openIdx
          return (
            <div
              key={day.toISOString()}
              style={{ flex: `${open ? 4 : 1} ${open ? 4 : 1} 0%` }}
              className={`min-w-0 flex flex-col ${i < 6 ? 'border-r border-slate-100' : ''}`}
            >
              {dayHeader(day, i, open)}
              {open ? (
                <div className="divide-y divide-slate-100 min-h-[7rem]">
                  {['w-3/5', 'w-2/5', 'w-1/2'].map((w, j) => (
                    <SkAgendaRow key={j} width={w} delay={j * 140} />
                  ))}
                </div>
              ) : (
                <div className="p-1.5 space-y-1.5 min-h-[7rem] bg-slate-50/30">
                  {Array.from({ length: SKELETON_CHIPS[i] }).map((_, j) => (
                    <Sk key={j} className="h-9 w-full !rounded-lg" delay={i * 90 + j * 60} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
