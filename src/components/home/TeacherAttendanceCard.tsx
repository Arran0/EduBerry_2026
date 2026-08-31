'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, Briefcase, CheckCircle2, XCircle, AlertTriangle, ChevronRight } from 'lucide-react'
import { fetchMyTeamRosters, mergeTeamRosters } from '@/lib/teams'
import {
  fetchStaffAttendanceReportByDate,
  fetchStudentAttendanceStatusesForHomerooms,
  fetchHolidayByDate,
  STUDENT_PRESENT_STATUSES,
  STUDENT_ABSENT_STATUSES,
} from '@/lib/attendance'
import { fetchHomeroomsForClassTeacher } from '@/lib/homerooms'

interface Tally { present: number; absent: number; exception: number }

const STUDENT_PRESENT = STUDENT_PRESENT_STATUSES
const STUDENT_ABSENT = STUDENT_ABSENT_STATUSES
const STAFF_PRESENT = new Set(['present', 'wfh', 'late'])
const STAFF_ABSENT = new Set(['absent', 'on_leave'])

function tally(rows: { status: string }[], present: Set<string>, absent: Set<string>): Tally {
  return {
    present: rows.filter(r => present.has(r.status)).length,
    absent: rows.filter(r => absent.has(r.status)).length,
    exception: rows.filter(r => !present.has(r.status) && !absent.has(r.status)).length,
  }
}

const TILES = [
  {
    key: 'present' as const,
    icon: <CheckCircle2 size={13} className="text-emerald-500 mb-1" />,
    label: 'Present',
    box: 'bg-emerald-50/90 border-emerald-200/60 hover:bg-emerald-100/90 hover:border-emerald-300/70',
    value: 'text-emerald-600',
    caption: 'text-emerald-500',
  },
  {
    key: 'absent' as const,
    icon: <XCircle size={13} className="text-red-400 mb-1" />,
    label: 'Absent',
    box: 'bg-red-50/90 border-red-200/60 hover:bg-red-100/90 hover:border-red-300/70',
    value: 'text-red-500',
    caption: 'text-red-400',
  },
  {
    key: 'exception' as const,
    icon: <AlertTriangle size={12} className="text-amber-400 mb-1" />,
    label: 'Irregular',
    box: 'bg-amber-50/90 border-amber-200/60 hover:bg-amber-100/90 hover:border-amber-300/70',
    value: 'text-amber-500',
    caption: 'text-amber-400',
  },
]

/** One labelled block of three tiles. Every tile deep-links into the matching
 *  section of the report it summarises, the same way the admin card does. */
function Row({
  icon, label, tally: t, href, tileHrefs,
}: {
  icon: React.ReactNode
  label: string
  tally: Tally
  href: string
  /** Per-tile deep links, keyed by tile. */
  tileHrefs: Record<'present' | 'absent' | 'exception', string>
}) {
  return (
    <div className="px-4 pt-3 pb-2">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        </div>
        <Link href={href} className="flex items-center gap-0.5 text-[10px] font-semibold text-sky-600 hover:text-sky-700 transition-colors">
          View report <ChevronRight size={11} />
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {TILES.map(tile => (
          <Link
            key={tile.key}
            href={tileHrefs[tile.key]}
            className={`group flex flex-col items-center justify-center py-2.5 rounded-xl border active:scale-95 transition-all ${tile.box}`}
          >
            {tile.icon}
            <span className={`text-xl font-black leading-none ${tile.value}`}>{t[tile.key]}</span>
            <span className={`text-[9.5px] font-semibold mt-1 ${tile.caption}`}>{tile.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

const CLASS_HREFS = {
  present: '/more/attendance#student-present',
  absent: '/more/attendance#student-absent',
  exception: '/more/attendance#student-irregular',
}

const TEAM_HREFS = {
  present: '/more/staff-attendance#staff-present',
  absent: '/more/staff-attendance#staff-absent',
  exception: '/more/staff-attendance#staff-exceptions',
}

interface TeacherAttendanceCardProps {
  userId: string
}

/** Attendance snapshot for a regular teacher: staff counts aggregated across
 *  every team they belong to, and student counts for the homeroom(s) they
 *  class-teach. Degrades to staff-only when they class-teach no homeroom. */
export default function TeacherAttendanceCard({ userId }: TeacherAttendanceCardProps) {
  const [staffTally, setStaffTally] = useState<Tally | null>(null)
  const [studentTally, setStudentTally] = useState<Tally | null>(null)
  const [hasHomeroom, setHasHomeroom] = useState(false)
  const [teamCount, setTeamCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]

    ;(async () => {
      const [rosters, homerooms, staffRecords, holidayToday] = await Promise.all([
        fetchMyTeamRosters(userId),
        fetchHomeroomsForClassTeacher(userId),
        fetchStaffAttendanceReportByDate(today),
        fetchHolidayByDate(today),
      ])
      if (cancelled) return

      // Aggregate every team the teacher sits on — a member of two teams sees
      // one combined tally, with each teammate counted once.
      setTeamCount(rosters.length)
      const teamIds = new Set([
        userId,
        ...mergeTeamRosters(rosters)
          .filter(m => !m.attendance_hidden && !m.is_banned)
          .map(m => m.id),
      ])
      const teamRecords = staffRecords.filter(r => teamIds.has(r.staff_id))
      // Mirror the virtual-absent logic in the Staff Attendance report: on a
      // working day, teammates with no record yet count as absent too — the
      // report's "Absent" tab includes them, so this tile must match it (this
      // is what was under-counting for teachers sitting on several teams,
      // since a bigger roster makes an unmarked teammate far more likely).
      const recordedIds = new Set(teamRecords.map(r => r.staff_id))
      const virtualAbsentCount = holidayToday ? 0 : [...teamIds].filter(id => !recordedIds.has(id)).length
      const baseTally = tally(teamRecords, STAFF_PRESENT, STAFF_ABSENT)
      setStaffTally({ ...baseTally, absent: baseTally.absent + virtualAbsentCount })

      const homeroomIds = homerooms.map(h => h.id)
      setHasHomeroom(homeroomIds.length > 0)
      const studentRows = await fetchStudentAttendanceStatusesForHomerooms(homeroomIds, today)
      if (cancelled) return
      setStudentTally(tally(studentRows, STUDENT_PRESENT, STUDENT_ABSENT))
    })()
      .catch(err => console.error('Failed to load teacher attendance for home card:', err))
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [userId])

  return (
    <div className="glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="spinner" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-white/25">
          {hasHomeroom && studentTally && (
            <Row
              icon={<Users size={12} className="text-slate-500" />}
              label="My class"
              tally={studentTally}
              href="/more/attendance"
              tileHrefs={CLASS_HREFS}
            />
          )}
          {staffTally && (
            <Row
              icon={<Briefcase size={12} className="text-slate-500" />}
              label={teamCount > 1 ? `My teams (${teamCount})` : 'My team'}
              tally={staffTally}
              href="/more/staff-attendance"
              tileHrefs={TEAM_HREFS}
            />
          )}
        </div>
      )}
    </div>
  )
}
