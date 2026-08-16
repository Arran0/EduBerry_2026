'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
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
    <div
      className="relative overflow-hidden rounded-[1.6rem] bg-white border border-[#E4E4E7]"
      style={{ boxShadow: '0 1px 1px rgba(24,24,27,0.04), 0 18px 44px -18px rgba(24,24,27,0.18)' }}
    >
      <div className="flex flex-col lg:flex-row lg:items-stretch">
        <div
          className="lg:w-[300px] xl:w-[340px] flex-shrink-0 min-h-[168px] animate-pulse"
          style={{ background: 'linear-gradient(150deg, var(--page-gradient-from, #27272A) 0%, var(--page-gradient-to, #3D3B40) 100%)' }}
        />
        <div className="flex-1 p-5 sm:p-6 lg:px-7 flex flex-col justify-center gap-3">
          <div className="h-5 w-40 bg-[#F5F5F5] rounded-lg animate-pulse" />
          <div className="h-16 bg-[#F5F5F5] rounded-xl animate-pulse" />
          <div className="h-11 w-full sm:w-64 bg-[#F5F5F5] rounded-xl animate-pulse" />
        </div>
      </div>
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
import { fetchMyTeamRosters, mergeTeamRosters } from '@/lib/teams'
import type { TeamRoster } from '@/lib/teams'
import {
  fetchGeofenceConfig,
  fetchAttendanceConfig,
  fetchMyExemption,
  fetchEffectiveCutoffsForStaff,
  fetchServerTime,
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
  const [teamRosters, setTeamRosters] = useState<TeamRoster[]>([])
  const [viewingUserId, setViewingUserId] = useState<string>('')
  const [viewingStaffName, setViewingStaffName] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [bannerEditing, setBannerEditing] = useState(false)
  const [applyLeaveDate, setApplyLeaveDate] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    setViewingUserId(user.id)
    fetchGeofenceConfig().then(cfg => setGeofenceConfig(cfg))
    fetchMyExemption(user.id).then(setExempt)

    // Server-clock date, not the device's — otherwise a wrong/tampered device
    // date could pull the wrong day's cutoff override.
    fetchServerTime().then(async (serverNow) => {
      const today = serverNow.toISOString().split('T')[0]
      const [cfg, override] = await Promise.all([
        fetchAttendanceConfig(),
        fetchEffectiveCutoffsForStaff(today, user.id),
      ])
      // A per-date (or per-team) admin override, if set for today, wins over
      // the school-wide late/checkout cutoffs. DB "TIME" values come back as
      // "HH:MM:SS" — trim to "HH:MM" to match the site-settings format.
      const late = override?.late_cutoff ?? cfg.late_cutoff
      const checkout = override?.checkout_cutoff ?? cfg.checkout_cutoff
      setLateCutoff(late ? late.slice(0, 5) : null)
      setCheckoutCutoff(checkout ? checkout.slice(0, 5) : null)
    })
  }, [user])

  const loadScope = useCallback(async () => {
    if (!user || !profile) return
    if (!isCoordinator && !isTeacher) return
    // Every team the viewer belongs to — the teams they coordinate as well as
    // the ones they are a plain member of. Sitting on several teams gives one
    // aggregated roster (each teammate once), with the individual teams kept so
    // the report can drill into a single one.
    const rosters = await fetchMyTeamRosters(user.id)
    // A coordinator can own a team without being listed as one of its members —
    // add them so they show up in that team's roster either way.
    const withSelf = rosters.map(t => (
      t.members.some(m => m.id === user.id)
        ? t
        : { ...t, members: [profile as UserProfile, ...t.members] }
    ))
    setTeamRosters(withSelf)
    const merged = mergeTeamRosters(withSelf)
    // Include the viewer themselves so they appear in their own roster.
    setScopeStaff([profile as UserProfile, ...merged.filter(m => m.id !== user.id)])
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
          icon={<UserCheck size={28} className="text-white" />}
          backgroundIcon={<UserCheck size={180} className="text-white" />}
          eyebrow="Check in · Track · Review"
          title="Staff Attendance"
          elevated
          isAdmin={isAdmin}
          maxWidth={MAX_W}
          onEditingChange={setBannerEditing}
        />

        <div
          className={`${MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 transition-all duration-200 ${
            bannerEditing ? 'opacity-30 blur-[1px] pointer-events-none select-none' : ''
          }`}
          aria-hidden={bannerEditing}
        >
          {/* Row 1: the full-width "Today" check-in hero. Row 2: calendar beside
              the manager report on desktop; everything stacks on phones. */}
          {(() => {
            const viewPicker = isCoordinator && coordinatorOptions.length > 1 ? (
              <SmartSelect
                options={coordinatorOptions}
                value={viewingUserId || user.id}
                onChange={(v) => handleViewSelect(v, coordinatorOptions.find(o => o.value === v)?.label)}
                placeholder="View staff…"
                searchPlaceholder="Search team…"
                className="w-36 sm:w-44 flex-shrink-0"
                buttonClassName="!py-1 !px-2 !text-xs !rounded-lg"
                align="right"
                leadingIcon={viewingSelf
                  ? <User size={11} className="text-[#71717A] flex-shrink-0" />
                  : <Eye size={11} className="text-[#B8983C] flex-shrink-0" />}
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
                className="w-36 sm:w-44 flex-shrink-0"
                buttonClassName="!py-1 !px-2 !text-xs !rounded-lg"
                align="right"
                leadingIcon={viewingSelf
                  ? <User size={11} className="text-[#71717A] flex-shrink-0" />
                  : <Eye size={11} className="text-[#B8983C] flex-shrink-0" />}
              />
            ) : null

            const checkInPanel = (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <StaffCheckIn
                  staffId={user.id}
                  geofenceConfig={geofenceConfig}
                  lateCutoff={lateCutoff}
                  checkoutCutoff={checkoutCutoff}
                  exempt={exempt}
                  onCheckedIn={bumpRefresh}
                />
              </motion.div>
            )

            // `fill` stretches the calendar to share the manager row's height with
            // the report (so both stay equal while the report shows ~10 staff).
            const makeCalendarPanel = (fill: boolean) => (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut', delay: 0.08 }}
                className={`border border-[#D4D4D8] bg-white rounded-xl overflow-hidden${fill ? ' lg:flex-1 lg:min-h-0 lg:flex lg:flex-col' : ''}`}
              >
                <div
                  className="border-b border-black/10 px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2"
                  style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}
                >
                  <h2 className="flex items-center gap-2 text-sm font-bold text-white min-w-0">
                    <CalendarDays size={15} className="flex-shrink-0" style={{ color: 'var(--page-accent)' }} />
                    <span className="truncate">Calendar</span>
                  </h2>
                  {viewPicker}
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
                  fill={fill}
                />
              </motion.section>
            )

            if (isManager || isTeacher) {
              const viewerRole = isCoordinator ? 'coordinator' : isTeacher ? 'teacher' : isPrincipal ? 'principal' : 'admin'
              const canEdit = isAdmin || isPrincipal
              return (
                <div className="space-y-4 lg:space-y-5">
                  {checkInPanel}
                  {/* Both columns share a fixed desktop height so they stay equal
                      and the report scrolls internally while showing ~10 staff at
                      once. (A min-height alone lets the report expand to its full
                      list and drag the calendar taller to match.) */}
                  <div className="grid gap-4 lg:gap-5 lg:items-stretch lg:grid-cols-[clamp(320px,38%,460px)_minmax(0,1fr)]">
                    <div className="flex flex-col gap-4 lg:gap-5 lg:h-[680px]">
                      {makeCalendarPanel(true)}
                    </div>
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, ease: 'easeOut', delay: 0.15 }}
                      className="lg:h-[680px] lg:min-h-0"
                    >
                      <AllStaffAttendanceReport
                        viewerId={user.id}
                        viewerRole={viewerRole}
                        fixedStaff={(isCoordinator || isTeacher) ? scopeStaff : undefined}
                        fixedTeams={(isCoordinator || isTeacher) ? teamRosters : undefined}
                        canEdit={canEdit}
                        refreshKey={refreshKey}
                        onChanged={bumpRefresh}
                      />
                    </motion.div>
                  </div>
                </div>
              )
            }

            return (
              <div className="space-y-4 lg:space-y-5">
                {checkInPanel}
                <div className="max-w-2xl mx-auto">
                  {makeCalendarPanel(false)}
                </div>
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
