'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import Avatar from '@/components/Avatar'
import { Search, X, Loader2, HardHat, Umbrella, Ban, CheckSquare } from 'lucide-react'
import {
  SupportStaff,
  SupportAttendanceRecord,
  SupportAttendanceStatus,
  SUPPORT_ATTENDANCE_STATUS_LABELS,
  SUPPORT_ATTENDANCE_STATUS_PILL,
  fetchSupportStaff,
  fetchSupportAttendanceRange,
  markSupportAttendance,
  clearSupportAttendance,
  computeSupportDayStats,
  supportRecordToStaffShape,
} from '@/lib/supportStaff'
import {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  fetchTrackedDrivers,
  fetchMonthlyAttendanceRecords,
  adminMarkStaffAttendance,
  clearStaffAttendance,
} from '@/lib/attendance'
import { UserProfile } from '@/lib/supabase'
import { fetchStaffDirectoryMap } from '@/lib/staffDetails'

// Loaded on demand — the same read-only month calendar the main staff report
// opens when you click a name (see AllStaffAttendanceReport.tsx). Ground
// support staff don't have a staff_attendance_records row to read it from, so
// their rows are adapted into that shape via fetchGroundRecords below.
const StaffAttendanceCalendarDynamic = dynamic(
  () => import('@/components/attendance/StaffAttendanceCalendar'),
  { ssr: false, loading: () => <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading calendar…</div> }
)

// ============================================
// The Support Staff tab of the staff attendance report.
//
// Two very different kinds of person share this list:
//   - ground-level support staff (cleaning, maintenance, grounds) — no
//     account, no login, live in support_staff / support_staff_attendance
//     (see src/lib/supportStaff.ts)
//   - drivers — a real profile and login, but no self check-in of their own
//     (ProtectedLayout routes role='driver' straight to /driver and away
//     from this app), so their attendance lives in the same
//     staff_attendance_records table the school-staff side uses, just
//     admin-marked the same way ground staff are here.
//
// Both are folded into one roster because from an admin's point of view they
// are the same kind of task: nobody here can check themselves in, so every
// row is set by hand. The section mirrors AllStaffAttendanceReport's format —
// the same Absent / Present / Irregular inline tabs, the same five manual
// marks (P/A/Late/½/Exception), and the same rule for which tab a status
// lands in. No WFH here (no punch to work from home from).
//
// Auto-absent derivation mirrors the school-staff report: on a working day
// (not a whole-school holiday/non-working day per `dayOff`, and not still in
// the future) an unmarked person is derived Absent, same as
// AllStaffAttendanceReport's `virtualAbsents` — see computeSupportDayStats.
// This also keeps the daily view in step with payroll, which already derives
// absence the same way for support staff (computeStaffAttendanceStats via
// supportRecordToStaffShape).
// ============================================

interface Props {
  date: string
  /** School-clock today — a future date can't be marked. */
  todayStr: string
  viewerId: string
  canEdit: boolean
  /** Whole-school holiday / non-working day for this date, from the parent. */
  dayOff?: { kind: 'holiday' | 'non_working'; name: string } | null
  refreshKey?: number
  onChanged?: () => void
}

/** One row in this section, whichever table it actually comes from. */
interface SectionPerson {
  id: string
  kind: 'ground' | 'driver'
  full_name: string
  designation: string | null
  avatar_url?: string | null
}

const QUICK_SET: SupportAttendanceStatus[] = ['present', 'absent', 'late', 'half_day', 'e']

const QUICK_SHORT: Record<SupportAttendanceStatus, string> = {
  present: 'P', absent: 'A', late: 'Late', half_day: '½', on_leave: 'OL', e: 'Exception',
}

const QUICK_ACTIVE: Record<SupportAttendanceStatus, string> = {
  present:  'bg-emerald-600 text-white border-emerald-600',
  absent:   'bg-red-600 text-white border-red-600',
  late:     'bg-amber-500 text-white border-amber-500',
  half_day: 'bg-orange-500 text-white border-orange-500',
  on_leave: 'bg-blue-600 text-white border-blue-600',
  e:        'bg-violet-600 text-white border-violet-600',
}

