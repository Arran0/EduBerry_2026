'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { BarChart3 } from 'lucide-react'
import { fetchAnalyticsData, TaskAnalyticsSummary, TaskStatus } from '@/lib/tasks'
import { UserProfile } from '@/lib/supabase'
import TeamMemberSelector from './TeamMemberSelector'
import { TaskDeck, Panel, PanelHead, StatTile, Segmented } from './ui'

// Labels follow the status cycle people see on the calendar.
const LABELS: Record<TaskStatus, string> = {
  not_done: 'Not done',
  partial: 'Partial',
  done: 'Checking',
  checked: 'Completed',
  dismissed: 'Dismissed',
}

const STATUSES: TaskStatus[] = ['not_done', 'partial', 'done', 'checked']

const COLORS: Record<TaskStatus, string> = {
  not_done: '#E11D48',
  partial: '#EA580C',
  done: '#EAB308',
  checked: '#10B981',
  dismissed: '#94A3B8',
}

const EMPTY_SUMMARY: TaskAnalyticsSummary = {
  counts: { not_done: 0, partial: 0, done: 0, checked: 0, dismissed: 0 },
  total: 0,
  completionRate: 0,
  overdue: 0,
  bonusPoints: 0,
}

type Period = 'week' | 'month' | 'year'

interface TaskAnalyticsProps {
  userId: string
  viewingUserId?: string
  teamMembers?: UserProfile[]
  currentUserId?: string
  currentUserName?: string
  onViewingUserChange?: (userId: string) => void
}

/** A ring of stroke arcs: one per status, with the total in the middle. */
function StatusRing({ counts, total }: { counts: Record<TaskStatus, number>; total: number }) {
  const size = 132
  const stroke = 16
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0" role="img" aria-label={`${total} tasks`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEEAE1" strokeWidth={stroke} />
      {total > 0 && STATUSES.map(s => {
        const len = (counts[s] / total) * c
        if (len === 0) return null
        const el = (
          <circle
            key={s}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={COLORS[s]}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )
        offset += len
        return el
      })}
      <text x="50%" y="47%" textAnchor="middle" className="fill-slate-900" fontSize="26" fontWeight="700">{total}</text>
      <text x="50%" y="62%" textAnchor="middle" className="fill-slate-500" fontSize="11">tasks</text>
    </svg>
  )
}

export default function TaskAnalytics({ userId, viewingUserId, teamMembers, currentUserId, currentUserName, onViewingUserChange }: TaskAnalyticsProps) {
  const [period, setPeriod] = useState<Period>('month')
  const [summary, setSummary] = useState<TaskAnalyticsSummary>(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const targetUserId = viewingUserId || userId

  const loadData = useCallback(async () => {
    setLoading(true)
    setSummary(await fetchAnalyticsData(targetUserId, period))
    setLoading(false)
  }, [targetUserId, period])

  useEffect(() => { loadData() }, [loadData])

  const { counts, total } = summary
  const periodWord = period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'this year'

  return (
    <TaskDeck
      title="Analytics"
      icon={BarChart3}
      actions={
        <>
          {teamMembers && teamMembers.length > 0 && currentUserId && onViewingUserChange && (
            <TeamMemberSelector
              members={teamMembers}
              selectedUserId={viewingUserId || currentUserId}
              currentUserId={currentUserId}
              currentUserName={currentUserName || ''}
              onSelect={onViewingUserChange}
            />
          )}
          <Segmented
            value={period}
            onChange={setPeriod}
            options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]}
            className="!w-auto bg-white/70"
          />
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-2.5 sm:gap-3">
        <div className="grid grid-cols-2 gap-2 sm:gap-2.5 order-1 lg:order-2 content-start">
          <StatTile label="Tasks" value={String(total)} sub={periodWord} shade={0} loading={loading} />
          <StatTile label="Completed" value={`${summary.completionRate}%`} sub={`${counts.checked} of ${total}`} loading={loading} />
          <StatTile label="Overdue" value={String(summary.overdue)} sub="past their date, not done" loading={loading} />
          <StatTile label="Bonus points" value={String(summary.bonusPoints)} sub="signed off" loading={loading} />
        </div>

        <Panel className="order-2 lg:order-1">
          <PanelHead title="By status" />
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 px-4 py-4">
            {loading ? (
              <div className="w-[132px] h-[132px] rounded-full border-[16px] border-[#EEEAE1] animate-pulse flex-shrink-0" />
            ) : (
              <StatusRing counts={counts} total={total} />
            )}
            <div className="w-full sm:flex-1 min-w-0 space-y-2.5">
              {STATUSES.map(s => {
                const value = counts[s]
                const pct = total > 0 ? Math.round((value / total) * 100) : 0
                return (
                  <div key={s} className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 translate-y-px" style={{ background: COLORS[s] }} />
                      <span className="text-[13px] text-slate-700 flex-1 min-w-0 leading-snug">{LABELS[s]}</span>
                      <span className="text-[13px] font-bold text-slate-900 tabular-nums">{loading ? '–' : value}</span>
                      <span className="w-9 text-right text-[11.5px] text-slate-400 tabular-nums">{loading ? '' : `${pct}%`}</span>
                    </div>
                    <div className="mt-1 ml-[18px] h-1 rounded-full bg-[#EEEAE1] overflow-hidden">
                      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: loading ? 0 : `${pct}%`, background: COLORS[s] }} />
                    </div>
                  </div>
                )
              })}
              {!loading && total === 0 && <p className="text-[12.5px] text-slate-500">No tasks {periodWord}.</p>}
            </div>
          </div>
        </Panel>
      </div>
    </TaskDeck>
  )
}
