'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock3, BookOpen, ShieldCheck, HelpCircle } from 'lucide-react'
import { AttendanceRecord, AttendanceStatus, fetchMyAttendanceByMonth } from '@/lib/attendance'

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Full cell background + text for each status (clearly visible)
const STATUS_CELL: Record<AttendanceStatus, { bg: string; text: string; border: string; dot: string; badge: string }> = {
  present:  { bg: '#ecfdf5', text: '#065f46', border: '#6ee7b7', dot: '#10b981', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  absent:   { bg: '#fff1f2', text: '#881337', border: '#fca5a5', dot: '#f43f5e', badge: 'bg-rose-100 text-rose-800 border-rose-200' },
  late:     { bg: '#fffbeb', text: '#78350f', border: '#fcd34d', dot: '#f59e0b', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  on_leave: { bg: '#f0f9ff', text: '#075985', border: '#7dd3fc', dot: '#0ea5e9', badge: 'bg-sky-100 text-sky-800 border-sky-200' },
  excused:  { bg: '#f5f3ff', text: '#4c1d95', border: '#c4b5fd', dot: '#7c3aed', badge: 'bg-violet-100 text-violet-800 border-violet-200' },
}

const STATUS_ICONS: Record<AttendanceStatus, React.ReactNode> = {
  present:  <CheckCircle2 size={11} />,
  absent:   <XCircle size={11} />,
  late:     <Clock3 size={11} />,
  on_leave: <BookOpen size={11} />,
  excused:  <ShieldCheck size={11} />,
}

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present', absent: 'Absent', late: 'Late', on_leave: 'On Leave', excused: 'Excused',
}

function monthName(year: number, month: number) {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}
function dayOfWeek(dateStr: string) { return (new Date(dateStr + 'T12:00:00').getDay() + 6) % 7 }
function daysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate() }
function isWeekend(dow: number) { return dow >= 5 }
function isToday(y: number, m: number, d: number) {
  const t = new Date(); return t.getFullYear() === y && t.getMonth() + 1 === m && t.getDate() === d
}
function isFuture(y: number, m: number, d: number) {
  return new Date(y, m - 1, d) > new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
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
    setLoading(true); setPopover(null)
    const data = await fetchMyAttendanceByMonth(studentId, year, month, homeroomId)
    setRecords(data); setLoading(false)
  }, [studentId, homeroomId, year, month])

  useEffect(() => { load() }, [load])

  const byDay: Record<number, AttendanceRecord> = {}
  for (const r of records) byDay[parseInt(r.date.split('-')[2], 10)] = r

  const totalDays = daysInMonth(year, month)
  const firstDow = dayOfWeek(`${year}-${String(month).padStart(2, '0')}-01`)
  const cells: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = () => month === 1 ? onMonthChange(year - 1, 12) : onMonthChange(year, month - 1)
  const nextMonth = () => month === 12 ? onMonthChange(year + 1, 1) : onMonthChange(year, month + 1)

  const handleDayClick = (day: number) => {
    if (popover?.day === day) { setPopover(null); return }
    const rec = byDay[day]
    setPopover({ day, status: rec?.status ?? null, remarks: rec?.remarks ?? null })
  }

  // Quick counts for header badges
  const counts = records.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1; return acc
  }, {} as Partial<Record<AttendanceStatus, number>>)

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">

      {/* ── Gradient header ── */}
      <div className="bg-gradient-to-r from-violet-700 to-purple-600 px-5 py-4">
        <div className="flex items-center justify-between">
          <button onClick={prevMonth}
            className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
            <ChevronLeft size={16} />
          </button>

          <div className="text-center">
            <p className="text-white font-bold text-base leading-tight">{monthName(year, month)}</p>
            <div className="flex items-center justify-center gap-2 mt-1.5">
              {[
                { s: 'present' as AttendanceStatus,  label: 'Present', c: '#6ee7b7' },
                { s: 'absent'  as AttendanceStatus,  label: 'Absent',  c: '#fca5a5' },
                { s: 'late'    as AttendanceStatus,  label: 'Late',    c: '#fcd34d' },
              ].map(({ s, label, c }) => (
                <span key={s} className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(255,255,255,0.15)', color: c }}>
                  {label} {counts[s] ?? 0}
                </span>
              ))}
            </div>
          </div>

          <button onClick={nextMonth}
            className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* ── Day headers ── */}
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
        {DAY_HEADERS.map(h => (
          <div key={h} className={`py-2 text-center text-[10px] font-bold uppercase tracking-wider ${
            h === 'Sat' || h === 'Sun' ? 'text-slate-300' : 'text-slate-500'
          }`}>{h}</div>
        ))}
      </div>

      {/* ── Calendar grid ── */}
      {loading ? (
        <div className="py-16 text-center bg-white">
          <div className="spinner mx-auto mb-2" />
          <p className="text-xs text-slate-400">Loading…</p>
        </div>
      ) : (
        <div className="grid grid-cols-7 bg-white relative">
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={`e-${i}`} className="h-14 border-b border-r border-slate-100 last:border-r-0 bg-slate-50/30" />
            }
            const dow = (firstDow + day - 1) % 7
            const weekend = isWeekend(dow)
            const future = isFuture(year, month, day)
            const today = isToday(year, month, day)
            const rec = byDay[day]
            const isPast = !future && !weekend && !rec
            const s = rec?.status
            const style = s ? STATUS_CELL[s] : null

            return (
              <div
                key={day}
                onClick={() => !weekend && handleDayClick(day)}
                className={`h-14 border-b border-r border-slate-100 last:border-r-0 flex flex-col items-center justify-center gap-0.5 relative select-none transition-colors ${
                  !weekend ? 'cursor-pointer' : 'cursor-default'
                } ${isPast ? 'past-unmarked' : ''}`}
                style={style ? { background: style.bg, borderBottomColor: style.border } : weekend ? { background: '#f8fafc' } : {}}
              >
                {/* Today ring */}
                {today && (
                  <div className="absolute inset-[3px] rounded-lg ring-2 ring-violet-400 pointer-events-none" />
                )}

                {/* Day number */}
                <span className="text-[12px] font-bold leading-none z-10"
                  style={{ color: style ? style.text : weekend ? '#cbd5e1' : future ? '#cbd5e1' : '#94a3b8' }}>
                  {day}
                </span>

                {/* Status indicator */}
                {s && (
                  <span style={{ color: style!.dot }}>{STATUS_ICONS[s]}</span>
                )}
                {isPast && <HelpCircle size={9} className="text-slate-300" />}
              </div>
            )
          })}

          {/* ── Popover ── */}
          {popover && (() => {
            const idx = firstDow + popover.day - 1
            const row = Math.floor(idx / 7)
            const col = idx % 7
            const topOffset = (row + 1) * 56
            const alignRight = col >= 4
            const s = popover.status
            const style = s ? STATUS_CELL[s] : null

            return (
              <div
                className="absolute z-30 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 w-52 pointer-events-none"
                style={{ top: topOffset + 6, ...(alignRight ? { right: 4 } : { left: `${col * (100 / 7)}%` }) }}
              >
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  {new Date(year, month - 1, popover.day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </p>
                {s ? (
                  <>
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${style!.badge}`}>
                      {STATUS_ICONS[s]}{STATUS_LABELS[s]}
                    </div>
                    {popover.remarks && (
                      <p className="text-xs text-slate-500 mt-2 italic leading-relaxed">&ldquo;{popover.remarks}&rdquo;</p>
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
      <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-x-4 gap-y-1.5">
        {(Object.keys(STATUS_LABELS) as AttendanceStatus[]).map(s => (
          <div key={s} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_CELL[s].dot }} />
            <span className="text-[10px] text-slate-500 font-medium">{STATUS_LABELS[s]}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <HelpCircle size={10} className="text-slate-300" />
          <span className="text-[10px] text-slate-400">Not marked</span>
        </div>
      </div>
    </div>
  )
}
