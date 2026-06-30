'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { UserCheck, CalendarDays, User, Eye } from 'lucide-react'
import { STAFF_ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'

const StaffCheckIn = dynamic(() => import('@/components/attendance/StaffCheckIn'), {
  loading: () => (
    <div className="p-4 space-y-3">
      <div className="h-20 bg-[#F5F5F5] rounded-xl animate-pulse" />
      <div className="h-11 bg-[#F5F5F5] rounded-xl animate-pulse" />
    </div>
  ),
})

const StaffAttendanceCalendar = dynamic(() => import('@/components/attendance/StaffAttendanceCalendar'), {
  loading: () => (
    <div className="p-3">
      <div className="grid grid-cols-7 gap-1 mb-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-7 bg-[#F5F5F5] rounded animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="h-12 bg-[#F5F5F5] rounded animate-pulse" />
        ))}
      </div>
    </div>
  ),
})

const AllStaffAttendanceReport = dynamic(() => import('@/components/attendance/AllStaffAttendanceReport'), {
  loading: () => (
    <section className="border border-[#D4D4D8] bg-white rounded-xl overflow-hidden flex flex-col min-h-[300px]">
      <div
        className="px-4 py-2.5 space-y-1.5"
        style={{ background: 'linear-gradient(135deg, var(--page-gradient-from, #27272A), var(--page-gradient-to, #3D3B40))' }}
      >
        <div className="h-4 w-52 bg-white/20 rounded animate-pulse" />
        <div className="h-3 w-36 bg-white/20 rounded animate-pulse" />
      </div>
      <div className="bg-[#FAFAF9] px-4 py-2">
        <div className="h-9 bg-[#E4E4E7] rounded-lg animate-pulse" />
      </div>
      <div className="border-t border-[#E4E4E7] p-4 space-y-2 flex-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 bg-[#F5F5F5] rounded-lg animate-pulse" />
        ))}
      </div>
    </section>
  ),
})
import { SmartSelect, AsyncSmartSelect } from '@/components/workspace/ui'
import type { SmartOption } from '@/components/workspace/ui'
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

const MAX_W = 'max-w-7xl'

