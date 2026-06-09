'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock3, BookOpen, ShieldCheck, HelpCircle } from 'lucide-react'
import { AttendanceRecord, AttendanceStatus, fetchMyAttendanceByMonth } from '@/lib/attendance'

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Cell background + text
const STATUS_CELL: Record<AttendanceStatus, string> = {
  present:  'bg-emerald-50 text-emerald-700',
  absent:   'bg-rose-50 text-rose-700',
  late:     'bg-amber-50 text-amber-700',
  on_leave: 'bg-sky-50 text-sky-700',
  excused:  'bg-violet-50 text-violet-700',
}

// Dot color under the day number
const STATUS_DOT: Record<AttendanceStatus, string> = {
  present:  'bg-emerald-400',
  absent:   'bg-rose-400',
  late:     'bg-amber-400',
  on_leave: 'bg-sky-400',
  excused:  'bg-violet-400',
}

// Badge chip colors in the popover
const STATUS_BADGE: Record<AttendanceStatus, string> = {
  present:  'bg-emerald-100 text-emerald-800 border-emerald-200',
  absent:   'bg-rose-100 text-rose-800 border-rose-200',
  late:     'bg-amber-100 text-amber-800 border-amber-200',
  on_leave: 'bg-sky-100 text-sky-800 border-sky-200',
  excused:  'bg-violet-100 text-violet-800 border-violet-200',
}

const STATUS_ICONS: Record<AttendanceStatus, React.ReactNode> = {
  present:  <CheckCircle2 size={11} className="text-emerald-500" />,
  absent:   <XCircle size={11} className="text-rose-500" />,
  late:     <Clock3 size={11} className="text-amber-500" />,
  on_leave: <BookOpen size={11} className="text-sky-500" />,
  excused:  <ShieldCheck size={11} className="text-violet-500" />,
}

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present', absent: 'Absent', late: 'Late', on_leave: 'On Leave', excused: 'Excused',
}

function monthName(year: number, month: number) {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

function dayOfWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00')
  return (d.getDay() + 6) % 7
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function isWeekend(dow: number) { return dow >= 5 }

function isToday(year: number, month: number, day: number) {
  const t = new Date()
  return t.getFullYear() === year && t.getMonth() + 1 === month && t.getDate() === day
}

function isFuture(year: number, month: number, day: number) {
  const t = new Date()
  const date = new Date(year, month - 1, day)
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate())
  return date > today
}

interface Popover { day: number; status: AttendanceStatus | null; remarks: string | null }

interface AttendanceCalendarProps {
  studentId: string
  homeroomId: string
  year: number
  month: number
  onMonthChange: (year: number, month: number) => void
}

