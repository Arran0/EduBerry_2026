'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Clock, BookOpen, ShieldCheck, HelpCircle } from 'lucide-react'
import { AttendanceRecord, AttendanceStatus, fetchMyAttendanceByMonth } from '@/lib/attendance'

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const STATUS_BG: Record<AttendanceStatus, string> = {
  present:  'bg-green-100 text-green-800',
  absent:   'bg-red-100 text-red-800',
  late:     'bg-amber-100 text-amber-800',
  on_leave: 'bg-blue-100 text-blue-800',
  excused:  'bg-purple-100 text-purple-800',
}

const STATUS_ICONS: Record<AttendanceStatus, React.ReactNode> = {
  present:  <CheckCircle size={11} className="text-green-600" />,
  absent:   <XCircle size={11} className="text-red-500" />,
  late:     <Clock size={11} className="text-amber-500" />,
  on_leave: <BookOpen size={11} className="text-blue-500" />,
  excused:  <ShieldCheck size={11} className="text-purple-500" />,
}

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present', absent: 'Absent', late: 'Late', on_leave: 'On Leave', excused: 'Excused',
}

function monthName(year: number, month: number) {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

// Return 0=Mon … 6=Sun for a given date string
function dayOfWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00')
  return (d.getDay() + 6) % 7  // convert Sun=0 → 6, Mon=1 → 0 …
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function isWeekend(dayOfWeekVal: number) { return dayOfWeekVal >= 5 }

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

  // Build cells: leading empty + days
  const cells: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = () => {
    if (month === 1) onMonthChange(year - 1, 12)
    else onMonthChange(year, month - 1)
  }
  const nextMonth = () => {
    if (month === 12) onMonthChange(year + 1, 1)
    else onMonthChange(year, month + 1)
  }

  const handleDayClick = (day: number) => {
    const rec = recordByDay[day]
    if (popover?.day === day) { setPopover(null); return }
    setPopover({ day, status: rec?.status ?? null, remarks: rec?.remarks ?? null })
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Month navigation */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <button onClick={prevMonth} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
          <ChevronLeft size={18} />
        </button>
        <h3 className="font-semibold text-slate-800 text-sm">{monthName(year, month)}</h3>
        <button onClick={nextMonth} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-slate-100">
        {DAY_HEADERS.map(h => (
          <div key={h} className={`py-2 text-center text-[11px] font-semibold ${h === 'Sat' || h === 'Sun' ? 'text-slate-300' : 'text-slate-500'}`}>
            {h}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="py-16 text-center">
          <div className="spinner mx-auto mb-2" />
          <p className="text-xs text-slate-400">Loading…</p>
        </div>
      ) : (
        <div className="grid grid-cols-7 relative">
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={`empty-${i}`} className="h-12 sm:h-14 border-b border-r border-slate-50 last:border-r-0" />
            }
            const dow = (firstDow + (day - 1)) % 7
            const weekend = isWeekend(dow)
            const future = isFuture(year, month, day)
            const today = isToday(year, month, day)
            const rec = recordByDay[day]

            let cellBg = ''
            let icon: React.ReactNode = null

            if (weekend) {
              cellBg = 'bg-slate-50'
            } else if (future) {
              cellBg = ''
            } else if (rec) {
              cellBg = STATUS_BG[rec.status]
              icon = STATUS_ICONS[rec.status]
            } else {
              // Past unmarked → diagonal stripe
              cellBg = ''
            }

            const isPast = !future && !weekend && !rec

            return (
              <div
                key={day}
                onClick={() => !weekend && handleDayClick(day)}
                className={`h-12 sm:h-14 border-b border-r border-slate-50 last:border-r-0 flex flex-col items-center justify-center gap-0.5 relative select-none transition-colors
                  ${!weekend ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}
                  ${cellBg}
                  ${isPast ? 'past-unmarked' : ''}
                  ${today ? 'ring-2 ring-inset ring-slate-400' : ''}
                  ${popover?.day === day ? 'brightness-95' : ''}
                `}
              >
                <span className={`text-[11px] font-semibold leading-none ${
                  weekend ? 'text-slate-300' :
                  rec ? '' :
                  future ? 'text-slate-300' : 'text-slate-400'
                }`}>
                  {day}
                </span>
                {icon && <span className="flex-shrink-0">{icon}</span>}
                {isPast && <HelpCircle size={9} className="text-slate-300" />}
              </div>
            )
          })}

          {/* Popover */}
          {popover && (() => {
            const cellIndex = firstDow + popover.day - 1
            const row = Math.floor(cellIndex / 7)
            const col = cellIndex % 7
            const alignRight = col >= 4
            const topOffset = (row + 1) * 56  // approx cell height

            return (
              <div
                className={`absolute z-20 bg-white border border-slate-200 rounded-xl shadow-xl p-3 w-48 text-sm pointer-events-none`}
                style={{ top: topOffset + 4, ...(alignRight ? { right: 0 } : { left: col * (100 / 7) + '%' }) }}
              >
                {popover.status ? (
                  <>
                    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium mb-1 ${STATUS_BG[popover.status]}`}>
                      {STATUS_ICONS[popover.status]}
                      {STATUS_LABELS[popover.status]}
                    </div>
                    {popover.remarks && <p className="text-xs text-slate-500 mt-1">{popover.remarks}</p>}
                  </>
                ) : (
                  <p className="text-xs text-slate-400 italic">Not yet marked</p>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Legend */}
      <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap gap-3">
        {(Object.entries(STATUS_LABELS) as [AttendanceStatus, string][]).map(([s, label]) => (
          <div key={s} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${STATUS_BG[s].split(' ')[0]}`} />
            <span className="text-[10px] text-slate-500">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <HelpCircle size={11} className="text-slate-300" />
          <span className="text-[10px] text-slate-400">Not marked</span>
        </div>
      </div>
    </div>
  )
}
