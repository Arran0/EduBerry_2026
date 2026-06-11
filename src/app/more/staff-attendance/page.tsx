'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { UserCheck, Users, CalendarDays, ChevronDown, Search, User, Eye, X } from 'lucide-react'
import { STAFF_ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import StaffCheckIn from '@/components/attendance/StaffCheckIn'
import StaffAttendanceCalendar from '@/components/attendance/StaffAttendanceCalendar'
import AdminAttendancePanel from '@/components/attendance/AdminAttendancePanel'
import TeamMemberSelector from '@/components/tasks/TeamMemberSelector'
import { UserProfile } from '@/lib/supabase'
import { fetchTeamMembers } from '@/lib/tasks'
import {
  fetchGeofenceConfig,
  fetchAttendanceConfig,
  fetchMyExemption,
  searchStaff,
  GeofenceConfig,
} from '@/lib/attendance'
import { LeaveApplicationWithDetails } from '@/lib/leave'

// ─── Admin/Principal staff search picker ──────────────────────────────────────

function AdminStaffPicker({
  value, currentUserId, currentUserName,
  onSelect,
}: {
  value: string
  currentUserId: string
  currentUserName: string
  onSelect: (userId: string, name?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; full_name: string; role: string }[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const viewingSelf = value === currentUserId

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (query.trim().length < 2) { setResults([]); return }
    timer.current = setTimeout(async () => {
      const data = await searchStaff(query)
      setResults(data)
    }, 280)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query])

  const handleSelect = (id: string, name?: string) => {
    onSelect(id, name)
    setSelectedName(id === currentUserId ? null : (name ?? null))
    setOpen(false)
    setQuery('')
    setResults([])
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 px-4 py-1.5 rounded-xl border transition-all shadow-sm text-sm font-medium focus:outline-none ${
          viewingSelf
            ? 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
            : 'bg-indigo-500 border-indigo-500 text-white hover:bg-indigo-600'
        }`}
      >
        {viewingSelf ? <User size={14} className="flex-shrink-0 opacity-60" /> : <Eye size={14} className="flex-shrink-0 opacity-80" />}
        <span className="font-semibold truncate max-w-[130px]">
          {viewingSelf ? currentUserName : (selectedName || 'Staff')}
        </span>
        <ChevronDown size={12} className={`flex-shrink-0 transition-transform opacity-50 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-white rounded-2xl shadow-xl border border-slate-100 w-64">
          <div className="px-2 pt-2 pb-1">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 rounded-xl border border-slate-200 focus-within:border-indigo-300 transition-colors">
              <Search size={12} className="text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search staff by name…"
                className="flex-1 text-xs bg-transparent focus:outline-none text-slate-700 placeholder-slate-400 min-w-0"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="text-slate-300 hover:text-slate-500">
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
          <div className="py-1 max-h-56 overflow-y-auto">
            {/* View self */}
            <button
              type="button"
              onClick={() => handleSelect(currentUserId)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${
                viewingSelf ? 'text-indigo-600 font-semibold' : 'text-slate-700'
              }`}
            >
              <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                <User size={11} className="text-slate-500" />
              </span>
              <span className="truncate">{currentUserName || 'You'}</span>
              {viewingSelf && (
                <span className="ml-auto text-[9px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-medium">You</span>
              )}
            </button>

            {query.trim().length < 2 && (
              <p className="px-3 py-2 text-xs text-slate-400 text-center">Type a name to search…</p>
            )}

            {query.trim().length >= 2 && results.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400 text-center">No staff found</p>
            )}

            {results.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleSelect(r.id, r.full_name)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${
                  value === r.id ? 'text-indigo-600 font-semibold' : 'text-slate-700'
                }`}
              >
                <span className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-indigo-600">
                  {(r.full_name || '?').charAt(0).toUpperCase()}
                </span>
                <span className="truncate flex-1">{r.full_name}</span>
                <span className="text-[10px] text-slate-400 flex-shrink-0 capitalize">{r.role}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StaffAttendancePage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const isAdmin = profile?.role === 'admin'
  const isPrincipal = profile?.role === 'principal'
  const isCoordinator = profile?.role === 'coordinator'
  const isManager = isAdmin || isPrincipal || isCoordinator

  const [geofenceConfig, setGeofenceConfig] = useState<GeofenceConfig | null>(null)
  const [lateCutoff, setLateCutoff] = useState<string | null>(null)
  const [checkoutCutoff, setCheckoutCutoff] = useState<string | null>(null)
  const [exempt, setExempt] = useState(false)
  const [scopeStaff, setScopeStaff] = useState<UserProfile[]>([])
  const [viewingUserId, setViewingUserId] = useState<string>('')
  const [viewingStaffName, setViewingStaffName] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!user) return
    setViewingUserId(user.id)
    fetchGeofenceConfig().then(cfg => setGeofenceConfig(cfg))
    fetchAttendanceConfig().then(cfg => {
      setLateCutoff(cfg.late_cutoff)
      setCheckoutCutoff(cfg.checkout_cutoff)
    })
    fetchMyExemption(user.id).then(setExempt)
  }, [user])

  const loadScope = useCallback(async () => {
    if (!user || !profile || !isCoordinator) return
    const list = await fetchTeamMembers(user.id, 'coordinator')
    setScopeStaff(list)
  }, [user, profile, isCoordinator])

  useEffect(() => { loadScope() }, [loadScope])

  const bumpRefresh = () => setRefreshKey(k => k + 1)

  const openNewLeave = (date: string) => router.push(`/more/staff-leave?new=1&date=${date}`)
  const openLeaveApp = (app: LeaveApplicationWithDetails) => router.push(`/more/staff-leave?app=${app.id}`)

  if (!user || !profile) return null

  const selectorMembers = scopeStaff.filter(s => s.id !== user.id)
  const viewingSelf = viewingUserId === user.id
  const viewingCoordMember = selectorMembers.find(s => s.id === viewingUserId)
  const calendarStaffName = viewingSelf
    ? undefined
    : (viewingCoordMember?.full_name ?? viewingStaffName ?? undefined)

  const handleAdminSelect = (id: string, name?: string) => {
    setViewingUserId(id)
    setViewingStaffName(id === user.id ? null : (name ?? null))
  }

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="staff-attendance">
      <PageBanner
        settingKey="staff_attendance_banner"
        defaultBanner={STAFF_ATTENDANCE_BANNER_DEFAULT}
        icon={<UserCheck size={24} className="text-white" />}
        backgroundIcon={<UserCheck size={180} className="text-white" />}
        title="Staff Attendance"
        subtitle="Check in for today and view attendance history"
        isAdmin={isAdmin}
      />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Today's Check-In */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-50">
            <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <UserCheck size={15} style={{ color: 'var(--page-primary)' }} />
              Today&apos;s Check-In
            </h2>
          </div>
          <div className="p-5">
            <StaffCheckIn
              staffId={user.id}
              geofenceConfig={geofenceConfig}
              lateCutoff={lateCutoff}
              checkoutCutoff={checkoutCutoff}
              exempt={exempt}
              onCheckedIn={bumpRefresh}
            />
          </div>
        </section>

        {/* Attendance Calendar */}
        <section>
          <div className="flex items-center justify-between gap-3 mb-3 px-1">
            <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <CalendarDays size={15} style={{ color: 'var(--page-primary)' }} />
              Attendance Calendar
            </h2>
            {/* Coordinator: toggle between own and team members */}
            {isCoordinator && selectorMembers.length > 0 && (
              <TeamMemberSelector
                members={selectorMembers}
                selectedUserId={viewingUserId || user.id}
                currentUserId={user.id}
                currentUserName={profile.full_name}
                selfLabel={profile.full_name}
                onSelect={id => { setViewingUserId(id); setViewingStaffName(null) }}
              />
            )}
            {/* Admin/Principal: search any staff */}
            {(isAdmin || isPrincipal) && (
              <AdminStaffPicker
                value={viewingUserId || user.id}
                currentUserId={user.id}
                currentUserName={profile.full_name}
                onSelect={handleAdminSelect}
              />
            )}
          </div>
          <StaffAttendanceCalendar
            key={viewingUserId}
            staffId={viewingUserId || user.id}
            staffName={calendarStaffName}
            mode={viewingSelf ? 'self' : 'admin'}
            markerId={user.id}
            refreshKey={refreshKey}
            onApplyLeave={viewingSelf ? openNewLeave : undefined}
            onViewLeave={openLeaveApp}
            onChanged={bumpRefresh}
          />
        </section>

        {/* Team / All-staff summary — managers only */}
        {isManager && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-50">
              <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Users size={15} style={{ color: 'var(--page-primary)' }} />
                {isCoordinator ? 'My Team Attendance' : 'All Staff Attendance'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isCoordinator ? "Adjust a teacher's status for today." : "Adjust any staff member's status for today."}
              </p>
            </div>
            <div className="p-5">
              <AdminAttendancePanel
                viewerId={user.id}
                viewerRole={isCoordinator ? 'coordinator' : isPrincipal ? 'principal' : 'admin'}
                staff={scopeStaff}
                refreshKey={refreshKey}
                onChanged={bumpRefresh}
              />
            </div>
          </section>
        )}
      </div>
      </div>
    </ProtectedLayout>
  )
}
