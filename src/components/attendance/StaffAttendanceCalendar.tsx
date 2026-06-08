'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, X, CalendarPlus, ExternalLink, Loader2, Plane,
} from 'lucide-react'
import {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  StaffMonthlyStats,
  Holiday,
  STAFF_ATTENDANCE_STATUS_LABELS,
  STAFF_ATTENDANCE_STATUS_COLORS,
  fetchMyStaffAttendance,
  fetchHolidays,
  fetchAttendanceConfig,
  staffUpdateOwnStatus,
  adminMarkStaffAttendance,
  deriveDayStatus,
  computeMonthlyStats,
} from '@/lib/attendance'
import {
  LeaveApplicationWithDetails,
  LEAVE_STATUS_LABELS,
  fetchLeaveApplicationsForApplicant,
} from '@/lib/leave'

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type EffectiveStatus = StaffAttendanceStatus | 'holiday'

const STATUS_BG: Record<EffectiveStatus, string> = {
  present:  'bg-green-100 text-green-800',
  absent:   'bg-red-100 text-red-800',
  late:     'bg-amber-100 text-amber-800',
  on_leave: 'bg-blue-100 text-blue-800',
  wfh:      'bg-cyan-100 text-cyan-800',
  half_day: 'bg-orange-100 text-orange-800',
  holiday:  'bg-violet-100 text-violet-700',
}

const STATUS_SHORT: Record<EffectiveStatus, string> = {
  present: 'P', absent: 'A', late: 'L', on_leave: 'OL', wfh: 'WFH', half_day: '½', holiday: 'H',
}

// Editable statuses by viewer type
const SELF_EDIT_STATUSES: StaffAttendanceStatus[] = ['present', 'late', 'half_day', 'wfh', 'absent']
const ADMIN_EDIT_STATUSES: StaffAttendanceStatus[] = ['present', 'late', 'half_day', 'wfh', 'absent', 'on_leave']

function dayOfWeek(dateStr: string): number {
  return (new Date(dateStr + 'T12:00:00').getDay() + 6) % 7
}
function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}
function monthName(year: number, month: number) {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}
function pad(n: number) { return String(n).padStart(2, '0') }

export type CalendarMode = 'self' | 'admin' | 'coordinator'

interface Props {
  staffId: string
  staffName?: string
  mode: CalendarMode
  /** Who is performing admin marking (admin/principal user id). */
  markerId?: string
  refreshKey?: number
  /** Apply for leave on a date (self mode). */
  onApplyLeave?: (date: string) => void
  /** Open an existing leave application elsewhere. */
  onViewLeave?: (app: LeaveApplicationWithDetails) => void
  onChanged?: () => void
}

