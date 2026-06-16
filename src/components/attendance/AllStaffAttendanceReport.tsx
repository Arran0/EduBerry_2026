'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Avatar from '@/components/Avatar'
import {
  Search, Users, X, Clock, Loader2, AlertCircle, CalendarCheck2, CircleSlash,
} from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  STAFF_ATTENDANCE_STATUS_LABELS,
  fetchStaffAttendanceReportByDate,
  fetchTrackedStaffCount,
  adminMarkStaffAttendance,
} from '@/lib/attendance'
import { fetchTeamsForDropdown, fetchTeamStaffById } from '@/lib/teams'
import { DateToggler, SmartSelect, SECTION_LABEL } from '@/components/workspace/ui'
import type { SmartOption } from '@/components/workspace/ui'

interface Props {
  viewerId: string
  viewerRole: 'admin' | 'principal' | 'coordinator' | 'teacher'
  /** Coordinators / teachers pass their pre-loaded team roster; the team picker is then hidden. */
  fixedStaff?: UserProfile[]
  /** When false, status buttons are hidden (read-only view). Defaults to true. */
  canEdit?: boolean
  refreshKey?: number
  onChanged?: () => void
}

const EXCEPTION_ORDER: StaffAttendanceStatus[] = ['absent', 'late', 'half_day', 'on_leave']
const PRESENT_STATUSES_SET = new Set<StaffAttendanceStatus>(['present', 'wfh'])

const STATUS_PILL: Record<StaffAttendanceStatus, string> = {
  present:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  absent:   'bg-red-50 text-red-700 border-red-200',
  late:     'bg-amber-50 text-amber-700 border-amber-200',
  half_day: 'bg-orange-50 text-orange-700 border-orange-200',
  wfh:      'bg-cyan-50 text-cyan-700 border-cyan-200',
  on_leave: 'bg-blue-50 text-blue-700 border-blue-200',
}

const QUICK_SET: StaffAttendanceStatus[] = ['present', 'absent', 'late', 'half_day']
const QUICK_SHORT: Record<StaffAttendanceStatus, string> = {
  present: 'P', absent: 'A', late: 'L', half_day: '½', wfh: 'WFH', on_leave: 'OL',
}
const QUICK_ACTIVE: Record<StaffAttendanceStatus, string> = {
  present:  'bg-emerald-600 text-white border-emerald-600',
  absent:   'bg-red-600 text-white border-red-600',
  late:     'bg-amber-500 text-white border-amber-500',
  half_day: 'bg-orange-500 text-white border-orange-500',
  wfh:      'bg-cyan-600 text-white border-cyan-600',
  on_leave: 'bg-blue-600 text-white border-blue-600',
}

const ROLE_BADGE: Record<string, string> = {
  teacher:     'bg-[#F5F5F5] text-[#52525B]',
  coordinator: 'bg-[#EDE9E2] text-[#8a6d1f]',
  principal:   'bg-[#F5F5F5] text-[#52525B]',
}

const PAGE_SIZE = 24

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ── Single staff row ──────────────────────────────────────────────────────────

