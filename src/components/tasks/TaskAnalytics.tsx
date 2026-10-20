'use client'

import React, { useState, useEffect } from 'react'
import { BarChart3 } from 'lucide-react'
import { fetchAnalyticsData, TaskAnalyticsSummary, TaskStatus } from '@/lib/tasks'
import { UserProfile } from '@/lib/supabase'
import TeamMemberSelector from './TeamMemberSelector'
import { IconChip, Seg } from './ui'

type Period = 'week' | 'month' | 'year'
const PERIODS: Period[] = ['week', 'month', 'year']
const PERIOD_LABEL: Record<Period, string> = { week: 'Last 7 days', month: 'Last 30 days', year: 'Last 12 months' }
const PERIOD_SHORT: Record<Period, string> = { week: 'Week', month: 'Month', year: 'Year' }

// Labels follow the status cycle on the calendar.
const LABELS: Record<TaskStatus, string> = {
  not_done: 'Not done',
  partial: 'Partial',
  done: 'Checking',
  checked: 'Completed',
  dismissed: 'Dismissed',
}
const STATUSES: TaskStatus[] = ['checked', 'done', 'partial', 'not_done']
const COLORS: Record<TaskStatus, string> = {
  not_done: '#f87171',
  partial: '#fb923c',
  done: '#facc15',
  checked: '#34d399',
  dismissed: '#cbd5e1',
}

interface TaskAnalyticsProps {
  userId: string
  viewingUserId?: string
  teamMembers?: UserProfile[]
  currentUserId?: string
  currentUserName?: string
  onViewingUserChange?: (userId: string) => void
  onNewTask?: () => void
}

/** The completion ring: completed as an arc over the period's total. */
function CompletionRing({ pct, size = 148 }: { pct: number; size?: number }) {
  const stroke = 14
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0" role="img" aria-label={`${pct}% completed`}>
      <defs>
        <linearGradient id="tk-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(146,64,14,0.08)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#tk-ring)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.22} fontWeight={700} fill="#1e293b">{pct}%</text>
      <text x="50%" y="66%" textAnchor="middle" fontSize={11} fill="#92400e" opacity={0.75}>completed</text>
    </svg>
  )
}

/** One stacked bar of the four statuses. */
function StatusBar({ counts, total, height = 10 }: { counts: Record<TaskStatus, number>; total: number; height?: number }) {
  return (
    <div className="flex w-full overflow-hidden rounded-full bg-amber-900/[0.07]" style={{ height }}>
      {total > 0 && STATUSES.map(s => counts[s] > 0 && (
        <span key={s} title={`${LABELS[s]}: ${counts[s]}`} style={{ width: `${(counts[s] / total) * 100}%`, background: COLORS[s] }} className="h-full first:rounded-l-full last:rounded-r-full" />
      ))}
    </div>
  )
}

export default function TaskAnalytics({ userId, viewingUserId, teamMembers, currentUserId, currentUserName, onViewingUserChange }: TaskAnalyticsProps) {
  const [period, setPeriod] = useState<Period>('month')
  const [data, setData] = useState<Partial<Record<Period, TaskAnalyticsSummary>>>({})
  const targetUserId = viewingUserId || userId

  // A different person starts with nothing loaded.
  useEffect(() => { setData({}) }, [targetUserId])

  // Each period is fetched the first time it's shown and kept, so switching
  // back to one already seen is instant.
  useEffect(() => {
    if (data[period]) return
    let cancelled = false
    fetchAnalyticsData(targetUserId, period).then(summary => {
      if (!cancelled) setData(prev => ({ ...prev, [period]: summary }))
    })
    return () => { cancelled = true }
  }, [targetUserId, period, data])

  const summary = data[period]
  const loading = !summary
  const counts = summary?.counts ?? { not_done: 0, partial: 0, done: 0, checked: 0, dismissed: 0 }
  const total = summary?.total ?? 0
  const pct = summary?.completionRate ?? 0
  const share = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-[17px] sm:text-xl font-bold text-slate-800 flex items-center gap-2.5 mr-auto">
          <IconChip icon={BarChart3} />
          Analytics
        </h2>
        {teamMembers && teamMembers.length > 0 && currentUserId && onViewingUserChange && (
          <TeamMemberSelector
            members={teamMembers}
            selectedUserId={viewingUserId || currentUserId}
            currentUserId={currentUserId}
            currentUserName={currentUserName || ''}
            onSelect={onViewingUserChange}
          />
        )}
        <Seg value={period} onChange={setPeriod} options={PERIODS.map(p => ({ value: p, label: PERIOD_SHORT[p] }))} className="bg-white/70" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Completion */}
        <section className="tk-card lg:col-span-4 p-4 flex flex-row lg:flex-col items-center gap-4 lg:gap-3">
          {loading ? (
            <div className="w-[148px] h-[148px] rounded-full border-[14px] border-amber-900/[0.06] animate-pulse flex-shrink-0" />
          ) : (
            <CompletionRing pct={pct} />
          )}
          <div className="min-w-0 lg:text-center">
            <p className="text-[12px] font-semibold text-amber-800/80">{PERIOD_LABEL[period]}</p>
            <p className="text-[13.5px] text-slate-700 mt-0.5 leading-snug">
              {loading ? 'Loading…' : total === 0 ? 'No tasks in this period.' : <><span className="font-bold text-slate-800 tabular-nums">{counts.checked}</span> of <span className="font-bold text-slate-800 tabular-nums">{total}</span> tasks completed</>}
            </p>
            {summary && total > 0 && (
              <p className="mt-1.5 flex flex-wrap lg:justify-center gap-x-3 gap-y-0.5 text-[12px] text-slate-500">
                <span><span className={`font-bold tabular-nums ${summary.overdue > 0 ? 'text-red-500' : 'text-slate-700'}`}>{summary.overdue}</span> overdue</span>
                <span><span className="font-bold tabular-nums text-amber-600">{summary.bonusPoints}</span> bonus points</span>
              </p>
            )}
          </div>
        </section>

        {/* Breakdown */}
        <section className="tk-card lg:col-span-8 overflow-hidden">
          <div className="tk-card-head px-4 py-2.5 flex items-center justify-between gap-2">
            <h3 className="text-[13.5px] font-semibold text-slate-800">By status</h3>
            <span className="text-[12px] text-slate-500 tabular-nums">{total} total</span>
          </div>
          <div className="p-4 space-y-3">
            <StatusBar counts={counts} total={total} height={12} />
            <div className="space-y-2">
              {STATUSES.map(s => (
                <div key={s} className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[s] }} />
                  <span className="text-[13px] text-slate-700 w-24 flex-shrink-0">{LABELS[s]}</span>
                  <span className="flex-1 h-1.5 rounded-full bg-amber-900/[0.06] overflow-hidden min-w-0">
                    <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${share(counts[s])}%`, background: COLORS[s] }} />
                  </span>
                  <span className="w-8 text-right text-[13px] font-bold text-slate-800 tabular-nums">{loading ? '–' : counts[s]}</span>
                  <span className="w-9 text-right text-[11.5px] text-slate-400 tabular-nums">{loading ? '' : `${share(counts[s])}%`}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
