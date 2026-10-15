'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Home, Search, Clock, ChevronRight, X, Save, Loader2,
  CheckSquare, Lock, Unlock, ChevronDown, ChevronUp,
  Users, CalendarDays,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import Avatar from '@/components/Avatar'
import AttendanceCalendar from '@/components/attendance/AttendanceCalendar'
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

const STATUS_OPTIONS: AttendanceStatus[] = ['present', 'absent', 'late']
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
    const ok = await processLeaveApproval(myApproval.id, viewerId, decision, decisionComment || undefined)
    setDeciding(false)
    if (ok) {
      setDecisionComment('')
      setSelectedApp(null)
      await loadLeaveApps()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh] sm:max-h-[90vh] rounded-t-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-violet-600 to-purple-500 flex-shrink-0">
          <Avatar
            avatarUrl={student.avatar_url}
            name={student.full_name}
            email={student.email}
            size={40}
            userId={student.id}
          />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-base truncate">{student.full_name}</p>
            <p className="text-xs text-violet-200">Monthly Attendance &amp; Applications</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/70 hover:text-white hover:bg-white/20 rounded-xl transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <AttendanceCalendar
            studentId={student.id}
            homeroomId={homeroomId}
            year={year}
            month={month}
            onMonthChange={(y, m) => { setYear(y); setMonth(m) }}
            onAppOpen={app => { setSelectedApp(app); setDecisionComment('') }}
          />

          {/* Leave applications this month */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-0.5">
              Applications This Month
            </p>
            {leaveLoading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : leaveApps.length === 0 ? (
              <p className="text-xs text-slate-400 italic px-1">No applications this month.</p>
            ) : (
              <div className="space-y-2">
                {leaveApps.map(app => {
                  const myApproval = app.approvals.find(a => a.approver_id === viewerId && a.status === 'pending')
                  return (
                    <button
                      key={app.id}
                      onClick={() => { setSelectedApp(app); setDecisionComment('') }}
                      className="w-full text-left flex items-center gap-2 px-3 py-2.5 bg-slate-50 hover:bg-violet-50 rounded-xl border border-slate-100 hover:border-violet-200 transition-colors"
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
      </div>

      {/* Application detail + decision modal */}
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
    </div>
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
    // One upsert for the whole class, so a failure means nobody was marked. Reporting
    // success anyway is what let a rejected status discard a register silently; the
    // edits are deliberately left on screen so the save can be retried.
    const ok = toSave.length === 0 || await bulkMarkAttendance(homeroom.id, date, toSave, staffId)
    setSaving(false)
    if (!ok) { setSaveFailed(true); return }
    setSaved(true)
    await loadSheet()
  }

  const hasChanges = rows.some(r => r.changed)
  const markedCount = rows.filter(r => r.changed || r.leaveLinked).length

  return (
    <div className="border-t border-[#E4E4E7]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 sm:px-4 py-2 bg-[#FAFAF9] border-b border-[#E4E4E7]">
        {/* No `max`: a sheet can still be opened on a future date, the way the
            plain date input allowed. */}
        <DateToggler
          value={date}
          onChange={setDate}
          todayStr={todayString()}
          className="inline-flex flex-shrink-0"
          size="sm"
        />
        <span className="text-xs text-[#A1A1AA] hidden lg:block truncate flex-1 min-w-0">{formatDate(date)}</span>
        <div className="flex-1 lg:hidden" />
        {hasChanges && <span className="text-[10px] text-amber-600 font-medium flex-shrink-0">• Unsaved</span>}
        <button
          onClick={markAllPresent}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium bg-white text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors flex-shrink-0"
        >
          <CheckSquare size={12} />
          All P
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-[#27272A] hover:bg-[#18181B] text-white rounded-lg disabled:opacity-40 transition-colors flex-shrink-0"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saved && !hasChanges ? 'Saved' : 'Save'}
        </button>
      </div>

      {/* Roster — rows are sized so ~15 students fit before it starts to
          scroll, since marking a class means working down the whole list. */}
      <div className="max-h-[620px] overflow-y-auto bg-white">
        {loading ? (
          <div className="flex items-center justify-center py-14 gap-2 text-slate-400">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading roster…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <Users size={32} className="text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No students in this homeroom</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {rows.map((row, idx) => {
              const isLocked = row.leaveLinked && !row.overrideLeave
              const showRemarks = expandedRemarks.has(row.student.id)
              return (
                <div
                  key={row.student.id}
                  className={`px-2.5 sm:px-4 py-1.5 transition-colors ${row.changed ? 'bg-violet-50/50' : 'hover:bg-slate-50/60'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-300 w-4 text-right flex-shrink-0 tabular-nums">{idx + 1}</span>
                    <Avatar
                      avatarUrl={row.student.avatar_url}
                      name={row.student.full_name}
                      email={row.student.email}
                      size={26}
                      userId={row.student.id}
                    />
                    <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                      <button
                        onClick={() => onStudentClick(row.student)}
                        className="group min-w-0 flex items-center gap-1 text-[13px] font-semibold text-slate-800 hover:text-violet-600 transition-colors text-left"
                      >
                        <span className="truncate">{row.student.full_name}</span>
                        <CalendarDays size={11} className="text-slate-300 group-hover:text-violet-400 transition-colors flex-shrink-0" />
                      </button>
                      {/* Beside the name rather than under it, so the row stays
                          one line tall whether or not there is a leave on it. */}
                      {row.leaveLinked && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium text-violet-700 bg-violet-50 flex-shrink-0 hidden sm:inline">
                          {row.status === 'present' ? 'OD Auto-marked' : 'Leave Auto-marked'}
                        </span>
                      )}
                    </div>
                    {row.leaveLinked && (
                      <button
                        onClick={() => toggleOverride(row.student.id)}
                        className={`p-1 rounded-lg transition-colors flex-shrink-0 ${row.overrideLeave ? 'text-amber-500 bg-amber-50 border border-amber-200' : 'text-blue-400 bg-blue-50 border border-blue-100'}`}
                        title={row.overrideLeave ? 'Override active — click to revert' : 'Click to override leave status'}
                      >
                        {row.overrideLeave ? <Unlock size={12} /> : <Lock size={12} />}
                      </button>
                    )}
                    <div className={`flex gap-0.5 sm:gap-1 flex-shrink-0 ${isLocked ? 'opacity-40 pointer-events-none' : ''}`}>
                      {STATUS_OPTIONS.map(s => (
                        <button
                          key={s}
                          onClick={() => setStatus(row.student.id, s)}
                          className={`w-6 sm:w-7 h-6 sm:h-7 rounded-md border text-[10px] font-bold transition-colors active:scale-95 ${
                            row.status === s ? STATUS_COLORS[s] : `bg-white ${STATUS_INACTIVE[s]}`
                          }`}
                          title={ATTENDANCE_STATUS_LABELS[s]}
                        >
                          {STATUS_SHORT[s]}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setExpandedRemarks(prev => {
                        const next = new Set(prev)
                        next.has(row.student.id) ? next.delete(row.student.id) : next.add(row.student.id)
                        return next
                      })}
                      className="p-1 text-slate-300 hover:text-slate-500 transition-colors flex-shrink-0"
                    >
                      {showRemarks ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                  {showRemarks && (
                    <div className="mt-1.5 ml-[68px] sm:ml-[74px]">
                      <input
                        type="text"
                        value={row.remarks}
                        onChange={e => setRemarks(row.student.id, e.target.value)}
                        placeholder="Add a remark (optional)…"
                        className="w-full border border-[#D4D4D8] rounded-md px-2.5 py-1.5 text-xs text-[#18181B] placeholder:text-[#A1A1AA] bg-white focus:outline-none focus:border-[#27272A] transition-colors"
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
      <div className="px-3 sm:px-4 py-2.5 border-t border-[#E4E4E7] bg-[#FAFAF9] flex items-center gap-2">
        <span className="text-xs text-[#71717A] flex-1 min-w-0 truncate">
          {markedCount} / {rows.length} student{rows.length !== 1 ? 's' : ''} marked
        </span>
        {hasChanges && !saveFailed && (
          <span className="text-xs text-amber-600 font-medium flex-shrink-0">Unsaved changes</span>
        )}
        {saveFailed && (
          <span className="text-xs font-semibold text-rose-600 flex-shrink-0">Not saved — nothing was recorded. Try again.</span>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium bg-[#27272A] hover:bg-[#18181B] text-white rounded-lg disabled:opacity-40 transition-colors flex-shrink-0"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saved && !hasChanges ? 'Saved' : 'Save'}
        </button>
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

  return (
    <div className="space-y-5">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Clock size={12} className="text-violet-400 flex-shrink-0" />
          <span className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-widest truncate">Recent Homerooms</span>
        </div>
        <button
          onClick={() => { setShowSearch(v => !v); setQuery(''); setSearchResults([]) }}
          aria-pressed={showSearch}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors flex-shrink-0 ${
            showSearch
              ? 'bg-[#27272A] text-white border-[#27272A]'
              : 'bg-white text-[#18181B] border-[#D4D4D8] hover:bg-[#F5F5F5]'
          }`}
        >
          {showSearch ? <X size={13} /> : <Search size={13} />}
          {showSearch ? 'Close' : 'Find Homeroom'}
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
            className="relative"
          >
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none z-10" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, grade, or section…"
              className="w-full pl-9 pr-3 py-2 bg-white border border-[#D4D4D8] rounded-lg text-sm text-[#18181B] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors"
            />
            {(searching || searchResults.length > 0) && (
              <div className="absolute z-20 top-full mt-1 w-full bg-white border border-[#D4D4D8] rounded-lg shadow-md overflow-hidden">
                {searching ? (
                  <div className="flex items-center justify-center gap-2 py-3 text-sm text-[#A1A1AA]">
                    <Loader2 size={14} className="animate-spin" /> Searching…
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto py-1">
                    {searchResults.map(hr => (
                      <button
                        key={hr.id}
                        onClick={() => openHomeroom({ id: hr.id, name: hr.name, grade: hr.grade, section: hr.section, class_teacher: hr.class_teacher ?? null })}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#F5F5F5] text-left transition-colors"
                      >
                        <Home size={14} className="text-violet-500 flex-shrink-0" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-[#18181B] truncate">{hr.name}</span>
                          {hr.class_teacher && (
                            <span className="block text-xs text-[#A1A1AA] truncate">{hr.class_teacher.full_name}</span>
                          )}
                        </span>
                        {(hr.grade || hr.section) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F5F5F5] border border-[#E4E4E7] text-[#71717A] flex-shrink-0">
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
        <div className="py-12 text-center px-6 bg-[#FAFAF9] rounded-xl border border-dashed border-[#D4D4D8]">
          <Home size={26} className="text-[#D4D4D8] mx-auto mb-3" />
          <p className="text-sm font-semibold text-[#18181B] mb-1">No recent homerooms</p>
          <p className="text-xs text-[#71717A] mb-4">Search for a homeroom to open its attendance sheet.</p>
          <button
            onClick={() => setShowSearch(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Search size={13} />
            Find a Homeroom
          </button>
        </div>
      )}

      {/* ── Homeroom cards ── */}
      <div className="space-y-3">
        {recents.map((hr, idx) => {
          const isExpanded = expandedId === hr.id
          return (
            // Bordered the same way the staff check-in hero is: a thick frame in
            // the page's own gradient colour, so the sheet you open reads as the
            // one solid module on the screen.
            <div
              key={hr.id}
              className="relative overflow-hidden rounded-[1.5rem] bg-white border-4 transition-shadow duration-200"
              style={{
                borderColor: 'var(--page-gradient-from, #7c3aed)',
                boxShadow: isExpanded
                  ? '0 1px 1px rgba(24,24,27,0.04), 0 18px 44px -18px rgba(24,24,27,0.22)'
                  : '0 1px 1px rgba(24,24,27,0.04), 0 16px 40px -20px rgba(24,24,27,0.18)',
              }}
            >
              {/* Card button */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => openHomeroom(hr)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHomeroom(hr) } }}
                className={`w-full flex items-center gap-2.5 sm:gap-4 px-4 sm:px-6 py-3 sm:py-4 transition-all text-left cursor-pointer ${
                  isExpanded
                    ? 'bg-gradient-to-r from-violet-600 to-purple-500'
                    : 'bg-white hover:bg-slate-50/80'
                }`}
              >
                {/* Number chip */}
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                  isExpanded ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'
                }`}>
                  {idx + 1}
                </div>

                {/* Icon */}
                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                  isExpanded ? 'bg-white/20' : 'bg-gradient-to-br from-violet-100 to-purple-100'
                }`}>
                  <Home size={18} className={isExpanded ? 'text-white' : 'text-violet-500'} />
                </div>

                {/* Name + teacher */}
                <div className="flex-1 min-w-0">
                  <p className={`text-[15px] font-extrabold leading-tight tracking-tight truncate ${
                    isExpanded ? 'text-white' : 'text-slate-800'
                  }`}>
                    {hr.name}
                  </p>
                  {hr.class_teacher && (
                    <div className="flex items-center gap-1.5 mt-1 min-w-0">
                      <Avatar
                        avatarUrl={hr.class_teacher.avatar_url}
                        name={hr.class_teacher.full_name}
                        email={hr.class_teacher.email}
                        size={16}
                        userId={hr.class_teacher.id}
                      />
                      <span className={`text-xs font-medium truncate ${
                        isExpanded ? 'text-violet-200' : 'text-slate-400'
                      }`}>
                        {hr.class_teacher.full_name}
                      </span>
                    </div>
                  )}
                </div>

                {/* Expand indicator */}
                <div className={`flex items-center gap-2 flex-shrink-0 ${isExpanded ? 'text-white/80' : 'text-slate-400'}`}>
                  {!isExpanded && (
                    <span className="text-xs font-semibold hidden sm:block">Open Sheet</span>
                  )}
                  <ChevronRight
                    size={20}
                    className={`transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`}
                  />
                </div>
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

      {/* ── Student calendar dialog ── */}
      {calendarState && (
        <StudentCalendarDialog
          student={calendarState.student}
          homeroomId={calendarState.homeroomId}
          viewerId={staffId}
          onClose={() => setCalendarState(null)}
        />
      )}
    </div>
  )
}
