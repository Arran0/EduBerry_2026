'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Avatar from '@/components/Avatar'
import {
  Users, Clock, Loader2, CircleSlash,
  Umbrella, Ban, Settings, FileText, ShieldAlert, HardHat, FileX,
} from 'lucide-react'
import { GlassSegments } from '@/components/transport/glass'
import StaffCalendarModal from '@/components/attendance/StaffCalendarModal'
import DaySetupModal from '@/components/attendance/DaySetupModal'
import {
  ReportTabs, ReportSearch, ReportRowList as RowList, ReportEmpty, ReportSummary, ReportListSkeleton,
  QUICK_GROUP, quickButtonClass, ROW_CLASS, ROW_NAME_CLASS,
} from '@/components/attendance/reportKit'
import { UserProfile } from '@/lib/supabase'
import {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  HolidayGroup,
  NonWorkingDayGroup,
  DayTimingGroup,
  STAFF_ATTENDANCE_STATUS_LABELS,
  describeLocationWarning,
  hasLocationWarning,
  byLocationWarningFirst,
  fetchStaffAttendanceReportByDate,
  fetchTrackedStaffCount,
  adminMarkStaffAttendance,
  fetchStaffAbsenceStreaks,
  fetchHolidaysForDate,
  fetchNonWorkingDaysForDate,
  fetchAllTrackedStaff,
  fetchDayTimingsForDate,
  recomputePendingAttendance,
} from '@/lib/attendance'
import { useSchoolClock } from '@/hooks/useSchoolClock'
import { fetchTeamsForDropdown, fetchTeamStaffById } from '@/lib/teams'
import type { TeamRoster } from '@/lib/teams'
import { fetchStaffIdsWithLeaveOnDate } from '@/lib/leave'
import type { LeaveApplicationWithDetails } from '@/lib/leave'
import { DateToggler, SmartSelect } from '@/components/workspace/ui'
import type { SmartOption } from '@/components/workspace/ui'
import type { ReportTabKey } from '@/components/attendance/reportKit'
import { LocationWarningChip, LocationWarningModal } from '@/components/attendance/LocationWarning'

interface Props {
  viewerId: string
  viewerRole: 'admin' | 'principal' | 'coordinator' | 'teacher'
  /** Coordinators / teachers pass their pre-loaded team roster, aggregated across every team they belong to. */
  fixedStaff?: UserProfile[]
  /**
   * The individual teams behind `fixedStaff`. With more than one, the report
   * defaults to the aggregate and offers a picker to drill into a single team.
   */
  fixedTeams?: TeamRoster[]
  /** When false, status buttons are hidden (read-only view). Defaults to true. */
  canEdit?: boolean
  /** Measured height of the left column — report section is sized to match. Desktop only. */
  matchHeight?: number
  refreshKey?: number
  onChanged?: () => void
  /**
   * Opens a leave application from a staff member's calendar. Without it the
   * row falls back to navigating to the Staff OD / Leave page; the attendance
   * page passes a handler so it opens in its own popup instead.
   */
  onViewLeave?: (app: LeaveApplicationWithDetails) => void
}

const PRESENT_STATUSES_SET = new Set<StaffAttendanceStatus>(['present', 'wfh'])
// Everything the Present tab lists. A flagged row among these is hoisted out of
// its usual group into the block at the top of that tab.
const PRESENT_TAB_STATUSES = new Set<StaffAttendanceStatus>(['present', 'wfh', 'late'])
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

const DayTimingModalDynamic = dynamic(
  () => import('@/components/attendance/DayTimingModal'),
  { ssr: false }
)

const HolidayModalDynamic = dynamic(
  () => import('@/components/attendance/HolidayModal'),
  { ssr: false }
)

const NonWorkingDayModalDynamic = dynamic(
  () => import('@/components/attendance/NonWorkingDayModal'),
  { ssr: false }
)

// The Documents popup: Late summary, Absence & irregular summary, Time tracking.
const ReportsModalDynamic = dynamic(
  () => import('@/components/attendance/reports/ReportsModal'),
  { ssr: false }
)

// The Support side of the report — a separate roster, separate records and
// separate statistics (see src/lib/supportStaff.ts). Loaded only once an admin
// actually switches to it.
const SupportStaffAttendanceReportDynamic = dynamic(
  () => import('@/components/attendance/SupportStaffAttendanceReport'),
  {
    ssr: false,
    loading: () => <div className="p-3 sm:p-4"><ReportListSkeleton /></div>,
  }
)




const PAGE_SIZE = 24

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function formatDayLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

// Cap the name shown in a row so a long name can't push the status/edit
// controls off a narrow phone screen. The full name stays available in the
// profile modal.
function shortName(name: string, max = 11) {
  return name.length > max ? `${name.slice(0, max).trimEnd()}…` : name
}

// ── Single staff row ──────────────────────────────────────────────────────────

