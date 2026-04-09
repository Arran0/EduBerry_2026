'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Trophy, TrendingUp, AlertTriangle, BarChart3, Download, Star, CheckCircle2 } from 'lucide-react'
import { fetchTeamAnalytics } from '@/lib/tasks'
import { UserProfile, UserRole } from '@/lib/supabase'
import Avatar from '@/components/Avatar'

interface TeamAnalyticsProps {
  userId: string
  userRole: UserRole
  isTeacher?: boolean
}

interface MemberStats {
  user: UserProfile
  stats: {
    completed: number
    bonus: number
    overdue: number
    total: number
    completionRate: number
  }
}

// Left-border accent colors for top 3
const TOP3_BORDER = [
  'border-l-4 border-l-amber-400',
  'border-l-4 border-l-slate-400',
  'border-l-4 border-l-orange-400',
]

// Subtle gradient backgrounds for top 3
const TOP3_BG = [
  'bg-gradient-to-r from-amber-50/80 to-yellow-50/40 border-amber-200',
  'bg-gradient-to-r from-slate-50/80 to-slate-50/40 border-slate-200',
  'bg-gradient-to-r from-orange-50/80 to-amber-50/40 border-orange-200',
]

export default function TeamAnalytics({ userId, userRole, isTeacher = false }: TeamAnalyticsProps) {
  const [members, setMembers] = useState<MemberStats[]>([])
  const [loading, setLoading] = useState(true)
  const [leaderboardBasis, setLeaderboardBasis] = useState<'completed' | 'bonus'>('completed')

  const [teamCompletionRate, setTeamCompletionRate] = useState(0)

  const loadData = useCallback(async () => {
    setLoading(true)
    const data = await fetchTeamAnalytics(userId, userRole)
    setMembers(data.members)
    setTeamCompletionRate(data.teamCompletionRate)
    setLoading(false)
  }, [userId, userRole])

  useEffect(() => { loadData() }, [loadData])

  // Leaderboard sorting
  const leaderboard = [...members]
    .sort((a, b) => {
      if (leaderboardBasis === 'completed') return b.stats.completed - a.stats.completed
      return b.stats.bonus - a.stats.bonus
    })
    .slice(0, (userRole === 'principal' || userRole === 'admin') ? 10 : members.length)

  // Aggregate stats
  const totalCompleted = members.reduce((s, m) => s + m.stats.completed, 0)
  const totalBonus = members.reduce((s, m) => s + m.stats.bonus, 0)
  const totalTasks = members.reduce((s, m) => s + m.stats.total, 0)
  const totalOverdue = members.reduce((s, m) => s + m.stats.overdue, 0)
  // Use team-wide completion rate (all checked / all total)

  const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const handleExportCSV = () => {
    const headers = ['Name', 'Role', 'Total', 'Completed', 'Bonus', 'Overdue', 'Rate']
    const rows = members.map(m => [
      m.user.full_name,
      m.user.role,
      m.stats.total,
      m.stats.completed,
      m.stats.bonus,
      m.stats.overdue,
      `${m.stats.completionRate}%`,
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `team-statistics-${currentMonth.replace(' ', '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
        {isTeacher ? 'My Team · ' : ''}Monthly report · {currentMonth}
      </p>

      {loading ? (
        <div className="text-center py-16">
          <div className="spinner mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading team analytics...</p>
        </div>
      ) : (
        <>
          {/* Leaderboard */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Trophy size={18} className="text-amber-500" />
                <h3 className="font-semibold text-slate-700">
                  Leaderboard
                  {(userRole === 'principal' || userRole === 'admin') ? ' (Top 10)' : isTeacher ? ' (My Team)' : ''}
                </h3>
              </div>

              {/* Pill toggle: Tasks / Bonus Points */}
              <div className="inline-flex gap-0.5 bg-slate-100 rounded-xl p-1">
                <button
                  onClick={() => setLeaderboardBasis('completed')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    leaderboardBasis === 'completed'
                      ? 'bg-white text-mps-blue-600 shadow-sm ring-1 ring-slate-200/60'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <CheckCircle2 size={12} />
                  Tasks
                </button>
                <button
                  onClick={() => setLeaderboardBasis('bonus')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    leaderboardBasis === 'bonus'
                      ? 'bg-white text-amber-600 shadow-sm ring-1 ring-slate-200/60'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Star size={12} />
                  Bonus Points
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {leaderboard.map((m, index) => {
                const maxScore = leaderboard[0]
                  ? (leaderboardBasis === 'completed' ? leaderboard[0].stats.completed : leaderboard[0].stats.bonus)
                  : 1
                const score = leaderboardBasis === 'completed' ? m.stats.completed : m.stats.bonus
                const barPct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0
                const isTop3 = index < 3

                return (
                  <motion.div
                    key={m.user.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors overflow-hidden ${
                      isTop3
                        ? `${TOP3_BG[index]} ${TOP3_BORDER[index]}`
                        : 'bg-white border-slate-100 hover:bg-slate-50'
                    }`}
                  >
                    {/* Rank medal */}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                      index === 0 ? 'bg-gradient-to-br from-amber-400 to-yellow-500 text-white shadow-sm' :
                      index === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow-sm' :
                      index === 2 ? 'bg-gradient-to-br from-orange-400 to-amber-500 text-white shadow-sm' :
                      'bg-slate-100 text-slate-500'
                    }`}>
                      {index + 1}
                    </div>

                    {/* Avatar */}
                    <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={28} userId={m.user.id} />

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 text-sm truncate">{m.user.full_name}</p>
                      <p className="text-[10px] text-slate-400">{m.user.role}</p>
                    </div>

                    {/* Mini completion bar + score */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="hidden sm:flex flex-col items-end gap-1">
                        <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              index === 0 ? 'bg-gradient-to-r from-amber-400 to-yellow-400' :
                              index === 1 ? 'bg-gradient-to-r from-slate-400 to-slate-300' :
                              index === 2 ? 'bg-gradient-to-r from-orange-400 to-amber-400' :
                              'bg-gradient-to-r from-mps-blue-400 to-mps-blue-500'
                            }`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      </div>
                      <div className={`text-right ${isTop3 ? 'font-bold text-base' : 'font-semibold text-sm'} ${
                        index === 0 ? 'text-amber-600' :
                        index === 1 ? 'text-slate-500' :
                        index === 2 ? 'text-orange-500' :
                        'text-slate-600'
                      }`}>
                        {score}
                      </div>
                    </div>
                  </motion.div>
                )
              })}

              {leaderboard.length === 0 && (
                <div className="text-center py-8">
                  <Trophy size={32} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No team data available yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Member Stats — full table on sm+, compact cards on mobile */}
          <div className="glass rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center gap-2">
              <BarChart3 size={16} className="text-mps-blue-600" />
              <h3 className="font-semibold text-slate-700">Member Statistics</h3>
              <span className="text-xs text-slate-400">({members.length} members)</span>
              <div className="flex-1" />
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-mps-blue-600 bg-slate-100 hover:bg-mps-blue-50 rounded-lg transition-colors"
                title="Export as CSV"
              >
                <Download size={12} /> Export
              </button>
            </div>

            {/* Mobile: compact member cards (hidden on sm+) */}
            <div className="sm:hidden divide-y divide-slate-50">
              {members.map(m => (
                <div key={m.user.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={32} userId={m.user.id} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{m.user.full_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-mps-blue-500 to-slate-400 rounded-full"
                          style={{ width: `${m.stats.completionRate}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-mps-blue-600 flex-shrink-0">
                        {m.stats.completionRate}%
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-green-600">{m.stats.completed}</p>
                    <p className="text-[10px] text-slate-400">done</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: full table (hidden on mobile) */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left p-3 text-slate-500 font-medium">Name</th>
                    <th className="text-center p-3 text-slate-500 font-medium">Total</th>
                    <th className="text-center p-3 text-slate-500 font-medium">Completed</th>
                    <th className="text-center p-3 text-slate-500 font-medium">Bonus</th>
                    <th className="text-center p-3 text-slate-500 font-medium">Overdue</th>
                    <th className="text-center p-3 text-slate-500 font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.user.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={28} userId={m.user.id} />
                          <div>
                            <p className="font-medium text-slate-800">{m.user.full_name}</p>
                            <p className="text-xs text-slate-400">{m.user.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-center p-3 text-slate-600">{m.stats.total}</td>
                      <td className="text-center p-3">
                        <span className="text-green-600 font-medium">{m.stats.completed}</span>
                      </td>
                      <td className="text-center p-3">
                        <span className="text-amber-600 font-medium">{m.stats.bonus}</span>
                      </td>
                      <td className="text-center p-3">
                        <span className={`font-medium ${m.stats.overdue > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                          {m.stats.overdue}
                        </span>
                      </td>
                      <td className="text-center p-3">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-mps-blue-500 to-slate-400 rounded-full"
                              style={{ width: `${m.stats.completionRate}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-slate-600">{m.stats.completionRate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary Stats — 4-card 2x2 grid */}
          <div className="grid grid-cols-2 gap-3">
            {([
              {
                icon: <TrendingUp size={15} className="text-white" />,
                gradient: 'from-green-400 to-emerald-500',
                value: `${teamCompletionRate}%`,
                label: 'Completion Rate',
              },
              {
                icon: <AlertTriangle size={15} className="text-white" />,
                gradient: 'from-red-400 to-rose-500',
                value: totalOverdue,
                label: 'Cumulative Overdue',
              },
              {
                icon: <CheckCircle2 size={15} className="text-white" />,
                gradient: 'from-mps-blue-400 to-mps-blue-600',
                value: totalTasks,
                label: 'Total Tasks',
              },
              {
                icon: <Star size={15} className="text-white" />,
                gradient: 'from-amber-400 to-yellow-500',
                value: totalBonus,
                label: 'Total Bonus',
              },
            ] as const).map((stat, i) => (
              <div key={i} className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${stat.gradient} flex items-center justify-center mb-2.5`}>
                  {stat.icon}
                </div>
                <p className="text-xl font-bold text-slate-800 leading-none mb-1">{stat.value}</p>
                <p className="text-xs text-slate-400">{stat.label}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
