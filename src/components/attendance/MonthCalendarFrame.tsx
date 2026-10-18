'use client'

import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * The month calendar's frame, shared by the staff calendar
 * (StaffAttendanceCalendar) and the student one (AttendanceCalendar) so the
 * two apps draw one calendar: a solid card with the month and its tally at the
 * top, round month steppers, the weekday strip, a six-week grid of 52px tiles
 * and a one-line legend.
 *
 * Every band has a fixed height and the grid is always six weeks, so the card
 * is the same height for every month, while loading and once loaded — which
 * is what lets a popup hold it at its exact size with no empty space and no
 * jump. MonthCalendarSkeleton (below) is the same frame in grey.
 */

export const CALENDAR_DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** Six weeks, every month. */
export const CALENDAR_CELLS = 42
export const TILE = 'h-[52px] rounded-xl'

export interface TallyChip {
  key: string
  label: string
  /** Dot colour. */
  color: string
  /** null while loading. */
  value: number | string | null
  title?: string
  tone?: 'default' | 'alert'
}

export interface LegendItem {
  label: string
  color?: string
  icon?: React.ReactNode
}

/** First-of-month offset and the 42 cells (day numbers, or null for padding). */
export function monthCells(year: number, month: number): (number | null)[] {
  const first = new Date(year, month - 1, 1)
  const offset = (first.getDay() + 6) % 7
  const total = new Date(year, month, 0).getDate()
  const cells: (number | null)[] = Array(offset).fill(null)
  for (let d = 1; d <= total; d++) cells.push(d)
  while (cells.length < CALENDAR_CELLS) cells.push(null)
  return cells
}

/**
 * A cell outside the month — the tail of the month before or the start of the
 * next — drawn faintly with its real date, so the six-week grid has no blank
 * row or holes: the calendar keeps one height without showing empty space.
 */
export function OutsideTile({ year, month, index }: { year: number; month: number; index: number }) {
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const total = new Date(year, month, 0).getDate()
  const day = index < offset
    ? new Date(year, month - 1, 0).getDate() - offset + index + 1
    : index - offset - total + 1
  return (
    <div className={`${TILE} flex items-center justify-center bg-slate-50/60`} aria-hidden>
      <span className="text-[12px] font-semibold tabular-nums text-slate-300/80">{day}</span>
    </div>
  )
}

export function monthLongName(year: number, month: number) {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long' })
}

const NAV_BTN = 'w-8 h-8 rounded-full flex items-center justify-center text-slate-500 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 active:scale-95 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40'

