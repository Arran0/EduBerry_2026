'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Avatar from '@/components/Avatar'
import { Search, X, Loader2, HardHat, Umbrella, Ban } from 'lucide-react'
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
  computeSupportPersonStats,
  groupSupportRecordsByStaff,
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
import { fetchStaffDetailsMap } from '@/lib/staffDetails'

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
// row is set by hand. Statuses are deliberately restricted to the five this
// tab offers (present/absent/late/half_day/on_leave) for both kinds — no WFH,
// no exception, since neither concept applies to either group.
//
// An unmarked person is NOT derived as absent the way the school-staff report
// derives it: a missing row means "not marked yet", not "away" — see
// computeSupportDayStats.
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

const QUICK_SET: SupportAttendanceStatus[] = ['present', 'absent', 'late', 'half_day', 'on_leave']

const QUICK_SHORT: Record<SupportAttendanceStatus, string> = {
  present: 'P', absent: 'A', late: 'Late', half_day: '½', on_leave: 'OL',
}

const QUICK_ACTIVE: Record<SupportAttendanceStatus, string> = {
  present:  'bg-emerald-600 text-white border-emerald-600',
  absent:   'bg-red-600 text-white border-red-600',
  late:     'bg-amber-500 text-white border-amber-500',
  half_day: 'bg-orange-500 text-white border-orange-500',
  on_leave: 'bg-blue-600 text-white border-blue-600',
}

// The only statuses this tab ever writes, for either kind of person — a
// driver's staff_attendance_records row is only ever trusted here if its
// status is one of these, so a stray wfh/e value (which this tab never
// writes, but nothing stops another admin screen from having) falls back to
// "not marked" rather than needing a pill of its own.
const SHARED_STATUSES = new Set<string>(['present', 'absent', 'late', 'half_day', 'on_leave'])
const asSupportStatus = (status: string): SupportAttendanceStatus | null =>
  SHARED_STATUSES.has(status) ? (status as SupportAttendanceStatus) : null

type Tab = 'all' | 'present' | 'absent' | 'unmarked'

function monthStartOf(date: string) {
  return `${date.slice(0, 7)}-01`
}

function shortName(name: string, max = 14) {
  return name.length > max ? `${name.slice(0, max).trimEnd()}…` : name
}

// ── One row (ground support staff or driver) ─────────────────────────────────

