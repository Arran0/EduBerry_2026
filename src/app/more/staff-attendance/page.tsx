'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { UserCheck, Users } from 'lucide-react'
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
  const [exempt, setExempt] = useState(false)
  const [scopeStaff, setScopeStaff] = useState<UserProfile[]>([])
  const [viewingUserId, setViewingUserId] = useState<string>('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!user) return
    setViewingUserId(user.id)
    fetchGeofenceConfig().then(cfg => setGeofenceConfig(cfg))
    fetchAttendanceConfig().then(cfg => setLateCutoff(cfg.late_cutoff))
    fetchMyExemption(user.id).then(setExempt)
  }, [user])

  // Scope: coordinator → team teachers; admin/principal → all non-student staff.
  const loadScope = useCallback(async () => {
    if (!user || !profile || !isManager) return
    const list = isCoordinator
      ? await fetchTeamMembers(user.id, 'coordinator')
      : await fetchAllStaff()
    setScopeStaff(list)
  }, [user, profile, isManager, isCoordinator])

  useEffect(() => { loadScope() }, [loadScope])

  const bumpRefresh = () => setRefreshKey(k => k + 1)

  // Deep-links into the Staff Leave page
  const openNewLeave = (date: string) => router.push(`/more/staff-leave?new=1&date=${date}`)
  const openLeaveApp = (app: LeaveApplicationWithDetails) => router.push(`/more/staff-leave?app=${app.id}`)

  if (!user || !profile) return null

  // Members available in the calendar toggle (everyone in scope except me).
  const selectorMembers = scopeStaff.filter(s => s.id !== user.id)
  const viewingSelf = viewingUserId === user.id
  const viewingStaff = selectorMembers.find(s => s.id === viewingUserId)

  return (
    <ProtectedLayout staffOnly>
      <PageBanner
        settingKey="staff_attendance_banner"
        defaultBanner={STAFF_ATTENDANCE_BANNER_DEFAULT}
        icon={<UserCheck size={24} className="text-white" />}
        backgroundIcon={<UserCheck size={180} className="text-white" />}
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
            lateCutoff={lateCutoff}
            exempt={exempt}
            onCheckedIn={bumpRefresh}
          />
        </div>

        {/* Attendance Calendar (with a user toggle for managers) */}
        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-semibold text-slate-800 text-sm">Attendance Calendar</h2>
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
            onApplyLeave={viewingSelf ? openNewLeave : undefined}
            onViewLeave={openLeaveApp}
            onChanged={bumpRefresh}
          />
        </div>

        {/* Team / All-staff summary — managers only */}
        {isManager && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="font-semibold text-slate-800 text-sm mb-1 flex items-center gap-2">
              <Users size={15} className="text-violet-500" />
              {isCoordinator ? 'My Team Attendance' : 'All Staff Attendance'}
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Present count for today. {isCoordinator ? 'You can adjust a teacher’s status below.' : 'You can adjust any staff member’s status below.'}
            </p>
            <AdminAttendancePanel
              viewerId={user.id}
              viewerRole={isCoordinator ? 'coordinator' : isPrincipal ? 'principal' : 'admin'}
              staff={scopeStaff}
              refreshKey={refreshKey}
              onChanged={bumpRefresh}
            />
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
