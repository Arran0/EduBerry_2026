'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { UserCheck, CalendarDays } from 'lucide-react'
import { STAFF_ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { useStaffLeaveNotifications } from '@/hooks/useLeaveNotifications'

const StaffCheckIn = dynamic(() => import('@/components/attendance/StaffCheckIn'), {
  loading: () => (
    <div className="lg-deck lg-panel">
      <div className="relative z-[3] px-4 pt-5 pb-4 sm:px-6 space-y-2.5">
        <div className="h-3 w-28 bg-white/60 rounded-full animate-pulse" />
        <div className="h-11 w-44 bg-white/60 rounded-xl animate-pulse" />
      </div>
      <div className="relative z-[3] lg-content mx-2 sm:mx-2.5 mb-2 sm:mb-2.5 p-4 sm:p-5 space-y-3">
        <div className="h-4 w-40 bg-[#F4F2EE] rounded-full animate-pulse" />
        <div className="h-14 bg-[#F4F2EE] rounded-2xl animate-pulse" />
      </div>
    </div>
  ),
})

const AllStaffAttendanceReport = dynamic(() => import('@/components/attendance/AllStaffAttendanceReport'), {
  loading: () => (
    <section className="lg-deck lg-panel flex flex-col h-full">
      <div className="relative z-[3] flex items-center gap-3 px-4 sm:px-5 pt-4 pb-3">
        <div className="w-10 h-10 rounded-[0.85rem] bg-white/60 animate-pulse" />
        <div className="h-5 w-24 bg-white/60 rounded-full animate-pulse" />
      </div>
      <div className="relative z-[3] lg-content mx-2 sm:mx-2.5 mb-2 sm:mb-2.5 p-4 space-y-2 flex-1">
        <div className="h-9 bg-[#F4F2EE] rounded-full animate-pulse" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 bg-[#F4F2EE] rounded-2xl animate-pulse" />
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45">
      <div className="spinner" />
    </div>
  ),
})

import { UserProfile } from '@/lib/supabase'
import { fetchMyTeamRosters, mergeTeamRosters } from '@/lib/teams'
import type { TeamRoster } from '@/lib/teams'
import {
  fetchEffectiveGeofenceForStaff,
  fetchAttendanceConfig,
  fetchMyExemption,
  fetchEffectiveCutoffsForStaff,
  fetchServerTime,
  fetchAttendanceTimezone,
  dateStringInZone,
  fetchOpenPunchRecords,
  ackForgottenCheckout,
  EffectiveGeofence,
  StaffAttendanceRecord,
} from '@/lib/attendance'
import { LeaveApplicationWithDetails, fetchApprovalQueueIds } from '@/lib/leave'
import {
  fetchUnreadDecisionItems,
  markNotificationRead,
  markNotificationsRead,
  type NotifItem,
} from '@/lib/leaveNotifications'
import ForgottenCheckoutModal from '@/components/attendance/ForgottenCheckoutModal'
import LeaveUpdatesModal from '@/components/attendance/LeaveUpdatesModal'
import ReviewQueueModal from '@/components/attendance/ReviewQueueModal'

const MAX_W = 'max-w-7xl'

export default function StaffAttendancePage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isPrincipal = profile?.role === 'principal'
  const isCoordinator = profile?.role === 'coordinator'
  const isTeacher = profile?.role === 'teacher'
  const viewerRole = isAdmin ? 'admin' : isPrincipal ? 'principal' : isCoordinator ? 'coordinator' : 'teacher'

  const [geofenceConfig, setGeofenceConfig] = useState<EffectiveGeofence | null>(null)
  const [lateCutoff, setLateCutoff] = useState<string | null>(null)
  const [exempt, setExempt] = useState(false)
  const [scopeStaff, setScopeStaff] = useState<UserProfile[]>([])
  const [teamRosters, setTeamRosters] = useState<TeamRoster[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [bannerEditing, setBannerEditing] = useState(false)
  // Non-null while the OD / Leave app is open in its popup. The fields say what
  // it should open on: a prefilled new application, or one existing one.
  const [leavePopup, setLeavePopup] =
    useState<{ newDate?: string | null; newEndDate?: string | null; appId?: string | null } | null>(null)

  const { count: leaveCount, refresh: refreshLeaveCount } = useStaffLeaveNotifications(user?.id ?? null)

  // Server-clock "today", also used to gate the forgotten-checkout lookup below.
  const [today, setToday] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    // Group zone centre point if this staff member is in one, otherwise the
    // school-wide centre — resolved server-side of the UI, not in the widget.
    fetchEffectiveGeofenceForStaff(user.id).then(cfg => setGeofenceConfig(cfg))
    fetchMyExemption(user.id).then(setExempt)

    // Server-clock date in the school's timezone, not the device's — otherwise a
    // wrong/tampered device date (or simply a device in another zone) could pull
    // the wrong day's cutoff override.
    Promise.all([fetchServerTime(), fetchAttendanceTimezone()]).then(async ([serverNow, tz]) => {
      const todayStr = dateStringInZone(serverNow, tz)
      setToday(todayStr)
      const [cfg, override] = await Promise.all([
        fetchAttendanceConfig(),
        fetchEffectiveCutoffsForStaff(todayStr, user.id),
      ])
      // A per-date (or per-team) admin override, if set for today, wins over
      // the school-wide late/checkout cutoffs. DB "TIME" values come back as
      // "HH:MM:SS" — trim to "HH:MM" to match the site-settings format.
      // Only the late cutoff is still needed client-side, for the "you'll be
      // marked Late" heads-up. The checkout cutoff is applied server-side when
      // the punch is written, so it is no longer fetched for the UI to apply.
      const late = override?.late_cutoff ?? cfg.late_cutoff
      setLateCutoff(late ? late.slice(0, 5) : null)
    })
  }, [user])

  // ── Attendance-app inbox: forgotten checkout, decisions, review queue ──────
  // At most one of the three shows at a time, in this priority order, and only
  // once per thing that's actually new. The checkout warning's read marker
  // lives on the row itself (see ackForgottenCheckout) so it follows the
  // staff member across devices; decisions use their own marker in
  // notificationDismissals.ts, shared with the Home page's decisions list.
  type InboxStep = 'checkout' | 'updates' | 'review'
  const [checkoutWarnings, setCheckoutWarnings] = useState<StaffAttendanceRecord[] | null>(null)
  const [updateItems, setUpdateItems] = useState<NotifItem[] | null>(null)
  const [reviewPendingIds, setReviewPendingIds] = useState<string[] | null>(null)
  const [dismissedSteps, setDismissedSteps] = useState<Set<InboxStep>>(new Set())

  useEffect(() => {
    if (!user || !today) return
    let cancelled = false
    Promise.all([
      fetchOpenPunchRecords(user.id, today),
      fetchUnreadDecisionItems(user.id, 'staff'),
      fetchApprovalQueueIds(user.id),
    ]).then(([openPunches, decisions, queue]) => {
      if (cancelled) return
      // Already filtered server-side against forgotten_checkout_ack_at, so a
      // case dismissed on any device stays dismissed here too.
      setCheckoutWarnings(openPunches)
      // Decisions the applicant hasn't seen yet — already filtered against
      // both read markers (the local one and the application's own view row)
      // by fetchUnreadDecisionItems, so one they've read never pops again.
      setUpdateItems(decisions)
      // Applications waiting on this reviewer are never filtered: pending
      // means unread, so the review queue opens on every visit until the
      // decisions are actually made.
      setReviewPendingIds(queue.pendingIds)
    })
    return () => { cancelled = true }
  }, [user, today])

  const inboxStep: InboxStep | null = useMemo(() => {
    if (checkoutWarnings === null || updateItems === null || reviewPendingIds === null) return null
    if (checkoutWarnings.length > 0 && !dismissedSteps.has('checkout')) return 'checkout'
    if (updateItems.length > 0 && !dismissedSteps.has('updates')) return 'updates'
    if (reviewPendingIds.length > 0 && !dismissedSteps.has('review')) return 'review'
    return null
  }, [checkoutWarnings, updateItems, reviewPendingIds, dismissedSteps])

  const closeInboxStep = (step: InboxStep) => setDismissedSteps(prev => new Set(prev).add(step))

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

  // Leave lives in a popup on this page rather than behind its own home-page
  // icon: applying for leave and checking in are the same errand.
  const openLeaveApp = (app: LeaveApplicationWithDetails) => setLeavePopup({ appId: app.id })

  // A decision made in the popup can change today's report row (and the badge),
  // so refresh both on the way out.
  const closeLeavePopup = () => {
    setLeavePopup(null)
    refreshLeaveCount()
    bumpRefresh()
  }

  if (!user || !profile) return null

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="staff-attendance">
        <PageBanner
          settingKey="staff_attendance_banner"
          defaultBanner={STAFF_ATTENDANCE_BANNER_DEFAULT}
          icon={<UserCheck size={28} className="text-white" />}
          backgroundIcon={<UserCheck size={180} className="text-white" />}
          eyebrow="Staff"
          title="Attendance"
          compactMobileTitle
          elevated
          isAdmin={isAdmin}
          maxWidth={MAX_W}
          onEditingChange={setBannerEditing}
          actions={
            <button
              onClick={() => setLeavePopup({})}
              title="Open Staff OD / Leave"
              // The same button as the Student Attendance app's Leave / OD.
              className="group relative flex items-center gap-2 sm:gap-2.5 pl-1.5 pr-3 sm:pr-4 py-1.5 rounded-full bg-white/95 hover:bg-white border border-white/70 shadow-[0_6px_20px_-6px_rgba(0,0,0,0.45)] hover:shadow-[0_10px_26px_-6px_rgba(0,0,0,0.5)] active:scale-95 transition-all"
            >
              <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-violet-500 to-purple-700 shadow-inner">
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
          {/* The app is two sections: the "Today" check-in hero, then the
              report. Both run the full width of the container; on phones the
              report also breaks out of the page gutter to use the whole screen. */}
          <div className="space-y-4 lg:space-y-5">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <StaffCheckIn
                staffId={user.id}
                geofenceConfig={geofenceConfig}
                lateCutoff={lateCutoff}
                exempt={exempt}
                onCheckedIn={bumpRefresh}
              />
            </motion.div>

            {/* A fixed, one-screen box: scrolled to, the report fills the
                screen under the navbar (and above the phone's bottom bar), and
                switching day, list or roster only changes what scrolls inside
                it — never its height. Its list hands the scroll back to the
                page at either end. -mx-2 claws back most of the phone gutter
                while keeping the glass sheet's rounded edge in view. */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut', delay: 0.08 }}
              className="-mx-2 sm:mx-0 h-[calc(100dvh-8.5rem)] md:h-[calc(100dvh-5.5rem)] min-h-[26rem]"
            >
              <AllStaffAttendanceReport
                viewerId={user.id}
                viewerRole={viewerRole}
                fixedStaff={(isCoordinator || isTeacher) ? scopeStaff : undefined}
                fixedTeams={(isCoordinator || isTeacher) ? teamRosters : undefined}
                canEdit={isAdmin || isPrincipal}
                refreshKey={refreshKey}
                onChanged={bumpRefresh}
                onViewLeave={openLeaveApp}
              />
            </motion.div>
          </div>
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

      {/* Attendance-app inbox — at most one of these at a time (see inboxStep) */}
      {inboxStep === 'checkout' && checkoutWarnings && (
        <ForgottenCheckoutModal
          records={checkoutWarnings}
          onClose={() => {
            ackForgottenCheckout(checkoutWarnings.map(r => r.id))
            closeInboxStep('checkout')
          }}
        />
      )}
      {inboxStep === 'updates' && updateItems && (
        <LeaveUpdatesModal
          items={updateItems}
          currentUserId={user.id}
          currentUserRole={viewerRole}
          // Closing marks every decision listed here as read — on the
          // notification and on the application itself — the same "you've now
          // seen these" contract the forgotten-checkout warning has.
          onClose={() => {
            markNotificationsRead(user.id, updateItems)
            refreshLeaveCount()
            closeInboxStep('updates')
          }}
          onRead={item => {
            markNotificationRead(user.id, item)
            refreshLeaveCount()
            const rest = updateItems.filter(i => i.id !== item.id)
            setUpdateItems(rest)
            // Clearing the last one leaves nothing to show — close rather than
            // sit on an empty list.
            if (rest.length === 0) closeInboxStep('updates')
          }}
        />
      )}
      {inboxStep === 'review' && reviewPendingIds && (
        <ReviewQueueModal
          pendingIds={reviewPendingIds}
          currentUserId={user.id}
          currentUserRole={viewerRole}
          onClose={() => closeInboxStep('review')}
          onDecided={() => { refreshLeaveCount(); bumpRefresh() }}
        />
      )}
    </ProtectedLayout>
  )
}