export default function StaffAttendancePage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const isAdmin = profile?.role === 'admin'
  const isPrincipal = profile?.role === 'principal'
  const isCoordinator = profile?.role === 'coordinator'
  const isTeacher = profile?.role === 'teacher'
  const isManager = isAdmin || isPrincipal || isCoordinator

  const [geofenceConfig, setGeofenceConfig] = useState<GeofenceConfig | null>(null)
  const [lateCutoff, setLateCutoff] = useState<string | null>(null)
  const [checkoutCutoff, setCheckoutCutoff] = useState<string | null>(null)
  const [exempt, setExempt] = useState(false)
  const [scopeStaff, setScopeStaff] = useState<UserProfile[]>([])
  const [viewingUserId, setViewingUserId] = useState<string>('')
  const [viewingStaffName, setViewingStaffName] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [bannerEditing, setBannerEditing] = useState(false)
  const [applyLeaveDate, setApplyLeaveDate] = useState<string | null>(null)

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
    if (!user || !profile) return
    if (isCoordinator) {
      const list = await fetchTeamMembers(user.id, 'coordinator')
      setScopeStaff(list)
    } else if (isTeacher) {
      const list = await fetchTeamMembers(user.id, 'teacher')
      // Include the teacher themselves so they appear in their team's roster
      const withSelf = profile ? [profile as UserProfile, ...list.filter(m => m.id !== user.id)] : list
      setScopeStaff(withSelf)
    }
  }, [user, profile, isCoordinator, isTeacher])

  useEffect(() => { loadScope() }, [loadScope])

  const bumpRefresh = () => setRefreshKey(k => k + 1)

  // Measure the left column's rendered height so the report matches it exactly.
  // Depends on user/profile so it re-runs after auth loads and the left column div is mounted.
  const leftColRef = useRef<HTMLDivElement>(null)
  const [leftColHeight, setLeftColHeight] = useState<number | undefined>(undefined)
  useEffect(() => {
    const el = leftColRef.current
    if (!el) return
    const update = () => {
      if (window.innerWidth >= 1024) setLeftColHeight(el.offsetHeight)
      else setLeftColHeight(undefined)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [user, profile])

  const openNewLeave = (date: string) => router.push(`/more/staff-leave?new=1&date=${date}`)
  const openLeaveApp = (app: LeaveApplicationWithDetails) => router.push(`/more/staff-leave?app=${app.id}`)

  // Coordinator "view-as" options (small list → plain SmartSelect).
  const coordinatorOptions: SmartOption[] = useMemo(() => {
    if (!user || !profile) return []
    const self: SmartOption = { value: user.id, label: profile.full_name, badge: 'You' }
    const members = scopeStaff
      .filter(s => s.id !== user.id && !s.is_banned)
      .map(s => ({ value: s.id, label: s.full_name, sublabel: s.role }))
    return [self, ...members]
  }, [scopeStaff, user, profile])

  if (!user || !profile) return null

  const viewingSelf = viewingUserId === user.id
  const calendarStaffName = viewingSelf ? undefined : (viewingStaffName ?? undefined)

  const handleViewSelect = (id: string, name?: string | null) => {
    setViewingUserId(id)
    setViewingStaffName(id === user.id ? null : (name ?? null))
  }

  // Admin / principal search any staff (server-backed, debounced — no stutter).
  const searchStaffOptions = async (q: string): Promise<SmartOption[]> => {
    const rows = await searchStaff(q)
    return rows.map(r => ({ value: r.id, label: r.full_name, sublabel: r.role }))
  }
  const selfOption: SmartOption = { value: user.id, label: profile.full_name, badge: 'You' }
  const viewAsLabel = viewingSelf ? `${profile.full_name} · You` : (viewingStaffName ?? 'Staff member')

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="staff-attendance">
        <PageBanner
          settingKey="staff_attendance_banner"
          defaultBanner={STAFF_ATTENDANCE_BANNER_DEFAULT}
          icon={<UserCheck size={24} className="text-white" />}
          backgroundIcon={<UserCheck size={180} className="text-white" />}
          title="Staff Attendance"
          subtitle="Check in for today and review attendance"
          isAdmin={isAdmin}
          maxWidth={MAX_W}
          onBack={() => router.back()}
          onEditingChange={setBannerEditing}
        />

        <div
          className={`${MAX_W} mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 transition-all duration-200 ${
            bannerEditing ? 'opacity-30 blur-[1px] pointer-events-none select-none' : ''
          }`}
          aria-hidden={bannerEditing}
        >
          {/* Left rail: personal check-in + calendar. On desktop it sits beside
              the manager report; for teachers it stays a comfortable column. */}
          {(() => {
            const viewPicker = isCoordinator && coordinatorOptions.length > 1 ? (
              <SmartSelect
                options={coordinatorOptions}
                value={viewingUserId || user.id}
                onChange={(v) => handleViewSelect(v, coordinatorOptions.find(o => o.value === v)?.label)}
                placeholder="View staff…"
                searchPlaceholder="Search team…"
                className="w-full"
                leadingIcon={viewingSelf
                  ? <User size={14} className="text-[#71717A] flex-shrink-0" />
                  : <Eye size={14} className="text-[#B8983C] flex-shrink-0" />}
              />
            ) : (isAdmin || isPrincipal) ? (
              <AsyncSmartSelect
                value={viewingUserId || user.id}
                selectedLabel={viewAsLabel}
                onChange={(v, opt) => handleViewSelect(v, opt?.label)}
                search={searchStaffOptions}
                pinnedOptions={[selfOption]}
                placeholder="View staff…"
                searchPlaceholder="Search any staff…"
                hintText="Type a name to view another staff member"
                className="w-full"
                leadingIcon={viewingSelf
                  ? <User size={14} className="text-[#71717A] flex-shrink-0" />
                  : <Eye size={14} className="text-[#B8983C] flex-shrink-0" />}
              />
            ) : null

            const checkInPanel = (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="border border-[#D4D4D8] bg-white rounded-xl overflow-hidden"
              >
                <div
                  className="flex items-center gap-2 border-b border-black/10 px-4 py-3"
                  style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}
                >
                  <UserCheck size={15} style={{ color: 'var(--page-accent)' }} />
                  <h2 className="text-sm font-bold text-white">Today&apos;s Check-In</h2>
                </div>
                <div className="p-4">
                  <StaffCheckIn
                    staffId={user.id}
                    geofenceConfig={geofenceConfig}
                    lateCutoff={lateCutoff}
                    checkoutCutoff={checkoutCutoff}
                    exempt={exempt}
                    onCheckedIn={bumpRefresh}
                  />
                </div>
              </motion.section>
            )

            const calendarPanel = (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut', delay: 0.08 }}
                className="border border-[#D4D4D8] bg-white rounded-xl overflow-hidden"
              >
                <div
                  className="border-b border-black/10 px-4 py-2.5"
                  style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}
                >
                  <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                    <CalendarDays size={15} style={{ color: 'var(--page-accent)' }} />
                    Attendance Calendar
                  </h2>
                  {viewPicker && <div className="mt-2">{viewPicker}</div>}
                </div>
                <StaffAttendanceCalendar
                  key={viewingUserId}
                  staffId={viewingUserId || user.id}
                  staffName={calendarStaffName}
                  mode={viewingSelf ? 'self' : 'admin'}
                  markerId={user.id}
                  refreshKey={refreshKey}
                  onApplyLeave={viewingSelf ? openNewLeave : undefined}
                  onEmptyDayClick={viewingSelf ? (d) => setApplyLeaveDate(d) : undefined}
                  onViewLeave={openLeaveApp}
                  onChanged={bumpRefresh}
                />
              </motion.section>
            )

            if (isManager || isTeacher) {
              const viewerRole = isCoordinator ? 'coordinator' : isTeacher ? 'teacher' : isPrincipal ? 'principal' : 'admin'
              const canEdit = isAdmin || isPrincipal
              return (
                <div className="grid gap-4 lg:gap-5 lg:items-start lg:grid-cols-[clamp(320px,38%,460px)_minmax(0,1fr)]">
                  <div ref={leftColRef} className="flex flex-col gap-4 lg:gap-5">
                    {checkInPanel}
                    {calendarPanel}
                  </div>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut', delay: 0.15 }}
                  >
                    <AllStaffAttendanceReport
                      viewerId={user.id}
                      viewerRole={viewerRole}
                      fixedStaff={(isCoordinator || isTeacher) ? scopeStaff : undefined}
                      canEdit={canEdit}
                      matchHeight={leftColHeight}
                      refreshKey={refreshKey}
                      onChanged={bumpRefresh}
                    />
                  </motion.div>
                </div>
              )
            }

            return (
              <div className="max-w-md mx-auto space-y-4 lg:space-y-5">
                {checkInPanel}
                {calendarPanel}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Apply-for-leave confirmation (triggered by clicking an empty calendar day) */}
      {applyLeaveDate && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setApplyLeaveDate(null)}
        >
          <div className="bg-white w-full max-w-xs rounded-2xl shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <p className="font-bold text-slate-800 text-sm">Apply for OD / Leave?</p>
              <p className="text-xs text-slate-500 mt-1">
                {new Date(applyLeaveDate + 'T12:00:00').toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric',
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setApplyLeaveDate(null)}
                className="flex-1 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  router.push(`/more/staff-leave?new=1&date=${applyLeaveDate}`)
                  setApplyLeaveDate(null)
                }}
                className="flex-1 py-2 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </ProtectedLayout>
  )
}
