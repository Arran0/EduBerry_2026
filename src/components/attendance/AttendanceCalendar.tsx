'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, XCircle, Clock3, BookOpen, ShieldCheck, HelpCircle, Briefcase, X, ExternalLink } from 'lucide-react'
import { MonthCalendarFrame, CalendarTilesSkeleton, OutsideTile, monthCells, TILE, CAL_COLORS } from './MonthCalendarFrame'
import {
  AttendanceDayRecord,
  AttendanceStatus,
  ATTENDANCE_STATUS_LABELS,
  fetchMyAttendanceByMonth,
} from '@/lib/attendance'
import {
  LeaveApplicationWithDetails,
  fetchLeaveApplicationsForStudentByMonth,
  LEAVE_TYPE_LABELS,
} from '@/lib/leave'

const STATUS_CELL: Record<AttendanceStatus, { bg: string; text: string; border: string; dot: string }> = CAL_COLORS

const STATUS_ICONS: Record<AttendanceStatus, React.ReactNode> = {
  present:  <CheckCircle2 size={11} />,
  absent:   <XCircle size={11} />,
  late:     <Clock3 size={11} />,
  on_leave: <BookOpen size={11} />,
  excused:  <ShieldCheck size={11} />,
  on_duty:  <Briefcase size={11} />,
  half_day: <span className="text-[9px] font-extrabold leading-none">½</span>,
}

function daysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate() }
function isWeekend(dow: number) { return dow === 6 }
function isToday(y: number, m: number, d: number) {
  const t = new Date(); return t.getFullYear() === y && t.getMonth() + 1 === m && t.getDate() === d
}
function isFuture(y: number, m: number, d: number) {
  return new Date(y, m - 1, d) > new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
}

function canViewApp(app: LeaveApplicationWithDetails, viewerUserId?: string, viewerRole?: string): boolean {
  if (!viewerUserId || !viewerRole) return false
  if (viewerRole === 'admin' || viewerRole === 'principal') return true
  if (app.applicant_id === viewerUserId) return true
  return app.approvals.some(a =>
    a.approver_id === viewerUserId ||
    (!a.approver_id && a.approver_role === viewerRole)
  )
}

interface AttendanceCalendarProps {
  studentId: string
  homeroomId: string
  year: number
  month: number
  onMonthChange: (year: number, month: number) => void
  /** If provided, clicking a day with leave apps shows a popup; this is called when the viewer has rights and clicks "View" */
  onAppOpen?: (app: LeaveApplicationWithDetails) => void
  /** If provided, clicking an empty workday (no app, no record) calls this with 'YYYY-MM-DD' */
  onEmptyDayClick?: (dateStr: string) => void
  /** Current viewer's user ID — used to decide whether to show the "View in Leave Manager" button */
  viewerUserId?: string
  /** Current viewer's role — used to decide whether to show the "View in Leave Manager" button */
  viewerRole?: string
  /** Bump to refetch the month — e.g. after a leave application changed. */
  refreshKey?: number
}