export default function StaffAttendanceCalendar({
  staffId, staffName, mode, markerId, refreshKey = 0,
  onApplyLeave, onViewLeave, onChanged,
}: Props) {
  const today = new Date().toISOString().split('T')[0]
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [records, setRecords] = useState<StaffAttendanceRecord[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [leaveApps, setLeaveApps] = useState<LeaveApplicationWithDetails[]>([])
  const [lateCutoff, setLateCutoff] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [recs, hols, apps, cfg] = await Promise.all([
      fetchMyStaffAttendance(staffId, year, month),
      fetchHolidays(year, month),
      fetchLeaveApplicationsForApplicant(staffId),
      fetchAttendanceConfig(),
    ])
    setRecords(recs)
    setHolidays(hols)
    setLeaveApps(apps)
    setLateCutoff(cfg.late_cutoff)
    setLoading(false)
  }, [staffId, year, month])

  useEffect(() => { load() }, [load, refreshKey])

  const recordByDate = new Map(records.map(r => [r.date, r]))
  const holidaySet = new Set(holidays.map(h => h.date))

  // Map date → relevant leave application (approved/pending), preferring approved.
  const leaveByDate = new Map<string, LeaveApplicationWithDetails>()
  for (const app of leaveApps) {
    if (app.status === 'rejected') continue
    const cur = new Date(app.start_date)
    const end = new Date(app.end_date)
    while (cur <= end) {
      const ds = cur.toISOString().split('T')[0]
      const existing = leaveByDate.get(ds)
      if (!existing || (existing.status !== 'approved' && app.status === 'approved')) {
        leaveByDate.set(ds, app)
      }
      cur.setDate(cur.getDate() + 1)
    }
  }

  const stats: StaffMonthlyStats = computeMonthlyStats(year, month, records, holidays, today, lateCutoff)

  const totalDays = daysInMonth(year, month)
  const firstDow = dayOfWeek(`${year}-${pad(month)}-01`)
  const cells: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = () => month === 1 ? (setYear(y => y - 1), setMonth(12)) : setMonth(m => m - 1)
  const nextMonth = () => month === 12 ? (setYear(y => y + 1), setMonth(1)) : setMonth(m => m + 1)

  const selectedRecord = selectedDay ? recordByDate.get(selectedDay) : undefined
  const selectedLeave = selectedDay ? leaveByDate.get(selectedDay) : undefined
  const selectedIsHoliday = selectedDay ? holidaySet.has(selectedDay) : false
  const selectedHoliday = selectedDay ? holidays.find(h => h.date === selectedDay) : undefined

  const canEdit = (date: string) =>
    (mode === 'self' || mode === 'admin') && date <= today

  const handleSetStatus = async (status: StaffAttendanceStatus) => {
    if (!selectedDay) return
    setSaving(true)
    const ok = mode === 'admin' && markerId
      ? await adminMarkStaffAttendance(staffId, selectedDay, status, markerId)
      : await staffUpdateOwnStatus(staffId, selectedDay, status)
    setSaving(false)
    if (ok) { await load(); onChanged?.() }
  }

  const editStatuses = mode === 'admin' ? ADMIN_EDIT_STATUSES : SELF_EDIT_STATUSES

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <button onClick={prevMonth} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <h3 className="font-semibold text-slate-800 text-sm">{monthName(year, month)}</h3>
          {staffName && <p className="text-[11px] text-slate-400">{staffName}</p>}
        </div>
        <button onClick={nextMonth} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-slate-100">
        {DAY_HEADERS.map(h => (
          <div key={h} className={`py-2 text-center text-[11px] font-semibold ${h === 'Sat' || h === 'Sun' ? 'text-slate-300' : 'text-slate-500'}`}>
            {h}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center"><div className="spinner mx-auto" /></div>
      ) : (
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (day === null) return <div key={`e-${i}`} className="h-14 sm:h-16 border-b border-r border-slate-50 last:border-r-0" />
            const dateStr = `${year}-${pad(month)}-${pad(day)}`
            const dow = (firstDow + (day - 1)) % 7
            const weekend = dow >= 5
            const rec = recordByDate.get(dateStr)
            const leave = leaveByDate.get(dateStr)
            const eff = deriveDayStatus(dateStr, rec, holidaySet, today, lateCutoff)
            const isTodayCell = dateStr === today
            const cellBg = eff && STATUS_BG[eff] ? STATUS_BG[eff] : (weekend ? 'bg-slate-50' : '')

            return (
              <button
                key={day}
                onClick={() => setSelectedDay(dateStr)}
                className={`relative h-14 sm:h-16 border-b border-r border-slate-50 last:border-r-0 flex flex-col items-center justify-center gap-0.5 select-none transition-colors hover:ring-2 hover:ring-inset hover:ring-violet-300
                  ${cellBg}
                  ${isTodayCell ? 'ring-2 ring-inset ring-slate-400' : ''}
                `}
              >
                <span className={`text-[11px] font-semibold leading-none ${weekend && !eff ? 'text-slate-300' : eff ? '' : 'text-slate-500'}`}>
                  {day}
                </span>
                {eff && eff !== 'holiday' && (
                  <span className="text-[10px] font-bold leading-none opacity-70">{STATUS_SHORT[eff]}</span>
                )}
                {eff === 'holiday' && (
                  <span className="text-[8px] font-bold leading-none uppercase tracking-wide opacity-70">Holiday</span>
                )}
                {leave && (
                  <span
                    className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${leave.status === 'approved' ? 'bg-blue-500' : 'bg-amber-400'}`}
                    title={`Leave ${LEAVE_STATUS_LABELS[leave.status]}`}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Summary pills */}
      <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap gap-2 items-center">
        {([
          ['present', stats.present], ['late', stats.late], ['half_day', stats.half_day],
          ['wfh', stats.wfh], ['on_leave', stats.on_leave], ['absent', stats.absent],
        ] as [StaffAttendanceStatus, number][]).filter(([, v]) => v > 0).map(([s, v]) => (
          <div key={s} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${STAFF_ATTENDANCE_STATUS_COLORS[s]}`}>
            <span>{STAFF_ATTENDANCE_STATUS_LABELS[s]}</span>
            <span className="font-bold">{v}</span>
          </div>
        ))}
        <span className="ml-auto text-[11px] font-semibold text-slate-500">
          {stats.present_pct}% · {stats.working_days} working days
        </span>
      </div>

      {/* Day detail modal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {selectedDay && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
              onClick={() => setSelectedDay(null)}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0, y: 16 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 16 }}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="font-bold text-slate-800">
                      {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </h3>
                    {staffName && <p className="text-xs text-slate-400">{staffName}</p>}
                  </div>
                  <button onClick={() => setSelectedDay(null)} className="p-1 text-slate-400 hover:text-slate-600">
                    <X size={18} />
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  {/* Holiday banner */}
                  {selectedIsHoliday && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 text-violet-700 text-sm">
                      <span className="font-medium">Holiday</span>
                      {selectedHoliday?.name && <span className="text-violet-500">· {selectedHoliday.name}</span>}
                    </div>
                  )}

                  {/* Current status */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Status:</span>
                    {selectedRecord ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${STAFF_ATTENDANCE_STATUS_COLORS[selectedRecord.status]}`}>
                        {STAFF_ATTENDANCE_STATUS_LABELS[selectedRecord.status]}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Not marked</span>
                    )}
                  </div>

                  {/* Existing leave on this day */}
                  {selectedLeave && (
                    <button
                      onClick={() => { setSelectedDay(null); onViewLeave?.(selectedLeave) }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-left"
                    >
                      <Plane size={15} className="text-blue-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-blue-800">Leave {LEAVE_STATUS_LABELS[selectedLeave.status]}</p>
                        <p className="text-[11px] text-blue-600 truncate">{selectedLeave.reason}</p>
                      </div>
                      <ExternalLink size={13} className="text-blue-500 flex-shrink-0" />
                    </button>
                  )}

                  {/* Status editing */}
                  {canEdit(selectedDay) && (
                    <div>
                      <p className="text-xs font-semibold text-slate-600 mb-1.5">
                        {mode === 'admin' ? 'Set status' : 'Mark / edit my status'}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {editStatuses.map(s => {
                          const active = selectedRecord?.status === s
                          return (
                            <button
                              key={s}
                              disabled={saving}
                              onClick={() => handleSetStatus(s)}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                                active
                                  ? STAFF_ATTENDANCE_STATUS_COLORS[s]
                                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {STAFF_ATTENDANCE_STATUS_LABELS[s]}
                            </button>
                          )
                        })}
                      </div>
                      {saving && <p className="mt-2 text-[11px] text-slate-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Saving…</p>}
                    </div>
                  )}

                  {/* Apply for leave (self only, future/today/any without leave) */}
                  {mode === 'self' && !selectedLeave && onApplyLeave && (
                    <button
                      onClick={() => { const d = selectedDay; setSelectedDay(null); onApplyLeave(d!) }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-medium hover:from-violet-600 hover:to-purple-700 transition-all"
                    >
                      <CalendarPlus size={15} />
                      Apply for leave on this day
                    </button>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
