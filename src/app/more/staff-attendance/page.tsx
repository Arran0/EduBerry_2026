'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { UserCheck, Users, CalendarDays, ChevronDown, Search, User, Eye, X, AlertCircle, Clock, MinusCircle, Plane } from 'lucide-react'
import { STAFF_ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import StaffCheckIn from '@/components/attendance/StaffCheckIn'
import StaffAttendanceCalendar from '@/components/attendance/StaffAttendanceCalendar'
import AdminAttendancePanel from '@/components/attendance/AdminAttendancePanel'
import TeamMemberSelector from '@/components/tasks/TeamMemberSelector'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import { fetchTeamMembers } from '@/lib/tasks'
import { fetchTeamsForDropdown, fetchTeamStaffById } from '@/lib/teams'
import {
  fetchGeofenceConfig,
  fetchAttendanceConfig,
  fetchMyExemption,
  searchStaff,
  fetchStaffAbsenteesByDate,
  StaffAttendanceRecord,
  STAFF_ATTENDANCE_STATUS_LABELS,
  GeofenceConfig,
} from '@/lib/attendance'
import { LeaveApplicationWithDetails } from '@/lib/leave'

// ─── Admin/Principal staff search picker ──────────────────────────────────────

function AdminStaffPicker({
  value, currentUserId, currentUserName,
  onSelect,
}: {
  value: string
  currentUserId: string
  currentUserName: string
  onSelect: (userId: string, name?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; full_name: string; role: string }[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const viewingSelf = value === currentUserId

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (query.trim().length < 2) { setResults([]); return }
    timer.current = setTimeout(async () => {
      const data = await searchStaff(query)
      setResults(data)
    }, 280)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query])

  const handleSelect = (id: string, name?: string) => {
    onSelect(id, name)
    setSelectedName(id === currentUserId ? null : (name ?? null))
    setOpen(false)
    setQuery('')
    setResults([])
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 px-4 py-1.5 rounded-xl border transition-all shadow-sm text-sm font-medium focus:outline-none ${
          viewingSelf
            ? 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
            : 'bg-indigo-500 border-indigo-500 text-white hover:bg-indigo-600'
        }`}
      >
        {viewingSelf ? <User size={14} className="flex-shrink-0 opacity-60" /> : <Eye size={14} className="flex-shrink-0 opacity-80" />}
        <span className="font-semibold truncate max-w-[130px]">
          {viewingSelf ? currentUserName : (selectedName || 'Staff')}
        </span>
        <ChevronDown size={12} className={`flex-shrink-0 transition-transform opacity-50 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-white rounded-2xl shadow-xl border border-slate-100 w-64">
          <div className="px-2 pt-2 pb-1">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 rounded-xl border border-slate-200 focus-within:border-indigo-300 transition-colors">
              <Search size={12} className="text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search staff by name…"
                className="flex-1 text-xs bg-transparent focus:outline-none text-slate-700 placeholder-slate-400 min-w-0"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="text-slate-300 hover:text-slate-500">
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
          <div className="py-1 max-h-56 overflow-y-auto">
            {/* View self */}
            <button
              type="button"
              onClick={() => handleSelect(currentUserId)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${
                viewingSelf ? 'text-indigo-600 font-semibold' : 'text-slate-700'
              }`}
            >
              <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                <User size={11} className="text-slate-500" />
              </span>
              <span className="truncate">{currentUserName || 'You'}</span>
              {viewingSelf && (
                <span className="ml-auto text-[9px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-medium">You</span>
              )}
            </button>

            {query.trim().length < 2 && (
              <p className="px-3 py-2 text-xs text-slate-400 text-center">Type a name to search…</p>
            )}

            {query.trim().length >= 2 && results.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400 text-center">No staff found</p>
            )}

            {results.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleSelect(r.id, r.full_name)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${
                  value === r.id ? 'text-indigo-600 font-semibold' : 'text-slate-700'
                }`}
              >
                <span className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-indigo-600">
                  {(r.full_name || '?').charAt(0).toUpperCase()}
                </span>
                <span className="truncate flex-1">{r.full_name}</span>
                <span className="text-[10px] text-slate-400 flex-shrink-0 capitalize">{r.role}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Staff Absentee Section (managers only) ───────────────────────────────────

const STATUS_ICON: Record<string, React.ReactNode> = {
  absent:   <AlertCircle size={13} className="text-red-500" />,
  late:     <Clock size={13} className="text-amber-500" />,
  half_day: <MinusCircle size={13} className="text-orange-500" />,
  on_leave: <Plane size={13} className="text-blue-500" />,
}

const STATUS_PILL: Record<string, string> = {
  absent:   'bg-red-50 text-red-700 border-red-200',
  late:     'bg-amber-50 text-amber-700 border-amber-200',
  half_day: 'bg-orange-50 text-orange-700 border-orange-200',
  on_leave: 'bg-blue-50 text-blue-700 border-blue-200',
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function dateLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today'
  if (dateStr === shiftDate(todayStr, -1)) return 'Yesterday'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StaffAbsenteeSection({ refreshKey }: { refreshKey: number }) {
  const todayStr = new Date().toISOString().split('T')[0]
  const [date, setDate] = useState(todayStr)
  const [records, setRecords] = useState<StaffAttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Team smart search
  const [allTeams, setAllTeams] = useState<{ id: string; name: string }[]>([])
  const [teamQuery, setTeamQuery] = useState('')
  const [showTeamDrop, setShowTeamDrop] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<{ id: string; name: string } | null>(null)
  const [teamMemberIds, setTeamMemberIds] = useState<Set<string> | null>(null)
  const teamRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fetchTeamsForDropdown().then(setAllTeams) }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (teamRef.current && !teamRef.current.contains(e.target as Node)) setShowTeamDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!selectedTeam) { setTeamMemberIds(null); return }
    fetchTeamStaffById(selectedTeam.id).then(members => {
      setTeamMemberIds(new Set(members.map(m => m.id)))
    })
  }, [selectedTeam])

  useEffect(() => {
    setLoading(true)
    fetchStaffAbsenteesByDate(date).then(data => { setRecords(data); setLoading(false) })
  }, [date, refreshKey])

  const filteredTeams = teamQuery.trim()
    ? allTeams.filter(t => t.name.toLowerCase().includes(teamQuery.toLowerCase()))
    : allTeams

  const filtered = teamMemberIds
    ? records.filter(r => teamMemberIds.has(r.staff_id))
    : records

  const grouped = {
    absent:   [] as StaffAttendanceRecord[],
    late:     [] as StaffAttendanceRecord[],
    half_day: [] as StaffAttendanceRecord[],
    on_leave: [] as StaffAttendanceRecord[],
  }
  for (const r of filtered) {
    if (r.status in grouped) grouped[r.status as keyof typeof grouped].push(r)
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <AlertCircle size={15} style={{ color: 'var(--page-primary)' }} />
              Absentees &amp; Exceptions
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Staff with non-present status</p>
          </div>

          {/* Date navigator */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-1 py-1">
            <button
              onClick={() => setDate(d => shiftDate(d, -1))}
              className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white hover:shadow-sm text-slate-500 transition-all"
            >
              <ChevronDown size={13} className="rotate-90" />
            </button>
            <span className="text-xs font-semibold text-slate-700 px-1.5 min-w-[72px] text-center">
              {dateLabel(date, todayStr)}
            </span>
            <button
              onClick={() => setDate(d => shiftDate(d, 1))}
              disabled={date >= todayStr}
              className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white hover:shadow-sm text-slate-500 transition-all disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronDown size={13} className="-rotate-90" />
            </button>
          </div>
        </div>

        {/* Team smart search */}
        <div className="mt-3 relative" ref={teamRef}>
          <div className={`flex items-center gap-2 border rounded-xl px-3 py-2 bg-white transition-colors ${
            selectedTeam ? 'border-violet-300 bg-violet-50' : 'border-slate-200'
          }`}>
            <Search size={13} className={selectedTeam ? 'text-violet-400' : 'text-slate-400'} />
            <input
              type="text"
              value={selectedTeam ? selectedTeam.name : teamQuery}
              readOnly={!!selectedTeam}
              onChange={e => { if (!selectedTeam) { setTeamQuery(e.target.value); setShowTeamDrop(true) } }}
              onFocus={() => { if (!selectedTeam) setShowTeamDrop(true) }}
              placeholder="Filter by team…"
              className={`flex-1 text-xs bg-transparent focus:outline-none placeholder:text-slate-400 ${selectedTeam ? 'text-violet-700 font-medium cursor-default' : 'text-slate-700'}`}
            />
            {selectedTeam ? (
              <button onClick={() => { setSelectedTeam(null); setTeamQuery(''); setShowTeamDrop(false) }} className="text-violet-400 hover:text-violet-600">
                <X size={13} />
              </button>
            ) : teamQuery ? (
              <button onClick={() => { setTeamQuery(''); setShowTeamDrop(false) }} className="text-slate-400 hover:text-slate-600">
                <X size={13} />
              </button>
            ) : null}
          </div>

          {showTeamDrop && !selectedTeam && (
            <div className="absolute z-20 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
              {filteredTeams.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-3">No teams found</p>
              ) : (
                <div className="max-h-44 overflow-y-auto py-1">
                  {filteredTeams.map(t => (
                    <button key={t.id} type="button"
                      onClick={() => { setSelectedTeam(t); setTeamQuery(''); setShowTeamDrop(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-violet-50 text-left transition-colors"
                    >
                      <div className="w-6 h-6 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                        <Users size={11} className="text-violet-600" />
                      </div>
                      <span className="text-sm text-slate-800 truncate">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* List */}
      <div className="p-5">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-slate-400 text-sm">
            <div className="spinner" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center">
            <Users size={28} className="text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400">
              {selectedTeam ? `No exceptions in "${selectedTeam.name}"` : 'All staff are present'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {(['absent', 'late', 'half_day', 'on_leave'] as const).map(status => {
              const group = grouped[status]
              if (group.length === 0) return null
              return (
                <div key={status}>
                  <div className="flex items-center gap-1.5 mb-2">
                    {STATUS_ICON[status]}
                    <span className="text-xs font-semibold text-slate-600">{STAFF_ATTENDANCE_STATUS_LABELS[status]}</span>
                    <span className="text-xs text-slate-400">({group.length})</span>
                  </div>
                  <div className="rounded-xl border border-slate-100 overflow-hidden divide-y divide-slate-50">
                    {group.map(r => (
                      <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-slate-50/60 transition-colors">
                        <Avatar avatarUrl={r.staff?.avatar_url ?? null} name={r.staff?.full_name} email={r.staff?.email} size={32} userId={r.staff_id} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate leading-tight">{r.staff?.full_name ?? '—'}</p>
                          <p className="text-[10px] text-slate-400 capitalize">{r.staff?.role}</p>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_PILL[status]}`}>
                          {STAFF_ATTENDANCE_STATUS_LABELS[status]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StaffAttendancePage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const isAdmin = profile?.role === 'admin'
  const isPrincipal = profile?.role === 'principal'
  const isCoordinator = profile?.role === 'coordinator'
  const isManager = isAdmin || isPrincipal || isCoordinator

  const [geofenceConfig, setGeofenceConfig] = useState<GeofenceConfig | null>(null)
  const [lateCutoff, setLateCutoff] = useState<string | null>(null)
  const [checkoutCutoff, setCheckoutCutoff] = useState<string | null>(null)
  const [exempt, setExempt] = useState(false)
  const [scopeStaff, setScopeStaff] = useState<UserProfile[]>([])
  const [viewingUserId, setViewingUserId] = useState<string>('')
  const [viewingStaffName, setViewingStaffName] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!user) return
    setViewingUserId(user.id)
    fetchGeofenceConfig().then(cfg => setGeofenceConfig(cfg))
    fetchAttendanceConfig().then(cfg => {
      setLateCutoff(cfg.late_cutoff)
      setCheckoutCutoff(cfg.checkout_cutoff)
    })
    fetchMyExemption(user.id).then(setExempt)
  }, [user])

  const loadScope = useCallback(async () => {
    if (!user || !profile || !isCoordinator) return
    const list = await fetchTeamMembers(user.id, 'coordinator')
    setScopeStaff(list)
  }, [user, profile, isCoordinator])

  useEffect(() => { loadScope() }, [loadScope])

  const bumpRefresh = () => setRefreshKey(k => k + 1)

  const openNewLeave = (date: string) => router.push(`/more/staff-leave?new=1&date=${date}`)
  const openLeaveApp = (app: LeaveApplicationWithDetails) => router.push(`/more/staff-leave?app=${app.id}`)

  if (!user || !profile) return null

  const selectorMembers = scopeStaff.filter(s => s.id !== user.id)
  const viewingSelf = viewingUserId === user.id
  const viewingCoordMember = selectorMembers.find(s => s.id === viewingUserId)
  const calendarStaffName = viewingSelf
    ? undefined
    : (viewingCoordMember?.full_name ?? viewingStaffName ?? undefined)

  const handleAdminSelect = (id: string, name?: string) => {
    setViewingUserId(id)
    setViewingStaffName(id === user.id ? null : (name ?? null))
  }

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="staff-attendance">
      <PageBanner
        settingKey="staff_attendance_banner"
        defaultBanner={STAFF_ATTENDANCE_BANNER_DEFAULT}
        icon={<UserCheck size={24} className="text-white" />}
        backgroundIcon={<UserCheck size={180} className="text-white" />}
        title="Staff Attendance"
        subtitle="Check in for today and view attendance history"
        isAdmin={isAdmin}
      />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Today's Check-In */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-50">
            <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <UserCheck size={15} style={{ color: 'var(--page-primary)' }} />
              Today&apos;s Check-In
            </h2>
          </div>
          <div className="p-5">
            <StaffCheckIn
              staffId={user.id}
              geofenceConfig={geofenceConfig}
              lateCutoff={lateCutoff}
              checkoutCutoff={checkoutCutoff}
              exempt={exempt}
              onCheckedIn={bumpRefresh}
            />
          </div>
        </section>

        {/* Attendance Calendar */}
        <section>
          <div className="flex items-center justify-between gap-3 mb-3 px-1">
            <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <CalendarDays size={15} style={{ color: 'var(--page-primary)' }} />
              Attendance Calendar
            </h2>
            {/* Coordinator: toggle between own and team members */}
            {isCoordinator && selectorMembers.length > 0 && (
              <TeamMemberSelector
                members={selectorMembers}
                selectedUserId={viewingUserId || user.id}
                currentUserId={user.id}
                currentUserName={profile.full_name}
                selfLabel={profile.full_name}
                onSelect={id => { setViewingUserId(id); setViewingStaffName(null) }}
              />
            )}
            {/* Admin/Principal: search any staff */}
            {(isAdmin || isPrincipal) && (
              <AdminStaffPicker
                value={viewingUserId || user.id}
                currentUserId={user.id}
                currentUserName={profile.full_name}
                onSelect={handleAdminSelect}
              />
            )}
          </div>
          <StaffAttendanceCalendar
            key={viewingUserId}
            staffId={viewingUserId || user.id}
            staffName={calendarStaffName}
            mode={viewingSelf ? 'self' : 'admin'}
            markerId={user.id}
            refreshKey={refreshKey}
            onApplyLeave={viewingSelf ? openNewLeave : undefined}
            onViewLeave={openLeaveApp}
            onChanged={bumpRefresh}
          />
        </section>

        {/* Team / All-staff summary — managers only */}
        {isManager && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-50">
              <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Users size={15} style={{ color: 'var(--page-primary)' }} />
                {isCoordinator ? 'My Team Attendance' : 'All Staff Attendance'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isCoordinator ? "Adjust a teacher's status for today." : "Adjust any staff member's status for today."}
              </p>
            </div>
            <div className="p-5">
              <AdminAttendancePanel
                viewerId={user.id}
                viewerRole={isCoordinator ? 'coordinator' : isPrincipal ? 'principal' : 'admin'}
                staff={scopeStaff}
                refreshKey={refreshKey}
                onChanged={bumpRefresh}
              />
            </div>
          </section>
        )}

        {/* Absentee list — managers only */}
        {isManager && <StaffAbsenteeSection refreshKey={refreshKey} />}
      </div>
      </div>
    </ProtectedLayout>
  )
}
