'use client'

import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter, useSearchParams } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ClipboardList, Home, CheckCircle2, XCircle, BookOpen, Briefcase, TrendingUp, AlertCircle, Clock, MinusCircle, Plane, CalendarDays, ChevronLeft, ChevronRight, ChevronsRight, Users, X } from 'lucide-react'
import { ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import dynamic from 'next/dynamic'
const StaffAttendanceDashboard = dynamic(() => import('@/components/attendance/StaffAttendanceDashboard'))
const AttendanceCalendar       = dynamic(() => import('@/components/attendance/AttendanceCalendar'))
const HomeroomSearchField      = dynamic(() => import('@/components/attendance/HomeroomSearchField'))
import Avatar from '@/components/Avatar'
import { Homeroom, fetchHomeromsForStudent, fetchHomeroomsForClassTeacher } from '@/lib/homerooms'
import type { HomeroomFilterRef } from '@/components/attendance/HomeroomSearchField'
import {
  fetchAttendanceSummary,
  fetchStudentNonPresentByDate,
  fetchStudentPresentByDate,
  fetchStudentAbsenceStreaks,
  fetchHomeroomAttendanceCountsByDate,
  AttendanceSummary,
  StudentAttendanceEntry,
  HomeroomAttendanceCounts,
  ATTENDANCE_STATUS_LABELS,
} from '@/lib/attendance'

// ─── Student View skeletons ───────────────────────────────────────────────────

/** Placeholder for the academic-year overview stats bar while it loads. */
function YearlySummarySkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
        <div className="skeleton w-3.5 h-3.5 rounded" />
        <div className="skeleton h-2.5 w-40 rounded" />
      </div>
      <div className="grid grid-cols-4 divide-x divide-slate-100">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2 py-3 px-1">
            <div className="skeleton w-7 h-7 rounded-xl" />
            <div className="skeleton h-4 w-6 rounded" />
            <div className="skeleton h-2 w-10 rounded" />
          </div>
        ))}
      </div>
      <div className="px-4 pb-3 pt-3 border-t border-slate-100 space-y-2">
        <div className="flex items-center justify-between">
          <div className="skeleton h-2 w-24 rounded" />
          <div className="skeleton h-2 w-8 rounded" />
        </div>
        <div className="skeleton h-2 w-full rounded-full" />
      </div>
    </div>
  )
}

