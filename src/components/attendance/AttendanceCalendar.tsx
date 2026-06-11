'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock3, BookOpen, ShieldCheck, HelpCircle, Briefcase, X } from 'lucide-react'
import { AttendanceRecord, AttendanceStatus, fetchMyAttendanceByMonth } from '@/lib/attendance'
import {
  LeaveApplicationWithDetails,
  fetchLeaveApplicationsForStudentByMonth,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_COLORS,
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

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present', absent: 'Absent', late: 'Late',
  on_leave: 'On Leave (OL)', excused: 'Excused', on_duty: 'On Duty (OD)',
  half_day: 'Half Day',
}

const LEAVE_APP_COLORS: Record<string, { dot: string }> = {
  pending:  { dot: '#f59e0b' },
  approved: { dot: '#10b981' },
  rejected: { dot: '#ef4444' },
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
function shortDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface DayDetail {
  day: number
  status: AttendanceStatus | null
  remarks: string | null
  leaveApps: LeaveApplicationWithDetails[]
}

interface AttendanceCalendarProps {
  studentId: string
  homeroomId: string
  year: number
  month: number
  onMonthChange: (year: number, month: number) => void
  /** If provided, clicking a day with leave apps calls this instead of the internal modal */
  onAppOpen?: (app: LeaveApplicationWithDetails) => void
}

export default function AttendanceCalendar({ studentId, homeroomId, year, month, onMonthChange, onAppOpen }: AttendanceCalendarProps) {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [leaveApps, setLeaveApps] = useState<LeaveApplicationWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null)
  const [selectedApp, setSelectedApp] = useState<LeaveApplicationWithDetails | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setDayDetail(null); setSelectedApp(null)
    const [data, apps] = await Promise.all([
      fetchMyAttendanceByMonth(studentId, year, month, homeroomId),
      fetchLeaveApplicationsForStudentByMonth(studentId, year, month),
    ])
    setRecords(data)
    setLeaveApps(apps)
    setLoading(false)
  }, [studentId, homeroomId, year, month])

  useEffect(() => { load() }, [load])

  const byDay: Record<number, AttendanceRecord> = {}
  for (const r of records) byDay[parseInt(r.date.split('-')[2], 10)] = r

  const totalDays = daysInMonth(year, month)
  const leaveByDay: Record<number, LeaveApplicationWithDetails[]> = {}
  for (const app of leaveApps) {
    const appStart = new Date(app.start_date)
    const appEnd = new Date(app.end_date)
    for (let d = 1; d <= totalDays; d++) {
      const dayDate = new Date(year, month - 1, d)
      if (dayDate >= appStart && dayDate <= appEnd) {
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
    const rec = byDay[day]
    const apps = leaveByDay[day] ?? []

    if (onAppOpen) {
      // Parent handles app opens (student nav / staff dialog).
      // Days without apps are not clickable so nothing to do.
      if (apps.length === 1) { onAppOpen(apps[0]); return }
      // Multiple apps → let user pick from day-detail first
      if (apps.length > 1) {
        setDayDetail({ day, status: rec?.status ?? null, remarks: rec?.remarks ?? null, leaveApps: apps })
      }
      return
    }

    // No parent handler: use internal modals
    if (!rec && apps.length === 1) { setSelectedApp(apps[0]); return }
    if (rec || apps.length > 0) {
      setDayDetail({ day, status: rec?.status ?? null, remarks: rec?.remarks ?? null, leaveApps: apps })
    }
  }

  const counts = records.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1; return acc
  }, {} as Partial<Record<AttendanceStatus, number>>)

  return (
    <>
      <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">

        {/* ── Gradient header ── */}
        <div className="bg-gradient-to-r from-violet-700 to-purple-600 px-4 sm:px-5 py-4">
          <div className="flex items-center justify-between">
            <button onClick={prevMonth}
              className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
              <ChevronLeft size={16} />
            </button>

            <div className="text-center">
              <p className="text-white font-bold text-base leading-tight">{monthName(year, month)}</p>
              <div className="flex items-center justify-center gap-1.5 mt-1.5 flex-wrap">
                {[
                  { s: 'present'  as AttendanceStatus, label: 'P',  c: '#6ee7b7' },
                  { s: 'absent'   as AttendanceStatus, label: 'A',  c: '#fca5a5' },
                  { s: 'late'     as AttendanceStatus, label: 'L',  c: '#fcd34d' },
                  { s: 'half_day' as AttendanceStatus, label: 'HD', c: '#fdba74' },
                ].map(({ s, label, c }) => (
                  <span key={s} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{ background: 'rgba(255,255,255,0.15)', color: c }}>
                    {label} {counts[s] ?? 0}
                  </span>
                ))}
              </div>
            </div>

            <button onClick={nextMonth}
              className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* ── Day headers ── */}
        <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
          {DAY_HEADERS.map(h => (
            <div key={h} className={`py-2 text-center text-[10px] font-bold uppercase tracking-wider ${
              h === 'Sun' ? 'text-slate-300' : 'text-slate-500'
            }`}>{h}</div>
          ))}
        </div>

        {/* ── Calendar grid ── */}
        {loading ? (
          <div className="py-16 text-center bg-white">
            <div className="spinner mx-auto mb-2" />
            <p className="text-xs text-slate-400">Loading…</p>
          </div>
        ) : (
          <div className="grid grid-cols-7 bg-white">
            {cells.map((day, i) => {
              if (day === null) {
                return <div key={`e-${i}`} className="h-14 border-b border-r border-slate-100 last:border-r-0 bg-slate-50/30" />
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
              const clickable = !weekend && (onAppOpen ? dayApps.length > 0 : (!!rec || dayApps.length > 0 || isPast))

              return (
                <div
                  key={day}
                  onClick={() => !weekend && handleDayClick(day)}
                  className={`h-14 border-b border-r border-slate-100 last:border-r-0 flex flex-col items-center justify-center gap-0.5 relative select-none transition-colors ${
                    clickable ? 'cursor-pointer hover:opacity-80' : weekend ? 'cursor-default' : 'cursor-default'
                  }`}
                  style={style
                    ? { background: style.bg, borderBottomColor: style.border }
                    : (hasPendingApp || hasApprovedApp) && !s
                      ? { background: '#fffbeb' }
                      : weekend ? { background: '#f8fafc' } : {}}
                >
                  {today && (
                    <div className="absolute inset-[3px] rounded-lg ring-2 ring-violet-400 pointer-events-none" />
                  )}

                  <span className="text-[12px] font-bold leading-none z-10"
                    style={{ color: style ? style.text : weekend ? '#cbd5e1' : future ? '#cbd5e1' : '#94a3b8' }}>
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

                  {isPast && <HelpCircle size={9} className="text-slate-300" />}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Legend ── */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-x-3 gap-y-1.5">
          {(['present', 'absent', 'late', 'half_day'] as AttendanceStatus[]).map(s => (
            <div key={s} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_CELL[s].dot }} />
              <span className="text-[10px] text-slate-500 font-medium">{STATUS_LABELS[s]}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-slate-500 font-medium">Approved App.</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-[10px] text-slate-500 font-medium">Pending App.</span>
          </div>
          <div className="flex items-center gap-1.5">
            <HelpCircle size={10} className="text-slate-300" />
            <span className="text-[10px] text-slate-400">Not marked</span>
          </div>
        </div>
      </div>

      {/* ── Day detail modal (fixed — works inside any parent container) ── */}
      {dayDetail && !selectedApp && (
        <div
          className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setDayDetail(null)}
        >
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-700">
                {new Date(year, month - 1, dayDetail.day).toLocaleDateString('en-US', {
                  weekday: 'long', month: 'short', day: 'numeric',
                })}
              </p>
              <button onClick={() => setDayDetail(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>

            {dayDetail.status ? (
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${STATUS_CELL[dayDetail.status].badge}`}>
                {STATUS_ICONS[dayDetail.status]}
                {STATUS_LABELS[dayDetail.status]}
              </div>
            ) : dayDetail.leaveApps.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Not yet marked</p>
            ) : null}

            {dayDetail.remarks && (
              <p className="text-xs text-slate-500 italic leading-relaxed">&ldquo;{dayDetail.remarks}&rdquo;</p>
            )}

            {dayDetail.leaveApps.length > 0 && (
              <div className="space-y-1.5">
                {dayDetail.status && <div className="border-t border-slate-100 pt-2" />}
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Applications</p>
                {dayDetail.leaveApps.map(app => (
                  <button
                    key={app.id}
                    onClick={() => {
                      setDayDetail(null)
                      if (onAppOpen) { onAppOpen(app); return }
                      setSelectedApp(app)
                    }}
                    className="w-full text-left flex items-center gap-2 hover:bg-slate-50 rounded-xl px-2 py-2 transition-colors"
                  >
                    <div className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: LEAVE_APP_COLORS[app.status]?.dot ?? '#94a3b8' }} />
                    <span className="text-xs font-medium text-slate-700 truncate flex-1">{LEAVE_TYPE_LABELS[app.leave_type]}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium flex-shrink-0 ${LEAVE_STATUS_COLORS[app.status]}`}>
                      {LEAVE_STATUS_LABELS[app.status]}
                    </span>
                    <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Application detail modal ── */}
      {selectedApp && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setSelectedApp(null)}
        >
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-sm">{LEAVE_TYPE_LABELS[selectedApp.leave_type]}</h3>
              <button onClick={() => setSelectedApp(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${LEAVE_STATUS_COLORS[selectedApp.status]}`}>
                {LEAVE_STATUS_LABELS[selectedApp.status]}
              </span>
              <span className="text-xs text-slate-500">{shortDate(selectedApp.start_date)} → {shortDate(selectedApp.end_date)}</span>
            </div>
            <div className="bg-slate-50 rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-semibold text-slate-500 mb-1">Reason</p>
              <p className="text-sm text-slate-700">{selectedApp.reason}</p>
            </div>
            {selectedApp.approvals.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Approval Status</p>
                {selectedApp.approvals.map(a => (
                  <div key={a.id} className={`text-xs px-3 py-2 rounded-lg ${
                    a.status === 'approved' ? 'bg-green-50' : a.status === 'rejected' ? 'bg-red-50' : 'bg-amber-50'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.approver?.full_name ?? a.approver_role}</span>
                      <span className={`font-medium ${
                        a.status === 'approved' ? 'text-green-700' : a.status === 'rejected' ? 'text-red-700' : 'text-amber-700'
                      }`}>
                        {LEAVE_STATUS_LABELS[a.status]}
                      </span>
                    </div>
                    {a.comments && <p className="mt-1 italic text-slate-600">&ldquo;{a.comments}&rdquo;</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
