'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileSpreadsheet, Clock, Trophy, ChevronRight } from 'lucide-react'
import { fetchExamsForStudent, type ExamStudentSummary } from '@/lib/exam'
import { SkeletonRows } from './HomeCardSkeletons'
import { useReportContent } from './useReportContent'

function examTime(e: ExamStudentSummary): number | null {
  const t = e.start_at ?? e.due_at
  return t ? new Date(t).getTime() : null
}

function formatWhen(ts: number): string {
  const d = new Date(ts)
  const now = Date.now()
  const diffH = (ts - now) / 3_600_000
  if (diffH >= 0 && diffH < 24) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface ExamsMiniCardProps {
  /** Reports, once loaded, whether the card has anything to show. */
  onContent?: (has: boolean) => void
  userId: string
}

/** Student exam snapshot: the next upcoming exam (highlighted if within ~10h)
 *  and the most recent released result. */
export default function ExamsMiniCard({ userId, onContent }: ExamsMiniCardProps) {
  const [upcoming, setUpcoming] = useState<ExamStudentSummary | null>(null)
  const [latestResult, setLatestResult] = useState<ExamStudentSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchExamsForStudent(userId)
      .then(({ active, closed }) => {
        if (cancelled) return
        const upcomingList = active
          .filter(e => examTime(e) !== null && (examTime(e) as number) >= Date.now())
          .sort((a, b) => (examTime(a) as number) - (examTime(b) as number))
        setUpcoming(upcomingList[0] ?? null)

        const published = closed
          .filter(e => e.canReview)
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        setLatestResult(published[0] ?? null)
      })
      .catch(err => {
        console.error('Failed to load exams for home card:', err)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])
  useReportContent(loading, !!(upcoming || latestResult), onContent)

  const upcomingTs = upcoming ? examTime(upcoming) : null
  const soon = upcomingTs !== null && (upcomingTs - Date.now()) < 10 * 3_600_000

  return (
    <div className="home-card glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-white/25 flex items-center gap-2">
        <FileSpreadsheet size={16} className="text-purple-500" />
        <span className="text-sm font-bold text-slate-700">Exams</span>
      </div>
      {loading ? (
        <SkeletonRows rows={4} />
      ) : !upcoming && !latestResult ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center mb-3">
            <FileSpreadsheet size={22} className="text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-400">No exams yet</p>
        </div>
      ) : (
        <div className="home-card-stack flex-1 overflow-y-auto scrollbar-hide p-4 space-y-3">
          {upcoming && (
            <Link href={`/more/exam/${upcoming.id}/take`}>
              <div className={`rounded-2xl border p-3.5 transition-colors cursor-pointer group ${soon ? 'bg-amber-50/80 border-amber-200' : 'bg-white/60 border-white/50 hover:bg-white/80'}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock size={12} className={soon ? 'text-amber-500' : 'text-slate-400'} />
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${soon ? 'text-amber-600' : 'text-slate-400'}`}>
                    {upcoming.start_at ? 'Starts' : 'Due'} {upcomingTs !== null ? formatWhen(upcomingTs) : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-slate-800 text-sm truncate">{upcoming.title}</h4>
                  <ChevronRight size={14} className="flex-shrink-0 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </div>
                {upcoming.subject && <p className="text-[11px] text-slate-400 truncate">{upcoming.subject}</p>}
              </div>
            </Link>
          )}
          {latestResult && (
            <Link href={`/more/exam/${latestResult.id}/review`}>
              <div className="rounded-2xl border border-white/50 bg-white/60 p-3.5 hover:bg-white/80 transition-colors cursor-pointer group">
                <div className="flex items-center gap-1.5 mb-1">
                  <Trophy size={12} className="text-emerald-500" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Latest result</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-slate-800 text-sm truncate">{latestResult.title}</h4>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {latestResult.submission?.total_score != null && (
                      <span className="text-sm font-black text-emerald-600 tabular-nums">
                        {latestResult.submission.total_score}
                        <span className="text-[11px] font-semibold text-slate-400">/{latestResult.submission.max_score ?? latestResult.total_marks}</span>
                      </span>
                    )}
                    <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
                  </div>
                </div>
              </div>
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
