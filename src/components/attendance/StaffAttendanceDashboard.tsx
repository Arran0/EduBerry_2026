'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Home, Search, Clock, ChevronRight, X, Save, Loader2,
  CheckSquare, Lock, Unlock, ChevronDown, ChevronUp,
  Users, CalendarDays,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import Avatar from '@/components/Avatar'
import StudentCalendarModal from '@/components/attendance/StudentCalendarModal'
import { Homeroom, HomeroomClassTeacher, searchHomerooms } from '@/lib/homerooms'
import {
  AttendanceStatus,
  ATTENDANCE_STATUS_LABELS,
  fetchAttendanceSheet,
  bulkMarkAttendance,
} from '@/lib/attendance'
import {
  LeaveApplicationWithDetails,
  fetchLeaveApplicationsForStudentByMonth,
  processLeaveApproval,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_COLORS,
} from '@/lib/leave'
import { UserProfile } from '@/lib/supabase'
import { DateToggler } from '@/components/workspace/ui'
import { QUICK_GROUP, quickButtonClass } from '@/components/attendance/reportKit'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SlimHomeroom {
  id: string
  name: string
  grade: number | null
  section: string | null
  class_teacher: HomeroomClassTeacher | null
}

interface RowState {
  student: UserProfile
  status: AttendanceStatus
  remarks: string
  changed: boolean
  leaveLinked: boolean
  overrideLeave: boolean
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_OPTIONS: AttendanceStatus[] = ['present', 'absent', 'late', 'half_day']
const STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: 'P', absent: 'A', late: 'L', on_leave: 'OL', excused: 'E', on_duty: 'OD', half_day: 'HD',
}
// The staff report's quick-set capsule colours, so marking reads the same in
// both attendance apps.
const STATUS_ACTIVE: Record<AttendanceStatus, string> = {
  present:  'bg-emerald-600 text-white border-emerald-600',
  absent:   'bg-red-600 text-white border-red-600',
  late:     'bg-amber-500 text-white border-amber-500',
  on_leave: 'bg-blue-600 text-white border-blue-600',
  excused:  'bg-purple-600 text-white border-purple-600',
  on_duty:  'bg-teal-600 text-white border-teal-600',
  half_day: 'bg-orange-500 text-white border-orange-500',
}
const STATUS_DOT: Partial<Record<AttendanceStatus, string>> = {
  present: '#059669', absent: '#dc2626', late: '#f59e0b', half_day: '#f97316',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayString() { return new Date().toISOString().split('T')[0] }

function shortDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  })
}

function recentKey(staffId: string) { return `hr_recent_${staffId}` }

function readRecents(staffId: string): SlimHomeroom[] {
  if (typeof window === 'undefined') return []
  return JSON.parse(localStorage.getItem(recentKey(staffId)) ?? '[]')
}

function pushRecent(staffId: string, hr: SlimHomeroom) {
  const updated = [hr, ...readRecents(staffId).filter(r => r.id !== hr.id)].slice(0, 8)
  localStorage.setItem(recentKey(staffId), JSON.stringify(updated))
}

// ─── Student Calendar Dialog ──────────────────────────────────────────────────

