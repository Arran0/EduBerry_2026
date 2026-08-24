'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, TrendingUp, AlertTriangle, BarChart3, Download, Star, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Search, Users, Crown } from 'lucide-react'
import { fetchTeamAnalytics } from '@/lib/tasks'
import { fetchAllTeams, TeamWithDetails } from '@/lib/teams'
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

// Gold / Silver / Bronze — deliberately distinct so #1, #2, #3 read at a glance.
const TOP3_BORDER = [
  'border-l-4 border-l-amber-400',
  'border-l-4 border-l-slate-400',
  'border-l-4 border-l-orange-600',
]

const TOP3_BG = [
  'bg-gradient-to-r from-amber-100/90 to-yellow-50/50 border-amber-300 shadow-sm shadow-amber-200/50',
  'bg-gradient-to-r from-slate-200/80 to-slate-50/50 border-slate-300',
  'bg-gradient-to-r from-orange-100/80 to-amber-50/40 border-orange-300',
]

const RANK_COLORS = [
  'bg-gradient-to-br from-amber-400 to-yellow-500 text-white shadow-md shadow-amber-300/60 ring-2 ring-amber-200',
  'bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-sm ring-2 ring-slate-200',
  'bg-gradient-to-br from-orange-500 to-amber-700 text-white shadow-sm ring-2 ring-orange-200',
]

const SCORE_TEXT = ['text-amber-600', 'text-slate-500', 'text-orange-600']
const BAR_GRADIENT = [
  'bg-gradient-to-r from-amber-400 to-yellow-400',
  'bg-gradient-to-r from-slate-400 to-slate-300',
  'bg-gradient-to-r from-orange-500 to-amber-500',
]

// Shared page size for the leaderboard's and member table's "Load more" paging
const RECORDS_PAGE_SIZE = 25

const isAdminOrPrincipal = (role: UserRole) => role === 'admin' || role === 'principal'

const toMonthParam = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// ── Module-level caches ──────────────────────────────────────────────────────
// The Team tab is conditionally rendered, so this component fully unmounts when
// the user switches tabs and remounts when they return — discarding any
// component-instance (useRef) cache and forcing a full refetch every visit.
// Hoisting the caches to module scope lets them survive remounts: re-entering
// the Team tab (or revisiting an already-loaded month) paints instantly.
type AnalyticsEntry = { members: MemberStats[]; teamCompletionRate: number }
const analyticsCache = new Map<string, AnalyticsEntry>()
const analyticsCacheKey = (userId: string, month: string) => `${userId}:${month}`

// Teams list rarely changes within a session; cache it module-wide too so the
// admin/principal selector doesn't refetch on every mount.
let teamsCache: TeamWithDetails[] | null = null

// Warm the current month into the cache ahead of mount (e.g. on tab hover) so
// the Team section can paint without a spinner when it's opened.
export async function prefetchTeamAnalytics(userId: string, userRole: UserRole) {
  const month = toMonthParam(new Date())
  const key = analyticsCacheKey(userId, month)
  if (analyticsCache.has(key)) return
  const data = await fetchTeamAnalytics(userId, userRole, month)
  // Only cache meaningful results — an empty payload is indistinguishable from
  // a fetch failure, and caching it would suppress the spinner on real load.
  if (data.members.length > 0) analyticsCache.set(key, data)
}