export default function AttendanceCalendar({ studentId, homeroomId, year, month, onMonthChange, onAppOpen, onEmptyDayClick, viewerUserId, viewerRole, refreshKey = 0 }: AttendanceCalendarProps) {
  const [records, setRecords] = useState<AttendanceDayRecord[]>([])
  const [leaveApps, setLeaveApps] = useState<LeaveApplicationWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedApps, setSelectedApps] = useState<LeaveApplicationWithDetails[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setSelectedApps(null)
    const [data, apps] = await Promise.all([
      fetchMyAttendanceByMonth(studentId, year, month, homeroomId),
      fetchLeaveApplicationsForStudentByMonth(studentId, year, month),
    ])
    setRecords(data)
    setLeaveApps(apps)
    setLoading(false)
    // refreshKey is not read here — it is the caller's way of asking for a
    // refetch after marking attendance, so it belongs in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, homeroomId, year, month, refreshKey])

  useEffect(() => { load() }, [load])

  const byDay: Record<number, AttendanceDayRecord> = {}
  for (const r of records) byDay[parseInt(r.date.split('-')[2], 10)] = r

  const totalDays = daysInMonth(year, month)
  const leaveByDay: Record<number, LeaveApplicationWithDetails[]> = {}
  for (const app of leaveApps) {
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (dateStr >= app.start_date && dateStr <= app.end_date) {
        if (!leaveByDay[d]) leaveByDay[d] = []
        leaveByDay[d].push(app)
      }
    }
  }

  const cells = monthCells(year, month)

  const prevMonth = () => month === 1 ? onMonthChange(year - 1, 12) : onMonthChange(year, month - 1)
  const nextMonth = () => month === 12 ? onMonthChange(year + 1, 1) : onMonthChange(year, month + 1)

  const handleDayClick = (day: number) => {
    const apps = leaveByDay[day] ?? []
    if (apps.length > 0) {
      setSelectedApps(apps)
      return
    }
    if (!byDay[day] && onEmptyDayClick) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      onEmptyDayClick(dateStr)
    }
  }

  const counts = records.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1; return acc
  }, {} as Partial<Record<AttendanceStatus, number>>)

  const monthLabel = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' })

  return (
    <>
      <MonthCalendarFrame
        year={year}
        month={month}
        onPrev={prevMonth}
        onNext={nextMonth}
        tally={(['present', 'absent', 'late', 'half_day'] as AttendanceStatus[]).map(st => ({
          key: st,
          label: st === 'half_day' ? 'HD' : ATTENDANCE_STATUS_LABELS[st].charAt(0),
          title: ATTENDANCE_STATUS_LABELS[st],
          color: STATUS_CELL[st].dot,
          value: loading ? null : counts[st] ?? 0,
        }))}
        legend={[
          { label: 'Present', color: STATUS_CELL.present.dot },
          { label: 'Absent', color: STATUS_CELL.absent.dot },
          { label: 'Late', color: STATUS_CELL.late.dot },
          { label: 'Half day', color: STATUS_CELL.half_day.dot },
          { label: 'Leave approved', color: '#10b981' },
          { label: 'Leave pending', color: '#fbbf24' },
          { label: 'Not marked', icon: <HelpCircle size={10} className="text-slate-300" /> },
        ]}
      >
        {loading ? <CalendarTilesSkeleton /> : cells.map((day, i) => {
          if (day === null) return <OutsideTile key={`e-${i}`} year={year} month={month} index={i} />
          const dow = i % 7
          const weekend = isWeekend(dow)
          const future = isFuture(year, month, day)
          const today = isToday(year, month, day)
          const rec = byDay[day]
          const dayApps = leaveByDay[day] ?? []
          const isPast = !future && !weekend && !rec && dayApps.length === 0
          const s = rec?.status
          const style = s ? STATUS_CELL[s] : null
          const hasPendingApp = dayApps.some(a => a.status === 'pending')
          const hasApprovedApp = dayApps.some(a => a.status === 'approved')
          const clickable = !weekend && (
            dayApps.length > 0 ||
            (!rec && !!onEmptyDayClick && !future)
          )
          const label = `${monthLabel} ${day}${s ? `, ${ATTENDANCE_STATUS_LABELS[s]}` : ''}${dayApps.length ? `, ${dayApps.length} leave application${dayApps.length > 1 ? 's' : ''}` : ''}`

          return (
            <div
              key={day}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={clickable ? label : undefined}
              onClick={() => !weekend && handleDayClick(day)}
              onKeyDown={clickable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDayClick(day) } } : undefined}
              className={`${TILE} flex flex-col items-center justify-center gap-0.5 relative select-none transition-[transform,filter] ${
                clickable ? 'cursor-pointer hover:brightness-[0.97] active:scale-[0.96] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400' : 'cursor-default'
              }`}
              style={style
                ? { background: style.bg, boxShadow: `inset 0 0 0 1px ${style.border}66` }
                : (hasPendingApp || hasApprovedApp)
                  ? { background: '#fffbeb', boxShadow: 'inset 0 0 0 1px #fcd34d66' }
                  : weekend ? { background: '#f8fafc' } : { background: '#fcfcfd', boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.04)' }}
            >
              <span
                className={`text-[12px] font-bold leading-none tabular-nums ${today ? 'w-[22px] h-[22px] rounded-full flex items-center justify-center text-white' : ''}`}
                style={today
                  ? { background: 'var(--page-gradient-from, #7c3aed)' }
                  : { color: style ? style.text : weekend || future ? '#cbd5e1' : '#94a3b8' }}
              >
                {day}
              </span>
              {s && <span style={{ color: style!.dot }}>{STATUS_ICONS[s]}</span>}
              {/* Always show app dots — even when auto-marked attendance exists */}
              {dayApps.length > 0 && (
                <div className="flex gap-0.5 items-center">
                  {hasApprovedApp && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                  {hasPendingApp && <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                </div>
              )}
              {isPast && !today && <HelpCircle size={9} className="text-slate-300" />}
            </div>
          )
        })}
      </MonthCalendarFrame>

      {/* ── Leave application popup ── */}
      {selectedApps && typeof document !== 'undefined' && createPortal(
        // Plain dim and the glass sheet ModalShell uses: no backdrop-filter
        // anywhere in a popup (a blurred layer fading in flashed black).
        <div
          className="lg-scrim fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-3 sm:p-4"
          onClick={() => setSelectedApps(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Leave applications on this day"
            className="lg-sheet relative rounded-[26px] w-full max-w-sm overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="relative z-[3] flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
              <p className="text-[15px] font-bold text-slate-900">
                {selectedApps.length === 1 ? 'Leave application' : `${selectedApps.length} leave applications`}
              </p>
              <button
                onClick={() => setSelectedApps(null)}
                aria-label="Close"
                className="lg-control w-8 h-8 flex-shrink-0"
              >
                <X size={15} strokeWidth={2.4} />
              </button>
            </div>
            <div className="lg-sheet-card relative z-[3] mx-2 mb-2 divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
              {selectedApps.map(app => (
                <div key={app.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                    <span className={`w-1.5 h-1.5 rounded-full ${app.status === 'approved' ? 'bg-emerald-500' : app.status === 'pending' ? 'bg-amber-400' : 'bg-rose-500'}`} />
                    {LEAVE_TYPE_LABELS[app.leave_type]}
                    <span className="text-slate-300">·</span>
                    {new Date(app.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {app.start_date !== app.end_date && ` – ${new Date(app.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{app.reason}</p>
                  {onAppOpen && canViewApp(app, viewerUserId, viewerRole) && (
                    <button
                      onClick={() => { setSelectedApps(null); onAppOpen(app) }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors"
                    >
                      <ExternalLink size={12} />
                      Open in OD / Leave
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
