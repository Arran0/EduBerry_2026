'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Award, ChevronRight } from 'lucide-react'
import {
  StudentReportCardEntry,
  fetchAvailableAcademicYearsForStudent,
  fetchReportCardsForStudent,
} from '@/lib/classrooms'
import { useAutoLoadMore } from '@/hooks/useAutoLoadMore'
import { SkeletonRows } from './HomeCardSkeletons'
import { useReportContent } from './useReportContent'

interface ReportCardGroup {
  title: string
  latestDate: number
  count: number
}

interface ReportCardsMiniListProps {
  /** Reports, once loaded, whether the card has anything to show. */
  onContent?: (has: boolean) => void
  userId: string
}

/** Vertically scrollable list of buttons, one per released report card for
 *  the student's most recent academic year, each opening the full report
 *  card section on the academics page. Buttons are revealed a few at a time
 *  (see useAutoLoadMore) instead of rendering the whole list at once. */
export default function ReportCardsMiniList({ userId, onContent }: ReportCardsMiniListProps) {
  const [groups, setGroups] = useState<ReportCardGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [year, setYear] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchAvailableAcademicYearsForStudent(userId)
      .then(years => {
        if (cancelled) return
        const latestYear = years[0] ?? null
        setYear(latestYear)
        return fetchReportCardsForStudent(userId, latestYear)
      })
      .then(map => {
        if (cancelled || !map) return
        const list: ReportCardGroup[] = Array.from(map.entries()).map(([title, entries]) => ({
          title,
          count: entries.length,
          latestDate: Math.max(0, ...entries.map((e: StudentReportCardEntry) => e.assessment.date ? new Date(e.assessment.date).getTime() : 0)),
        })).sort((a, b) => b.latestDate - a.latestDate)
        setGroups(list)
      })
      .catch(err => {
        console.error('Failed to load report cards for home card:', err)
        if (!cancelled) setGroups([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])
  useReportContent(loading, groups.length > 0, onContent)

  const { visibleCount, containerRef, handleScroll } = useAutoLoadMore({
    total: groups.length,
    initialCount: 4,
    step: 4,
    intervalMs: 4000,
    bottomBufferPx: 10,
  })
  const visibleGroups = useMemo(() => groups.slice(0, visibleCount), [groups, visibleCount])

  return (
    <div className="home-card glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      {loading ? (
        <SkeletonRows rows={4} />
      ) : groups.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center mb-3">
            <Award size={22} className="text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-400">No report cards yet</p>
          {year && <p className="text-xs text-slate-300 mt-1">{year}</p>}
        </div>
      ) : (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-white/25"
        >
          {visibleGroups.map(group => (
            <Link key={group.title} href="/academics?section=reportcards">
              <div className="home-card-row flex items-center gap-3 px-5 py-3.5 hover:bg-white/45 transition-colors group cursor-pointer">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-rose-500" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-slate-800 text-sm truncate group-hover:text-slate-900 transition-colors">{group.title}</h4>
                  <p className="text-[11px] text-slate-400 truncate">{group.count} subject{group.count === 1 ? '' : 's'}</p>
                </div>
                <ChevronRight size={14} className="flex-shrink-0 text-slate-300 transition-all duration-200 group-hover:text-slate-500 group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
