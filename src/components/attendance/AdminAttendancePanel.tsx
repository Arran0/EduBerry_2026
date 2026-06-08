'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import Avatar from '@/components/Avatar'
import { Search, Users, UserCheck, ChevronRight, X } from 'lucide-react'
import { UserProfile } from '@/lib/supabase'
import {
  StaffAttendanceRecord,
  fetchAllStaff,
  fetchTeamStaffForCoordinator,
  fetchStaffAttendanceForDate,
  isPresentStatus,
  STAFF_ATTENDANCE_STATUS_LABELS,
  STAFF_ATTENDANCE_STATUS_COLORS,
} from '@/lib/attendance'
import { LeaveApplicationWithDetails } from '@/lib/leave'
import StaffAttendanceCalendar, { CalendarMode } from './StaffAttendanceCalendar'

interface Props {
  viewerId: string
  viewerRole: 'admin' | 'principal' | 'coordinator'
  onViewLeave?: (app: LeaveApplicationWithDetails) => void
}

const ROLE_BADGE: Record<string, string> = {
  teacher: 'bg-emerald-50 text-emerald-700',
  coordinator: 'bg-purple-50 text-purple-700',
  principal: 'bg-amber-50 text-amber-700',
  admin: 'bg-rose-50 text-rose-700',
}

export default function AdminAttendancePanel({ viewerId, viewerRole, onViewLeave }: Props) {
  const today = new Date().toISOString().split('T')[0]
  const [staff, setStaff] = useState<UserProfile[]>([])
  const [todayRecords, setTodayRecords] = useState<StaffAttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<UserProfile | null>(null)

  const calendarMode: CalendarMode = viewerRole === 'coordinator' ? 'coordinator' : 'admin'

  const load = useCallback(async () => {
    setLoading(true)
    const list = viewerRole === 'coordinator'
      ? await fetchTeamStaffForCoordinator(viewerId)
      : await fetchAllStaff()
    setStaff(list)
    const recs = await fetchStaffAttendanceForDate(list.map(s => s.id), today)
    setTodayRecords(recs)
    setLoading(false)
  }, [viewerId, viewerRole, today])

  useEffect(() => { load() }, [load])

  const statusByStaff = useMemo(() => {
    const m = new Map<string, StaffAttendanceRecord>()
    for (const r of todayRecords) m.set(r.staff_id, r)
    return m
  }, [todayRecords])

  const presentCount = useMemo(
    () => todayRecords.filter(r => isPresentStatus(r.status)).length,
    [todayRecords]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return staff
    return staff.filter(s =>
      s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
    )
  }, [staff, query])

  const scopeLabel = viewerRole === 'coordinator' ? 'team' : 'school'

  // Detailed staff calendar view
  if (selected) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <X size={14} /> Back to all staff
        </button>
        <StaffAttendanceCalendar
          staffId={selected.id}
          staffName={selected.full_name}
          mode={calendarMode}
          markerId={viewerId}
          onViewLeave={onViewLeave}
          onChanged={load}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Present / total summary */}
      <div className="flex items-center gap-4 p-4 bg-gradient-to-br from-violet-50 to-purple-50 rounded-2xl border border-violet-100">
        <div className="p-2.5 bg-white rounded-xl shadow-sm">
          <UserCheck size={22} className="text-violet-600" />
        </div>
        <div className="flex-1">
          <p className="text-2xl font-bold text-slate-800 leading-none">
            {loading ? '—' : presentCount}
            <span className="text-base font-medium text-slate-400"> / {staff.length}</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">Present today across your {scopeLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-slate-700">{staff.length}</p>
          <p className="text-[11px] text-slate-400 flex items-center gap-1 justify-end"><Users size={11} /> staff</p>
        </div>
      </div>

      {/* Smart search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search staff by name or email…"
          className="w-full pl-9 pr-9 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 bg-white"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Staff list */}
      {loading ? (
        <div className="py-8 text-center text-slate-400 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center">
          <Users size={28} className="text-slate-200 mx-auto mb-2" />
          <p className="text-sm text-slate-400">
            {staff.length === 0 ? 'No staff in your scope yet' : 'No staff match your search'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-50 overflow-hidden">
          {filtered.map(s => {
            const rec = statusByStaff.get(s.id)
            return (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className="w-full flex items-center gap-3 py-3 px-3 hover:bg-slate-50 transition-colors text-left"
              >
                <Avatar avatarUrl={s.avatar_url ?? null} name={s.full_name} email={s.email} size={34} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{s.full_name}</p>
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${ROLE_BADGE[s.role] ?? 'bg-slate-100 text-slate-600'}`}>
                    {s.role}
                  </span>
                </div>
                {rec ? (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border flex-shrink-0 ${STAFF_ATTENDANCE_STATUS_COLORS[rec.status]}`}>
                    {STAFF_ATTENDANCE_STATUS_LABELS[rec.status]}
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-400 flex-shrink-0">
                    —
                  </span>
                )}
                <ChevronRight size={15} className="text-slate-300 flex-shrink-0" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
