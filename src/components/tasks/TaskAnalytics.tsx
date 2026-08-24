'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, BarChart3, ListChecks, TrendingUp, AlertTriangle, Star } from 'lucide-react'
import { fetchAnalyticsData, TaskAnalyticsSummary, TaskStatus } from '@/lib/tasks'
import { UserProfile } from '@/lib/supabase'
import TeamMemberSelector from './TeamMemberSelector'

// Display labels aligned with the status cycle UX
const ANALYTICS_LABELS: Record<TaskStatus, string> = {
  not_done: 'Not Done',
  partial:  'Partial',
  done:     'Checking',   // done but require_check=true — awaiting supervisor
  checked:  'Completed',  // done (no check needed) or supervisor-verified
  dismissed: 'Dismissed', // excluded from analytics — never displayed
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

const STATUSES: TaskStatus[] = ['not_done', 'partial', 'done', 'checked']

const STATUS_COLORS: Record<TaskStatus, string> = {
  not_done: '#ef4444',
  partial:  '#ea580c',
  done:     '#eab308',
  checked:  '#22c55e',
  dismissed: '#94a3b8',
}

const STATUS_DOT: Record<TaskStatus, string> = {
  not_done: 'bg-red-500',
  partial:  'bg-orange-500',
  done:     'bg-yellow-400',
  checked:  'bg-green-500',
  dismissed: 'bg-slate-400',
}

const STATUS_TEXT_COLORS: Record<TaskStatus, string> = {
  not_done: 'text-red-600',
  partial:  'text-orange-600',
  done:     'text-yellow-600',
  checked:  'text-green-600',
  dismissed: 'text-slate-400',
}

const EMPTY_SUMMARY: TaskAnalyticsSummary = {
  counts: { not_done: 0, partial: 0, done: 0, checked: 0, dismissed: 0 },
  total: 0,
  completionRate: 0,
  overdue: 0,
  bonusPoints: 0,
}

// Medium-large SVG donut with its own legend alongside it.
const DONUT_SIZE = 152

function DonutChart({ counts }: { counts: Record<TaskStatus, number> }) {
  const total = Object.values(counts).reduce((sum, v) => sum + v, 0)
  const completionPct = total > 0 ? Math.round((counts.checked / total) * 100) : 0
  const r = DONUT_SIZE / 2 - 14
  const cx = DONUT_SIZE / 2
  const cy = DONUT_SIZE / 2

  if (total === 0) {
    return (
      <div className="flex items-center justify-center flex-shrink-0" style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
        <div className="w-24 h-24 rounded-full border-4 border-dashed border-slate-200 flex items-center justify-center">
          <p className="text-xs text-slate-400">No data</p>
        </div>
      </div>
    )
  }

  const segments: { color: string; startAngle: number; endAngle: number }[] = []
  let currentAngle = -90
  STATUSES.forEach(status => {
    const value = counts[status]
    if (value === 0) return
    const angle = (value / total) * 360
    segments.push({ color: STATUS_COLORS[status], startAngle: currentAngle, endAngle: currentAngle + angle })
    currentAngle += angle
  })

  const polarToCartesian = (angle: number) => {
    const rad = (angle * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }

  return (
    <svg width={DONUT_SIZE} height={DONUT_SIZE} viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="flex-shrink-0" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.08))' }}>
      {segments.map((seg, i) => {
        if (segments.length === 1) return <circle key={i} cx={cx} cy={cy} r={r} fill={seg.color} />
        const start = polarToCartesian(seg.startAngle)
        const end = polarToCartesian(seg.endAngle)
        const largeArc = seg.endAngle - seg.startAngle > 180 ? 1 : 0
        return (
          <path
            key={i}
            d={`M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`}
            fill={seg.color}
            stroke="white"
            strokeWidth="2.5"
          />
        )
      })}
      <circle cx={cx} cy={cy} r={r - 24} fill="white" />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="24" fontWeight="bold" fill="#1e293b">{total}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize="11" fontWeight="600" fill="#22c55e">{completionPct}% done</text>
    </svg>
  )
}

