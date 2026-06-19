'use client'

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { canViewTeamAnalytics, UserProfile } from '@/lib/supabase'
import { fetchTeamMembers } from '@/lib/tasks'
import { useTaskNotifications } from '@/hooks/useTaskNotifications'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CalendarDays,
  BarChart3,
  Users,
  FolderKanban,
  ClipboardList,
  Pencil,
  Check,
  X,
  Image as ImageIcon,
} from 'lucide-react'
import { usePageConfig } from '@/contexts/PageConfigContext'
import dynamic from 'next/dynamic'
import WeeklyCalendar from '@/components/tasks/WeeklyCalendar'
import VerificationAlerts from '@/components/tasks/VerificationAlerts'
import TeamAnalytics, { prefetchTeamAnalytics } from '@/components/tasks/TeamAnalytics'
const TaskAnalytics = dynamic(() => import('@/components/tasks/TaskAnalytics'))
const ProjectsList  = dynamic(() => import('@/components/tasks/ProjectsList'))
import { fetchProjectsForUser } from '@/lib/projects'
import {
  AnnouncementBannerConfig,
  TASK_BANNER_DEFAULT,
  BANNER_PRESETS,
  fetchTaskBannerConfig,
  saveTaskBannerConfig,
  uploadSiteAsset,
} from '@/lib/pageConfig'
import { hexToLuminance, sampleImageLuminance } from '@/lib/luminance'

// ── Tab definitions ───────────────────────────────────────────────────────────

type TabId = 'weekly' | 'analytics' | 'team' | 'projects'

interface Tab { id: TabId; label: string }

const TAB_META: Record<TabId, { icon: React.ReactNode; color: string; bg: string }> = {
  weekly:    { icon: <CalendarDays size={15} />, color: 'text-amber-600',  bg: 'bg-amber-50'   },
  analytics: { icon: <BarChart3 size={15} />,    color: 'text-blue-600',   bg: 'bg-blue-50'    },
  team:      { icon: <Users size={15} />,        color: 'text-green-600',  bg: 'bg-green-50'   },
  projects:  { icon: <FolderKanban size={15} />, color: 'text-purple-600', bg: 'bg-purple-50'  },
}

const tabs: Tab[] = [
  { id: 'weekly',    label: 'Weekly'    },
  { id: 'analytics', label: 'Analytics' },
  { id: 'team',      label: 'Team'      },
  { id: 'projects',  label: 'Projects'  },
]

// ── Main content (needs Suspense for useSearchParams) ─────────────────────────

