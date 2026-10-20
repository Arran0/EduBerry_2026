'use client'

import React, { useState, useEffect, useCallback, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import ProtectedLayout from '@/components/ProtectedLayout'
import SmartboardLayout from '@/components/SmartboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen,
  Users,
  Calendar,
  FileText,
  ClipboardList,
  MessageSquare,
  BarChart3,
  ChevronLeft,
  Lock,
  Camera,
  Pencil,
} from 'lucide-react'
import {
  fetchClassroomById,
  ClassroomWithDetails,
  isClassroomClosed,
  uploadClassroomImage,
} from '@/lib/classrooms'
import { recordClassroomVisit } from '@/lib/classroomVisits'
import { safeSrc } from '@/lib/safeUrl'
import { hexToLuminance, sampleImageLuminance } from '@/lib/luminance'
import { pickClassroomPalette, classroomGradient, classroomLogoGradient } from '@/lib/classroomPalette'
import { isStaffRole } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import ModalShell from '@/components/ui/ModalShell'

const CourseWorkTab    = dynamic(() => import('@/components/classrooms/CourseWorkTab'))
const HomeworkTab      = dynamic(() => import('@/components/classrooms/HomeworkTab'))
const AssessmentsTab   = dynamic(() => import('@/components/classrooms/AssessmentsTab'))
const DiscussionTab    = dynamic(() => import('@/components/classrooms/DiscussionTab'))
const AnalysisTab      = dynamic(() => import('@/components/classrooms/AnalysisTab'))
const AIAssistantFloat = dynamic(() => import('@/components/classrooms/AIAssistantFloat'))

type Tab = 'coursework' | 'homework' | 'assessments' | 'discussion' | 'analysis'

const TAB_META: Record<Tab, { icon: React.ReactNode; color: string; bg: string }> = {
  coursework:  { icon: <FileText size={15} />,     color: 'text-slate-700',  bg: 'bg-slate-100' },
  homework:    { icon: <BookOpen size={15} />,     color: 'text-slate-700',  bg: 'bg-slate-100' },
  assessments: { icon: <ClipboardList size={15} />, color: 'text-amber-600',  bg: 'bg-amber-50'  },
  discussion:  { icon: <MessageSquare size={15} />, color: 'text-teal-600',   bg: 'bg-teal-50'   },
  analysis:    { icon: <BarChart3 size={15} />,    color: 'text-emerald-600', bg: 'bg-emerald-50' },
}

const TAB_VALUES: Tab[] = ['coursework', 'homework', 'assessments', 'discussion', 'analysis']

