'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import Avatar from '@/components/Avatar'
import { Search, Users, UserCheck, X, Clock, Loader2 } from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  Holiday,
  fetchStaffAttendanceForDate,
  fetchAttendanceConfig,
  fetchHolidays,
  adminMarkStaffAttendance,
  isPresentStatus,
  STAFF_ATTENDANCE_STATUS_LABELS,
  STAFF_ATTENDANCE_STATUS_COLORS,
} from '@/lib/attendance'

interface Props {
  viewerId: string
  viewerRole: 'admin' | 'principal' | 'coordinator'
  staff: UserProfile[]
  refreshKey?: number
  onChanged?: () => void
}

const ROLE_BADGE: Record<string, string> = {
  teacher: 'bg-emerald-50 text-emerald-700',
  coordinator: 'bg-purple-50 text-purple-700',
  principal: 'bg-amber-50 text-amber-700',
  admin: 'bg-rose-50 text-rose-700',
}

const STATUS_OPTIONS: StaffAttendanceStatus[] = ['present', 'late', 'half_day', 'wfh', 'absent', 'on_leave']

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export default function AdminAttendancePanel({ viewerId, viewerRole, staff, refreshKey = 0, onChanged }: Props) {
  const today = new Date().toISOString().split('T')[0]
  const [todayRecords, setTodayRecords] = useState<StaffAttendanceRecord[]>([])
  const [pastCutoff, setPastCutoff] = useState(false)
  const [isHolidayToday, setIsHolidayToday] = useState(false)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const showSearch = viewerRole !== 'coordinator'
  const scopeLabel = viewerRole === 'coordinator' ? 'team' : 'school'

  const load = useCallback(async () => {
    setLoading(true)
    const [recs, cfg, hols] = await Promise.all([
      fetchStaffAttendanceForDate(staff.map(s => s.id), today),
      fetchAttendanceConfig(),
      fetchHolidays(new Date().getFullYear(), new Date().getMonth() + 1),
    ])
    setTodayRecords(recs)
    setIsHolidayToday(hols.some((h: Holiday) => h.date === today))
    if (cfg.late_cutoff) {
      const [h, m] = cfg.late_cutoff.split(':').map(Number)
      const now = new Date()
      setPastCutoff(now.getHours() * 60 + now.getMinutes() > h * 60 + m)
    } else {
      setPastCutoff(false)
    }
    setLoading(false)
  }, [staff, today])

  useEffect(() => { load() }, [load, refreshKey])

  const recordByStaff = useMemo(() => {
    const m = new Map<string, StaffAttendanceRecord>()
    for (const r of todayRecords) m.set(r.staff_id, r)
    return m
  }, [todayRecords])

  const presentCount = useMemo(
    () => todayRecords.filter(r => isPresentStatus(r.status)).length,
    [todayRecords]
  )

  const placeholderLabel = isHolidayToday ? 'Holiday' : pastCutoff ? 'Absent (auto)' : 'Not marked'

  const handleSet = async (staffId: string, status: StaffAttendanceStatus) => {
    setSavingId(staffId)
    const ok = await adminMarkStaffAttendance(staffId, today, status, viewerId)
    if (ok) { await load(); onChanged?.() }
    setSavingId(null)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return staff
    return staff.filter(s =>
      s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
    )
  }, [staff, query])

  return (
    <div className="space-y-4">
      {/* Present / total summary */}
      <div className="flex items-center gap-4 p-4 bg-gradient-to-br from-violet-50 to-purple-50 rounded-2xl border border-violet-100">
        <div className="p-2.5 bg-white rounded-xl shadow-sm flex-shrink-0">
          <UserCheck size={22} className="text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-bold text-slate-800 leading-none">
            {loading ? '—' : presentCount}
            <span className="text-base font-medium text-slate-400"> / {staff.length}</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Present today {isHolidayToday ? '(holiday) ' : ''}across your {scopeLabel}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold text-slate-700">{staff.length}</p>
          <p className="text-[11px] text-slate-400 flex items-center gap-1 justify-end"><Users size={11} /> staff</p>
        </div>
      </div>

      {/* Search — admin / principal only */}
      {showSearch && staff.length > 0 && (
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search staff…"
            className="w-full pl-9 pr-9 py-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 bg-white"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Roster */}
      {loading ? (
        <div className="py-10 flex items-center justify-center gap-2 text-slate-400 text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center">
          <Users size={30} className="text-slate-200 mx-auto mb-2" />
          <p className="text-sm text-slate-400">
            {staff.length === 0
              ? (viewerRole === 'coordinator' ? 'No teachers in your team yet' : 'No staff found')
              : 'No staff match your search'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-50">
          {filtered.map(s => {
            const rec = recordByStaff.get(s.id)
            const isSaving = savingId === s.id
            return (
              <div key={s.id} className="px-3 pt-3 pb-2.5 space-y-2.5">
                {/* Staff info row */}
                <div className="flex items-center gap-3">
                  <Avatar avatarUrl={s.avatar_url ?? null} name={s.full_name} email={s.email} size={38} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800 truncate">{s.full_name}</p>
                      {isSaving && <Loader2 size={12} className="animate-spin text-violet-500 flex-shrink-0" />}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${ROLE_BADGE[s.role] ?? 'bg-slate-100 text-slate-600'}`}>
                        {s.role}
                      </span>
                      {rec?.check_in_time && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <Clock size={9} /> {formatTime(rec.check_in_time)}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Current status badge */}
                  {rec ? (
                    <span className={`text-[11px] px-2 py-1 rounded-full font-medium border flex-shrink-0 ${STAFF_ATTENDANCE_STATUS_COLORS[rec.status]}`}>
                      {STAFF_ATTENDANCE_STATUS_LABELS[rec.status]}
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-400 border border-slate-200 flex-shrink-0">
                      {placeholderLabel}
                    </span>
                  )}
                </div>

                {/* Status selector — horizontal scroll, touch-friendly */}
                <div
                  className="flex gap-1.5 overflow-x-auto pl-[50px]"
                  style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
                >
                  {STATUS_OPTIONS.map(st => (
                    <button
                      key={st}
                      disabled={isSaving}
                      onClick={() => handleSet(s.id, st)}
                      className={`flex-shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40 active:scale-95 ${
                        rec?.status === st
                          ? STAFF_ATTENDANCE_STATUS_COLORS[st]
                          : 'border-slate-200 text-slate-500 bg-white hover:bg-slate-50 active:bg-slate-100'
                      }`}
                    >
                      {STAFF_ATTENDANCE_STATUS_LABELS[st]}
                    </button>
                  ))}
                  {/* spacer so last pill isn't flush against edge on iOS */}
                  <div className="w-2 flex-shrink-0" />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
