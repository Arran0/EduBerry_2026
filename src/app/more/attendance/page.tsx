'use client'

import React, { Suspense, useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter, useSearchParams } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ClipboardList, Home, CheckCircle2, XCircle, BookOpen, Briefcase, TrendingUp, AlertCircle, Clock, MinusCircle, Plane, CalendarDays, ChevronLeft, ChevronsRight, Users, X, Search } from 'lucide-react'
import { ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import dynamic from 'next/dynamic'
const StaffAttendanceDashboard = dynamic(() => import('@/components/attendance/StaffAttendanceDashboard'))
const AttendanceCalendar       = dynamic(() => import('@/components/attendance/AttendanceCalendar'))
// The whole Student OD / Leave app, hosted here in a popup. Loaded on demand —
// its lists and form are dead weight until someone opens it.
const StudentLeaveModal = dynamic(() => import('@/components/leave/StudentLeaveModal'), {
  ssr: false,
  // Covers the gap while the chunk arrives, so the button feels like it fired.
  loading: () => (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 backdrop-blur-md">
      <div className="spinner" />
    </div>
  ),
})
import Avatar from '@/components/Avatar'
import { useStudentLeaveNotifications } from '@/hooks/useLeaveNotifications'
import type { LeaveApplicationWithDetails } from '@/lib/leave'
import { Homeroom, fetchAllHomerooms, fetchHomeromsForStudent, fetchHomeroomsForClassTeacher } from '@/lib/homerooms'
import { DateToggler, SmartSelect } from '@/components/workspace/ui'
import type { SmartOption } from '@/components/workspace/ui'
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

// ─── Leave host ───────────────────────────────────────────────────────────────

/**
 * How this page opens the Student OD / Leave app.
 *
 * Attendance and the leave that explains it are the same errand, so the page
 * hosts the whole leave app in a popup (see StudentLeaveModal) instead of
 * sending people to /more/leave — which is what let the separate home-page
 * icon go. Every leave link on this page goes through here: the calendar's
 * "view application", an empty day picked to apply on, and a student's
 * calendar in the report. Without a provider each one falls back to the old
 * navigation, so the pieces still work anywhere else they are used.
 */
interface LeaveHost {
  /** Opens one existing application in the popup. */
  openApplication: (app: LeaveApplicationWithDetails) => void
  /** Opens the popup on a new application prefilled for this date. */
  openNewApplication: (date: string) => void
}

const LeaveHostContext = React.createContext<LeaveHost | null>(null)

// ─── Student View ─────────────────────────────────────────────────────────────

function StudentAttendanceView({ studentId, readOnly, refreshKey = 0 }: { studentId: string; readOnly?: boolean; refreshKey?: number }) {
  const router = useRouter()
  const leaveHost = React.useContext(LeaveHostContext)
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
        <div className="bg-white border border-[#D4D4D8] rounded-xl p-3">
          <p className="text-[10px] font-bold text-[#525252] uppercase tracking-widest mb-2 px-0.5">
            Your Homerooms
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {homerooms.map((hr: Homeroom) => {
              const active = selectedHomeroomId === hr.id
              return (
                <button
                  key={hr.id}
                  onClick={() => handleHomeroomSelect(hr.id)}
                  aria-pressed={active}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors text-left ${
                    active
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-[#18181B] border-[#D4D4D8] hover:bg-[#F5F5F5]'
                  }`}
                >
                  <Home size={14} className={`flex-shrink-0 ${active ? 'text-white/80' : 'text-violet-500'}`} />
                  <div className="flex-1 min-w-0">
                    <span className={`block text-sm font-semibold truncate ${active ? 'text-white' : 'text-[#18181B]'}`}>{hr.name}</span>
                    {(hr.grade || hr.section || hr.academic_year) && (
                      <span className={`block text-[11px] truncate ${active ? 'text-violet-200' : 'text-[#A1A1AA]'}`}>
                        {hr.grade && hr.section ? `Grade ${hr.grade} · Section ${hr.section}` : hr.grade ? `Grade ${hr.grade}` : hr.section ?? ''}
                        {hr.academic_year ? (hr.grade || hr.section ? ` · AY ${hr.academic_year}` : `AY ${hr.academic_year}`) : ''}
                      </span>
                    )}
                  </div>
                  {active && <CheckCircle2 size={15} className="text-white/80 flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      ) : selectedHomeroom && (
        /* Single homeroom — context card */
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-white border border-[#D4D4D8] rounded-xl">
          <Home size={15} className="text-violet-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#18181B] truncate">{selectedHomeroom.name}</p>
            {selectedHomeroom.grade && selectedHomeroom.section && (
              <p className="text-[11px] text-[#A1A1AA]">Grade {selectedHomeroom.grade} · Section {selectedHomeroom.section}</p>
            )}
          </div>
          {selectedHomeroom.academic_year && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F5F5F5] border border-[#E4E4E7] text-[#71717A] font-medium flex-shrink-0">
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
            refreshKey={refreshKey}
            onMonthChange={handleMonthChange}
            onAppOpen={app => leaveHost
              ? leaveHost.openApplication(app)
              : router.push(`/more/leave?openApp=${app.id}`)}
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
                  if (leaveHost) leaveHost.openNewApplication(applyLeaveDate)
                  else router.push(`/more/leave?newLeave=${applyLeaveDate}`)
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

// Genuine irregularities only — late counts as present (shown at the top of
// the Present tab) and on_leave/on_duty count as absent/present respectively,
// the same split the staff report uses. Half day (and the rarely-used
// "excused") are what's actually left to review.
const IRREGULAR_ORDER = ['half_day', 'excused'] as const

const PRESENT_PAGE_SIZE = 30
const HOMEROOM_PAGE_SIZE = 30

/** The homeroom the report is currently scoped to, as the picker names it. */
interface HomeroomFilterRef {
  id: string
  name: string
}

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

// ── Shared list chrome ────────────────────────────────────────────────────────
// The same hairline-bordered surfaces the staff report uses, so both attendance
// screens read as one system: thin zinc rules, flat fills, no floating cards.

function RowList({ children }: { children: React.ReactNode }) {
  return <div className="border border-[#E4E4E7] divide-y divide-[#F0F0EF] rounded-lg overflow-hidden">{children}</div>
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">{children}</p>
}

function LoadMoreButton({
  loading, shown, total, onClick,
}: { loading: boolean; shown: number; total: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="mt-2 w-full py-2 text-sm font-medium text-[#18181B] bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors rounded-md disabled:opacity-60"
    >
      {loading
        ? 'Loading…'
        : <>Show more <span className="text-[#A1A1AA]">({total - shown} remaining)</span></>}
    </button>
  )
}

/** Small status heading above a grouped list — icon, label, count. */
function GroupLabel({ status, count }: { status: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      {STUDENT_STATUS_ICON[status]}
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#525252]">
        {ATTENDANCE_STATUS_LABELS[status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? status}
      </span>
      <span className="text-[11px] text-[#A1A1AA]">({count})</span>
    </div>
  )
}

interface StudentEntryRowProps {
  entry: StudentAttendanceEntry
  streak?: number
  /** Viewer identity, read once by the report rather than once per row. */
  viewerUserId?: string
  viewerRole?: string
  /** Stable handler, so the memo below isn't defeated on every parent render. */
  onAppOpen: (app: LeaveApplicationWithDetails) => void
}

/**
 * One student's row in the report.
 *
 * Memoised, and deliberately free of context reads: with a few hundred rows on
 * screen every keystroke in the report's search box re-renders the list, and a
 * row whose entry and streak haven't changed has nothing new to paint.
 */
const StudentEntryRow = React.memo(function StudentEntryRow({
  entry, streak, viewerUserId, viewerRole, onAppOpen,
}: StudentEntryRowProps) {
  const { student } = entry
  const subtitle = entry.homeroom_name
    || [student.grade ? `Grade ${student.grade}` : '', student.section ? `Sec ${student.section}` : '']
        .filter(Boolean).join(' · ')
  const showStreak = streak !== undefined && streak >= 1 && (entry.status === 'absent' || entry.status === 'on_leave')

  const [showModal, setShowModal] = useState(false)
  // Stays true through the closing animation, then clears — so a row nobody
  // opened never puts a portal in the document at all.
  const [portalMounted, setPortalMounted] = useState(false)
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [homeroomId, setHomeroomId] = useState<string | null>(null)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [loadingHomerooms, setLoadingHomerooms] = useState(false)

  const handleOpenModal = async () => {
    setPortalMounted(true)
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
      <div className="flex items-center gap-2.5 px-2.5 sm:px-4 py-1.5 bg-white hover:bg-[#FAFAF9] transition-colors">
        <Avatar avatarUrl={student.avatar_url ?? null} name={student.full_name} email={student.email} size={26} userId={student.id} />
        <button
          onClick={handleOpenModal}
          className="flex-1 min-w-0 flex items-baseline gap-1.5 text-left"
        >
          <span className="text-sm font-semibold text-[#18181B] truncate leading-tight hover:text-violet-600 hover:underline">
            {student.full_name}
          </span>
          {subtitle && <span className="text-[11px] text-[#A1A1AA] truncate hidden sm:inline">· {subtitle}</span>}
        </button>
        {showStreak && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${streak! >= 3 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
            {streak}d
          </span>
        )}
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${STUDENT_STATUS_PILL[entry.status]}`}>
          {ATTENDANCE_STATUS_LABELS[entry.status]}
        </span>
      </div>

      {portalMounted && typeof document !== 'undefined' && createPortal(
        <AnimatePresence onExitComplete={() => setPortalMounted(false)}>
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
                      viewerUserId={viewerUserId}
                      viewerRole={viewerRole}
                      onAppOpen={app => { setShowModal(false); onAppOpen(app) }}
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
})

/** Placeholder rows for the student-wise report body while it loads. */
function ReportBodySkeleton() {
  return (
    <div className="border border-[#E4E4E7] divide-y divide-[#F0F0EF] rounded-lg overflow-hidden">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2.5 sm:px-4 py-2">
          <div className="skeleton w-[26px] h-[26px] rounded-full flex-shrink-0" />
          <div className="skeleton h-2.5 w-2/5 rounded" />
          <div className="flex-1" />
          <div className="skeleton h-4 w-14 rounded-full flex-shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** Placeholder rows for the homeroom-wise report body while it loads. */
function HomeroomReportSkeleton() {
  return (
    <div className="border border-[#E4E4E7] divide-y divide-[#F0F0EF] rounded-lg overflow-hidden">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-2.5 sm:px-4 h-9">
          <div className="skeleton h-2.5 w-1/3 rounded" />
          <div className="flex-1" />
          {Array.from({ length: 3 }).map((__, j) => (
            <div key={j} className="skeleton h-6 w-11 sm:w-16 rounded-md flex-shrink-0" />
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

/** Inline tabs shared by the report body — Absent / Present / Irregular. */
const REPORT_TABS: { key: ReportSection; label: string; color: string }[] = [
  { key: 'absent',    label: 'Absent',    color: 'border-red-600 text-red-600' },
  { key: 'present',   label: 'Present',   color: 'border-emerald-600 text-emerald-600' },
  { key: 'irregular', label: 'Irregular', color: 'border-amber-500 text-amber-600' },
]

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
    <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 h-9 bg-white hover:bg-[#FAFAF9] transition-colors">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(row, null)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(row, null) } }}
        className="group flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
      >
        <span className="text-sm font-semibold text-[#18181B] truncate group-hover:text-violet-600 group-hover:underline">
          {row.homeroom_name}
        </span>
        {subtitle && <span className="text-[11px] text-[#A1A1AA] truncate hidden sm:inline">· {subtitle}</span>}
        {row.class_teacher && (
          <div className="items-center gap-1 min-w-0 flex-shrink-0 hidden md:flex">
            <Avatar
              avatarUrl={row.class_teacher.avatar_url}
              name={row.class_teacher.full_name}
              email={row.class_teacher.email}
              size={16}
              userId={row.class_teacher.id}
            />
            <span className="text-[11px] text-[#A1A1AA] truncate max-w-[8rem]">{row.class_teacher.full_name}</span>
          </div>
        )}
        <ChevronsRight size={12} className="text-[#D4D4D8] group-hover:text-violet-500 flex-shrink-0" />
      </div>

      {row.marked === 0 ? (
        <span className="text-[11px] text-[#A1A1AA] font-medium px-2 whitespace-nowrap">Not marked</span>
      ) : (
        (['present', 'absent', 'irregular'] as const).map(section => (
          <button
            key={section}
            onClick={() => onOpen(row, section)}
            disabled={row[section] === 0}
            title={`View ${section} students in ${row.homeroom_name}`}
            className={`w-11 sm:w-16 h-6 rounded-md border text-xs font-bold leading-none transition-colors flex-shrink-0 disabled:opacity-40 disabled:pointer-events-none ${HOMEROOM_COUNT_STYLES[section]}`}
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
  const router = useRouter()
  const leaveHost = React.useContext(LeaveHostContext)
  const { user, profile } = useAuth()
  // Read once here and handed down, so the rows stay memoisable.
  const openLeaveApp = useCallback((app: LeaveApplicationWithDetails) => {
    if (leaveHost) leaveHost.openApplication(app)
    else router.push(`/more/leave?openApp=${app.id}`)
  }, [leaveHost, router])

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
  // One list at a time in the student view, the same way the staff report works.
  const [activeTab, setActiveTab] = useState<ReportSection>('absent')
  // Free-text filter over whatever the active view is showing.
  const [query, setQuery] = useState('')

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

  // Options for the homeroom toggler beside the search box. A class teacher
  // picks among their own homerooms; managers get the whole school, loaded once
  // and filtered inside the dropdown rather than per keystroke.
  const [allHomerooms, setAllHomerooms] = useState<Homeroom[]>([])
  useEffect(() => {
    if (scoped) return
    let cancelled = false
    fetchAllHomerooms().then(hrs => { if (!cancelled) setAllHomerooms(hrs) })
    return () => { cancelled = true }
  }, [scoped])

  // `scopeHomerooms ?? []` builds a new array every render, which would make the
  // homeroomOptions memo below recompute every time. Memoise the choice itself.
  const pickerHomerooms = useMemo(
    () => (scoped ? (scopeHomerooms ?? []) : allHomerooms),
    [scoped, scopeHomerooms, allHomerooms],
  )
  const homeroomOptions: SmartOption[] = useMemo(() => {
    const opts = pickerHomerooms.map(h => ({
      value: h.id,
      label: h.name,
      sublabel: [
        h.grade != null ? `Grade ${h.grade}` : '',
        h.section ? `Sec ${h.section}` : '',
      ].filter(Boolean).join(' · ') || undefined,
    }))
    // Drilling in from the homeroom table can select a homeroom before the
    // manager-wide list has landed — carry it so the trigger still names it.
    if (homeroom && !opts.some(o => o.value === homeroom.id)) {
      opts.unshift({ value: homeroom.id, label: homeroom.name, sublabel: undefined })
    }
    return opts
  }, [pickerHomerooms, homeroom])
  // Shown whenever there is actually a choice to make.
  const showHomeroomPicker = !scoped || pickerHomerooms.length > 1

  const pickHomeroom = (id: string) => {
    if (!id) { setHomeroom(null); return }
    const hr = pickerHomerooms.find(h => h.id === id)
    if (hr) { setHomeroom({ id: hr.id, name: hr.name }); return }
    // Re-picking the carried-over selection above: leave it as it is.
    if (homeroom?.id !== id) setHomeroom(null)
  }

  // A deep link (e.g. the home dashboard's Present / Absent / Irregular tiles)
  // is always a request for the student-wise list — open it on the tab it names
  // instead of the default homeroom view.
  useEffect(() => {
    const section = ANCHOR_SECTION[window.location.hash.slice(1)]
    if (!section) return
    setView('student')
    setActiveTab(section)
    setPendingScroll(REPORT_ANCHOR)
  }, [])

  // A new day or a new homeroom scope invalidates whatever was typed.
  useEffect(() => { setQuery('') }, [date, hrId])

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
    if (section) setActiveTab(section)
    // Bring the report header into view so the drill-down never leaves the
    // user mid-page.
    setPendingScroll(REPORT_ANCHOR)
  }

  // Whole-school lists can name a student once per homeroom — dedupe to one
  // row, then split by status. Keyed on the fetched rows and the scope, so
  // typing in the search box doesn't redo any of it.
  const { irregularList, grouped } = useMemo(() => {
    let list = irregulars
    if (!homeroom) {
      const seen = new Set<string>()
      list = irregulars.filter(r => { if (seen.has(r.student.id)) return false; seen.add(r.student.id); return true })
    }
    const by: Record<string, StudentAttendanceEntry[]> = {}
    for (const r of list) (by[r.status] ??= []).push(r)
    return { irregularList: list, grouped: by }
  }, [irregulars, homeroom])

  // On leave counts as absent; late and on duty count as present — shown in
  // those tabs, not Irregular (matching the staff report's split).
  const absentGroup = useMemo(
    () => [...(grouped['absent'] ?? []), ...(grouped['on_leave'] ?? [])],
    [grouped]
  )
  const absentCount = absentGroup.length
  const lateGroup = useMemo(() => grouped['late'] ?? [], [grouped])
  const onDutyGroup = useMemo(() => grouped['on_duty'] ?? [], [grouped])
  const irregularCount = (grouped['half_day']?.length ?? 0) + (grouped['excused']?.length ?? 0)
  // Present total including the late/on-duty rows folded in above (those are
  // fetched in full, unlike the paged 'present' rows).
  const presentFullTotal = presentTotal + lateGroup.length + onDutyGroup.length
  const loading = loadingIrregular || loadingPresent
  const isEmpty = !loading && irregularList.length === 0 && presentTotal === 0

  // ── Search ────────────────────────────────────────────────────────────────
  // Filters the rows that are actually loaded. Absent and Irregular arrive in
  // full, so those tabs search the whole day; Present is paged, so it searches
  // what has been fetched so far — "Show more" widens it.
  const q = query.trim().toLowerCase()
  const matchesStudent = useCallback((e: StudentAttendanceEntry) => {
    if (!q) return true
    return (e.student.full_name ?? '').toLowerCase().includes(q)
      || (e.student.email ?? '').toLowerCase().includes(q)
  }, [q])

  const absentRows = useMemo(() => absentGroup.filter(matchesStudent), [absentGroup, matchesStudent])
  // Late, then on duty, at the top of the present list, ahead of the paged
  // 'present' rows.
  const presentRows = useMemo(
    () => [...lateGroup, ...onDutyGroup].filter(matchesStudent).concat(present.filter(matchesStudent)),
    [lateGroup, onDutyGroup, present, matchesStudent]
  )
  const irregularGroups = useMemo(
    () => IRREGULAR_ORDER
      .map(status => ({ status, rows: (grouped[status] ?? []).filter(matchesStudent) }))
      .filter(g => g.rows.length > 0),
    [grouped, matchesStudent]
  )

  const visibleHomeroomRows = useMemo(() => {
    if (!q) return homeroomRows
    return homeroomRows.filter(r =>
      r.homeroom_name.toLowerCase().includes(q)
      || (r.class_teacher?.full_name ?? '').toLowerCase().includes(q)
    )
  }, [homeroomRows, q])

  // Everyone with a record for the day — the denominator behind the rate bar.
  const markedTotal = presentFullTotal + absentCount + irregularCount
  const pct = markedTotal > 0 ? Math.round((presentFullTotal / markedTotal) * 100) : 0

  const scopeLabel = homeroom?.name ?? (scoped ? 'my homerooms' : 'whole school')

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

  const tabCounts: Record<ReportSection, number> = {
    absent:    absentCount,
    present:   presentFullTotal,
    irregular: irregularCount,
  }

  return (
    // On phones the report is full-bleed with square corners so the lists get
    // the whole screen; from sm up it settles back into a rounded card — the
    // same shape the staff report takes.
    <section
      id={REPORT_ANCHOR}
      className="-mx-4 sm:mx-0 border-y sm:border-x border-[#D4D4D8] bg-white rounded-none sm:rounded-xl overflow-hidden"
    >
      {/* ── Title strip — inherits --page-gradient-from/to from the page theme ── */}
      <div
        className="px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2"
        style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}
      >
        <h2 className="flex items-center gap-2 text-sm font-bold text-white min-w-0">
          <ClipboardList size={15} className="flex-shrink-0 text-white/70" />
          <span className="truncate">{scoped ? 'My Class Report' : 'Student Report'}</span>
        </h2>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Homeroom-wise / student-wise. Labels collapse to icons on phones so
              this shares one row with the date toggler at every width. */}
          <div className="inline-flex items-stretch rounded-lg overflow-hidden border border-white/25">
            {([
              { key: 'homeroom' as const, label: 'Homerooms', icon: Home },
              { key: 'student'  as const, label: 'Students',  icon: Users },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                aria-pressed={view === key}
                title={label}
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium transition-colors ${
                  view === key ? 'bg-white text-[#18181B]' : 'text-white/75 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon size={12} className="flex-shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

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

      {/* ── Summary strip ── */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-[#E4E4E7]">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-[#18181B] leading-none">
            {loading ? '—' : presentFullTotal}
          </span>
          <span className="text-sm font-medium text-[#A1A1AA]">/ {loading ? '…' : markedTotal}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="h-1.5 bg-[#F0F0EF] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: 'var(--page-gradient-from, #7c3aed)' }}
            />
          </div>
          <p className="text-[11px] text-[#71717A] mt-1 truncate">{pct}% present · {scopeLabel}</p>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="p-3 sm:p-4 space-y-4">
        {/* Inline tabs — one list at a time, instead of stacking all three */}
        {view === 'student' && (
          <div className="grid grid-cols-3 border-b border-[#E4E4E7]">
            {REPORT_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                aria-pressed={activeTab === t.key}
                className={`flex items-center justify-center gap-1.5 pb-2 -mb-px text-xs font-semibold border-b-2 transition-colors ${
                  activeTab === t.key ? t.color : 'border-transparent text-[#A1A1AA] hover:text-[#52525B]'
                }`}
              >
                {t.label}
                <span className={activeTab === t.key ? 'opacity-70' : 'text-[#D4D4D8]'}>
                  {loading ? '—' : tabCounts[t.key]}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Search + homeroom toggler */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={view === 'student' ? 'Search students…' : 'Search homerooms…'}
              className="w-full pl-8 pr-7 py-1.5 text-sm border border-[#D4D4D8] bg-white focus:outline-none focus:border-[#27272A] rounded-md"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#A1A1AA] hover:text-[#18181B]"
              >
                <X size={13} />
              </button>
            )}
          </div>
          {showHomeroomPicker && (
            <SmartSelect
              options={homeroomOptions}
              value={homeroom?.id ?? ''}
              onChange={pickHomeroom}
              allowClear
              align="right"
              placeholder={scoped ? 'All my homerooms' : 'All homerooms'}
              searchPlaceholder="Search homerooms…"
              emptyText="No homerooms"
              className="w-36 sm:w-48 flex-shrink-0"
              leadingIcon={<Home size={14} className="text-[#71717A] flex-shrink-0" />}
            />
          )}
        </div>

        {/* ── Homeroom-wise ── */}
        {view === 'homeroom' ? (
          loadingHomerooms ? (
            <HomeroomReportSkeleton />
          ) : (
            <div className="animate-fade-in">
              {visibleHomeroomRows.length === 0 ? (
                <EmptyNote>
                  {query ? `No homerooms match "${query}".` : 'No homerooms to report on.'}
                </EmptyNote>
              ) : (
                <div className="border border-[#E4E4E7] rounded-lg overflow-hidden">
                  {/* Column headings */}
                  <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 h-8 bg-[#FAFAF9] border-b border-[#E4E4E7]">
                    <span className="flex-1 min-w-0 text-[10px] font-bold text-[#A1A1AA] uppercase tracking-widest">Homeroom</span>
                    {(['Present', 'Absent', 'Irregular'] as const).map(label => (
                      <span key={label} className="w-11 sm:w-16 text-center text-[10px] font-bold text-[#A1A1AA] uppercase tracking-wide flex-shrink-0">
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="divide-y divide-[#F0F0EF]">
                    {visibleHomeroomRows.map(row => (
                      <HomeroomCountsRow key={row.homeroom_id} row={row} onOpen={openStudentView} />
                    ))}
                  </div>
                </div>
              )}
              {/* Kept visible while searching — the filter only sees loaded rows,
                  so paging in more is how you widen it. */}
              {homeroomRows.length < homeroomTotal && (
                <LoadMoreButton
                  loading={loadingMoreHomerooms}
                  shown={homeroomRows.length}
                  total={homeroomTotal}
                  onClick={loadMoreHomerooms}
                />
              )}
            </div>
          )
        ) : loading ? (
          <ReportBodySkeleton />
        ) : isEmpty ? (
          <EmptyNote>No attendance recorded for this date.</EmptyNote>
        ) : (
          <div className="animate-fade-in">
            {/* ── Absent ── */}
            {activeTab === 'absent' && (
              <div id={SECTION_ANCHOR.absent}>
                {absentRows.length === 0 ? (
                  <EmptyNote>
                    {query ? `No absentees match "${query}".` : 'No one is marked absent for this day.'}
                  </EmptyNote>
                ) : (
                  <RowList>
                    {absentRows.map((r, i) => (
                      <StudentEntryRow
                        key={`${r.student.id}-${r.homeroom_id}-${i}`}
                        entry={r}
                        streak={streakMap.get(r.student.id)}
                        viewerUserId={user?.id}
                        viewerRole={profile?.role}
                        onAppOpen={openLeaveApp}
                      />
                    ))}
                  </RowList>
                )}
              </div>
            )}

            {/* ── Present ── */}
            {activeTab === 'present' && (
              <div id={SECTION_ANCHOR.present}>
                {presentRows.length === 0 ? (
                  <EmptyNote>
                    {query ? `No present students match "${query}".` : 'No one is marked present for this day.'}
                  </EmptyNote>
                ) : (
                  <RowList>
                    {presentRows.map((r, i) => (
                      <StudentEntryRow
                        key={`${r.student.id}-${r.homeroom_id}-${i}`}
                        entry={r}
                        viewerUserId={user?.id}
                        viewerRole={profile?.role}
                        onAppOpen={openLeaveApp}
                      />
                    ))}
                  </RowList>
                )}
                {present.length < presentTotal && (
                  <LoadMoreButton
                    loading={loadingMore}
                    shown={present.length}
                    total={presentTotal}
                    onClick={loadMorePresent}
                  />
                )}
              </div>
            )}

            {/* ── Irregular — every non-present status other than absent ── */}
            {activeTab === 'irregular' && (
              <div id={SECTION_ANCHOR.irregular} className="space-y-4">
                {irregularGroups.length === 0 ? (
                  <EmptyNote>
                    {query ? `No irregular attendance matches "${query}".` : 'No irregular attendance for this day.'}
                  </EmptyNote>
                ) : (
                  irregularGroups.map(({ status, rows }) => (
                    <div key={status}>
                      <GroupLabel status={status} count={rows.length} />
                      <RowList>
                        {rows.map((r, i) => (
                          <StudentEntryRow
                            key={`${r.student.id}-${r.homeroom_id}-${i}`}
                            entry={r}
                            streak={streakMap.get(r.student.id)}
                            viewerUserId={user?.id}
                            viewerRole={profile?.role}
                            onAppOpen={openLeaveApp}
                          />
                        ))}
                      </RowList>
                    </div>
                  ))
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
  /** Bumped when the leave popup closes, so the calendars pick up its changes. */
  refreshKey: number
}

function AttendanceContent({ user, isStaff, isManager, bannerEditing, refreshKey }: AttendanceContentProps) {
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
          <StudentAttendanceView studentId={studentParam} readOnly refreshKey={refreshKey} />
        </>
      ) : isStaff && user ? (
        <StaffAttendanceView staffId={user.id} />
      ) : user ? (
        <StudentAttendanceView studentId={user.id} refreshKey={refreshKey} />
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
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isStudent = profile?.role === 'student'
  const isStaff = profile ? isStaffRole(profile.role) : false
  const isManager = profile?.role === 'admin' || profile?.role === 'principal' || profile?.role === 'coordinator'
  const [bannerEditing, setBannerEditing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  // Non-null while the OD / Leave app is open in its popup. The fields say what
  // it should open on: a prefilled new application, or one existing one.
  const [leavePopup, setLeavePopup] =
    useState<{ newDate?: string | null; appId?: string | null } | null>(null)

  const { count: leaveCount, refresh: refreshLeaveCount } =
    useStudentLeaveNotifications(user?.id ?? null, isStudent)

  // Leave lives in a popup on this page rather than behind its own home-page
  // icon: attendance and the leave that explains it are the same errand.
  const leaveHost: LeaveHost = React.useMemo(() => ({
    openApplication: (app: LeaveApplicationWithDetails) => setLeavePopup({ appId: app.id }),
    openNewApplication: (date: string) => setLeavePopup({ newDate: date }),
  }), [])

  // A decision made in the popup can change the calendars behind it (and the
  // badge), so refresh both on the way out.
  const closeLeavePopup = () => {
    setLeavePopup(null)
    refreshLeaveCount()
    setRefreshKey(k => k + 1)
  }

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
          onEditingChange={setBannerEditing}
          actions={
            <button
              onClick={() => setLeavePopup({})}
              title="Open Student OD / Leave"
              className="group relative flex items-center gap-2 sm:gap-2.5 pl-1.5 pr-3 sm:pr-4 py-1.5 rounded-full bg-white/95 hover:bg-white border border-white/70 shadow-[0_6px_20px_-6px_rgba(0,0,0,0.45)] hover:shadow-[0_10px_26px_-6px_rgba(0,0,0,0.5)] active:scale-95 transition-all"
            >
              <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-violet-500 to-purple-700 shadow-inner">
                <CalendarDays size={16} className="text-white" />
              </span>
              <span className="flex flex-col items-start leading-none">
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Open</span>
                <span className="text-[13px] sm:text-sm font-bold text-slate-900 whitespace-nowrap mt-0.5">Leave / OD</span>
              </span>
              {leaveCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[19px] h-[19px] px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold ring-2 ring-white shadow-sm">
                  {leaveCount > 9 ? '9+' : leaveCount}
                </span>
              )}
            </button>
          }
        />

        {/*
          Wrap AttendanceContent in Suspense so that useSearchParams() inside it
          has a boundary to bail out to during static prerendering. Without this,
          Next.js fails the build with "useSearchParams() should be wrapped in a
          suspense boundary". The fallback renders the skeleton that already exists
          for this page, so there's no layout shift.
        */}
        <Suspense fallback={<StudentAttendanceSkeleton />}>
          <LeaveHostContext.Provider value={leaveHost}>
            <AttendanceContent
              user={user}
              isStaff={isStaff}
              isManager={isManager}
              bannerEditing={bannerEditing}
              refreshKey={refreshKey}
            />
          </LeaveHostContext.Provider>
        </Suspense>
      </div>

      {/* Student OD / Leave, hosted here instead of on its own screen */}
      <AnimatePresence>
        {leavePopup && (
          <StudentLeaveModal
            initialNewDate={leavePopup.newDate ?? null}
            initialAppId={leavePopup.appId ?? null}
            onClose={closeLeavePopup}
          />
        )}
      </AnimatePresence>
    </ProtectedLayout>
  )
}
