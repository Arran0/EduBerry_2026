'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, BarChart3 } from 'lucide-react'
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

// Stat cell config — small colored dot + count, in display order
const STATUS_CARDS: { status: TaskStatus; dot: string }[] = [
  { status: 'not_done', dot: 'bg-red-500' },
  { status: 'partial',  dot: 'bg-orange-500' },
  { status: 'done',     dot: 'bg-yellow-400' },
  { status: 'checked',  dot: 'bg-green-500' },
]

const STATUSES: TaskStatus[] = ['not_done', 'partial', 'done', 'checked']

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

// Medium-sized SVG donut — a real chart, but sized and stripped of its old
// legend so it pairs with the dense stat row instead of dominating the page.
const DONUT_SIZE = 120

function DonutChart({ data }: { data: Record<TaskStatus, number> }) {
  const total = Object.values(data).reduce((sum, v) => sum + v, 0)
  const completionPct = total > 0 ? Math.round((data.checked / total) * 100) : 0
  const r = DONUT_SIZE / 2 - 12
  const cx = DONUT_SIZE / 2
  const cy = DONUT_SIZE / 2

  if (total === 0) {
    return (
      <div className="flex items-center justify-center flex-shrink-0" style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
        <div className="w-20 h-20 rounded-full border-4 border-dashed border-slate-200 flex items-center justify-center">
          <p className="text-[10px] text-slate-400">No data</p>
        </div>
      </div>
    )
  }

  const segments: { color: string; startAngle: number; endAngle: number }[] = []
  let currentAngle = -90
  STATUSES.forEach(status => {
    const value = data[status]
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
    <svg width={DONUT_SIZE} height={DONUT_SIZE} viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="flex-shrink-0">
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
            strokeWidth="2"
          />
        )
      })}
      <circle cx={cx} cy={cy} r={r - 18} fill="white" />
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize="18" fontWeight="bold" fill="#1e293b">{total}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fontWeight="600" fill="#22c55e">{completionPct}% done</text>
    </svg>
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
        className="border-t border-slate-100 pt-3"
      >
        {/* Period filter — compact segmented control */}
        <div className="flex items-center justify-center mb-3">
          <div className="inline-flex gap-0.5 bg-slate-100 rounded-lg p-0.5 w-full sm:w-auto">
            {(['week', 'month', 'year'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`flex-1 sm:flex-none px-4 py-1 rounded-md text-xs font-semibold transition-all ${
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
          <div className="text-center py-6">
            <div className="spinner mx-auto mb-2" />
            <p className="text-xs text-slate-500">Loading analytics...</p>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center sm:items-stretch gap-4">
            <div className="flex justify-center">
              <DonutChart data={data} />
            </div>

            {/* Stats — dense 2×2 grid alongside the donut */}
            <div className="grid grid-cols-2 flex-1 bg-white -mx-4 sm:mx-0 border-y border-slate-200 sm:border sm:rounded-xl sm:shadow-sm divide-x divide-y divide-slate-100">
              {STATUS_CARDS.map(({ status, dot }) => (
                <div key={status} className="p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                    <span className="text-[11px] font-medium text-slate-500 truncate">{ANALYTICS_LABELS[status]}</span>
                  </div>
                  <p className={`text-xl font-bold leading-none ${STATUS_TEXT_COLORS[status]}`}>
                    {data[status]}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}
