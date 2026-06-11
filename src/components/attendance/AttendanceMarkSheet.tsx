'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { X, Loader2, Save, Users, CheckSquare, ChevronDown, ChevronUp, Lock, Unlock, Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  AttendanceStatus,
  AttendanceSheetRow,
  ATTENDANCE_STATUS_LABELS,
  fetchAttendanceSheet,
  bulkMarkAttendance,
  fetchMyAttendanceByMonth,
  AttendanceRecord,
} from '@/lib/attendance'
import {
  LeaveApplicationWithDetails,
  fetchLeaveApplicationsForStudentByMonth,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_COLORS,
  LEAVE_STATUS_LABELS,
} from '@/lib/leave'
import { UserProfile } from '@/lib/supabase'

interface RowState {
  student: UserProfile
  status: AttendanceStatus
  remarks: string
  changed: boolean
  leaveLinked: boolean
  overrideLeave: boolean
}

// Only the allowed marking options (late and excused removed)
const STATUS_OPTIONS: AttendanceStatus[] = ['present', 'absent', 'on_leave', 'on_duty']
const STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: 'P', absent: 'A', late: 'L', on_leave: 'OL', excused: 'E', on_duty: 'OD',
}
const STATUS_COLORS: Record<AttendanceStatus, string> = {
  present:  'bg-green-500 text-white border-green-500',
  absent:   'bg-red-500 text-white border-red-500',
  late:     'bg-amber-500 text-white border-amber-500',
  on_leave: 'bg-blue-500 text-white border-blue-500',
  excused:  'bg-purple-500 text-white border-purple-500',
  on_duty:  'bg-teal-500 text-white border-teal-500',
}
const STATUS_INACTIVE: Record<AttendanceStatus, string> = {
  present:  'border-green-200 text-green-600 hover:bg-green-50',
  absent:   'border-red-200 text-red-600 hover:bg-red-50',
  late:     'border-amber-200 text-amber-600 hover:bg-amber-50',
  on_leave: 'border-blue-200 text-blue-600 hover:bg-blue-50',
  excused:  'border-purple-200 text-purple-600 hover:bg-purple-50',
  on_duty:  'border-teal-200 text-teal-600 hover:bg-teal-50',
}

const LEAVE_CELL: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  present:  { bg: '#ecfdf5', text: '#065f46', border: '#6ee7b7', dot: '#10b981' },
  absent:   { bg: '#fff1f2', text: '#881337', border: '#fca5a5', dot: '#f43f5e' },
  on_leave: { bg: '#f0f9ff', text: '#075985', border: '#7dd3fc', dot: '#0ea5e9' },
  on_duty:  { bg: '#f0fdfa', text: '#134e4a', border: '#5eead4', dot: '#14b8a6' },
  late:     { bg: '#fffbeb', text: '#78350f', border: '#fcd34d', dot: '#f59e0b' },
  excused:  { bg: '#f5f3ff', text: '#4c1d95', border: '#c4b5fd', dot: '#7c3aed' },
}

function todayString() { return new Date().toISOString().split('T')[0] }
function formatDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
}
function shortDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initRows(sheet: AttendanceSheetRow[]): RowState[] {
  return sheet.map(row => ({
    student: row.student,
    status: row.record?.status ?? 'absent',
    remarks: row.record?.remarks ?? '',
    changed: false,
    leaveLinked: !!(row.record?.leave_application_id),
    overrideLeave: false,
  }))
}

// ── Student Calendar Modal ──────────────────────────────────────────────────────

const CAL_DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const CAL_STATUS_CELL: Partial<Record<AttendanceStatus, { bg: string; text: string; dot: string }>> = {
  present:  { bg: '#ecfdf5', text: '#065f46', dot: '#10b981' },
  absent:   { bg: '#fff1f2', text: '#881337', dot: '#f43f5e' },
  on_leave: { bg: '#f0f9ff', text: '#075985', dot: '#0ea5e9' },
  on_duty:  { bg: '#f0fdfa', text: '#134e4a', dot: '#14b8a6' },
  late:     { bg: '#fffbeb', text: '#78350f', dot: '#f59e0b' },
  excused:  { bg: '#f5f3ff', text: '#4c1d95', dot: '#7c3aed' },
}

const LEAVE_STATUS_DOT: Record<string, string> = {
  pending:  '#f59e0b',
  approved: '#10b981',
  rejected: '#f43f5e',
}

function dayOfWeekIdx(dateStr: string) { return (new Date(dateStr + 'T12:00:00').getDay() + 6) % 7 }
function daysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate() }

