'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { UserCheck, Users, CalendarDays } from 'lucide-react'
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
  fetchAllStaff,
  GeofenceConfig,
} from '@/lib/attendance'
import { LeaveApplicationWithDetails } from '@/lib/leave'

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
    if (!user || !profile || !isManager) return
    const list = isCoordinator
      ? await fetchTeamMembers(user.id, 'coordinator')
      : await fetchAllStaff()
    setScopeStaff(list)
  }, [user, profile, isManager, isCoordinator])

  useEffect(() => { loadScope() }, [loadScope])

  const bumpRefresh = () => setRefreshKey(k => k + 1)

  const openNewLeave = (date: string) => router.push(`/more/staff-leave?new=1&date=${date}`)
  const openLeaveApp = (app: LeaveApplicationWithDetails) => router.push(`/more/staff-leave?app=${app.id}`)

  if (!user || !profile) return null

  const selectorMembers = scopeStaff.filter(s => s.id !== user.id)
  const viewingSelf = viewingUserId === user.id
  const viewingStaff = selectorMembers.find(s => s.id === viewingUserId)

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
            {selectorMembers.length > 0 && (
              <TeamMemberSelector
                members={selectorMembers}
                selectedUserId={viewingUserId || user.id}
                currentUserId={user.id}
                currentUserName={profile.full_name}
                selfLabel={profile.full_name}
                onSelect={setViewingUserId}
              />
            )}
          </div>
          <StaffAttendanceCalendar
            key={viewingUserId}
            staffId={viewingUserId || user.id}
            staffName={viewingSelf ? undefined : viewingStaff?.full_name}
            mode={viewingSelf ? 'self' : 'admin'}
            markerId={user.id}
            refreshKey={refreshKey}
            geofenceConfig={viewingSelf ? geofenceConfig : null}
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
