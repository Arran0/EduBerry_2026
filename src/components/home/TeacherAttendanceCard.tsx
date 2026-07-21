'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, Briefcase, CheckCircle2, XCircle, AlertTriangle, ChevronRight } from 'lucide-react'
import { fetchTeamMembers } from '@/lib/tasks'
import {
  fetchStaffAttendanceReportByDate,
  fetchStudentAttendanceStatusesForHomerooms,
} from '@/lib/attendance'
import { fetchHomeroomsForClassTeacher } from '@/lib/homerooms'

interface Tally { present: number; absent: number; exception: number }

const STUDENT_PRESENT = new Set(['present', 'late', 'on_duty'])
const STUDENT_ABSENT = new Set(['absent', 'on_leave'])
const STAFF_PRESENT = new Set(['present', 'wfh', 'late'])
const STAFF_ABSENT = new Set(['absent', 'on_leave'])

function tally(rows: { status: string }[], present: Set<string>, absent: Set<string>): Tally {
  return {
    present: rows.filter(r => present.has(r.status)).length,
    absent: rows.filter(r => absent.has(r.status)).length,
    exception: rows.filter(r => !present.has(r.status) && !absent.has(r.status)).length,
  }
}

function Row({ icon, label, tally: t, href }: { icon: React.ReactNode; label: string; tally: Tally; href: string }) {
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
        <div className="flex flex-col items-center justify-center py-2.5 rounded-xl bg-emerald-50/90 border border-emerald-200/60">
          <CheckCircle2 size={13} className="text-emerald-500 mb-1" />
          <span className="text-xl font-black text-emerald-600 leading-none">{t.present}</span>
          <span className="text-[9.5px] font-semibold text-emerald-500 mt-1">Present</span>
        </div>
        <div className="flex flex-col items-center justify-center py-2.5 rounded-xl bg-red-50/90 border border-red-200/60">
          <XCircle size={13} className="text-red-400 mb-1" />
          <span className="text-xl font-black text-red-500 leading-none">{t.absent}</span>
          <span className="text-[9.5px] font-semibold text-red-400 mt-1">Absent</span>
        </div>
        <div className="flex flex-col items-center justify-center py-2.5 rounded-xl bg-amber-50/90 border border-amber-200/60">
          <AlertTriangle size={12} className="text-amber-400 mb-1" />
          <span className="text-xl font-black text-amber-500 leading-none">{t.exception}</span>
          <span className="text-[9.5px] font-semibold text-amber-400 mt-1">Irregular</span>
        </div>
      </div>
    </div>
  )
}

interface TeacherAttendanceCardProps {
  userId: string
}

/** Attendance snapshot for a regular teacher: staff counts for their team and
 *  student counts for the homeroom(s) they class-teach. Degrades to staff-only
 *  when they class-teach no homeroom. */
export default function TeacherAttendanceCard({ userId }: TeacherAttendanceCardProps) {
  const [staffTally, setStaffTally] = useState<Tally | null>(null)
  const [studentTally, setStudentTally] = useState<Tally | null>(null)
  const [hasHomeroom, setHasHomeroom] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]

    ;(async () => {
      const [team, homerooms, staffRecords] = await Promise.all([
        fetchTeamMembers(userId, 'teacher'),
        fetchHomeroomsForClassTeacher(userId),
        fetchStaffAttendanceReportByDate(today),
      ])
      if (cancelled) return

      const teamIds = new Set([userId, ...team.filter(m => !m.attendance_hidden && !m.is_banned).map(m => m.id)])
      setStaffTally(tally(staffRecords.filter(r => teamIds.has(r.staff_id)), STAFF_PRESENT, STAFF_ABSENT))

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
            <Row icon={<Users size={12} className="text-slate-500" />} label="My class" tally={studentTally} href="/more/attendance" />
          )}
          {staffTally && (
            <Row icon={<Briefcase size={12} className="text-slate-500" />} label="My team" tally={staffTally} href="/more/staff-attendance" />
          )}
        </div>
      )}
    </div>
  )
}
