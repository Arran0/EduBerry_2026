'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { X, Loader2, Save, Users, CheckSquare, ChevronDown, ChevronUp, Lock, Unlock } from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  AttendanceStatus,
  AttendanceSheetRow,
  ATTENDANCE_STATUS_LABELS,
  fetchAttendanceSheet,
  bulkMarkAttendance,
} from '@/lib/attendance'
import { UserProfile } from '@/lib/supabase'

interface RowState {
  student: UserProfile
  status: AttendanceStatus
  remarks: string
  changed: boolean
  leaveLinked: boolean
  overrideLeave: boolean
}

const STATUS_OPTIONS: AttendanceStatus[] = ['present', 'absent', 'late', 'on_leave', 'excused']
const STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: 'P', absent: 'A', late: 'L', on_leave: 'OL', excused: 'E',
}
const STATUS_COLORS: Record<AttendanceStatus, string> = {
  present:  'bg-green-500 text-white border-green-500',
  absent:   'bg-red-500 text-white border-red-500',
  late:     'bg-amber-500 text-white border-amber-500',
  on_leave: 'bg-blue-500 text-white border-blue-500',
  excused:  'bg-purple-500 text-white border-purple-500',
}
const STATUS_INACTIVE: Record<AttendanceStatus, string> = {
  present:  'border-green-200 text-green-600 hover:bg-green-50',
  absent:   'border-red-200 text-red-600 hover:bg-red-50',
  late:     'border-amber-200 text-amber-600 hover:bg-amber-50',
  on_leave: 'border-blue-200 text-blue-600 hover:bg-blue-50',
  excused:  'border-purple-200 text-purple-600 hover:bg-purple-50',
}

function todayString() { return new Date().toISOString().split('T')[0] }

function formatDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
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
      r.student.id === studentId
        ? { ...r, status, changed: true }
        : r
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
    // Reload to sync
    await loadSheet()
  }

  const markedCount = rows.filter(r => r.changed || r.leaveLinked).length
  const hasChanges = rows.some(r => r.changed)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh] sm:max-h-[85vh] rounded-t-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-slate-800 text-base truncate">{homeroomName}</h2>
            <p className="text-xs text-slate-500">Attendance Sheet</p>
          </div>
          {/* Date picker */}
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

        {/* Date label */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-slate-500 font-medium">{formatDate(date)}</span>
          {hasChanges && <span className="text-xs text-amber-600 font-medium">• Unsaved changes</span>}
        </div>

        {/* Toolbar */}
        <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={markAllPresent}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
          >
            <CheckSquare size={13} />
            Mark All Present
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
                return (
                  <div key={row.student.id} className={`px-4 py-3 transition-colors ${row.changed ? 'bg-violet-50/30' : ''}`}>
                    <div className="flex items-center gap-3">
                      {/* Number */}
                      <span className="text-xs text-slate-400 w-5 text-right flex-shrink-0">{idx + 1}</span>
                      {/* Avatar */}
                      <Avatar avatarUrl={row.student.avatar_url} name={row.student.full_name} email={row.student.email} size={32} />
                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{row.student.full_name}</p>
                        {row.leaveLinked && (
                          <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full font-medium">
                            Approved Leave
                          </span>
                        )}
                      </div>
                      {/* Leave lock toggle */}
                      {row.leaveLinked && (
                        <button
                          onClick={() => toggleOverride(row.student.id)}
                          className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${row.overrideLeave ? 'text-amber-500 bg-amber-50' : 'text-blue-400 bg-blue-50'}`}
                          title={row.overrideLeave ? 'Leave override active' : 'Click to override leave'}
                        >
                          {row.overrideLeave ? <Unlock size={13} /> : <Lock size={13} />}
                        </button>
                      )}
                      {/* Status toggles */}
                      <div className={`flex gap-1 flex-shrink-0 ${isLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                        {STATUS_OPTIONS.map(s => (
                          <button
                            key={s}
                            onClick={() => setStatus(row.student.id, s)}
                            className={`w-7 h-7 rounded-lg border text-[11px] font-bold transition-all ${
                              row.status === s ? STATUS_COLORS[s] : `bg-white ${STATUS_INACTIVE[s]}`
                            }`}
                            title={ATTENDANCE_STATUS_LABELS[s]}
                          >
                            {STATUS_SHORT[s]}
                          </button>
                        ))}
                      </div>
                      {/* Remarks toggle */}
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
                    {/* Remarks input */}
                    {showRemarks && (
                      <div className="mt-2 ml-8">
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
        <div className="px-5 py-4 border-t border-slate-100 flex items-center gap-3 flex-shrink-0 bg-white">
          <span className="text-xs text-slate-400 flex-1">
            {markedCount} / {rows.length} students marked
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
  )
}
