'use client'

import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter, useSearchParams } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ClipboardList, Home, CheckCircle2, BookOpen, Briefcase, AlertCircle, Clock, MinusCircle, Plane, CalendarDays, ChevronLeft, ChevronsRight, Users, X, Search, Check } from 'lucide-react'
import { ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import dynamic from 'next/dynamic'
import DonutChart from '@/components/charts/DonutChart'
const StaffAttendanceDashboard = dynamic(() => import('@/components/attendance/StaffAttendanceDashboard'))
const AttendanceCalendar       = dynamic(() => import('@/components/attendance/AttendanceCalendar'))
// The whole Student OD / Leave app, hosted here in a popup. Loaded on demand —
// its lists and form are dead weight until someone opens it.
const StudentLeaveModal = dynamic(() => import('@/components/leave/StudentLeaveModal'), {
  ssr: false,
  // Covers the gap while the chunk arrives, so the button feels like it fired.
  // A plain dim, like the popup it stands in for — no backdrop-filter.
  loading: () => (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50">
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

/** The same width the Staff Attendance app uses, banner and body alike. */
const MAX_W = 'max-w-7xl'

const PRESENT_C = '#10b981'
const ABSENT_C = '#f43f5e'
const LATE_C = '#f59e0b'
const HALF_C = '#f97316'

// ─── Liquid Glass pieces ──────────────────────────────────────────────────────
// The home page's material: a glass sheet with colour under it, and solid
// content cards riding on top (.lg-pane / .lg-content in globals.css). The
// sheet here carries no backdrop-filter — popups open over this page, and a
// blurred layer under a fading popup is what made Chrome flash black.

/** Blurred colour under a sheet, in the page's accent and a status hue. */
function Ambient({ colors = ['var(--page-gradient-from, #7c3aed)', PRESENT_C] }: { colors?: string[] }) {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden rounded-[inherit] pointer-events-none">
      <div className="lg-ambient">
        {colors.map((c, i) => <span key={i} style={{ background: c }} />)}
      </div>
    </div>
  )
}

interface SegmentOption<T extends string> {
  key: T
  label: React.ReactNode
  icon?: React.ElementType
  /** Trailing figure, e.g. a tab's count. */
  count?: React.ReactNode
  /** Colour for the count when this option is selected. */
  tone?: string
  title?: string
}

/**
 * iOS-style segmented control: a recessed capsule and a white thumb that
 * slides to the picked option. The slide is the one piece of motion on the
 * page — it shows which way the view just changed.
 */
function Segmented<T extends string>({
  options, value, onChange, className = '', fill = false, ariaLabel,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
  /** Stretch every option to an equal share of the width. */
  fill?: boolean
  ariaLabel?: string
}) {
  const id = useId()
  return (
    <div role="group" aria-label={ariaLabel} className={`lg-seg ${fill ? 'w-full' : ''} ${className}`}>
      {options.map(o => {
        const active = o.key === value
        const Icon = o.icon
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            title={o.title}
            className={`lg-seg-btn isolate px-2.5 py-1 text-xs ${fill ? 'flex-1 min-w-0' : ''}`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="lg-seg-thumb"
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
              />
            )}
            {Icon && <Icon size={12} className="flex-shrink-0" />}
            <span className="truncate">{o.label}</span>
            {o.count != null && (
              <span
                className="tabular-nums font-bold"
                style={{ color: active ? o.tone : '#94a3b8' }}
              >
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Student View skeletons ───────────────────────────────────────────────────

/** Placeholder for the academic-year overview while it loads. */
function YearlySummarySkeleton() {
  return (
    <div className="lg-content p-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="skeleton h-2.5 w-28 rounded" />
        <div className="skeleton h-4 w-12 rounded-full" />
      </div>
      <div className="flex items-center gap-4">
        <div className="skeleton w-[104px] h-[104px] rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="skeleton h-2.5 w-16 rounded" />
              <div className="skeleton h-3 w-6 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Placeholder for the monthly calendar — the card's own shape, in grey. */
function CalendarSkeleton() {
  return (
    <div className="rounded-[20px] overflow-hidden bg-white ring-1 ring-slate-900/[0.06]">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-36 rounded" />
          <div className="skeleton h-3 w-44 rounded-full" />
        </div>
        <div className="skeleton w-8 h-8 rounded-full" />
        <div className="skeleton w-8 h-8 rounded-full" />
      </div>
      <div className="grid grid-cols-7 gap-1 px-1.5 pb-1.5 pt-6">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="h-[52px] rounded-xl bg-slate-50 flex items-center justify-center">
            <div className="skeleton w-6 h-6 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Full first-paint placeholder mirroring the student attendance layout. */
function StudentAttendanceSkeleton() {
  return (
    <div className="lg-pane p-2 sm:p-2.5">
      <div className="relative grid gap-2 sm:gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <div className="space-y-2 sm:space-y-2.5 lg:order-2">
          <div className="lg-content flex items-center gap-2.5 px-3 py-2.5">
            <div className="skeleton w-8 h-8 rounded-[10px]" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-2.5 w-32 rounded" />
              <div className="skeleton h-2 w-24 rounded" />
            </div>
          </div>
          <YearlySummarySkeleton />
        </div>
        <div className="lg:order-1"><CalendarSkeleton /></div>
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

function homeroomSubtitle(hr: Homeroom): string {
  return [
    hr.grade != null && hr.grade !== undefined ? `Grade ${hr.grade}` : '',
    hr.section ? `Section ${hr.section}` : '',
  ].filter(Boolean).join(' · ')
}

/** The year so far: a ring for the rate, the four tallies read off beside it. */
function YearOverview({ summary }: { summary: AttendanceSummary }) {
  const pct = summary.present_pct
  const rateTone = pct >= 85 ? 'text-emerald-700 bg-emerald-50' : pct >= 75 ? 'text-amber-700 bg-amber-50' : 'text-rose-700 bg-rose-50'
  const rows = [
    { label: 'Present',  value: summary.present,  color: PRESENT_C },
    { label: 'Absent',   value: summary.absent,   color: ABSENT_C },
    { label: 'Late',     value: summary.late,     color: LATE_C },
    { label: 'Half day', value: summary.half_day, color: HALF_C },
  ]
  const marked = rows.reduce((n, r) => n + r.value, 0)
  return (
    <div className="lg-content p-3 animate-fade-in">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[12px] font-semibold text-slate-500">This academic year</p>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums ${rateTone}`}>
          {pct}% attendance
        </span>
      </div>
      <div className="flex items-center gap-4">
        <DonutChart
          size={104}
          thickness={12}
          centerValue={marked > 0 ? `${pct}%` : '—'}
          centerLabel={marked > 0 ? 'present' : 'no records'}
          ariaLabel={`This academic year: ${summary.present} present, ${summary.absent} absent, ${summary.late} late, ${summary.half_day} half days.`}
          segments={rows.map(r => ({ label: r.label, value: r.value, color: r.color }))}
        />
        <dl className="flex-1 min-w-0 space-y-1.5">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }} />
              <dt className="flex-1 text-[12px] text-slate-500 truncate">{r.label}</dt>
              <dd className="text-[13px] font-bold text-slate-900 tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

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
      <div className="lg-pane py-14 text-center px-6">
        <Ambient />
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06] flex items-center justify-center mx-auto mb-3">
            <ClipboardList size={24} className="text-slate-300" />
          </div>
          <p className="text-sm font-semibold text-slate-700 mb-1">No homeroom yet</p>
          <p className="text-xs text-slate-500">Attendance shows here once an administrator adds you to a homeroom.</p>
        </div>
      </div>
    )
  }

  const selectedHomeroom = homerooms.find(h => h.id === selectedHomeroomId)

  return (
    // One glass sheet: the calendar is the reading surface, so on a desktop it
    // takes the wide column and the homeroom and the year's tally stack in a
    // narrow one beside it; on a phone they stack above it.
    <div className="lg-pane p-2 sm:p-2.5 animate-fade-in">
      <Ambient />
      <div className="relative grid gap-2 sm:gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:items-start">
        <div className="space-y-2 sm:space-y-2.5 lg:order-2">

          {/* ── Homeroom ── */}
          {homerooms.length > 1 ? (
            <div className="lg-content p-1.5">
              <p className="px-2 pt-1 pb-1.5 text-[12px] font-semibold text-slate-500">Your homerooms</p>
              <div className="space-y-0.5">
                {homerooms.map((hr: Homeroom) => {
                  const active = selectedHomeroomId === hr.id
                  const sub = [homeroomSubtitle(hr), hr.academic_year ? `AY ${hr.academic_year}` : ''].filter(Boolean).join(' · ')
                  return (
                    <button
                      key={hr.id}
                      onClick={() => handleHomeroomSelect(hr.id)}
                      aria-pressed={active}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-left transition-colors ${
                        active ? 'bg-slate-900/[0.05]' : 'hover:bg-slate-900/[0.03]'
                      }`}
                    >
                      <span
                        className="w-7 h-7 rounded-[9px] flex items-center justify-center flex-shrink-0"
                        style={active
                          ? { background: 'linear-gradient(135deg, var(--page-gradient-from, #7c3aed), var(--page-gradient-to, #a855f7))' }
                          : { background: '#f1f5f9' }}
                      >
                        <Home size={13} className={active ? 'text-white' : 'text-slate-400'} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-semibold text-slate-900 truncate">{hr.name}</span>
                        {sub && <span className="block text-[11px] text-slate-400 truncate">{sub}</span>}
                      </span>
                      {active && <Check size={15} className="text-slate-900 flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : selectedHomeroom && (
            <div className="lg-content flex items-center gap-2.5 px-3 py-2.5">
              <span
                className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 shadow-sm"
                style={{ background: 'linear-gradient(135deg, var(--page-gradient-from, #7c3aed), var(--page-gradient-to, #a855f7))' }}
              >
                <Home size={15} className="text-white" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-slate-900 truncate leading-tight">{selectedHomeroom.name}</p>
                {homeroomSubtitle(selectedHomeroom) && (
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">{homeroomSubtitle(selectedHomeroom)}</p>
                )}
              </div>
              {selectedHomeroom.academic_year && (
                <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold flex-shrink-0 tabular-nums">
                  AY {selectedHomeroom.academic_year}
                </span>
              )}
            </div>
          )}

          {/* ── The year so far ── */}
          {!yearlySummary && selectedHomeroomId && <YearlySummarySkeleton />}
          {yearlySummary && <YearOverview summary={yearlySummary} />}
        </div>

        {/* ── Monthly calendar ── */}
        {selectedHomeroomId && (
          <div className="lg:order-1 min-w-0">
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
      </div>

      {/* ── Apply-for-leave confirmation ── */}
      {applyLeaveDate && typeof document !== 'undefined' && createPortal(
        <div
          className="lg-scrim fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 animate-fade-in"
          onClick={() => setApplyLeaveDate(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Apply for OD or leave"
            className="lg-sheet relative w-full max-w-xs rounded-[26px] p-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="relative z-[3] space-y-3.5">
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center flex-shrink-0">
                <CalendarDays size={16} />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-slate-900 text-[15px] leading-tight">Apply for OD / leave?</p>
                <p className="text-xs text-slate-500 mt-1">
                  {new Date(applyLeaveDate + 'T12:00:00').toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric',
                  })}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setApplyLeaveDate(null)}
                className="flex-1 py-2 text-sm font-semibold text-slate-700 bg-white/80 ring-1 ring-slate-900/[0.06] rounded-xl hover:bg-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (leaveHost) leaveHost.openNewApplication(applyLeaveDate)
                  else router.push(`/more/leave?newLeave=${applyLeaveDate}`)
                  setApplyLeaveDate(null)
                }}
                className="flex-1 py-2 text-sm font-semibold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors"
              >
                Apply
              </button>
            </div>
            </div>
          </div>
        </div>,
        document.body
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
  present:  'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  absent:   'bg-red-50 text-red-700 ring-red-600/15',
  late:     'bg-amber-50 text-amber-700 ring-amber-600/20',
  half_day: 'bg-orange-50 text-orange-700 ring-orange-600/15',
  on_leave: 'bg-blue-50 text-blue-700 ring-blue-600/15',
  on_duty:  'bg-violet-50 text-violet-700 ring-violet-600/15',
  excused:  'bg-purple-50 text-purple-700 ring-purple-600/15',
}

// Genuine irregularities only — late counts as present (shown at the top of
// the Present tab) and on_leave/on_duty count as absent/present respectively,
// the same split the staff report uses. Half day (and the rarely-used
// "excused") are what's actually left to review.
const IRREGULAR_ORDER = ['half_day', 'excused'] as const

const PRESENT_PAGE_SIZE = 30
const HOMEROOM_PAGE_SIZE = 30
/** How long typing settles before a search goes to the database. */
const SEARCH_DEBOUNCE_MS = 250

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

/**
 * A list of student rows. One column on phones and laptops; two from xl up, so
 * a wide screen shows twice the students rather than twice the whitespace.
 * Hairlines are the 1px gaps of the grid showing the track colour through.
 */
function RowList({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <div className="grid xl:grid-cols-2 gap-px bg-slate-100 rounded-xl overflow-hidden ring-1 ring-slate-900/[0.06]">
      {children}
      {/* An odd count leaves the last cell of the two-column grid empty —
          fill it so the track colour doesn't show as a grey block. */}
      {count % 2 === 1 && <div aria-hidden className="hidden xl:block bg-white" />}
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500 bg-slate-50 ring-1 ring-slate-900/[0.05] px-3 py-3 rounded-xl">{children}</p>
}

function LoadMoreButton({
  loading, shown, total, onClick,
}: { loading: boolean; shown: number; total: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="mt-2 w-full py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors rounded-xl disabled:opacity-60"
    >
      {loading
        ? 'Loading…'
        : <>Show more <span className="font-normal text-slate-400">({total - shown} remaining)</span></>}
    </button>
  )
}

/** Small status heading above a grouped list — icon, label, count. */
function GroupLabel({ status, count }: { status: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
      {STUDENT_STATUS_ICON[status]}
      <span className="text-[12px] font-semibold text-slate-600">
        {ATTENDANCE_STATUS_LABELS[status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? status}
      </span>
      <span className="text-[11px] text-slate-400 tabular-nums">{count}</span>
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
      <div className="flex items-center gap-2.5 px-2.5 sm:px-3 py-1.5 bg-white hover:bg-slate-50 transition-colors min-w-0">
        <Avatar avatarUrl={student.avatar_url ?? null} name={student.full_name} email={student.email} size={26} userId={student.id} />
        <button
          onClick={handleOpenModal}
          title={`Open ${student.full_name}'s attendance calendar`}
          className="group flex-1 min-w-0 flex items-baseline gap-1.5 text-left"
        >
          <span className="text-[13px] font-semibold text-slate-900 truncate leading-tight group-hover:text-violet-700">
            {student.full_name}
          </span>
          {subtitle && <span className="text-[11px] text-slate-400 truncate hidden sm:inline">{subtitle}</span>}
        </button>
        {showStreak && (
          <span
            title={`${streak} school day${streak === 1 ? '' : 's'} absent in a row`}
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ring-1 flex-shrink-0 tabular-nums ${streak! >= 3 ? 'bg-red-50 text-red-600 ring-red-600/20' : 'bg-amber-50 text-amber-600 ring-amber-600/20'}`}
          >
            {streak}d
          </span>
        )}
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 flex-shrink-0 ${STUDENT_STATUS_PILL[entry.status]}`}>
          {ATTENDANCE_STATUS_LABELS[entry.status]}
        </span>
      </div>

      {portalMounted && typeof document !== 'undefined' && createPortal(
        <AnimatePresence onExitComplete={() => setPortalMounted(false)}>
          {showModal && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              // Plain dim, no backdrop-filter — a blurred layer fading in flashed black.
              className="lg-scrim fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-3 sm:p-4"
              onClick={() => setShowModal(false)}
            >
              <motion.div
                initial={{ scale: 0.97, opacity: 0, y: 16 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.97, opacity: 0, y: 12, transition: { duration: 0.14, ease: 'easeIn' } }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                role="dialog"
                aria-modal="true"
                aria-label={`${student.full_name}'s attendance`}
                className="lg-sheet relative rounded-[28px] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="relative z-[3] flex items-center gap-3 px-4 pt-4 pb-3 flex-shrink-0">
                  <Avatar avatarUrl={student.avatar_url ?? null} name={student.full_name} email={student.email} size={34} userId={student.id} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 text-[15px] truncate leading-tight">{student.full_name}</p>
                    {subtitle && <p className="text-[11px] text-slate-500 truncate mt-0.5">{subtitle}</p>}
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 flex-shrink-0 ${STUDENT_STATUS_PILL[entry.status]}`}>
                    {ATTENDANCE_STATUS_LABELS[entry.status]}
                  </span>
                  <button
                    onClick={() => setShowModal(false)}
                    aria-label="Close"
                    className="lg-control w-9 h-9 flex-shrink-0"
                  >
                    <X size={16} strokeWidth={2.4} />
                  </button>
                </div>
                {homerooms.length > 1 && homeroomId && (
                  <div className="relative z-[3] px-4 pb-2 flex-shrink-0 overflow-x-auto scrollbar-hide">
                    <Segmented
                      ariaLabel="Homeroom"
                      value={homeroomId}
                      onChange={setHomeroomId}
                      options={homerooms.map(hr => ({ key: hr.id, label: hr.name }))}
                    />
                  </div>
                )}
                <div className="relative z-[3] overflow-y-auto overscroll-contain flex-1 px-2 pb-2 sm:px-2.5 sm:pb-2.5">
                  {loadingHomerooms ? (
                    <CalendarSkeleton />
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
    <div className="grid xl:grid-cols-2 gap-px bg-slate-100 rounded-xl overflow-hidden ring-1 ring-slate-900/[0.06]">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2.5 sm:px-3 py-2 bg-white">
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
    <div className="rounded-xl overflow-hidden ring-1 ring-slate-900/[0.06] divide-y divide-slate-100 bg-white">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-2.5 sm:px-3 h-9">
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
  present:   'text-emerald-700 bg-emerald-50 hover:bg-emerald-100',
  absent:    'text-red-700 bg-red-50 hover:bg-red-100',
  irregular: 'text-amber-700 bg-amber-50 hover:bg-amber-100',
}

const SECTION_TONE: Record<ReportSection, string> = {
  present: '#047857',
  absent: '#b91c1c',
  irregular: '#b45309',
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
  const rate = row.marked > 0 ? Math.round((row.present / row.marked) * 100) : null

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 h-9 bg-white hover:bg-slate-50 transition-colors">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(row, null)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(row, null) } }}
        className="group flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
      >
        <span className="text-[13px] font-semibold text-slate-900 truncate group-hover:text-violet-700">
          {row.homeroom_name}
        </span>
        {subtitle && <span className="text-[11px] text-slate-400 truncate hidden sm:inline">{subtitle}</span>}
        {row.class_teacher && (
          <div className="items-center gap-1 min-w-0 flex-shrink-0 hidden md:flex">
            <Avatar
              avatarUrl={row.class_teacher.avatar_url}
              name={row.class_teacher.full_name}
              email={row.class_teacher.email}
              size={16}
              userId={row.class_teacher.id}
            />
            <span className="text-[11px] text-slate-400 truncate max-w-[9rem]">{row.class_teacher.full_name}</span>
          </div>
        )}
        <ChevronsRight size={12} className="text-slate-300 group-hover:text-violet-500 flex-shrink-0" />
      </div>

      {/* Rate — present share of whoever was marked; desktop only. */}
      <div className="hidden md:flex items-center gap-1.5 w-24 flex-shrink-0" title={rate == null ? 'Not marked' : `${rate}% present`}>
        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          {rate != null && (
            <div
              className="h-full rounded-full"
              style={{ width: `${rate}%`, background: rate >= 85 ? PRESENT_C : rate >= 75 ? LATE_C : ABSENT_C }}
            />
          )}
        </div>
        <span className="w-8 text-right text-[11px] font-semibold text-slate-500 tabular-nums">{rate == null ? '—' : `${rate}%`}</span>
      </div>

      {row.marked === 0 ? (
        <span className="w-[9rem] sm:w-[13rem] text-center text-[11px] text-slate-400 font-medium whitespace-nowrap flex-shrink-0">Not marked</span>
      ) : (
        (['present', 'absent', 'irregular'] as const).map(section => (
          <button
            key={section}
            onClick={() => onOpen(row, section)}
            disabled={row[section] === 0}
            title={`View ${section} students in ${row.homeroom_name}`}
            className={`w-11 sm:w-16 h-6 rounded-lg text-xs font-bold leading-none tabular-nums transition-colors flex-shrink-0 disabled:opacity-35 disabled:pointer-events-none ${HOMEROOM_COUNT_STYLES[section]}`}
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

  // ── Search ────────────────────────────────────────────────────────────────
  // `query` is what is in the box; `searchTerm` is the same text once typing
  // has settled, and it is what goes to the database. Lists that arrive whole
  // (absent, irregular) are filtered as you type; the paged ones (present
  // students, homerooms) are searched server-side, so a match that has not
  // been paged in yet is still found — it used to read "no results" until
  // "Show more" happened to pull it in.
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])
  /** A new day, scope or view starts with an empty box — cleared together, so
   *  no fetch ever pairs the new scope with the old text. */
  const clearSearch = () => { setQuery(''); setSearchTerm('') }
  const studentSearch = view === 'student' ? searchTerm : ''
  const homeroomSearch = view === 'homeroom' ? searchTerm : ''

  const [irregulars, setIrregulars] = useState<StudentAttendanceEntry[]>([])
  const [loadingIrregular, setLoadingIrregular] = useState(true)
  const [streakMap, setStreakMap] = useState<Map<string, number>>(new Map())

  const [present, setPresent] = useState<StudentAttendanceEntry[]>([])
  /** Rows the current present query (search included) matches. */
  const [presentTotal, setPresentTotal] = useState(0)
  /** Everyone present that day, unsearched — what the summary counts. */
  const [presentDayTotal, setPresentDayTotal] = useState(0)
  const [loadingPresent, setLoadingPresent] = useState(true)
  const [searchingPresent, setSearchingPresent] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [homeroomRows, setHomeroomRows] = useState<HomeroomAttendanceCounts[]>([])
  const [homeroomTotal, setHomeroomTotal] = useState(0)
  const [loadingHomerooms, setLoadingHomerooms] = useState(true)
  const [searchingHomerooms, setSearchingHomerooms] = useState(false)
  const [loadingMoreHomerooms, setLoadingMoreHomerooms] = useState(false)

  // Picking one homeroom narrows the scope; otherwise the report covers the
  // class teacher's homerooms (scoped) or the whole school (managers).
  const hrId = homeroom?.id ?? scopeIds ?? null
  const scopeKey = `${date}|${Array.isArray(hrId) ? hrId.join(',') : hrId ?? ''}`

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
    clearSearch()
    if (!id) { setHomeroom(null); return }
    const hr = pickerHomerooms.find(h => h.id === id)
    if (hr) { setHomeroom({ id: hr.id, name: hr.name }); return }
    // Re-picking the carried-over selection above: leave it as it is.
    if (homeroom?.id !== id) setHomeroom(null)
  }

  const changeDate = (d: string) => { clearSearch(); setDate(d) }
  const changeView = (v: ReportView) => { if (v !== view) clearSearch(); setView(v) }

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

  // Absent and irregular arrive whole for the day and scope (searched in the
  // browser); they reload only when the day or the scope changes.
  useEffect(() => {
    let cancelled = false
    setLoadingIrregular(true)
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
    return () => { cancelled = true }
  }, [date, hrId])

  // Present students, paged and searched in the database. A new day or scope
  // redraws the list from a skeleton; a new search keeps the rows on screen
  // and shows the box's spinner until the answer lands.
  const presentScope = useRef('')
  useEffect(() => {
    let cancelled = false
    const scopeChanged = presentScope.current !== scopeKey
    presentScope.current = scopeKey
    if (scopeChanged) {
      setLoadingPresent(true)
      setPresent([])
      setPresentTotal(0)
    } else {
      setSearchingPresent(true)
    }
    fetchStudentPresentByDate(date, hrId, 0, PRESENT_PAGE_SIZE, studentSearch).then(({ rows, total }) => {
      if (cancelled) return
      setPresent(rows)
      setPresentTotal(total)
      if (!studentSearch) setPresentDayTotal(total)
      setLoadingPresent(false)
      setSearchingPresent(false)
    })
    return () => { cancelled = true }
  // scopeKey is derived from date + hrId, both listed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, hrId, studentSearch])

  // Homeroom tallies — paged and searched in the database, same rules as above.
  const homeroomScope = useRef('')
  useEffect(() => {
    let cancelled = false
    const scopeChanged = homeroomScope.current !== scopeKey
    homeroomScope.current = scopeKey
    if (scopeChanged) {
      setLoadingHomerooms(true)
      setHomeroomRows([])
      setHomeroomTotal(0)
    } else {
      setSearchingHomerooms(true)
    }
    fetchHomeroomAttendanceCountsByDate(date, hrId, 0, HOMEROOM_PAGE_SIZE, homeroomSearch).then(({ rows, total }) => {
      if (cancelled) return
      setHomeroomRows(rows)
      setHomeroomTotal(total)
      setLoadingHomerooms(false)
      setSearchingHomerooms(false)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, hrId, homeroomSearch])

  const loadMorePresent = async () => {
    setLoadingMore(true)
    const { rows } = await fetchStudentPresentByDate(date, hrId, present.length, PRESENT_PAGE_SIZE, studentSearch)
    setPresent(p => [...p, ...rows])
    setLoadingMore(false)
  }

  const loadMoreHomerooms = async () => {
    setLoadingMoreHomerooms(true)
    const { rows } = await fetchHomeroomAttendanceCountsByDate(date, hrId, homeroomRows.length, HOMEROOM_PAGE_SIZE, homeroomSearch)
    setHomeroomRows(p => [...p, ...rows])
    setLoadingMoreHomerooms(false)
  }

  // Drill down from the homeroom table into the student list for that homeroom,
  // optionally landing on the section whose count was clicked.
  const openStudentView = (row: HomeroomAttendanceCounts, section: ReportSection | null) => {
    clearSearch()
    setHomeroom({ id: row.homeroom_id, name: row.homeroom_name })
    setView('student')
    if (section) setActiveTab(section)
    // Bring the report header into view so the drill-down never leaves the
    // user mid-page.
    setPendingScroll(REPORT_ANCHOR)
  }

  /** The summary's figures double as a way into the matching list. */
  const openSection = (section: ReportSection) => {
    changeView('student')
    setActiveTab(section)
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
  const presentFullTotal = presentDayTotal + lateGroup.length + onDutyGroup.length
  const loading = loadingIrregular || loadingPresent
  const isEmpty = !loading && irregularList.length === 0 && presentDayTotal === 0

  // Typed text filters the whole-day lists at once; the paged present rows
  // are already the database's answer for `searchTerm`.
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
    () => [...lateGroup, ...onDutyGroup].filter(matchesStudent).concat(present),
    [lateGroup, onDutyGroup, present, matchesStudent]
  )
  const irregularGroups = useMemo(
    () => IRREGULAR_ORDER
      .map(status => ({ status, rows: (grouped[status] ?? []).filter(matchesStudent) }))
      .filter(g => g.rows.length > 0),
    [grouped, matchesStudent]
  )

  // Waiting on the database for the text in the box.
  const searchPending = query.trim() !== searchTerm
    || (view === 'student' ? searchingPresent : searchingHomerooms)

  // Everyone with a record for the day — the denominator behind the rate.
  const markedTotal = presentFullTotal + absentCount + irregularCount
  const pct = markedTotal > 0 ? Math.round((presentFullTotal / markedTotal) * 100) : 0

  const scopeLabel = homeroom?.name ?? (scoped ? 'My homerooms' : 'Whole school')
  const dateLabel = date === todayStr
    ? 'Today'
    : new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

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

  const summaryStats: { key: ReportSection; label: string; color: string }[] = [
    { key: 'present',   label: 'Present',   color: PRESENT_C },
    { key: 'absent',    label: 'Absent',    color: ABSENT_C },
    { key: 'irregular', label: 'Irregular', color: LATE_C },
  ]

  return (
    // On phones the report is full-bleed with square corners so the lists get
    // the whole screen; from sm up it is a rounded glass sheet like the
    // student view above it.
    <section
      id={REPORT_ANCHOR}
      className="lg-pane -mx-4 sm:mx-0 !rounded-none sm:!rounded-[28px] scroll-mt-4"
    >
      <Ambient colors={['var(--page-gradient-from, #7c3aed)', ABSENT_C]} />

      <div className="relative">
        {/* ── Header: what this is, which way it is cut, and which day ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 pt-3 pb-2.5">
          {/* min-w lets the controls drop to their own row on a phone rather
              than squeezing the title to an ellipsis. */}
          <div className="flex items-center gap-2.5 min-w-[12rem] flex-1">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
              style={{ background: 'linear-gradient(135deg, var(--page-gradient-from, #7c3aed), var(--page-gradient-to, #a855f7))' }}
            >
              <ClipboardList size={17} className="text-white" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900 leading-tight truncate">
                {scoped ? 'My class report' : 'Student report'}
              </h2>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">{scopeLabel} · {dateLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
            <Segmented
              ariaLabel="Report view"
              value={view}
              onChange={changeView}
              options={[
                { key: 'homeroom', label: <span className="hidden sm:inline">Homerooms</span>, icon: Home, title: 'Homeroom-wise' },
                { key: 'student',  label: <span className="hidden sm:inline">Students</span>,  icon: Users, title: 'Student-wise' },
              ]}
            />
            <DateToggler
              value={date}
              onChange={changeDate}
              max={todayStr}
              todayStr={todayStr}
              className="inline-flex flex-shrink-0 !rounded-full !border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
              size="sm"
            />
          </div>
        </div>

        {/* ── Content card ── */}
        <div className="lg-content mx-2 mb-2 sm:mx-2.5 sm:mb-2.5 overflow-hidden">
          {/* Summary: the day in one line — the fraction, its bar, and the
              three figures, each a way into its list. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 sm:px-4 py-2.5 border-b border-slate-100">
            <div className="flex items-baseline gap-1.5 flex-shrink-0">
              <span className="text-2xl font-bold text-slate-900 leading-none tabular-nums">
                {loading ? '—' : presentFullTotal}
              </span>
              <span className="text-sm font-medium text-slate-400 tabular-nums">/ {loading ? '…' : markedTotal}</span>
            </div>
            <div className="flex-1 min-w-[8rem]">
              <div className="flex h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden>
                {markedTotal > 0 && !loading && (
                  <>
                    <span className="h-full transition-[width] duration-500" style={{ width: `${(presentFullTotal / markedTotal) * 100}%`, background: PRESENT_C }} />
                    <span className="h-full transition-[width] duration-500" style={{ width: `${(absentCount / markedTotal) * 100}%`, background: ABSENT_C }} />
                    <span className="h-full transition-[width] duration-500" style={{ width: `${(irregularCount / markedTotal) * 100}%`, background: LATE_C }} />
                  </>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 truncate">
                {loading ? 'Counting…' : markedTotal > 0 ? `${pct}% present` : 'Not marked yet'}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {summaryStats.map(st => (
                <button
                  key={st.key}
                  onClick={() => openSection(st.key)}
                  title={`Show ${st.label.toLowerCase()} students`}
                  className="flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full hover:bg-slate-100 transition-colors"
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
                  <span className="text-[11px] text-slate-500 hidden sm:inline">{st.label}</span>
                  <span className="text-[13px] font-bold text-slate-900 tabular-nums">{loading ? '–' : tabCounts[st.key]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Body ── */}
          <div className="p-2.5 sm:p-3 space-y-2.5">
            {/* One list at a time, instead of stacking all three */}
            {view === 'student' && (
              <Segmented
                fill
                ariaLabel="Student list"
                value={activeTab}
                onChange={setActiveTab}
                options={(['absent', 'present', 'irregular'] as const).map(key => ({
                  key,
                  label: key === 'absent' ? 'Absent' : key === 'present' ? 'Present' : 'Irregular',
                  count: loading ? '—' : tabCounts[key],
                  tone: SECTION_TONE[key],
                }))}
              />
            )}

            {/* Search + homeroom toggler */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={view === 'student' ? 'Search students' : 'Search homerooms'}
                  title={view === 'homeroom' ? 'Matches a homeroom, its section or its class teacher' : undefined}
                  aria-label={view === 'student' ? 'Search students' : 'Search homerooms'}
                  className="w-full pl-8 pr-8 py-1.5 text-sm bg-slate-100 border border-transparent rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-2 focus:ring-violet-500/15 transition-colors [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (searchPending ? (
                  <span aria-label="Searching" className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-slate-200 border-t-slate-500 animate-spin" />
                ) : (
                  <button
                    onClick={clearSearch}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-slate-300/70 text-white hover:bg-slate-400 transition-colors"
                  >
                    <X size={11} strokeWidth={3} />
                  </button>
                ))}
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
                  emptyText="No homerooms match"
                  className="w-36 sm:w-52 flex-shrink-0"
                  buttonClassName="!rounded-xl !border-slate-200"
                  leadingIcon={<Home size={14} className="text-slate-400 flex-shrink-0" />}
                />
              )}
            </div>

            {/* ── Homeroom-wise ── */}
            {view === 'homeroom' ? (
              loadingHomerooms ? (
                <HomeroomReportSkeleton />
              ) : (
                <div className="animate-fade-in">
                  {homeroomRows.length === 0 ? (
                    <EmptyNote>
                      {searchPending
                        ? 'Searching…'
                        : homeroomSearch ? `No homerooms or class teachers match “${homeroomSearch}”.` : 'No homerooms to report on.'}
                    </EmptyNote>
                  ) : (
                    <div className="rounded-xl overflow-hidden ring-1 ring-slate-900/[0.06]">
                      {/* Column headings */}
                      <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 h-8 bg-slate-50 border-b border-slate-100">
                        <span className="flex-1 min-w-0 text-[11px] font-semibold text-slate-400">
                          Homeroom{homeroomSearch ? ` · ${homeroomTotal} found` : ''}
                        </span>
                        <span className="hidden md:block w-24 text-[11px] font-semibold text-slate-400 flex-shrink-0">Rate</span>
                        {([['Present', 'Pres.'], ['Absent', 'Abs.'], ['Irregular', 'Irreg.']] as const).map(([label, short]) => (
                          <span key={label} className="w-11 sm:w-16 text-center text-[11px] font-semibold text-slate-400 flex-shrink-0">
                            <span className="hidden sm:inline">{label}</span>
                            <span className="sm:hidden" title={label}>{short}</span>
                          </span>
                        ))}
                      </div>
                      <div className={`divide-y divide-slate-100 transition-opacity ${searchingHomerooms ? 'opacity-60' : ''}`}>
                        {homeroomRows.map(row => (
                          <HomeroomCountsRow key={row.homeroom_id} row={row} onOpen={openStudentView} />
                        ))}
                      </div>
                    </div>
                  )}
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
                  <div id={SECTION_ANCHOR.absent} className="scroll-mt-4">
                    {absentRows.length === 0 ? (
                      <EmptyNote>
                        {query ? `No absentees match “${query.trim()}”.` : 'No one is marked absent for this day.'}
                      </EmptyNote>
                    ) : (
                      <RowList count={absentRows.length}>
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
                  <div id={SECTION_ANCHOR.present} className="scroll-mt-4">
                    {presentRows.length === 0 ? (
                      <EmptyNote>
                        {searchPending
                          ? 'Searching…'
                          : query ? `No present students match “${query.trim()}”.` : 'No one is marked present for this day.'}
                      </EmptyNote>
                    ) : (
                      <div className={`transition-opacity ${searchingPresent ? 'opacity-60' : ''}`}>
                        <RowList count={presentRows.length}>
                          {presentRows.map((r, i) => (
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
                  <div id={SECTION_ANCHOR.irregular} className="scroll-mt-4 space-y-3">
                    {irregularGroups.length === 0 ? (
                      <EmptyNote>
                        {query ? `No irregular attendance matches “${query.trim()}”.` : 'No irregular attendance for this day.'}
                      </EmptyNote>
                    ) : (
                      irregularGroups.map(({ status, rows }) => (
                        <div key={status}>
                          <GroupLabel status={status} count={rows.length} />
                          <RowList count={rows.length}>
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
        </div>
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
      className={`${MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 lg:space-y-5 transition-all duration-300 ${
        bannerEditing ? 'opacity-30 blur-[1px] pointer-events-none select-none' : ''
      }`}
      aria-hidden={bannerEditing}
    >
      {studentParam ? (
        <>
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1 pl-1.5 pr-3 py-1 rounded-full text-xs font-semibold text-slate-600 bg-white/70 ring-1 ring-slate-900/[0.06] hover:bg-white hover:text-slate-900 transition-colors"
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
          compactMobileTitle
          elevated
          maxWidth={MAX_W}
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
        <Suspense fallback={<div className={`${MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6`}><StudentAttendanceSkeleton /></div>}>
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
