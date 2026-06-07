'use client'

import React, { useState, useEffect, useCallback } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import { UserCheck, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { STAFF_ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import StaffCheckIn from '@/components/attendance/StaffCheckIn'
import {
  fetchGeofenceConfig,
  fetchMyStaffAttendance,
  fetchAllStaffByDate,
  adminMarkStaffAttendance,
  GeofenceConfig,
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  STAFF_ATTENDANCE_STATUS_LABELS,
  STAFF_ATTENDANCE_STATUS_COLORS,
} from '@/lib/attendance'

// ─── Month calendar (staff) ───────────────────────────────────────────────────

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const STAFF_STATUS_BG: Record<StaffAttendanceStatus, string> = {
  present:  'bg-green-100 text-green-800',
  absent:   'bg-red-100 text-red-800',
  late:     'bg-amber-100 text-amber-800',
  on_leave: 'bg-blue-100 text-blue-800',
  wfh:      'bg-cyan-100 text-cyan-800',
  half_day: 'bg-orange-100 text-orange-800',
}

const STAFF_STATUS_SHORT: Record<StaffAttendanceStatus, string> = {
  present: 'P', absent: 'A', late: 'L', on_leave: 'OL', wfh: 'WFH', half_day: '½',
}

function dayOfWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00')
  return (d.getDay() + 6) % 7
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function isToday(year: number, month: number, day: number) {
  const t = new Date()
  return t.getFullYear() === year && t.getMonth() + 1 === month && t.getDate() === day
}

function monthName(year: number, month: number) {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

interface StaffMonthCalendarProps {
  staffId: string
  refreshKey: number
}

function StaffMonthCalendar({ staffId, refreshKey }: StaffMonthCalendarProps) {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [records, setRecords] = useState<StaffAttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchMyStaffAttendance(staffId, year, month)
    setRecords(data)
    setLoading(false)
  }, [staffId, year, month])

  useEffect(() => { load() }, [load, refreshKey])

  const recordByDay: Record<number, StaffAttendanceRecord> = {}
  for (const r of records) {
    const day = parseInt(r.date.split('-')[2], 10)
    recordByDay[day] = r
  }

  const totalDays = daysInMonth(year, month)
  const firstDow = dayOfWeek(`${year}-${String(month).padStart(2, '0')}-01`)
  const cells: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = () => month === 1 ? (setYear(y => y - 1), setMonth(12)) : setMonth(m => m - 1)
  const nextMonth = () => month === 12 ? (setYear(y => y + 1), setMonth(1)) : setMonth(m => m + 1)

  // Summary counts
  const counts = { present: 0, absent: 0, late: 0, on_leave: 0, wfh: 0, half_day: 0 }
  for (const r of records) { if (r.status in counts) counts[r.status as StaffAttendanceStatus]++ }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <button onClick={prevMonth} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
          <ChevronLeft size={18} />
        </button>
        <h3 className="font-semibold text-slate-800 text-sm">{monthName(year, month)}</h3>
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
            if (day === null) return <div key={`e-${i}`} className="h-12 sm:h-14 border-b border-r border-slate-50 last:border-r-0" />
            const dow = (firstDow + (day - 1)) % 7
            const weekend = dow >= 5
            const rec = recordByDay[day]
            const today = isToday(year, month, day)
            const cellBg = weekend ? 'bg-slate-50' : rec ? STAFF_STATUS_BG[rec.status] : ''

            return (
              <div
                key={day}
                className={`h-12 sm:h-14 border-b border-r border-slate-50 last:border-r-0 flex flex-col items-center justify-center gap-0.5 select-none
                  ${cellBg}
                  ${today ? 'ring-2 ring-inset ring-slate-400' : ''}
                `}
              >
                <span className={`text-[11px] font-semibold leading-none ${weekend ? 'text-slate-300' : rec ? '' : 'text-slate-400'}`}>
                  {day}
                </span>
                {rec && !weekend && (
                  <span className="text-[10px] font-bold leading-none opacity-70">
                    {STAFF_STATUS_SHORT[rec.status]}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Summary pills */}
      <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap gap-2">
        {(Object.entries(counts) as [StaffAttendanceStatus, number][]).filter(([, v]) => v > 0).map(([s, v]) => (
          <div key={s} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${STAFF_ATTENDANCE_STATUS_COLORS[s]}`}>
            <span>{STAFF_ATTENDANCE_STATUS_LABELS[s]}</span>
            <span className="font-bold">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── All Staff Today (admin/principal) ────────────────────────────────────────

const STAFF_STATUS_OPTIONS: StaffAttendanceStatus[] = ['present', 'absent', 'late', 'on_leave', 'wfh', 'half_day']

interface AllStaffTodayProps {
  adminId: string
}

function AllStaffToday({ adminId }: AllStaffTodayProps) {
  const today = new Date().toISOString().split('T')[0]
  const [records, setRecords] = useState<StaffAttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchAllStaffByDate(today)
    setRecords(data)
    setLoading(false)
  }, [today])

  useEffect(() => { load() }, [load])

  const handleStatusChange = async (staffId: string, status: StaffAttendanceStatus) => {
    setSavingId(staffId)
    await adminMarkStaffAttendance(staffId, today, status, adminId)
    await load()
    setSavingId(null)
  }

  const formatTime = (iso: string | null) => iso
    ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '—'

  if (loading) {
    return <div className="py-8 text-center text-slate-400 text-sm">Loading…</div>
  }

  if (records.length === 0) {
    return (
      <div className="py-8 text-center">
        <Calendar size={28} className="text-slate-200 mx-auto mb-2" />
        <p className="text-sm text-slate-400">No staff check-ins recorded today</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-slate-50">
      {records.map(rec => (
        <div key={rec.id} className="flex items-center gap-3 py-3 px-1">
          <Avatar
            avatarUrl={rec.staff?.avatar_url ?? null}
            name={rec.staff?.full_name ?? ''}
            email={rec.staff?.email ?? ''}
            size="sm"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{rec.staff?.full_name ?? '—'}</p>
            <p className="text-[11px] text-slate-400">Check-in: {formatTime(rec.check_in_time)}</p>
          </div>
          {rec.geofence_passed !== null && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border flex-shrink-0 ${
              rec.geofence_passed ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              {rec.geofence_passed ? 'Zone ✓' : 'Zone ✗'}
            </span>
          )}
          {/* Status override dropdown */}
          <select
            value={rec.status}
            disabled={savingId === rec.staff_id}
            onChange={e => handleStatusChange(rec.staff_id, e.target.value as StaffAttendanceStatus)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 bg-white flex-shrink-0"
          >
            {STAFF_STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{STAFF_ATTENDANCE_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StaffAttendancePage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isPrincipalOrAdmin = profile?.role === 'principal' || isAdmin

  const [geofenceConfig, setGeofenceConfig] = useState<GeofenceConfig | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    fetchGeofenceConfig().then(cfg => setGeofenceConfig(cfg))
  }, [])

  const handleCheckedIn = () => setRefreshKey(k => k + 1)

  if (!user || !profile) return null

  return (
    <ProtectedLayout staffOnly>
      <PageBanner
        settingKey="staff_attendance_banner"
        defaultBanner={STAFF_ATTENDANCE_BANNER_DEFAULT}
        icon={<UserCheck size={22} className="text-white" />}
        title="Staff Attendance"
        subtitle="Check in for today and view attendance history"
        isAdmin={isAdmin}
      />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Today's Check-In */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-semibold text-slate-800 text-sm mb-4">Today&apos;s Check-In</h2>
          <StaffCheckIn
            staffId={user.id}
            geofenceConfig={geofenceConfig}
            onCheckedIn={handleCheckedIn}
          />
        </div>

        {/* Monthly History */}
        <div>
          <h2 className="font-semibold text-slate-800 text-sm mb-3">My Attendance History</h2>
          <StaffMonthCalendar staffId={user.id} refreshKey={refreshKey} />
        </div>

        {/* All Staff Today — principal/admin only */}
        {isPrincipalOrAdmin && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="font-semibold text-slate-800 text-sm mb-4">All Staff — Today</h2>
            <AllStaffToday adminId={user.id} />
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