function StudentCalendarDialog({
  student, homeroomId, viewerId, onClose,
}: {
  student: UserProfile
  homeroomId: string
  viewerId: string
  onClose: () => void
}) {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [leaveApps, setLeaveApps] = useState<LeaveApplicationWithDetails[]>([])
  const [leaveLoading, setLeaveLoading] = useState(true)
  const [selectedApp, setSelectedApp] = useState<LeaveApplicationWithDetails | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [decisionComment, setDecisionComment] = useState('')
  const [decisionWarning, setDecisionWarning] = useState<string | null>(null)

  const loadLeaveApps = useCallback(async () => {
    setLeaveLoading(true)
    const apps = await fetchLeaveApplicationsForStudentByMonth(student.id, year, month)
    setLeaveApps(apps)
    setLeaveLoading(false)
  }, [student.id, year, month])

  useEffect(() => { loadLeaveApps() }, [loadLeaveApps])

  const handleDecide = async (app: LeaveApplicationWithDetails, decision: 'approved' | 'rejected') => {
    const myApproval = app.approvals.find(a => a.approver_id === viewerId && a.status === 'pending')
    if (!myApproval) return
    setDeciding(true)
    setDecisionWarning(null)
    const res = await processLeaveApproval(myApproval.id, viewerId, decision, decisionComment || undefined)
    setDeciding(false)
    if (!res.ok) return
    setDecisionComment('')
    await loadLeaveApps()
    if (!res.attendanceSynced) {
      // Saved, but the attendance rows it should have written are missing. Hold the
      // panel open with the warning instead of closing on a half-done job.
      setDecisionWarning('Decision saved, but attendance was not updated for these dates. Please mark it manually.')
      return
    }
    setSelectedApp(null)
  }

  return (
    <>
      {/* The same calendar popup as the report's and the staff app's: fades
          and rises in on the glass sheet. Its height is fixed by its parts —
          the calendar is a fixed size and the applications box below it has
          a fixed height of its own (its list scrolls) — so the sheet never
          opens short and grows when the month or the applications arrive. */}
      <StudentCalendarModal
        student={student}
        subtitle="Monthly attendance and applications"
        homeroomId={homeroomId}
        year={year}
        month={month}
        onMonthChange={(y, m) => { setYear(y); setMonth(m) }}
        onAppOpen={app => { setSelectedApp(app); setDecisionComment('') }}
        onClose={onClose}
        below={
          // Leave applications this month
          <div className="lg-sheet-card px-3 py-2.5 h-[8.75rem] flex flex-col">
            <p className="text-[12px] font-semibold text-slate-500 mb-2 flex-shrink-0">Applications this month</p>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {leaveLoading ? (
              <div className="space-y-1.5" aria-busy="true">
                <div className="h-11 rounded-xl bg-slate-100 animate-pulse" />
              </div>
            ) : leaveApps.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">No applications this month.</p>
            ) : (
              <div className="space-y-1.5">
                {leaveApps.map(app => {
                  const myApproval = app.approvals.find(a => a.approver_id === viewerId && a.status === 'pending')
                  return (
                    <button
                      key={app.id}
                      onClick={() => { setSelectedApp(app); setDecisionComment('') }}
                      className="w-full text-left flex items-center gap-2 px-3 py-2.5 bg-white hover:bg-slate-50 rounded-xl ring-1 ring-slate-900/[0.06] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{LEAVE_TYPE_LABELS[app.leave_type]}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{shortDate(app.start_date)} → {shortDate(app.end_date)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {myApproval && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">Awaiting your decision</span>
                        )}
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium ${LEAVE_STATUS_COLORS[app.status]}`}>
                          {LEAVE_STATUS_LABELS[app.status]}
                        </span>
                        <ChevronRight size={12} className="text-slate-300" />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            </div>
          </div>
        }
      />

      {/* Application detail + decision modal */}
      {selectedApp && (
        <div
          className="lg-scrim fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
          onClick={() => setSelectedApp(null)}
        >
          <div className="bg-white w-full max-w-sm rounded-[24px] shadow-[0_32px_80px_-24px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/[0.06] p-5 space-y-3" onClick={e => e.stopPropagation()}>
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
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Approval Trail</p>
                {selectedApp.approvals.map(a => (
                  <div key={a.id} className={`text-xs px-3 py-2 rounded-lg ${a.status === 'approved' ? 'bg-green-50' : a.status === 'rejected' ? 'bg-red-50' : 'bg-amber-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.approver?.full_name ?? a.approver_role}</span>
                      <span className={`font-medium ${a.status === 'approved' ? 'text-green-700' : a.status === 'rejected' ? 'text-red-700' : 'text-amber-700'}`}>
                        {LEAVE_STATUS_LABELS[a.status]}
                      </span>
                    </div>
                    {a.comments && <p className="mt-1 italic text-slate-600">&ldquo;{a.comments}&rdquo;</p>}
                  </div>
                ))}
              </div>
            )}
            {/* Decision controls — only for the assigned pending approver */}
            {(() => {
              const myApproval = selectedApp.approvals.find(a => a.approver_id === viewerId && a.status === 'pending')
              if (!myApproval) return null
              return (
                <div className="space-y-2 pt-1 border-t border-slate-100">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Your Decision</p>
                  <textarea
                    value={decisionComment}
                    onChange={e => setDecisionComment(e.target.value)}
                    placeholder="Comments (optional)…"
                    rows={2}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 resize-none"
                  />
                  {decisionWarning && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-medium text-amber-800">
                      {decisionWarning}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDecide(selectedApp, 'approved')}
                      disabled={deciding}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold bg-green-500 text-white rounded-xl hover:bg-green-600 disabled:opacity-40 transition-colors"
                    >
                      {deciding && <Loader2 size={12} className="animate-spin" />}
                      Approve
                    </button>
                    <button
                      onClick={() => handleDecide(selectedApp, 'rejected')}
                      disabled={deciding}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold bg-red-500 text-white rounded-xl hover:bg-red-600 disabled:opacity-40 transition-colors"
                    >
                      {deciding && <Loader2 size={12} className="animate-spin" />}
                      Reject
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Inline Attendance Sheet ──────────────────────────────────────────────────

function InlineSheet({
  homeroom, staffId, onStudentClick,
}: {
  homeroom: SlimHomeroom
  staffId: string
  onStudentClick: (student: UserProfile) => void
}) {
  const [date, setDate] = useState(todayString)
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [expandedRemarks, setExpandedRemarks] = useState<Set<string>>(new Set())

  const loadSheet = useCallback(async () => {
    setLoading(true); setSaved(false)
    const data = await fetchAttendanceSheet(homeroom.id, date)
    setRows(data.map(row => ({
      student: row.student,
      status: row.record?.status ?? 'absent',
      remarks: row.record?.remarks ?? '',
      changed: false,
      leaveLinked: !!(row.record?.leave_application_id),
      overrideLeave: false,
    })))
    setLoading(false)
  }, [homeroom.id, date])

  useEffect(() => { loadSheet() }, [loadSheet])

  const setStatus = (sid: string, status: AttendanceStatus) =>
    setRows(prev => prev.map(r => r.student.id === sid ? { ...r, status, changed: true } : r))

  const setRemarks = (sid: string, remarks: string) =>
    setRows(prev => prev.map(r => r.student.id === sid ? { ...r, remarks, changed: true } : r))

  const toggleOverride = (sid: string) =>
    setRows(prev => prev.map(r => r.student.id === sid ? { ...r, overrideLeave: !r.overrideLeave } : r))

  const markAllPresent = () =>
    setRows(prev => prev.map(r => (!r.leaveLinked || r.overrideLeave) ? { ...r, status: 'present', changed: true } : r))

  const handleSave = async () => {
    setSaving(true)
    setSaveFailed(false)
    const toSave = rows
      .filter(r => r.changed || !r.leaveLinked)
      .map(r => ({ studentId: r.student.id, status: r.status, remarks: r.remarks || undefined }))
    // One upsert for the whole class, so a failure means nobody was marked. The edits
    // are deliberately left on screen so the save can be retried rather than lost.
    const ok = toSave.length === 0 || await bulkMarkAttendance(homeroom.id, date, toSave, staffId)
    setSaving(false)
    if (!ok) { setSaveFailed(true); return }
    setSaved(true)
    await loadSheet()
  }

  const hasChanges = rows.some(r => r.changed)
  const markedCount = rows.filter(r => r.changed || r.leaveLinked).length
  const tally = STATUS_OPTIONS.map(st => ({ st, n: rows.filter(r => r.status === st).length }))
  const markedPct = rows.length ? Math.round((markedCount / rows.length) * 100) : 0

  // Two saves: one up top for short classes, one at the foot. On a phone only
  // the foot's — the toolbar has no room for both actions on one line.
  const saveButton = (big: boolean) => (
    <button
      onClick={handleSave}
      disabled={saving || !hasChanges}
      className={`items-center gap-1.5 rounded-full font-semibold bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-35 transition-colors flex-shrink-0 ${
        big ? 'inline-flex px-4 py-2 text-sm' : 'hidden sm:inline-flex px-3 py-1.5 text-xs'
      }`}
    >
      {saving ? <Loader2 size={big ? 14 : 12} className="animate-spin" /> : <Save size={big ? 14 : 12} />}
      {saved && !hasChanges ? 'Saved' : 'Save'}
    </button>
  )

  return (
    <div className="bg-white">
      {/* Toolbar: the day, the class at a glance, and the two actions */}
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-3.5 py-2.5 bg-slate-50/80 border-b border-slate-100">
        {/* No `max`: a sheet can still be opened on a future date, the way the
            plain date input allowed. */}
        <DateToggler
          value={date}
          onChange={setDate}
          todayStr={todayString()}
          className="inline-flex flex-shrink-0 h-8"
          size="sm"
          glass
        />
        <span className="text-xs text-slate-400 hidden lg:block truncate">{formatDate(date)}</span>

        {/* Live tally of the sheet as it stands, edits included */}
        <div className="hidden sm:flex items-center gap-1 ml-1">
          {tally.map(({ st, n }) => (
            <span
              key={st}
              title={ATTENDANCE_STATUS_LABELS[st]}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white ring-1 ring-slate-900/[0.06] text-slate-600 tabular-nums"
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT[st] }} />
              {STATUS_SHORT[st]} {loading ? '–' : n}
            </span>
          ))}
        </div>

        <div className="flex-1" />
        {hasChanges && <span className="text-[11px] text-amber-600 font-semibold flex-shrink-0">Unsaved</span>}
        <button
          onClick={markAllPresent}
          disabled={loading || rows.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white text-emerald-700 ring-1 ring-emerald-600/20 rounded-full hover:bg-emerald-50 disabled:opacity-40 transition-colors flex-shrink-0"
        >
          <CheckSquare size={12} />
          <span className="hidden sm:inline">Mark all present</span>
          <span className="sm:hidden">All present</span>
        </button>
        {saveButton(false)}
      </div>

      {/* Roster — rows are sized so ~15 students fit before it starts to
          scroll, since marking a class means working down the whole list. */}
      <div className="max-h-[620px] overflow-y-auto overscroll-contain">
        {loading ? (
          // The roster's own shape in grey, so the sheet opens at its size.
          <div className="divide-y divide-slate-100" aria-busy="true" aria-label="Loading roster">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-3 sm:px-3.5 py-2">
                <span className="w-[26px] h-[26px] rounded-full bg-slate-100 animate-pulse flex-shrink-0" />
                <span className="h-3 rounded bg-slate-100 animate-pulse" style={{ width: `${30 + ((i * 17) % 25)}%` }} />
                <span className="flex-1" />
                <span className="h-7 w-[7.5rem] sm:w-[8.5rem] rounded-[11px] bg-slate-100 animate-pulse" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center">
            <Users size={30} className="text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No students in this homeroom</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((row, idx) => {
              const isLocked = row.leaveLinked && !row.overrideLeave
              const showRemarks = expandedRemarks.has(row.student.id)
              return (
                <div
                  key={row.student.id}
                  className={`relative px-3 sm:px-3.5 py-1.5 transition-colors ${row.changed ? 'bg-violet-50/50' : 'hover:bg-slate-50/70'}`}
                >
                  {/* Edited, not yet saved */}
                  {row.changed && (
                    <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full" style={{ background: 'var(--page-gradient-from, #7c3aed)' }} />
                  )}
                  <div className="flex items-center gap-2 sm:gap-2.5">
                    <span className="text-[11px] text-slate-300 w-4 text-right flex-shrink-0 tabular-nums hidden sm:block">{idx + 1}</span>
                    <Avatar
                      avatarUrl={row.student.avatar_url}
                      name={row.student.full_name}
                      email={row.student.email}
                      size={26}
                      userId={row.student.id}
                    />
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <button
                        onClick={() => onStudentClick(row.student)}
                        title={`Open ${row.student.full_name}'s calendar`}
                        className="group min-w-0 flex items-center gap-1 text-[13px] font-semibold text-slate-900 hover:text-violet-700 transition-colors text-left"
                      >
                        <span className="truncate">{row.student.full_name}</span>
                        <CalendarDays size={11} className="text-slate-300 group-hover:text-violet-400 transition-colors flex-shrink-0" />
                      </button>
                      {/* Beside the name rather than under it, so the row stays
                          one line tall whether or not there is a leave on it. */}
                      {row.leaveLinked && (
                        <span className="text-[9.5px] px-1.5 py-0.5 rounded-full font-semibold text-violet-700 bg-violet-50 flex-shrink-0 hidden sm:inline">
                          {row.status === 'present' ? 'OD auto-marked' : 'Leave auto-marked'}
                        </span>
                      )}
                    </div>
                    {row.leaveLinked && (
                      <button
                        onClick={() => toggleOverride(row.student.id)}
                        className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${row.overrideLeave ? 'text-amber-600 bg-amber-50 ring-1 ring-amber-500/30' : 'text-blue-500 bg-blue-50 ring-1 ring-blue-500/20'}`}
                        title={row.overrideLeave ? 'Override active — click to revert' : 'Click to override leave status'}
                        aria-pressed={row.overrideLeave}
                      >
                        {row.overrideLeave ? <Unlock size={12} /> : <Lock size={12} />}
                      </button>
                    )}
                    <div className={`${QUICK_GROUP} ${isLocked ? 'opacity-40 pointer-events-none' : ''}`} role="group" aria-label={`Status for ${row.student.full_name}`}>
                      {STATUS_OPTIONS.map(st => (
                        <button
                          key={st}
                          onClick={() => setStatus(row.student.id, st)}
                          aria-pressed={row.status === st}
                          className={quickButtonClass(row.status === st, STATUS_ACTIVE[st], false)}
                          title={ATTENDANCE_STATUS_LABELS[st]}
                        >
                          {STATUS_SHORT[st]}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setExpandedRemarks(prev => {
                        const next = new Set(prev)
                        next.has(row.student.id) ? next.delete(row.student.id) : next.add(row.student.id)
                        return next
                      })}
                      aria-label={showRemarks ? 'Hide remark' : 'Add a remark'}
                      className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${row.remarks ? 'text-violet-500' : 'text-slate-300'} hover:text-slate-600 hover:bg-slate-100`}
                    >
                      {showRemarks ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                  {showRemarks && (
                    <div className="mt-1.5 ml-[34px] sm:ml-[60px]">
                      <input
                        type="text"
                        value={row.remarks}
                        onChange={e => setRemarks(row.student.id, e.target.value)}
                        placeholder="Add a remark (optional)"
                        className="w-full rounded-xl px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 bg-slate-100 border border-transparent focus:outline-none focus:bg-white focus:border-slate-300 transition-colors"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer: how much of the class is marked, and the save */}
      <div className="px-3 sm:px-3.5 py-2.5 border-t border-slate-100 bg-slate-50/80 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-700 tabular-nums">{markedCount} / {rows.length}</span>
            <span className="text-slate-500 truncate">marked</span>
            {saveFailed ? (
              <span className="font-semibold text-rose-600 truncate">Not saved — nothing was recorded. Try again.</span>
            ) : hasChanges ? (
              <span className="font-semibold text-amber-600 truncate">Unsaved changes</span>
            ) : null}
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-200/70 overflow-hidden max-w-xs">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${markedPct}%`, background: 'var(--page-gradient-from, #7c3aed)' }}
            />
          </div>
        </div>
        {saveButton(true)}
      </div>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function StaffAttendanceDashboard({ staffId }: { staffId: string }) {
  const [recents, setRecents] = useState<SlimHomeroom[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Homeroom[]>([])
  const [searching, setSearching] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [calendarState, setCalendarState] = useState<{ student: UserProfile; homeroomId: string } | null>(null)

  const refreshRecents = useCallback(() => {
    setRecents(readRecents(staffId).slice(0, 3))
  }, [staffId])

  useEffect(() => { refreshRecents() }, [refreshRecents])

  // Debounced homeroom search
  useEffect(() => {
    if (!query.trim()) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      setSearchResults(await searchHomerooms(query))
      setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const openHomeroom = (hr: SlimHomeroom) => {
    pushRecent(staffId, hr)
    refreshRecents()
    setExpandedId(prev => prev === hr.id ? null : hr.id)
    setShowSearch(false)
    setQuery('')
    setSearchResults([])
  }

  const gradeLabel = (hr: SlimHomeroom) =>
    hr.grade != null && hr.section ? `Grade ${hr.grade} · ${hr.section}`
      : hr.grade != null ? `Grade ${hr.grade}` : hr.section ?? ''

  return (
    // One glass pane, like the student view and the report below it: the
    // header and the finder on the glass, each recent homeroom a solid card.
    <div className="lg-pane p-2 sm:p-2.5">
      <div className="relative space-y-2">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-2 px-1.5 pt-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
            style={{ background: 'linear-gradient(135deg, var(--page-gradient-from, #7c3aed), var(--page-gradient-to, #a855f7))' }}
          >
            <Clock size={16} className="text-white" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-slate-900 leading-tight whitespace-nowrap">Recent homerooms</h2>
            <p className="hidden sm:block text-[11px] text-slate-500 truncate mt-0.5">Open a sheet to mark attendance</p>
          </div>
        </div>
        <button
          onClick={() => { setShowSearch(v => !v); setQuery(''); setSearchResults([]) }}
          aria-pressed={showSearch}
          className={`inline-flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 text-xs font-semibold rounded-full transition-colors flex-shrink-0 ${
            showSearch
              ? 'bg-slate-900 text-white hover:bg-slate-800'
              : 'bg-white text-slate-800 ring-1 ring-slate-900/[0.08] shadow-[0_1px_2px_rgba(15,23,42,0.06)] hover:bg-slate-50'
          }`}
        >
          {showSearch ? <X size={13} /> : <Search size={13} />}
          {showSearch ? 'Close' : <><span className="sm:hidden">Find</span><span className="hidden sm:inline">Find homeroom</span></>}
        </button>
      </div>

      {/* ── Search panel ── */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="relative z-20"
          >
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, grade or section"
              className="w-full pl-9 pr-3 py-2 bg-white rounded-xl text-sm text-slate-900 placeholder:text-slate-400 ring-1 ring-slate-900/[0.08] focus:outline-none focus:ring-2 focus:ring-violet-500/30 transition-shadow"
            />
            {(searching || searchResults.length > 0) && (
              <div className="absolute z-20 top-full mt-1.5 w-full bg-white rounded-2xl ring-1 ring-slate-900/[0.08] shadow-[0_18px_40px_-18px_rgba(15,23,42,0.35)] overflow-hidden">
                {searching ? (
                  <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-400">
                    <Loader2 size={14} className="animate-spin" /> Searching…
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto p-1">
                    {searchResults.map(hr => (
                      <button
                        key={hr.id}
                        onClick={() => openHomeroom({ id: hr.id, name: hr.name, grade: hr.grade, section: hr.section, class_teacher: hr.class_teacher ?? null })}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-slate-50 text-left transition-colors"
                      >
                        <span className="w-7 h-7 rounded-[9px] bg-violet-50 text-violet-600 flex items-center justify-center flex-shrink-0">
                          <Home size={13} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-semibold text-slate-900 truncate">{hr.name}</span>
                          {hr.class_teacher && (
                            <span className="block text-[11px] text-slate-400 truncate">{hr.class_teacher.full_name}</span>
                          )}
                        </span>
                        {(hr.grade || hr.section) && (
                          <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 flex-shrink-0">
                            {hr.grade && hr.section
                              ? `Gr ${hr.grade} · ${hr.section}`
                              : hr.grade ? `Grade ${hr.grade}` : hr.section}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Empty state ── */}
      {recents.length === 0 && !showSearch && (
        <div className="lg-content py-8 text-center px-6">
          <div className="w-11 h-11 rounded-2xl bg-slate-50 ring-1 ring-slate-900/[0.05] flex items-center justify-center mx-auto mb-2.5">
            <Home size={20} className="text-slate-300" />
          </div>
          <p className="text-sm font-semibold text-slate-800 mb-0.5">No recent homerooms</p>
          <p className="text-xs text-slate-500 mb-3.5">Find a homeroom to open its attendance sheet.</p>
          <button
            onClick={() => setShowSearch(true)}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-full transition-colors"
          >
            <Search size={13} />
            Find homeroom
          </button>
        </div>
      )}

      {/* ── Homeroom cards ──
          Each one a solid card on the glass: the room's tile, its name, who
          teaches it, and a capsule that says what a tap does. The open one
          lifts a little and its capsule turns dark; the sheet unfolds inside. */}
      <div className="space-y-2">
        {recents.map(hr => {
          const isExpanded = expandedId === hr.id
          const sub = gradeLabel(hr)
          return (
            <div
              key={hr.id}
              // A hairline border on top of the card's own shadow, so each
              // recent homeroom reads as a distinct button on the glass.
              className={`lg-content !border !border-slate-900/[0.09] overflow-hidden transition-shadow duration-200 ${
                isExpanded ? 'shadow-[0_1px_2px_rgba(15,23,42,0.06),0_22px_44px_-24px_rgba(15,23,42,0.5)]' : ''
              }`}
            >
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onClick={() => openHomeroom(hr)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHomeroom(hr) } }}
                className={`group w-full flex items-center gap-3 px-3 sm:px-3.5 py-2.5 text-left cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 ${
                  isExpanded ? 'bg-slate-50/80 border-b border-slate-100' : 'hover:bg-slate-50/70'
                }`}
              >
                <span
                  className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0 shadow-[0_4px_10px_-4px_rgba(15,23,42,0.35),inset_0_1px_0_rgba(255,255,255,0.35)]"
                  style={{ background: 'linear-gradient(135deg, var(--page-gradient-from, #7c3aed), var(--page-gradient-to, #a855f7))' }}
                >
                  <Home size={18} className="text-white" />
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-[15px] font-bold text-slate-900 leading-tight truncate">{hr.name}</p>
                    {/* Only when the name doesn't already say it ("Grade 5 A"). */}
                    {sub && !(hr.grade != null && hr.name.includes(String(hr.grade))) && (
                      <span className="hidden sm:inline text-[10.5px] font-semibold px-1.5 py-[1px] rounded-full bg-slate-100 text-slate-500 flex-shrink-0">
                        {sub}
                      </span>
                    )}
                  </div>
                  {hr.class_teacher ? (
                    <div className="flex items-center gap-1.5 mt-1 min-w-0">
                      <Avatar
                        avatarUrl={hr.class_teacher.avatar_url}
                        name={hr.class_teacher.full_name}
                        email={hr.class_teacher.email}
                        size={16}
                        userId={hr.class_teacher.id}
                      />
                      <span className="text-xs text-slate-500 truncate">{hr.class_teacher.full_name}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 mt-1">No class teacher</p>
                  )}
                </div>

                <span
                  className={`inline-flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 transition-colors ${
                    isExpanded
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 group-hover:bg-slate-900 group-hover:text-white'
                  }`}
                >
                  <span className="hidden sm:inline">{isExpanded ? 'Close' : 'Open sheet'}</span>
                  <ChevronRight
                    size={15}
                    className={`transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`}
                  />
                </span>
              </div>

              {/* Inline attendance sheet */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    style={{ overflow: 'hidden' }}
                  >
                    <InlineSheet
                      homeroom={hr}
                      staffId={staffId}
                      onStudentClick={student => setCalendarState({ student, homeroomId: hr.id })}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
      </div>

      {/* ── Student calendar dialog ── */}
      <AnimatePresence>
        {calendarState && (
        <StudentCalendarDialog
          student={calendarState.student}
          homeroomId={calendarState.homeroomId}
          viewerId={staffId}
          onClose={() => setCalendarState(null)}
        />
        )}
      </AnimatePresence>
    </div>
  )
}