/** Placeholder for the monthly calendar while homerooms/records load. */
function CalendarSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
      <div className="bg-gradient-to-r from-violet-700 to-purple-600 px-4 sm:px-5 py-4 flex items-center justify-between">
        <div className="w-8 h-8 rounded-xl bg-white/15" />
        <div className="h-4 w-28 rounded bg-white/20" />
        <div className="w-8 h-8 rounded-xl bg-white/15" />
      </div>
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="py-2 flex justify-center">
            <div className="skeleton h-2 w-6 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 bg-white">
        {Array.from({ length: 35 }).map((_, i) => (
          <div
            key={i}
            className="h-14 border-b border-r border-slate-100 last:border-r-0 flex items-center justify-center"
          >
            <div className="skeleton w-7 h-7 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Full first-paint placeholder mirroring the student attendance layout. */
function StudentAttendanceSkeleton() {
  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Homeroom context card */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl">
        <div className="skeleton w-9 h-9 rounded-xl" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-2.5 w-32 rounded" />
          <div className="skeleton h-2 w-24 rounded" />
        </div>
        <div className="skeleton h-6 w-16 rounded-lg" />
      </div>
      <YearlySummarySkeleton />
      <div>
        <div className="skeleton h-2.5 w-28 rounded mb-2" />
        <CalendarSkeleton />
      </div>
    </div>
  )
}

// ─── Student View ─────────────────────────────────────────────────────────────

function StudentAttendanceView({ studentId, readOnly }: { studentId: string; readOnly?: boolean }) {
  const router = useRouter()
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [loadingHomerooms, setLoadingHomerooms] = useState(true)
  const [selectedHomeroomId, setSelectedHomeroomId] = useState<string | null>(null)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [yearlySummary, setYearlySummary] = useState<AttendanceSummary | null>(null)
  const [applyLeaveDate, setApplyLeaveDate] = useState<string | null>(null)

  useEffect(() => {
    fetchHomeromsForStudent(studentId).then(data => {
      setHomerooms(data)
      if (data.length > 0) setSelectedHomeroomId(data[0].id)
      setLoadingHomerooms(false)
    })
  }, [studentId])

  // Academic-year summary — reloads only when homeroom changes
  const loadYearlySummary = useCallback(async () => {
    if (!selectedHomeroomId) return
    const s = await fetchAttendanceSummary(studentId, selectedHomeroomId)
    setYearlySummary(s)
  }, [studentId, selectedHomeroomId])

  useEffect(() => { loadYearlySummary() }, [loadYearlySummary])

  const handleMonthChange = useCallback((y: number, m: number) => {
    setYear(y)
    setMonth(m)
  }, [])

  const handleHomeroomSelect = (id: string) => {
    setSelectedHomeroomId(id)
    setYearlySummary(null)
  }

  if (loadingHomerooms) {
    return <StudentAttendanceSkeleton />
  }

  if (homerooms.length === 0) {
    return (
      <div className="py-16 text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <ClipboardList size={28} className="text-slate-300" />
        </div>
        <p className="text-sm font-semibold text-slate-600 mb-1">No homeroom assigned</p>
        <p className="text-xs text-slate-400">Contact your administrator to be added to a homeroom.</p>
      </div>
    )
  }

  const selectedHomeroom = homerooms.find(h => h.id === selectedHomeroomId)

  return (
    <div className="space-y-3 sm:space-y-4 animate-fade-in">

      {/* ── Homeroom selector (multiple) ── */}
      {homerooms.length > 1 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-0.5">
            Your Homerooms
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {homerooms.map((hr: Homeroom) => {
              const active = selectedHomeroomId === hr.id
              return (
                <button
                  key={hr.id}
                  onClick={() => handleHomeroomSelect(hr.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors duration-150 text-left ${
                    active
                      ? 'bg-violet-600 text-white border-transparent'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${active ? 'bg-white/20' : 'bg-violet-100'}`}>
                    <Home size={15} className={active ? 'text-white' : 'text-violet-500'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`block font-bold text-[10px] ${active ? 'text-white' : 'text-slate-800'}`}>{hr.name}</span>
                    {(hr.grade || hr.section || hr.academic_year) && (
                      <span className={`block text-[9px] mt-0.5 font-medium ${active ? 'text-violet-200' : 'text-slate-400'}`}>
                        {hr.grade && hr.section ? `Grade ${hr.grade} · Section ${hr.section}` : hr.grade ? `Grade ${hr.grade}` : hr.section ?? ''}
                        {hr.academic_year ? (hr.grade || hr.section ? ` · AY ${hr.academic_year}` : `AY ${hr.academic_year}`) : ''}
                      </span>
                    )}
                  </div>
                  {active && (
                    <CheckCircle2 size={18} className="text-white/80 flex-shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ) : selectedHomeroom && (
        /* Single homeroom — context card */
        <div className="flex items-center gap-3 px-4 py-3 bg-violet-50/60 border border-violet-100 rounded-xl">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center flex-shrink-0 shadow-sm">
            <Home size={15} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-violet-800 text-[10px]">{selectedHomeroom.name}</p>
            {selectedHomeroom.grade && selectedHomeroom.section && (
              <p className="text-[10px] text-violet-500 font-medium">Grade {selectedHomeroom.grade} · Section {selectedHomeroom.section}</p>
            )}
          </div>
          {selectedHomeroom.academic_year && (
            <span className="text-[10px] px-2 py-1 rounded-lg bg-violet-100 text-violet-600 font-semibold flex-shrink-0">
              AY {selectedHomeroom.academic_year}
            </span>
          )}
        </div>
      )}

      {/* ── Yearly quick-stats bar ── */}
      {!yearlySummary && selectedHomeroomId && <YearlySummarySkeleton />}
      {yearlySummary && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden animate-fade-in">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <TrendingUp size={13} className="text-violet-500" />
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Academic Year Overview</p>
          </div>
          <div className="grid grid-cols-4 divide-x divide-slate-100">
            {[
              { icon: CheckCircle2, label: 'Present',  val: yearlySummary.present,   color: '#10b981', bg: '#ecfdf5' },
              { icon: XCircle,      label: 'Absent',   val: yearlySummary.absent,    color: '#f43f5e', bg: '#fff1f2' },
              { icon: Briefcase,    label: 'Late',     val: yearlySummary.late,      color: '#f59e0b', bg: '#fffbeb' },
              { icon: BookOpen,     label: 'Half Day', val: yearlySummary.half_day,  color: '#f97316', bg: '#fff7ed' },
            ].map(({ icon: Icon, label, val, color, bg }) => (
              <div key={label} className="flex flex-col items-center gap-1 py-3 px-1">
                <div className="w-7 h-7 rounded-xl flex items-center justify-center mb-0.5" style={{ background: bg }}>
                  <Icon size={13} style={{ color }} />
                </div>
                <span className="text-lg font-extrabold text-slate-800 leading-none">{val}</span>
                <span className="text-[9px] font-medium text-slate-400">{label}</span>
              </div>
            ))}
          </div>
          {/* Percentage bar */}
          <div className="px-4 pb-3 pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1.5">
              <span className="font-medium">Attendance rate</span>
              <span className="font-bold text-violet-600">{yearlySummary.present_pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${yearlySummary.present_pct}%`,
                  background: yearlySummary.present_pct >= 85 ? '#10b981' : yearlySummary.present_pct >= 75 ? '#f59e0b' : '#f43f5e',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Monthly calendar ── */}
      {selectedHomeroomId && (
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-0.5">Monthly Calendar</p>
          <AttendanceCalendar
            studentId={studentId}
            homeroomId={selectedHomeroomId}
            year={year}
            month={month}
            onMonthChange={handleMonthChange}
            onAppOpen={app => router.push(`/more/leave?openApp=${app.id}`)}
            onEmptyDayClick={readOnly ? undefined : dateStr => setApplyLeaveDate(dateStr)}
          />
        </div>
      )}

      {/* ── Apply-for-leave confirmation ── */}
      {applyLeaveDate && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setApplyLeaveDate(null)}
        >
          <div className="bg-white w-full max-w-xs rounded-2xl shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <p className="font-bold text-slate-800 text-sm">Apply for OD / Leave?</p>
              <p className="text-xs text-slate-500 mt-1">
                {new Date(applyLeaveDate + 'T12:00:00').toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric',
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setApplyLeaveDate(null)}
                className="flex-1 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  router.push(`/more/leave?newLeave=${applyLeaveDate}`)
                  setApplyLeaveDate(null)
                }}
                className="flex-1 py-2 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ─── All Student Attendance Report (managers only) ────────────────────────────

const STUDENT_STATUS_ICON: Record<string, React.ReactNode> = {
  present:  <CheckCircle2 size={13} className="text-emerald-500" />,
  absent:   <AlertCircle size={13} className="text-red-500" />,
  late:     <Clock size={13} className="text-amber-500" />,
  half_day: <MinusCircle size={13} className="text-orange-500" />,
  on_leave: <Plane size={13} className="text-blue-500" />,
  on_duty:  <Briefcase size={13} className="text-violet-500" />,
  excused:  <BookOpen size={13} className="text-purple-500" />,
}

const STUDENT_STATUS_PILL: Record<string, string> = {
  present:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  absent:   'bg-red-50 text-red-700 border-red-200',
  late:     'bg-amber-50 text-amber-700 border-amber-200',
  half_day: 'bg-orange-50 text-orange-700 border-orange-200',
  on_leave: 'bg-blue-50 text-blue-700 border-blue-200',
  on_duty:  'bg-violet-50 text-violet-700 border-violet-200',
  excused:  'bg-purple-50 text-purple-700 border-purple-200',
}

// Non-present statuses other than 'absent' — the "irregular" bucket. Absent has
// its own section so the three summary tiles map 1:1 onto the lists below them.
const IRREGULAR_ORDER = ['late', 'half_day', 'on_leave', 'on_duty', 'excused'] as const

const PRESENT_PAGE_SIZE = 30
const HOMEROOM_PAGE_SIZE = 30

type ReportView = 'homeroom' | 'student'
type ReportSection = 'present' | 'absent' | 'irregular'

const REPORT_ANCHOR = 'student-report'

const SECTION_ANCHOR: Record<ReportSection, string> = {
  present:   'student-present',
  absent:    'student-absent',
  irregular: 'student-irregular',
}

// Deep links into the report. `student-exceptions` is the pre-rename anchor and
// is kept so older links (and any bookmarks) still land on the irregular list.
const ANCHOR_SECTION: Record<string, ReportSection> = {
  'student-present':    'present',
  'student-absent':     'absent',
  'student-irregular':  'irregular',
  'student-exceptions': 'irregular',
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function StudentEntryRow({ entry, streak }: { entry: StudentAttendanceEntry; streak?: number }) {
  const { student } = entry
  const subtitle = entry.homeroom_name
    || [student.grade ? `Grade ${student.grade}` : '', student.section ? `Sec ${student.section}` : '']
        .filter(Boolean).join(' · ')
  const showStreak = streak !== undefined && streak >= 1 && (entry.status === 'absent' || entry.status === 'on_leave')

  const router = useRouter()
  const { user, profile } = useAuth()
  const [showModal, setShowModal] = useState(false)
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [homeroomId, setHomeroomId] = useState<string | null>(null)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [loadingHomerooms, setLoadingHomerooms] = useState(false)

  const handleOpenModal = async () => {
    setShowModal(true)
    if (homerooms.length === 0) {
      setLoadingHomerooms(true)
      const hrs = await fetchHomeromsForStudent(student.id)
      setHomerooms(hrs)
      if (hrs.length > 0) setHomeroomId(hrs[0].id)
      setLoadingHomerooms(false)
    }
  }

  return (
    <>
      {/* Single-line, compact row — keeps ~20 students on screen at once. */}
      <div className="flex items-center gap-2.5 px-3 sm:px-4 py-1 hover:bg-slate-50/70 transition-colors">
        <Avatar avatarUrl={student.avatar_url ?? null} name={student.full_name} email={student.email} size={24} userId={student.id} />
        <button
          onClick={handleOpenModal}
          className="flex-1 min-w-0 flex items-baseline gap-1.5 text-left"
        >
          <span className="text-[13px] font-semibold text-slate-800 truncate leading-tight hover:text-blue-600 hover:underline">
            {student.full_name}
          </span>
          {subtitle && <span className="text-[11px] text-slate-400 truncate hidden sm:inline">· {subtitle}</span>}
        </button>
        {showStreak && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${streak! >= 3 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
            {streak}d
          </span>
        )}
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border flex-shrink-0 ${STUDENT_STATUS_PILL[entry.status]}`}>
          {ATTENDANCE_STATUS_LABELS[entry.status]}
        </span>
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
                  <Avatar avatarUrl={student.avatar_url ?? null} name={student.full_name} email={student.email} size={32} userId={student.id} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{student.full_name}</p>
                    {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
                  </div>
                  <button
                    onClick={() => setShowModal(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
                {homerooms.length > 1 && (
                  <div className="px-5 pt-3 flex gap-2 flex-wrap flex-shrink-0">
                    {homerooms.map(hr => (
                      <button
                        key={hr.id}
                        onClick={() => setHomeroomId(hr.id)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${homeroomId === hr.id ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      >
                        {hr.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="overflow-y-auto flex-1 px-4 py-4">
                  {loadingHomerooms ? (
                    <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading calendar…</div>
                  ) : homeroomId ? (
                    <AttendanceCalendar
                      studentId={student.id}
                      homeroomId={homeroomId}
                      year={year}
                      month={month}
                      onMonthChange={(y: number, m: number) => { setYear(y); setMonth(m) }}
                      viewerUserId={user?.id}
                      viewerRole={profile?.role}
                      onAppOpen={app => { setShowModal(false); router.push(`/more/leave?openApp=${app.id}`) }}
                    />
                  ) : (
                    <div className="flex items-center justify-center py-16 text-slate-400 text-sm">No homeroom assigned.</div>
                  )}
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

/** Placeholder rows for the student-wise report body while it loads. */
function ReportBodySkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 2 }).map((_, g) => (
        <div key={g}>
          <div className="skeleton h-2.5 w-24 rounded mb-2" />
          <div className="rounded-lg border border-slate-200 overflow-hidden divide-y divide-slate-100">
            {Array.from({ length: g === 0 ? 4 : 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-3 sm:px-4 py-1">
                <div className="skeleton w-[24px] h-[24px] rounded-full flex-shrink-0" />
                <div className="skeleton h-2.5 w-2/5 rounded" />
                <div className="flex-1" />
                <div className="skeleton h-4 w-14 rounded-md flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Placeholder rows for the homeroom-wise report body while it loads. */
function HomeroomReportSkeleton() {
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden divide-y divide-slate-100">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-3 sm:px-4 h-8">
          <div className="skeleton h-2.5 w-1/3 rounded" />
          <div className="flex-1" />
          {Array.from({ length: 3 }).map((__, j) => (
            <div key={j} className="skeleton h-6 w-12 sm:w-16 rounded-md flex-shrink-0" />
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Homeroom-wise report ─────────────────────────────────────────────────────

const HOMEROOM_COUNT_STYLES: Record<ReportSection, string> = {
  present:   'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200',
  absent:    'text-red-700 bg-red-50 hover:bg-red-100 border-red-200',
  irregular: 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200',
}

/** One homeroom's tallies. The name and every count are buttons that jump into
 *  the student-wise view scoped to this homeroom (and to the matching section). */
function HomeroomCountsRow({
  row,
  onOpen,
}: {
  row: HomeroomAttendanceCounts
  onOpen: (row: HomeroomAttendanceCounts, section: ReportSection | null) => void
}) {
  const subtitle = [
    row.grade != null ? `Grade ${row.grade}` : '',
    row.section ? `Sec ${row.section}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 h-8 hover:bg-slate-50/70 transition-colors">
      <button
        onClick={() => onOpen(row, null)}
        className="group flex-1 min-w-0 flex items-baseline gap-1.5 text-left"
      >
        <span className="text-[13px] font-semibold text-slate-800 truncate group-hover:text-violet-600 group-hover:underline">
          {row.homeroom_name}
        </span>
        {subtitle && <span className="text-[11px] text-slate-400 truncate hidden sm:inline">· {subtitle}</span>}
        <ChevronsRight size={12} className="text-slate-300 group-hover:text-violet-500 flex-shrink-0" />
      </button>

      {row.marked === 0 ? (
        <span className="text-[11px] text-slate-400 font-medium px-2 whitespace-nowrap">Not marked</span>
      ) : (
        (['present', 'absent', 'irregular'] as const).map(section => (
          <button
            key={section}
            onClick={() => onOpen(row, section)}
            disabled={row[section] === 0}
            title={`View ${section} students in ${row.homeroom_name}`}
            className={`w-11 sm:w-16 h-6 rounded-md border text-[13px] font-bold leading-none transition-colors flex-shrink-0 disabled:opacity-40 disabled:pointer-events-none ${HOMEROOM_COUNT_STYLES[section]}`}
          >
            {row[section]}
          </button>
        ))
      )}
    </div>
  )
}

interface StudentAttendanceReportProps {
  /**
   * Limits the whole report to these homerooms. Class teachers pass the
   * homerooms they own; managers (admin/principal/coordinator) omit it and get
   * the whole school with a free-text homeroom filter instead.
   */
  scopeHomerooms?: Homeroom[]
}

function StudentAttendanceReport({ scopeHomerooms }: StudentAttendanceReportProps) {
  const todayStr = new Date().toISOString().split('T')[0]
  const [date, setDate] = useState(todayStr)
  const [homeroom, setHomeroom] = useState<HomeroomFilterRef | null>(null)
  const scoped = scopeHomerooms != null
  // A class teacher's scope is fixed — memoised so it doesn't re-trigger the
  // data effects on every render.
  const scopeIds = React.useMemo(
    () => (scopeHomerooms ? scopeHomerooms.map(h => h.id) : null),
    [scopeHomerooms]
  )
  // Homeroom-wise is the landing view; the student list is one click away.
  // With a single homeroom in scope that table would be one row — go straight
  // to the students instead.
  const [view, setView] = useState<ReportView>(
    scopeHomerooms && scopeHomerooms.length === 1 ? 'student' : 'homeroom'
  )
  const [pendingScroll, setPendingScroll] = useState<string | null>(null)

  const [irregulars, setIrregulars] = useState<StudentAttendanceEntry[]>([])
  const [loadingIrregular, setLoadingIrregular] = useState(true)
  const [streakMap, setStreakMap] = useState<Map<string, number>>(new Map())

  const [present, setPresent] = useState<StudentAttendanceEntry[]>([])
  const [presentTotal, setPresentTotal] = useState(0)
  const [loadingPresent, setLoadingPresent] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [homeroomRows, setHomeroomRows] = useState<HomeroomAttendanceCounts[]>([])
  const [homeroomTotal, setHomeroomTotal] = useState(0)
  const [loadingHomerooms, setLoadingHomerooms] = useState(true)
  const [loadingMoreHomerooms, setLoadingMoreHomerooms] = useState(false)

  // Picking one homeroom narrows the scope; otherwise the report covers the
  // class teacher's homerooms (scoped) or the whole school (managers).
  const hrId = homeroom?.id ?? scopeIds ?? null
  const dateInputRef = useRef<HTMLInputElement>(null)

  // A deep link (e.g. the home dashboard's Present / Absent / Irregular tiles)
  // is always a request for the student-wise list — open it instead of the
  // default homeroom view and scroll to the section it names.
  useEffect(() => {
    const section = ANCHOR_SECTION[window.location.hash.slice(1)]
    if (!section) return
    setView('student')
    setPendingScroll(SECTION_ANCHOR[section])
  }, [])

  // Reload everything whenever the date or homeroom scope changes. Both views
  // stay loaded so toggling between them is instant and the summary strip above
  // them reads the same in either one.
  useEffect(() => {
    let cancelled = false
    setLoadingIrregular(true)
    setLoadingPresent(true)
    setPresent([])
    setPresentTotal(0)
    setStreakMap(new Map())
    fetchStudentNonPresentByDate(date, hrId).then(async d => {
      if (cancelled) return
      setIrregulars(d)
      setLoadingIrregular(false)
      const absenceIds = [...new Set(
        d.filter(r => r.status === 'absent' || r.status === 'on_leave').map(r => r.student.id)
      )]
      if (absenceIds.length > 0) {
        const streaks = await fetchStudentAbsenceStreaks(absenceIds, date)
        if (!cancelled) setStreakMap(streaks)
      }
    })
    fetchStudentPresentByDate(date, hrId, 0, PRESENT_PAGE_SIZE).then(({ rows, total }) => {
      if (!cancelled) { setPresent(rows); setPresentTotal(total); setLoadingPresent(false) }
    })
    return () => { cancelled = true }
  }, [date, hrId])

  useEffect(() => {
    let cancelled = false
    setLoadingHomerooms(true)
    setHomeroomRows([])
    setHomeroomTotal(0)
    fetchHomeroomAttendanceCountsByDate(date, hrId, 0, HOMEROOM_PAGE_SIZE).then(({ rows, total }) => {
      if (!cancelled) { setHomeroomRows(rows); setHomeroomTotal(total); setLoadingHomerooms(false) }
    })
    return () => { cancelled = true }
  }, [date, hrId])

  const loadMorePresent = async () => {
    setLoadingMore(true)
    const { rows } = await fetchStudentPresentByDate(date, hrId, present.length, PRESENT_PAGE_SIZE)
    setPresent(p => [...p, ...rows])
    setLoadingMore(false)
  }

  const loadMoreHomerooms = async () => {
    setLoadingMoreHomerooms(true)
    const { rows } = await fetchHomeroomAttendanceCountsByDate(date, hrId, homeroomRows.length, HOMEROOM_PAGE_SIZE)
    setHomeroomRows(p => [...p, ...rows])
    setLoadingMoreHomerooms(false)
  }

  // Drill down from the homeroom table into the student list for that homeroom,
  // optionally landing on the section whose count was clicked.
  const openStudentView = (row: HomeroomAttendanceCounts, section: ReportSection | null) => {
    setHomeroom({ id: row.homeroom_id, name: row.homeroom_name })
    setView('student')
    // Clicking the homeroom name has no section to land on — bring the report
    // header into view instead, so the drill-down never leaves the user mid-page.
    setPendingScroll(section ? SECTION_ANCHOR[section] : REPORT_ANCHOR)
  }

  // Whole-school lists can name a student once per homeroom — dedupe to one row.
  const irregularList = (() => {
    if (homeroom) return irregulars
    const seen = new Set<string>()
    return irregulars.filter(r => { if (seen.has(r.student.id)) return false; seen.add(r.student.id); return true })
  })()

  const grouped: Record<string, StudentAttendanceEntry[]> = {}
  for (const r of irregularList) (grouped[r.status] ??= []).push(r)

  const absentGroup = grouped['absent'] ?? []
  const absentCount = absentGroup.length
  const irregularCount = irregularList.length - absentCount
  const loading = loadingIrregular || loadingPresent
  const isEmpty = !loading && irregularList.length === 0 && presentTotal === 0

  useEffect(() => {
    if (!pendingScroll || view !== 'student' || loading) return
    // The page banner expands with a spring animation, so a single scroll fired
    // now lands at a stale offset. Re-run across a few frames until the layout
    // settles so the target list reliably ends up in view.
    let raf = 0
    const scroll = () => {
      document.getElementById(pendingScroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    raf = requestAnimationFrame(scroll)
    const t1 = setTimeout(scroll, 250)
    const t2 = setTimeout(() => { scroll(); setPendingScroll(null) }, 650)
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2) }
  }, [pendingScroll, view, loading])

  const dateLabelFull = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })

  const summary = [
    { label: 'Present',   value: presentTotal,    color: '#10b981' },
    { label: 'Absent',    value: absentCount,     color: '#f43f5e' },
    { label: 'Irregular', value: irregularCount,  color: '#f59e0b' },
  ]

  return (
    <section id={REPORT_ANCHOR} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* ── Header ── */}
      <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold text-slate-800 text-base flex items-center gap-2">
              <ClipboardList size={16} className="text-violet-500" />
              {scoped ? 'My Class Attendance Report' : 'All Student Attendance Report'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {view === 'homeroom' ? 'Homeroom-wise' : 'Student-wise'} ·{' '}
              {homeroom
                ? homeroom.name
                : scoped
                  ? scopeHomerooms!.length === 1
                    ? scopeHomerooms![0].name
                    : `All my homerooms (${scopeHomerooms!.length})`
                  : 'Whole school'} · {dateLabelFull}
            </p>
          </div>

          {/* View toggle + date toggler */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Homeroom-wise / student-wise toggle */}
            <div className="inline-flex gap-0.5 bg-slate-100 rounded-xl p-1 flex-shrink-0">
              {([
                { key: 'homeroom' as const, label: 'Homerooms', icon: Home },
                { key: 'student'  as const, label: 'Students',  icon: Users },
              ]).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  aria-pressed={view === key}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    view === key
                      ? 'bg-white text-violet-600 shadow-sm ring-1 ring-slate-200/60'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon size={12} />
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
              <button
                onClick={() => setDate(d => shiftDate(d, -1))}
                className="w-9 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-colors"
                aria-label="Previous day"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => { const el = dateInputRef.current; if (!el) return; if (el.showPicker) el.showPicker(); else el.focus() }}
                className="relative h-10 px-3 flex items-center gap-2 border-x border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <CalendarDays size={15} className="text-slate-400" />
                <span className="text-sm font-medium whitespace-nowrap">
                  {date === todayStr ? 'Today' : date === shiftDate(todayStr, -1) ? 'Yesterday' : dateLabelFull}
                </span>
                <input
                  ref={dateInputRef}
                  type="date"
                  value={date}
                  max={todayStr}
                  onChange={e => { if (e.target.value) setDate(e.target.value) }}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="Pick a date"
                />
              </button>
              <button
                onClick={() => setDate(d => shiftDate(d, 1))}
                disabled={date >= todayStr}
                className="w-9 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                aria-label="Next day"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            {date !== todayStr && (
              <button
                onClick={() => setDate(todayStr)}
                className="h-10 px-3 text-sm font-medium text-violet-600 hover:bg-violet-50 rounded-lg transition-colors whitespace-nowrap"
              >
                Today
              </button>
            )}
          </div>
        </div>

        {/* Homeroom filter — free search across the school for managers, a chip
            row limited to their own homerooms for a class teacher. */}
        {!scoped ? (
          <div className="mt-2 max-w-md">
            <HomeroomSearchField selected={homeroom} onSelect={setHomeroom} />
          </div>
        ) : scopeHomerooms!.length > 1 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              onClick={() => setHomeroom(null)}
              aria-pressed={homeroom === null}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                homeroom === null
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-600'
              }`}
            >
              All my homerooms
            </button>
            {scopeHomerooms!.map(hr => (
              <button
                key={hr.id}
                onClick={() => setHomeroom({ id: hr.id, name: hr.name })}
                aria-pressed={homeroom?.id === hr.id}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  homeroom?.id === hr.id
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-600'
                }`}
              >
                {hr.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/40">
        {summary.map(s => (
          <div key={s.label} className="px-3 py-2 flex items-baseline justify-center gap-1.5">
            <p className="text-xl font-bold leading-none" style={{ color: s.color }}>
              {loading ? '—' : s.value}
            </p>
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="p-3 sm:p-4">
        {view === 'homeroom' ? (
          loadingHomerooms ? (
            <HomeroomReportSkeleton />
          ) : homeroomRows.length === 0 ? (
            <div className="py-10 text-center">
              <Home size={28} className="text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No homerooms to report on.</p>
            </div>
          ) : (
            <div className="animate-fade-in">
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                {/* Column headings */}
                <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 h-8 bg-slate-50 border-b border-slate-200">
                  <span className="flex-1 min-w-0 text-[10px] font-bold text-slate-400 uppercase tracking-wide">Homeroom</span>
                  {(['Present', 'Absent', 'Irregular'] as const).map(label => (
                    <span key={label} className="w-11 sm:w-16 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wide flex-shrink-0">
                      {label}
                    </span>
                  ))}
                </div>
                <div className="divide-y divide-slate-100">
                  {homeroomRows.map(row => (
                    <HomeroomCountsRow key={row.homeroom_id} row={row} onOpen={openStudentView} />
                  ))}
                </div>
              </div>
              {homeroomRows.length < homeroomTotal && (
                <button
                  onClick={loadMoreHomerooms}
                  disabled={loadingMoreHomerooms}
                  className="mt-3 w-full h-10 flex items-center justify-center gap-2 text-sm font-medium text-violet-600 border border-slate-200 rounded-lg hover:bg-violet-50 transition-colors disabled:opacity-60"
                >
                  {loadingMoreHomerooms
                    ? <><div className="spinner spinner-sm" /> Loading…</>
                    : <>Load more <span className="text-slate-400">· showing {homeroomRows.length} of {homeroomTotal}</span></>}
                </button>
              )}
            </div>
          )
        ) : loading ? (
          <ReportBodySkeleton />
        ) : isEmpty ? (
          <div className="py-10 text-center">
            <CalendarDays size={28} className="text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No attendance recorded for this date.</p>
          </div>
        ) : (
          <div className="space-y-6 animate-fade-in">
            {/* Absent */}
            {absentGroup.length > 0 && (
              <div id={SECTION_ANCHOR.absent}>
                <div className="flex items-center gap-1.5 mb-2">
                  {STUDENT_STATUS_ICON['absent']}
                  <span className="text-xs font-semibold text-slate-600">{ATTENDANCE_STATUS_LABELS['absent']}</span>
                  <span className="text-xs text-slate-400">({absentGroup.length})</span>
                </div>
                <div className="rounded-lg border border-slate-200 overflow-hidden divide-y divide-slate-100">
                  {absentGroup.map((r, i) => <StudentEntryRow key={`${r.student.id}-${r.homeroom_id}-${i}`} entry={r} streak={streakMap.get(r.student.id)} />)}
                </div>
              </div>
            )}

            {/* Irregular — every non-present status other than absent */}
            {irregularCount > 0 && (
              <div id={SECTION_ANCHOR.irregular} className="space-y-4">
                {IRREGULAR_ORDER.map(status => {
                  const group = grouped[status]
                  if (!group || group.length === 0) return null
                  return (
                    <div key={status}>
                      <div className="flex items-center gap-1.5 mb-2">
                        {STUDENT_STATUS_ICON[status]}
                        <span className="text-xs font-semibold text-slate-600">{ATTENDANCE_STATUS_LABELS[status]}</span>
                        <span className="text-xs text-slate-400">({group.length})</span>
                      </div>
                      <div className="rounded-lg border border-slate-200 overflow-hidden divide-y divide-slate-100">
                        {group.map((r, i) => <StudentEntryRow key={`${r.student.id}-${r.homeroom_id}-${i}`} entry={r} streak={streakMap.get(r.student.id)} />)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Present */}
            {presentTotal > 0 && (
              <div id={SECTION_ANCHOR.present}>
                <div className="flex items-center gap-1.5 mb-2">
                  {STUDENT_STATUS_ICON['present']}
                  <span className="text-xs font-semibold text-slate-600">Present</span>
                  <span className="text-xs text-slate-400">({presentTotal})</span>
                </div>
                <div className="rounded-lg border border-slate-200 overflow-hidden divide-y divide-slate-100">
                  {present.map((r, i) => <StudentEntryRow key={`${r.student.id}-${r.homeroom_id}-${i}`} entry={r} />)}
                </div>
                {present.length < presentTotal && (
                  <button
                    onClick={loadMorePresent}
                    disabled={loadingMore}
                    className="mt-3 w-full h-10 flex items-center justify-center gap-2 text-sm font-medium text-violet-600 border border-slate-200 rounded-lg hover:bg-violet-50 transition-colors disabled:opacity-60"
                  >
                    {loadingMore
                      ? <><div className="spinner spinner-sm" /> Loading…</>
                      : <>Load more <span className="text-slate-400">· showing {present.length} of {presentTotal}</span></>}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Staff View ───────────────────────────────────────────────────────────────

function StaffAttendanceView({ staffId }: { staffId: string }) {
  return <StaffAttendanceDashboard staffId={staffId} />
}

// ─── Page (inner content — isolated so useSearchParams is inside Suspense) ────

interface AttendanceContentProps {
  user: { id: string } | null
  isStaff: boolean
  isManager: boolean
  bannerEditing: boolean
}

function AttendanceContent({ user, isStaff, isManager, bannerEditing }: AttendanceContentProps) {
  const router = useRouter()
  // useSearchParams must live inside a <Suspense> boundary — see AttendancePage below
  const searchParams = useSearchParams()

  // When a staff member navigates with ?student=<id>, show that student's calendar read-only
  const studentParam = isStaff ? (searchParams?.get('student') ?? null) : null

  // A regular teacher (no manager access) gets the same student report as
  // managers, scoped to the homerooms they are the class teacher of.
  const isClassTeacherViewer = isStaff && !isManager
  const [myHomerooms, setMyHomerooms] = useState<Homeroom[] | null>(null)

  useEffect(() => {
    if (!isClassTeacherViewer || !user) { setMyHomerooms(null); return }
    let cancelled = false
    fetchHomeroomsForClassTeacher(user.id).then(hrs => { if (!cancelled) setMyHomerooms(hrs) })
    return () => { cancelled = true }
  }, [isClassTeacherViewer, user])

  return (
    <div
      className={`max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-6 transition-all duration-300 ${
        bannerEditing ? 'opacity-30 blur-[1px] pointer-events-none select-none' : ''
      }`}
    >
      {studentParam ? (
        <>
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ChevronLeft size={14} /> Back
          </button>
          <StudentAttendanceView studentId={studentParam} readOnly />
        </>
      ) : isStaff && user ? (
        <StaffAttendanceView staffId={user.id} />
      ) : user ? (
        <StudentAttendanceView studentId={user.id} />
      ) : null}

      {/* Student attendance report — whole school for managers, own homerooms
          for a class teacher. Teachers who class-teach nothing have no students
          to report on, so the section is left out for them. */}
      {!studentParam && isManager && <StudentAttendanceReport />}
      {!studentParam && isClassTeacherViewer && myHomerooms && myHomerooms.length > 0 && (
        <StudentAttendanceReport scopeHomerooms={myHomerooms} />
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isStaff = profile ? isStaffRole(profile.role) : false
  const isManager = profile?.role === 'admin' || profile?.role === 'principal' || profile?.role === 'coordinator'
  const [bannerEditing, setBannerEditing] = useState(false)

  return (
    <ProtectedLayout>
      <div data-page-theme="student-attendance">
        <PageBanner
          settingKey="attendance_banner"
          defaultBanner={ATTENDANCE_BANNER_DEFAULT}
          icon={<ClipboardList size={24} className="text-white" />}
          backgroundIcon={<ClipboardList size={180} className="text-white" />}
          title="Attendance"
          subtitle={isStaff ? 'Mark homeroom attendance sheets' : 'View your monthly attendance calendar'}
          maxWidth="max-w-6xl"
          isAdmin={isAdmin}
          onBack={() => router.back()}
          onEditingChange={setBannerEditing}
        />

        {/*
          Wrap AttendanceContent in Suspense so that useSearchParams() inside it
          has a boundary to bail out to during static prerendering. Without this,
          Next.js fails the build with "useSearchParams() should be wrapped in a
          suspense boundary". The fallback renders the skeleton that already exists
          for this page, so there's no layout shift.
        */}
        <Suspense fallback={<StudentAttendanceSkeleton />}>
          <AttendanceContent
            user={user}
            isStaff={isStaff}
            isManager={isManager}
            bannerEditing={bannerEditing}
          />
        </Suspense>
      </div>
    </ProtectedLayout>
  )
}