export default function TeamAnalytics({ userId, userRole, isTeacher = false }: TeamAnalyticsProps) {
  const [members, setMembers] = useState<MemberStats[]>([])
  const [loading, setLoading] = useState(true)
  const [leaderboardBasis, setLeaderboardBasis] = useState<'completed' | 'bonus'>('completed')
  const [teamCompletionRate, setTeamCompletionRate] = useState(0)

  // Month navigation
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const isCurrentMonth = (() => {
    const now = new Date()
    return selectedMonth.getFullYear() === now.getFullYear() && selectedMonth.getMonth() === now.getMonth()
  })()

  const goPrevMonth = () => setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const goNextMonth = () => setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))

  // Team selector (admin / principal only)
  const [teams, setTeams] = useState<TeamWithDetails[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [teamSearch, setTeamSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Member stats panel
  const [statsExpanded, setStatsExpanded] = useState(false)
  const [memberVisibleCount, setMemberVisibleCount] = useState(RECORDS_PAGE_SIZE)

  // Leaderboard paging — "Load more" reveals RECORDS_PAGE_SIZE more at a time
  const [leaderboardVisibleCount, setLeaderboardVisibleCount] = useState(RECORDS_PAGE_SIZE)
  useEffect(() => { setLeaderboardVisibleCount(RECORDS_PAGE_SIZE) }, [selectedTeamId, leaderboardBasis])

  // Cache (module-level, see top of file) is keyed by "userId:YYYY-MM". Past
  // months are immutable so we serve them instantly. The current month uses
  // stale-while-revalidate: show cached data immediately, refresh in background.
  const loadData = useCallback(async () => {
    const month = toMonthParam(selectedMonth)
    const cacheKey = analyticsCacheKey(userId, month)
    const now = new Date()
    const isCurrent =
      selectedMonth.getFullYear() === now.getFullYear() &&
      selectedMonth.getMonth() === now.getMonth()
    const cached = analyticsCache.get(cacheKey)

    if (cached) {
      setMembers(cached.members)
      setTeamCompletionRate(cached.teamCompletionRate)
      setLoading(false)
      // Past months never change — no background refresh needed.
      if (!isCurrent) return
    } else {
      setLoading(true)
    }

    const data = await fetchTeamAnalytics(userId, userRole, month)
    // Only cache a meaningful payload. An empty members array is indistinguishable
    // from a transient API failure, and caching it would otherwise pin the
    // leaderboard to "no data" until a hard reload.
    if (data.members.length > 0) analyticsCache.set(cacheKey, data)
    setMembers(data.members)
    setTeamCompletionRate(data.teamCompletionRate)
    setLoading(false)
  }, [userId, userRole, selectedMonth])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!isAdminOrPrincipal(userRole)) return
    if (teamsCache) {
      setTeams(teamsCache)
      return
    }
    fetchAllTeams().then(t => { teamsCache = t; setTeams(t) })
  }, [userRole])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filteredTeams = useMemo(
    () => teams.filter(t => t.name.toLowerCase().includes(teamSearch.toLowerCase())),
    [teams, teamSearch]
  )

  const selectedTeam = useMemo(
    () => teams.find(t => t.id === selectedTeamId) ?? null,
    [teams, selectedTeamId]
  )

  const selectedTeamMemberIds = useMemo((): Set<string> | null => {
    if (!selectedTeam) return null
    return new Set(selectedTeam.members.map(m => m.user_id))
  }, [selectedTeam])

  const leaderboard = useMemo(() => {
    let list = [...members]
    if (selectedTeamMemberIds) {
      list = list.filter(m => selectedTeamMemberIds.has(m.user.id))
    }
    list.sort((a, b) =>
      leaderboardBasis === 'completed'
        ? b.stats.completed - a.stats.completed
        : b.stats.bonus - a.stats.bonus
    )
    return list
  }, [members, leaderboardBasis, selectedTeamMemberIds])

  const visibleLeaderboard = leaderboard.slice(0, leaderboardVisibleCount)
  const visibleMembers = members.slice(0, memberVisibleCount)

  // Aggregate stats
  const totalCompleted = members.reduce((s, m) => s + m.stats.completed, 0)
  const totalBonus = members.reduce((s, m) => s + m.stats.bonus, 0)
  const totalTasks = members.reduce((s, m) => s + m.stats.total, 0)
  const totalOverdue = members.reduce((s, m) => s + m.stats.overdue, 0)

  const monthLabel = selectedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

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
    a.download = `team-statistics-${monthLabel.replace(' ', '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Leaderboard title label
  const leaderboardLabel = selectedTeam
    ? selectedTeam.name
    : isAdminOrPrincipal(userRole)
      ? 'All Staff'
      : isTeacher
        ? 'My Team'
        : 'Team'

  return (
    <div className="space-y-5">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
          {isTeacher ? 'My Team · ' : ''}Monthly report
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={goPrevMonth}
            className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-xs font-semibold text-slate-600 px-1.5 min-w-[110px] text-center">
            {monthLabel}
          </span>
          <button
            onClick={goNextMonth}
            disabled={isCurrentMonth}
            className={`p-1 rounded-lg transition-colors ${
              isCurrentMonth
                ? 'text-slate-200 cursor-not-allowed'
                : 'hover:bg-slate-100 text-slate-400'
            }`}
            aria-label="Next month"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-5 animate-pulse">
          {/* Leaderboard skeleton */}
          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-slate-200 rounded-md" />
                <div className="w-24 h-4 bg-slate-200 rounded-md" />
              </div>
              <div className="w-28 h-8 bg-slate-100 rounded-xl" />
            </div>
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-xl border border-slate-100">
                  <div className="w-7 h-7 rounded-full bg-slate-200 flex-shrink-0" />
                  <div className="w-7 h-7 rounded-full bg-slate-200 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="h-3.5 bg-slate-200 rounded-md mb-1.5" style={{ width: `${55 + (i * 17) % 35}%` }} />
                    <div className="h-2.5 bg-slate-100 rounded-md w-16" />
                  </div>
                  <div className="hidden sm:block w-20 h-2 bg-slate-100 rounded-full" />
                  <div className="w-8 h-5 bg-slate-200 rounded-md" />
                </div>
              ))}
            </div>
          </div>
          {/* Stats cards skeleton */}
          <div className="grid grid-cols-2 sm:grid-cols-4 bg-white -mx-4 sm:mx-0 border-y border-slate-200 sm:border sm:rounded-xl sm:shadow-sm divide-x divide-y sm:divide-y-0 divide-slate-100">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="p-4">
                <div className="w-9 h-9 rounded-xl bg-slate-200 mb-3" />
                <div className="h-7 bg-slate-200 rounded-md w-14 mb-1.5" />
                <div className="h-3 bg-slate-100 rounded-md w-28" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* ── Leaderboard ─────────────────────────────────────── */}
          <div className="border-t border-slate-100 pt-4">

            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Trophy size={18} className="text-amber-500 flex-shrink-0" />
                <h3 className="font-semibold text-slate-700 truncate">
                  Leaderboard
                </h3>
                <span className="text-xs text-slate-400 font-normal truncate hidden sm:inline">
                  · {leaderboardLabel}
                </span>
              </div>

              {/* Tasks / Bonus Points toggle */}
              <div className="inline-flex gap-0.5 bg-slate-100 rounded-xl p-1 flex-shrink-0">
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
                  Bonus
                </button>
              </div>
            </div>

            {/* Team selector — admin / principal only */}
            {isAdminOrPrincipal(userRole) && teams.length > 0 && (
              <div className="relative mb-4" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-sm"
                >
                  <Users size={14} className="text-slate-400 flex-shrink-0" />
                  <span className="flex-1 text-left font-medium text-slate-700 truncate">
                    {selectedTeam ? selectedTeam.name : 'All Teams'}
                  </span>
                  {selectedTeam && (
                    <span className="text-xs text-slate-400">
                      {selectedTeam.member_count} members
                    </span>
                  )}
                  <ChevronDown
                    size={14}
                    className={`text-slate-400 transition-transform flex-shrink-0 ${dropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                <AnimatePresence>
                  {dropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: 0.12 }}
                      className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden"
                    >
                      {/* Search */}
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
                        <Search size={13} className="text-slate-400 flex-shrink-0" />
                        <input
                          autoFocus
                          value={teamSearch}
                          onChange={e => setTeamSearch(e.target.value)}
                          placeholder="Search teams…"
                          className="flex-1 text-sm outline-none bg-transparent placeholder-slate-400"
                        />
                      </div>

                      {/* Options list */}
                      <div className="max-h-48 overflow-y-auto">
                        {/* All Teams option */}
                        <button
                          onClick={() => { setSelectedTeamId(null); setDropdownOpen(false); setTeamSearch('') }}
                          className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                            !selectedTeamId
                              ? 'bg-mps-blue-50 text-mps-blue-700 font-medium'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <Trophy size={13} className="text-amber-400 flex-shrink-0" />
                          All Teams
                          <span className="ml-auto text-xs text-slate-400">{members.length} staff</span>
                        </button>

                        {filteredTeams.map(t => (
                          <button
                            key={t.id}
                            onClick={() => { setSelectedTeamId(t.id); setDropdownOpen(false); setTeamSearch('') }}
                            className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                              selectedTeamId === t.id
                                ? 'bg-mps-blue-50 text-mps-blue-700 font-medium'
                                : 'text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <Users size={13} className="text-slate-400 flex-shrink-0" />
                            <span className="flex-1 truncate">{t.name}</span>
                            <span className="text-xs text-slate-400 flex-shrink-0">{t.member_count}</span>
                          </button>
                        ))}

                        {filteredTeams.length === 0 && (
                          <p className="text-xs text-slate-400 text-center py-4">No teams found</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Leaderboard list — unseparated, edge-to-edge, sharp corners on phone;
                separated rounded rows contained within the page on desktop */}
            <div className="bg-white -mx-4 sm:mx-0 sm:bg-transparent border-y border-slate-200 sm:border-0 divide-y divide-slate-100 sm:divide-y-0 sm:space-y-2">
              {visibleLeaderboard.map((m, index) => {
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
                    transition={{ delay: index * 0.04 }}
                    className={`flex items-center gap-3 px-3 py-3 sm:rounded-xl sm:border transition-colors ${
                      isTop3
                        ? `${TOP3_BG[index]} ${TOP3_BORDER[index]}`
                        : 'bg-white border-slate-100 hover:bg-slate-50'
                    }`}
                  >
                    {/* Rank — crown for the champion, bold numerals for everyone else */}
                    <div className={`flex items-center justify-center flex-shrink-0 rounded-full font-bold ${
                      index === 0 ? 'w-8 h-8 text-sm' : 'w-7 h-7 text-xs'
                    } ${isTop3 ? RANK_COLORS[index] : 'bg-slate-100 text-slate-500'}`}>
                      {index === 0
                        ? <Crown size={16} className="text-white" fill="currentColor" />
                        : index + 1}
                    </div>

                    <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={index === 0 ? 32 : 28} userId={m.user.id} />

                    <div className="flex-1 min-w-0">
                      <p className={`text-slate-800 truncate ${index === 0 ? 'font-bold text-[15px]' : 'font-medium text-sm'}`}>{m.user.full_name}</p>
                      <p className="text-[10px] text-slate-400 capitalize">{m.user.role}</p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Progress bar — hidden on very small screens */}
                      <div className="hidden sm:block w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            isTop3 ? BAR_GRADIENT[index] : 'bg-gradient-to-r from-mps-blue-400 to-mps-blue-500'
                          }`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <div className={`text-right min-w-[2rem] ${isTop3 ? 'font-bold text-base' : 'font-semibold text-sm'} ${
                        isTop3 ? SCORE_TEXT[index] : 'text-slate-600'
                      }`}>
                        {score}
                      </div>
                    </div>
                  </motion.div>
                )
              })}

              {leaderboard.length === 0 && (
                <div className="text-center py-10">
                  <Trophy size={32} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No data for this team yet</p>
                </div>
              )}
            </div>

            {leaderboardVisibleCount < leaderboard.length && (
              <button
                onClick={() => setLeaderboardVisibleCount(c => c + RECORDS_PAGE_SIZE)}
                className="w-full mt-2 py-2 text-sm text-mps-blue-600 hover:text-mps-blue-700 font-medium border border-dashed border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Load more
              </button>
            )}
          </div>

          {/* ── Summary Stats (4-up row) ─────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 bg-white -mx-4 sm:mx-0 border-y border-slate-200 sm:border sm:rounded-xl sm:shadow-sm divide-x divide-y sm:divide-y-0 divide-slate-100">
            {([
              { icon: <TrendingUp size={16} className="text-white" />, gradient: 'from-green-400 to-emerald-500', value: `${teamCompletionRate}%`, label: 'Completion Rate' },
              { icon: <AlertTriangle size={16} className="text-white" />, gradient: 'from-red-400 to-rose-500', value: totalOverdue, label: 'Cumulative Overdue' },
              { icon: <CheckCircle2 size={16} className="text-white" />, gradient: 'from-mps-blue-400 to-mps-blue-600', value: totalTasks, label: 'Total Tasks' },
              { icon: <Star size={16} className="text-white" />, gradient: 'from-amber-400 to-yellow-500', value: totalBonus, label: 'Total Bonus' },
            ] as const).map((stat, i) => (
              <div key={i} className="p-4">
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center mb-3`}>
                  {stat.icon}
                </div>
                <p className="text-2xl font-bold text-slate-800 leading-none mb-1">{stat.value}</p>
                <p className="text-xs text-slate-400 leading-snug">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* ── Member Statistics (collapsible) ─────────────────── */}
          <div className="bg-white -mx-4 sm:mx-0 border-y border-slate-200 sm:border sm:rounded-xl sm:shadow-sm overflow-hidden">
            {/* Toggle header */}
            <button
              onClick={() => setStatsExpanded(v => !v)}
              className="w-full flex items-center gap-2 p-4 hover:bg-slate-50/60 transition-colors"
            >
              <BarChart3 size={16} className="text-mps-blue-600 flex-shrink-0" />
              <h3 className="font-semibold text-slate-700">Member Statistics</h3>
              <span className="text-xs text-slate-400">({members.length} members)</span>
              <div className="flex-1" />
              <span className="text-xs text-slate-400 mr-1">{statsExpanded ? 'Hide' : 'Show'}</span>
              <ChevronDown
                size={15}
                className={`text-slate-400 transition-transform duration-200 ${statsExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            <AnimatePresence initial={false}>
              {statsExpanded && (
                <motion.div
                  key="stats"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  {/* Export button */}
                  <div className="px-4 pb-2 pt-0 flex justify-end border-t border-slate-100">
                    <button
                      onClick={handleExportCSV}
                      className="flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-mps-blue-600 bg-slate-100 hover:bg-mps-blue-50 rounded-lg transition-colors"
                    >
                      <Download size={12} /> Export CSV
                    </button>
                  </div>

                  {/* Mobile: compact cards */}
                  <div className="sm:hidden divide-y divide-slate-100">
                    {visibleMembers.map(m => (
                      <div key={m.user.id} className="flex items-center gap-3 px-4 py-4">
                        <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={36} userId={m.user.id} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{m.user.full_name}</p>
                          <p className="text-[11px] text-slate-400 capitalize mb-1.5">{m.user.role}</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-mps-blue-500 to-mps-blue-400 rounded-full"
                                style={{ width: `${m.stats.completionRate}%` }}
                              />
                            </div>
                            <span className="text-xs font-semibold text-mps-blue-600 flex-shrink-0">
                              {m.stats.completionRate}%
                            </span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 space-y-0.5">
                          <p className="text-base font-bold text-green-600">{m.stats.completed}</p>
                          <p className="text-[10px] text-slate-400">done</p>
                          {m.stats.bonus > 0 && (
                            <p className="text-xs font-semibold text-amber-500">+{m.stats.bonus}BP</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop: full table */}
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
                        {visibleMembers.map(m => (
                          <tr key={m.user.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={28} userId={m.user.id} />
                                <div>
                                  <p className="font-medium text-slate-800">{m.user.full_name}</p>
                                  <p className="text-xs text-slate-400 capitalize">{m.user.role}</p>
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

                  {memberVisibleCount < members.length && (
                    <div className="p-3 border-t border-slate-100">
                      <button
                        onClick={() => setMemberVisibleCount(c => c + RECORDS_PAGE_SIZE)}
                        className="w-full py-2 text-sm text-mps-blue-600 hover:text-mps-blue-700 font-medium border border-dashed border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        Load more
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  )
}
