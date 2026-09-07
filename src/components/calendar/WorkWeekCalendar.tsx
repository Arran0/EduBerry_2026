'use client'

import React from 'react'
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
  /** Staff-only "add work on this day" affordance. */
  onAddForDay?: (day: Date) => void
  /** Noun used in the add button, e.g. "homework". */
  addNoun?: string
  emptyDayLabel?: string
  theme?: CalendarTheme
  /** Chrome for the outer card. The default runs edge-to-edge on phones (only
   *  top/bottom borders) for a full-bleed page; pass ROUNDED_CARD when the
   *  calendar sits inside a padded card of its own. */
  rootClassName?: string
}

/** Full-bleed on phones, rounded card from `lg` up — the page-level default. */
export const BLEED_CARD = 'bg-white border-y border-slate-200 lg:border lg:rounded-2xl lg:shadow-sm overflow-hidden'
/** Rounded and bordered at every width, for use inside an existing card. */
export const ROUNDED_CARD = 'bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden'

// ── Component ────────────────────────────────────────────────────────────────

/**
 * The week calendar shared by the classroom Calendar tab and the academics
 * School Work Calendar, so both read and behave identically.
 *
 * Phones (up to `lg`) get a Daily/Weekly toggle: Daily — the default — pairs a
 * compact week picker with a full-width agenda for one day, and Weekly stacks
 * all seven days' agendas, since seven narrow grid columns truncated every
 * title. Desktop has room for all seven days side by side, so it shows a column
 * per day: the selected day's column expands to 4x width with the same full row
 * design as the phone agenda, and every other column narrows to a compact
 * wrapped card (never truncated).
 */
export default function WorkWeekCalendar<T>({
  weekStart, onWeekStartChange,
  selectedDay, onSelectDay,
  viewMode, onViewModeChange,
  itemsForDay, itemKey, renderItem,
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

  return (
    <div className={rootClassName}>

      {/* Week navigation — shared by both layouts */}
      <div
        className="flex items-center gap-2 px-2 py-2.5"
        style={{ background: `linear-gradient(to right, ${theme.gradFrom}, ${theme.gradTo})` }}
      >
        <button
          onClick={() => { onWeekStartChange(addDays(weekStart, -7)); onSelectDay(null) }}
          className="p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/15 active:scale-90 transition-all flex-shrink-0"
          aria-label="Previous week"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={goToToday}
          className="flex-1 min-w-0 text-center leading-tight"
          title="Jump to this week"
        >
          <span className="block text-sm font-bold text-white truncate">{weekLabel}</span>
          <span className="block text-[10px] font-medium text-white/80">
            {weekCount} item{weekCount !== 1 ? 's' : ''} this week · tap for today
          </span>
        </button>
        <button
          onClick={() => { onWeekStartChange(addDays(weekStart, 7)); onSelectDay(null) }}
          className="p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/15 active:scale-90 transition-all flex-shrink-0"
          aria-label="Next week"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* ── Phone/tablet: Daily ⇄ Weekly ── */}
      <div className="lg:hidden">

        {/* View toggle */}
        <div className="flex items-center justify-between gap-2 px-2.5 py-2 bg-slate-50 border-b border-slate-200">
          <div className="inline-flex rounded-full bg-white p-0.5 ring-1 ring-slate-200">
            {(['daily', 'weekly'] as const).map(mode => {
              const on = viewMode === mode
              const Icon = mode === 'daily' ? CalendarDays : LayoutList
              return (
                <button
                  key={mode}
                  onClick={() => onViewModeChange(mode)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold capitalize transition-all active:scale-95 ${
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
                    className={`flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-all active:scale-95 ${
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
                          className={`w-1 h-1 rounded-full ${isActive ? 'bg-white/90' : ''}`}
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
              <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 rounded-full px-2 py-0.5 flex-shrink-0">
                {agendaItems.length} scheduled
              </span>
            </div>

            {/* Schedule list — full width rows, titles wrap instead of truncating */}
            {dayRows(activeDay, agendaItems)}

            {addButton(activeDay, `Add ${addNoun} for ${activeDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`)}
          </>
        ) : (
          /* Weekly — every day of the week stacked, so the whole week reads in
             one scroll without the seven-column squeeze. */
          <div>
            {weekDays.map((day, i) => {
              const items   = itemsForDay(day)
              const isToday = isSameDay(day, today)
              return (
                <div key={day.toISOString()} className={i > 0 ? 'border-t-4 border-slate-100' : ''}>
                  <button
                    onClick={() => { onSelectDay(day); onViewModeChange('daily') }}
                    className="w-full flex items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-slate-100 text-left transition-colors hover:bg-slate-50"
                    style={isToday ? { background: theme.primaryLight } : undefined}
                    title="Open this day"
                  >
                    <span className="flex items-baseline gap-1.5 min-w-0">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide"
                        style={{ color: isToday ? theme.primary : undefined }}
                      >
                        {DAY_NAMES[i]}
                      </span>
                      <span className="text-sm font-bold text-slate-800">{day.getDate()}</span>
                      <span className="text-[11px] text-slate-500 truncate">
                        {day.toLocaleDateString(undefined, { month: 'short' })}
                      </span>
                      {isToday && (
                        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: theme.primary }}>Today</span>
                      )}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 rounded-full px-2 py-0.5 flex-shrink-0">
                      {items.length}
                    </span>
                  </button>

                  {items.length === 0 ? (
                    <p className="px-4 py-3 text-center text-xs text-slate-400">Nothing scheduled.</p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {items.map(item => (
                        <React.Fragment key={itemKey(item)}>{renderItem(item, false)}</React.Fragment>
                      ))}
                    </div>
                  )}
                  {addButton(day, `Add ${addNoun}`, true)}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Desktop: seven columns, the active day expanded to 4x width ── */}
      <div className="hidden lg:flex">
        {weekDays.map((day, i) => {
          const isToday    = isSameDay(day, today)
          const isExpanded = isSameDay(day, activeDay)
          const isLastCol  = i === 6
          const items      = itemsForDay(day)

          return (
            <div
              key={day.toISOString()}
              style={{ flex: isExpanded ? '4 4 0%' : '1 1 0%', transition: 'flex 320ms ease' }}
              className={`min-w-0 flex flex-col ${!isLastCol ? 'border-r border-slate-100' : ''}`}
            >
              {/* Day header — click to expand this day */}
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
                <p className={`font-bold leading-tight ${isExpanded ? 'text-lg text-white' : 'text-sm text-slate-700'}`}>
                  {day.getDate()}
                  {isExpanded && isToday && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-white/80 align-middle">Today</span>}
                </p>
                {isExpanded && (
                  <span className="text-[10px] font-medium text-white/80">{items.length} scheduled</span>
                )}
              </button>

              {/* Day content */}
              <div className={`flex-1 overflow-y-auto max-h-[32rem] ${isExpanded ? 'divide-y divide-slate-100' : 'p-1.5 space-y-1.5 bg-slate-50/30'}`}>
                {items.length === 0 && (
                  <p className={`text-slate-500 text-center ${isExpanded ? 'py-7 text-sm' : 'py-4 text-[10px]'}`}>
                    {isExpanded ? emptyDayLabel : '—'}
                  </p>
                )}
                {items.map(item => (
                  <React.Fragment key={itemKey(item)}>{renderItem(item, !isExpanded)}</React.Fragment>
                ))}
                {onAddForDay && (
                  <button
                    onClick={() => onAddForDay(day)}
                    className={`flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 ${
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
        })}
      </div>
    </div>
  )
}
