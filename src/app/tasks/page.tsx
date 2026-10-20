'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Task Manager.
//
// Laid out like the transport, fee, salary and timetable workspaces: the
// banner, one capsule switch overlapping its foot, and the four places under
// it — the week, my analytics, the team's, and projects. The tab lives in the
// URL so a link or a bookmark lands on the right one.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, BarChart3, Users, FolderKanban, ClipboardList, Home } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { GlassSegments } from '@/components/transport/glass'
import { useAuth } from '@/contexts/AuthContext'
import { canViewTeamAnalytics, UserProfile } from '@/lib/supabase'
import { fetchTeamMembers } from '@/lib/tasks'
import { useTaskNotifications } from '@/hooks/useTaskNotifications'
import { fetchActiveProjectCount } from '@/lib/projects'
import { TASK_BANNER_DEFAULT } from '@/lib/pageConfig'
import { getShowTaskCalendarOnHome, setShowTaskCalendarOnHome } from '@/lib/homeTaskCalendarVisibility'
import { prefetchTeamAnalytics } from '@/lib/teamAnalyticsCache'
import WeeklyCalendar from '@/components/tasks/WeeklyCalendar'
import { Loading, SHELL } from '@/components/tasks/ui'

// Only the week renders on load, so every other tab is split out of the first
// bundle. The Team tab's prefetch helper comes from its own module so the
// switch can warm the cache without pulling the component's code in first.
const VerificationAlerts = dynamic(() => import('@/components/tasks/VerificationAlerts'))
const TaskAnalytics = dynamic(() => import('@/components/tasks/TaskAnalytics'), { loading: () => <Loading /> })
const ProjectsList  = dynamic(() => import('@/components/tasks/ProjectsList'), { loading: () => <Loading /> })
const TeamAnalytics = dynamic(() => import('@/components/tasks/TeamAnalytics'), { loading: () => <Loading /> })

type TabId = 'weekly' | 'analytics' | 'team' | 'projects'
const TAB_IDS: TabId[] = ['weekly', 'analytics', 'team', 'projects']

/** Solid white on the banner: a translucent control over a photo cannot be read. */
const BANNER_BTN =
  'inline-flex items-center justify-center gap-1.5 h-[30px] px-3 rounded-full text-[12px] font-semibold ring-1 ring-black/5 shadow-[0_6px_16px_-8px_rgba(15,23,42,.55)] active:scale-[0.97] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]'

export default function TasksPage() {
  return (
    <ProtectedLayout staffOnly>
      {/* useSearchParams needs a Suspense boundary to stay out of the
          static-render bailout. */}
      <Suspense fallback={<Loading />}>
        <TasksPageContent />
      </Suspense>
    </ProtectedLayout>
  )
}