export default function AttendanceCalendar({ studentId, homeroomId, year, month, onMonthChange }: AttendanceCalendarProps) {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [popover, setPopover] = useState<Popover | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setPopover(null)
    const data = await fetchMyAttendanceByMonth(studentId, year, month, homeroomId)
    setRecords(data)
    setLoading(false)
  }, [studentId, homeroomId, year, month])

  useEffect(() => { load() }, [load])

  const recordByDay: Record<number, AttendanceRecord> = {}
  for (const r of records) {
    const day = parseInt(r.date.split('-')[2], 10)
    recordByDay[day] = r
  }

  const totalDays = daysInMonth(year, month)
  const firstDow = dayOfWeek(`${year}-${String(month).padStart(2, '0')}-01`)

  const cells: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = () => month === 1 ? onMonthChange(year - 1, 12) : onMonthChange(year, month - 1)
  const nextMonth = () => month === 12 ? onMonthChange(year + 1, 1) : onMonthChange(year, month + 1)

  const handleDayClick = (day: number) => {
    const rec = recordByDay[day]
    if (popover?.day === day) { setPopover(null); return }
    setPopover({ day, status: rec?.status ?? null, remarks: rec?.remarks ?? null })
  }

  // Stats for the month footer
  const presentCount  = records.filter(r => r.status === 'present').length
  const absentCount   = records.filter(r => r.status === 'absent').length
  const lateCount     = records.filter(r => r.status === 'late').length
  const leaveCount    = records.filter(r => r.status === 'on_leave').length
  const excusedCount  = records.filter(r => r.status === 'excused').length

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

      {/* ── Month navigation header ── */}
      <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-slate-50 to-slate-50/60 border-b border-slate-100">
        <button
          onClick={prevMonth}
          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-white rounded-xl transition-all shadow-sm border border-transparent hover:border-slate-200"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="text-center">
          <h3 className="font-bold text-slate-800 text-sm tracking-tight">{monthName(year, month)}</h3>
          <div className="flex items-center justify-center gap-3 mt-1.5">
            {[
              { label: 'P', val: presentCount, color: 'text-emerald-600 bg-emerald-50' },
              { label: 'A', val: absentCount,  color: 'text-rose-600 bg-rose-50' },
              { label: 'L', val: lateCount,    color: 'text-amber-600 bg-amber-50' },
            ].map(s => (
              <span key={s.label} className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${s.color}`}>
                {s.label} {s.val}
              </span>
            ))}
          </div>
        </div>

        <button
          onClick={nextMonth}
          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-white rounded-xl transition-all shadow-sm border border-transparent hover:border-slate-200"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* ── Day headers ── */}
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/40">
        {DAY_HEADERS.map(h => (
          <div
            key={h}
            className={`py-2.5 text-center text-[10px] font-bold uppercase tracking-widest ${
              h === 'Sat' || h === 'Sun' ? 'text-slate-300' : 'text-slate-500'
            }`}
          >
            {h}
          </div>
        ))}
      </div>

      {/* ── Calendar grid ── */}
      {loading ? (
        <div className="py-16 text-center">
          <div className="spinner mx-auto mb-3" />
          <p className="text-xs text-slate-400">Loading attendance…</p>
        </div>
      ) : (
        <div className="grid grid-cols-7 relative">
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={`e-${i}`} className="h-14 border-b border-r border-slate-50 last:border-r-0" />
            }

            const dow = (firstDow + (day - 1)) % 7
            const weekend = isWeekend(dow)
            const future = isFuture(year, month, day)
            const today = isToday(year, month, day)
            const rec = recordByDay[day]
            const isPast = !future && !weekend && !rec

            let cellBg = ''
            if (weekend) cellBg = 'bg-slate-50/60'
            else if (rec) cellBg = STATUS_CELL[rec.status]

            return (
              <div
                key={day}
                onClick={() => !weekend && handleDayClick(day)}
                className={`h-14 border-b border-r border-slate-50 last:border-r-0 flex flex-col items-center justify-center gap-0.5 relative select-none transition-all duration-150
                  ${!weekend ? 'cursor-pointer hover:brightness-[0.97] active:brightness-95' : 'cursor-default'}
                  ${cellBg}
                  ${isPast ? 'past-unmarked' : ''}
                  ${today ? 'ring-2 ring-inset ring-violet-400/70' : ''}
                  ${popover?.day === day ? 'brightness-95' : ''}
                `}
              >
                <span className={`text-[11px] font-bold leading-none ${
                  today ? 'text-violet-600' :
                  weekend ? 'text-slate-300' :
                  rec ? '' :
                  future ? 'text-slate-300' : 'text-slate-400'
                }`}>
                  {day}
                </span>

                {rec && (
                  <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[rec.status]} flex-shrink-0`} />
                )}

                {isPast && <HelpCircle size={8} className="text-slate-300" />}
              </div>
            )
          })}

          {/* ── Popover ── */}
          {popover && (() => {
            const cellIndex = firstDow + popover.day - 1
            const row = Math.floor(cellIndex / 7)
            const col = cellIndex % 7
            const alignRight = col >= 4
            const topOffset = (row + 1) * 56

            return (
              <div
                className="absolute z-30 bg-white border border-slate-200/80 rounded-2xl shadow-xl shadow-slate-200/60 p-3.5 w-52 pointer-events-none"
                style={{
                  top: topOffset + 6,
                  ...(alignRight ? { right: 0 } : { left: `${col * (100 / 7)}%` }),
                }}
              >
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  {new Date(year, month - 1, popover.day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </p>
                {popover.status ? (
                  <>
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_BADGE[popover.status]}`}>
                      {STATUS_ICONS[popover.status]}
                      {STATUS_LABELS[popover.status]}
                    </div>
                    {popover.remarks && (
                      <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                        &ldquo;{popover.remarks}&rdquo;
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-400 italic">Not yet marked</p>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* ── Legend ── */}
      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/40 flex flex-wrap gap-x-3 gap-y-1.5">
        {(Object.entries(STATUS_LABELS) as [AttendanceStatus, string][]).map(([s, label]) => (
          <div key={s} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[s]}`} />
            <span className="text-[10px] text-slate-500 font-medium">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <HelpCircle size={10} className="text-slate-300" />
          <span className="text-[10px] text-slate-400">Not marked</span>
        </div>
        {leaveCount + excusedCount > 0 && (
          <div className="ml-auto text-[10px] text-slate-400">
            {leaveCount > 0 && <span className="mr-2">Leave: {leaveCount}</span>}
            {excusedCount > 0 && <span>Excused: {excusedCount}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
