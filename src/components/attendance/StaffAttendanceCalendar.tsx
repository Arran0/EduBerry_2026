'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, CalendarPlus, AlertTriangle, ShieldAlert,
} from 'lucide-react'
import { MonthCalendarFrame, CalendarTilesSkeleton, OutsideTile, monthCells, TILE, CAL_COLORS, STAFF_CAL_LEGEND, type TallyChip } from './MonthCalendarFrame'
import {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  StaffMonthlyStats,
  Holiday,
  NonWorkingDay,
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


type EffectiveStatus = StaffAttendanceStatus | 'holiday' | 'non_working'


const STATUS_SHORT: Record<EffectiveStatus, string> = {
  present: 'P', absent: 'A', late: 'Late', on_leave: 'OL', wfh: 'WFH', half_day: '½', e: 'Exception', holiday: 'H', non_working: 'NW',
}
// 'late'/'e' spell out as tiny-font words instead of an ambiguous single letter.
const TINY_LABEL_STATUSES = new Set<EffectiveStatus>(['late', 'e'])

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
  /**
   * Overrides how the month's records are fetched, in place of the default
   * fetchMyStaffAttendance(staffId, ...) — for a person whose attendance
   * doesn't live in staff_attendance_records (ground support staff, whose
   * rows live in support_staff_attendance and get adapted into this shape
   * by the caller). Leave apps are skipped for these — support staff have
   * no leave_applications rows to look up.
   */
  fetchRecords?: (staffId: string, year: number, month: number) => Promise<StaffAttendanceRecord[]>
}

