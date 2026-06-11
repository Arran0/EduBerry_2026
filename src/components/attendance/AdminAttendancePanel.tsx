'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import Avatar from '@/components/Avatar'
import { Search, Users, UserCheck, X, Clock, Loader2, ChevronDown, UsersRound } from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  Holiday,
  fetchStaffAttendanceForDate,
  fetchAttendanceConfig,
  fetchHolidays,
  fetchSchoolAttendanceSummary,
  adminMarkStaffAttendance,
  isPresentStatus,
  STAFF_ATTENDANCE_STATUS_LABELS,
  STAFF_ATTENDANCE_STATUS_COLORS,
} from '@/lib/attendance'
import { fetchTeamsForDropdown, fetchTeamStaffById } from '@/lib/teams'

interface Props {
  viewerId: string
  viewerRole: 'admin' | 'principal' | 'coordinator'
  /** For coordinators: their pre-loaded team. For admin/principal: pass []. */
  staff: UserProfile[]
  refreshKey?: number
  onChanged?: () => void
}

const ROLE_BADGE: Record<string, string> = {
  teacher: 'bg-emerald-50 text-emerald-700',
  coordinator: 'bg-purple-50 text-purple-700',
  principal: 'bg-amber-50 text-amber-700',
  admin: 'bg-rose-50 text-rose-700',
}

const STATUS_OPTIONS: StaffAttendanceStatus[] = ['present', 'late', 'half_day', 'wfh', 'absent', 'on_leave']

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ─── Coordinator view (small team, uses props list) ────────────────────────────

