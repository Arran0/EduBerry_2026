'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, BarChart3, XCircle, GitMerge, CheckCircle2, Clock } from 'lucide-react'
import { fetchAnalyticsData, TaskStatus } from '@/lib/tasks'
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

// Stat card config
const STATUS_CARDS: {
  status: TaskStatus
  gradient: string
  accent: string
  iconColor: string
  icon: React.ReactNode
}[] = [
  {
    status: 'not_done',
    gradient: 'from-red-50 to-rose-50',
    accent: 'bg-red-500',
    iconColor: 'bg-red-100 text-red-600',
    icon: <XCircle size={16} />,
  },
  {
    status: 'partial',
    gradient: 'from-orange-50 to-amber-50',
    accent: 'bg-orange-500',
    iconColor: 'bg-orange-100 text-orange-600',
    icon: <GitMerge size={16} />,
  },
  {
    status: 'done',
    gradient: 'from-yellow-50 to-amber-50',
    accent: 'bg-yellow-400',
    iconColor: 'bg-yellow-100 text-yellow-600',
    icon: <Clock size={16} />,
  },
  {
    status: 'checked',
    gradient: 'from-green-50 to-emerald-50',
    accent: 'bg-green-500',
    iconColor: 'bg-green-100 text-green-600',
    icon: <CheckCircle2 size={16} />,
  },
]

const STATUS_COLORS: Record<TaskStatus, string> = {
  not_done: '#ef4444',
  partial:  '#ea580c',
  done:     '#eab308',
  checked:  '#22c55e',
  dismissed: '#94a3b8',
}

const STATUS_TEXT_COLORS: Record<TaskStatus, string> = {
  not_done: 'text-red-600',
  partial:  'text-orange-600',
  done:     'text-yellow-600',
  checked:  'text-green-600',
  dismissed: 'text-slate-400',
}

// Custom SVG Donut Chart
function DonutChart({ data }: { data: Record<TaskStatus, number> }) {
  const total = Object.values(data).reduce((sum, v) => sum + v, 0)
  const completionPct = total > 0 ? Math.round((data.checked / total) * 100) : 0

  if (total === 0) {
    return (
      <div className="flex items-center justify-center w-56 h-56 mx-auto">
        <div className="text-center">
          <div className="w-40 h-40 rounded-full border-4 border-dashed border-slate-200 flex items-center justify-center mx-auto">
            <p className="text-sm text-slate-400">No data</p>
          </div>
        </div>
      </div>
    )
  }

  const segments: { status: TaskStatus; pct: number; color: string; startAngle: number; endAngle: number }[] = []
  let currentAngle = -90

  const statuses: TaskStatus[] = ['not_done', 'partial', 'done', 'checked']
  statuses.forEach(status => {
    const value = data[status]
    if (value === 0) return
    const pct = value / total
    const angle = pct * 360
    segments.push({
      status,
      pct,
      color: STATUS_COLORS[status],
      startAngle: currentAngle,
      endAngle: currentAngle + angle,
    })
    currentAngle += angle
  })

  const r = 80
  const cx = 100
  const cy = 100

  function polarToCartesian(angle: number) {
    const rad = (angle * Math.PI) / 180
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    }
  }

  return (
    <div className="flex flex-col items-center">
      {/* SVG with drop shadow filter */}
      <svg width="200" height="200" viewBox="0 0 200 200" style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.10))' }}>
        <defs>
          <filter id="donut-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#00000018" />
          </filter>
        </defs>
        <g filter="url(#donut-shadow)">
          {segments.map((seg, i) => {
            if (segments.length === 1) {
              return (
                <circle key={i} cx={cx} cy={cy} r={r} fill={seg.color} />
              )
            }
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
        </g>
        {/* Center white donut hole */}
        <circle cx={cx} cy={cy} r={52} fill="white" />
        {/* Center text: count */}
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="26" fontWeight="bold" fill="#1e293b">
          {total}
        </text>
        {/* Completion % */}
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="13" fontWeight="600" fill="#22c55e">
          {completionPct}% Done
        </text>
      </svg>

      {/* Legend with colored bars */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 mt-4 w-full max-w-xs">
        {statuses.map(status => {
          const pct = total > 0 ? Math.round((data[status] / total) * 100) : 0
          return (
            <div key={status} className="flex items-center gap-2">
              <div className="w-4 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[status] }} />
              <span className="text-xs text-slate-600 leading-none">
                {ANALYTICS_LABELS[status]}
                <span className={`ml-1 font-semibold ${STATUS_TEXT_COLORS[status]}`}>
                  {data[status]}
                </span>
                <span className="ml-1 text-slate-400">({pct}%)</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function TaskAnalytics({
  userId, viewingUserId,
  teamMembers, currentUserId, currentUserName,
  onViewingUserChange, onNewTask,
}: TaskAnalyticsProps) {
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month')
  const [data, setData] = useState<Record<TaskStatus, number>>({ not_done: 0, partial: 0, done: 0, checked: 0, dismissed: 0 })
  const [loading, setLoading] = useState(true)

  const targetUserId = viewingUserId || userId

  const loadData = useCallback(async () => {
    setLoading(true)
    const result = await fetchAnalyticsData(targetUserId, period)
    setData(result)
    setLoading(false)
  }, [targetUserId, period])

  useEffect(() => { loadData() }, [loadData])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-slate-800 flex items-center gap-2">
          <BarChart3 size={20} className="text-slate-500" />
          Analytics
        </h2>
        <div className="flex items-center gap-2 flex-shrink-0">
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
                className="sm:hidden flex items-center justify-center w-9 h-9 rounded-full text-white shadow-lg flex-shrink-0 active:scale-95 transition-transform"
                style={{ background: 'linear-gradient(135deg, var(--page-gradient-from, #3B82F6), var(--page-gradient-to, #2563EB))' }}
                title="New Task"
              >
                <Plus size={18} />
              </button>
            </>
          )}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="glass rounded-2xl p-5"
      >
        {/* Period filter — prominent pill strip at top */}
        <div className="flex items-center justify-center mb-6">
          <div className="inline-flex gap-1 bg-slate-100 rounded-2xl p-1 shadow-inner w-full sm:w-auto">
            {(['week', 'month', 'year'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  period === p
                    ? 'bg-white text-mps-blue-600 shadow-md ring-1 ring-slate-200/60'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                }`}
              >
                {p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'Year'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="spinner mx-auto mb-3" />
            <p className="text-sm text-slate-500">Loading analytics...</p>
          </div>
        ) : (
          <>
            <DonutChart data={data} />

            {/* Stats Cards — 2×2 grid */}
            <div className="grid grid-cols-2 gap-3 mt-6">
              {STATUS_CARDS.map(({ status, gradient, accent, iconColor, icon }) => (
                <div
                  key={status}
                  className={`bg-gradient-to-br ${gradient} rounded-2xl pt-4 px-4 pb-0 border border-white/70 shadow-sm overflow-hidden`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconColor}`}>
                      {icon}
                    </div>
                  </div>
                  <p className={`text-3xl font-bold leading-none mb-1 ${STATUS_TEXT_COLORS[status]}`}>
                    {data[status]}
                  </p>
                  <p className="text-xs font-medium text-slate-500 mb-3">
                    {ANALYTICS_LABELS[status]}
                  </p>
                  {/* Bottom accent bar in status color */}
                  <div className={`h-1 w-full ${accent} opacity-70`} />
                </div>
              ))}
            </div>
          </>
        )}
      </motion.div>
    </div>
  )
}
