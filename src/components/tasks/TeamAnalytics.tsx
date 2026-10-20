'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, TrendingUp, AlertTriangle, BarChart3, Download, Star, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Search, Users, Crown } from 'lucide-react'
import { fetchTeamAnalytics } from '@/lib/tasks'
import { fetchAllTeams, TeamWithDetails } from '@/lib/teams'
import {
  MemberStats,
  analyticsCache,
  analyticsCacheKey,
  toMonthParam,
} from '@/lib/teamAnalyticsCache'
import { UserRole } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import { csvField } from '@/lib/attachmentPolicy'
import { IconChip, Seg } from './ui'

interface TeamAnalyticsProps {
  userId: string
  userRole: UserRole
  isTeacher?: boolean
}

// Gold / Silver / Bronze — deliberately distinct so #1, #2, #3 read at a glance.
const TOP3_BORDER = [
  'border-l-[3px] border-l-amber-400',
  'border-l-[3px] border-l-slate-300',
  'border-l-[3px] border-l-orange-400',
]

const TOP3_BG = [
  'bg-gradient-to-r from-amber-50 to-white',
  'bg-gradient-to-r from-slate-50 to-white',
  'bg-gradient-to-r from-orange-50/70 to-white',
]

const RANK_COLORS = [
  'bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-[0_4px_10px_-4px_rgba(217,119,6,.8)]',
  'bg-gradient-to-br from-slate-200 to-slate-400 text-white',
  'bg-gradient-to-br from-orange-300 to-orange-500 text-white',
]

const SCORE_TEXT = ['text-amber-600', 'text-slate-600', 'text-orange-600']
const BAR_GRADIENT = [
  'bg-gradient-to-r from-amber-400 to-yellow-400',
  'bg-gradient-to-r from-slate-300 to-slate-200',
  'bg-gradient-to-r from-orange-500 to-amber-500',
]

// "Load more" page sizes — leaderboard pages in small batches since its rows
// are taller; the member table's rows are compact enough to page in bigger ones.
const LEADERBOARD_PAGE_SIZE = 10
const MEMBER_PAGE_SIZE = 25

const isAdminOrPrincipal = (role: UserRole) => role === 'admin' || role === 'principal'