function TasksPageContent() {
  const { user, profile } = useAuth()
  const { pageIcons: pageConfig } = usePageConfig()
  const searchParams = useSearchParams()

  const [activeTab,          setActiveTab]          = useState<TabId>('weekly')
  const [teamMembers,        setTeamMembers]        = useState<UserProfile[]>([])
  const [viewingUserId,      setViewingUserId]      = useState<string>('')
  const [activeProjectCount, setActiveProjectCount] = useState(0)
  // Drives jumping to an assignee's calendar and pointing at a specific task
  // from the "Awaiting Your Verification" buttons above the weekly calendar.
  const [focusRequest, setFocusRequest] = useState<{ date: string | null; taskId: string; nonce: number } | null>(null)
  const [verificationRefresh, setVerificationRefresh] = useState(0)
  const calendarWrapRef = useRef<HTMLDivElement>(null)

  // Banner config state
  const [bannerCfg,     setBannerCfg]     = useState<AnnouncementBannerConfig>(TASK_BANNER_DEFAULT)
  const [pendingCfg,    setPendingCfg]    = useState<AnnouncementBannerConfig>(TASK_BANNER_DEFAULT)
  const [editingBanner, setEditingBanner] = useState(false)
  const [savingBanner,  setSavingBanner]  = useState(false)
  const [uploadingImg,  setUploadingImg]  = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [bannerLum, setBannerLum] = useState(0)
  const [bannerLoaded, setBannerLoaded] = useState(false)

  const showTeamAnalytics  = profile ? canViewTeamAnalytics(profile.role) : false
  const canAssignToOthers  = profile ? ['coordinator', 'principal', 'admin'].includes(profile.role) : false
  const canCheck           = profile ? ['coordinator', 'principal', 'admin'].includes(profile.role) : false
  const isAdmin            = profile?.role === 'admin'

  const { markAllRead } = useTaskNotifications(user?.id ?? null)
  useEffect(() => { markAllRead() }, [markAllRead])

  const visibleTabs = tabs.filter(tab => !(tab.id === 'team' && !showTeamAnalytics))

  // ── Load team members ──

  const loadTeamMembers = useCallback(async () => {
    if (!user || !profile) return
    if (!canAssignToOthers && profile.role !== 'teacher') return
    const members = await fetchTeamMembers(user.id, profile.role)
    setTeamMembers(members)
  }, [user, profile, canAssignToOthers])

  useEffect(() => { loadTeamMembers() }, [loadTeamMembers])

  // ── Load active project count for badge ──

  useEffect(() => {
    if (!user || !profile) return
    fetchProjectsForUser(user.id, profile.role).then(projects => {
      const todayStr = new Date().toISOString().split('T')[0]
      const count = projects.filter(p => {
        const total = p.subtasks.length
        if (total === 0) return true
        const checked = p.subtasks.filter(s => s.status === 'checked').length
        if (checked === total) return false
        const done = p.subtasks.filter(s => s.status === 'done' || s.status === 'checked').length
        const isPastDue = !!p.end_date && p.end_date < todayStr
        const isCompletedAfterDue = done === total && isPastDue
        return !isCompletedAfterDue
      }).length
      setActiveProjectCount(count)
    })
  }, [user, profile])

  // ── Load banner config ──

  useEffect(() => {
    fetchTaskBannerConfig().then(cfg => {
      setBannerCfg(cfg)
      setPendingCfg(cfg)
      if (cfg.imageUrl) {
        const img = new window.Image()
        img.onload = () => { window.scrollTo(0, 0); setBannerLoaded(true) }
        img.onerror = () => { window.scrollTo(0, 0); setBannerLoaded(true) }
        img.src = cfg.imageUrl
      } else {
        window.scrollTo(0, 0)
        setBannerLoaded(true)
      }
    })
  }, [])

  // ── URL params ──

  const urlUserId = searchParams.get('user')
  const urlDate   = searchParams.get('date')

  useEffect(() => {
    if (!user) return
    setViewingUserId(
      urlUserId && canAssignToOthers && urlUserId !== user.id ? urlUserId : user.id
    )
  }, [user, urlUserId, canAssignToOthers])

  // Drop a pending verification jump once the user leaves the weekly tab so it
  // doesn't replay when they come back.
  useEffect(() => {
    if (activeTab !== 'weekly') setFocusRequest(null)
  }, [activeTab])

  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam && ['weekly', 'analytics', 'team', 'projects'].includes(tabParam)) {
      setActiveTab(
        tabParam === 'team' && !showTeamAnalytics ? 'weekly' : (tabParam as TabId)
      )
    }
  }, [searchParams, showTeamAnalytics])

  // Banner luminance. Derived banner values + this effect must run on every
  // render, so they live above the early return below — otherwise hook order
  // changes once auth resolves (null → user) and React throws (#310).
  const activeCfg = editingBanner ? pendingCfg : bannerCfg
  const _imgUrl   = activeCfg.imageUrl  ?? ''
  const _gradFrom = activeCfg.gradFrom
  const _gradTo   = activeCfg.gradTo
  useEffect(() => {
    if (_imgUrl) {
      sampleImageLuminance(_imgUrl, 0.6).then(setBannerLum)
    } else {
      setBannerLum((hexToLuminance(_gradFrom) + hexToLuminance(_gradTo)) / 2)
    }
  }, [_imgUrl, _gradFrom, _gradTo])

  if (!user || !profile) return null

  const allAssignees: UserProfile[] = [profile, ...teamMembers]

  // Jump to the assignee's calendar, pointing at the task awaiting verification.
  const handleNavigateToVerification = (assigneeId: string, dueDate: string | null, taskId: string) => {
    setActiveTab('weekly')
    setViewingUserId(assigneeId)
    setFocusRequest({ date: dueDate, taskId, nonce: Date.now() })
    // Scroll the calendar into view after a short delay to let React re-render first.
    // The div carries scroll-mt-20 to clear the sticky tab bar.
    setTimeout(() => {
      calendarWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)
  }

  // Browsing another calendar manually should drop any pending verification jump
  // so it doesn't re-fire on the next remount.
  const handleViewingUserChange = (uid: string) => {
    setFocusRequest(null)
    setViewingUserId(uid)
  }

  // ── Banner editor handlers ──

  const openEditor  = () => { setPendingCfg({ ...bannerCfg }); setEditingBanner(true) }
  const cancelEdit  = () => { setPendingCfg({ ...bannerCfg }); setEditingBanner(false) }
  const saveEdit    = async () => {
    setSavingBanner(true)
    await saveTaskBannerConfig(pendingCfg)
    setBannerCfg({ ...pendingCfg })
    setSavingBanner(false)
    setEditingBanner(false)
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImg(true)
    const url = await uploadSiteAsset(file, 'task_banner')
    if (url) setPendingCfg(prev => ({ ...prev, imageUrl: url }))
    setUploadingImg(false)
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  // ── Banner styles ──

  const bannerOnDark = bannerLum < 0.4

  const bannerBg: React.CSSProperties = activeCfg.imageUrl
    ? { backgroundImage: `url(${activeCfg.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(140deg, ${activeCfg.gradFrom} 0%, ${activeCfg.gradTo} 100%)` }

  // ── Render ──

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="tasks">

        {/* ── Full-bleed banner ── */}
        <AnimatePresence>
          {bannerLoaded && (
            <motion.div
              key="banner"
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              transition={{ type: 'spring', stiffness: 45, damping: 14 }}
              className="overflow-hidden"
            >
              <div className="relative overflow-hidden" style={bannerBg}>
          {/* Radial sheen */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.12),transparent_65%)] pointer-events-none" />
          {/* Decorative background icon */}
          <div className="absolute -bottom-6 -right-6 opacity-[0.06] pointer-events-none select-none">
            <ClipboardList size={180} className={bannerOnDark ? 'text-white' : 'text-slate-900'} />
          </div>
          {/* Bottom blur merge */}
          <div
            className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.15))',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 100%)',
            }}
          />

          {/* Admin edit pencil */}
          {isAdmin && !editingBanner && (
            <button
              onClick={openEditor}
              className="absolute top-3 right-3 p-2 bg-black/30 hover:bg-black/50 backdrop-blur-sm rounded-lg border border-white/20 text-white transition-colors z-10"
              title="Customise banner"
            >
              <Pencil size={14} />
            </button>
          )}

          {/* Header row */}
          <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-7 pb-10">
            <div className="flex items-center gap-4">
              <div className={`p-3 backdrop-blur-sm rounded-2xl flex-shrink-0 border transition-colors duration-300 ${bannerOnDark ? 'bg-white/20 border-white/20' : 'bg-white/70 border-white/50'}`}>
                <ClipboardList size={24} className={`transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-700'}`} />
              </div>
              <div>
                <h1 className={`font-display text-2xl sm:text-3xl font-bold leading-tight transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-900'}`}>
                  Task Manager
                </h1>
                <p className={`hidden sm:block text-sm mt-0.5 transition-colors duration-300 ${bannerOnDark ? 'text-white/70' : 'text-slate-600'}`}>Manage and track your tasks efficiently</p>
              </div>
            </div>
          </div>

          {/* ── Inline banner editor ── */}
          <AnimatePresence>
            {editingBanner && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-t border-white/20 bg-black/30 backdrop-blur-md"
              >
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                  <p className="text-white/70 text-[11px] font-semibold uppercase tracking-widest mb-3">
                    Banner Style
                  </p>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {BANNER_PRESETS.map(p => {
                      const active = !pendingCfg.imageUrl &&
                        pendingCfg.gradFrom === p.from && pendingCfg.gradTo === p.to
                      return (
                        <button
                          key={p.label}
                          title={p.label}
                          onClick={() => setPendingCfg({ gradFrom: p.from, gradTo: p.to, imageUrl: '' })}
                          className={`w-8 h-8 rounded-full border-2 transition-all duration-150 flex-shrink-0 ${
                            active ? 'border-white scale-110 shadow-lg' : 'border-white/30 hover:border-white/70 hover:scale-105'
                          }`}
                          style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
                        />
                      )
                    })}

                    {/* Task-specific amber preset (default) */}
                    {(() => {
                      const active = !pendingCfg.imageUrl &&
                        pendingCfg.gradFrom === TASK_BANNER_DEFAULT.gradFrom &&
                        pendingCfg.gradTo   === TASK_BANNER_DEFAULT.gradTo
                      return (
                        <button
                          title="Amber (default)"
                          onClick={() => setPendingCfg({ ...TASK_BANNER_DEFAULT, imageUrl: '' })}
                          className={`w-8 h-8 rounded-full border-2 transition-all duration-150 flex-shrink-0 ${
                            active ? 'border-white scale-110 shadow-lg' : 'border-white/30 hover:border-white/70 hover:scale-105'
                          }`}
                          style={{ background: `linear-gradient(135deg, ${TASK_BANNER_DEFAULT.gradFrom}, ${TASK_BANNER_DEFAULT.gradTo})` }}
                        />
                      )
                    })()}

                    <div className="w-px h-6 bg-white/25 mx-1" />

                    <label
                      className={`flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold rounded-full border border-white/25 cursor-pointer transition-colors flex-shrink-0 ${uploadingImg ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                      <ImageIcon size={13} />
                      {uploadingImg ? 'Uploading…' : 'Image'}
                      <input ref={imageInputRef} type="file" accept="image/*" className="sr-only" onChange={handleImageUpload} />
                    </label>

                    {pendingCfg.imageUrl && (
                      <button
                        onClick={() => setPendingCfg(prev => ({ ...prev, imageUrl: '' }))}
                        className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs font-medium rounded-full border border-white/15 transition-colors flex-shrink-0"
                      >
                        <X size={11} /> Remove image
                      </button>
                    )}

                    <div className="flex-1" />

                    <button onClick={cancelEdit} className="px-3 py-1.5 text-white/70 hover:text-white text-xs font-semibold rounded-full border border-white/20 hover:bg-white/10 transition-colors flex-shrink-0">
                      Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={savingBanner}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 text-xs font-bold rounded-full hover:bg-slate-50 transition-colors disabled:opacity-60 flex-shrink-0 shadow-md"
                    >
                      <Check size={12} />
                      {savingBanner ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Full-width tab strip — attached to banner ── */}
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-sm">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-stretch overflow-x-auto scrollbar-none">
              {visibleTabs.map(tab => {
                const isActive = activeTab === tab.id
                const meta = TAB_META[tab.id]
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    onMouseEnter={tab.id === 'team' && showTeamAnalytics
                      ? () => prefetchTeamAnalytics(user.id, profile.role)
                      : undefined}
                    onFocus={tab.id === 'team' && showTeamAnalytics
                      ? () => prefetchTeamAnalytics(user.id, profile.role)
                      : undefined}
                    className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 text-sm font-semibold transition-all duration-200 border-b-2 whitespace-nowrap ${
                      isActive
                        ? 'border-blue-500 text-slate-800'
                        : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50/80'
                    }`}
                  >
                    <span className={isActive ? meta.color : 'text-slate-400'}>
                      {meta.icon}
                    </span>
                    {tab.label}
                    {tab.id === 'projects' && activeProjectCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold bg-red-500 text-white rounded-full leading-none">
                        {activeProjectCount > 9 ? '9+' : activeProjectCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Tab content */}
        <motion.div
          key={`${activeTab}-${viewingUserId}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {activeTab === 'weekly' && (
              <>
                {canCheck && (
                  <VerificationAlerts
                    userId={user.id}
                    refreshKey={verificationRefresh}
                    onNavigate={handleNavigateToVerification}
                  />
                )}
                <div ref={calendarWrapRef} className="scroll-mt-20">
                  <WeeklyCalendar
                    userId={user.id}
                    profile={profile}
                    canCheck={canCheck}
                    canAssignToOthers={canAssignToOthers}
                    availableAssignees={allAssignees}
                    viewingUserId={viewingUserId !== user.id ? viewingUserId : undefined}
                    initialDate={focusRequest?.date || urlDate || undefined}
                    focusTaskId={focusRequest?.taskId}
                    focusNonce={focusRequest?.nonce}
                    teamMembers={canAssignToOthers && teamMembers.length > 0 ? teamMembers : undefined}
                    currentUserId={user.id}
                    currentUserName={profile.full_name}
                    onViewingUserChange={handleViewingUserChange}
                    onTaskActivity={() => setVerificationRefresh(v => v + 1)}
                  />
                </div>
              </>
            )}
            {activeTab === 'analytics' && (
              <TaskAnalytics
                userId={user.id}
                viewingUserId={viewingUserId !== user.id ? viewingUserId : undefined}
                teamMembers={canAssignToOthers && teamMembers.length > 0 ? teamMembers : undefined}
                currentUserId={user.id}
                currentUserName={profile.full_name}
                onViewingUserChange={setViewingUserId}
                onNewTask={() => setActiveTab('weekly')}
              />
            )}
            {activeTab === 'team' && showTeamAnalytics && (
              <TeamAnalytics
                userId={user.id}
                userRole={profile.role}
                isTeacher={profile.role === 'teacher'}
              />
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
        </motion.div>

      </div>
    </ProtectedLayout>
  )
}

// ── Export (Suspense boundary for useSearchParams) ────────────────────────────

export default function TasksPage() {
  return (
    <Suspense fallback={
      <ProtectedLayout staffOnly>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="spinner" />
        </div>
      </ProtectedLayout>
    }>
      <TasksPageContent />
    </Suspense>
  )
}
