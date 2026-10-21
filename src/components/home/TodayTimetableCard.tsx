'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import {
  fetchTimetableForStudent,
  entryTeacherLabel,
  WEEKDAYS,
  type PeriodSlot,
  type TimetableEntry,
  type TimetableViewData,
} from '@/lib/timetable'
import { applyOverrides, todayISO } from '@/lib/timetable/overrides'
import type { EntryOverride } from '@/lib/timetable/overrides'
import { SkeletonRows } from './HomeCardSkeletons'
import { useReportContent } from './useReportContent'

interface Period {
  slot: PeriodSlot
  /** Period number within the slot's own period group. */
  n: number
  entry: TimetableEntry | null
  /** True when a per-date change put this lesson here, or moved it away. */
  changed: boolean
}

function formatTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'pm' : 'am'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${m}${ampm}`
}

const toMinutes = (t: string) => {
  const [h, m] = t.split(':')
  return parseInt(h, 10) * 60 + parseInt(m, 10)
}

/** Whether the clock is inside this slot right now. */
function isNow(slot: PeriodSlot): boolean {
  if (!slot.start_time || !slot.end_time) return false
  const d = new Date()
  const mins = d.getHours() * 60 + d.getMinutes()
  return mins >= toMinutes(slot.start_time) && mins < toMinutes(slot.end_time)
}

interface TodayTimetableCardProps {
  /** Reports, once loaded, whether the card has anything to show. */
  onContent?: (has: boolean) => void
  userId: string
}

/** Compact view of the student's periods for today, opening the full
 *  timetable app on tap. */
export default function TodayTimetableCard({ userId, onContent }: TodayTimetableCardProps) {
  const [periods, setPeriods] = useState<Period[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchTimetableForStudent(userId)
      .then((views: TimetableViewData[]) => {
        if (cancelled) return
        const view = views[0]
        if (!view) { setPeriods([]); return }
        // WEEKDAYS is Monday-first; JS getDay() is Sunday=0.
        const today = WEEKDAYS[(new Date().getDay() + 6) % 7]
        // This card is about one specific date, so it is the one place that
        // resolves the per-date changes outright rather than flagging them:
        // a cancelled period is gone and a cover lesson is the lesson.
        const resolved = applyOverrides(
          view.entries,
          (view.overrides ?? []) as EntryOverride[],
          todayISO(),
        )
        // Free periods are listed too, but only from the period group(s) this
        // class actually follows — another group's P1 is not this class's.
        const slotGroup = new Map(view.slots.map(s => [s.id, s.group_id ?? '']))
        const ownGroups = new Set(view.entries.map(e => slotGroup.get(e.slot_id)))
        const teaching = [...view.slots]
          .filter(s => !s.is_break && ownGroups.has(s.group_id ?? ''))
          .sort((a, b) => a.position - b.position)
        const counted = new Map<string, number>()
        const list: Period[] = teaching.map(slot => {
          const n = (counted.get(slot.group_id ?? '') ?? 0) + 1
          counted.set(slot.group_id ?? '', n)
          const entry = resolved.find(e => e.day === today && e.slot_id === slot.id) ?? null
          return { slot, n, entry, changed: !!entry?.override }
        })
        setPeriods(list)
      })
      .catch(err => {
        console.error('Failed to load timetable for home card:', err)
        if (!cancelled) setPeriods([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  const hasAny = periods && periods.some(p => p.entry?.subject_id)
  useReportContent(loading, !!hasAny, onContent)

  return (
    <Link href="/more/timetable" className="block h-full">
      {/* No title row: the section heading above the card already names it. */}
      <div className="home-card glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col cursor-pointer">
        {loading ? (
          <SkeletonRows rows={5} lead="time" />
        ) : !hasAny ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center mb-3">
              <CalendarClock size={22} className="text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-400">No periods today</p>
          </div>
        ) : (
          // Every period of the day, free ones included, sharing the card's
          // height: rows grow to fill a tall deck card (capped so a short day
          // doesn't balloon) and shrink to 20px, so 12 periods fit the 260px
          // card without scrolling.
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col px-2 py-2">
            {periods!.map(({ slot, n, entry, changed }) => {
              const subj = entry?.subject_id ? entry.subject : null
              const teacher = subj && entry ? entryTeacherLabel(entry) : null
              const now = isNow(slot)
              return (
                <div
                  key={slot.id}
                  className={`flex-1 min-h-[20px] max-h-[52px] flex items-center gap-2.5 px-3 rounded-xl ${now ? 'bg-indigo-50 ring-1 ring-indigo-200' : ''}`}
                >
                  <span className={`w-8 flex-shrink-0 text-[11px] font-semibold tabular-nums leading-none ${now ? 'text-indigo-600' : 'text-slate-400'}`}>
                    P{n}
                  </span>
                  <span
                    aria-hidden
                    className="w-[3px] self-stretch my-1 rounded-full flex-shrink-0"
                    style={{ background: subj ? (subj.color ?? '#6366F1') : 'transparent' }}
                  />
                  <p className="flex-1 min-w-0 truncate text-[13px] leading-tight">
                    {subj ? (
                      <>
                        <span className="font-semibold text-slate-800">{subj.name}</span>
                        {teacher && <span className="text-[11.5px] text-slate-400"> · {teacher}</span>}
                      </>
                    ) : (
                      <span className="text-slate-300">Free</span>
                    )}
                  </p>
                  {slot.start_time && (
                    <span className="hidden min-[380px]:inline text-[10.5px] text-slate-400 tabular-nums flex-shrink-0 leading-none">
                      {formatTime(slot.start_time)}
                    </span>
                  )}
                  {now && (
                    <span className="text-[9px] leading-none font-bold uppercase tracking-wider text-white bg-indigo-500 rounded-full px-1.5 py-[3px] flex-shrink-0">
                      Now
                    </span>
                  )}
                  {changed && (
                  <span
                    className="text-[9px] leading-none font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-1 py-[2px] flex-shrink-0"
                    title="Changed just for today"
                  >
                    Today
                  </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Link>
  )
}