function StaffRow({
  staff, record, savingId, canEdit, onSet,
}: {
  staff: UserProfile
  record?: StaffAttendanceRecord
  savingId: string | null
  canEdit: boolean
  onSet: (staffId: string, status: StaffAttendanceStatus) => void
}) {
  const isSaving = savingId === staff.id
  return (
    <div className="flex items-center gap-3 px-3 sm:px-4 py-2.5 bg-white hover:bg-[#FAFAF9] transition-colors">
      <Avatar avatarUrl={staff.avatar_url ?? null} name={staff.full_name} email={staff.email} size={34} userId={staff.id} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-semibold text-[#18181B] truncate leading-tight">{staff.full_name}</p>
          {isSaving && <Loader2 size={11} className="animate-spin text-[#B8983C] flex-shrink-0" />}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 font-medium capitalize rounded ${ROLE_BADGE[staff.role] ?? 'bg-[#F5F5F5] text-[#52525B]'}`}>
            {staff.role}
          </span>
          {record?.check_in_time && (
            <span className="text-[10px] text-[#A1A1AA] flex items-center gap-0.5">
              <Clock size={9} /> {formatTime(record.check_in_time)}
              {record.check_out_time && <> → {formatTime(record.check_out_time)}</>}
            </span>
          )}
        </div>
      </div>

      {/* Current status pill — always visible when read-only, hidden on narrow screens when edit buttons are shown */}
      {record && (
        <span className={`${canEdit ? 'hidden sm:inline-block' : 'inline-block'} text-[10px] font-semibold px-2 py-0.5 border rounded-full ${STATUS_PILL[record.status]}`}>
          {STAFF_ATTENDANCE_STATUS_LABELS[record.status]}
        </span>
      )}

      {/* Quick-set buttons — only shown to admin/principal */}
      {canEdit && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {QUICK_SET.map(st => (
            <button
              key={st}
              disabled={isSaving}
              onClick={() => onSet(staff.id, st)}
              title={STAFF_ATTENDANCE_STATUS_LABELS[st]}
              className={`w-7 h-7 text-xs font-bold border rounded-md transition-colors disabled:opacity-40 active:scale-95 flex items-center justify-center ${
                record?.status === st
                  ? QUICK_ACTIVE[st]
                  : 'border-[#D4D4D8] text-[#A1A1AA] bg-white hover:bg-[#F5F5F5] hover:text-[#18181B]'
              }`}
            >
              {QUICK_SHORT[st]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RowList({ children }: { children: React.ReactNode }) {
  return <div className="border border-[#E4E4E7] divide-y divide-[#F0F0EF] rounded-lg overflow-hidden">{children}</div>
}

// ── Report ──────────────────────────────────────────────────────────────────

export default function AllStaffAttendanceReport({
  viewerId, viewerRole, fixedStaff, canEdit = true, refreshKey = 0, onChanged,
}: Props) {
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])
  const [date, setDate] = useState(todayStr)

  // Use a fixed roster when the viewer is a coordinator or teacher
  const hasFixedRoster = viewerRole === 'coordinator' || viewerRole === 'teacher'

  const [records, setRecords] = useState<StaffAttendanceRecord[]>([])
  const [trackedTotal, setTrackedTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  // Team targeting (admin / principal only)
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [teamRoster, setTeamRoster] = useState<UserProfile[]>([])
  const [teamLoading, setTeamLoading] = useState(false)

  // Present-list controls
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(PAGE_SIZE)

  const teamCacheRef = useRef<Map<string, UserProfile[]>>(new Map())

  useEffect(() => {
    if (hasFixedRoster) return
    fetchTeamsForDropdown().then(setTeams)
    fetchTrackedStaffCount().then(setTrackedTotal)
  }, [hasFixedRoster])

  // Load the day's records (one indexed query, admins already excluded).
  const loadRecords = useCallback(async () => {
    setLoading(true)
    const recs = await fetchStaffAttendanceReportByDate(date)
    setRecords(recs)
    setLoading(false)
  }, [date])

  useEffect(() => { loadRecords() }, [loadRecords, refreshKey])

  // Resolve the active roster (team for admins, fixed list for coordinators/teachers).
  useEffect(() => {
    if (hasFixedRoster) return
    if (!selectedTeamId) { setTeamRoster([]); return }
    const cached = teamCacheRef.current.get(selectedTeamId)
    if (cached) { setTeamRoster(cached); return }
    setTeamLoading(true)
    fetchTeamStaffById(selectedTeamId).then(members => {
      const trackable = members.filter(m => m.role !== 'admin')
      teamCacheRef.current.set(selectedTeamId, trackable)
      setTeamRoster(trackable)
      setTeamLoading(false)
    })
  }, [selectedTeamId, hasFixedRoster])

  // Reset the present-list paging whenever the scope changes.
  useEffect(() => { setPageSize(PAGE_SIZE); setQuery('') }, [date, selectedTeamId])

  const roster: UserProfile[] | null = useMemo(
    () => (hasFixedRoster
      ? (fixedStaff ?? []).filter(s => s.role !== 'admin')
      : (selectedTeamId ? teamRoster : null)),
    [hasFixedRoster, fixedStaff, selectedTeamId, teamRoster]
  )

  const rosterIds = useMemo(
    () => (roster ? new Set(roster.map(s => s.id)) : null),
    [roster]
  )

  const recordByStaff = useMemo(() => {
    const m = new Map<string, StaffAttendanceRecord>()
    for (const r of records) m.set(r.staff_id, r)
    return m
  }, [records])

  // Records in scope (filtered to the roster when one is active).
  const scopedRecords = useMemo(
    () => (rosterIds ? records.filter(r => rosterIds.has(r.staff_id)) : records),
    [records, rosterIds]
  )

  const exceptions = useMemo(() => {
    const groups: Record<StaffAttendanceStatus, StaffAttendanceRecord[]> = {
      absent: [], late: [], half_day: [], on_leave: [], present: [], wfh: [],
    }
    for (const r of scopedRecords) {
      if (!PRESENT_STATUSES_SET.has(r.status)) groups[r.status]?.push(r)
    }
    return groups
  }, [scopedRecords])

  const exceptionCount = EXCEPTION_ORDER.reduce((n, s) => n + exceptions[s].length, 0)

  const presentRecords = useMemo(
    () => scopedRecords.filter(r => PRESENT_STATUSES_SET.has(r.status)),
    [scopedRecords]
  )

  // Staff in the roster who have no record yet (only computable with a roster).
  const notMarked = useMemo(() => {
    if (!roster) return []
    return roster.filter(s => !recordByStaff.has(s.id))
  }, [roster, recordByStaff])

  const presentTotal = roster ? roster.length : (trackedTotal ?? 0)
  const presentCount = presentRecords.length

  // Build the present list (sorted by name), filtered by the search box & paged.
  const presentList = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = presentRecords
      .map(r => ({ staff: r.staff as UserProfile, record: r }))
      .filter(x => x.staff)
    if (q) rows = rows.filter(x => x.staff.full_name?.toLowerCase().includes(q) || x.staff.email?.toLowerCase().includes(q))
    rows.sort((a, b) => (a.staff.full_name ?? '').localeCompare(b.staff.full_name ?? ''))
    return rows
  }, [presentRecords, query])

  const visiblePresent = presentList.slice(0, pageSize)

  const notMarkedList = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = notMarked
    if (q) rows = rows.filter(s => s.full_name?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q))
    return [...rows].sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''))
  }, [notMarked, query])

  const handleSet = async (staffId: string, status: StaffAttendanceStatus) => {
    setSavingId(staffId)
    const ok = await adminMarkStaffAttendance(staffId, date, status, viewerId)
    if (ok) {
      await loadRecords()
      if (!hasFixedRoster) fetchTrackedStaffCount().then(setTrackedTotal)
      onChanged?.()
    }
    setSavingId(null)
  }

  const teamOptions: SmartOption[] = useMemo(
    () => teams.map(t => ({ value: t.id, label: t.name })),
    [teams]
  )

  const scopeLabel = hasFixedRoster
    ? 'your team'
    : selectedTeamId
      ? (teams.find(t => t.id === selectedTeamId)?.name ?? 'team')
      : 'school-wide'

  const pct = presentTotal > 0 ? Math.round((presentCount / presentTotal) * 100) : 0

  return (
    <section className="border border-[#D4D4D8] bg-white rounded-xl overflow-hidden lg:flex lg:flex-col lg:h-full">
      {/* Toolbar */}
      <div className="border-b border-[#E4E4E7] bg-[#FAFAF9] px-3 sm:px-4 py-3 space-y-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#18181B]">
            <Users size={15} className="text-[#B8983C]" />
            {hasFixedRoster ? 'Team Attendance Report' : 'All Staff Attendance Report'}
          </h2>
          <p className="text-xs text-[#71717A] mt-0.5">
            Exceptions first, then everyone present — {scopeLabel}.
          </p>
        </div>
        {/* Date + team controls: stacked on mobile, side-by-side on larger screens */}
        <div className="flex flex-col gap-2 sm:flex-row">
          {!hasFixedRoster && (
            <SmartSelect
              options={teamOptions}
              value={selectedTeamId}
              onChange={setSelectedTeamId}
              allowClear
              placeholder="All teams"
              searchPlaceholder="Search teams…"
              emptyText="No teams"
              className="flex-1"
              leadingIcon={<Users size={14} className="text-[#71717A] flex-shrink-0" />}
            />
          )}
          <DateToggler
            value={date}
            onChange={setDate}
            max={todayStr}
            todayStr={todayStr}
            className={`flex${hasFixedRoster ? ' w-full' : ' flex-1'}`}
          />
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-[#E4E4E7]">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-[#18181B] leading-none">
            {loading || teamLoading ? '—' : presentCount}
          </span>
          <span className="text-sm font-medium text-[#A1A1AA]">
            / {(!hasFixedRoster && !selectedTeamId && trackedTotal === null) || teamLoading ? '…' : presentTotal}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="h-1.5 bg-[#F0F0EF] rounded-full overflow-hidden">
            <div className="h-full bg-[#B8983C] rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-[#71717A] mt-1">
            {pct}% present · {exceptionCount} exception{exceptionCount === 1 ? '' : 's'}
            {roster && notMarked.length > 0 ? ` · ${notMarked.length} not marked` : ''}
          </p>
        </div>
      </div>

      {/* Scrollable content — on desktop this fills the remaining height */}
      <div className="p-3 sm:p-4 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
        {loading || teamLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#A1A1AA]">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-5">
            {/* ── Exceptions (top) ─────────────────────────────── */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <AlertCircle size={13} className="text-red-500" />
                <p className={SECTION_LABEL}>Absentees &amp; Exceptions</p>
                <span className="text-xs text-[#A1A1AA]">({exceptionCount})</span>
              </div>
              {exceptionCount === 0 ? (
                <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                  No absentees or exceptions {scopeLabel === 'school-wide' ? 'recorded' : `in ${scopeLabel}`} for this day.
                </p>
              ) : (
                <div className="space-y-3">
                  {EXCEPTION_ORDER.map(status => {
                    const group = exceptions[status]
                    if (group.length === 0) return null
                    return (
                      <div key={status}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 border rounded-full ${STATUS_PILL[status]}`}>
                            {STAFF_ATTENDANCE_STATUS_LABELS[status]}
                          </span>
                          <span className="text-[11px] text-[#A1A1AA]">{group.length}</span>
                        </div>
                        <RowList>
                          {group
                            .filter(r => r.staff)
                            .sort((a, b) => (a.staff!.full_name ?? '').localeCompare(b.staff!.full_name ?? ''))
                            .map(r => (
                              <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} onSet={handleSet} />
                            ))}
                        </RowList>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Present (below) ──────────────────────────────── */}
            <div className="border-t border-[#E4E4E7] pt-4">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-1.5">
                  <CalendarCheck2 size={13} className="text-emerald-600" />
                  <p className={SECTION_LABEL}>Present Staff</p>
                  <span className="text-xs text-[#A1A1AA]">({presentList.length})</span>
                </div>
                <div className="relative w-40 sm:w-56">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
                  <input
                    value={query}
                    onChange={e => { setQuery(e.target.value); setPageSize(PAGE_SIZE) }}
                    placeholder="Search staff…"
                    className="w-full pl-8 pr-7 py-1.5 text-sm border border-[#D4D4D8] bg-white focus:outline-none focus:border-[#27272A] rounded-md"
                  />
                  {query && (
                    <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#A1A1AA] hover:text-[#18181B]">
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>

              {!hasFixedRoster && !selectedTeamId && (
                <p className="text-[11px] text-[#A1A1AA] mb-2">
                  Showing everyone who checked in. Pick a team above to narrow the list.
                </p>
              )}

              {presentList.length === 0 ? (
                <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                  {query ? `No present staff match "${query}".` : 'No one has checked in yet.'}
                </p>
              ) : (
                <>
                  <RowList>
                    {visiblePresent.map(({ staff, record }) => (
                      <StaffRow key={record.id} staff={staff} record={record} savingId={savingId} canEdit={canEdit} onSet={handleSet} />
                    ))}
                  </RowList>
                  {presentList.length > pageSize && (
                    <button
                      onClick={() => setPageSize(s => s + PAGE_SIZE)}
                      className="mt-2 w-full py-2 text-sm font-medium text-[#18181B] bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors rounded-md"
                    >
                      Show more ({presentList.length - pageSize} remaining)
                    </button>
                  )}
                </>
              )}
            </div>

            {/* ── Not marked (only when a roster is known) ─────── */}
            {roster && notMarkedList.length > 0 && (
              <div className="border-t border-[#E4E4E7] pt-4">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <CircleSlash size={13} className="text-[#A1A1AA]" />
                  <p className={SECTION_LABEL}>Not Marked</p>
                  <span className="text-xs text-[#A1A1AA]">({notMarkedList.length})</span>
                </div>
                <RowList>
                  {notMarkedList.map(s => (
                    <StaffRow key={s.id} staff={s} savingId={savingId} canEdit={canEdit} onSet={handleSet} />
                  ))}
                </RowList>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