interface StudentCalendarModalProps {
  student: UserProfile
  initialYear: number
  initialMonth: number
  homeroomId: string
  onClose: () => void
}

function StudentCalendarModal({ student, initialYear, initialMonth, homeroomId, onClose }: StudentCalendarModalProps) {
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [leaveApps, setLeaveApps] = useState<LeaveApplicationWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedApp, setSelectedApp] = useState<LeaveApplicationWithDetails | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [recs, apps] = await Promise.all([
      fetchMyAttendanceByMonth(student.id, year, month, homeroomId),
      fetchLeaveApplicationsForStudentByMonth(student.id, year, month),
    ])
    setRecords(recs)
    setLeaveApps(apps)
    setLoading(false)
  }, [student.id, homeroomId, year, month])

  useEffect(() => { load() }, [load])

  const monthLabel = new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) } else { setMonth(m => m - 1) }
  }
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) } else { setMonth(m => m + 1) }
  }

  const totalDays = daysInMonth(year, month)
  const firstDow = dayOfWeekIdx(`${year}-${String(month).padStart(2, '0')}-01`)
  const cells: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const byDay: Record<number, AttendanceRecord> = {}
  for (const r of records) byDay[parseInt(r.date.split('-')[2], 10)] = r

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

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh] sm:max-h-[80vh] rounded-t-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-violet-700 to-purple-600 flex-shrink-0">
          <Avatar avatarUrl={student.avatar_url} name={student.full_name} email={student.email} size={36} userId={student.id} />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm truncate">{student.full_name}</p>
            <p className="text-violet-200 text-[10px]">Attendance Calendar</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-white/70 hover:text-white hover:bg-white/20 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Month nav */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors text-slate-600">
            <ChevronLeft size={15} />
          </button>
          <span className="text-sm font-semibold text-slate-700">{monthLabel}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors text-slate-600">
            <ChevronRight size={15} />
          </button>
        </div>

        {/* Calendar */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {/* Day headers */}
              <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
                {CAL_DAY_HEADERS.map(h => (
                  <div key={h} className={`py-1.5 text-center text-[9px] font-bold uppercase ${h === 'Sat' || h === 'Sun' ? 'text-slate-300' : 'text-slate-400'}`}>{h}</div>
                ))}
              </div>

              {/* Grid */}
              <div className="grid grid-cols-7">
                {cells.map((day, i) => {
                  if (day === null) return <div key={`e-${i}`} className="h-12 border-b border-r border-slate-100 bg-slate-50/30" />
                  const dow = (firstDow + day - 1) % 7
                  const weekend = dow >= 5
                  const rec = byDay[day]
                  const dayApps = leaveByDay[day] ?? []
                  const s = rec?.status
                  const style = s ? CAL_STATUS_CELL[s] : null
                  const hasPendingApp = dayApps.some(a => a.status === 'pending')
                  const hasApprovedApp = dayApps.some(a => a.status === 'approved')

                  return (
                    <div
                      key={day}
                      onClick={() => dayApps.length > 0 && setSelectedApp(dayApps[0])}
                      className={`h-12 border-b border-r border-slate-100 flex flex-col items-center justify-center gap-0.5 relative ${
                        dayApps.length > 0 ? 'cursor-pointer hover:opacity-80' : weekend ? 'cursor-default' : 'cursor-default'
                      }`}
                      style={style ? { background: style.bg } : weekend ? { background: '#f8fafc' } : {}}
                    >
                      <span className="text-[11px] font-bold leading-none" style={{ color: style ? style.text : weekend ? '#cbd5e1' : '#94a3b8' }}>
                        {day}
                      </span>
                      {s && (
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: style!.dot }} />
                      )}
                      {/* Leave application dots */}
                      {dayApps.length > 0 && !s && (
                        <div className="flex gap-0.5">
                          {hasApprovedApp && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                          {hasPendingApp && <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Leave applications list */}
              {leaveApps.length > 0 && (
                <div className="px-4 py-3 border-t border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Applications this month</p>
                  <div className="space-y-2">
                    {leaveApps.map(app => (
                      <button
                        key={app.id}
                        onClick={() => setSelectedApp(app)}
                        className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                      >
                        <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ background: LEAVE_STATUS_DOT[app.status] }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-slate-700">{LEAVE_TYPE_LABELS[app.leave_type]}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${LEAVE_STATUS_COLORS[app.status]}`}>
                              {LEAVE_STATUS_LABELS[app.status]}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-0.5">{shortDate(app.start_date)} → {shortDate(app.end_date)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Application detail sub-modal */}
      {selectedApp && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setSelectedApp(null)}>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-sm">{LEAVE_TYPE_LABELS[selectedApp.leave_type]}</h3>
              <button onClick={() => setSelectedApp(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="flex items-center gap-2">
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
                <p className="text-[10px] font-semibold text-slate-500">Approval Status</p>
                {selectedApp.approvals.map(a => (
                  <div key={a.id} className={`text-xs px-3 py-2 rounded-lg ${a.status === 'approved' ? 'bg-green-50' : a.status === 'rejected' ? 'bg-red-50' : 'bg-amber-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.approver?.full_name ?? a.approver_role}</span>
                      <span className={`font-medium ${a.status === 'approved' ? 'text-green-700' : a.status === 'rejected' ? 'text-red-700' : 'text-amber-700'}`}>
                        {LEAVE_STATUS_LABELS[a.status]}
                      </span>
                    </div>
                    {a.comments && <p className="mt-1 italic text-slate-600">"{a.comments}"</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Mark Sheet ────────────────────────────────────────────────────────────

interface AttendanceMarkSheetProps {
  homeroomId: string
  homeroomName: string
  markedBy: string
  onClose: () => void
}

export default function AttendanceMarkSheet({ homeroomId, homeroomName, markedBy, onClose }: AttendanceMarkSheetProps) {
  const [date, setDate] = useState(todayString)
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [expandedRemarks, setExpandedRemarks] = useState<Set<string>>(new Set())
  const [calendarStudent, setCalendarStudent] = useState<UserProfile | null>(null)

  const loadSheet = useCallback(async () => {
    setLoading(true)
    setSaved(false)
    const data = await fetchAttendanceSheet(homeroomId, date)
    setRows(initRows(data))
    setLoading(false)
  }, [homeroomId, date])

  useEffect(() => { loadSheet() }, [loadSheet])

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    setRows(prev => prev.map(r =>
      r.student.id === studentId ? { ...r, status, changed: true } : r
    ))
  }

  const setRemarks = (studentId: string, remarks: string) => {
    setRows(prev => prev.map(r =>
      r.student.id === studentId ? { ...r, remarks, changed: true } : r
    ))
  }

  const toggleOverride = (studentId: string) => {
    setRows(prev => prev.map(r =>
      r.student.id === studentId ? { ...r, overrideLeave: !r.overrideLeave } : r
    ))
  }

  const markAllPresent = () => {
    setRows(prev => prev.map(r =>
      (!r.leaveLinked || r.overrideLeave) ? { ...r, status: 'present', changed: true } : r
    ))
  }

  const handleSave = async () => {
    setSaving(true)
    const toSave = rows
      .filter(r => r.changed || !r.leaveLinked)
      .map(r => ({ studentId: r.student.id, status: r.status, remarks: r.remarks || undefined }))

    if (toSave.length > 0) {
      await bulkMarkAttendance(homeroomId, date, toSave, markedBy)
    }
    setSaved(true)
    setSaving(false)
    await loadSheet()
  }

  const markedCount = rows.filter(r => r.changed || r.leaveLinked).length
  const hasChanges = rows.some(r => r.changed)

  // Derive year/month from the selected date for the student calendar
  const [calYear, calMonth] = date.split('-').map(Number)

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh] sm:max-h-[85vh] rounded-t-2xl">

          {/* Header */}
          <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-100 flex-shrink-0">
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-slate-800 text-sm truncate">{homeroomName}</h2>
              <p className="text-[10px] text-slate-500">Attendance Sheet</p>
            </div>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400"
            />
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0">
              <X size={18} />
            </button>
          </div>

          {/* Date label + Save (top) */}
          <div className="px-4 sm:px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between flex-shrink-0 gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-slate-500 font-medium truncate">{formatDate(date)}</span>
              {hasChanges && <span className="text-[10px] text-amber-600 font-medium flex-shrink-0">• Unsaved</span>}
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-lg hover:from-violet-600 hover:to-purple-700 disabled:opacity-40 transition-all shadow-sm flex-shrink-0"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saved && !hasChanges ? 'Saved' : 'Save'}
            </button>
          </div>

          {/* Toolbar */}
          <div className="px-4 sm:px-5 py-2 border-b border-slate-100 flex items-center gap-3 flex-shrink-0">
            <button
              onClick={markAllPresent}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
            >
              <CheckSquare size={12} />
              All Present
            </button>
            <span className="text-xs text-slate-400 ml-auto">
              {rows.length} student{rows.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Roster */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">Loading roster…</span>
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center">
                <Users size={36} className="text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400">No students in this homeroom</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {rows.map((row, idx) => {
                  const isLocked = row.leaveLinked && !row.overrideLeave
                  const showRemarks = expandedRemarks.has(row.student.id)
                  const statusStyle = LEAVE_CELL[row.status]
                  return (
                    <div key={row.student.id} className={`px-3 sm:px-4 py-3 transition-colors ${row.changed ? 'bg-violet-50/30' : ''}`}>
                      {/* Row 1: index + avatar + name + controls */}
                      <div className="flex items-center gap-2 sm:gap-3">
                        <span className="text-xs text-slate-400 w-5 text-right flex-shrink-0">{idx + 1}</span>
                        <Avatar
                          avatarUrl={row.student.avatar_url}
                          name={row.student.full_name}
                          email={row.student.email}
                          size={30}
                          userId={row.student.id}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate leading-tight">{row.student.full_name}</p>
                          {row.leaveLinked && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                              row.status === 'on_duty' ? 'text-teal-700 bg-teal-50' : 'text-blue-600 bg-blue-50'
                            }`}>
                              {row.status === 'on_duty' ? 'On Duty' : 'Approved Leave'}
                            </span>
                          )}
                        </div>

                        {/* Calendar view button */}
                        <button
                          onClick={() => setCalendarStudent(row.student)}
                          className="p-1.5 text-slate-300 hover:text-violet-500 hover:bg-violet-50 rounded-lg transition-colors flex-shrink-0"
                          title="View student calendar"
                        >
                          <Calendar size={13} />
                        </button>

                        {/* Leave lock toggle */}
                        {row.leaveLinked && (
                          <button
                            onClick={() => toggleOverride(row.student.id)}
                            className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${row.overrideLeave ? 'text-amber-500 bg-amber-50' : 'text-blue-400 bg-blue-50'}`}
                            title={row.overrideLeave ? 'Leave override active' : 'Click to override leave'}
                          >
                            {row.overrideLeave ? <Unlock size={12} /> : <Lock size={12} />}
                          </button>
                        )}

                        {/* Remarks toggle */}
                        <button
                          onClick={() => setExpandedRemarks(prev => {
                            const next = new Set(prev)
                            next.has(row.student.id) ? next.delete(row.student.id) : next.add(row.student.id)
                            return next
                          })}
                          className="p-1.5 text-slate-300 hover:text-slate-500 transition-colors flex-shrink-0"
                        >
                          {showRemarks ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      </div>

                      {/* Row 2: Status buttons */}
                      <div className={`flex gap-1.5 mt-2 ml-7 sm:ml-9 ${isLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                        {STATUS_OPTIONS.map(s => (
                          <button
                            key={s}
                            onClick={() => setStatus(row.student.id, s)}
                            className={`flex-1 h-8 rounded-lg border text-[10px] font-bold transition-all ${
                              row.status === s ? STATUS_COLORS[s] : `bg-white ${STATUS_INACTIVE[s]}`
                            }`}
                            title={ATTENDANCE_STATUS_LABELS[s]}
                          >
                            {STATUS_SHORT[s]}
                          </button>
                        ))}
                      </div>

                      {/* Remarks input */}
                      {showRemarks && (
                        <div className="mt-2 ml-7 sm:ml-9">
                          <input
                            type="text"
                            value={row.remarks}
                            onChange={e => setRemarks(row.student.id, e.target.value)}
                            placeholder="Add a remark (optional)…"
                            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 text-slate-700"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 sm:px-5 py-3.5 border-t border-slate-100 flex items-center gap-3 flex-shrink-0 bg-white">
            <span className="text-xs text-slate-400 flex-1">
              {markedCount} / {rows.length} marked
            </span>
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-medium transition-colors">
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl hover:from-violet-600 hover:to-purple-700 disabled:opacity-50 transition-all shadow-sm"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saved && !hasChanges ? 'Saved!' : 'Save Attendance'}
            </button>
          </div>
        </div>
      </div>

      {/* Student calendar modal */}
      {calendarStudent && (
        <StudentCalendarModal
          student={calendarStudent}
          initialYear={calYear}
          initialMonth={calMonth}
          homeroomId={homeroomId}
          onClose={() => setCalendarStudent(null)}
        />
      )}
    </>
  )
}