function TasksPageContent() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [teamMembers, setTeamMembers] = useState<UserProfile[]>([])
  const [viewingUserId, setViewingUserId] = useState('')
  const [activeProjectCount, setActiveProjectCount] = useState(0)
  const [bannerEditing, setBannerEditing] = useState(false)
  // Jumping to an assignee's calendar at a task, from "Waiting for you to verify".
  const [focusRequest, setFocusRequest] = useState<{ date: string | null; taskId: string; nonce: number } | null>(null)
  const [verificationRefresh, setVerificationRefresh] = useState(0)
  const calendarWrapRef = useRef<HTMLDivElement>(null)

  const role = profile?.role
  const showTeamAnalytics = role ? canViewTeamAnalytics(role) : false
  const canAssignToOthers = role ? ['coordinator', 'principal', 'admin'].includes(role) : false
  const canCheck = canAssignToOthers
  const isAdmin = role === 'admin'

  const tabParam = searchParams.get('tab') as TabId | null
  const activeTab: TabId = tabParam && TAB_IDS.includes(tabParam) && !(tabParam === 'team' && !showTeamAnalytics)
    ? tabParam
    : 'weekly'

  const goTab = useCallback((next: TabId) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'weekly') params.delete('tab')
    else params.set('tab', next)
    if (next !== 'weekly') setFocusRequest(null)
    const qs = params.toString()
    router.replace(qs ? `/tasks?${qs}` : '/tasks', { scroll: false })
  }, [router, searchParams])

  const { markAllRead } = useTaskNotifications(user?.id ?? null)
  useEffect(() => { markAllRead() }, [markAllRead])

  // Admin only: the home page's task calendar card is hidden by default; this
  // opts back in (mirrors the Classrooms-on-home toggle).
  const [showOnHome, setShowOnHome] = useState(false)
  useEffect(() => { if (user) setShowOnHome(getShowTaskCalendarOnHome(user.id)) }, [user])
  const toggleShowOnHome = () => {
    if (!user) return
    const next = !showOnHome
    setShowOnHome(next)
    setShowTaskCalendarOnHome(user.id, next)
  }

  // The team list and the project badge don't depend on each other, so they
  // load side by side.
  useEffect(() => {
    if (!user || !role) return
    let cancelled = false
    if (canAssignToOthers || role === 'teacher') {
      fetchTeamMembers(user.id, role).then(m => { if (!cancelled) setTeamMembers(m) })
    }
    // The badge and the Projects tab's Active/Closed split both derive from
    // getProjectStatus, so the badge can't disagree with the list under it.
    fetchActiveProjectCount(user.id, role).then(n => { if (!cancelled) setActiveProjectCount(n) })
    return () => { cancelled = true }
  }, [user, role, canAssignToOthers])

  const urlUserId = searchParams.get('user')
  const urlDate = searchParams.get('date')
  useEffect(() => {
    if (!user) return
    setViewingUserId(urlUserId && canAssignToOthers && urlUserId !== user.id ? urlUserId : user.id)
  }, [user, urlUserId, canAssignToOthers])

  // A stable array: WeeklyCalendar and ProjectsList key effects off it.
  const allAssignees = useMemo<UserProfile[]>(() => (profile ? [profile, ...teamMembers] : []), [profile, teamMembers])

  const tabs = useMemo(() => [
    { key: 'weekly' as const, label: 'Week', icon: CalendarDays },
    { key: 'analytics' as const, label: 'Analytics', icon: BarChart3 },
    ...(showTeamAnalytics ? [{ key: 'team' as const, label: 'Team', icon: Users }] : []),
    { key: 'projects' as const, label: 'Projects', icon: FolderKanban, count: activeProjectCount > 0 ? activeProjectCount : null },
  ], [showTeamAnalytics, activeProjectCount])

  if (!user || !profile) return null

  const handleNavigateToVerification = (assigneeId: string, dueDate: string | null, taskId: string) => {
    goTab('weekly')
    setViewingUserId(assigneeId)
    setFocusRequest({ date: dueDate, taskId, nonce: Date.now() })
    setTimeout(() => calendarWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }

  const handleViewingUserChange = (uid: string) => {
    setFocusRequest(null)
    setViewingUserId(uid)
  }

  const viewingOther = viewingUserId && viewingUserId !== user.id ? viewingUserId : undefined
  const teamForPicker = canAssignToOthers && teamMembers.length > 0 ? teamMembers : undefined

  return (
    <div data-page-theme="tasks" className="overflow-x-clip" style={{ minHeight: '100vh' }}>
      <PageBanner
        settingKey="task_banner"
        defaultBanner={TASK_BANNER_DEFAULT}
        icon={<ClipboardList size={26} className="text-white" />}
        backgroundIcon={<ClipboardList size={150} className="text-white" />}
        title="Task Manager"
        subtitle="Your week, your team's progress and shared projects"
        isAdmin={isAdmin}
        maxWidth="max-w-7xl 2xl:max-w-[1600px]"
        onEditingChange={setBannerEditing}
        actions={isAdmin ? (
          <button
            onClick={toggleShowOnHome}
            aria-pressed={showOnHome}
            title={showOnHome ? 'The task calendar shows on the home page' : 'The task calendar is hidden from the home page'}
            className={`${BANNER_BTN} ${showOnHome ? 'bg-[#27272A] text-white hover:bg-[#3D3B40]' : 'bg-white text-slate-900 hover:bg-slate-50'}`}
          >
            <Home size={13} className={showOnHome ? 'text-[#E9DDBB]' : 'text-[#B45309]'} />
            <span className="hidden sm:inline">{showOnHome ? 'On home page' : 'Show on home page'}</span>
          </button>
        ) : undefined}
      />

      <div className={`${SHELL} px-4 sm:px-6 lg:px-8 pb-14`}>
        {/* Everything but the banner fades while the banner is being edited. */}
        <div
          aria-hidden={bannerEditing}
          style={{
            opacity: bannerEditing ? 0.35 : 1,
            pointerEvents: bannerEditing ? 'none' : 'auto',
            userSelect: bannerEditing ? 'none' : 'auto',
            transition: 'opacity 0.25s ease',
          }}
        >
          {/* The switch overlaps the banner. Solid, not glass: through a
              translucent control the banner photo shows as noise. */}
          <div
            className="relative z-10 -mt-6 sm:-mt-7 mb-4 sm:mb-5 flex justify-center sm:justify-start"
            onPointerEnter={showTeamAnalytics ? () => prefetchTeamAnalytics(user.id, profile.role) : undefined}
          >
            <GlassSegments
              layoutId="tasks-hub-tab"
              items={tabs}
              value={activeTab}
              onChange={goTab}
              stretch
              className="!bg-white ring-1 ring-black/[.06] shadow-[0_14px_30px_-12px_rgba(15,23,42,.55)]"
            />
          </div>

          {activeTab === 'weekly' && (
            <div className="space-y-4 sm:space-y-5">
              {canCheck && (
                <VerificationAlerts
                  userId={user.id}
                  refreshKey={verificationRefresh}
                  onNavigate={handleNavigateToVerification}
                />
              )}
              <div ref={calendarWrapRef} className="scroll-mt-4">
                <WeeklyCalendar
                  key={viewingUserId}
                  userId={user.id}
                  profile={profile}
                  canCheck={canCheck}
                  canAssignToOthers={canAssignToOthers}
                  availableAssignees={allAssignees}
                  viewingUserId={viewingOther}
                  initialDate={focusRequest?.date || urlDate || undefined}
                  focusTaskId={focusRequest?.taskId}
                  focusNonce={focusRequest?.nonce}
                  teamMembers={teamForPicker}
                  currentUserId={user.id}
                  currentUserName={profile.full_name}
                  onViewingUserChange={handleViewingUserChange}
                  onTaskActivity={() => setVerificationRefresh(v => v + 1)}
                />
              </div>
            </div>
          )}
          {activeTab === 'analytics' && (
            <TaskAnalytics
              userId={user.id}
              viewingUserId={viewingOther}
              teamMembers={teamForPicker}
              currentUserId={user.id}
              currentUserName={profile.full_name}
              onViewingUserChange={setViewingUserId}
            />
          )}
          {activeTab === 'team' && showTeamAnalytics && (
            <TeamAnalytics userId={user.id} userRole={profile.role} isTeacher={profile.role === 'teacher'} />
          )}
          {activeTab === 'projects' && (
            <ProjectsList
              userId={user.id}
              userRole={profile.role}
              canEdit={canAssignToOthers}
              canCheck={canCheck}
              availableAssignees={allAssignees}
            />
          )}
        </div>
      </div>
    </div>
  )
}
