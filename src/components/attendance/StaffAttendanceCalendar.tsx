'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, X, Loader2, CalendarPlus, AlertTriangle, ShieldAlert,
} from 'lucide-react'
import {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  StaffMonthlyStats,
  Holiday,
  NonWorkingDay,
  STAFF_ATTENDANCE_STATUS_LABELS,
  STAFF_ATTENDANCE_STATUS_COLORS,
  fetchMyStaffAttendance,
  fetchHolidays,
  fetchNonWorkingDays,
  deriveDayStatus,
  computeMonthlyStats,
  describeLocationWarning,
  hasLocationWarning,
} from '@/lib/attendance'
import DayAttendanceDetailModal from '@/components/attendance/DayAttendanceDetailModal'
import { useSchoolClock } from '@/hooks/useSchoolClock'
import {
  LeaveApplicationWithDetails,
  fetchLeaveApplicationsForApplicant,
} from '@/lib/leave'
import LeaveAppPreviewModal from '@/components/leave/LeaveAppPreviewModal'

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type EffectiveStatus = StaffAttendanceStatus | 'holiday' | 'non_working'

const STATUS_BG: Record<EffectiveStatus, string> = {
  present:  'bg-green-100 text-green-800',
  absent:   'bg-red-100 text-red-800',
  late:     'bg-amber-100 text-amber-800',
  on_leave: 'bg-blue-100 text-blue-800',
  e:        'bg-violet-100 text-violet-700',
  wfh:      'bg-cyan-100 text-cyan-800',
  half_day: 'bg-orange-100 text-orange-800',
  holiday:  'bg-violet-50 text-violet-500',
  non_working: 'bg-slate-100 text-slate-500',
}

const STATUS_SHORT: Record<EffectiveStatus, string> = {
  present: 'P', absent: 'A', late: 'Late', on_leave: 'OL', wfh: 'WFH', half_day: '½', e: 'Exception', holiday: 'H', non_working: 'NW',
}
// 'late'/'e' spell out as tiny-font words instead of an ambiguous single letter.
const TINY_LABEL_STATUSES = new Set<EffectiveStatus>(['late', 'e'])

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

