'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, X, ExternalLink, Loader2,
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
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  fetchLeaveApplicationsForApplicant,
} from '@/lib/leave'

function canViewApp(app: LeaveApplicationWithDetails, viewerUserId?: string, viewerRole?: string): boolean {
  if (!viewerUserId || !viewerRole) return false
  if (viewerRole === 'admin' || viewerRole === 'principal') return true
  if (app.applicant_id === viewerUserId) return true
  return app.approvals.some(a =>
    a.approver_id === viewerUserId ||
    (!a.approver_id && a.approver_role === viewerRole)
  )
}

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type EffectiveStatus = StaffAttendanceStatus | 'holiday'

const STATUS_BG: Record<EffectiveStatus, string> = {
  present:  'bg-green-100 text-green-800',
  absent:   'bg-red-100 text-red-800',
  late:     'bg-amber-100 text-amber-800',
  on_leave: 'bg-blue-100 text-blue-800',
  e:        'bg-violet-100 text-violet-700',
  wfh:      'bg-cyan-100 text-cyan-800',
  half_day: 'bg-orange-100 text-orange-800',
  holiday:  'bg-violet-50 text-violet-500',
}

const STATUS_SHORT: Record<EffectiveStatus, string> = {
  present: 'P', absent: 'A', late: 'L', on_leave: 'OL', wfh: 'WFH', half_day: '½', e: 'E', holiday: 'H',
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
  /** Called when an empty workday cell is clicked (no record, no leave, not a holiday, not a weekend) */
  onEmptyDayClick?: (dateStr: string) => void
  /** Current viewer's user ID — used to decide whether to show the "View in Leave Manager" button */
  viewerUserId?: string
  /** Current viewer's role — used to decide whether to show the "View in Leave Manager" button */
  viewerRole?: string
}

export default function StaffAttendanceCalendar({
  staffId, staffName, mode, refreshKey = 0,
  onApplyLeave, onViewLeave, onEmptyDayClick, viewerUserId, viewerRole,
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

  const selectedLeave = selectedDay ? leaveByDate.get(selectedDay) : undefined

  // Stats items (only those with values > 0)
  const statItems = ([
    ['present', stats.present], ['late', stats.late], ['half_day', stats.half_day],
    ['wfh', stats.wfh], ['on_leave', stats.on_leave], ['absent', stats.absent], ['e', stats.e],
  ] as [StaffAttendanceStatus, number][]).filter(([, v]) => v > 0)

  return (
    <div className="bg-white">
      {/* Month header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E4E4E7]">
        <button
          onClick={prevMonth}
          className="p-2 text-[#71717A] hover:text-[#18181B] hover:bg-[#F5F5F5] transition-colors rounded-lg"
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <h3 className="font-bold text-[#18181B] text-sm leading-tight">{monthName(year, month)}</h3>
          {staffName && <p className="text-xs text-[#A1A1AA] mt-0.5">{staffName}</p>}
        </div>
        <button
          onClick={nextMonth}
          className="p-2 text-[#71717A] hover:text-[#18181B] hover:bg-[#F5F5F5] transition-colors rounded-lg"
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-[#E4E4E7] bg-[#FAFAF9]">
        {DAY_HEADERS.map(h => (
          <div key={h} className={`py-2 text-center text-[10px] font-bold uppercase tracking-wide ${h === 'Sun' ? 'text-[#D4D4D8]' : 'text-[#A1A1AA]'}`}>
            {h}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="py-14 flex items-center justify-center gap-2 text-[#A1A1AA] text-sm">
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (day === null) return (
              <div key={`e-${i}`} className="h-14 border-b border-r border-[#F0F0EF] last:border-r-0" />
            )
            const dateStr = `${year}-${pad(month)}-${pad(day)}`
            const dow = (firstDow + (day - 1)) % 7
            const sunday = dow === 6
            const rec = recordByDate.get(dateStr)
            const leave = leaveByDate.get(dateStr)
            const eff = deriveDayStatus(dateStr, rec, holidaySet, today, lateCutoff)
            const isTodayCell = dateStr === today
            const cellBg = eff && STATUS_BG[eff] ? STATUS_BG[eff] : (sunday ? 'bg-[#FAFAF9]' : '')

            return (
              <button
                key={day}
                onClick={() => {
                  if (leave) {
                    setSelectedDay(dateStr)
                  } else if (onEmptyDayClick && !rec && !holidaySet.has(dateStr) && !sunday) {
                    onEmptyDayClick(dateStr)
                  }
                }}
                className={`relative h-14 border-b border-r border-[#F0F0EF] last:border-r-0 flex flex-col items-center justify-center gap-0.5 select-none transition-colors active:brightness-95 calendar-day-btn
                  ${cellBg}
                  ${isTodayCell ? 'ring-2 ring-inset ring-[#B8983C]' : ''}
                `}
              >
                <span className={`text-xs font-bold leading-none ${sunday && !eff ? 'text-[#D4D4D8]' : eff ? '' : 'text-[#52525B]'}`}>
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
      <div className="border-t border-[#E4E4E7] px-4 py-3 space-y-2 bg-[#FAFAF9]">
        {statItems.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {statItems.map(([s, v]) => (
              <div key={s} className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold border rounded-full ${STAFF_ATTENDANCE_STATUS_COLORS[s]}`}>
                <span>{STAFF_ATTENDANCE_STATUS_LABELS[s]}</span>
                <span className="font-bold">{v}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#A1A1AA]">{stats.working_days} working days this month</span>
          <span className="font-bold text-[#52525B]">{stats.present_pct}% attendance</span>
        </div>
      </div>

      {/* Leave application popup — only shown when clicking a day that has a leave app */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {selectedDay && selectedLeave && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
              onClick={() => setSelectedDay(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <div>
                    <p className="text-sm font-bold text-slate-800">
                      {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {LEAVE_TYPE_LABELS[selectedLeave.leave_type]} · {LEAVE_STATUS_LABELS[selectedLeave.status]}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedDay(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <p className="text-sm text-slate-700 leading-relaxed">{selectedLeave.reason}</p>
                  {onViewLeave && canViewApp(selectedLeave, viewerUserId, viewerRole) && (
                    <button
                      onClick={() => { setSelectedDay(null); onViewLeave(selectedLeave) }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                    >
                      <ExternalLink size={12} />
                      View in OD / Leave Manager
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