function SupportRow({
  person, record, monthRecords, saving, canEdit, onSet, onClear,
}: {
  person: SectionPerson
  record?: { status: SupportAttendanceStatus }
  monthRecords: { status: SupportAttendanceStatus }[]
  saving: boolean
  canEdit: boolean
  onSet: (id: string, status: SupportAttendanceStatus) => void
  onClear: (id: string) => void
}) {
  const mtd = useMemo(() => computeSupportPersonStats(monthRecords), [monthRecords])

  return (
    <div className="flex items-center gap-2 sm:gap-3 px-2.5 sm:px-4 py-2 bg-white hover:bg-[#FAFAF9] transition-colors">
      <Avatar
        avatarUrl={person.avatar_url ?? null}
        name={person.full_name}
        size={30}
        userId={person.kind === 'driver' ? person.id : undefined}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p title={person.full_name} className="text-sm font-semibold text-[#18181B] truncate leading-tight">
            {shortName(person.full_name)}
          </p>
          {saving && <Loader2 size={11} className="animate-spin text-[#B8983C] flex-shrink-0" />}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {person.designation && (
            <span className="text-[10px] text-[#A1A1AA] truncate max-w-[9rem]">{person.designation}</span>
          )}
          {mtd.marked_days > 0 && (
            <span
              title={`This month: ${mtd.present} present, ${mtd.late} late, ${mtd.half_day} half day, ${mtd.absent} absent, ${mtd.on_leave} on leave across ${mtd.marked_days} marked day${mtd.marked_days === 1 ? '' : 's'}`}
              className={`text-[10px] font-semibold px-1.5 py-0.5 border rounded ${
                mtd.present_pct >= 90 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : mtd.present_pct >= 75 ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-red-50 text-red-700 border-red-200'
              }`}
            >
              {mtd.present_pct}% MTD
            </span>
          )}
        </div>
      </div>

      {record ? (
        <span className={`${canEdit ? 'hidden sm:inline-block' : 'inline-block'} text-[10px] font-semibold px-2 py-0.5 border rounded-full flex-shrink-0 ${SUPPORT_ATTENDANCE_STATUS_PILL[record.status]}`}>
          {SUPPORT_ATTENDANCE_STATUS_LABELS[record.status]}
        </span>
      ) : (
        <span className={`${canEdit ? 'hidden sm:inline-block' : 'inline-block'} text-[10px] font-semibold px-2 py-0.5 border border-dashed border-[#D4D4D8] text-[#A1A1AA] rounded-full flex-shrink-0`}>
          Not marked
        </span>
      )}

      {canEdit && (
        <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
          {QUICK_SET.map(st => {
            const isWordLabel = st === 'late' || st === 'on_leave'
            return (
              <button
                key={st}
                disabled={saving}
                onClick={() => onSet(person.id, st)}
                title={SUPPORT_ATTENDANCE_STATUS_LABELS[st]}
                className={`h-6 sm:h-7 font-bold border rounded-md transition-colors disabled:opacity-40 active:scale-95 flex items-center justify-center ${
                  isWordLabel ? 'px-1.5 text-[7px] sm:text-[7.5px] uppercase tracking-tight' : 'w-6 sm:w-7 text-[10px] sm:text-xs'
                } ${
                  record?.status === st
                    ? QUICK_ACTIVE[st]
                    : 'border-[#D4D4D8] text-[#A1A1AA] bg-white hover:bg-[#F5F5F5] hover:text-[#18181B]'
                }`}
              >
                {QUICK_SHORT[st]}
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
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('all')

  const isFuture = date > todayStr

  const load = useCallback(async () => {
    setLoading(true)
    const [ground, drivers] = await Promise.all([
      fetchSupportStaff({ activeOnly: true, trackedOnly: true }),
      fetchTrackedDrivers(),
    ])
    const driverIds = drivers.map(d => d.id)
    const [year, month] = date.split('-').map(Number)
    const [groundMonth, driverDetails, driverMonth] = await Promise.all([
      fetchSupportAttendanceRange(monthStartOf(date), date),
      fetchStaffDetailsMap(driverIds),
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

  useEffect(() => { load() }, [load, refreshKey])

  // One merged, alphabetical roster — from an admin's point of view these are
  // the same kind of task (nobody here can check in for themselves), so they
  // share one list rather than two.
  const roster: SectionPerson[] = useMemo(() => {
    const ground: SectionPerson[] = groundRoster.map(s => ({
      id: s.id, kind: 'ground', full_name: s.full_name, designation: s.designation,
    }))
    const drivers: SectionPerson[] = driverRoster.map(d => ({
      id: d.id, kind: 'driver', full_name: d.full_name,
      designation: driverDesignations[d.id] || 'Driver',
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

  // Month-to-date rows per person, for the badge on each row.
  const monthByStaff = useMemo(() => {
    const map = new Map<string, { status: SupportAttendanceStatus }[]>(groupSupportRecordsByStaff(groundMonthRecords))
    for (const r of driverMonthRecords) {
      const status = asSupportStatus(r.status)
      if (!status) continue
      const list = map.get(r.staff_id)
      if (list) list.push({ status })
      else map.set(r.staff_id, [{ status }])
    }
    return map
  }, [groundMonthRecords, driverMonthRecords])

  const stats = useMemo(() => computeSupportDayStats(roster, dayRecords), [roster, dayRecords])

  const tabRoster = useMemo(() => {
    switch (tab) {
      case 'present':
        return roster.filter(p => {
          const s = recordByStaff.get(p.id)?.status
          return s === 'present' || s === 'late' || s === 'half_day'
        })
      case 'absent':
        return roster.filter(p => {
          const s = recordByStaff.get(p.id)?.status
          return s === 'absent' || s === 'on_leave'
        })
      case 'unmarked':
        return roster.filter(p => !recordByStaff.has(p.id))
      default:
        return roster
    }
  }, [tab, roster, recordByStaff])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tabRoster
    return tabRoster.filter(p =>
      p.full_name?.toLowerCase().includes(q) ||
      p.designation?.toLowerCase().includes(q)
    )
  }, [tabRoster, query])

  const handleSet = async (id: string, status: SupportAttendanceStatus) => {
    const person = personById.get(id)
    if (!person) return
    setSavingId(id)
    const ok = person.kind === 'ground'
      ? await markSupportAttendance(id, date, status, viewerId)
      : await adminMarkStaffAttendance(id, date, status as StaffAttendanceStatus, viewerId)
    if (ok) { await load(); onChanged?.() }
    setSavingId(null)
  }

  const handleClear = async (id: string) => {
    const person = personById.get(id)
    if (!person) return
    setSavingId(id)
    const ok = person.kind === 'ground'
      ? await clearSupportAttendance(id, date)
      : await clearStaffAttendance(id, date)
    if (ok) { await load(); onChanged?.() }
    setSavingId(null)
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
            <div className="grid grid-cols-4 border-b border-[#E4E4E7]">
              {([
                { key: 'all' as const,      label: 'All',        count: roster.length,     color: 'border-lime-600 text-lime-700' },
                { key: 'present' as const,  label: 'Present',    count: stats.present,     color: 'border-emerald-600 text-emerald-600' },
                { key: 'absent' as const,   label: 'Absent',     count: stats.absent + stats.on_leave, color: 'border-red-600 text-red-600' },
                { key: 'unmarked' as const, label: 'Not Marked', count: stats.not_marked,  color: 'border-[#71717A] text-[#52525B]' },
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

            {visible.length === 0 ? (
              <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                {query ? `No support staff or drivers match "${query}".` : 'Nobody in this list for the day.'}
              </p>
            ) : (
              <div className="border border-[#E4E4E7] divide-y divide-[#F0F0EF] rounded-lg overflow-hidden">
                {visible.map(person => (
                  <SupportRow
                    key={person.id}
                    person={person}
                    record={recordByStaff.get(person.id)}
                    monthRecords={monthByStaff.get(person.id) ?? []}
                    saving={savingId === person.id}
                    canEdit={canEdit}
                    onSet={handleSet}
                    onClear={handleClear}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
