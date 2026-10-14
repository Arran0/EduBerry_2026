'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ChevronRight } from 'lucide-react'
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

interface Period {
  slot: PeriodSlot
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

interface TodayTimetableCardProps {
  userId: string
}

/** Compact view of the student's periods for today, opening the full
 *  timetable app on tap. */
export default function TodayTimetableCard({ userId }: TodayTimetableCardProps) {
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
        const teaching = [...view.slots]
          .filter(s => !s.is_break)
          .sort((a, b) => a.position - b.position)
        const list: Period[] = teaching.map(slot => {
          const entry = resolved.find(e => e.day === today && e.slot_id === slot.id) ?? null
          return { slot, entry, changed: !!entry?.override }
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

  return (
    <Link href="/more/timetable">
      <div className="home-card glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col cursor-pointer group">
        <div className="px-5 pt-4 pb-3 border-b border-white/25 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-indigo-500" />
            <span className="text-sm font-bold text-slate-700">Today&apos;s timetable</span>
          </div>
          <ChevronRight size={15} className="text-slate-300 transition-all duration-200 group-hover:text-slate-500 group-hover:translate-x-0.5" />
        </div>
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
          <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-white/25">
            {periods!.filter(p => p.entry?.subject_id).map(({ slot, entry, changed }) => (
              <div key={slot.id} className="home-card-row flex items-center gap-3 px-5 py-2.5">
                <span className="text-[11px] font-semibold text-slate-400 tabular-nums w-14 flex-shrink-0">
                  {formatTime(slot.start_time)}
                </span>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-slate-800 text-sm truncate">
                    {entry?.subject?.name || slot.label || 'Period'}
                  </h4>
                  {entry && entryTeacherLabel(entry) && (
                    <p className="text-[11px] text-slate-400 truncate">{entryTeacherLabel(entry)}</p>
                  )}
                </div>
                {changed && (
                  <span
                    className="text-[9px] md:text-[11px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 flex-shrink-0"
                    title="Changed just for today"
                  >
                    Today
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