function formatDay(iso: string): string {
  return new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function ClassroomDetailPageContent() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile } = useAuth()

  const [classroom, setClassroom] = useState<ClassroomWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('coursework')
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [bannerLum, setBannerLum] = useState<number | null>(null)
  const [bannerReady, setBannerReady] = useState(false)

  const loadClassroom = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const data = await fetchClassroomById(id)
    setClassroom(data)
    setLoading(false)
  }, [id])

  useEffect(() => {
    loadClassroom()
  }, [loadClassroom])

  useEffect(() => {
    if (id) recordClassroomVisit(id)
  }, [id])

  // Deep-link support, e.g. /classrooms/[id]?tab=assessments
  useEffect(() => {
    const t = searchParams.get('tab')
    if (t && (TAB_VALUES as string[]).includes(t)) setActiveTab(t as Tab)
  }, [searchParams])

  // Each classroom gets a stable, friendly gradient palette (hashed from its
  // id) instead of every classroom sharing one fixed purple/blue/cyan combo.
  const palette = classroom ? pickClassroomPalette(classroom.id) : null

  // Read the two fields the banner actually depends on, so the dependency list
  // is the real one rather than the whole classroom object (which changes
  // identity on every refetch and would re-run this for unrelated edits).
  const classroomId  = classroom?.id
  const classroomBanner = classroom?.banner_url

  const bannerSrc = safeSrc(classroomBanner)
  const logoSrc = safeSrc(classroom?.logo_url)

  useEffect(() => {
    if (!classroomId) return
    setBannerReady(false)
    if (bannerSrc) {
      sampleImageLuminance(bannerSrc, 0.6).then(setBannerLum)
    } else {
      const p = pickClassroomPalette(classroomId)
      setBannerLum((hexToLuminance(p.from) + hexToLuminance(p.to)) / 2)
    }
  }, [bannerSrc, classroomId])

  // The tab lives in the URL, so a reload or a shared link opens the same one.
  const selectTab = (t: Tab) => {
    setActiveTab(t)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    window.history.replaceState(window.history.state, '', url)
  }

  if (!user || !profile) return null

  const closed = classroom ? isClassroomClosed(classroom) : false
  const canEditClassroom = profile ? isStaffRole(profile.role) : false
  const isStudent = profile.role === 'student'
  // null or low luminance = dark background → white text
  const bannerOnDark = bannerLum === null || bannerLum < 0.4

  const handleImageUpload = async (kind: 'banner' | 'logo', file: File) => {
    if (!classroom) return
    const url = await uploadClassroomImage(classroom.id, file, kind)
    if (url) {
      setClassroom(prev => prev ? { ...prev, [`${kind}_url`]: url } : prev)
    }
  }

  const tabs: { id: Tab; label: string; shortLabel: string }[] = [
    { id: 'coursework',  label: 'Content',     shortLabel: 'Content'    },
    { id: 'homework',    label: 'Calendar',    shortLabel: 'Calendar'   },
    // Shorter names on a phone: a fifth of a 360px screen has no room for the long ones.
    { id: 'assessments', label: 'Assessments', shortLabel: 'Marks'      },
    { id: 'discussion',  label: 'Discussion',  shortLabel: 'Chat'       },
    // Staff-only performance analysis
    ...(canEditClassroom ? [{ id: 'analysis' as Tab, label: 'Analysis', shortLabel: 'Analysis' }] : []),
  ]

  // Smart boards open classrooms inside their own shell (permanent board nav),
  // everyone else inside the normal app layout.
  const isSmartboard = profile.role === 'smartboard'

  const inner = (
      // Everyone but a student sees the classroom as a working tool, so it takes
      // the square-cornered pro chrome (see globals.css) — the same treatment
      // the academics page it opens from uses.
      <div data-page-theme="academics" className={isStudent ? undefined : 'pro-chrome'}>

        {loading ? (
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 space-y-5">
            {/* Banner / tabs / cards skeleton mirrors the loaded layout */}
            <div className="skeleton rounded-3xl h-28 sm:h-36" />
            <div className="skeleton rounded-2xl h-14" />
            <div className="space-y-3">
              <div className="skeleton rounded-2xl h-24" />
              <div className="skeleton rounded-2xl h-24" />
            </div>
          </div>
        ) : !classroom ? (
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6">
            <div className="glass-card rounded-3xl p-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <BookOpen size={28} className="text-slate-300" />
              </div>
              <p className="text-slate-700 font-semibold">Classroom not found</p>
              <p className="text-sm text-slate-500 mt-1">You may not have access to this classroom.</p>
              <button
                onClick={() => router.back()}
                className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 active:scale-[0.97] transition-all"
              >
                <ChevronLeft size={15} /> Go back
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Banner: a short strip, painted at once. The photo, if any,
                 fades in over the classroom's own gradient when it arrives. ── */}
            <div className="relative overflow-hidden" style={{ background: classroomGradient(palette!) }}>
              {bannerSrc && (
                <img
                  src={bannerSrc}
                  alt=""
                  decoding="async"
                  onLoad={() => setBannerReady(true)}
                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${bannerReady ? 'opacity-100' : 'opacity-0'}`}
                />
              )}
              {/* Soft light from the top left, and a legibility wash over a photo */}
              <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.18),transparent_60%)]" />
              {bannerSrc && (
                <div
                  className={`absolute inset-0 pointer-events-none ${
                    bannerOnDark
                      ? 'bg-gradient-to-t from-slate-950/55 via-slate-950/20 to-slate-950/25'
                      : 'bg-gradient-to-t from-white/65 via-white/20 to-white/30'
                  }`}
                />
              )}

              <div className="relative max-w-7xl 2xl:max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-10 sm:pt-5 sm:pb-12">
                <div className="flex items-center gap-3 sm:gap-4">
                  {/* Logo */}
                  <div className="relative group flex-shrink-0">
                    <div
                      className={`keep-round w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-white font-bold text-lg sm:text-xl shadow-[0_10px_26px_-10px_rgba(15,23,42,0.5)] ring-2 ${bannerOnDark ? 'ring-white/90' : 'ring-white'} ${closed ? 'bg-slate-500' : ''} overflow-hidden`}
                      style={closed ? undefined : { background: classroomLogoGradient(palette!) }}
                    >
                      {logoSrc ? (
                        <img src={logoSrc} alt="" className="w-full h-full object-cover" />
                      ) : closed ? (
                        <Lock size={20} />
                      ) : (
                        <span className="text-white/95 drop-shadow-sm">{classroom.title.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    {canEditClassroom && !closed && (
                      <label
                        className="keep-round absolute inset-0 flex items-center justify-center bg-black/45 rounded-full opacity-0 group-hover:opacity-100 focus-within:opacity-100 cursor-pointer transition-opacity text-white"
                        title="Change logo"
                      >
                        <Camera size={16} />
                        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) handleImageUpload('logo', f)
                          e.target.value = ''
                        }} />
                      </label>
                    )}
                  </div>

                  {/* Title + meta — the title wraps; it is never cut short. */}
                  <div className="flex-1 min-w-0">
                    <h1
                      className={`font-display text-[1.25rem] sm:text-[1.6rem] font-bold leading-tight break-words ${bannerOnDark ? 'text-white' : 'text-slate-900'}`}
                      style={bannerOnDark ? { textShadow: '0 2px 12px rgba(0,0,0,0.4)' } : undefined}
                    >
                      {classroom.title}
                      {closed && (
                        <span className={`keep-round ml-2 align-middle inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold ${bannerOnDark ? 'bg-white/20 text-white' : 'bg-white/75 text-slate-700'}`}>
                          <Lock size={10} /> Closed
                        </span>
                      )}
                    </h1>
                    {classroom.description && (
                      <p
                        className={`hidden sm:block text-[13px] mt-0.5 max-w-3xl break-words ${bannerOnDark ? 'text-white/85' : 'text-slate-700'}`}
                        style={bannerOnDark ? { textShadow: '0 1px 6px rgba(0,0,0,0.35)' } : undefined}
                      >
                        {classroom.description}
                      </p>
                    )}
                    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[12px] font-medium ${bannerOnDark ? 'text-white/90' : 'text-slate-700'}`}>
                      <button
                        onClick={() => setShowMembersModal(true)}
                        className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
                      >
                        <Users size={12} /> {classroom.member_count || 0} members
                      </button>
                      {classroom.start_date && (
                        <span className="hidden sm:inline-flex items-center gap-1">
                          <Calendar size={12} />
                          {formatDay(classroom.start_date)}
                          {classroom.end_date && <> to {formatDay(classroom.end_date)}</>}
                        </span>
                      )}
                    </div>
                  </div>

                  {canEditClassroom && !closed && (
                    <label
                      className="keep-round flex-shrink-0 self-start w-9 h-9 rounded-full bg-black/25 hover:bg-black/40 flex items-center justify-center cursor-pointer transition-colors"
                      title="Change banner"
                    >
                      <Pencil size={14} className="text-white" />
                      <span className="sr-only">Change banner</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) handleImageUpload('banner', f)
                        e.target.value = ''
                      }} />
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* ── Tabs — a glass switch riding on the banner's lower edge ── */}
            <div className="relative z-10 -mt-7 max-w-7xl 2xl:max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
              <nav className="cr-tabs" aria-label="Classroom sections">
                {tabs.map(tab => {
                  const meta = TAB_META[tab.id]
                  const isActive = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      onClick={() => selectTab(tab.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`relative min-w-0 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 px-1 sm:px-3 py-1.5 sm:py-2 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--page-primary)]/50 ${
                        isActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="classroom-active-tab"
                          className="lg-seg-thumb"
                          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        />
                      )}
                      <span className={`relative flex-shrink-0 ${isActive ? meta.color : ''}`}>{meta.icon}</span>
                      <span className="relative text-center leading-tight text-[10.5px] sm:text-[13px] whitespace-nowrap">
                        <span className="sm:hidden">{tab.shortLabel}</span>
                        <span className="hidden sm:inline">{tab.label}</span>
                      </span>
                    </button>
                  )
                })}
              </nav>
            </div>

            {/* ── Content area ──
                Phones run edge-to-edge (no side gutters) so cards get the full
                screen width; the bottom padding keeps the floating assistant
                clear of the last card. */}
            <div className="relative z-10 max-w-7xl 2xl:max-w-[1600px] mx-auto px-0 sm:px-6 lg:px-8 pt-3 sm:pt-4 pb-28 sm:pb-24">
              {/* Closed notice */}
              {closed && (
                <div className="mx-3 sm:mx-0 mb-3 px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-2xl text-[13px] text-amber-800 flex items-start gap-2">
                  <Lock size={14} className="mt-0.5 flex-shrink-0" />
                  This classroom has ended. You can read everything here but not change it.
                </div>
              )}

              {/* ── Tab Content ── */}
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
              >
                {activeTab === 'coursework' && (
                  <CourseWorkTab
                    classroomId={classroom.id}
                    userId={user.id}
                    userRole={profile.role}
                    classroom={classroom}
                  />
                )}
                {activeTab === 'homework' && (
                  <HomeworkTab
                    classroomId={classroom.id}
                    userId={user.id}
                    userRole={profile.role}
                    classroom={classroom}
                  />
                )}
                {activeTab === 'assessments' && (
                  <AssessmentsTab
                    classroomId={classroom.id}
                    userId={user.id}
                    userRole={profile.role}
                    classroom={classroom}
                  />
                )}
                {activeTab === 'discussion' && (
                  <DiscussionTab
                    classroomId={classroom.id}
                    userId={user.id}
                    userRole={profile.role}
                  />
                )}
                {activeTab === 'analysis' && (
                  <AnalysisTab
                    classroomId={classroom.id}
                    userId={user.id}
                    userRole={profile.role}
                    classroom={classroom}
                  />
                )}
              </motion.div>
            </div>

            {/* ── AI Assistant floating button ── */}
            {/* On Discussion the compose bar is sticky at the bottom, so bump the
                button up by the compose-bar height so it floats above it. */}
            <AIAssistantFloat mobileBottomOffset={0} />

            {/* Members Modal */}
            <AnimatePresence>
              {showMembersModal && (
                <ModalShell
                  onClose={() => setShowMembersModal(false)}
                  title="Members"
                  subtitle={`${classroom.members.length} ${classroom.members.length === 1 ? 'person' : 'people'} in this classroom`}
                  icon={<Users size={16} />}
                  iconClassName="bg-cyan-100 text-cyan-600"
                  bodyClassName="!px-2 !py-2 space-y-0.5"
                >
                  {classroom.members.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-8">No members yet</p>
                  ) : (
                    classroom.members.map(member => (
                      <div key={member.id} className="flex items-center gap-3 py-2 px-2 rounded-2xl hover:bg-slate-50 active:bg-slate-100 transition-colors">
                        <Avatar avatarUrl={member.user?.avatar_url} name={member.user?.full_name} size={34} userId={member.user?.id} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 break-words">{member.user?.full_name || 'Unknown'}</p>
                          <p className="text-xs text-slate-500 break-all">{member.user?.email}</p>
                        </div>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold capitalize flex-shrink-0 ${
                          member.role === 'teacher'
                            ? 'bg-indigo-50 text-indigo-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {member.role}
                        </span>
                      </div>
                    ))
                  )}
                </ModalShell>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
  )

  return isSmartboard
    ? <SmartboardLayout>{inner}</SmartboardLayout>
    : <ProtectedLayout>{inner}</ProtectedLayout>
}

export default function ClassroomDetailPage() {
  return (
    <Suspense fallback={
      <ProtectedLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="spinner" />
        </div>
      </ProtectedLayout>
    }>
      <ClassroomDetailPageContent />
    </Suspense>
  )
}
