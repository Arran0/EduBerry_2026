'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Trophy, Download, ChevronDown, Users, Crown } from 'lucide-react'
import { fetchTeamAnalytics } from '@/lib/tasks'
import { fetchAllTeams, TeamWithDetails } from '@/lib/teams'
import { MemberStats, analyticsCache, analyticsCacheKey, toMonthParam } from '@/lib/teamAnalyticsCache'
import { csvField } from '@/lib/attachmentPolicy'
import { UserRole } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import {
  TaskDeck, Panel, PanelHead, StatTile, Chip, Segmented, Stepper, Btn, SearchField, MenuPanel, MenuOption, useMenuDismiss,
  Sheet, SheetHead, SheetRow, Note,
} from './ui'

interface TeamAnalyticsProps {
  userId: string
  userRole: UserRole
  isTeacher?: boolean
}

// Gold, silver, bronze: distinct so the top three read at a glance.
const MEDAL = [
  'bg-gradient-to-br from-amber-300 to-amber-500 text-white',
  'bg-gradient-to-br from-slate-300 to-slate-500 text-white',
  'bg-gradient-to-br from-orange-400 to-amber-700 text-white',
]

const LEADERBOARD_PAGE_SIZE = 10
const MEMBER_PAGE_SIZE = 25
const MEMBER_COLS = 'minmax(0,2.2fr) repeat(4,minmax(3.5rem,0.6fr)) minmax(7rem,1fr)'

const isAdminOrPrincipal = (role: UserRole) => role === 'admin' || role === 'principal'

// The team list rarely changes in a session, so it is kept for the session.
// (The analytics cache lives in lib/teamAnalyticsCache, so the page can
// prefetch into it without loading this component.)
let teamsCache: TeamWithDetails[] | null = null

