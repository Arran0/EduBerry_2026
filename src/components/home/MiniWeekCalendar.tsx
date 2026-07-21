'use client'

import React, { useState, useMemo, useRef, useLayoutEffect } from 'react'
import { CheckCircle2 } from 'lucide-react'

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
}

/** The shared week-strip UI for the home carousel's mini calendars: today's
 *  column starts expanded (3x wide-card / 6x narrow-card), clicking another day
 *  swaps which column is expanded; unexpanded columns preview item titles. */
export default function MiniWeekCalendar({ itemsByDay, loading, accent = 'violet' }: MiniWeekCalendarProps) {
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
    <div ref={rootRef} className="glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="spinner" />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {weekDays.map((day, i) => {
            const key = formatDateKey(day)
            const dayItems = itemsByDay.get(key) ?? []
            const isToday = isSameDay(day, today)
            const isExpanded = isSameDay(day, expandedDate)
            const isLast = i === 6
            const collapsedPreview = dayItems.slice(0, 3)
            const collapsedOverflow = dayItems.length - collapsedPreview.length

            return (
              <div
                key={key}
                onClick={() => setExpandedDate(day)}
                style={{ flex: isExpanded ? expandRatio : 1, transition: 'flex 0.35s ease', minWidth: 0 }}
                className={`flex flex-col cursor-pointer select-none ${!isLast ? 'border-r border-white/25' : ''} ${isToday ? c.todayBg : ''}`}
              >
                <div className={`px-1 py-2 text-center flex-shrink-0 transition-colors duration-300 ${isExpanded ? c.headBg : ''}`}>
                  <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{DAY_LETTERS[i]}</p>
                  <p className={`text-sm font-bold leading-tight mt-0.5 ${isToday ? c.todayText : 'text-slate-700'}`}>{day.getDate()}</p>
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-hide px-1 pb-2 space-y-1 min-w-0">
                  {dayItems.length === 0 ? (
                    isExpanded && <p className="text-[10px] text-slate-400 text-center mt-4">Nothing due</p>
                  ) : isExpanded ? (
                    dayItems.map(item => (
                      <div
                        key={item.id}
                        className={`flex items-center gap-1 px-1.5 py-1 rounded-lg text-[10px] leading-tight ${item.done ? 'bg-emerald-50 text-emerald-700' : 'bg-white/60 text-slate-600'}`}
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
      )}
    </div>
  )
}
