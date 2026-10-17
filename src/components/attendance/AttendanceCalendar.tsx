'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock3, BookOpen, ShieldCheck, HelpCircle, Briefcase, X, ExternalLink } from 'lucide-react'
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

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const STATUS_CELL: Record<AttendanceStatus, { bg: string; text: string; border: string; dot: string; badge: string }> = {
  present:  { bg: '#ecfdf5', text: '#065f46', border: '#6ee7b7', dot: '#10b981', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  absent:   { bg: '#fff1f2', text: '#881337', border: '#fca5a5', dot: '#f43f5e', badge: 'bg-rose-100 text-rose-800 border-rose-200' },
  late:     { bg: '#fffbeb', text: '#78350f', border: '#fcd34d', dot: '#f59e0b', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  on_leave: { bg: '#f0f9ff', text: '#075985', border: '#7dd3fc', dot: '#0ea5e9', badge: 'bg-sky-100 text-sky-800 border-sky-200' },
  excused:  { bg: '#f5f3ff', text: '#4c1d95', border: '#c4b5fd', dot: '#7c3aed', badge: 'bg-violet-100 text-violet-800 border-violet-200' },
  on_duty:  { bg: '#f0fdfa', text: '#134e4a', border: '#5eead4', dot: '#14b8a6', badge: 'bg-teal-100 text-teal-800 border-teal-200' },
  half_day: { bg: '#fff7ed', text: '#7c2d12', border: '#fdba74', dot: '#f97316', badge: 'bg-orange-100 text-orange-800 border-orange-200' },
}

const STATUS_ICONS: Record<AttendanceStatus, React.ReactNode> = {
  present:  <CheckCircle2 size={11} />,
  absent:   <XCircle size={11} />,
  late:     <Clock3 size={11} />,
  on_leave: <BookOpen size={11} />,
  excused:  <ShieldCheck size={11} />,
  on_duty:  <Briefcase size={11} />,
  half_day: <span className="text-[9px] font-extrabold leading-none">½</span>,
}

function monthName(year: number, month: number) {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}
function dayOfWeek(dateStr: string) { return (new Date(dateStr + 'T12:00:00').getDay() + 6) % 7 }
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

  const firstDow = dayOfWeek(`${year}-${String(month).padStart(2, '0')}-01`)
  const cells: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

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
  const navBtn = 'w-8 h-8 rounded-full flex items-center justify-center text-slate-500 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 active:scale-95 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400'

  return (
    <>
      {/* A solid content card (see .lg-content in globals.css): the month is
          read off it, so it never sits on glass. Cell rhythm is unchanged —
          52px tiles on a 4px gutter take the same 56px a bordered cell did. */}
      <div className="rounded-[20px] overflow-hidden bg-white ring-1 ring-slate-900/[0.06] shadow-[0_1px_2px_rgba(15,23,42,0.05),0_14px_30px_-22px_rgba(15,23,42,0.4)]">

        {/* ── Header: month, its tally, and the steppers ── */}
        <div className="flex items-center gap-3 px-3.5 sm:px-4 pt-3 pb-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-[17px] font-bold text-slate-900 leading-tight truncate" aria-live="polite">
              {monthLabel} <span className="font-semibold text-slate-400">{year}</span>
            </h3>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {(['present', 'absent', 'late', 'half_day'] as AttendanceStatus[]).map(st => (
                <span
                  key={st}
                  className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-[1px] rounded-full bg-slate-50 ring-1 ring-slate-900/[0.05] text-slate-600 tabular-nums"
                  title={ATTENDANCE_STATUS_LABELS[st]}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_CELL[st].dot }} />
                  {st === 'half_day' ? 'HD' : ATTENDANCE_STATUS_LABELS[st].charAt(0)} {loading ? '–' : counts[st] ?? 0}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={prevMonth} aria-label={`Previous month (${monthName(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1)})`} className={navBtn}>
              <ChevronLeft size={16} />
            </button>
            <button onClick={nextMonth} aria-label={`Next month (${monthName(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)})`} className={navBtn}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* ── Day headers ── */}
        <div className="grid grid-cols-7 gap-1 px-1.5">
          {DAY_HEADERS.map(h => (
            <div key={h} className={`py-1 text-center text-[10px] font-semibold ${
              h === 'Sun' ? 'text-slate-300' : 'text-slate-400'
            }`}>{h}</div>
          ))}
        </div>

        {/* ── Calendar grid ── */}
        {loading ? (
          <div className="grid grid-cols-7 gap-1 px-1.5 pb-1.5">
            {cells.map((_, i) => (
              <div key={`sk-${i}`} className="h-[52px] rounded-xl bg-slate-50 flex items-center justify-center">
                <div className="skeleton w-6 h-6 rounded-lg" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1 px-1.5 pb-1.5 animate-fade-in">
            {cells.map((day, i) => {
              if (day === null) {
                return <div key={`e-${i}`} className="h-[52px]" />
              }
              const dow = (firstDow + day - 1) % 7
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
                  className={`h-[52px] rounded-xl flex flex-col items-center justify-center gap-0.5 relative select-none transition-[transform,filter] ${
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

                  {s && (
                    <span style={{ color: style!.dot }}>{STATUS_ICONS[s]}</span>
                  )}

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
          </div>
        )}

        {/* ── Legend ── */}
        <div className="px-4 py-2 border-t border-slate-100 flex flex-wrap gap-x-3 gap-y-1">
          {(['present', 'absent', 'late', 'half_day'] as AttendanceStatus[]).map(s => (
            <div key={s} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: STATUS_CELL[s].dot }} />
              <span className="text-[10px] text-slate-500 font-medium">{ATTENDANCE_STATUS_LABELS[s]}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-slate-500 font-medium">Leave approved</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-[10px] text-slate-500 font-medium">Leave pending</span>
          </div>
          <div className="flex items-center gap-1.5">
            <HelpCircle size={10} className="text-slate-300" />
            <span className="text-[10px] text-slate-400">Not marked</span>
          </div>
        </div>
      </div>

      {/* ── Leave application popup ── */}
      {selectedApps && typeof document !== 'undefined' && createPortal(
        // Plain dim, solid sheet: no backdrop-filter anywhere in a popup (see
        // .lg-popup in globals.css for why).
        <div
          className="lg-scrim fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-3 sm:p-4"
          onClick={() => setSelectedApps(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Leave applications on this day"
            className="lg-popup rounded-[22px] w-full max-w-sm overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-slate-100">
              <p className="text-[15px] font-bold text-slate-900">
                {selectedApps.length === 1 ? 'Leave application' : `${selectedApps.length} leave applications`}
              </p>
              <button
                onClick={() => setSelectedApps(null)}
                aria-label="Close"
                className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors"
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            </div>
            <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
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