export default function TaskAnalytics({
  userId, viewingUserId,
  teamMembers, currentUserId, currentUserName,
  onViewingUserChange, onNewTask,
}: TaskAnalyticsProps) {
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month')
  const [summary, setSummary] = useState<TaskAnalyticsSummary>(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)

  const targetUserId = viewingUserId || userId

  const loadData = useCallback(async () => {
    setLoading(true)
    const result = await fetchAnalyticsData(targetUserId, period)
    setSummary(result)
    setLoading(false)
  }, [targetUserId, period])

  useEffect(() => { loadData() }, [loadData])

  const { counts } = summary

  const headline: { icon: React.ReactNode; label: string; value: string | number; accent: string }[] = [
    { icon: <ListChecks size={18} />,    label: 'Total Tasks',     value: summary.total,               accent: 'text-slate-700' },
    { icon: <TrendingUp size={18} />,    label: 'Completion Rate', value: `${summary.completionRate}%`, accent: 'text-green-600' },
    { icon: <AlertTriangle size={18} />, label: 'Overdue',         value: summary.overdue,              accent: 'text-red-600'   },
    { icon: <Star size={18} />,          label: 'Bonus Points',    value: summary.bonusPoints,          accent: 'text-amber-600' },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm sm:text-xl font-bold text-slate-800 flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
          <BarChart3 size={18} className="text-slate-500 flex-shrink-0" />
          <span className="truncate">Analytics</span>
        </h2>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {teamMembers && teamMembers.length > 0 && currentUserId && onViewingUserChange && (
            <TeamMemberSelector
              members={teamMembers}
              selectedUserId={viewingUserId || currentUserId}
              currentUserId={currentUserId}
              currentUserName={currentUserName || ''}
              onSelect={onViewingUserChange}
            />
          )}
          {onNewTask && (
            <>
              <button onClick={onNewTask} className="btn-primary hidden sm:flex items-center gap-2 text-sm !py-1.5">
                <Plus size={16} /> New Task
              </button>
              <button
                onClick={onNewTask}
                className="sm:hidden flex items-center justify-center w-7 h-7 rounded-full text-white shadow-lg flex-shrink-0 active:scale-95 transition-transform"
                style={{ background: 'linear-gradient(135deg, var(--page-gradient-from, #3B82F6), var(--page-gradient-to, #2563EB))' }}
                title="New Task"
              >
                <Plus size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="border-t border-slate-100 pt-4"
      >
        {/* Period filter */}
        <div className="flex items-center justify-center mb-5">
          <div className="inline-flex gap-1 bg-slate-100 rounded-xl p-1 w-full sm:w-auto">
            {(['week', 'month', 'year'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
                  period === p
                    ? 'bg-white text-mps-blue-600 shadow-sm ring-1 ring-slate-200/60'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'Year'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <div className="spinner mx-auto mb-3" />
            <p className="text-sm text-slate-500">Loading analytics...</p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Donut + legend */}
            <div className="flex flex-col sm:flex-row items-center gap-6 bg-white -mx-4 sm:mx-0 border-y border-slate-200 sm:border sm:rounded-xl sm:shadow-sm p-5">
              <DonutChart counts={counts} />
              <div className="w-full sm:flex-1 space-y-2.5">
                {STATUSES.map(status => {
                  const value = counts[status]
                  const pct = summary.total > 0 ? Math.round((value / summary.total) * 100) : 0
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_DOT[status]}`} />
                      <span className="text-sm text-slate-600 flex-1">{ANALYTICS_LABELS[status]}</span>
                      <div className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden hidden sm:block">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[status] }} />
                      </div>
                      <span className="text-xs text-slate-400 w-8 text-right flex-shrink-0">{pct}%</span>
                      <span className={`font-bold text-base w-8 text-right flex-shrink-0 ${STATUS_TEXT_COLORS[status]}`}>
                        {value}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Headline metrics — richer, more spacious stat row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 bg-white -mx-4 sm:mx-0 border-y border-slate-200 sm:border sm:rounded-xl sm:shadow-sm divide-x divide-y sm:divide-y-0 divide-slate-100">
              {headline.map(({ icon, label, value, accent }) => (
                <div key={label} className="p-5">
                  <div className={`mb-2.5 ${accent}`}>{icon}</div>
                  <p className={`text-2xl font-bold leading-none mb-1.5 ${accent}`}>{value}</p>
                  <p className="text-xs font-medium text-slate-500">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}