export default function StaffAttendanceCalendar({
  staffId, staffName, mode: _mode, refreshKey = 0, initialYear, initialMonth,
  onApplyLeave, onViewLeave, viewerUserId, viewerRole, fetchRecords,
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
      (fetchRecords ?? fetchMyStaffAttendance)(staffId, year, month),
      fetchHolidays(year, month),
      fetchNonWorkingDays(year, month),
      fetchRecords ? Promise.resolve([]) : fetchLeaveApplicationsForApplicant(staffId),
    ])
    setRecords(recs)
    setHolidays(hols)
    setNonWorkingDays(nonWorking)
    setLeaveApps(apps)
    setLoading(false)
  }, [staffId, year, month, fetchRecords])

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

  const cells = monthCells(year, month)

  const prevMonth = () => month === 1 ? (setYear(y => y - 1), setMonth(12)) : setMonth(m => m - 1)
  const nextMonth = () => month === 12 ? (setYear(y => y + 1), setMonth(1)) : setMonth(m => m + 1)

  const selectedLeave = selectedDay ? leaveByDate.get(selectedDay) : undefined

  // The month's tally in the header. Late also counts toward Present — a late
  // arrival is still a day the staff member showed up — and keeps its own chip
  // for punctuality. A month with days recorded off campus or without access
  // says so in red, in the same row, so the card never grows a line for it.
  const tally: TallyChip[] = [
    { key: 'p', label: 'P', title: 'Present (incl. late)', color: CAL_COLORS.present.dot, value: loading ? null : stats.present + stats.late },
    { key: 'a', label: 'A', title: 'Absent', color: CAL_COLORS.absent.dot, value: loading ? null : stats.absent },
    { key: 'l', label: 'L', title: 'Late', color: CAL_COLORS.late.dot, value: loading ? null : stats.late },
    { key: 'hd', label: 'HD', title: 'Half day', color: CAL_COLORS.half_day.dot, value: loading ? null : stats.half_day },
    { key: 'pct', label: '', title: `${stats.working_days} working days this month`, color: '#B8983C', value: loading ? null : `${stats.present_pct}%` },
    ...(!loading && warningDates.length > 0 ? [{
      key: 'warn', label: '', tone: 'alert' as const,
      title: `${warningDates.length} day${warningDates.length === 1 ? '' : 's'} recorded without a verified location${strictWarningCount > 0 ? ` (${strictWarningCount} off campus or without access)` : ''} — tap a marked day to see why.`,
      color: strictWarningCount > 0 ? '#dc2626' : '#d97706',
      value: `${warningDates.length} unverified`,
    }] : []),
  ]

  return (
    <div ref={gridRef} style={canSelect ? { touchAction: 'pan-y' } : undefined}>
      <MonthCalendarFrame
        year={year}
        month={month}
        onPrev={prevMonth}
        onNext={nextMonth}
        tally={tally}
        legend={STAFF_CAL_LEGEND}
        below={canSelect ? (
          <AnimatePresence initial={false}>
            {range ? (
              <motion.div
                key="bar"
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
            ) : (
              <p key="hint" className="text-[10px] text-slate-400 flex items-center gap-1 px-4 py-2 border-t border-slate-100">
                <CalendarPlus size={10} className="flex-shrink-0" />
                Tap a day — or drag across several — to apply for OD / Leave.
              </p>
            )}
          </AnimatePresence>
        ) : undefined}
      >
        {loading ? <CalendarTilesSkeleton /> : cells.map((day, i) => {
          if (day === null) return <OutsideTile key={`e-${i}`} year={year} month={month} index={i} />
          const dateStr = `${year}-${pad(month)}-${pad(day)}`
          const rec = recordByDate.get(dateStr)
          const leave = leaveByDate.get(dateStr)
          const eff = deriveDayStatus(dateStr, rec, holidaySet, nonWorkingSet, today)
          const isTodayCell = dateStr === today
          const colors = eff ? CAL_COLORS[eff === 'wfh' ? 'on_duty' : eff] : null
          // A day is a valid drag anchor when it is a plain, unclaimed
          // workday — no record, no leave already on it, and not a holiday
          // or non-working day. Any day can be the far end of a range that
          // started on one.
          const pickable = canSelect && !leave && !rec && !holidaySet.has(dateStr) && !nonWorkingSet.has(dateStr)
          const inRange = !!range && dateStr >= range.start && dateStr <= range.end
          const dayWarning = rec ? describeLocationWarning(rec) : null
          const clickable = !!leave || !!rec || pickable

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
              className={`${TILE} relative flex flex-col items-center justify-center gap-0.5 select-none transition-[transform,filter] ${
                clickable ? 'cursor-pointer hover:brightness-[0.97] active:scale-[0.96]' : 'cursor-default'
              } focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400`}
              style={inRange
                ? { background: '#ddd6fe', boxShadow: 'inset 0 0 0 2px #8b5cf6' }
                : colors
                  ? { background: colors.bg, boxShadow: `inset 0 0 0 1px ${colors.border}66` }
                  : leave
                    ? { background: '#fffbeb', boxShadow: 'inset 0 0 0 1px #fcd34d66' }
                    : { background: '#fcfcfd', boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.04)' }}
              title={dayWarning ? `${dayWarning.title} — tap for details` : undefined}
            >
              <span
                className={`text-[12px] font-bold leading-none tabular-nums ${isTodayCell ? 'w-[22px] h-[22px] rounded-full flex items-center justify-center text-white' : ''}`}
                style={isTodayCell
                  ? { background: 'var(--page-gradient-from, #27272A)' }
                  : { color: inRange ? '#4c1d95' : colors ? colors.text : '#94a3b8' }}
              >
                {day}
              </span>
              {eff && (
                <span
                  className={`font-bold leading-none ${TINY_LABEL_STATUSES.has(eff) || eff === 'holiday' || eff === 'non_working' ? 'text-[6.5px] uppercase tracking-tight' : 'text-[9.5px]'}`}
                  style={{ color: colors?.dot }}
                >
                  {eff === 'holiday' ? 'Hol' : STATUS_SHORT[eff]}
                </span>
              )}
              {leave && (
                <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${leave.status === 'approved' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
              )}
              {/* Top-left, opposite the leave dot, so a day can carry both.
                  Red for a day marked off campus or with location access off,
                  amber for a device that simply could not answer. */}
              {dayWarning && !inRange && (
                dayWarning.strict
                  ? <ShieldAlert size={9} strokeWidth={2.8} className="absolute top-1 left-1 text-red-600" aria-label="Location not verified" />
                  : <AlertTriangle size={9} strokeWidth={2.8} className="absolute top-1 left-1 text-amber-600" aria-label="Location not confirmed" />
              )}
            </button>
          )
        })}
      </MonthCalendarFrame>

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
