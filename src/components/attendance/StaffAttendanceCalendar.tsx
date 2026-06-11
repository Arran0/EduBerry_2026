'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, X, CalendarPlus, ExternalLink, Loader2, Plane, LogOut,
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
  markerId?: string
  refreshKey?: number
  onApplyLeave?: (date: string) => void
  onViewLeave?: (app: LeaveApplicationWithDetails) => void
  onChanged?: () => void
}

export default function StaffAttendanceCalendar({
  staffId, staffName, mode, refreshKey = 0,
  onApplyLeave, onViewLeave,
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

  // Stats items (only those with values > 0)
  const statItems = ([
    ['present', stats.present], ['late', stats.late], ['half_day', stats.half_day],
    ['wfh', stats.wfh], ['on_leave', stats.on_leave], ['absent', stats.absent],
  ] as [StaffAttendanceStatus, number][]).filter(([, v]) => v > 0)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Month header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100">
        <button
          onClick={prevMonth}
          className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <h3 className="font-bold text-slate-800 text-base leading-tight">{monthName(year, month)}</h3>
          {staffName && <p className="text-xs text-slate-400 mt-0.5">{staffName}</p>}
        </div>
        <button
          onClick={nextMonth}
          className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/60">
        {DAY_HEADERS.map(h => (
          <div key={h} className={`py-2 text-center text-[10px] font-bold uppercase tracking-wide ${h === 'Sat' || h === 'Sun' ? 'text-slate-300' : 'text-slate-400'}`}>
            {h}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="py-14 flex items-center justify-center gap-2 text-slate-400 text-sm">
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (day === null) return (
              <div key={`e-${i}`} className="h-14 border-b border-r border-slate-50 last:border-r-0" />
            )
            const dateStr = `${year}-${pad(month)}-${pad(day)}`
            const dow = (firstDow + (day - 1)) % 7
            const weekend = dow >= 5
            const rec = recordByDate.get(dateStr)
            const leave = leaveByDate.get(dateStr)
            const eff = deriveDayStatus(dateStr, rec, holidaySet, today, lateCutoff)
            const isTodayCell = dateStr === today
            const cellBg = eff && STATUS_BG[eff] ? STATUS_BG[eff] : (weekend ? 'bg-slate-50/70' : '')

            return (
              <button
                key={day}
                onClick={() => setSelectedDay(dateStr)}
                className={`relative h-14 border-b border-r border-slate-50 last:border-r-0 flex flex-col items-center justify-center gap-0.5 select-none transition-colors active:brightness-95 calendar-day-btn
                  ${cellBg}
                  ${isTodayCell ? 'ring-2 ring-inset ring-slate-400' : ''}
                `}
              >
                <span className={`text-xs font-bold leading-none ${weekend && !eff ? 'text-slate-300' : eff ? '' : 'text-slate-500'}`}>
                  {day}
                </span>
                {eff && eff !== 'holiday' && (
                  <span className="text-[10px] font-bold leading-none opacity-60">{STATUS_SHORT[eff]}</span>
                )}
                {eff === 'holiday' && (
                  <span className="text-[8px] font-bold leading-none uppercase tracking-wide opacity-60">Hol</span>
                )}
                {leave && (
                  <span
                    className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${leave.status === 'approved' ? 'bg-blue-500' : 'bg-amber-400'}`}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Monthly stats */}
      <div className="border-t border-slate-100 px-4 py-3 space-y-2">
        {statItems.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {statItems.map(([s, v]) => (
              <div key={s} className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold border ${STAFF_ATTENDANCE_STATUS_COLORS[s]}`}>
                <span>{STAFF_ATTENDANCE_STATUS_LABELS[s]}</span>
                <span className="font-bold">{v}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400">{stats.working_days} working days this month</span>
          <span className="font-bold text-slate-600">{stats.present_pct}% attendance</span>
        </div>
      </div>

      {/* Day detail modal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {selectedDay && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
              onClick={() => setSelectedDay(null)}
            >
              <motion.div
                initial={{ y: '100%', opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '100%', opacity: 0 }}
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-sm overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                {/* Drag handle (mobile) */}
                <div className="flex justify-center pt-3 pb-1 sm:hidden">
                  <div className="w-10 h-1 bg-slate-200 rounded-full" />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="font-bold text-slate-800 text-base">
                      {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </h3>
                    {staffName && <p className="text-xs text-slate-400 mt-0.5">{staffName}</p>}
                  </div>
                  <button
                    onClick={() => setSelectedDay(null)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="p-5 space-y-4 pb-8 sm:pb-5">
                  {/* Holiday banner */}
                  {selectedIsHoliday && (
                    <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-violet-50 border border-violet-100 text-sm">
                      <span className="font-bold text-violet-700">Holiday</span>
                      {selectedHoliday?.name && <span className="text-violet-500">· {selectedHoliday.name}</span>}
                    </div>
                  )}

                  {/* Current status */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">Status:</span>
                    {selectedRecord ? (
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${STAFF_ATTENDANCE_STATUS_COLORS[selectedRecord.status]}`}>
                        {STAFF_ATTENDANCE_STATUS_LABELS[selectedRecord.status]}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Not marked</span>
                    )}
                  </div>

                  {/* Check-in / check-out times */}
                  {selectedRecord?.check_in_time && (
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="font-medium">Times:</span>
                      <span className="font-semibold text-slate-700">
                        {new Date(selectedRecord.check_in_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {selectedRecord.check_out_time && (
                        <>
                          <LogOut size={11} className="text-slate-400" />
                          <span className="font-semibold text-slate-700">
                            {new Date(selectedRecord.check_out_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  {/* Leave application */}
                  {selectedLeave && (
                    <button
                      onClick={() => { setSelectedDay(null); onViewLeave?.(selectedLeave) }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-left"
                    >
                      <Plane size={16} className="text-blue-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-blue-800">Leave {LEAVE_STATUS_LABELS[selectedLeave.status]}</p>
                        <p className="text-xs text-blue-600 truncate mt-0.5">{selectedLeave.reason}</p>
                      </div>
                      <ExternalLink size={14} className="text-blue-500 flex-shrink-0" />
                    </button>
                  )}

                  {/* Apply for leave */}
                  {mode === 'self' && !selectedLeave && onApplyLeave && (
                    <button
                      onClick={() => { const d = selectedDay; setSelectedDay(null); onApplyLeave(d!) }}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-white text-sm font-semibold transition-all active:scale-[0.98]"
                      style={{ background: 'linear-gradient(to right, var(--page-gradient-from, #7c3aed), var(--page-gradient-to, #4f46e5))' }}
                    >
                      <CalendarPlus size={16} />
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