// The only statuses this tab ever writes, for either kind of person — a
// driver's staff_attendance_records row is only ever trusted here if its
// status is one of these, so a stray wfh value (which this tab never
// writes, but nothing stops another admin screen from having) falls back to
// "not marked" rather than needing a pill of its own.
const SHARED_STATUSES = new Set<string>(['present', 'absent', 'late', 'half_day', 'on_leave', 'e'])
const asSupportStatus = (status: string): SupportAttendanceStatus | null =>
  SHARED_STATUSES.has(status) ? (status as SupportAttendanceStatus) : null

// Inline tab (Absent / Present / Irregular) — matches AllStaffAttendanceReport:
// on_leave counts as Absent, late counts as Present, half_day/exception are
// the genuine irregularities. 'irregular' kept as the internal key.
type Tab = 'absent' | 'present' | 'irregular'

function monthStartOf(date: string) {
  return `${date.slice(0, 7)}-01`
}

function shortName(name: string, max = 14) {
  return name.length > max ? `${name.slice(0, max).trimEnd()}…` : name
}

// ── One row (ground support staff or driver) ─────────────────────────────────

function SupportRow({
  person, record, derivedStatus, saving, canEdit, viewerId, onSet, onClear,
}: {
  person: SectionPerson
  record?: { status: SupportAttendanceStatus }
  /** Shown as the status pill when absent is auto-derived (no DB record yet). */
  derivedStatus?: SupportAttendanceStatus
  saving: boolean
  canEdit: boolean
  viewerId: string
  onSet: (id: string, status: SupportAttendanceStatus) => void
  onClear: (id: string) => void
}) {
  const [showCalendar, setShowCalendar] = useState(false)
  const effectiveStatus = record?.status ?? derivedStatus

  // Ground support staff have no staff_attendance_records row of their own —
  // their month lives in support_staff_attendance instead, so it's fetched
  // separately and adapted into the shape StaffAttendanceCalendar already
  // knows how to render (same trick payroll uses — see supportRecordToStaffShape).
  const fetchGroundRecords = useCallback(async (staffId: string, year: number, month: number) => {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
    const recs = await fetchSupportAttendanceRange(monthStart, monthEnd)
    return recs.filter(r => r.support_staff_id === staffId).map(supportRecordToStaffShape)
  }, [])

  return (
    <>
      <motion.div
        layout="position"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
        transition={{ layout: { duration: 0.2, ease: 'easeInOut' }, opacity: { duration: 0.15 } }}
        className="flex items-center gap-2 sm:gap-3 px-2.5 sm:px-4 py-2 bg-white hover:bg-[#FAFAF9] transition-colors"
      >
        <Avatar
          avatarUrl={person.avatar_url ?? null}
          name={person.full_name}
          size={30}
          userId={person.kind === 'driver' ? person.id : undefined}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={() => setShowCalendar(true)}
              title={person.full_name}
              className="text-sm font-semibold text-[#18181B] truncate leading-tight hover:text-blue-600 hover:underline text-left"
            >
              {shortName(person.full_name)}
            </button>
            {saving && <Loader2 size={11} className="animate-spin text-[#B8983C] flex-shrink-0" />}
          </div>
          {person.designation && (
            <p className="text-[10px] text-[#A1A1AA] truncate max-w-[9rem] mt-0.5">{person.designation}</p>
          )}
        </div>

        {effectiveStatus ? (
          <span className={`${canEdit ? 'hidden sm:inline-block' : 'inline-block'} text-[10px] font-semibold px-2 py-0.5 border rounded-full flex-shrink-0 ${SUPPORT_ATTENDANCE_STATUS_PILL[effectiveStatus]}`}>
            {SUPPORT_ATTENDANCE_STATUS_LABELS[effectiveStatus]}
          </span>
        ) : (
          <span className={`${canEdit ? 'hidden sm:inline-block' : 'inline-block'} text-[10px] font-semibold px-2 py-0.5 border border-dashed border-[#D4D4D8] text-[#A1A1AA] rounded-full flex-shrink-0`}>
            Not marked
          </span>
        )}

        {canEdit && (
          <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
            {QUICK_SET.map(st => {
              const isWordLabel = st === 'late' || st === 'e'
              return (
                <button
                  key={st}
                  disabled={saving}
                  onClick={() => onSet(person.id, st)}
                  title={SUPPORT_ATTENDANCE_STATUS_LABELS[st]}
                  className={`h-6 sm:h-7 font-bold border rounded-md transition-colors disabled:opacity-40 active:scale-95 flex items-center justify-center ${
                    isWordLabel ? 'px-1.5 text-[7px] sm:text-[7.5px] uppercase tracking-tight' : 'w-6 sm:w-7 text-[10px] sm:text-xs'
                  } ${
                    effectiveStatus === st
                      ? QUICK_ACTIVE[st]
                      : 'border-[#D4D4D8] text-[#A1A1AA] bg-white hover:bg-[#F5F5F5] hover:text-[#18181B]'
                  }`}
                >
                  {st === 'e'
                    ? (<><span className="sm:hidden">Excep.</span><span className="hidden sm:inline">Exception</span></>)
                    : QUICK_SHORT[st]}
                </button>
              )
            })}
            <button
              disabled={saving || !record}
              onClick={() => onClear(person.id)}
              title={record ? 'Clear this mark' : 'Nothing to clear'}
              className="w-6 sm:w-7 h-6 sm:h-7 border border-[#D4D4D8] text-[#A1A1AA] bg-white rounded-md hover:bg-[#F5F5F5] hover:text-[#18181B] transition-colors disabled:opacity-30 flex items-center justify-center"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </motion.div>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showCalendar && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowCalendar(false)}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0, y: 16 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 16 }}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
                  <Avatar
                    avatarUrl={person.avatar_url ?? null}
                    name={person.full_name}
                    size={32}
                    userId={person.kind === 'driver' ? person.id : undefined}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{person.full_name}</p>
                    {person.designation && <p className="text-[11px] text-slate-500 truncate">{person.designation}</p>}
                  </div>
                  <button
                    onClick={() => setShowCalendar(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="overflow-y-auto flex-1 px-4 py-4">
                  <StaffAttendanceCalendarDynamic
                    staffId={person.id}
                    staffName={person.full_name}
                    mode="self"
                    viewerUserId={viewerId}
                    fetchRecords={person.kind === 'ground' ? fetchGroundRecords : undefined}
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
  return (
    <div className="border border-[#E4E4E7] divide-y divide-[#F0F0EF] rounded-lg overflow-hidden">
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </div>
  )
}

// ── Section ──────────────────────────────────────────────────────────────────

export default function SupportStaffAttendanceReport({
  date, todayStr, viewerId, canEdit, dayOff = null, refreshKey = 0, onChanged,
}: Props) {
  const [groundRoster, setGroundRoster] = useState<SupportStaff[]>([])
  const [driverRoster, setDriverRoster] = useState<UserProfile[]>([])
  const [driverDesignations, setDriverDesignations] = useState<Record<string, string | null>>({})
  const [groundMonthRecords, setGroundMonthRecords] = useState<SupportAttendanceRecord[]>([])
  const [driverMonthRecords, setDriverMonthRecords] = useState<StaffAttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('absent')

  const isFuture = date > todayStr

  // `silent` skips the loading spinner — used after a quick mark/clear so the
  // list stays on screen and animates the row out instead of the whole tab
  // flashing to a spinner and back.
  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    const [ground, drivers] = await Promise.all([
      fetchSupportStaff({ activeOnly: true, trackedOnly: true }),
      fetchTrackedDrivers(),
    ])
    const driverIds = drivers.map(d => d.id)
    const [year, month] = date.split('-').map(Number)
    const [groundMonth, driverDetails, driverMonth] = await Promise.all([
      fetchSupportAttendanceRange(monthStartOf(date), date),
      fetchStaffDirectoryMap(driverIds),
      fetchMonthlyAttendanceRecords(driverIds, year, month),
    ])
    setGroundRoster(ground)
    setDriverRoster(drivers)
    setDriverDesignations(
      Object.fromEntries(drivers.map(d => [d.id, driverDetails[d.id]?.designation ?? null]))
    )
    setGroundMonthRecords(groundMonth)
    setDriverMonthRecords(driverMonth)
    setLoading(false)
  }, [date])

  // Full spinner only when the day actually changes (a different roster/
  // records to fetch). A `refreshKey` bump alone — e.g. from marking someone
  // here, which bumps the page-level refreshKey that both this and the main
  // staff report listen to — reloads the same day's data silently instead of
  // flashing the whole tab back to "Loading…".
  const lastLoadedDateRef = useRef<string | null>(null)
  useEffect(() => {
    const silent = lastLoadedDateRef.current === date
    lastLoadedDateRef.current = date
    load({ silent })
  }, [load, refreshKey, date])

  // Reset paging-adjacent input whenever the day changes, same as the main report.
  useEffect(() => { setQuery('') }, [date])

  // One merged, alphabetical roster — from an admin's point of view these are
  // the same kind of task (nobody here can check in for themselves), so they
  // share one list rather than two.
  const roster: SectionPerson[] = useMemo(() => {
    const ground: SectionPerson[] = groundRoster.map(s => ({
      id: s.id, kind: 'ground', full_name: s.full_name, designation: s.designation,
    }))
    const drivers: SectionPerson[] = driverRoster.map(d => ({
      id: d.id, kind: 'driver', full_name: d.full_name,
      designation: driverDesignations[d.id] ?? null,
      avatar_url: d.avatar_url,
    }))
    return [...ground, ...drivers].sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [groundRoster, driverRoster, driverDesignations])

  const personById = useMemo(() => new Map(roster.map(p => [p.id, p])), [roster])

  const dayRecords = useMemo(
    () => {
      const out: { support_staff_id: string; status: SupportAttendanceStatus }[] = []
      for (const r of groundMonthRecords) {
        if (r.date === date) out.push({ support_staff_id: r.support_staff_id, status: r.status })
      }
      for (const r of driverMonthRecords) {
        if (r.date !== date) continue
        const status = asSupportStatus(r.status)
        if (status) out.push({ support_staff_id: r.staff_id, status })
      }
      return out
    },
    [groundMonthRecords, driverMonthRecords, date],
  )

  const recordByStaff = useMemo(
    () => new Map(dayRecords.map(r => [r.support_staff_id, { status: r.status }])),
    [dayRecords],
  )

  // Anyone with no mark for the day yet — what "Mark All Present" fills in.
  // Leaves everyone who already has a mark (present, absent, on leave, …)
  // exactly as an admin set it.
  const unmarkedRoster = useMemo(
    () => roster.filter(p => !recordByStaff.has(p.id)),
    [roster, recordByStaff],
  )

  // Same rule AllStaffAttendanceReport uses for `shouldDeriveAbsents`: a whole-
  // school day off (holiday or non-working) suppresses derivation, and so does
  // a future date — otherwise a missing row is Absent.
  const shouldDeriveAbsents = !dayOff && !isFuture

  const stats = useMemo(
    () => computeSupportDayStats(roster, dayRecords, shouldDeriveAbsents),
    [roster, dayRecords, shouldDeriveAbsents],
  )

  const filterByQuery = useCallback((people: SectionPerson[]) => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter(p =>
      p.full_name?.toLowerCase().includes(q) || p.designation?.toLowerCase().includes(q)
    )
  }, [query])

  // ── Classification — same rule the main staff report uses: on_leave counts
  // as Absent, late counts as Present, half_day/exception are Irregular. An
  // unmarked person joins Absent too, once `shouldDeriveAbsents` says the day
  // has settled into a real absence (see AllStaffAttendanceReport's virtualAbsents).
  const absentRoster = useMemo(
    () => roster.filter(p => {
      const s = recordByStaff.get(p.id)?.status
      if (s === 'absent' || s === 'on_leave') return true
      return !s && shouldDeriveAbsents
    }),
    [roster, recordByStaff, shouldDeriveAbsents],
  )
  const presentRoster = useMemo(
    () => roster.filter(p => {
      const s = recordByStaff.get(p.id)?.status
      return s === 'present' || s === 'late'
    }),
    [roster, recordByStaff],
  )
  const irregularRoster = useMemo(
    () => roster.filter(p => {
      const s = recordByStaff.get(p.id)?.status
      return s === 'half_day' || s === 'e'
    }),
    [roster, recordByStaff],
  )
  const filteredAbsent = useMemo(() => filterByQuery(absentRoster), [absentRoster, filterByQuery])
  const filteredPresent = useMemo(() => filterByQuery(presentRoster), [presentRoster, filterByQuery])
  const filteredIrregular = useMemo(() => filterByQuery(irregularRoster), [irregularRoster, filterByQuery])

  const handleSet = async (id: string, status: SupportAttendanceStatus) => {
    const person = personById.get(id)
    if (!person) return
    setSavingId(id)
    const ok = person.kind === 'ground'
      ? await markSupportAttendance(id, date, status, viewerId)
      : await adminMarkStaffAttendance(id, date, status as StaffAttendanceStatus, viewerId)
    if (ok) { await load({ silent: true }); onChanged?.() }
    setSavingId(null)
  }

  const handleClear = async (id: string) => {
    const person = personById.get(id)
    if (!person) return
    setSavingId(id)
    const ok = person.kind === 'ground'
      ? await clearSupportAttendance(id, date)
      : await clearStaffAttendance(id, date)
    if (ok) { await load({ silent: true }); onChanged?.() }
    setSavingId(null)
  }

  // Fills in Present for everyone still unmarked today — same idea as the
  // homeroom attendance sheet's "All P", but since every mark here writes
  // straight to the DB (there's no local draft to bulk-save), this fires the
  // upserts directly rather than flipping local row state.
  const handleMarkAllPresent = async () => {
    if (unmarkedRoster.length === 0) return
    setMarkingAll(true)
    await Promise.all(unmarkedRoster.map(person =>
      person.kind === 'ground'
        ? markSupportAttendance(person.id, date, 'present', viewerId)
        : adminMarkStaffAttendance(person.id, date, 'present', viewerId)
    ))
    await load({ silent: true })
    onChanged?.()
    setMarkingAll(false)
  }

  return (
    <>
      {/* Summary strip — support staff + drivers only, no overlap with the
          school staff numbers */}
      <div className="border-b border-[#E4E4E7]">
        <div className="flex items-center gap-4 px-4 py-3">
          {dayOff ? (
            <div className="flex items-center gap-2 w-full">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${dayOff.kind === 'holiday' ? 'bg-violet-100' : 'bg-slate-100'}`}>
                {dayOff.kind === 'holiday'
                  ? <Umbrella size={16} className="text-violet-600" />
                  : <Ban size={16} className="text-slate-600" />}
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-bold truncate ${dayOff.kind === 'holiday' ? 'text-violet-800' : 'text-slate-800'}`}>{dayOff.name}</p>
                <p className={`text-[11px] ${dayOff.kind === 'holiday' ? 'text-violet-500' : 'text-slate-500'}`}>
                  {dayOff.kind === 'holiday' ? 'Holiday' : 'Non-working day'} · Support staff who came in can still be marked below
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-[#18181B] leading-none">
                  {loading ? '—' : stats.present}
                </span>
                <span className="text-sm font-medium text-[#A1A1AA]">/ {loading ? '…' : stats.total}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="h-1.5 bg-[#F0F0EF] rounded-full overflow-hidden">
                  <div className="h-full bg-lime-600 rounded-full transition-all" style={{ width: `${stats.present_pct}%` }} />
                </div>
                <p className="text-[11px] text-[#71717A] mt-1">
                  {stats.present_pct}% present · support staff & drivers
                  {stats.not_marked > 0 ? ` · ${stats.not_marked} not marked` : ''}
                </p>
              </div>
              {canEdit && unmarkedRoster.length > 0 && (
                <button
                  onClick={handleMarkAllPresent}
                  disabled={markingAll}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {markingAll
                    ? <Loader2 size={12} className="animate-spin" />
                    : <CheckSquare size={12} />}
                  <span className="hidden sm:inline">Mark All Present</span>
                  <span className="sm:hidden">All P</span>
                  <span className="opacity-70">({unmarkedRoster.length})</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* List */}
      <div className="p-3 sm:p-4 flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#A1A1AA]">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : roster.length === 0 ? (
          <div className="border border-[#E4E4E7] bg-[#FAFAF9] rounded-lg px-4 py-10 text-center">
            <HardHat size={30} className="text-[#D4D4D8] mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#18181B] mb-1">No Support Staff Yet</p>
            <p className="text-sm text-[#71717A] mb-3">
              Cleaning, maintenance, grounds staff and drivers are added by an admin — they have no self check-in of their own.
            </p>
            <Link
              href="/more/profiles/staff"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#D4D4D8] bg-white hover:bg-[#F5F5F5] rounded-lg transition-colors"
            >
              <HardHat size={13} /> Open Staff Profile Manager
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Inline tabs — pick one list at a time, same as the main staff report */}
            <div className="grid grid-cols-3 border-b border-[#E4E4E7]">
              {([
                { key: 'absent' as const,    label: 'Absent',    count: absentRoster.length,    color: 'border-red-600 text-red-600' },
                { key: 'present' as const,   label: 'Present',   count: presentRoster.length,   color: 'border-emerald-600 text-emerald-600' },
                { key: 'irregular' as const, label: 'Irregular', count: irregularRoster.length, color: 'border-amber-500 text-amber-600' },
              ]).map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center justify-center gap-1.5 pb-2 -mb-px text-xs font-semibold border-b-2 transition-colors ${
                    tab === t.key ? t.color : 'border-transparent text-[#A1A1AA] hover:text-[#52525B]'
                  }`}
                >
                  {t.label}
                  <span className={tab === t.key ? 'opacity-70' : 'text-[#D4D4D8]'}>{t.count}</span>
                </button>
              ))}
            </div>

            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search support staff & drivers…"
                className="w-full pl-8 pr-7 py-1.5 text-sm border border-[#D4D4D8] bg-white focus:outline-none focus:border-[#27272A] rounded-md"
              />
              {query && (
                <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#A1A1AA] hover:text-[#18181B]">
                  <X size={13} />
                </button>
              )}
            </div>

            {isFuture && (
              <p className="text-[11px] text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-2 rounded-lg">
                This day is in the future — attendance can still be recorded, but it usually means the date picker is ahead.
              </p>
            )}

            {/* ── Absent — on_leave + absent ── */}
            {tab === 'absent' && (
              filteredAbsent.length === 0 ? (
                <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                  {query ? `No absentees match "${query}".` : 'No one is marked absent for this day.'}
                </p>
              ) : (
                <RowList>
                  {filteredAbsent.map(person => (
                    <SupportRow
                      key={person.id}
                      person={person}
                      record={recordByStaff.get(person.id)}
                      derivedStatus={recordByStaff.get(person.id) ? undefined : 'absent'}
                      saving={savingId === person.id || markingAll}
                      canEdit={canEdit}
                      viewerId={viewerId}
                      onSet={handleSet}
                      onClear={handleClear}
                    />
                  ))}
                </RowList>
              )
            )}

            {/* ── Present — late (auto-counts as present) + checked-in present ── */}
            {tab === 'present' && (
              filteredPresent.length === 0 ? (
                <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                  {query ? `No present staff match "${query}".` : dayOff ? 'No one checked in on this day off.' : 'No one has been marked present yet.'}
                </p>
              ) : (
                <RowList>
                  {filteredPresent.map(person => (
                    <SupportRow
                      key={person.id}
                      person={person}
                      record={recordByStaff.get(person.id)}
                      saving={savingId === person.id || markingAll}
                      canEdit={canEdit}
                      viewerId={viewerId}
                      onSet={handleSet}
                      onClear={handleClear}
                    />
                  ))}
                </RowList>
              )
            )}

            {/* ── Irregular — half_day, exception ── */}
            {tab === 'irregular' && (
              filteredIrregular.length === 0 ? (
                <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                  {query ? `No irregular attendance matches "${query}".` : 'No irregular attendance for this day.'}
                </p>
              ) : (
                <RowList>
                  {filteredIrregular.map(person => (
                    <SupportRow
                      key={person.id}
                      person={person}
                      record={recordByStaff.get(person.id)}
                      saving={savingId === person.id || markingAll}
                      canEdit={canEdit}
                      viewerId={viewerId}
                      onSet={handleSet}
                      onClear={handleClear}
                    />
                  ))}
                </RowList>
              )
            )}
          </div>
        )}
      </div>
    </>
  )
}
