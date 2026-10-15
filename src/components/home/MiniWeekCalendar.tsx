'use client'

import React, { useState, useMemo, useRef, useLayoutEffect } from 'react'
import { ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { SkeletonBar } from './HomeCardSkeletons'

export interface MiniCalendarItem {
  id: string
  title: string
  done: boolean
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// Below this card width there isn't room for six normal-sized columns to sit
// comfortably alongside an expanded one at 3x, so narrow (phone-width) cards
// push the expanded/collapsed ratio up to 6x to make the open day legible.
const NARROW_WIDTH = 480

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

export function formatDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const ACCENTS = {
  violet: { todayBg: 'bg-violet-500/10', headBg: 'bg-violet-500/15', todayText: 'text-violet-600', dot: 'bg-violet-400', overflow: 'text-violet-500' },
  sky:    { todayBg: 'bg-sky-500/10',    headBg: 'bg-sky-500/15',    todayText: 'text-sky-600',    dot: 'bg-sky-400',    overflow: 'text-sky-500' },
}

interface MiniWeekCalendarProps {
  /** Items keyed by local YYYY-MM-DD day. */
  itemsByDay: Map<string, MiniCalendarItem[]>
  loading: boolean
  accent?: keyof typeof ACCENTS
  /** Staff-only surfaces (e.g. the task calendar) render on the square-cornered
   *  pro-card material instead of the student-facing frosted glass-card. */
  sharp?: boolean
  /** Clicking the day that is already open follows through to the full
   *  calendar (the task manager, or the academics school-work calendar) for
   *  that date. The first click on a day only opens it, as before. */
  onOpenDay?: (dateKey: string) => void
  /** Take the parent's height instead of the phone card's fixed 260px — the
   *  desktop split gives the calendar a fixed-height column of its own. */
  fill?: boolean
}

/** The shared week-strip UI for the home carousel's mini calendars: today's
 *  column starts expanded (3x wide-card / 6x narrow-card), clicking another day
 *  swaps which column is expanded; unexpanded columns preview item titles. */
export default function MiniWeekCalendar({ itemsByDay, loading, accent = 'violet', sharp = false, onOpenDay, fill = false }: MiniWeekCalendarProps) {
  const c = ACCENTS[accent]
  const rootRef = useRef<HTMLDivElement>(null)
  const [isNarrow, setIsNarrow] = useState(true)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setIsNarrow(el.offsetWidth < NARROW_WIDTH)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const expandRatio = isNarrow ? 6 : 3

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const [expandedDate, setExpandedDate] = useState<Date>(today)
  const weekStart = useMemo(() => getWeekStart(today), [today])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  return (
    <div ref={rootRef} className={`${fill ? 'h-full rounded-[22px]' : 'home-card h-[260px]'} ${sharp ? 'pro-card' : 'glass-card rounded-[1.4rem]'} overflow-hidden flex flex-col`}>
      {/* The week itself needs no data — the seven columns, their letters and
          their dates are known the moment the card mounts. So the scaffold is
          drawn straight away and only the *entries* are placeholders while the
          fetch is in flight. Nothing is replaced when the data lands; the
          shimmer lines simply become titles. (This card is `wide` on the
          dashboard, so the spinner-in-an-empty-box it used to show was a lone
          24px dot in about 1300×260 of nothing.) */}
        <div className="flex-1 flex min-h-0">
          {weekDays.map((day, i) => {
            const key = formatDateKey(day)
            const dayItems = loading ? [] : (itemsByDay.get(key) ?? [])
            const isToday = isSameDay(day, today)
            const isExpanded = isSameDay(day, expandedDate)
            const isLast = i === 6
            const collapsedPreview = dayItems.slice(0, 3)
            const collapsedOverflow = dayItems.length - collapsedPreview.length

            return (
              <div
                key={key}
                role="button"
                tabIndex={loading ? -1 : 0}
                aria-expanded={isExpanded}
                aria-label={isExpanded && onOpenDay
                  ? `Open ${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} in the full calendar`
                  : day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                onClick={() => {
                  if (loading) return
                  if (isExpanded && onOpenDay) onOpenDay(key)
                  else setExpandedDate(day)
                }}
                onKeyDown={e => {
                  if (loading || (e.key !== 'Enter' && e.key !== ' ')) return
                  e.preventDefault()
                  if (isExpanded && onOpenDay) onOpenDay(key)
                  else setExpandedDate(day)
                }}
                style={{ flex: isExpanded ? expandRatio : 1, transition: 'flex 0.35s ease', minWidth: 0 }}
                className={`group/day flex flex-col select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/60 ${loading ? '' : 'cursor-pointer'} ${!isLast ? (sharp ? 'border-r border-slate-200' : 'border-r border-white/25') : ''} ${isToday ? c.todayBg : ''}`}
              >
                <div className={`relative px-1 py-2 text-center flex-shrink-0 transition-colors duration-300 ${isExpanded ? c.headBg : ''}`}>
                  <p className="text-[9px] md:text-[11px] font-bold uppercase tracking-wide text-slate-500">{DAY_LETTERS[i]}</p>
                  <p className={`text-sm ${fill ? 'lg:text-base' : ''} font-bold leading-tight mt-0.5 ${isToday ? c.todayText : 'text-slate-700'}`}>{day.getDate()}</p>
                  {/* The open day's second click goes through to the full
                      calendar — say so, quietly, where the eye already is. */}
                  {isExpanded && onOpenDay && !loading && (
                    <span className={`absolute top-1.5 right-1.5 inline-flex items-center gap-0.5 text-[9px] font-semibold ${c.todayText} opacity-60 group-hover/day:opacity-100 transition-opacity`}>
                      <span className="hidden sm:inline">Open</span>
                      <ArrowUpRight size={11} />
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-hide px-1 pb-2 space-y-1 min-w-0">
                  {loading ? (
                    /* Entry-shaped placeholders: a few in the open column, a
                       hint in the narrow ones, staggered across the week so it
                       fills left to right instead of flashing as one block. */
                    Array.from({ length: isExpanded ? 5 : 2 }).map((_, j) => (
                      <SkeletonBar
                        key={j}
                        h={isExpanded ? 14 : 7}
                        w={isExpanded ? `${94 - j * 8}%` : '100%'}
                        rounded={!sharp}
                        cool
                        delay={i * 0.06 + j * 0.05}
                        className={isExpanded ? '' : 'mx-auto'}
                      />
                    ))
                  ) : dayItems.length === 0 ? (
                    isExpanded && <p className="text-[10px] text-slate-400 text-center mt-4">Nothing due</p>
                  ) : isExpanded ? (
                    dayItems.map(item => (
                      <div
                        key={item.id}
                        className={`flex items-center gap-1 px-1.5 py-1 ${fill ? 'text-[10px] lg:text-[11.5px] lg:py-1.5' : 'text-[10px]'} leading-tight ${sharp ? '' : 'rounded-lg'} ${item.done ? 'bg-emerald-50 text-emerald-700' : (sharp ? 'bg-slate-100 text-slate-600' : 'bg-white/60 text-slate-600')}`}
                      >
                        {item.done
                          ? <CheckCircle2 size={10} className="flex-shrink-0 text-emerald-500" />
                          : <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />}
                        <span className="truncate">{item.title}</span>
                      </div>
                    ))
                  ) : (
                    <>
                      {collapsedPreview.map(item => (
                        <p
                          key={item.id}
                          title={item.title}
                          className={`text-[8px] leading-tight truncate text-center ${item.done ? 'text-emerald-500' : 'text-slate-500'}`}
                        >
                          {item.title}
                        </p>
                      ))}
                      {collapsedOverflow > 0 && (
                        <p className={`text-[8px] leading-tight text-center font-semibold ${c.overflow}`}>+{collapsedOverflow}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
    </div>
  )
}