function formatDayLabel(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/** Inclusive day count between two ISO dates. */
function countDays(start: string, end: string): number {
  const ms = new Date(end + 'T12:00:00').getTime() - new Date(start + 'T12:00:00').getTime()
  return Math.round(ms / 86400000) + 1
}

export type CalendarMode = 'self' | 'admin' | 'coordinator'

interface Props {
  staffId: string
  staffName?: string
  mode: CalendarMode
  markerId?: string
  refreshKey?: number
  /**
   * Month to open on, 1-based, instead of the current one. Payroll opens this
   * calendar to explain a pay cycle's figures, so it has to land on that
   * cycle's month — the stats underneath are what its Leave column counted.
   * The user can still page away from it.
   */
  initialYear?: number
  initialMonth?: number
  /**
   * Enables day selection. Fires with the inclusive range the user picked —
   * one day for a tap, several for a drag across the grid. Omit it and the
   * grid stays read-only.
   */
  onApplyLeave?: (startDate: string, endDate: string) => void
  onViewLeave?: (app: LeaveApplicationWithDetails) => void
  onChanged?: () => void
  /** Current viewer's user ID — used to decide whether to show the "View in Leave Manager" button */
  viewerUserId?: string
  /** Current viewer's role — used to decide whether to show the "View in Leave Manager" button */
  viewerRole?: string
  /** Stretch to fill the parent's height (day cells grow) instead of sizing to
   *  content. Used when the calendar shares a matched-height row with the report. */
  fill?: boolean
}

export default function StaffAttendanceCalendar({
  staffId, staffName, mode, refreshKey = 0, initialYear, initialMonth,
  onApplyLeave, onViewLeave, viewerUserId, viewerRole, fill = false,
}: Props) {
  // Server clock in the school's timezone — "today" decides which days can turn
  // Absent, so it is not read off the device. The device date stands in only
  // until the server's lands.
  const { today: schoolToday } = useSchoolClock()
  const today = schoolToday ?? new Date().toISOString().split('T')[0]
  const [year, setYear] = useState(() => initialYear ?? new Date().getFullYear())
  const [month, setMonth] = useState(() => initialMonth ?? new Date().getMonth() + 1)
  const [records, setRecords] = useState<StaffAttendanceRecord[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [nonWorkingDays, setNonWorkingDays] = useState<NonWorkingDay[]>([])
  const [leaveApps, setLeaveApps] = useState<LeaveApplicationWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  // Day whose punch-timing detail is open. The month grid has no room to show
  // check-in/checkout times (or explain a location warning), so a marked cell
  // opens the same detail the office sees — which also makes it reachable on
  // a phone, where a tooltip never is.
  const [detailDay, setDetailDay] = useState<string | null>(null)

  // ── Day selection (drag a range, or tap a single day) ──────────────────────
  const canSelect = !!onApplyLeave
  const [anchor, setAnchor] = useState<string | null>(null)
  const [focus, setFocus]   = useState<string | null>(null)
  const gridRef  = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  // The day a mouse drag started on. Held in a ref rather than state so a
  // press that turns out to be a plain click leaves the selection untouched —
  // the click handler then owns it, and single-day toggling still works.
  const dragFrom = useRef<string | null>(null)
  // Set once a drag actually moved, so the click it ends with is ignored.
  const dragged  = useRef(false)

  const clearSelection = useCallback(() => { setAnchor(null); setFocus(null) }, [])

  // Normalised range — dragging backwards through the month is the same
  // selection as dragging forwards.
  const range = useMemo(() => {
    if (!anchor || !focus) return null
    const start = anchor <= focus ? anchor : focus
    const end   = anchor <= focus ? focus : anchor
    return { start, end, days: countDays(start, end) }
  }, [anchor, focus])

  const load = useCallback(async () => {
    setLoading(true)
    const [recs, hols, nonWorking, apps] = await Promise.all([
      fetchMyStaffAttendance(staffId, year, month),
      fetchHolidays(year, month),
      fetchNonWorkingDays(year, month),
      fetchLeaveApplicationsForApplicant(staffId),
    ])
    setRecords(recs)
    setHolidays(hols)
    setNonWorkingDays(nonWorking)
    setLeaveApps(apps)
    setLoading(false)
  }, [staffId, year, month])

  useEffect(() => { load() }, [load, refreshKey])

  // A month change makes the old selection invisible — drop it rather than
  // leave a range selected off-screen.
  useEffect(() => { clearSelection() }, [year, month, clearSelection])

  // A mouse drag can end anywhere on the page, not just on a day cell.
  useEffect(() => {
    const stop = () => { dragging.current = false; dragFrom.current = null }
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])

  /**
   * Touch drag-select.
   *
   * React's synthetic touch handlers are passive, so preventDefault() inside
   * them is ignored — these are attached natively instead. Direction is locked
   * from the first few pixels: a sideways drag selects days (and blocks page
   * scroll for the rest of the gesture), a vertical one is left alone so the
   * page scrolls normally. Once selecting, the finger can travel in any
   * direction, so a range can still run down the grid across weeks.
   */
  useEffect(() => {
    const el = gridRef.current
    if (!el || !canSelect) return

    let startX = 0, startY = 0
    let pending: string | null = null
    let lock: 'select' | 'scroll' | null = null

    const dayAt = (x: number, y: number) => {
      const node = document.elementFromPoint(x, y)?.closest('[data-date]') as HTMLElement | null
      if (!node || !el.contains(node)) return null
      return { date: node.dataset.date as string, pickable: node.dataset.pick === '1' }
    }

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      startX = t.clientX; startY = t.clientY
      lock = null
      dragged.current = false
      const hit = dayAt(t.clientX, t.clientY)
      pending = hit?.pickable ? hit.date : null
    }

    const onMove = (e: TouchEvent) => {
      if (!pending) return
      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY

      if (!lock) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        lock = Math.abs(dx) > Math.abs(dy) ? 'select' : 'scroll'
        if (lock === 'scroll') { pending = null; return }
        dragging.current = true
        dragged.current = true
        setAnchor(pending)
        setFocus(pending)
      }

      e.preventDefault()
      const hit = dayAt(t.clientX, t.clientY)
      if (hit) setFocus(hit.date)
    }

    const onEnd = () => { pending = null; lock = null; dragging.current = false }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [canSelect, loading])

  const recordByDate = new Map(records.map(r => [r.date, r]))
  const holidaySet = new Set(holidays.map(h => h.date))
  const nonWorkingSet = new Set(nonWorkingDays.map(h => h.date))

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

  const stats: StaffMonthlyStats = computeMonthlyStats(year, month, records, holidays, today, nonWorkingDays)

  // Days this month whose punches were accepted with no position measured.
  const warningDates = records.filter(hasLocationWarning).map(r => r.date)
  const strictWarningCount = records.filter(r => describeLocationWarning(r)?.strict).length
  const detailRecord = detailDay ? recordByDate.get(detailDay) : undefined

  const totalDays = daysInMonth(year, month)
  const firstDow = dayOfWeek(`${year}-${pad(month)}-01`)
  const cells: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = () => month === 1 ? (setYear(y => y - 1), setMonth(12)) : setMonth(m => m - 1)
  const nextMonth = () => month === 12 ? (setYear(y => y + 1), setMonth(1)) : setMonth(m => m + 1)

  const selectedLeave = selectedDay ? leaveByDate.get(selectedDay) : undefined

  // Stats items (only those with values > 0). Late still gets its own chip
  // for punctuality visibility, but also counts toward Present here — a late
  // arrival is still a day the staff member showed up.
  const statItems = ([
    ['present', stats.present + stats.late], ['late', stats.late], ['half_day', stats.half_day],
    ['wfh', stats.wfh], ['on_leave', stats.on_leave], ['absent', stats.absent], ['e', stats.e],
  ] as [StaffAttendanceStatus, number][]).filter(([, v]) => v > 0)

  return (
    <div className={`bg-white${fill ? ' flex flex-col flex-1 min-h-0' : ''}`}>
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
          <div key={h} className="py-2 text-center text-[10px] font-bold uppercase tracking-wide text-[#A1A1AA]">
            {h}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className={`${fill ? 'flex-1 ' : 'py-14 '}flex items-center justify-center gap-2 text-[#A1A1AA] text-sm`}>
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : (
        <div
          ref={gridRef}
          className={`grid grid-cols-7${fill ? ' flex-1 auto-rows-fr' : ''}`}
          // Sideways drags are ours (see the touch effect); vertical panning
          // stays with the browser.
          style={canSelect ? { touchAction: 'pan-y' } : undefined}
        >
          {cells.map((day, i) => {
            if (day === null) return (
              <div key={`e-${i}`} className={`${fill ? 'min-h-14' : 'h-14'} border-b border-r border-[#F0F0EF] last:border-r-0`} />
            )
            const dateStr = `${year}-${pad(month)}-${pad(day)}`
            const rec = recordByDate.get(dateStr)
            const leave = leaveByDate.get(dateStr)
            const eff = deriveDayStatus(dateStr, rec, holidaySet, nonWorkingSet, today)
            const isTodayCell = dateStr === today
            const cellBg = eff && STATUS_BG[eff] ? STATUS_BG[eff] : ''
            // A day is a valid drag anchor when it is a plain, unclaimed
            // workday — no record, no leave already on it, and not a holiday
            // or non-working day. Any day can be the far end of a range that
            // started on one.
            const pickable = canSelect && !leave && !rec && !holidaySet.has(dateStr) && !nonWorkingSet.has(dateStr)
            const inRange = !!range && dateStr >= range.start && dateStr <= range.end
            const dayWarning = rec ? describeLocationWarning(rec) : null

            return (
              <button
                key={day}
                data-date={dateStr}
                data-pick={pickable ? '1' : '0'}
                onPointerDown={e => {
                  // Touch drags are driven by the native listeners above.
                  if (e.pointerType === 'touch') return
                  dragged.current = false
                  dragFrom.current = null
                  if (!pickable || e.shiftKey) return
                  // No preventDefault here — browsers disagree on whether that
                  // also swallows the click, and the click is what selects a
                  // single day. `select-none` on the cell already stops the
                  // drag from highlighting text.
                  dragging.current = true
                  dragFrom.current = dateStr
                }}
                onPointerEnter={() => {
                  if (!dragging.current || !dragFrom.current) return
                  dragged.current = true
                  setAnchor(dragFrom.current)
                  setFocus(dateStr)
                }}
                onClick={e => {
                  if (dragged.current) return
                  if (leave) { setSelectedDay(dateStr); return }
                  // A marked day is never selectable (it already has a record),
                  // so the tap is free to open its punch-timing detail instead.
                  if (rec) { setDetailDay(dateStr); return }
                  if (!canSelect) return
                  // Shift-click stretches the current selection to this day.
                  if (e.shiftKey && anchor) { setFocus(dateStr); return }
                  if (!pickable) return
                  // Tapping the single selected day again clears it.
                  if (range && range.start === dateStr && range.end === dateStr) { clearSelection(); return }
                  setAnchor(dateStr)
                  setFocus(dateStr)
                }}
                className={`relative ${fill ? 'min-h-14' : 'h-14'} border-b border-r border-[#F0F0EF] last:border-r-0 flex flex-col items-center justify-center gap-0.5 select-none transition-colors active:brightness-95 calendar-day-btn
                  ${inRange ? 'bg-violet-200/80 text-violet-900 ring-2 ring-inset ring-violet-500' : cellBg}
                  ${!inRange && isTodayCell ? 'ring-2 ring-inset ring-[#B8983C]' : ''}
                  ${pickable && !inRange ? `cursor-pointer${eff ? '' : ' hover:bg-violet-50'}` : ''}
                  ${(dayWarning || rec) && !inRange ? 'cursor-pointer' : ''}
                `}
                title={dayWarning ? `${dayWarning.title} — tap for details` : undefined}
              >
                <span className={`text-xs font-bold leading-none ${inRange ? '' : eff ? '' : 'text-[#52525B]'}`}>
                  {day}
                </span>
                {eff && eff !== 'holiday' && eff !== 'non_working' && (
                  <span className={`font-bold leading-none opacity-60 ${TINY_LABEL_STATUSES.has(eff) ? 'text-[6.5px] uppercase tracking-tight' : 'text-[10px]'}`}>
                    {STATUS_SHORT[eff]}
                  </span>
                )}
                {eff === 'holiday' && (
                  <span className="text-[8px] font-bold leading-none uppercase tracking-wide opacity-60">Hol</span>
                )}
                {eff === 'non_working' && (
                  <span className="text-[8px] font-bold leading-none uppercase tracking-wide opacity-60">NW</span>
                )}
                {leave && (
                  <span
                    className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${leave.status === 'approved' ? 'bg-yellow-400' : 'bg-amber-400'}`}
                  />
                )}
                {/* Top-left, opposite the leave dot, so a day can carry both.
                    Red for a day marked off campus or with location access
                    off, amber for a device that simply could not answer. */}
                {dayWarning && !inRange && (
                  dayWarning.strict ? (
                    <ShieldAlert
                      size={9}
                      strokeWidth={2.8}
                      className="absolute top-1 left-1 text-red-600"
                      aria-label="Location not verified"
                    />
                  ) : (
                    <AlertTriangle
                      size={9}
                      strokeWidth={2.8}
                      className="absolute top-1 left-1 text-amber-600"
                      aria-label="Location not confirmed"
                    />
                  )
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Selection bar — what the drag picked, and what to do with it */}
      <AnimatePresence initial={false}>
        {canSelect && range && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-violet-200 bg-violet-50"
          >
            <div className="flex items-center gap-2 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-violet-900 truncate leading-tight">
                  {range.days === 1
                    ? formatDayLabel(range.start)
                    : `${formatDayLabel(range.start)} → ${formatDayLabel(range.end)}`}
                </p>
                <p className="text-[10px] text-violet-500 mt-0.5">
                  {range.days} day{range.days !== 1 ? 's' : ''} selected
                </p>
              </div>
              <button
                onClick={clearSelection}
                className="p-1.5 text-violet-400 hover:text-violet-700 hover:bg-violet-100 rounded-lg transition-colors flex-shrink-0"
                aria-label="Clear selection"
              >
                <X size={14} />
              </button>
              <button
                onClick={() => { onApplyLeave?.(range.start, range.end); clearSelection() }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 active:scale-95 rounded-lg transition-all flex-shrink-0"
              >
                <CalendarPlus size={13} />
                Apply
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
        {warningDates.length > 0 && (
          <p className={`text-[10px] flex items-start gap-1 ${strictWarningCount > 0 ? 'text-red-700' : 'text-amber-700'}`}>
            {strictWarningCount > 0
              ? <ShieldAlert size={10} className="flex-shrink-0 mt-[2px]" />
              : <AlertTriangle size={10} className="flex-shrink-0 mt-[2px]" />}
            <span>
              {warningDates.length} day{warningDates.length === 1 ? '' : 's'} recorded without a
              verified location
              {strictWarningCount > 0 && ` (${strictWarningCount} off campus or without access)`}
              {' '}— tap a marked day to see why.
            </span>
          </p>
        )}
        {canSelect && !range && (
          <p className="text-[10px] text-[#A1A1AA] flex items-center gap-1">
            <CalendarPlus size={10} className="flex-shrink-0" />
            Tap a day — or drag across several — to apply for OD / Leave.
          </p>
        )}
      </div>

      {detailDay && detailRecord && (
        <DayAttendanceDetailModal
          record={detailRecord}
          dateLabel={formatDayLabel(detailDay)}
          staffName={staffName}
          onClose={() => setDetailDay(null)}
        />
      )}

      {/* Leave application popup — only shown when clicking a day that has a leave app */}
      {selectedDay && selectedLeave && (
        <LeaveAppPreviewModal
          application={selectedLeave}
          onClose={() => setSelectedDay(null)}
          viewerUserId={viewerUserId}
          viewerRole={viewerRole}
          onViewFull={onViewLeave ? app => { setSelectedDay(null); onViewLeave(app) } : undefined}
        />
      )}
    </div>
  )
}
