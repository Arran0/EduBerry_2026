'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Avatar from '@/components/Avatar'
import {
  Search, Users, X, Clock, Loader2, AlertCircle, CalendarCheck2, CircleSlash,
  Umbrella, Plus, Check,
} from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  Holiday,
  STAFF_ATTENDANCE_STATUS_LABELS,
  fetchStaffAttendanceReportByDate,
  fetchTrackedStaffCount,
  adminMarkStaffAttendance,
  fetchStaffAbsenceStreaks,
  fetchHolidayByDate,
  fetchAllTrackedStaff,
  fetchAttendanceConfig,
  addHoliday,
  deleteHoliday,
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
  /** Measured height of the left column — report section is sized to match. Desktop only. */
  matchHeight?: number
  refreshKey?: number
  onChanged?: () => void
}

// Only absent, half_day, and e appear in the Absentees & Exceptions list.
// late → shown at top of Present section; on_leave → shown at top of Absentees section.
const ABSENTEE_EXCEPTION_ORDER: StaffAttendanceStatus[] = ['absent', 'half_day', 'e']
const PRESENT_STATUSES_SET = new Set<StaffAttendanceStatus>(['present', 'wfh'])
// Late, half-day, and exception all count toward the present total even though they
// appear in different sections.
const PRESENT_COUNT_SET = new Set<StaffAttendanceStatus>(['present', 'wfh', 'late', 'half_day', 'e'])

const STATUS_PILL: Record<StaffAttendanceStatus, string> = {
  present:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  absent:   'bg-red-50 text-red-700 border-red-200',
  late:     'bg-amber-50 text-amber-700 border-amber-200',
  half_day: 'bg-orange-50 text-orange-700 border-orange-200',
  wfh:      'bg-cyan-50 text-cyan-700 border-cyan-200',
  on_leave: 'bg-blue-50 text-blue-700 border-blue-200',
  e:        'bg-violet-50 text-violet-700 border-violet-200',
}

const QUICK_SET: StaffAttendanceStatus[] = ['present', 'absent', 'late', 'half_day', 'e']
const QUICK_SHORT: Record<StaffAttendanceStatus, string> = {
  present: 'P', absent: 'A', late: 'L', half_day: '½', wfh: 'WFH', on_leave: 'OL', e: 'E',
}
const QUICK_ACTIVE: Record<StaffAttendanceStatus, string> = {
  present:  'bg-emerald-600 text-white border-emerald-600',
  absent:   'bg-red-600 text-white border-red-600',
  late:     'bg-amber-500 text-white border-amber-500',
  half_day: 'bg-orange-500 text-white border-orange-500',
  wfh:      'bg-cyan-600 text-white border-cyan-600',
  on_leave: 'bg-blue-600 text-white border-blue-600',
  e:        'bg-violet-600 text-white border-violet-600',
}

const ROLE_BADGE: Record<string, string> = {
  teacher:     'bg-[#F5F5F5] text-[#52525B]',
  coordinator: 'bg-[#EDE9E2] text-[#8a6d1f]',
  principal:   'bg-[#F5F5F5] text-[#52525B]',
}

const StaffAttendanceCalendarDynamic = dynamic(
  () => import('@/components/attendance/StaffAttendanceCalendar'),
  { ssr: false, loading: () => <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading calendar…</div> }
)

const PAGE_SIZE = 24

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ── Single staff row ──────────────────────────────────────────────────────────