export default function TeamAnalytics({ userId, userRole, isTeacher = false }: TeamAnalyticsProps) {
  const [members, setMembers] = useState<MemberStats[]>([])
  const [loading, setLoading] = useState(true)
  const [basis, setBasis] = useState<'completed' | 'bonus'>('completed')
  const [teamCompletionRate, setTeamCompletionRate] = useState(0)
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const now = new Date()
  const isCurrentMonth = selectedMonth.getFullYear() === now.getFullYear() && selectedMonth.getMonth() === now.getMonth()

  const [teams, setTeams] = useState<TeamWithDetails[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [teamSearch, setTeamSearch] = useState('')
  const [menu, setMenu] = useState<'team' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useMenuDismiss(menu, setMenu, menuRef)

  const [statsOpen, setStatsOpen] = useState(false)
  const [memberVisible, setMemberVisible] = useState(MEMBER_PAGE_SIZE)
  const [boardVisible, setBoardVisible] = useState(LEADERBOARD_PAGE_SIZE)
  useEffect(() => { setBoardVisible(LEADERBOARD_PAGE_SIZE) }, [selectedTeamId, basis])

  // Keyed by person and month. Past months never change, so a cached one is
  // served as is; the current month shows the cached copy and refreshes it.
  const loadData = useCallback(async () => {
    const month = toMonthParam(selectedMonth)
    const key = analyticsCacheKey(userId, month)
    const n = new Date()
    const current = selectedMonth.getFullYear() === n.getFullYear() && selectedMonth.getMonth() === n.getMonth()
    const cached = analyticsCache.get(key)
    if (cached) {
      setMembers(cached.members)
      setTeamCompletionRate(cached.teamCompletionRate)
      setLoading(false)
      if (!current) return
    } else {
      setLoading(true)
    }
    const data = await fetchTeamAnalytics(userId, userRole, month)
    // An empty result can't be told apart from a failed request, so it is
    // never cached.
    if (data.members.length > 0) analyticsCache.set(key, data)
    setMembers(data.members)
    setTeamCompletionRate(data.teamCompletionRate)
    setLoading(false)
  }, [userId, userRole, selectedMonth])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!isAdminOrPrincipal(userRole)) return
    if (teamsCache) { setTeams(teamsCache); return }
    fetchAllTeams().then(t => { teamsCache = t; setTeams(t) })
  }, [userRole])

  const filteredTeams = useMemo(() => {
    const q = teamSearch.trim().toLowerCase()
    return q ? teams.filter(t => t.name.toLowerCase().includes(q)) : teams
  }, [teams, teamSearch])
  const selectedTeam = useMemo(() => teams.find(t => t.id === selectedTeamId) ?? null, [teams, selectedTeamId])

  const leaderboard = useMemo(() => {
    const ids = selectedTeam ? new Set(selectedTeam.members.map(m => m.user_id)) : null
    const list = ids ? members.filter(m => ids.has(m.user.id)) : [...members]
    list.sort((a, b) => basis === 'completed' ? b.stats.completed - a.stats.completed : b.stats.bonus - a.stats.bonus)
    return list
  }, [members, basis, selectedTeam])

  const totals = useMemo(() => members.reduce(
    (acc, m) => ({ bonus: acc.bonus + m.stats.bonus, tasks: acc.tasks + m.stats.total, overdue: acc.overdue + m.stats.overdue }),
    { bonus: 0, tasks: 0, overdue: 0 },
  ), [members])

  const monthLabel = selectedMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const scopeLabel = selectedTeam ? selectedTeam.name : isAdminOrPrincipal(userRole) ? 'All staff' : isTeacher ? 'My team' : 'Team'
  const topScore = leaderboard[0] ? (basis === 'completed' ? leaderboard[0].stats.completed : leaderboard[0].stats.bonus) : 0

  const handleExportCSV = () => {
    const header = ['Name', 'Role', 'Total', 'Completed', 'Bonus', 'Overdue', 'Rate']
    const rows = members.map(m => [m.user.full_name, m.user.role, m.stats.total, m.stats.completed, m.stats.bonus, m.stats.overdue, `${m.stats.completionRate}%`])
    const csv = [header, ...rows].map(r => r.map(csvField).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `team-statistics-${toMonthParam(selectedMonth)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const teamPicker = isAdminOrPrincipal(userRole) && teams.length > 0 && (
    <div ref={menuRef} className="sm:relative min-w-0">
      <button
        type="button"
        onClick={() => setMenu(m => m ? null : 'team')}
        aria-haspopup="true"
        aria-expanded={menu === 'team'}
        className={`inline-flex items-center gap-1.5 min-h-9 py-1 min-w-0 max-w-[15rem] px-3 rounded-full text-[12.5px] font-semibold text-left leading-tight transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
          selectedTeam
            ? 'text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16)]'
            : 'text-slate-700 bg-white border border-[#E2DDD2] hover:border-[#CFC8B8]'}`}
      >
        <Users size={14} className={`flex-shrink-0 ${selectedTeam ? 'text-[#E9DDBB]' : 'text-slate-500'}`} />
        <span className="min-w-0 break-words">{selectedTeam ? selectedTeam.name : 'All teams'}</span>
        <ChevronDown size={13} className="flex-shrink-0 opacity-60" />
      </button>
      {menu === 'team' && (
        <MenuPanel>
          <div className="p-2 border-b border-slate-100">
            <SearchField value={teamSearch} onChange={setTeamSearch} placeholder="Search teams" />
          </div>
          <div className="py-1">
            <MenuOption selected={!selectedTeamId} onClick={() => { setSelectedTeamId(null); setMenu(null); setTeamSearch('') }}>
              <span className="flex-1 min-w-0">All teams</span>
              <span className="text-[11.5px] text-slate-400 tabular-nums">{members.length}</span>
            </MenuOption>
            {filteredTeams.map(t => (
              <MenuOption key={t.id} selected={selectedTeamId === t.id} onClick={() => { setSelectedTeamId(t.id); setMenu(null); setTeamSearch('') }}>
                <span className="flex-1 min-w-0 break-words">{t.name}</span>
                <span className="text-[11.5px] text-slate-400 tabular-nums">{t.member_count}</span>
              </MenuOption>
            ))}
            {filteredTeams.length === 0 && <p className="px-3.5 py-3 text-[12.5px] text-slate-500">No team matches that.</p>}
          </div>
        </MenuPanel>
      )}
    </div>
  )

  return (
    <TaskDeck
      title={isTeacher ? 'My team' : 'Team'}
      icon={Trophy}
      actions={
        <>
          {teamPicker}
          <Stepper
            label={monthLabel}
            onPrev={() => setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            onNext={() => setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            prevLabel="Previous month"
            nextLabel="Next month"
            canNext={!isCurrentMonth}
          />
        </>
      }
      bodyClassName="space-y-2.5 sm:space-y-3"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-2.5 sm:gap-3 items-start">
        {/* Leaderboard */}
        <Panel className="order-2 lg:order-1">
          <PanelHead
            title={<span className="inline-flex flex-wrap items-center gap-1.5">Leaderboard <Chip tone="neutral">{scopeLabel}</Chip></span>}
            right={
              <Segmented
                value={basis}
                onChange={setBasis}
                options={[{ value: 'completed', label: 'Tasks done' }, { value: 'bonus', label: 'Bonus points' }]}
                className="!w-auto"
              />
            }
          />
          {loading ? (
            <div className="animate-pulse divide-y divide-[#F0ECE3]">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-2.5 px-3.5 py-2.5">
                  <div className="w-6 h-6 rounded-full bg-slate-100" />
                  <div className="w-7 h-7 rounded-full bg-slate-100" />
                  <div className="flex-1 h-3 bg-slate-100 rounded" style={{ maxWidth: `${45 + (i * 17) % 40}%` }} />
                  <div className="w-8 h-4 bg-slate-100 rounded" />
                </div>
              ))}
            </div>
          ) : leaderboard.length === 0 ? (
            <Note>No tasks for {scopeLabel.toLowerCase()} in {monthLabel}.</Note>
          ) : (
            <div className="divide-y divide-[#F0ECE3]">
              {leaderboard.slice(0, boardVisible).map((m, index) => {
                const score = basis === 'completed' ? m.stats.completed : m.stats.bonus
                const barPct = topScore > 0 ? Math.round((score / topScore) * 100) : 0
                return (
                  <div key={m.user.id} className={`flex items-center gap-2.5 px-3.5 py-2 ${index === 0 ? 'bg-[#FBF6E9]' : ''}`}>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold tabular-nums ${index < 3 ? MEDAL[index] : 'bg-slate-100 text-slate-500'}`}>
                      {index === 0 ? <Crown size={12} fill="currentColor" /> : index + 1}
                    </span>
                    <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={28} userId={m.user.id} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] font-semibold text-slate-900 leading-snug break-words">{m.user.full_name}</span>
                      <span className="block text-[11.5px] text-slate-400 capitalize leading-tight">{m.user.role}</span>
                    </span>
                    <span className="hidden sm:block w-20 h-1.5 rounded-full bg-[#EEEAE1] overflow-hidden flex-shrink-0">
                      <span className="block h-full rounded-full bg-gradient-to-r from-[#B45309] to-[#EA580C]" style={{ width: `${barPct}%` }} />
                    </span>
                    <span className="w-9 text-right text-[14px] font-bold text-slate-900 tabular-nums flex-shrink-0">{score}</span>
                  </div>
                )
              })}
            </div>
          )}
          {!loading && boardVisible < leaderboard.length && (
            <button onClick={() => setBoardVisible(c => c + LEADERBOARD_PAGE_SIZE)} className="w-full h-10 border-t border-[#EEEAE1] text-[12.5px] font-semibold text-[#8B6F47] hover:bg-[#FAF7F0] transition-colors">
              Show {Math.min(LEADERBOARD_PAGE_SIZE, leaderboard.length - boardVisible)} more
            </button>
          )}
        </Panel>

        {/* Team figures */}
        <div className="grid grid-cols-2 gap-2 sm:gap-2.5 order-1 lg:order-2">
          <StatTile label="Completion rate" value={`${teamCompletionRate}%`} sub={monthLabel} shade={0} loading={loading} />
          <StatTile label="Tasks" value={String(totals.tasks)} sub={`across ${members.length} people`} loading={loading} />
          <StatTile label="Overdue" value={String(totals.overdue)} sub="added up across people" loading={loading} />
          <StatTile label="Bonus points" value={String(totals.bonus)} sub="signed off" loading={loading} />
        </div>
      </div>

      {/* Everyone's figures */}
      <Panel>
        <div className="flex flex-wrap items-center gap-2 px-2 min-h-[44px] py-1">
          <button
            onClick={() => setStatsOpen(v => !v)}
            aria-expanded={statsOpen}
            className="flex items-center gap-2 min-w-0 flex-1 basis-[180px] h-9 px-1.5 rounded-full text-left hover:bg-[#FAF7F0] transition-colors"
          >
            <span className="text-[13.5px] font-semibold text-slate-900">Everyone&apos;s figures</span>
            <span className="text-[12.5px] font-medium text-slate-400 tabular-nums">{members.length}</span>
            <ChevronDown size={15} className={`ml-auto text-slate-400 transition-transform duration-200 ${statsOpen ? 'rotate-180' : ''}`} />
          </button>
          {statsOpen && members.length > 0 && (
            <Btn tone="ghost" onClick={handleExportCSV}><Download size={13} /> Export CSV</Btn>
          )}
        </div>
        {statsOpen && (
          <div className="border-t border-[#EEEAE1]">
            {/* Phone: one line per person */}
            <div className="lg:hidden divide-y divide-[#F0ECE3]">
              {members.slice(0, memberVisible).map(m => (
                <div key={m.user.id} className="flex items-center gap-2.5 px-3.5 py-2">
                  <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={28} userId={m.user.id} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-900 leading-snug break-words">{m.user.full_name}</span>
                    <span className="flex flex-wrap gap-x-2.5 text-[11.5px] text-slate-500 tabular-nums">
                      <span>{m.stats.completed}/{m.stats.total} done</span>
                      {m.stats.bonus > 0 && <span className="text-amber-700">{m.stats.bonus} pts</span>}
                      {m.stats.overdue > 0 && <span className="text-rose-600">{m.stats.overdue} overdue</span>}
                    </span>
                  </span>
                  <span className="text-[13px] font-bold text-slate-900 tabular-nums">{m.stats.completionRate}%</span>
                </div>
              ))}
            </div>
            {/* Desktop: the table */}
            <div className="hidden lg:block">
              <Sheet className="!border-0 !shadow-none">
                <SheetHead
                  cols={MEMBER_COLS}
                  columns={[
                    { label: 'Name' }, { label: 'Tasks', align: 'right' }, { label: 'Done', align: 'right' },
                    { label: 'Bonus', align: 'right' }, { label: 'Overdue', align: 'right' }, { label: 'Rate' },
                  ]}
                />
                {members.slice(0, memberVisible).map(m => (
                  <SheetRow key={m.user.id} cols={MEMBER_COLS}>
                    <span className="flex items-center gap-2 min-w-0">
                      <Avatar avatarUrl={m.user.avatar_url} name={m.user.full_name} size={24} userId={m.user.id} />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-slate-900 leading-tight break-words">{m.user.full_name}</span>
                        <span className="block text-[11px] text-slate-400 capitalize leading-tight">{m.user.role}</span>
                      </span>
                    </span>
                    <span className="text-[12.5px] text-right tabular-nums text-slate-700">{m.stats.total}</span>
                    <span className="text-[12.5px] text-right tabular-nums text-emerald-700 font-semibold">{m.stats.completed}</span>
                    <span className="text-[12.5px] text-right tabular-nums text-amber-700">{m.stats.bonus}</span>
                    <span className={`text-[12.5px] text-right tabular-nums ${m.stats.overdue > 0 ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>{m.stats.overdue}</span>
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="flex-1 h-1.5 rounded-full bg-[#EEEAE1] overflow-hidden">
                        <span className="block h-full rounded-full bg-[#27272A]" style={{ width: `${m.stats.completionRate}%` }} />
                      </span>
                      <span className="w-9 text-right text-[12px] tabular-nums text-slate-700">{m.stats.completionRate}%</span>
                    </span>
                  </SheetRow>
                ))}
              </Sheet>
            </div>
            {memberVisible < members.length && (
              <button onClick={() => setMemberVisible(c => c + MEMBER_PAGE_SIZE)} className="w-full h-10 border-t border-[#EEEAE1] text-[12.5px] font-semibold text-[#8B6F47] hover:bg-[#FAF7F0] transition-colors">
                Show more
              </button>
            )}
          </div>
        )}
      </Panel>
    </TaskDeck>
  )
}