function CoordinatorPanel({
  viewerId, staff, refreshKey = 0, onChanged,
}: {
  viewerId: string
  staff: UserProfile[]
  refreshKey?: number
  onChanged?: () => void
}) {
  const today = new Date().toISOString().split('T')[0]
  const [todayRecords, setTodayRecords] = useState<StaffAttendanceRecord[]>([])
  const [pastCutoff, setPastCutoff] = useState(false)
  const [isHolidayToday, setIsHolidayToday] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [recs, cfg, hols] = await Promise.all([
      fetchStaffAttendanceForDate(staff.map(s => s.id), today),
      fetchAttendanceConfig(),
      fetchHolidays(new Date().getFullYear(), new Date().getMonth() + 1),
    ])
    setTodayRecords(recs)
    setIsHolidayToday(hols.some((h: Holiday) => h.date === today))
    if (cfg.late_cutoff) {
      const [h, m] = cfg.late_cutoff.split(':').map(Number)
      const now = new Date()
      setPastCutoff(now.getHours() * 60 + now.getMinutes() > h * 60 + m)
    } else {
      setPastCutoff(false)
    }
    setLoading(false)
  }, [staff, today])

  useEffect(() => { load() }, [load, refreshKey])

  const recordByStaff = useMemo(() => {
    const m = new Map<string, StaffAttendanceRecord>()
    for (const r of todayRecords) m.set(r.staff_id, r)
    return m
  }, [todayRecords])

  const presentCount = useMemo(
    () => todayRecords.filter(r => isPresentStatus(r.status)).length,
    [todayRecords]
  )
  const placeholderLabel = isHolidayToday ? 'Holiday' : pastCutoff ? 'Absent (auto)' : 'Not marked'

  const handleSet = async (staffId: string, status: StaffAttendanceStatus) => {
    setSavingId(staffId)
    const ok = await adminMarkStaffAttendance(staffId, today, status, viewerId)
    if (ok) { await load(); onChanged?.() }
    setSavingId(null)
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div
        className="flex items-center gap-4 p-4 rounded-2xl border"
        style={{ background: 'linear-gradient(135deg, var(--page-primary-light, #ede9fe), var(--page-accent-light, #e0e7ff))', borderColor: 'var(--page-primary-light, #ddd6fe)' }}
      >
        <div className="p-2.5 bg-white rounded-xl shadow-sm flex-shrink-0">
          <UserCheck size={22} style={{ color: 'var(--page-primary, #7c3aed)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-bold text-slate-800 leading-none">
            {loading ? '—' : presentCount}
            <span className="text-base font-medium text-slate-400"> / {staff.length}</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">Present today across your team</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold text-slate-700">{staff.length}</p>
          <p className="text-[11px] text-slate-400 flex items-center gap-1 justify-end"><Users size={11} /> staff</p>
        </div>
      </div>

      {/* Roster */}
      <StaffRoster
        staffList={staff}
        todayRecords={todayRecords}
        loading={loading}
        savingId={savingId}
        placeholderLabel={placeholderLabel}
        emptyMessage="No teachers in your team yet"
        onSet={handleSet}
      />
    </div>
  )
}

// ─── Admin / Principal view (lazy per-team loading) ───────────────────────────

function AdminPanel({
  viewerId, refreshKey = 0, onChanged,
}: {
  viewerId: string
  refreshKey?: number
  onChanged?: () => void
}) {
  const today = new Date().toISOString().split('T')[0]

  // School-wide summary (lightweight COUNT queries)
  const [summary, setSummary] = useState<{ present: number; total: number } | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  // Team dropdown
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [teamsLoading, setTeamsLoading] = useState(true)
  const [teamQuery, setTeamQuery] = useState('')
  const [showTeamDropdown, setShowTeamDropdown] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<{ id: string; name: string } | null>(null)

  // Selected team's roster
  const [teamStaff, setTeamStaff] = useState<UserProfile[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [todayRecords, setTodayRecords] = useState<StaffAttendanceRecord[]>([])
  const [pastCutoff, setPastCutoff] = useState(false)
  const [isHolidayToday, setIsHolidayToday] = useState(false)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Load lightweight data on mount
  useEffect(() => {
    setSummaryLoading(true)
    fetchSchoolAttendanceSummary(today).then(s => { setSummary(s); setSummaryLoading(false) })
    fetchTeamsForDropdown().then(t => { setTeams(t); setTeamsLoading(false) })
    fetchAttendanceConfig().then(cfg => {
      if (cfg.late_cutoff) {
        const [h, m] = cfg.late_cutoff.split(':').map(Number)
        const now = new Date()
        setPastCutoff(now.getHours() * 60 + now.getMinutes() > h * 60 + m)
      }
    })
    fetchHolidays(new Date().getFullYear(), new Date().getMonth() + 1).then(hols => {
      setIsHolidayToday(hols.some((h: Holiday) => h.date === today))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  // Refresh summary when external changes happen
  useEffect(() => {
    if (refreshKey === 0) return
    fetchSchoolAttendanceSummary(today).then(setSummary)
  }, [refreshKey, today])

  // Load selected team's staff + attendance
  const loadTeam = useCallback(async (team: { id: string; name: string }) => {
    setTeamLoading(true)
    setRosterLoading(true)
    setTodayRecords([])
    const staffList = await fetchTeamStaffById(team.id)
    setTeamStaff(staffList)
    setTeamLoading(false)
    if (staffList.length > 0) {
      const recs = await fetchStaffAttendanceForDate(staffList.map(s => s.id), today)
      setTodayRecords(recs)
    }
    setRosterLoading(false)
  }, [today])

  const selectTeam = (team: { id: string; name: string }) => {
    setSelectedTeam(team)
    setTeamQuery('')
    setShowTeamDropdown(false)
    setQuery('')
    loadTeam(team)
  }

  const clearTeam = () => {
    setSelectedTeam(null)
    setTeamStaff([])
    setTodayRecords([])
    setQuery('')
  }

  // Refresh team roster when parent signals a change
  useEffect(() => {
    if (refreshKey === 0 || !selectedTeam) return
    fetchStaffAttendanceForDate(teamStaff.map(s => s.id), today).then(setTodayRecords)
  }, [refreshKey, selectedTeam, teamStaff, today])

  const handleSet = async (staffId: string, status: StaffAttendanceStatus) => {
    setSavingId(staffId)
    const ok = await adminMarkStaffAttendance(staffId, today, status, viewerId)
    if (ok) {
      // Refresh roster attendance + school-wide summary
      const [recs, newSummary] = await Promise.all([
        fetchStaffAttendanceForDate(teamStaff.map(s => s.id), today),
        fetchSchoolAttendanceSummary(today),
      ])
      setTodayRecords(recs)
      setSummary(newSummary)
      onChanged?.()
    }
    setSavingId(null)
  }

  const filteredTeams = useMemo(() => {
    const q = teamQuery.trim().toLowerCase()
    return q ? teams.filter(t => t.name.toLowerCase().includes(q)) : teams
  }, [teams, teamQuery])

  const filteredStaff = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? teamStaff.filter(s => s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
      : teamStaff
  }, [teamStaff, query])

  const placeholderLabel = isHolidayToday ? 'Holiday' : pastCutoff ? 'Absent (auto)' : 'Not marked'

  const presentTeamCount = useMemo(
    () => todayRecords.filter(r => isPresentStatus(r.status)).length,
    [todayRecords]
  )

  return (
    <div className="space-y-4">
      {/* School-wide summary card */}
      <div
        className="flex items-center gap-4 p-4 rounded-2xl border"
        style={{ background: 'linear-gradient(135deg, var(--page-primary-light, #ede9fe), var(--page-accent-light, #e0e7ff))', borderColor: 'var(--page-primary-light, #ddd6fe)' }}
      >
        <div className="p-2.5 bg-white rounded-xl shadow-sm flex-shrink-0">
          <UserCheck size={22} style={{ color: 'var(--page-primary, #7c3aed)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-bold text-slate-800 leading-none">
            {summaryLoading ? (
              <span className="inline-flex items-center gap-1.5 text-base text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading…</span>
            ) : (
              <>
                {selectedTeam ? presentTeamCount : summary?.present ?? '—'}
                <span className="text-base font-medium text-slate-400">
                  {' / '}{selectedTeam ? (teamLoading ? '…' : teamStaff.length) : (summary?.total ?? '—')}
                </span>
              </>
            )}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Present today {isHolidayToday ? '(holiday) ' : ''}
            {selectedTeam ? `in "${selectedTeam.name}"` : 'school-wide'}
          </p>
        </div>
        {!summaryLoading && summary && (
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-semibold text-slate-700">
              {selectedTeam ? (teamLoading ? '…' : teamStaff.length) : summary.total}
            </p>
            <p className="text-[11px] text-slate-400 flex items-center gap-1 justify-end"><Users size={11} /> staff</p>
          </div>
        )}
      </div>

      {/* Team search */}
      <div className="relative">
        <UsersRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
        <input
          type="text"
          value={selectedTeam ? selectedTeam.name : teamQuery}
          onChange={e => {
            if (selectedTeam) return
            setTeamQuery(e.target.value)
            setShowTeamDropdown(true)
          }}
          onFocus={() => { if (!selectedTeam) setShowTeamDropdown(true) }}
          placeholder={teamsLoading ? 'Loading teams…' : 'Select a team to view attendance…'}
          readOnly={!!selectedTeam}
          className={`w-full pl-9 pr-9 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 bg-white transition-colors ${
            selectedTeam ? 'border-violet-300 text-violet-700 bg-violet-50 cursor-default' : 'border-slate-200'
          }`}
        />
        {selectedTeam ? (
          <button onClick={clearTeam} className="absolute right-3 top-1/2 -translate-y-1/2 text-violet-500 hover:text-violet-700 p-1 z-10">
            <X size={14} />
          </button>
        ) : teamQuery ? (
          <button onClick={() => { setTeamQuery(''); setShowTeamDropdown(false) }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 z-10">
            <X size={14} />
          </button>
        ) : (
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
        )}

        {/* Team dropdown */}
        {showTeamDropdown && !selectedTeam && (
          <div className="absolute z-20 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            {teamsLoading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin" /> Loading teams…
              </div>
            ) : filteredTeams.length === 0 ? (
              <div className="py-3 text-center text-sm text-slate-400">No teams found</div>
            ) : (
              <div className="max-h-52 overflow-y-auto py-1">
                {filteredTeams.map(team => (
                  <button
                    key={team.id}
                    onClick={() => selectTeam(team)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-violet-50 text-left transition-colors"
                  >
                    <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                      <UsersRound size={13} className="text-violet-600" />
                    </div>
                    <span className="text-sm font-semibold text-slate-800 flex-1 truncate">{team.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* No team selected — prompt */}
      {!selectedTeam && (
        <div className="py-10 text-center px-4">
          <UsersRound size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-400">Select a team above</p>
          <p className="text-xs text-slate-300 mt-1">The roster will appear here once you choose a team.</p>
        </div>
      )}

      {/* Team selected — staff name search + roster */}
      {selectedTeam && (
        <>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`Search within "${selectedTeam.name}"…`}
              className="w-full pl-9 pr-9 py-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 bg-white"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1">
                <X size={14} />
              </button>
            )}
          </div>

          <StaffRoster
            staffList={filteredStaff}
            todayRecords={todayRecords}
            loading={rosterLoading}
            savingId={savingId}
            placeholderLabel={placeholderLabel}
            emptyMessage={query ? `No staff match "${query}"` : `No staff in "${selectedTeam.name}"`}
            onSet={handleSet}
          />
        </>
      )}
    </div>
  )
}

// ─── Shared roster list ────────────────────────────────────────────────────────

function StaffRoster({
  staffList, todayRecords, loading, savingId, placeholderLabel, emptyMessage, onSet,
}: {
  staffList: UserProfile[]
  todayRecords: StaffAttendanceRecord[]
  loading: boolean
  savingId: string | null
  placeholderLabel: string
  emptyMessage: string
  onSet: (staffId: string, status: StaffAttendanceStatus) => void
}) {
  const recordByStaff = useMemo(() => {
    const m = new Map<string, StaffAttendanceRecord>()
    for (const r of todayRecords) m.set(r.staff_id, r)
    return m
  }, [todayRecords])

  if (loading) {
    return (
      <div className="py-10 flex items-center justify-center gap-2 text-slate-400 text-sm">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }

  if (staffList.length === 0) {
    return (
      <div className="py-10 text-center">
        <Users size={30} className="text-slate-200 mx-auto mb-2" />
        <p className="text-sm text-slate-400">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-50">
      {staffList.map(s => {
        const rec = recordByStaff.get(s.id)
        const isSaving = savingId === s.id
        return (
          <div key={s.id} className="px-3 pt-3 pb-2.5 space-y-2.5">
            <div className="flex items-center gap-3">
              <Avatar avatarUrl={s.avatar_url ?? null} name={s.full_name} email={s.email} size={38} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800 truncate">{s.full_name}</p>
                  {isSaving && <Loader2 size={12} className="animate-spin text-violet-500 flex-shrink-0" />}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${ROLE_BADGE[s.role] ?? 'bg-slate-100 text-slate-600'}`}>
                    {s.role}
                  </span>
                  {rec?.check_in_time && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                      <Clock size={9} /> {formatTime(rec.check_in_time)}
                    </span>
                  )}
                  {rec?.check_out_time && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                      → {formatTime(rec.check_out_time)}
                    </span>
                  )}
                </div>
              </div>
              {rec ? (
                <span className={`text-[11px] px-2 py-1 rounded-full font-medium border flex-shrink-0 ${STAFF_ATTENDANCE_STATUS_COLORS[rec.status]}`}>
                  {STAFF_ATTENDANCE_STATUS_LABELS[rec.status]}
                </span>
              ) : (
                <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-400 border border-slate-200 flex-shrink-0">
                  {placeholderLabel}
                </span>
              )}
            </div>

            {/* Status selector */}
            <div
              className="flex gap-1.5 overflow-x-auto pl-[50px]"
              style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
            >
              {STATUS_OPTIONS.map(st => (
                <button
                  key={st}
                  disabled={isSaving}
                  onClick={() => onSet(s.id, st)}
                  className={`flex-shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40 active:scale-95 ${
                    rec?.status === st
                      ? STAFF_ATTENDANCE_STATUS_COLORS[st]
                      : 'border-slate-200 text-slate-500 bg-white hover:bg-slate-50 active:bg-slate-100'
                  }`}
                >
                  {STAFF_ATTENDANCE_STATUS_LABELS[st]}
                </button>
              ))}
              <div className="w-2 flex-shrink-0" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Public export ─────────────────────────────────────────────────────────────

export default function AdminAttendancePanel({ viewerId, viewerRole, staff, refreshKey = 0, onChanged }: Props) {
  if (viewerRole === 'coordinator') {
    return <CoordinatorPanel viewerId={viewerId} staff={staff} refreshKey={refreshKey} onChanged={onChanged} />
  }
  return <AdminPanel viewerId={viewerId} refreshKey={refreshKey} onChanged={onChanged} />
}