function StaffRow({
  staff, record, savingId, canEdit, streak, derivedStatus, onSet, viewerId, viewerRole,
}: {
  staff: UserProfile
  record?: StaffAttendanceRecord
  savingId: string | null
  canEdit: boolean
  streak?: number
  /** Shown as the status pill when record is absent (auto-derived, no DB record yet). */
  derivedStatus?: StaffAttendanceStatus
  onSet: (staffId: string, status: StaffAttendanceStatus) => void
  viewerId: string
  viewerRole: string
}) {
  const isSaving = savingId === staff.id
  const effectiveStatus = record?.status ?? derivedStatus
  const showStreak = streak !== undefined && streak >= 1 &&
    (effectiveStatus === 'absent' || effectiveStatus === 'on_leave')
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)

  return (
    <>
      <div className="flex items-center gap-2 sm:gap-3 px-2.5 sm:px-4 py-2.5 bg-white hover:bg-[#FAFAF9] transition-colors">
        <Avatar avatarUrl={staff.avatar_url ?? null} name={staff.full_name} email={staff.email} size={34} userId={staff.id} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={() => setShowModal(true)}
              className="text-sm font-semibold text-[#18181B] truncate leading-tight hover:text-blue-600 hover:underline text-left"
            >
              {staff.full_name}
            </button>
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
            {record?.check_in_time_2 && (
              <span className="text-[10px] text-violet-400 flex items-center gap-0.5">
                <Clock size={9} /> {formatTime(record.check_in_time_2)}
                {record.check_out_time_2 && <> → {formatTime(record.check_out_time_2)}</>}
              </span>
            )}
          </div>
        </div>

        {showStreak && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 border rounded flex-shrink-0 ${streak! >= 3 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
            {streak}d
          </span>
        )}

        {/* Current status pill — always visible when read-only, hidden on narrow screens when edit buttons are shown */}
        {effectiveStatus && (
          <span className={`${canEdit ? 'hidden sm:inline-block' : 'inline-block'} text-[10px] font-semibold px-2 py-0.5 border rounded-full ${STATUS_PILL[effectiveStatus]}`}>
            {STAFF_ATTENDANCE_STATUS_LABELS[effectiveStatus]}
          </span>
        )}

        {/* Quick-set buttons — only shown to admin/principal */}
        {canEdit && (
          <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
            {QUICK_SET.map(st => (
              <button
                key={st}
                disabled={isSaving}
                onClick={() => onSet(staff.id, st)}
                title={STAFF_ATTENDANCE_STATUS_LABELS[st]}
                className={`w-6 h-6 sm:w-7 sm:h-7 text-[10px] sm:text-xs font-bold border rounded-md transition-colors disabled:opacity-40 active:scale-95 flex items-center justify-center ${
                  effectiveStatus === st
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

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showModal && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowModal(false)}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0, y: 16 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 16 }}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
                  <Avatar avatarUrl={staff.avatar_url ?? null} name={staff.full_name} email={staff.email} size={32} userId={staff.id} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{staff.full_name}</p>
                    <p className="text-[11px] text-slate-500 capitalize">{staff.role}</p>
                  </div>
                  <button
                    onClick={() => setShowModal(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="overflow-y-auto flex-1 px-4 py-4">
                  <StaffAttendanceCalendarDynamic
                    staffId={staff.id}
                    mode="self"
                    viewerUserId={viewerId}
                    viewerRole={viewerRole}
                    onViewLeave={app => { setShowModal(false); router.push(`/more/staff-leave?app=${app.id}`) }}
                  />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

function RowList({ children }: { children: React.ReactNode }) {
  return <div className="border border-[#E4E4E7] divide-y divide-[#F0F0EF] rounded-lg overflow-hidden">{children}</div>
}

// ── Report ──────────────────────────────────────────────────────────────────

export default function AllStaffAttendanceReport({
  viewerId, viewerRole, fixedStaff, canEdit = true, matchHeight, refreshKey = 0, onChanged,
}: Props) {
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])
  const [date, setDate] = useState(todayStr)

  // Use a fixed roster when the viewer is a coordinator or teacher
  const hasFixedRoster = viewerRole === 'coordinator' || viewerRole === 'teacher'

  const [records, setRecords] = useState<StaffAttendanceRecord[]>([])
  const [trackedTotal, setTrackedTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [streakMap, setStreakMap] = useState<Map<string, number>>(new Map())

  // Holiday state: undefined = loading, null = not a holiday, Holiday = is a holiday
  const [holidayForDate, setHolidayForDate] = useState<Holiday | null | undefined>(undefined)
  const [savingHoliday, setSavingHoliday] = useState(false)
  const [showHolidayInput, setShowHolidayInput] = useState(false)
  const [holidayNameInput, setHolidayNameInput] = useState('')

  // Auto-absent derivation
  const [lateCutoff, setLateCutoff] = useState<string | null>(null)
  const [allTrackedStaff, setAllTrackedStaff] = useState<UserProfile[]>([])

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
    fetchAttendanceConfig().then(cfg => setLateCutoff(cfg.late_cutoff))
    if (hasFixedRoster) return
    fetchTeamsForDropdown().then(setTeams)
    fetchTrackedStaffCount().then(setTrackedTotal)
    fetchAllTrackedStaff().then(setAllTrackedStaff)
  }, [hasFixedRoster])

  // Load the day's records and holiday status together.
  const loadRecords = useCallback(async () => {
    setLoading(true)
    setStreakMap(new Map())
    const [recs, hol] = await Promise.all([
      fetchStaffAttendanceReportByDate(date),
      fetchHolidayByDate(date),
    ])
    setRecords(recs)
    setHolidayForDate(hol)
    setLoading(false)
    const absenceIds = [...new Set(
      recs.filter(r => r.status === 'absent' || r.status === 'on_leave').map(r => r.staff_id)
    )]
    if (absenceIds.length > 0) {
      fetchStaffAbsenceStreaks(absenceIds, date).then(setStreakMap)
    }
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

  // Reset paging and holiday input whenever scope changes.
  useEffect(() => {
    setPageSize(PAGE_SIZE)
    setQuery('')
    setHolidayForDate(undefined) // reset to "loading" so stale state doesn't flash
    setShowHolidayInput(false)
    setHolidayNameInput('')
  }, [date, selectedTeamId])

  // Scroll to anchor from URL hash once data finishes loading
  useEffect(() => {
    if (loading || teamLoading) return
    const hash = window.location.hash
    if (!hash) return
    const el = document.getElementById(hash.slice(1))
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [loading, teamLoading])

  const roster: UserProfile[] | null = useMemo(
    () => (hasFixedRoster
      ? (fixedStaff ?? []).filter(s => s.role !== 'admin' && !s.is_banned)
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
      absent: [], late: [], half_day: [], on_leave: [], present: [], wfh: [], e: [],
    }
    for (const r of scopedRecords) {
      // late goes to the present section; present/wfh are already in the present section
      if (!PRESENT_STATUSES_SET.has(r.status) && r.status !== 'late') groups[r.status]?.push(r)
    }
    return groups
  }, [scopedRecords])

  const lateRecords = useMemo(
    () => scopedRecords
      .filter(r => r.status === 'late' && r.staff)
      .sort((a, b) => ((a.staff as UserProfile)?.full_name ?? '').localeCompare((b.staff as UserProfile)?.full_name ?? '')),
    [scopedRecords]
  )

  const wfhRecords = useMemo(
    () => scopedRecords
      .filter(r => r.status === 'wfh' && r.staff)
      .sort((a, b) => ((a.staff as UserProfile)?.full_name ?? '').localeCompare((b.staff as UserProfile)?.full_name ?? '')),
    [scopedRecords]
  )

  // ── Auto-absent derivation ──────────────────────────────────────────────────
  // Working days after the late cutoff: staff with no record appear as "Absent".
  // Holidays suppress this — staff without records are implicitly on holiday.
  const isWeekendDate = useMemo(() => {
    const dow = new Date(date + 'T12:00:00').getDay()
    return dow === 0 || dow === 6
  }, [date])

  const shouldDeriveAbsents = useMemo(() => {
    if (isWeekendDate || holidayForDate !== null && holidayForDate !== undefined) return false
    if (holidayForDate === undefined) return false // still loading holiday info
    if (date > todayStr) return false
    if (date < todayStr) return true // past working day — always derive
    if (!lateCutoff) return false
    const [h, m] = lateCutoff.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return false
    const now = new Date()
    return (now.getHours() * 60 + now.getMinutes()) > (h * 60 + m)
  }, [isWeekendDate, holidayForDate, date, todayStr, lateCutoff])

  // Staff scope for auto-absent: use the active roster if one is set, else all tracked staff.
  const virtualAbsents = useMemo(() => {
    if (!shouldDeriveAbsents) return []
    const scope = roster ?? allTrackedStaff
    return scope.filter(s => !recordByStaff.has(s.id))
  }, [shouldDeriveAbsents, roster, allTrackedStaff, recordByStaff])

  // Only absent + half_day + e count as "exceptions" for the badge/total
  const exceptionCount = ABSENTEE_EXCEPTION_ORDER.reduce((n, s) => n + exceptions[s].length, 0) + virtualAbsents.length

  // Pure present (wfh shown separately above present, late shown separately above wfh)
  const presentRecords = useMemo(
    () => scopedRecords.filter(r => r.status === 'present'),
    [scopedRecords]
  )

  // present + late + half_day + e all count toward the "present" number shown in the header
  const presentCount = useMemo(
    () => scopedRecords.filter(r => PRESENT_COUNT_SET.has(r.status)).length,
    [scopedRecords]
  )

  // Staff in the roster who have no record yet (only computable with a roster).
  // Suppressed when virtual absents already cover them.
  const notMarked = useMemo(() => {
    if (!roster || shouldDeriveAbsents || holidayForDate) return []
    return roster.filter(s => !recordByStaff.has(s.id))
  }, [roster, recordByStaff, shouldDeriveAbsents, holidayForDate])

  const presentTotal = roster
    ? roster.length
    : allTrackedStaff.length > 0 ? allTrackedStaff.length : (trackedTotal ?? 0)

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

  // On Duty (WFH) and Late filtered by search — shown at top of present section
  const filteredWfhRecords = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return wfhRecords
    return wfhRecords.filter(r => {
      const s = r.staff as UserProfile
      return s?.full_name?.toLowerCase().includes(q) || s?.email?.toLowerCase().includes(q)
    })
  }, [wfhRecords, query])

  const filteredLateRecords = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return lateRecords
    return lateRecords.filter(r => {
      const s = r.staff as UserProfile
      return s?.full_name?.toLowerCase().includes(q) || s?.email?.toLowerCase().includes(q)
    })
  }, [lateRecords, query])

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

  const handleMarkHoliday = async () => {
    const name = holidayNameInput.trim()
    if (!name) return
    setSavingHoliday(true)
    const ok = await addHoliday(date, name, viewerId)
    if (ok) {
      const hol = await fetchHolidayByDate(date)
      setHolidayForDate(hol)
      setShowHolidayInput(false)
      setHolidayNameInput('')
      onChanged?.()
    }
    setSavingHoliday(false)
  }

  const handleRemoveHoliday = async () => {
    if (!holidayForDate?.id) return
    setSavingHoliday(true)
    const ok = await deleteHoliday(holidayForDate.id)
    if (ok) {
      setHolidayForDate(null)
      onChanged?.()
    }
    setSavingHoliday(false)
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
    <section
      className="border border-[#D4D4D8] bg-white rounded-xl overflow-hidden flex flex-col"
      style={matchHeight ? { height: matchHeight } : undefined}
    >
      {/* Toolbar */}
      <div className="border-b border-[#E4E4E7]">
        {/* Gradient title strip — inherits --page-gradient-from/to from the staff-attendance theme */}
        <div
          className="px-3 sm:px-4 py-2.5"
          style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}
        >
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <Users size={15} style={{ color: 'var(--page-accent)' }} />
            {hasFixedRoster ? 'Team Attendance Report' : 'All Staff Attendance Report'}
          </h2>
          <p className="text-xs text-white/60 mt-0.5">
            Exceptions first, then everyone present — {scopeLabel}.
          </p>
        </div>
        {/* Controls strip */}
        <div className="bg-[#FAFAF9] px-3 sm:px-4 py-2 flex flex-col gap-2">
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

          {/* Holiday control — admin only, non-weekend dates */}
          {viewerRole === 'admin' && !isWeekendDate && (
            <div className="flex items-center gap-2 min-h-[28px]">
              {holidayForDate === undefined ? null : holidayForDate ? (
                <>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-violet-50 border border-violet-200 rounded-lg">
                    <Umbrella size={11} className="text-violet-500 flex-shrink-0" />
                    <span className="text-[11px] font-semibold text-violet-700">{holidayForDate.name}</span>
                  </div>
                  <button
                    onClick={handleRemoveHoliday}
                    disabled={savingHoliday}
                    className="flex items-center gap-1 text-[11px] text-[#71717A] hover:text-red-600 transition-colors disabled:opacity-40 px-1.5 py-1 rounded hover:bg-red-50"
                  >
                    {savingHoliday ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                    Remove holiday
                  </button>
                </>
              ) : showHolidayInput ? (
                <form
                  className="flex items-center gap-1.5 w-full"
                  onSubmit={e => { e.preventDefault(); handleMarkHoliday() }}
                >
                  <Umbrella size={11} className="text-violet-400 flex-shrink-0" />
                  <input
                    autoFocus
                    value={holidayNameInput}
                    onChange={e => setHolidayNameInput(e.target.value)}
                    placeholder="Holiday name…"
                    className="flex-1 min-w-0 text-xs border border-[#D4D4D8] bg-white focus:outline-none focus:border-violet-400 rounded px-2 py-1"
                  />
                  <button
                    type="submit"
                    disabled={!holidayNameInput.trim() || savingHoliday}
                    className="flex items-center gap-1 text-[11px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 px-2 py-1 rounded transition-colors"
                  >
                    {savingHoliday ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowHolidayInput(false); setHolidayNameInput('') }}
                    className="text-[11px] text-[#71717A] hover:text-[#18181B] px-1.5 py-1 rounded hover:bg-[#F0F0EF] transition-colors"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <button
                  onClick={() => setShowHolidayInput(true)}
                  className="flex items-center gap-1.5 text-[11px] text-[#71717A] hover:text-violet-700 hover:bg-violet-50 border border-dashed border-[#D4D4D8] hover:border-violet-300 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <Plus size={11} />
                  Mark as holiday
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-[#E4E4E7]">
        {holidayForDate ? (
          <div className="flex items-center gap-2 w-full">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
              <Umbrella size={16} className="text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-violet-800">{holidayForDate.name}</p>
              <p className="text-[11px] text-violet-500">Holiday · Staff who came in are shown below</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-[#18181B] leading-none">
                {loading || teamLoading ? '—' : presentCount}
              </span>
              <span className="text-sm font-medium text-[#A1A1AA]">
                / {(!hasFixedRoster && !selectedTeamId && trackedTotal === null && allTrackedStaff.length === 0) || teamLoading ? '…' : presentTotal}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="h-1.5 bg-[#F0F0EF] rounded-full overflow-hidden">
                <div className="h-full bg-[#B8983C] rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-[#71717A] mt-1">
                {pct}% present{roster && notMarked.length > 0 ? ` · ${notMarked.length} not marked` : ''}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Scrollable staff list — flex-1 fills the section's remaining height; overflow scrolls */}
      <div className="p-3 sm:p-4 flex-1 min-h-0 overflow-y-auto">
        {loading || teamLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#A1A1AA]">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-5">
            {/* ── Absentees & Exceptions (top) — hidden on holidays when empty ──── */}
            {(!holidayForDate || exceptionCount > 0 || exceptions.on_leave.length > 0) && (
            <div id="staff-exceptions">
              <div className="flex items-center gap-1.5 mb-2.5">
                <AlertCircle size={13} className="text-red-500" />
                <p className={SECTION_LABEL}>Absentees &amp; Exceptions</p>
                {exceptionCount > 0 && <span className="text-xs text-[#A1A1AA]">({exceptionCount})</span>}
              </div>
              {exceptionCount === 0 && exceptions.on_leave.length === 0 ? (
                <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                  No absentees or exceptions {scopeLabel === 'school-wide' ? 'recorded' : `in ${scopeLabel}`} for this day.
                </p>
              ) : (
                <div className="space-y-3">
                  {/* On Leave — shown at top of the absentees section */}
                  {exceptions.on_leave.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 border rounded-full ${STATUS_PILL.on_leave}`}>
                          {STAFF_ATTENDANCE_STATUS_LABELS.on_leave}
                        </span>
                        <span className="text-[11px] text-[#A1A1AA]">{exceptions.on_leave.length}</span>
                      </div>
                      <RowList>
                        {exceptions.on_leave
                          .filter(r => r.staff)
                          .sort((a, b) => ((a.staff as UserProfile).full_name ?? '').localeCompare((b.staff as UserProfile).full_name ?? ''))
                          .map(r => (
                            <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} streak={streakMap.get(r.staff_id)} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} />
                          ))}
                      </RowList>
                    </div>
                  )}

                  {/* Absent, Half Day, E — only these appear in the exceptions list */}
                  {ABSENTEE_EXCEPTION_ORDER.map(status => {
                    const realGroup = exceptions[status]
                    // Merge virtual absents into the 'absent' bucket
                    const extraAbsents = status === 'absent' ? virtualAbsents : []
                    if (realGroup.length === 0 && extraAbsents.length === 0) return null
                    const totalCount = realGroup.length + extraAbsents.length
                    return (
                      <div key={status} id={status === 'absent' ? 'staff-absent' : undefined}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 border rounded-full ${STATUS_PILL[status]}`}>
                            {STAFF_ATTENDANCE_STATUS_LABELS[status]}
                          </span>
                          <span className="text-[11px] text-[#A1A1AA]">{totalCount}</span>
                        </div>
                        <RowList>
                          {realGroup
                            .filter(r => r.staff)
                            .sort((a, b) => ((a.staff as UserProfile).full_name ?? '').localeCompare((b.staff as UserProfile).full_name ?? ''))
                            .map(r => (
                              <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} streak={streakMap.get(r.staff_id)} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} />
                            ))}
                          {extraAbsents
                            .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''))
                            .map(s => (
                              <StaffRow key={`virtual-${s.id}`} staff={s} record={undefined} savingId={savingId} canEdit={canEdit} streak={streakMap.get(s.id)} derivedStatus="absent" onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} />
                            ))}
                        </RowList>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            )}

            {/* ── Present (below) ──────────────────────────────── */}
            <div id="staff-present" className="border-t border-[#E4E4E7] pt-4">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-1.5">
                  <CalendarCheck2 size={13} className="text-emerald-600" />
                  <p className={SECTION_LABEL}>{holidayForDate ? 'Present on Holiday' : 'Present Staff'}</p>
                  <span className="text-xs text-[#A1A1AA]">({filteredWfhRecords.length + filteredLateRecords.length + presentList.length})</span>
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

              {!hasFixedRoster && !selectedTeamId && !holidayForDate && (
                <p className="text-[11px] text-[#A1A1AA] mb-2">
                  Showing everyone who checked in. Pick a team above to narrow the list.
                </p>
              )}

              {holidayForDate && filteredWfhRecords.length === 0 && filteredLateRecords.length === 0 && presentList.length === 0 && (
                <p className="text-[11px] text-violet-500 mb-2">
                  No staff checked in on this holiday.
                </p>
              )}

              {/* On Duty (WFH) — shown at top of present section */}
              {filteredWfhRecords.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 border rounded-full ${STATUS_PILL.wfh}`}>
                      On Duty
                    </span>
                    <span className="text-[11px] text-[#A1A1AA]">{filteredWfhRecords.length}</span>
                  </div>
                  <RowList>
                    {filteredWfhRecords.map(r => (
                      <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} />
                    ))}
                  </RowList>
                </div>
              )}

              {/* Late — shown second in present section */}
              {filteredLateRecords.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 border rounded-full ${STATUS_PILL.late}`}>
                      {STAFF_ATTENDANCE_STATUS_LABELS.late}
                    </span>
                    <span className="text-[11px] text-[#A1A1AA]">{filteredLateRecords.length}</span>
                  </div>
                  <RowList>
                    {filteredLateRecords.map(r => (
                      <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} />
                    ))}
                  </RowList>
                </div>
              )}

              {presentList.length === 0 && filteredWfhRecords.length === 0 && filteredLateRecords.length === 0 ? (
                !holidayForDate && (
                  <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                    {query ? `No present staff match "${query}".` : 'No one has checked in yet.'}
                  </p>
                )
              ) : presentList.length > 0 ? (
                <>
                  <RowList>
                    {visiblePresent.map(({ staff, record }) => (
                      <StaffRow key={record.id} staff={staff} record={record} savingId={savingId} canEdit={canEdit} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} />
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
              ) : null}
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
                    <StaffRow key={s.id} staff={s} savingId={savingId} canEdit={canEdit} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} />
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
