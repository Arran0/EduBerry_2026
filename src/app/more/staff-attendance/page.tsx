'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { UserCheck, Users } from 'lucide-react'
import { STAFF_ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import StaffCheckIn from '@/components/attendance/StaffCheckIn'
import StaffAttendanceCalendar from '@/components/attendance/StaffAttendanceCalendar'
import AdminAttendancePanel from '@/components/attendance/AdminAttendancePanel'
import {
  fetchGeofenceConfig,
  fetchAttendanceConfig,
  fetchMyExemption,
  GeofenceConfig,
} from '@/lib/attendance'
import { LeaveApplicationWithDetails } from '@/lib/leave'

export default function StaffAttendancePage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const isAdmin = profile?.role === 'admin'
  const isPrincipal = profile?.role === 'principal'
  const isCoordinator = profile?.role === 'coordinator'
  const hasScopeView = isAdmin || isPrincipal || isCoordinator

  const [geofenceConfig, setGeofenceConfig] = useState<GeofenceConfig | null>(null)
  const [lateCutoff, setLateCutoff] = useState<string | null>(null)
  const [exempt, setExempt] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!user) return
    fetchGeofenceConfig().then(cfg => setGeofenceConfig(cfg))
    fetchAttendanceConfig().then(cfg => setLateCutoff(cfg.late_cutoff))
    fetchMyExemption(user.id).then(setExempt)
  }, [user])

  const handleCheckedIn = () => setRefreshKey(k => k + 1)

  // Deep-links into the Staff Leave page
  const openNewLeave = (date: string) =>
    router.push(`/more/staff-leave?new=1&date=${date}`)
  const openLeaveApp = (app: LeaveApplicationWithDetails) =>
    router.push(`/more/staff-leave?app=${app.id}`)

  if (!user || !profile) return null

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
            onCheckedIn={handleCheckedIn}
          />
        </div>

        {/* Monthly History — own calendar */}
        <div>
          <h2 className="font-semibold text-slate-800 text-sm mb-3">My Attendance Calendar</h2>
          <p className="text-xs text-slate-400 mb-3">
            Tap any day to edit your status or apply for leave. Days with a leave application show a dot.
          </p>
          <StaffAttendanceCalendar
            staffId={user.id}
            mode="self"
            refreshKey={refreshKey}
            onApplyLeave={openNewLeave}
            onViewLeave={openLeaveApp}
            onChanged={handleCheckedIn}
          />
        </div>

        {/* Scope view — admin / principal (all staff) or coordinator (team) */}
        {hasScopeView && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="font-semibold text-slate-800 text-sm mb-1 flex items-center gap-2">
              <Users size={15} className="text-violet-500" />
              {isCoordinator ? 'My Team Attendance' : 'All Staff Attendance'}
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              {isCoordinator
                ? 'Tap a teacher in your team to view their monthly attendance calendar.'
                : 'Search and tap any staff member to view their monthly attendance calendar.'}
            </p>
            <AdminAttendancePanel
              viewerId={user.id}
              viewerRole={isCoordinator ? 'coordinator' : isPrincipal ? 'principal' : 'admin'}
              onViewLeave={openLeaveApp}
            />
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