const StaffRow = React.memo(function StaffRow({
  staff, record, savingId, canEdit, streak, derivedStatus, onSet, viewerId, viewerRole, onViewLeave,
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
  onViewLeave?: (app: LeaveApplicationWithDetails) => void
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
  // Nothing is mounted for a row until it is opened — with a whole school
  // listed, an idle popup per row re-rendered on every keystroke in the search.
  const [showModal, setShowModal] = useState(false)
  // A punch this staff member was allowed through with the location off
  // campus, unmeasured, or unavailable. Flagged here because "present" on
  // this row would otherwise be indistinguishable from a check-in that was
  // actually verified against the campus.
  const [showWarning, setShowWarning] = useState(false)
  const warning = useMemo(() => describeLocationWarning(record), [record])
  const openModal = useCallback(() => setShowModal(true), [])

  return (
    <>
      <motion.div
        layout="position"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
        transition={{ layout: { duration: 0.2, ease: 'easeInOut' }, opacity: { duration: 0.15 } }}
        className={ROW_CLASS}
      >
        <Avatar avatarUrl={staff.avatar_url ?? null} name={staff.full_name} email={staff.email} size={32} userId={staff.id} profileSeed={staff} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={openModal}
              title={staff.full_name}
              className={ROW_NAME_CLASS}
            >
              {shortName(staff.full_name)}
            </button>
            {isSaving && <Loader2 size={11} className="animate-spin text-[#B8983C] flex-shrink-0" />}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {record?.check_in_time && (
              <span className="text-[10.5px] text-slate-400 tabular-nums flex items-center gap-0.5">
                <Clock size={9} /> {formatTime(record.check_in_time)}
                {record.check_out_time && <> → {formatTime(record.check_out_time)}</>}
              </span>
            )}
            {record?.check_in_time_2 && (
              <span className="text-[10.5px] text-violet-400 tabular-nums flex items-center gap-0.5">
                <Clock size={9} /> {formatTime(record.check_in_time_2)}
                {record.check_out_time_2 && <> → {formatTime(record.check_out_time_2)}</>}
              </span>
            )}
            {warning && <LocationWarningChip warning={warning} onClick={() => setShowWarning(true)} />}
          </div>
        </div>

        {showStreak && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 border rounded-full tabular-nums flex-shrink-0 ${streak! >= 3 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
            {streak}d
          </span>
        )}

        {/* Current status — On Leave / On Duty show the full labelled pill on
            broad screens. On phones the pill collapses to a super-small red /
            green dot; when quick-set buttons are shown the dot is instead
            overlaid on the A / P button (below), so the standalone dot only
            appears for read-only viewers here. Other statuses keep the labelled
            pill (hidden on narrow screens when edit buttons are shown). */}
        {effectiveStatus && (
          effectiveStatus === 'on_leave' || effectiveStatus === 'wfh' ? (
            <>
              {!canEdit && (
                <span
                  title={STAFF_ATTENDANCE_STATUS_LABELS[effectiveStatus]}
                  className={`sm:hidden w-1.5 h-1.5 rounded-full flex-shrink-0 ${effectiveStatus === 'on_leave' ? 'bg-red-500' : 'bg-emerald-500'}`}
                />
              )}
              <span className={`hidden sm:inline-block text-[10px] font-semibold px-2 py-0.5 border rounded-full ${STATUS_PILL[effectiveStatus]}`}>
                {STAFF_ATTENDANCE_STATUS_LABELS[effectiveStatus]}
              </span>
            </>
          ) : (
            <span className={`${canEdit ? 'hidden sm:inline-block' : 'inline-block'} text-[10px] font-semibold px-2 py-0.5 border rounded-full ${STATUS_PILL[effectiveStatus]}`}>
              {STAFF_ATTENDANCE_STATUS_LABELS[effectiveStatus]}
            </span>
          )
        )}

        {/* Quick-set buttons — only shown to admin/principal */}
        {canEdit && (
          <div className={QUICK_GROUP} role="group" aria-label="Set status">
            {QUICK_SET.map(st => {
              const isWordLabel = st === 'late' || st === 'e'
              // On phones, On Leave / On Duty surface as a tiny corner dot on the
              // A / P button (red for On Leave over Absent, green for On Duty over
              // Present) so the status is visible without a separate pill.
              const overlayDot =
                st === 'absent' && effectiveStatus === 'on_leave' ? 'bg-red-500'
                  : st === 'present' && effectiveStatus === 'wfh' ? 'bg-emerald-500'
                    : null
              return (
                <button
                  key={st}
                  disabled={isSaving}
                  onClick={() => onSet(staff.id, st)}
                  title={STAFF_ATTENDANCE_STATUS_LABELS[st]}
                  className={quickButtonClass(buttonStatus === st, QUICK_ACTIVE[st], isWordLabel)}
                >
                  {st === 'e'
                    ? (<><span className="sm:hidden">Excep.</span><span className="hidden sm:inline">Exception</span></>)
                    : QUICK_SHORT[st]}
                  {overlayDot && (
                    <span className={`sm:hidden absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ring-1 ring-white ${overlayDot}`} />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </motion.div>

      {warning && showWarning && record && (
        <LocationWarningModal
          warning={warning}
          title={staff.full_name}
          subtitle={formatDayLabel(record.date)}
          onClose={() => setShowWarning(false)}
        />
      )}

      <AnimatePresence>
        {showModal && (
          <StaffCalendarModal
            person={staff}
            subtitle={<span className="capitalize">{staff.role}</span>}
            avatarUserId={staff.id}
            viewerId={viewerId}
            viewerRole={viewerRole}
            onClose={() => setShowModal(false)}
            onViewLeave={app => {
              setShowModal(false)
              if (onViewLeave) onViewLeave(app)
              else router.push(`/more/staff-leave?app=${app.id}`)
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
})

// ── Report ──────────────────────────────────────────────────────────────────

export default function AllStaffAttendanceReport({
  viewerId, viewerRole, fixedStaff, fixedTeams, canEdit = true, matchHeight, refreshKey = 0, onChanged, onViewLeave,
}: Props) {
  // Server clock in the school's timezone — the report decides who counts as
  // Absent today from it, so it must not be read off the viewer's device.
  // Falls back to the device date only for the first render, before it lands.
  const { today: schoolToday } = useSchoolClock()
  const deviceToday = useMemo(() => new Date().toISOString().split('T')[0], [])
  const todayStr = schoolToday ?? deviceToday
  const [date, setDate] = useState(deviceToday)

  // Snap the viewed day to the server's date once it lands — unless the viewer
  // has already picked a day, in which case theirs stands.
  const datePicked = useRef(false)
  useEffect(() => {
    if (schoolToday && !datePicked.current) setDate(schoolToday)
  }, [schoolToday])
  const pickDate = useCallback((d: string) => { datePicked.current = true; setDate(d) }, [])

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

  // Same shape as holidayRules, for the (unpaid, non-worked) Non-working Day rule.
  const [nonWorkingRules, setNonWorkingRules] = useState<NonWorkingDayGroup[] | undefined>(undefined)
  const [showNonWorkingModal, setShowNonWorkingModal] = useState(false)

  // Custom timing state: undefined = loading, [] = standard timing, else custom rows for the date
  const [dayTimings, setDayTimings] = useState<DayTimingGroup[] | undefined>(undefined)
  const [showTimingModal, setShowTimingModal] = useState(false)

  // Holiday / non-working day / cutoff setup lives in the Day setup popup,
  // opened from the settings button.
  const [showAdminControls, setShowAdminControls] = useState(false)
  const [showReportsModal, setShowReportsModal] = useState(false)

  // Auto-absent derivation
  const [allTrackedStaff, setAllTrackedStaff] = useState<UserProfile[]>([])

  // Team targeting (admin / principal only)
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [teamRoster, setTeamRoster] = useState<UserProfile[]>([])
  const [teamLoading, setTeamLoading] = useState(false)

  // Present-list controls
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(PAGE_SIZE)

  // Inline tab (Absent / Present / Irregular)
  const [activeTab, setActiveTab] = useState<ReportTabKey>('absent')

  // Which roster the report is showing. 'support' is the ground-level
  // cleaning / maintenance staff, who have no account and no check-in of
  // their own — an entirely separate list and set of statistics, offered to
  // admins from the toggle beside the title.
  const [section, setSection] = useState<'staff' | 'support'>('staff')
  const canSeeSupport = viewerRole === 'admin'
  const showSupport = canSeeSupport && section === 'support'

  const teamCacheRef = useRef<Map<string, UserProfile[]>>(new Map())
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (hasFixedRoster) return
    fetchTeamsForDropdown().then(setTeams)
    fetchTrackedStaffCount().then(setTrackedTotal)
    fetchAllTrackedStaff().then(setAllTrackedStaff)
  }, [hasFixedRoster])

  // Load the day's records, holiday status, and any custom timing together.
  // `silent` skips the loading spinner — used after a quick mark/clear so the
  // list stays on screen and animates the row out instead of the whole tab
  // flashing to a spinner and back.
  const loadRecords = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    setStreakMap(new Map())
    // Apply any cutoff / holiday / non-working-day rule that changed since the
    // last look before reading the day, so the report never shows a status
    // scored against a rule the same screen no longer displays. A no-op — one
    // read of an empty queue — unless something actually changed, and a no-op
    // for viewers who cannot change the rules in the first place.
    if (viewerRole === 'admin' || viewerRole === 'principal') {
      await recomputePendingAttendance()
    }
    const [recs, hol, nonWorking, timings] = await Promise.all([
      fetchStaffAttendanceReportByDate(date),
      fetchHolidaysForDate(date),
      fetchNonWorkingDaysForDate(date),
      viewerRole === 'admin' ? fetchDayTimingsForDate(date) : Promise.resolve([]),
    ])
    setRecords(recs)
    setHolidayRules(hol)
    setNonWorkingRules(nonWorking)
    setDayTimings(timings)
    setLoading(false)
    const absenceIds = [...new Set(
      recs.filter(r => r.status === 'absent' || r.status === 'on_leave').map(r => r.staff_id)
    )]
    if (absenceIds.length > 0) {
      fetchStaffAbsenceStreaks(absenceIds, date).then(setStreakMap)
    }
  }, [date, viewerRole])

  // Full spinner only when the day (or, for admin, the timing-relevant
  // viewer role) actually changes. A `refreshKey` bump alone — e.g. from
  // marking someone here or in the Support Staff tab, both of which bump the
  // same page-level refreshKey — reloads the same day's data silently
  // instead of flashing the whole tab back to "Loading…".
  const lastLoadedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const loadKey = `${date}|${viewerRole}`
    const silent = lastLoadedKeyRef.current === loadKey
    lastLoadedKeyRef.current = loadKey
    loadRecords({ silent })
  }, [loadRecords, refreshKey, date, viewerRole])

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
    const tabByHash: Record<string, ReportTabKey> = {
      '#staff-present': 'present',
      '#staff-unverified': 'present',
      '#staff-absent': 'absent',
      '#staff-no-leave': 'absent',
      '#staff-exceptions': 'irregular',
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

  // Coordinators / teachers: the aggregate of every team they belong to, or a
  // single one of those teams once they pick it from the roster picker.
  const roster: UserProfile[] | null = useMemo(() => {
    if (!hasFixedRoster) return selectedTeamId ? teamRoster : null
    const base = selectedTeamId
      ? (fixedTeams?.find(t => t.id === selectedTeamId)?.members ?? [])
      : (fixedStaff ?? [])
    return base.filter(s => !s.attendance_hidden && !s.is_banned)
  }, [hasFixedRoster, fixedStaff, fixedTeams, selectedTeamId, teamRoster])

  // Only offer the "which of my teams" picker when there is more than one.
  const myTeamOptions: SmartOption[] = useMemo(
    () => (fixedTeams ?? []).map(t => ({
      value: t.id,
      label: t.name,
      sublabel: `${t.members.length} member${t.members.length === 1 ? '' : 's'}`,
    })),
    [fixedTeams]
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

  // Rows accepted without their location verified. Counted at the top rather
  // than left to be discovered row by row: a day with four of these is a fact
  // about the day, and an admin should not have to scroll to learn it.
  const warningCount = useMemo(
    () => scopedRecords.filter(hasLocationWarning).length,
    [scopedRecords]
  )

  // The same rows, lifted out of the Present tab's groups into one block above
  // them. Sorting them within their groups was not enough — a flagged name
  // would still sit below thirty verified ones the moment the roster grew.
  // Strict first (no location access at all), then by name.
  const unverifiedPresent = useMemo(
    () => scopedRecords
      .filter(r => r.staff && PRESENT_TAB_STATUSES.has(r.status) && hasLocationWarning(r))
      .sort((a, b) =>
        byLocationWarningFirst(a, b) ||
        ((a.staff as UserProfile).full_name ?? '').localeCompare((b.staff as UserProfile).full_name ?? '')
      ),
    [scopedRecords]
  )

  const unverifiedIds = useMemo(
    () => new Set(unverifiedPresent.map(r => r.id)),
    [unverifiedPresent]
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
      .filter(r => r.status === 'late' && r.staff && !unverifiedIds.has(r.id))
      .sort((a, b) => ((a.staff as UserProfile)?.full_name ?? '').localeCompare((b.staff as UserProfile)?.full_name ?? '')),
    [scopedRecords, unverifiedIds]
  )

  const wfhRecords = useMemo(
    () => scopedRecords
      .filter(r => r.status === 'wfh' && r.staff && !unverifiedIds.has(r.id))
      .sort((a, b) => ((a.staff as UserProfile)?.full_name ?? '').localeCompare((b.staff as UserProfile)?.full_name ?? '')),
    [scopedRecords, unverifiedIds]
  )

  // ── Auto-absent derivation ──────────────────────────────────────────────────
  // Working days after the late cutoff: staff with no record appear as "Absent".
  // Every day of the week is treated the same — holidays suppress this (staff
  // without records are implicitly on holiday), weekends do not get special treatment.
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

  // Same suppression, for the (unpaid) Non-working Day rule — nobody is
  // expected in, so nobody should be auto-derived Absent either.
  const hasDefaultNonWorking = useMemo(() => nonWorkingRules?.some(r => r.is_default) ?? false, [nonWorkingRules])

  const nonWorkingStaffIds = useMemo(() => {
    if (!nonWorkingRules || hasDefaultNonWorking) return null
    const s = new Set<string>()
    for (const r of nonWorkingRules) {
      if (!r.is_default) for (const id of r.staff_ids) s.add(id)
    }
    return s
  }, [nonWorkingRules, hasDefaultNonWorking])

  const isStaffNonWorking = useCallback((staffId: string) => {
    if (hasDefaultNonWorking) return true
    return nonWorkingStaffIds?.has(staffId) ?? false
  }, [hasDefaultNonWorking, nonWorkingStaffIds])

  const isStaffExcusedToday = useCallback(
    (staffId: string) => isStaffOnHoliday(staffId) || isStaffNonWorking(staffId),
    [isStaffOnHoliday, isStaffNonWorking]
  )

  const shouldDeriveAbsents = useMemo(() => {
    if (hasDefaultHoliday || hasDefaultNonWorking) return false
    if (holidayRules === undefined || nonWorkingRules === undefined) return false // still loading
    if (date > todayStr) return false
    return true // today or a past working day — always derive
  }, [hasDefaultHoliday, hasDefaultNonWorking, holidayRules, nonWorkingRules, date, todayStr])

  // Staff scope for auto-absent: use the active roster if one is set, else all tracked staff.
  const virtualAbsents = useMemo(() => {
    if (!shouldDeriveAbsents) return []
    const scope = roster ?? allTrackedStaff
    return scope.filter(s => !recordByStaff.has(s.id) && !isStaffExcusedToday(s.id))
  }, [shouldDeriveAbsents, roster, allTrackedStaff, recordByStaff, isStaffExcusedToday])

  // Pure present (wfh shown separately above present, late shown separately
  // above wfh, unverified hoisted above all of them).
  const presentRecords = useMemo(
    () => scopedRecords.filter(r => r.status === 'present' && !unverifiedIds.has(r.id)),
    [scopedRecords, unverifiedIds]
  )

  // present + late + half_day + e all count toward the "present" number shown in the header
  const presentCount = useMemo(
    () => scopedRecords.filter(r => PRESENT_COUNT_SET.has(r.status)).length,
    [scopedRecords]
  )

  // Staff in the roster who have no record yet (only computable with a roster).
  // Suppressed when virtual absents already cover them.
  const notMarked = useMemo(() => {
    if (!roster || shouldDeriveAbsents || hasDefaultHoliday || hasDefaultNonWorking) return []
    return roster.filter(s => !recordByStaff.has(s.id) && !isStaffExcusedToday(s.id))
  }, [roster, recordByStaff, shouldDeriveAbsents, hasDefaultHoliday, hasDefaultNonWorking, isStaffExcusedToday])

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

  const filteredUnverified = useMemo(
    () => filterByQuery(unverifiedPresent),
    [unverifiedPresent, filterByQuery]
  )
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

  // Absentees with no leave application for the day, escalated the way
  // unverified punches are on the Present tab: an absence nobody applied for
  // is the one an admin needs to chase. Only viewers who can read other
  // staff's applications (coordinator and up, per RLS) get the flag — for a
  // teacher the lookup would come back empty and accuse everyone.
  const canSeeLeave = viewerRole !== 'teacher'
  const absentStaffKey = useMemo(() => {
    const ids = new Set<string>()
    // A record already tied to a leave application is covered by definition.
    for (const r of exceptions.absent) if (!r.leave_application_id) ids.add(r.staff_id)
    for (const s of virtualAbsents) ids.add(s.id)
    return [...ids].sort().join(',')
  }, [exceptions.absent, virtualAbsents])
  const [leaveCover, setLeaveCover] = useState<{ key: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (!canSeeLeave || loading || teamLoading || !absentStaffKey) return
    const key = `${date}|${absentStaffKey}`
    let cancelled = false
    fetchStaffIdsWithLeaveOnDate(absentStaffKey.split(','), date).then(ids => {
      if (!cancelled && ids) setLeaveCover({ key, ids })
    })
    return () => { cancelled = true }
  }, [canSeeLeave, loading, teamLoading, absentStaffKey, date, refreshKey])

  // null until the lookup for exactly this day and these absentees is back,
  // so a stale answer never flags (or clears) the wrong names.
  const noLeaveIds = useMemo(() => {
    if (!canSeeLeave || !absentStaffKey || !leaveCover || leaveCover.key !== `${date}|${absentStaffKey}`) return null
    return new Set(absentStaffKey.split(',').filter(id => !leaveCover.ids.has(id)))
  }, [canSeeLeave, absentStaffKey, leaveCover, date])

  const noLeaveAbsentRows = useMemo(
    () => (noLeaveIds ? absentRows.filter(x => noLeaveIds.has(x.staff.id)) : []),
    [absentRows, noLeaveIds]
  )
  const otherAbsentRows = useMemo(
    () => (noLeaveIds ? absentRows.filter(x => !noLeaveIds.has(x.staff.id)) : absentRows),
    [absentRows, noLeaveIds]
  )
  const noLeaveCount = noLeaveIds?.size ?? 0

  const absentTabTotal = absentRows.length + exceptions.on_leave.length
  // Late still counts as present — shown at the top of the Present tab, not under Irregular.
  const presentTabTotal =
    presentRecords.length + wfhRecords.length + lateRecords.length + unverifiedPresent.length

  // Exception tab: half_day, e — genuine irregularities only (on_leave/wfh/late live under Absent/Present).
  const exceptionGroups = useMemo(() => {
    const groups: { status: StaffAttendanceStatus; records: StaffAttendanceRecord[] }[] = []
    // Flagged rows first here too, though these lists are short enough that
    // sorting is sufficient — no hoisting needed.
    const halfDay = filterByQuery(exceptions.half_day).sort(byLocationWarningFirst)
    const eRecords = filterByQuery(exceptions.e).sort(byLocationWarningFirst)
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

  /**
   * Quick-set a status.
   *
   * The chosen status is known before the write resolves, so a row that
   * already has a record is repainted immediately and the round trip runs
   * behind it — marking someone used to block on the write *and* a full reload
   * of the day (records, holidays, non-working days, timings, streaks) before
   * anything moved. A row with no record yet still waits, because its id and
   * marked_by only exist once the server has written it.
   *
   * The silent reload afterwards is the reconciliation: it also restores the
   * true status if the write turns out to have failed.
   */
  const handleSet = useCallback(async (staffId: string, status: StaffAttendanceStatus) => {
    setSavingId(staffId)
    let optimistic = false
    setRecords(prev => {
      const i = prev.findIndex(r => r.staff_id === staffId)
      if (i === -1) return prev
      optimistic = true
      const next = [...prev]
      next[i] = { ...next[i], status }
      return next
    })
    if (optimistic) setSavingId(null)

    const ok = await adminMarkStaffAttendance(staffId, date, status, viewerId)
    await loadRecords({ silent: true })
    if (ok) {
      if (!hasFixedRoster) fetchTrackedStaffCount().then(setTrackedTotal)
      onChanged?.()
    }
    setSavingId(null)
  }, [date, viewerId, loadRecords, hasFixedRoster, onChanged])

  const teamOptions: SmartOption[] = useMemo(
    () => teams.map(t => ({ value: t.id, label: t.name })),
    [teams]
  )

  const pct = presentTotal > 0 ? Math.round((presentCount / presentTotal) * 100) : 0

  // Spells out which of the viewer's teams the numbers cover — only meaningful
  // once they sit on more than one.
  const scopeLabel = useMemo(() => {
    if (!hasFixedRoster || myTeamOptions.length < 2) return null
    if (!selectedTeamId) return `all ${myTeamOptions.length} teams`
    return fixedTeams?.find(t => t.id === selectedTeamId)?.name ?? null
  }, [hasFixedRoster, myTeamOptions.length, selectedTeamId, fixedTeams])

  // The pointer moves the glass's highlight, as on the home deck.
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    el.style.setProperty('--lg-x', `${e.clientX - r.left}px`)
    el.style.setProperty('--lg-y', `${e.clientY - r.top}px`)
  }, [])

  // Liquid Glass, as on the home page: the section is a glass sheet with its
  // header straight on the glass, and the roster sits on a solid card riding
  // on it — glass is the chrome, never the surface a name is read off.
  return (
    <section
      ref={sectionRef}
      onPointerMove={onPointerMove}
      // Always the height its host gives it (see the page): switching day,
      // list or roster changes what scrolls inside, never the section's size.
      className="lg-deck lg-panel flex flex-col h-full"
      style={matchHeight ? { height: matchHeight } : undefined}
    >
      {/* Header, on the glass. One row on every width — title, documents,
          setup and the date — with the roster switch wrapping beneath it on a
          phone and sitting inline from sm up. */}
      <div className="relative z-[3] flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-2.5 px-3 sm:px-5 pt-3 sm:pt-4 pb-2.5 sm:pb-3">
        <span className="icon-chip w-8 h-8 sm:w-10 sm:h-10 flex-shrink-0 bg-[linear-gradient(135deg,#3D3B40,#27272A)]">
          {showSupport
            ? <HardHat size={15} className="relative z-10 text-[#E9DDBB] sm:w-[17px] sm:h-[17px]" />
            : <Users size={15} className="relative z-10 text-[#E9DDBB] sm:w-[17px] sm:h-[17px]" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[1.02rem] sm:text-[1.3rem] font-bold leading-none headline text-slate-900">Report</h2>
          <p className="hidden sm:block text-[12px] text-slate-500 mt-1 truncate">{formatDayLabel(date)}{date === todayStr ? ' · today' : ''}</p>
        </div>

        {/* Staff ⇄ Support. Support staff never appear in the staff list or its
            counts, and vice versa — this switches the whole body, not a filter
            over one roster. */}
        {canSeeSupport && (
          <GlassSegments
            items={[
              { key: 'staff' as const, label: 'School staff', icon: Users },
              { key: 'support' as const, label: 'Support staff', icon: HardHat },
            ]}
            value={section}
            onChange={setSection}
            size="sm"
            layoutId="sa-roster"
            stretch
            className="order-last sm:order-none"
          />
        )}

        <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
          {/* Held in place (invisible) on the support side, so switching
              rosters never shifts the date toggler or the row. */}
          {viewerRole === 'admin' && (
            <button
              onClick={() => setShowReportsModal(true)}
              title="Documents — late, absence and time tracking reports"
              aria-label="Documents"
              tabIndex={showSupport ? -1 : undefined}
              className={`lg-control w-8 h-8 sm:w-9 sm:h-9 ${showSupport ? 'invisible' : ''}`}
            >
              <FileText size={15} />
            </button>
          )}
          {viewerRole === 'admin' && (
            <button
              onClick={() => setShowAdminControls(true)}
              title="Day setup — holiday, non-working day and cutoff times"
              aria-label="Day setup"
              tabIndex={showSupport ? -1 : undefined}
              className={`lg-control w-8 h-8 sm:w-9 sm:h-9 ${showSupport ? 'invisible' : ''}`}
            >
              <Settings size={15} />
            </button>
          )}
          <DateToggler
            value={date}
            onChange={pickDate}
            max={todayStr}
            todayStr={todayStr}
            className="inline-flex flex-shrink-0 h-8 sm:h-9"
            size="sm"
            glass
          />
        </div>
      </div>

      {showSupport ? (
        <div className="relative z-[3] lg-content mx-2 sm:mx-2.5 mb-2 sm:mb-2.5 flex-1 min-h-0 flex flex-col overflow-hidden">
          <SupportStaffAttendanceReportDynamic
            viewerRole={viewerRole}
            date={date}
            todayStr={todayStr}
            viewerId={viewerId}
            canEdit={canEdit}
            // The whole-school rules already loaded for the staff side apply to
            // support staff too — nobody is expected in on a school holiday.
            dayOff={
              hasDefaultNonWorking
                ? { kind: 'non_working', name: nonWorkingRules?.find(r => r.is_default)?.name ?? 'Non-working day' }
                : hasDefaultHoliday
                  ? { kind: 'holiday', name: holidayRules?.find(r => r.is_default)?.name ?? 'Holiday' }
                  : null
            }
            refreshKey={refreshKey}
            onChanged={onChanged}
          />
        </div>
      ) : (
      <div className="relative z-[3] lg-content mx-2 sm:mx-2.5 mb-2 sm:mb-2.5 flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Summary */}
      <div className="flex items-center gap-4 px-4 py-3 min-h-[4.25rem] border-b border-[#27272A]/[0.06] flex-shrink-0">
        {hasDefaultHoliday ? (
          <div className="flex items-center gap-3 w-full">
            <div className="w-10 h-10 rounded-2xl bg-violet-100 flex items-center justify-center flex-shrink-0">
              <Umbrella size={17} className="text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-violet-800">{holidayRules?.find(r => r.is_default)?.name}</p>
              <p className="text-[12px] text-violet-500">Holiday · staff who came in are listed below</p>
            </div>
          </div>
        ) : hasDefaultNonWorking ? (
          <div className="flex items-center gap-3 w-full">
            <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center flex-shrink-0">
              <Ban size={17} className="text-slate-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">{nonWorkingRules?.find(r => r.is_default)?.name}</p>
              <p className="text-[12px] text-slate-500">Non-working day · staff who came in are listed below</p>
            </div>
          </div>
        ) : (
          <ReportSummary
            present={presentCount}
            total={(!hasFixedRoster && !selectedTeamId && trackedTotal === null && allTrackedStaff.length === 0) || teamLoading ? null : presentTotal}
            pct={pct}
            loading={loading || teamLoading}
            detail={<>
              <span>
                {pct}% present{scopeLabel ? ` · ${scopeLabel}` : ''}{roster && notMarked.length > 0 ? ` · ${notMarked.length} not marked` : ''}
              </span>
              {warningCount > 0 && (
                <button
                  onClick={() => setActiveTab('present')}
                  title="Punches accepted with the location off campus, unmeasured, or unavailable. Tap to see who."
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 font-semibold text-red-700 hover:bg-red-100 transition-colors"
                >
                  <ShieldAlert size={11} className="flex-shrink-0" />
                  {warningCount} unverified
                </button>
              )}
              {noLeaveCount > 0 && (
                <button
                  onClick={() => setActiveTab('absent')}
                  title="Absent with no leave application for this day. Tap to see who."
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 font-semibold text-red-700 hover:bg-red-100 transition-colors"
                >
                  <FileX size={11} className="flex-shrink-0" />
                  {noLeaveCount} no leave
                </button>
              )}
            </>}
          />
        )}
      </div>

      {/* Tabs and search stay put; only the list below them scrolls. */}
      <div className="px-3 sm:px-4 pt-3 space-y-2.5 flex-shrink-0">
        <ReportTabs
          value={activeTab}
          onChange={setActiveTab}
          counts={loading || teamLoading ? null : { absent: absentTabTotal, present: presentTabTotal, irregular: exceptionTotal }}
          layoutId="sa-report-tab"
        />
        <div className="flex items-center gap-2">
          <ReportSearch value={query} onChange={v => { setQuery(v); setPageSize(PAGE_SIZE) }} placeholder="Search staff" />
              {!hasFixedRoster ? (
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
              ) : myTeamOptions.length > 1 ? (
                <SmartSelect
                  options={myTeamOptions}
                  value={selectedTeamId}
                  onChange={setSelectedTeamId}
                  allowClear
                  placeholder="All my teams"
                  searchPlaceholder="Search my teams…"
                  emptyText="No teams"
                  className="w-36 sm:w-48 flex-shrink-0"
                  leadingIcon={<Users size={14} className="text-[#71717A] flex-shrink-0" />}
                />
              ) : null}
        </div>
      </div>

      {/* The records — the only part that scrolls */}
      {/* No overscroll containment: once the list hits its top or bottom, the
          rest of the gesture scrolls the page, so a report filling the screen
          never traps the scroll. */}
      <div className="px-3 sm:px-4 pt-3 pb-3 sm:pb-4 flex-1 min-h-0 overflow-y-auto">
        {loading || teamLoading ? (
          <ReportListSkeleton />
        ) : (
          <div className="space-y-3.5">
            {/* ── Absent — on_leave (auto-counts as absent) + real/derived absent ── */}
            {activeTab === 'absent' && (
              absentTabTotal === 0 ? (
                <ReportEmpty>
                  {query ? `No absentees match "${query}".` : 'No one is marked absent for this day.'}
                </ReportEmpty>
              ) : (
                <div className="space-y-2">
                  {/* No leave application first, set apart like the Present
                      tab's unverified block: these absences are unaccounted
                      for, so they are the ones to follow up. */}
                  {noLeaveAbsentRows.length > 0 && (
                    <div id="staff-no-leave" className="border border-red-200/80 bg-red-50/40 rounded-2xl overflow-hidden">
                      <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b border-red-200/70 bg-red-50/80">
                        <FileX size={14} className="text-red-600 flex-shrink-0" />
                        <p className="text-[12.5px] font-semibold text-red-800">No leave application</p>
                        <span className="text-[12px] text-red-500 tabular-nums">{noLeaveAbsentRows.length}</span>
                      </div>
                      <div className="sa-list">
                        <AnimatePresence initial={false}>
                          {noLeaveAbsentRows.map(({ key, staff, record }) => (
                            <StaffRow
                              key={key} staff={staff} record={record} savingId={savingId} canEdit={canEdit}
                              streak={streakMap.get(staff.id)} derivedStatus={record ? undefined : 'absent'}
                              onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole}
                              onViewLeave={onViewLeave}
                            />
                          ))}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}
                  {filteredOnLeave.length > 0 && (
                    <RowList>
                      {filteredOnLeave
                        .filter(r => r.staff)
                        .sort((a, b) => ((a.staff as UserProfile).full_name ?? '').localeCompare((b.staff as UserProfile).full_name ?? ''))
                        .map(r => (
                          <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} streak={streakMap.get(r.staff_id)} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} onViewLeave={onViewLeave} />
                        ))}
                    </RowList>
                  )}
                  {otherAbsentRows.length > 0 && (
                    <RowList>
                      {otherAbsentRows.map(({ key, staff, record }) => (
                        <StaffRow
                          key={key} staff={staff} record={record} savingId={savingId} canEdit={canEdit}
                          streak={streakMap.get(staff.id)} derivedStatus={record ? undefined : 'absent'}
                          onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole}
                          onViewLeave={onViewLeave}
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
                  <ReportEmpty>
                    {query ? `No present staff match "${query}".` : hasDefaultHoliday ? 'No staff checked in on this holiday.' : hasDefaultNonWorking ? 'No staff checked in on this non-working day.' : 'No one has checked in yet.'}
                  </ReportEmpty>
                ) : (
                  <div className="space-y-2">
                    {/* Unverified first, and visibly set apart. These are the
                        rows where "present" rests on nothing but the staff
                        member's word, so they are the ones an admin is here to
                        see — not something to find by scrolling past everyone
                        whose location actually checked out. */}
                    {filteredUnverified.length > 0 && (
                      <div id="staff-unverified" className="border border-red-200/80 bg-red-50/40 rounded-2xl overflow-hidden">
                        <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b border-red-200/70 bg-red-50/80">
                          <ShieldAlert size={14} className="text-red-600 flex-shrink-0" />
                          <p className="text-[12.5px] font-semibold text-red-800">Location not verified</p>
                          <span className="text-[12px] text-red-500 tabular-nums">{filteredUnverified.length}</span>
                        </div>
                        <div className="sa-list">
                          <AnimatePresence initial={false}>
                            {filteredUnverified.map(r => (
                              <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} onViewLeave={onViewLeave} />
                            ))}
                          </AnimatePresence>
                        </div>
                      </div>
                    )}
                    {filteredLateRecords.length > 0 && (
                      <RowList>
                        {filteredLateRecords.map(r => (
                          <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} onViewLeave={onViewLeave} />
                        ))}
                      </RowList>
                    )}
                    {filteredWfhRecords.length > 0 && (
                      <RowList>
                        {filteredWfhRecords.map(r => (
                          <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} onViewLeave={onViewLeave} />
                        ))}
                      </RowList>
                    )}
                    {presentList.length > 0 && (
                      <>
                        <RowList>
                          {visiblePresent.map(({ staff, record }) => (
                            <StaffRow key={record.id} staff={staff} record={record} savingId={savingId} canEdit={canEdit} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} onViewLeave={onViewLeave} />
                          ))}
                        </RowList>
                        {presentList.length > pageSize && (
                          <button
                            onClick={() => setPageSize(s => s + PAGE_SIZE)}
                            className="mt-2 w-full h-9 text-[13px] font-semibold text-slate-700 bg-[#F4F2EE] hover:bg-[#ECE8E1] transition-colors rounded-full"
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
            {activeTab === 'irregular' && (
              exceptionGroups.length === 0 ? (
                <ReportEmpty>
                  {query ? `No irregular attendance matches "${query}".` : 'No irregular attendance for this day.'}
                </ReportEmpty>
              ) : (
                <div className="space-y-2">
                  {exceptionGroups.map(({ status, records }) => (
                    <RowList key={status}>
                      {records
                        .filter(r => r.staff)
                        .sort((a, b) => ((a.staff as UserProfile).full_name ?? '').localeCompare((b.staff as UserProfile).full_name ?? ''))
                        .map(r => (
                          <StaffRow key={r.id} staff={r.staff as UserProfile} record={r} savingId={savingId} canEdit={canEdit} streak={streakMap.get(r.staff_id)} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} onViewLeave={onViewLeave} />
                        ))}
                    </RowList>
                  ))}
                </div>
              )
            )}

            {/* ── Not marked (only when a roster is known) ─────── */}
            {roster && notMarkedList.length > 0 && (
              <div className="border-t border-[#27272A]/[0.06] pt-4">
                <div className="flex items-center gap-1.5 mb-2.5 px-1">
                  <CircleSlash size={14} className="text-slate-400" />
                  <p className="text-[12.5px] font-semibold text-slate-600">Not marked</p>
                  <span className="text-[12px] text-slate-400 tabular-nums">{notMarkedList.length}</span>
                </div>
                <RowList>
                  {notMarkedList.map(s => (
                    <StaffRow key={s.id} staff={s} savingId={savingId} canEdit={canEdit} onSet={handleSet} viewerId={viewerId} viewerRole={viewerRole} onViewLeave={onViewLeave} />
                  ))}
                </RowList>
              </div>
            )}
          </div>
        )}
      </div>

      </div>
      )}

      <AnimatePresence>
        {showAdminControls && (
          <DaySetupModal
            dateLabel={`${formatDayLabel(date)}${date === todayStr ? ' · today' : ''}`}
            holidayRules={holidayRules}
            nonWorkingRules={nonWorkingRules}
            dayTimings={dayTimings}
            onOpenHoliday={() => setShowHolidayModal(true)}
            onOpenNonWorking={() => setShowNonWorkingModal(true)}
            onOpenTiming={() => setShowTimingModal(true)}
            onClose={() => setShowAdminControls(false)}
          />
        )}
      </AnimatePresence>

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

      {showNonWorkingModal && (
        <NonWorkingDayModalDynamic
          initialDate={date}
          viewerId={viewerId}
          teams={teams}
          allStaff={allTrackedStaff}
          onClose={() => setShowNonWorkingModal(false)}
          onSaved={() => { fetchNonWorkingDaysForDate(date).then(setNonWorkingRules); onChanged?.() }}
        />
      )}

      <AnimatePresence>
        {showReportsModal && (
          <ReportsModalDynamic
            onClose={() => setShowReportsModal(false)}
            todayStr={todayStr}
            teams={teams}
          />
        )}
      </AnimatePresence>
    </section>
  )
}
