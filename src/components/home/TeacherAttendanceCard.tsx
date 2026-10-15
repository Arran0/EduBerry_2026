'use client'

import React, { useEffect, useState } from 'react'
import { Users, Briefcase } from 'lucide-react'
import { fetchMyTeamRosters, mergeTeamRosters } from '@/lib/teams'
import {
  fetchStaffAttendanceReportByDate,
  fetchStudentAttendanceStatusesForHomerooms,
  fetchHolidayByDate,
  STUDENT_PRESENT_STATUSES,
  STUDENT_ABSENT_STATUSES,
} from '@/lib/attendance'
import { fetchHomeroomsForClassTeacher } from '@/lib/homerooms'
import AttendanceScopesCard, { AttendanceScope } from './AttendanceScopesCard'

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
  const [teamNames, setTeamNames] = useState<string[]>([])
  const [homeroomNames, setHomeroomNames] = useState<string[]>([])
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
      setTeamNames(rosters.map(r => r.name))
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
      setHomeroomNames(homerooms.map(h => h.name))
      const studentRows = await fetchStudentAttendanceStatusesForHomerooms(homeroomIds, today)
      if (cancelled) return
      setStudentTally(tally(studentRows, STUDENT_PRESENT, STUDENT_ABSENT))
    })()
      .catch(err => console.error('Failed to load teacher attendance for home card:', err))
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [userId])

  const classLabel = homeroomNames.length > 0 ? homeroomNames.join(', ') : 'My class'
  const teamLabel = teamNames.length > 0 ? teamNames.join(', ') : 'My team'

  // Same card as the admin's, in the same design on phone and desktop: the
  // teacher's class (if they class-teach one) over their team(s). While the
  // fetch is out it shimmers both rows; the class row drops once it is known
  // there is no homeroom — the card's box is fixed, so nothing outside moves.
  const scopes: AttendanceScope[] | null = loading ? null : [
    ...(hasHomeroom && studentTally ? [{
      key: 'class', title: classLabel, icon: Users, tally: studentTally, href: '/more/attendance', hrefs: CLASS_HREFS,
    }] : []),
    ...(staffTally ? [{
      key: 'team', title: teamLabel, icon: Briefcase, tally: staffTally, href: '/more/staff-attendance', hrefs: TEAM_HREFS,
    }] : []),
  ]
  return <AttendanceScopesCard scopes={scopes} />
}
