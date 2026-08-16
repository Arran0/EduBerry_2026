'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { UserCheck, CalendarDays, User, Eye } from 'lucide-react'
import { STAFF_ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { useStaffLeaveNotifications } from '@/hooks/useLeaveNotifications'

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
// The whole Staff OD / Leave app, hosted here in a popup. Loaded on demand —
// its lists and form are dead weight until someone opens it.
const StaffLeaveModal = dynamic(() => import('@/components/leave/StaffLeaveModal'), {
  ssr: false,
  // Covers the gap while the chunk arrives, so the button feels like it fired.
  loading: () => (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 backdrop-blur-md">
      <div className="spinner" />
    </div>
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
  fetchEffectiveCutoffsForStaff,
  fetchServerTime,
  searchStaff,
  GeofenceConfig,
} from '@/lib/attendance'
import { LeaveApplicationWithDetails } from '@/lib/leave'

const MAX_W = 'max-w-7xl'

export default function StaffAttendancePage() {
  const { user, profile } = useAuth()
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
  // Non-null while the OD / Leave app is open in its popup. The fields say what
  // it should open on: a prefilled new application, or one existing one.
  const [leavePopup, setLeavePopup] =
    useState<{ newDate?: string | null; newEndDate?: string | null; appId?: string | null } | null>(null)

  const { count: leaveCount, refresh: refreshLeaveCount } = useStaffLeaveNotifications(user?.id ?? null)

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
    if (isCoordinator) {
      const list = await fetchTeamMembers(user.id, 'coordinator')
      // Include the coordinator themselves so they appear in their team's roster
      const withSelf = profile ? [profile as UserProfile, ...list.filter(m => m.id !== user.id)] : list
      setScopeStaff(withSelf)
    } else if (isTeacher) {
      const list = await fetchTeamMembers(user.id, 'teacher')
      // Include the teacher themselves so they appear in their team's roster
      const withSelf = profile ? [profile as UserProfile, ...list.filter(m => m.id !== user.id)] : list
      setScopeStaff(withSelf)
    }
  }, [user, profile, isCoordinator, isTeacher])

  useEffect(() => { loadScope() }, [loadScope])

  const bumpRefresh = () => setRefreshKey(k => k + 1)

  // Leave lives in a popup on this page rather than behind its own home-page
  // icon: applying for leave and checking in are the same errand.
  const openNewLeave = (startDate: string, endDate: string) =>
    setLeavePopup({ newDate: startDate, newEndDate: endDate })
  const openLeaveApp = (app: LeaveApplicationWithDetails) => setLeavePopup({ appId: app.id })

  // A decision made in the popup can change today's calendar (and the badge),
  // so refresh both on the way out.
  const closeLeavePopup = () => {
    setLeavePopup(null)
    refreshLeaveCount()
    bumpRefresh()
  }

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
          actions={
            <button
              onClick={() => setLeavePopup({})}
              title="Open Staff OD / Leave"
              className="group relative flex items-center gap-2 sm:gap-2.5 pl-1.5 pr-3 sm:pr-4 py-1.5 rounded-full bg-white/95 hover:bg-white border border-white/70 shadow-[0_6px_20px_-6px_rgba(0,0,0,0.45)] hover:shadow-[0_10px_26px_-6px_rgba(0,0,0,0.5)] active:scale-95 transition-all"
            >
              <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-violet-500 to-indigo-600 shadow-inner">
                <CalendarDays size={16} className="text-white" />
              </span>
              <span className="flex flex-col items-start leading-none">
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Open</span>
                <span className="text-[13px] sm:text-sm font-bold text-slate-900 whitespace-nowrap mt-0.5">Leave / OD</span>
              </span>
              {leaveCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[19px] h-[19px] px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold ring-2 ring-white shadow-sm">
                  {leaveCount > 9 ? '9+' : leaveCount}
                </span>
              )}
            </button>
          }
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
                        canEdit={canEdit}
                        refreshKey={refreshKey}
                        onChanged={bumpRefresh}
                        onViewLeave={openLeaveApp}
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

      {/* Staff OD / Leave, hosted here instead of on its own screen */}
      <AnimatePresence>
        {leavePopup && (
          <StaffLeaveModal
            initialNewDate={leavePopup.newDate ?? null}
            initialNewEndDate={leavePopup.newEndDate ?? null}
            initialAppId={leavePopup.appId ?? null}
            onClose={closeLeavePopup}
          />
        )}
      </AnimatePresence>
    </ProtectedLayout>
  )
}