// Teams list rarely changes within a session; cache it module-wide so the
// admin/principal selector doesn't refetch on every mount. (The analytics cache
// itself lives in lib/teamAnalyticsCache so the tasks page can prefetch into it
// without loading this component.)
let teamsCache: TeamWithDetails[] | null = null

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
  const [memberVisibleCount, setMemberVisibleCount] = useState(MEMBER_PAGE_SIZE)

  // Leaderboard paging — "Load more" reveals LEADERBOARD_PAGE_SIZE more at a time
  const [leaderboardVisibleCount, setLeaderboardVisibleCount] = useState(LEADERBOARD_PAGE_SIZE)
  useEffect(() => { setLeaderboardVisibleCount(LEADERBOARD_PAGE_SIZE) }, [selectedTeamId, leaderboardBasis])

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
    // Quoted and formula-safe: a name with a comma stays one column, and one
    // beginning with = can't run as a formula when the file is opened.
    const csv = [headers, ...rows].map(r => r.map(csvField).join(',')).join('\r\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `team-statistics-${toMonthParam(selectedMonth)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Leaderboard title label
  const leaderboardLabel = selectedTeam
    ? selectedTeam.name
    : isAdminOrPrincipal(userRole)
      ? 'All staff'
      : isTeacher
        ? 'My team'
        : 'Team'

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Month navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[17px] sm:text-xl font-bold text-slate-800 flex items-center gap-2.5">
          <IconChip icon={Users} />
          {isTeacher ? 'My team' : 'Team'}
          <span className="text-[12.5px] font-medium text-slate-400">Monthly report</span>
        </h2>
        <span className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-white border border-amber-900/[0.12] shadow-[0_1px_2px_rgba(120,53,15,.05)]">
          <button onClick={goPrevMonth} className="w-8 h-8 inline-flex items-center justify-center rounded-full text-slate-500 hover:text-amber-700 hover:bg-amber-50 transition" aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <span className="text-[13px] font-semibold text-slate-800 px-1.5 min-w-[110px] text-center whitespace-nowrap">{monthLabel}</span>
          <button onClick={goNextMonth} disabled={isCurrentMonth} className="w-8 h-8 inline-flex items-center justify-center rounded-full text-slate-500 hover:text-amber-700 hover:bg-amber-50 disabled:opacity-30 disabled:pointer-events-none transition" aria-label="Next month">
            <ChevronRight size={16} />
          </button>
        </span>
      </div>

      {loading ? (
        <div className="space-y-5 animate-pulse">
          {/* Leaderboard skeleton */}
          <div className="tk-card p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-slate-200 rounded-md" />
                <div className="w-24 h-4 bg-slate-200 rounded-md" />
              </div>
              <div className="w-28 h-8 bg-slate-100 rounded-xl" />
            </div>
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-amber-900/[0.06]">
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="tk-card p-3">
                <div className="w-8 h-8 rounded-xl bg-slate-200 mb-3" />
                <div className="h-7 bg-slate-200 rounded-md w-14 mb-1.5" />
                <div className="h-3 bg-slate-100 rounded-md w-28" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* ── Leaderboard ─────────────────────────────────────── */}
          <div className="tk-card overflow-hidden">

            {/* Header row */}
            <div className="tk-card-head flex flex-wrap items-center justify-between gap-2 px-3.5 py-2">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <Trophy size={16} className="text-amber-500 flex-shrink-0" />
                <h3 className="text-[13.5px] font-semibold text-slate-800">Leaderboard</h3>
                <span className="text-[11px] font-semibold text-amber-800 bg-amber-100/80 rounded-full px-2 py-0.5 break-words">{leaderboardLabel}</span>
              </div>

              {/* Tasks / Bonus Points toggle */}
              <Seg
                value={leaderboardBasis}
                onChange={setLeaderboardBasis}
                options={[
                  { value: 'completed', label: <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} /> Tasks</span> },
                  { value: 'bonus', label: <span className="inline-flex items-center gap-1"><Star size={12} /> Bonus</span> },
                ]}
              />
            </div>

            {/* Team selector — admin / principal only */}
            {isAdminOrPrincipal(userRole) && teams.length > 0 && (
              <div className="relative px-2.5 pt-2.5" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(v => !v)}
                  className="w-full flex items-center gap-2 px-3 min-h-[38px] py-1.5 rounded-[12px] border border-amber-900/[0.12] bg-white hover:border-amber-300 transition-colors text-[13px]"
                >
                  <Users size={14} className="text-amber-600 flex-shrink-0" />
                  <span className="flex-1 text-left font-medium text-slate-700 break-words min-w-0">
                    {selectedTeam ? selectedTeam.name : 'All teams'}
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
                      className="absolute top-full left-2.5 right-2.5 mt-1 tk-card z-30 overflow-hidden"
                    >
                      {/* Search */}
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-900/[0.07]">
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
                              ? 'bg-amber-50 text-amber-800 font-semibold'
                              : 'text-slate-700 hover:bg-amber-50/50'
                          }`}
                        >
                          <Trophy size={13} className="text-amber-400 flex-shrink-0" />
                          All teams
                          <span className="ml-auto text-xs text-slate-400">{members.length} staff</span>
                        </button>

                        {filteredTeams.map(t => (
                          <button
                            key={t.id}
                            onClick={() => { setSelectedTeamId(t.id); setDropdownOpen(false); setTeamSearch('') }}
                            className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                              selectedTeamId === t.id
                                ? 'bg-amber-50 text-amber-800 font-semibold'
                                : 'text-slate-700 hover:bg-amber-50/50'
                            }`}
                          >
                            <Users size={13} className="text-slate-400 flex-shrink-0" />
                            <span className="flex-1 min-w-0 break-words">{t.name}</span>
                            <span className="text-xs text-slate-400 flex-shrink-0">{t.member_count}</span>
                          </button>
                        ))}

                        {filteredTeams.length === 0 && (
                          <p className="text-xs text-slate-400 text-center py-4">No teams match that</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Leaderboard list — unseparated, edge-to-edge, sharp corners on phone;
                separated rounded rows contained within the page on desktop */}
            <div className="p-2.5 space-y-1.5">
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
                    className={`flex items-center gap-2.5 px-3 py-1.5 rounded-[12px] border border-amber-900/[0.06] transition-colors ${
                      isTop3 ? `${TOP3_BG[index]} ${TOP3_BORDER[index]}` : 'bg-white hover:bg-amber-50/40'
                    }`}
                  >
                    {/* Rank — crown for the champion, bold numerals for everyone else */}
                    <div className={`flex items-center justify-center flex-shrink-0 rounded-full font-bold ${
                      index === 0 ? 'w-7 h-7 text-xs' : 'w-6 h-6 text-[11px]'
                    } ${isTop3 ? RANK_COLORS[index] : 'bg-slate-100 text-slate-500'}`}>
                      {index === 0
                        ? <Crown size={14} className="text-white" fill="currentColor" />
                        : index + 1}
                    </div>

                    <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={index === 0 ? 28 : 24} userId={m.user.id} />

                    <div className="flex-1 min-w-0">
                      <p className={`text-slate-800 break-words leading-snug ${index === 0 ? 'font-bold text-sm' : 'font-medium text-[13px]'}`}>{m.user.full_name}</p>
                      <p className="text-[10px] text-slate-400 capitalize leading-tight">{m.user.role}</p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Progress bar — hidden on very small screens */}
                      <div className="hidden sm:block w-20 h-1.5 bg-amber-900/[0.07] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            isTop3 ? BAR_GRADIENT[index] : 'bg-gradient-to-r from-amber-300 to-orange-400'
                          }`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <div className={`text-right min-w-[2rem] ${isTop3 ? 'font-bold text-sm' : 'font-semibold text-[13px]'} ${
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
                  <p className="text-sm text-slate-500">No completed tasks for this team yet</p>
                </div>
              )}
            </div>

            {leaderboardVisibleCount < leaderboard.length && (
              <button
                onClick={() => setLeaderboardVisibleCount(c => c + LEADERBOARD_PAGE_SIZE)}
                className="w-[calc(100%-1.25rem)] mx-2.5 mb-2.5 h-9 text-[12.5px] text-amber-700 hover:text-amber-800 font-semibold border border-dashed border-amber-300/70 rounded-full hover:bg-amber-50 transition-colors"
              >
                Load more
              </button>
            )}
          </div>

          {/* ── Summary Stats (4-up row) ─────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              { icon: <TrendingUp size={14} />, tone: 'bg-emerald-50 text-emerald-600', value: `${teamCompletionRate}%`, label: 'Completion rate' },
              { icon: <AlertTriangle size={14} />, tone: 'bg-red-50 text-red-500', value: totalOverdue, label: 'Overdue, all staff' },
              { icon: <CheckCircle2 size={14} />, tone: 'bg-sky-50 text-sky-600', value: totalTasks, label: 'Total tasks' },
              { icon: <Star size={14} />, tone: 'bg-amber-50 text-amber-600', value: totalBonus, label: 'Bonus points' },
            ] as const).map((stat, i) => (
              <div key={i} className="tk-card !rounded-[16px] px-3.5 py-3 flex items-center gap-3 min-w-0">
                <span className={`w-9 h-9 rounded-[11px] flex items-center justify-center flex-shrink-0 ${stat.tone}`}>{stat.icon}</span>
                <span className="min-w-0">
                  <span className="block font-display text-[1.35rem] font-bold text-slate-800 leading-none tabular-nums">{stat.value}</span>
                  <span className="block text-[11.5px] text-slate-500 leading-snug mt-1 break-words">{stat.label}</span>
                </span>
              </div>
            ))}
          </div>

          {/* ── Member Statistics (collapsible) ─────────────────── */}
          <div className="tk-card overflow-hidden">
            {/* Toggle header */}
            <button
              onClick={() => setStatsExpanded(v => !v)}
              className="w-full flex items-center gap-2 px-3.5 py-3 hover:bg-amber-50/40 transition-colors"
            >
              <BarChart3 size={15} className="text-amber-600 flex-shrink-0" />
              <h3 className="text-[13.5px] font-semibold text-slate-800">Member statistics</h3>
              <span className="text-[12px] text-slate-400 tabular-nums">{members.length}</span>
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
                  <div className="px-3.5 py-2 flex justify-end border-t border-amber-900/[0.07]">
                    <button
                      onClick={handleExportCSV}
                      className="tk-btn tk-btn-soft !h-8"
                    >
                      <Download size={12} /> Export CSV
                    </button>
                  </div>

                  {/* Mobile: compact cards */}
                  <div className="sm:hidden divide-y divide-amber-900/[0.06]">
                    {visibleMembers.map(m => (
                      <div key={m.user.id} className="flex items-center gap-2.5 px-4 py-2">
                        <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={28} userId={m.user.id} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 break-words">{m.user.full_name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <div className="flex-1 h-1.5 bg-amber-900/[0.07] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-amber-400 to-emerald-500 rounded-full"
                                style={{ width: `${m.stats.completionRate}%` }}
                              />
                            </div>
                            <span className="text-[10.5px] font-semibold text-amber-700 tabular-nums flex-shrink-0">
                              {m.stats.completionRate}%
                            </span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-green-600 leading-tight">{m.stats.completed}</p>
                          {m.stats.bonus > 0 && (
                            <p className="text-[10px] font-semibold text-amber-500 leading-tight">+{m.stats.bonus}BP</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop: full table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-y border-amber-900/[0.07] bg-[#fffaf2] text-[11.5px]">
                          <th className="text-left px-3 py-1.5 text-amber-900/70 font-semibold">Name</th>
                          <th className="text-center px-3 py-1.5 text-amber-900/70 font-semibold">Total</th>
                          <th className="text-center px-3 py-1.5 text-amber-900/70 font-semibold">Completed</th>
                          <th className="text-center px-3 py-1.5 text-amber-900/70 font-semibold">Bonus</th>
                          <th className="text-center px-3 py-1.5 text-amber-900/70 font-semibold">Overdue</th>
                          <th className="text-center px-3 py-1.5 text-amber-900/70 font-semibold">Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleMembers.map(m => (
                          <tr key={m.user.id} className="border-b border-amber-900/[0.05] hover:bg-amber-50/40">
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-2">
                                <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={24} userId={m.user.id} />
                                <div>
                                  <p className="font-medium text-slate-800 leading-tight">{m.user.full_name}</p>
                                  <p className="text-[11px] text-slate-400 capitalize leading-tight">{m.user.role}</p>
                                </div>
                              </div>
                            </td>
                            <td className="text-center px-3 py-1.5 text-slate-600">{m.stats.total}</td>
                            <td className="text-center px-3 py-1.5">
                              <span className="text-green-600 font-medium">{m.stats.completed}</span>
                            </td>
                            <td className="text-center px-3 py-1.5">
                              <span className="text-amber-600 font-medium">{m.stats.bonus}</span>
                            </td>
                            <td className="text-center px-3 py-1.5">
                              <span className={`font-medium ${m.stats.overdue > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                                {m.stats.overdue}
                              </span>
                            </td>
                            <td className="text-center px-3 py-1.5">
                              <div className="flex items-center justify-center gap-2">
                                <div className="w-16 h-1.5 bg-amber-900/[0.07] rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-amber-400 to-emerald-500 rounded-full"
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
                    <div className="p-2.5 border-t border-amber-900/[0.07]">
                      <button
                        onClick={() => setMemberVisibleCount(c => c + MEMBER_PAGE_SIZE)}
                        className="w-full h-9 text-[12.5px] text-amber-700 hover:text-amber-800 font-semibold border border-dashed border-amber-300/70 rounded-full hover:bg-amber-50 transition-colors"
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