export function MonthCalendarFrame({
  year, month, onPrev, onNext, tally, legend, children, below,
}: {
  year: number
  month: number
  onPrev?: () => void
  onNext?: () => void
  tally: TallyChip[]
  legend: LegendItem[]
  /** The grid: 42 tiles (see CalendarGrid). */
  children: React.ReactNode
  /** Anything that belongs under the legend (a selection bar). Not part of the fixed height. */
  below?: React.ReactNode
}) {
  return (
    <div className="rounded-[20px] overflow-hidden bg-white ring-1 ring-slate-900/[0.06] shadow-[0_1px_2px_rgba(15,23,42,0.05),0_14px_30px_-22px_rgba(15,23,42,0.4)]">
      {/* Header: month, its tally, and the steppers — fixed at 64px */}
      <div className="flex items-center gap-3 px-3.5 sm:px-4 h-16">
        <div className="flex-1 min-w-0">
          <h3 className="h-[22px] font-display text-[17px] font-bold text-slate-900 leading-[22px] truncate" aria-live="polite">
            {monthLongName(year, month)} <span className="font-semibold text-slate-400">{year}</span>
          </h3>
          <div className="h-[18px] mt-1 flex items-center gap-1 overflow-hidden whitespace-nowrap">
            {tally.map(t => (
              <span
                key={t.key}
                title={t.title ?? t.label}
                className={`inline-flex items-center gap-1 h-[18px] text-[10.5px] font-semibold px-1.5 rounded-full ring-1 tabular-nums flex-shrink-0 ${
                  t.tone === 'alert' ? 'bg-red-50 ring-red-600/15 text-red-700' : 'bg-slate-50 ring-slate-900/[0.05] text-slate-600'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
                {t.label} {t.value === null ? '–' : t.value}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={onPrev} disabled={!onPrev} aria-label="Previous month" className={NAV_BTN}>
            <ChevronLeft size={16} />
          </button>
          <button onClick={onNext} disabled={!onNext} aria-label="Next month" className={NAV_BTN}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Weekday strip */}
      <div className="grid grid-cols-7 gap-1 px-1.5 h-6 items-center">
        {CALENDAR_DAY_HEADERS.map(h => (
          <div key={h} className={`text-center text-[10px] font-semibold ${h === 'Sun' ? 'text-slate-300' : 'text-slate-400'}`}>{h}</div>
        ))}
      </div>

      {/* Six weeks of tiles */}
      <div className="grid grid-cols-7 gap-1 px-1.5 pb-1.5">{children}</div>

      {/* Legend — one line, never wraps (it scrolls sideways on a narrow phone) */}
      <div className="h-8 px-4 border-t border-slate-100 flex items-center gap-3 overflow-x-auto scrollbar-hide whitespace-nowrap">
        {legend.map(l => (
          <span key={l.label} className="inline-flex items-center gap-1.5 flex-shrink-0">
            {l.icon ?? <span className="w-2 h-2 rounded-full" style={{ background: l.color }} />}
            <span className="text-[10px] text-slate-500 font-medium">{l.label}</span>
          </span>
        ))}
      </div>
      {below}
    </div>
  )
}

/** The 42 tiles in grey. */
export function CalendarTilesSkeleton() {
  return (
    <>
      {Array.from({ length: CALENDAR_CELLS }).map((_, i) => (
        <div key={i} className={`${TILE} bg-slate-50 flex items-center justify-center`}>
          <div className="w-6 h-6 rounded-lg bg-slate-200/70 animate-pulse" style={{ animationDelay: `${(i % 7) * 60}ms` }} />
        </div>
      ))}
    </>
  )
}

/**
 * The whole calendar in grey, at its exact size — the fallback while either
 * calendar's code is still downloading.
 */
export function MonthCalendarSkeleton({ legend = DEFAULT_LEGEND }: { legend?: LegendItem[] }) {
  const now = new Date()
  return (
    <div aria-busy="true" aria-label="Loading calendar">
      <MonthCalendarFrame
        year={now.getFullYear()}
        month={now.getMonth() + 1}
        tally={DEFAULT_TALLY}
        legend={legend}
      >
        <CalendarTilesSkeleton />
      </MonthCalendarFrame>
    </div>
  )
}

/** The shared status palette — the student calendar's colours, used by both. */
export const CAL_COLORS = {
  present: { bg: '#ecfdf5', text: '#065f46', border: '#6ee7b7', dot: '#10b981' },
  absent: { bg: '#fff1f2', text: '#881337', border: '#fca5a5', dot: '#f43f5e' },
  late: { bg: '#fffbeb', text: '#78350f', border: '#fcd34d', dot: '#f59e0b' },
  on_leave: { bg: '#f0f9ff', text: '#075985', border: '#7dd3fc', dot: '#0ea5e9' },
  excused: { bg: '#f5f3ff', text: '#4c1d95', border: '#c4b5fd', dot: '#7c3aed' },
  on_duty: { bg: '#f0fdfa', text: '#134e4a', border: '#5eead4', dot: '#14b8a6' },
  half_day: { bg: '#fff7ed', text: '#7c2d12', border: '#fdba74', dot: '#f97316' },
  e: { bg: '#f5f3ff', text: '#5b21b6', border: '#c4b5fd', dot: '#8b5cf6' },
  holiday: { bg: '#faf5ff', text: '#7e22ce', border: '#e9d5ff', dot: '#a855f7' },
  non_working: { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0', dot: '#94a3b8' },
} as const

const DEFAULT_TALLY: TallyChip[] = [
  { key: 'p', label: 'P', color: CAL_COLORS.present.dot, value: null },
  { key: 'a', label: 'A', color: CAL_COLORS.absent.dot, value: null },
  { key: 'l', label: 'L', color: CAL_COLORS.late.dot, value: null },
  { key: 'hd', label: 'HD', color: CAL_COLORS.half_day.dot, value: null },
]

/** The student calendar's legend. */
export const STUDENT_CAL_LEGEND: LegendItem[] = [
  { label: 'Present', color: CAL_COLORS.present.dot },
  { label: 'Absent', color: CAL_COLORS.absent.dot },
  { label: 'Late', color: CAL_COLORS.late.dot },
  { label: 'Half day', color: CAL_COLORS.half_day.dot },
  { label: 'Leave approved', color: '#10b981' },
  { label: 'Leave pending', color: '#fbbf24' },
]

/** The staff calendar's legend. */
export const STAFF_CAL_LEGEND: LegendItem[] = [
  { label: 'Present', color: CAL_COLORS.present.dot },
  { label: 'Absent', color: CAL_COLORS.absent.dot },
  { label: 'Late', color: CAL_COLORS.late.dot },
  { label: 'Half day', color: CAL_COLORS.half_day.dot },
  { label: 'On leave', color: CAL_COLORS.on_leave.dot },
  { label: 'Exception', color: CAL_COLORS.e.dot },
  { label: 'Holiday', color: CAL_COLORS.holiday.dot },
  { label: 'Leave applied', color: '#fbbf24' },
]

const DEFAULT_LEGEND = STUDENT_CAL_LEGEND
