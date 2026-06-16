'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { UserCheck, CalendarDays, User, Eye } from 'lucide-react'
import { STAFF_ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import StaffCheckIn from '@/components/attendance/StaffCheckIn'
import StaffAttendanceCalendar from '@/components/attendance/StaffAttendanceCalendar'
import AllStaffAttendanceReport from '@/components/attendance/AllStaffAttendanceReport'
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

  const openNewLeave = (date: string) => router.push(`/more/staff-leave?new=1&date=${date}`)
  const openLeaveApp = (app: LeaveApplicationWithDetails) => router.push(`/more/staff-leave?app=${app.id}`)

  // Coordinator "view-as" options (small list → plain SmartSelect).
  const coordinatorOptions: SmartOption[] = useMemo(() => {
    if (!user || !profile) return []
    const self: SmartOption = { value: user.id, label: profile.full_name, badge: 'You' }
    const members = scopeStaff
      .filter(s => s.id !== user.id)
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
              <section className="border border-[#D4D4D8] bg-white rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[#E4E4E7] bg-[#FAFAF9] px-4 py-3">
                  <UserCheck size={15} className="text-[#B8983C]" />
                  <h2 className="text-sm font-bold text-[#18181B]">Today&apos;s Check-In</h2>
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
              </section>
            )

            const calendarPanel = (
              <section className="border border-[#D4D4D8] bg-white rounded-xl overflow-hidden">
                <div className="border-b border-[#E4E4E7] bg-[#FAFAF9] px-4 py-2.5">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-[#18181B]">
                    <CalendarDays size={15} className="text-[#B8983C]" />
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
                  onViewLeave={openLeaveApp}
                  onChanged={bumpRefresh}
                />
              </section>
            )

            if (isManager || isTeacher) {
              const viewerRole = isCoordinator ? 'coordinator' : isTeacher ? 'teacher' : isPrincipal ? 'principal' : 'admin'
              const canEdit = isAdmin || isPrincipal
              return (
                <div className="grid gap-4 lg:gap-5 lg:grid-cols-[clamp(300px,38%,400px)_minmax(0,480px)] lg:items-stretch lg:max-w-[920px] lg:mx-auto">
                  <div className="flex flex-col gap-4 lg:gap-5">
                    {checkInPanel}
                    {calendarPanel}
                  </div>
                  <AllStaffAttendanceReport
                    viewerId={user.id}
                    viewerRole={viewerRole}
                    fixedStaff={(isCoordinator || isTeacher) ? scopeStaff : undefined}
                    canEdit={canEdit}
                    refreshKey={refreshKey}
                    onChanged={bumpRefresh}
                  />
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
    </ProtectedLayout>
  )
}
