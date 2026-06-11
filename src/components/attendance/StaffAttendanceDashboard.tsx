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
import { Homeroom, searchHomerooms } from '@/lib/homerooms'
import {
  AttendanceStatus,
  ATTENDANCE_STATUS_LABELS,
  fetchAttendanceSheet,
  bulkMarkAttendance,
} from '@/lib/attendance'
import { UserProfile } from '@/lib/supabase'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SlimHomeroom { id: string; name: string; grade: number | null; section: string | null }

interface RowState {
  student: UserProfile
  status: AttendanceStatus
  remarks: string
  changed: boolean
  leaveLinked: boolean
  overrideLeave: boolean
}

// ─── Status config ────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayString() { return new Date().toISOString().split('T')[0] }

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
  student, homeroomId, onClose,
}: {
  student: UserProfile
  homeroomId: string
  onClose: () => void
}) {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)

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
            <p className="text-xs text-violet-200">Monthly Attendance</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/70 hover:text-white hover:bg-white/20 rounded-xl transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <AttendanceCalendar
            studentId={student.id}
            homeroomId={homeroomId}
            year={year}
            month={month}
            onMonthChange={(y, m) => { setYear(y); setMonth(m) }}
          />
        </div>
      </div>
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
    const toSave = rows
      .filter(r => r.changed || !r.leaveLinked)
      .map(r => ({ studentId: r.student.id, status: r.status, remarks: r.remarks || undefined }))
    if (toSave.length > 0) await bulkMarkAttendance(homeroom.id, date, toSave, staffId)
    setSaved(true); setSaving(false)
    await loadSheet()
  }

  const hasChanges = rows.some(r => r.changed)
  const markedCount = rows.filter(r => r.changed || r.leaveLinked).length

  return (
    <div className="border-t border-violet-100">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3 bg-violet-50/60 border-b border-violet-100">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <CalendarDays size={13} className="text-violet-400 flex-shrink-0" />
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 shadow-sm"
          />
          <span className="text-xs text-slate-400 hidden sm:block truncate">{formatDate(date)}</span>
          {hasChanges && <span className="text-[10px] text-amber-600 font-medium flex-shrink-0">• Unsaved</span>}
        </div>
        <button
          onClick={markAllPresent}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-green-50 text-green-700 border border-green-200 rounded-xl hover:bg-green-100 transition-colors flex-shrink-0"
        >
          <CheckSquare size={13} />
          All P
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl hover:from-violet-600 hover:to-purple-700 disabled:opacity-40 transition-all shadow-sm flex-shrink-0"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saved && !hasChanges ? 'Saved' : 'Save'}
        </button>
      </div>

      {/* Roster */}
      <div className="max-h-[520px] overflow-y-auto bg-white">
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
                  className={`px-3 sm:px-5 py-3 transition-colors ${row.changed ? 'bg-violet-50/50' : 'hover:bg-slate-50/60'}`}
                >
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className="text-xs text-slate-300 w-5 text-right flex-shrink-0 tabular-nums">{idx + 1}</span>
                    <Avatar
                      avatarUrl={row.student.avatar_url}
                      name={row.student.full_name}
                      email={row.student.email}
                      size={34}
                      userId={row.student.id}
                    />
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => onStudentClick(row.student)}
                        className="group flex items-center gap-1 text-sm font-semibold text-slate-800 hover:text-violet-600 transition-colors text-left"
                      >
                        <span className="truncate">{row.student.full_name}</span>
                        <CalendarDays size={11} className="text-slate-300 group-hover:text-violet-400 transition-colors flex-shrink-0" />
                      </button>
                      {row.leaveLinked && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          row.status === 'on_duty' ? 'text-teal-700 bg-teal-50' : 'text-blue-600 bg-blue-50'
                        }`}>
                          {row.status === 'on_duty' ? 'On Duty' : 'Approved Leave'}
                        </span>
                      )}
                    </div>
                    {row.leaveLinked && (
                      <button
                        onClick={() => toggleOverride(row.student.id)}
                        className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${row.overrideLeave ? 'text-amber-500 bg-amber-50 border border-amber-200' : 'text-blue-400 bg-blue-50 border border-blue-100'}`}
                        title={row.overrideLeave ? 'Override active — click to revert' : 'Click to override leave status'}
                      >
                        {row.overrideLeave ? <Unlock size={13} /> : <Lock size={13} />}
                      </button>
                    )}
                    <div className={`flex gap-1 flex-shrink-0 ${isLocked ? 'opacity-40 pointer-events-none' : ''}`}>
                      {STATUS_OPTIONS.map(s => (
                        <button
                          key={s}
                          onClick={() => setStatus(row.student.id, s)}
                          className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg border text-[10px] sm:text-[11px] font-bold transition-all ${
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
                      className="p-1.5 text-slate-300 hover:text-slate-500 transition-colors flex-shrink-0"
                    >
                      {showRemarks ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                  {showRemarks && (
                    <div className="mt-2 ml-[calc(1.25rem+34px+0.75rem)]">
                      <input
                        type="text"
                        value={row.remarks}
                        onChange={e => setRemarks(row.student.id, e.target.value)}
                        placeholder="Add a remark (optional)…"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 text-slate-700 bg-slate-50"
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
      <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center gap-3">
        <span className="text-xs text-slate-400 flex-1">
          {markedCount} / {rows.length} student{rows.length !== 1 ? 's' : ''} marked
        </span>
        {hasChanges && (
          <span className="text-xs text-amber-500 font-medium flex-shrink-0">Unsaved changes</span>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl hover:from-violet-600 hover:to-purple-700 disabled:opacity-40 transition-all shadow-sm flex-shrink-0"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saved && !hasChanges ? 'Saved!' : 'Save'}
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={13} className="text-violet-400" />
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Recent Homerooms</span>
        </div>
        <button
          onClick={() => { setShowSearch(v => !v); setQuery(''); setSearchResults([]) }}
          className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all ${
            showSearch
              ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
              : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-600 shadow-sm'
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
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, grade, or section…"
              className="w-full pl-10 pr-4 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
            />
            {(searching || searchResults.length > 0) && (
              <div className="absolute z-20 top-full mt-2 w-full bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                {searching ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-400">
                    <Loader2 size={14} className="animate-spin" /> Searching…
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto py-1.5">
                    {searchResults.map(hr => (
                      <button
                        key={hr.id}
                        onClick={() => openHomeroom({ id: hr.id, name: hr.name, grade: hr.grade, section: hr.section })}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-violet-50 text-left transition-colors"
                      >
                        <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                          <Home size={15} className="text-violet-500" />
                        </div>
                        <span className="text-sm font-semibold text-slate-800 flex-1">{hr.name}</span>
                        {(hr.grade || hr.section) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100 flex-shrink-0">
                            {hr.grade && hr.section
                              ? `Gr ${hr.grade} · ${hr.section}`
                              : hr.grade ? `Grade ${hr.grade}` : hr.section}
                          </span>
                        )}
                        <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
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
        <div className="py-16 text-center px-8 bg-white rounded-3xl border-2 border-dashed border-slate-200">
          <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-4">
            <Home size={28} className="text-violet-300" />
          </div>
          <p className="font-bold text-slate-600 mb-1">No recent homerooms</p>
          <p className="text-sm text-slate-400 mb-5">Search for a homeroom to open its attendance sheet.</p>
          <button
            onClick={() => setShowSearch(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors shadow-sm"
          >
            <Search size={14} />
            Find a Homeroom
          </button>
        </div>
      )}

      {/* ── Homeroom cards ── */}
      <div className="space-y-3">
        {recents.map((hr, idx) => {
          const isExpanded = expandedId === hr.id
          return (
            <div
              key={hr.id}
              className={`rounded-2xl border overflow-hidden transition-all duration-200 ${
                isExpanded
                  ? 'border-violet-200 shadow-lg shadow-violet-100/50'
                  : 'border-slate-200 shadow-sm hover:shadow-md'
              }`}
            >
              {/* Card button */}
              <button
                onClick={() => openHomeroom(hr)}
                className={`w-full flex items-center gap-3 sm:gap-5 px-4 sm:px-6 py-4 sm:py-5 transition-all text-left ${
                  isExpanded
                    ? 'bg-gradient-to-r from-violet-600 to-purple-500'
                    : 'bg-white hover:bg-slate-50/80'
                }`}
              >
                {/* Number chip */}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  isExpanded ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'
                }`}>
                  {idx + 1}
                </div>

                {/* Icon */}
                <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                  isExpanded ? 'bg-white/20' : 'bg-gradient-to-br from-violet-100 to-purple-100'
                }`}>
                  <Home size={20} className={isExpanded ? 'text-white' : 'text-violet-500'} />
                </div>

                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <p className={`text-[17px] font-extrabold leading-tight tracking-tight ${
                    isExpanded ? 'text-white' : 'text-slate-800'
                  }`}>
                    {hr.name}
                  </p>
                  {(hr.grade || hr.section) && (
                    <p className={`text-sm font-medium mt-1 ${
                      isExpanded ? 'text-violet-200' : 'text-slate-400'
                    }`}>
                      {hr.grade && hr.section
                        ? `Grade ${hr.grade} · Section ${hr.section}`
                        : hr.grade ? `Grade ${hr.grade}` : hr.section}
                    </p>
                  )}
                </div>

                {/* Expand indicator */}
                <div className={`flex items-center gap-2 flex-shrink-0 ${isExpanded ? 'text-white/80' : 'text-slate-400'}`}>
                  {!isExpanded && (
                    <span className="text-xs font-semibold hidden sm:block">Open Sheet</span>
                  )}
                  <ChevronRight
                    size={22}
                    className={`transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`}
                  />
                </div>
              </button>

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
          onClose={() => setCalendarState(null)}
        />
      )}
    </div>
  )
}
