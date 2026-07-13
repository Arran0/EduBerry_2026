'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Avatar from '@/components/Avatar'
import {
  Search, Users, X, Clock, Loader2, CircleSlash,
  Umbrella, Repeat, Settings,
} from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  HolidayGroup,
  DayTimingGroup,
  STAFF_ATTENDANCE_STATUS_LABELS,
  fetchStaffAttendanceReportByDate,
  fetchTrackedStaffCount,
  adminMarkStaffAttendance,
  fetchStaffAbsenceStreaks,
  fetchHolidaysForDate,
  fetchAllTrackedStaff,
  fetchAttendanceConfig,
  fetchDayTimingsForDate,
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
  present: 'P', absent: 'A', late: 'Late', half_day: '½', wfh: 'WFH', on_leave: 'OL', e: 'Exception',
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

const StaffAttendanceCalendarDynamic = dynamic(
  () => import('@/components/attendance/StaffAttendanceCalendar'),
  { ssr: false, loading: () => <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading calendar…</div> }
)

const DayTimingModalDynamic = dynamic(
  () => import('@/components/attendance/DayTimingModal'),
  { ssr: false }
)

const HolidayModalDynamic = dynamic(
  () => import('@/components/attendance/HolidayModal'),
  { ssr: false }
)

function formatTimeShort(t: string) {
  const [h, m] = t.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatCutoffBadge(lateCutoff: string, checkoutCutoff: string) {
  return `${formatTimeShort(lateCutoff)} · ${formatTimeShort(checkoutCutoff)}`
}

function formatCutoffTitle(lateCutoff: string, checkoutCutoff: string) {
  return `Late after ${formatTimeShort(lateCutoff)} · Half day before ${formatTimeShort(checkoutCutoff)}`
}

const PAGE_SIZE = 24

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// Cap the name shown in a row so a long name can't push the status/edit
// controls off a narrow phone screen. The full name stays available in the
// profile modal.
function shortName(name: string, max = 12) {
  return name.length > max ? `${name.slice(0, max).trimEnd()}…` : name
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
  // The quick-set array only has P/A/Late/½/Exception buttons, so On Leave and
  // On Duty (wfh) have no button of their own. Map them onto the array: On Leave
  // reads as Absent, On Duty reads as Present, so the right button lights up.
  const buttonStatus: StaffAttendanceStatus | undefined =
    effectiveStatus === 'on_leave' ? 'absent'
      : effectiveStatus === 'wfh' ? 'present'
        : effectiveStatus
  const showStreak = streak !== undefined && streak >= 1 &&
    (effectiveStatus === 'absent' || effectiveStatus === 'on_leave')
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)

  return (
    <>
      <div className="flex items-center gap-2 sm:gap-3 px-2.5 sm:px-4 py-2 bg-white hover:bg-[#FAFAF9] transition-colors">
        <Avatar avatarUrl={staff.avatar_url ?? null} name={staff.full_name} email={staff.email} size={30} userId={staff.id} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={() => setShowModal(true)}
              title={staff.full_name}
              className="text-sm font-semibold text-[#18181B] truncate leading-tight hover:text-blue-600 hover:underline text-left"
            >
              {shortName(staff.full_name)}
            </button>
            {isSaving && <Loader2 size={11} className="animate-spin text-[#B8983C] flex-shrink-0" />}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
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

        {/* Current status — On Leave / On Duty collapse to a red / green dot to
            save width; other statuses keep the labelled pill. Always visible when
            read-only, hidden on narrow screens when edit buttons are shown. */}
        {effectiveStatus && (
          effectiveStatus === 'on_leave' || effectiveStatus === 'wfh' ? (
            <span
              title={STAFF_ATTENDANCE_STATUS_LABELS[effectiveStatus]}
              className={`${canEdit ? 'hidden sm:block' : 'block'} w-2.5 h-2.5 rounded-full flex-shrink-0 ${effectiveStatus === 'on_leave' ? 'bg-red-500' : 'bg-emerald-500'}`}
            />
          ) : (
            <span className={`${canEdit ? 'hidden sm:inline-block' : 'inline-block'} text-[10px] font-semibold px-2 py-0.5 border rounded-full ${STATUS_PILL[effectiveStatus]}`}>
              {STAFF_ATTENDANCE_STATUS_LABELS[effectiveStatus]}
            </span>
          )
        )}

        {/* Quick-set buttons — only shown to admin/principal */}
        {canEdit && (
          <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
            {QUICK_SET.map(st => {
              const isWordLabel = st === 'late' || st === 'e'
              return (
                <button
                  key={st}
                  disabled={isSaving}
                  onClick={() => onSet(staff.id, st)}
                  title={STAFF_ATTENDANCE_STATUS_LABELS[st]}
                  className={`h-6 sm:h-7 font-bold border rounded-md transition-colors disabled:opacity-40 active:scale-95 flex items-center justify-center ${
                    isWordLabel ? 'px-1.5 text-[7px] sm:text-[7.5px] uppercase tracking-tight' : 'w-6 sm:w-7 text-[10px] sm:text-xs'
                  } ${
                    buttonStatus === st
                      ? QUICK_ACTIVE[st]
                      : 'border-[#D4D4D8] text-[#A1A1AA] bg-white hover:bg-[#F5F5F5] hover:text-[#18181B]'
                  }`}
                >
                  {QUICK_SHORT[st]}
                </button>
              )
            })}
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

  // Holiday rules for the date: undefined = loading, [] = no holiday, else default/team rows
  const [holidayRules, setHolidayRules] = useState<HolidayGroup[] | undefined>(undefined)
  const [showHolidayModal, setShowHolidayModal] = useState(false)

  // Custom timing state: undefined = loading, [] = standard timing, else custom rows for the date
  const [dayTimings, setDayTimings] = useState<DayTimingGroup[] | undefined>(undefined)
  const [showTimingModal, setShowTimingModal] = useState(false)

  // Holiday/Cutoff setup buttons live behind a settings toggle — collapsed by default
  // so the toolbar stays out of the way for admins who aren't actively configuring them.
  const [showAdminControls, setShowAdminControls] = useState(false)

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

  // Inline tab (Absent / Present / Irregular) — 'exception' kept as the internal key
  const [activeTab, setActiveTab] = useState<'absent' | 'present' | 'exception'>('absent')

  const teamCacheRef = useRef<Map<string, UserProfile[]>>(new Map())
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    fetchAttendanceConfig().then(cfg => setLateCutoff(cfg.late_cutoff))
    if (hasFixedRoster) return
    fetchTeamsForDropdown().then(setTeams)
    fetchTrackedStaffCount().then(setTrackedTotal)
    fetchAllTrackedStaff().then(setAllTrackedStaff)
  }, [hasFixedRoster])

  // Load the day's records, holiday status, and any custom timing together.
  const loadRecords = useCallback(async () => {
    setLoading(true)
    setStreakMap(new Map())
    const [recs, hol, timings] = await Promise.all([
      fetchStaffAttendanceReportByDate(date),
      fetchHolidaysForDate(date),
      viewerRole === 'admin' ? fetchDayTimingsForDate(date) : Promise.resolve([]),
    ])
    setRecords(recs)
    setHolidayRules(hol)
    setDayTimings(timings)
    setLoading(false)
    const absenceIds = [...new Set(
      recs.filter(r => r.status === 'absent' || r.status === 'on_leave').map(r => r.staff_id)
    )]
    if (absenceIds.length > 0) {
      fetchStaffAbsenceStreaks(absenceIds, date).then(setStreakMap)
    }
  }, [date, viewerRole])

  useEffect(() => { loadRecords() }, [loadRecords, refreshKey])

  // Resolve the active roster (team for admins, fixed list for coordinators/teachers).
  useEffect(() => {
    if (hasFixedRoster) return
    if (!selectedTeamId) { setTeamRoster([]); return }
    const cached = teamCacheRef.current.get(selectedTeamId)
    if (cached) { setTeamRoster(cached); return }
    setTeamLoading(true)
    fetchTeamStaffById(selectedTeamId).then(members => {
      const trackable = members.filter(m => !m.attendance_hidden)
      teamCacheRef.current.set(selectedTeamId, trackable)
      setTeamRoster(trackable)
      setTeamLoading(false)
    })
  }, [selectedTeamId, hasFixedRoster])

  // Reset paging and holiday input whenever scope changes.
  useEffect(() => {
    setPageSize(PAGE_SIZE)
    setQuery('')
    setHolidayRules(undefined) // reset to "loading" so stale state doesn't flash
    setDayTimings(undefined)
  }, [date, selectedTeamId])

  // Jump to the tab named by the URL hash (set by the home screen's attendance
  // card links) once data finishes loading, then scroll the section into view.
  useEffect(() => {
    if (loading || teamLoading) return
    const hash = window.location.hash
    if (!hash) return
    const tabByHash: Record<string, 'absent' | 'present' | 'exception'> = {
      '#staff-present': 'present',
      '#staff-absent': 'absent',
      '#staff-exceptions': 'exception',
    }
    const tab = tabByHash[hash]
    if (!tab) return
    setActiveTab(tab)
    // The page banner expands with a spring animation, so a single scroll fired
    // now lands at a stale offset. Re-run across a few frames until the layout
    // settles so the report reliably ends up in view.
    let raf = 0
    const scroll = () => {
      const el = document.getElementById(hash.slice(1)) ?? sectionRef.current
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    raf = requestAnimationFrame(scroll)
    const t1 = setTimeout(scroll, 250)
    const t2 = setTimeout(scroll, 650)
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2) }
  }, [loading, teamLoading])

  const roster: UserProfile[] | null = useMemo(
    () => (hasFixedRoster
      ? (fixedStaff ?? []).filter(s => !s.attendance_hidden && !s.is_banned)
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

  // Whole-school holiday suppresses derivation entirely; a team-scoped holiday only
  // excludes the staff it actually covers (handled per-staff below).
  const hasDefaultHoliday = useMemo(() => holidayRules?.some(r => r.is_default) ?? false, [holidayRules])

  const holidayStaffIds = useMemo(() => {
    if (!holidayRules || hasDefaultHoliday) return null
    const s = new Set<string>()
    for (const r of holidayRules) {
      if (!r.is_default) for (const id of r.staff_ids) s.add(id)
    }
    return s
  }, [holidayRules, hasDefaultHoliday])

  const isStaffOnHoliday = useCallback((staffId: string) => {
    if (hasDefaultHoliday) return true
    return holidayStaffIds?.has(staffId) ?? false
  }, [hasDefaultHoliday, holidayStaffIds])

  const shouldDeriveAbsents = useMemo(() => {
    if (isWeekendDate || hasDefaultHoliday) return false
    if (holidayRules === undefined) return false // still loading holiday info
    if (date > todayStr) return false
    if (date < todayStr) return true // past working day — always derive
    if (!lateCutoff) return false
    const [h, m] = lateCutoff.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return false
    const now = new Date()
    return (now.getHours() * 60 + now.getMinutes()) > (h * 60 + m)
  }, [isWeekendDate, hasDefaultHoliday, holidayRules, date, todayStr, lateCutoff])

  // Staff scope for auto-absent: use the active roster if one is set, else all tracked staff.
  const virtualAbsents = useMemo(() => {
    if (!shouldDeriveAbsents) return []
    const scope = roster ?? allTrackedStaff
    return scope.filter(s => !recordByStaff.has(s.id) && !isStaffOnHoliday(s.id))
  }, [shouldDeriveAbsents, roster, allTrackedStaff, recordByStaff, isStaffOnHoliday])

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
    if (!roster || shouldDeriveAbsents || hasDefaultHoliday) return []
    return roster.filter(s => !recordByStaff.has(s.id) && !isStaffOnHoliday(s.id))
  }, [roster, recordByStaff, shouldDeriveAbsents, hasDefaultHoliday, isStaffOnHoliday])

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

  const filterByQuery = useCallback((recs: StaffAttendanceRecord[]) => {
    const q = query.trim().toLowerCase()
    if (!q) return recs
    return recs.filter(r => {
      const s = r.staff as UserProfile
      return s?.full_name?.toLowerCase().includes(q) || s?.email?.toLowerCase().includes(q)
    })
  }, [query])

  const filteredWfhRecords = useMemo(() => filterByQuery(wfhRecords), [wfhRecords, filterByQuery])
  const filteredLateRecords = useMemo(() => filterByQuery(lateRecords), [lateRecords, filterByQuery])
  // On Leave counts as Absent; On Duty (wfh) counts as Present — shown in those tabs, not Exception.
  const filteredOnLeave = useMemo(() => filterByQuery(exceptions.on_leave), [exceptions.on_leave, filterByQuery])

  // Absent tab: real absent records + auto-derived (virtual) absents, merged into one list.
  const absentRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const real = exceptions.absent
      .filter(r => r.staff)
      .map(r => ({ key: r.id, staff: r.staff as UserProfile, record: r as StaffAttendanceRecord | undefined }))
    const virtual = virtualAbsents.map(s => ({ key: `virtual-${s.id}`, staff: s, record: undefined }))
    let rows = [...real, ...virtual]
    if (q) rows = rows.filter(x => x.staff.full_name?.toLowerCase().includes(q) || x.staff.email?.toLowerCase().includes(q))
    rows.sort((a, b) => (a.staff.full_name ?? '').localeCompare(b.staff.full_name ?? ''))
    return rows
  }, [exceptions.absent, virtualAbsents, query])

  const absentTabTotal = absentRows.length + exceptions.on_leave.length
  // Late still counts as present — shown at the top of the Present tab, not under Irregular.
  const presentTabTotal = presentRecords.length + wfhRecords.length + lateRecords.length

  // Exception tab: half_day, e — genuine irregularities only (on_leave/wfh/late live under Absent/Present).
  const exceptionGroups = useMemo(() => {
    const groups: { status: StaffAttendanceStatus; records: StaffAttendanceRecord[] }[] = []
    const halfDay = filterByQuery(exceptions.half_day)
    const eRecords = filterByQuery(exceptions.e)
    if (halfDay.length) groups.push({ status: 'half_day', records: halfDay })
    if (eRecords.length) groups.push({ status: 'e', records: eRecords })
    return groups
  }, [exceptions, filterByQuery])

  const exceptionTotal = exceptions.half_day.length + exceptions.e.length

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

  const pct = presentTotal > 0 ? Math.round((presentCount / presentTotal) * 100) : 0

  return (
    <section
      ref={sectionRef}
      className="border border-[#D4D4D8] bg-white rounded-xl overflow-hidden flex flex-col lg:h-full"
      style={matchHeight ? { height: matchHeight } : undefined}
    >
      {/* Toolbar */}
      <div className="border-b border-[#E4E4E7]">
        {/* Gradient title strip — inherits --page-gradient-from/to from the staff-attendance theme */}
        <div
          className="px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2"
          style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}
        >
          <h2 className="flex items-center gap-2 text-sm font-bold text-white min-w-0">
            <Users size={15} className="flex-shrink-0" style={{ color: 'var(--page-accent)' }} />
            <span className="truncate">Report</span>
          </h2>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {viewerRole === 'admin' && (
              <button
                onClick={() => setShowAdminControls(v => !v)}
                title={showAdminControls ? 'Hide holiday/cutoff setup' : 'Show holiday/cutoff setup'}
                aria-pressed={showAdminControls}
                className={`p-1.5 rounded-lg transition-colors ${showAdminControls ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
              >
                <Settings size={14} />
              </button>
            )}
            <DateToggler
              value={date}
              onChange={setDate}
              max={todayStr}
              todayStr={todayStr}
              className="inline-flex flex-shrink-0"
              size="sm"
            />
          </div>
        </div>
        {/* Controls strip — holiday + cutoff, admin only, hidden behind the settings toggle */}
        {viewerRole === 'admin' && showAdminControls && (
        <div className="bg-[#FAFAF9] px-3 sm:px-4 py-1.5">
          <div className="flex items-center gap-1.5">
            {holidayRules !== undefined && (
              holidayRules.length > 0 ? (
                <button
                  onClick={() => setShowHolidayModal(true)}
                  title={holidayRules.length === 1 ? undefined : holidayRules.map(r => `${r.name} (${r.is_default ? 'everyone' : `${r.staff_ids.length} staff`})`).join('\n')}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-violet-200 bg-white hover:bg-violet-50 rounded-lg transition-colors min-w-0"
                >
                  <Umbrella size={12} className="text-violet-500 flex-shrink-0" />
                  <span className="text-[#18181B] truncate max-w-[6rem] sm:max-w-[9rem]">
                    {holidayRules.length === 1 ? holidayRules[0].name : `${holidayRules.length} holidays`}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => setShowHolidayModal(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-[#D4D4D8] bg-white hover:bg-[#F5F5F5] rounded-lg transition-colors flex-shrink-0"
                >
                  <Umbrella size={12} className="text-violet-500 flex-shrink-0" />
                  <span className="text-[#18181B]">Holiday</span>
                </button>
              )
            )}

            {dayTimings !== undefined && (
              dayTimings.length > 0 ? (
                <button
                  onClick={() => setShowTimingModal(true)}
                  title={dayTimings.length === 1 ? formatCutoffTitle(dayTimings[0].late_cutoff, dayTimings[0].checkout_cutoff) : dayTimings.map(t => `${t.label}: ${formatCutoffTitle(t.late_cutoff, t.checkout_cutoff)}`).join('\n')}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-amber-200 bg-white hover:bg-amber-50 rounded-lg transition-colors min-w-0"
                >
                  {dayTimings[0].scope_type === 'weekday'
                    ? <Repeat size={12} className="text-amber-500 flex-shrink-0" />
                    : <Clock size={12} className="text-amber-500 flex-shrink-0" />}
                  <span className="text-[#18181B] truncate max-w-[6rem] sm:max-w-none">
                    {dayTimings.length === 1
                      ? formatCutoffBadge(dayTimings[0].late_cutoff, dayTimings[0].checkout_cutoff)
                      : `${dayTimings.length} cutoffs`}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => setShowTimingModal(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-[#D4D4D8] bg-white hover:bg-[#F5F5F5] rounded-lg transition-colors flex-shrink-0"
                >
                  <Clock size={12} className="text-amber-500 flex-shrink-0" />
                  <span className="text-[#18181B]">Cutoff</span>
                </button>
              )
            )}
          </div>
        </div>
        )}
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-[#E4E4E7]">
        {hasDefaultHoliday ? (
          <div className="flex items-center gap-2 w-full">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
              <Umbrella size={16} className="text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-violet-800">{holidayRules?.find(r => r.is_default)?.name}</p>
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
          <div className="space-y-4">
            {/* Inline tabs — pick one list at a time instead of stacking everything */}
            <div className="grid grid-cols-3 border-b border-[#E4E4E7]">
              {([
                { key: 'absent' as const, label: 'Absent', count: absentTabTotal, color: 'border-red-600 text-red-600' },
                { key: 'present' as const, label: 'Present', count: presentTabTotal, color: 'border-emerald-600 text-emerald-600' },
                { key: 'exception' as const, label: 'Irregular', count: exceptionTotal, color: 'border-amber-500 text-amber-600' },
              ]).map(t => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex items-center justify-center gap-1.5 pb-2 -mb-px text-xs font-semibold border-b-2 transition-colors ${
                    activeTab === t.key ? t.color : 'border-transparent text-[#A1A1AA] hover:text-[#52525B]'
                  }`}
                >
                  {t.label}
                  <span className={activeTab === t.key ? 'opacity-70' : 'text-[#D4D4D8]'}>{t.count}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
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
              {!hasFixedRoster && (
                <SmartSelect
                  options={teamOptions}
                  value={selectedTeamId}
                  onChange={setSelectedTeamId}
                  allowClear
                  placeholder="All teams"
                  searchPlaceholder="Search teams…"
                  emptyText="No teams"
                  className="w-36 sm:w-48 flex-shrink-0"
                  leadingIcon={<Users size={14} className="text-[#71717A] flex-shrink-0" />}
                />
              )}
            </div>

            {/* ── Absent — on_leave (auto-counts as absent) + real/derived absent ── */}
            {activeTab === 'absent' && (
              absentTabTotal === 0 ? (
                <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                  {query ? `No absentees match "${query}".` : 'No one is marked absent for this day.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredOnLeave.length > 0 && (
                    <RowList>
                      {filteredOnLeave
                        .filter(r => r.staff)
                        .sort((a, b) => ((a.staff as UserProfile).full_name ?? '').localeCompare((b.staff as UserProfile).full_name ?? ''))
                        .map(r => (
                          <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} streak={streakMap.get(r.staff_id)} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} />
                        ))}
                    </RowList>
                  )}
                  {absentRows.length > 0 && (
                    <RowList>
                      {absentRows.map(({ key, staff, record }) => (
                        <StaffRow
                          key={key} staff={staff} record={record} savingId={savingId} canEdit={canEdit}
                          streak={streakMap.get(staff.id)} derivedStatus={record ? undefined : 'absent'}
                          onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole}
                        />
                      ))}
                    </RowList>
                  )}
                </div>
              )
            )}

            {/* ── Present — wfh/on-duty (auto-counts as present) + checked-in present ── */}
            {activeTab === 'present' && (
              <>
                {presentTabTotal === 0 ? (
                  <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                    {query ? `No present staff match "${query}".` : hasDefaultHoliday ? 'No staff checked in on this holiday.' : 'No one has checked in yet.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filteredLateRecords.length > 0 && (
                      <RowList>
                        {filteredLateRecords.map(r => (
                          <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} />
                        ))}
                      </RowList>
                    )}
                    {filteredWfhRecords.length > 0 && (
                      <RowList>
                        {filteredWfhRecords.map(r => (
                          <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} />
                        ))}
                      </RowList>
                    )}
                    {presentList.length > 0 && (
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
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── Irregular — half_day, e; segregated but untitled (late lives under Present) ── */}
            {activeTab === 'exception' && (
              exceptionGroups.length === 0 ? (
                <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                  {query ? `No irregular attendance matches "${query}".` : 'No irregular attendance for this day.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {exceptionGroups.map(({ status, records }) => (
                    <RowList key={status}>
                      {records
                        .filter(r => r.staff)
                        .sort((a, b) => ((a.staff as UserProfile).full_name ?? '').localeCompare((b.staff as UserProfile).full_name ?? ''))
                        .map(r => (
                          <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} streak={streakMap.get(r.staff_id)} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} />
                        ))}
                    </RowList>
                  ))}
                </div>
              )
            )}

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

      {showTimingModal && (
        <DayTimingModalDynamic
          initialDate={date}
          viewerId={viewerId}
          teams={teams}
          allStaff={allTrackedStaff}
          onClose={() => setShowTimingModal(false)}
          onSaved={() => { fetchDayTimingsForDate(date).then(setDayTimings); onChanged?.() }}
        />
      )}

      {showHolidayModal && (
        <HolidayModalDynamic
          initialDate={date}
          viewerId={viewerId}
          teams={teams}
          allStaff={allTrackedStaff}
          onClose={() => setShowHolidayModal(false)}
          onSaved={() => { fetchHolidaysForDate(date).then(setHolidayRules); onChanged?.() }}
        />
      )}
    </section>
  )
}
