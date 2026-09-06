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
import { hexToLuminance, sampleImageLuminance } from '@/lib/luminance'
import { pickClassroomBannerPalette } from '@/lib/classroomPalette'
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
  const [showDates, setShowDates] = useState(true)

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

  // Start/end date briefly announces itself, then fades out to keep the
  // banner meta row minimal.
  useEffect(() => {
    if (!classroom?.start_date) return
    setShowDates(true)
    const t = setTimeout(() => setShowDates(false), 1000)
    return () => clearTimeout(t)
  }, [classroom?.id, classroom?.start_date])

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
  const palette = classroom ? pickClassroomBannerPalette(classroom.id) : null

  useEffect(() => {
    if (!classroom) return
    setBannerReady(false)
    if (classroom.banner_url) {
      sampleImageLuminance(classroom.banner_url, 0.6).then(setBannerLum)
      const img = new window.Image()
      img.onload = () => setBannerReady(true)
      img.onerror = () => setBannerReady(true)
      img.src = classroom.banner_url
    } else {
      const p = pickClassroomBannerPalette(classroom.id)
      const gradLum = (hexToLuminance(p.hexFrom) + hexToLuminance(p.hexVia) + hexToLuminance(p.hexTo)) / 3
      setBannerLum(gradLum)
      setBannerReady(true)
    }
  }, [classroom?.banner_url, classroom?.id])

  if (!user || !profile) return null

  const closed = classroom ? isClassroomClosed(classroom) : false
  const canEditClassroom = profile ? isStaffRole(profile.role) : false
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
    { id: 'coursework',  label: 'Content',            shortLabel: 'Content'      },
    { id: 'homework',    label: 'Classroom Calendar', shortLabel: 'Calendar'     },
    { id: 'assessments', label: 'Assessments',        shortLabel: 'Assessments' },
    { id: 'discussion',  label: 'Discussion',         shortLabel: 'Discussion'  },
    // Staff-only performance analysis
    ...(canEditClassroom ? [{ id: 'analysis' as Tab, label: 'Analysis', shortLabel: 'Analytics' }] : []),
  ]

  // Smart boards open classrooms inside their own shell (permanent board nav),
  // everyone else inside the normal app layout.
  const isSmartboard = profile.role === 'smartboard'

  const inner = (
      <div data-page-theme="academics">

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
            {/* ── Immersive Banner ── */}
            <AnimatePresence>
              {bannerReady && (
                <motion.div
                  key="classroom-banner"
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  transition={{ type: 'spring', stiffness: 45, damping: 14 }}
                  className="relative overflow-hidden"
                >
              {/* Background: banner image or this classroom's gradient palette */}
              <div className={`absolute inset-0 bg-gradient-to-br ${palette!.bannerGradient}`}>
                {classroom.banner_url && (
                  <img
                    src={classroom.banner_url}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
              </div>

              {/* Decorative glow orbs (visible on the gradient banner) */}
              {!classroom.banner_url && (
                <>
                  <div className={`absolute -top-16 -right-10 w-64 h-64 rounded-full ${palette!.orbA} blur-3xl pointer-events-none`} />
                  <div className={`absolute -bottom-20 left-1/4 w-72 h-72 rounded-full ${palette!.orbB} blur-3xl pointer-events-none`} />
                </>
              )}

              {/* Radial sheen */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.14),transparent_60%)] pointer-events-none" />

              {/* Legibility scrim over banner images, tuned to the sampled luminance */}
              {classroom.banner_url && (
                <div
                  className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
                    bannerOnDark
                      ? 'bg-gradient-to-t from-slate-950/55 via-slate-950/15 to-slate-950/25'
                      : 'bg-gradient-to-t from-white/65 via-white/15 to-white/30'
                  }`}
                />
              )}

              {/* Change banner button (staff only) — small pencil icon, matching the home page banner */}
              {canEditClassroom && !closed && (
                <label
                  className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur-sm flex items-center justify-center cursor-pointer transition-all active:scale-90"
                  title="Change banner"
                >
                  <Pencil size={13} className="text-white" />
                  <input type="file" accept="image/*" className="hidden" onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleImageUpload('banner', f)
                  }} />
                </label>
              )}

              {/* Content overlay — deliberately short: the banner is chrome, not
                  content, so it never eats more than a sliver of the viewport. */}
              <div className="relative max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-3.5 sm:pt-5 pb-11 sm:pb-12">
                {/* Classroom info */}
                <div className="flex items-center gap-3 sm:gap-4">
                  {/* Logo */}
                  <div className="relative group flex-shrink-0">
                    <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-white font-bold text-lg sm:text-2xl shadow-[0_10px_26px_-10px_rgba(15,23,42,0.5)] ring-2 sm:ring-[3px] transition-all duration-300 ${bannerOnDark ? 'ring-white/90' : 'ring-white'} ${closed ? 'bg-slate-500' : `bg-gradient-to-br ${palette!.avatarGradient}`} overflow-hidden`}>
                      {classroom.logo_url ? (
                        <img src={classroom.logo_url} alt="" className="w-full h-full object-cover" />
                      ) : closed ? (
                        <Lock size={20} />
                      ) : (
                        <span className="text-white/95 drop-shadow-sm">{classroom.title.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    {canEditClassroom && !closed && (
                      <label className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity text-white">
                        <Camera size={16} />
                        <input type="file" accept="image/*" className="hidden" onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) handleImageUpload('logo', f)
                        }} />
                      </label>
                    )}
                  </div>

                  {/* Title + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1
                        className={`font-display headline text-[1.25rem] sm:text-2xl font-bold leading-tight truncate transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-900'}`}
                        style={bannerOnDark ? { textShadow: '0 2px 12px rgba(0,0,0,0.45)' } : undefined}
                      >
                        {classroom.title}
                      </h1>
                      {closed && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 border backdrop-blur-md transition-colors duration-300 ${bannerOnDark ? 'bg-white/20 text-white border-white/25' : 'bg-white/70 text-slate-700 border-white/80'}`}>
                          <Lock size={10} /> Closed
                        </span>
                      )}
                    </div>
                    {classroom.description && (
                      <p
                        className={`hidden sm:block text-xs mt-0.5 line-clamp-1 max-w-2xl transition-colors duration-300 ${bannerOnDark ? 'text-white/85' : 'text-slate-700'}`}
                        style={bannerOnDark ? { textShadow: '0 1px 6px rgba(0,0,0,0.35)' } : undefined}
                      >
                        {classroom.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1">
                      <button
                        onClick={() => setShowMembersModal(true)}
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold underline-offset-2 hover:underline transition-colors duration-300 ${
                          bannerOnDark ? 'text-white/90 hover:text-white' : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        <Users size={11} /> {classroom.member_count || 0} members
                      </button>
                      <AnimatePresence>
                        {classroom.start_date && showDates && (
                          <motion.span
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.5, ease: 'easeInOut' }}
                            className={`inline-flex items-center gap-1 text-[11px] font-medium transition-colors duration-300 ${
                              bannerOnDark ? 'text-white/80' : 'text-slate-700'
                            }`}
                          >
                            <Calendar size={11} />
                            {new Date(classroom.start_date).toLocaleDateString()}
                            {classroom.end_date && (
                              <> – {new Date(classroom.end_date).toLocaleDateString()}</>
                            )}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom wave fade into page background */}
              <div
                className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
                style={{ background: 'linear-gradient(to bottom, transparent, rgba(248,250,252,0.6))' }}
              />
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Tabs — full-bleed flat strip with an icon chip + sliding
                 underline, matching the Task Manager's mini nav bar. The bar
                 itself spans the full browser width; only its contents align
                 to the page's max-w-7xl column. ── */}
            <div className="relative z-10 -mt-7 bg-white border-b border-slate-200 shadow-sm">
              <div className="max-w-7xl mx-auto px-1 sm:px-6 lg:px-8">
                <div className="flex items-stretch gap-0.5 sm:gap-1">
                  {tabs.map(tab => {
                    const meta = TAB_META[tab.id]
                    const isActive = activeTab === tab.id
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`group relative flex-1 min-w-0 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-0.5 sm:px-6 py-2.5 sm:py-4 font-semibold transition-colors duration-200 ${
                          isActive ? 'text-slate-900' : 'text-slate-600 hover:text-slate-800'
                        }`}
                      >
                        <span
                          className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-xl transition-all duration-300 flex-shrink-0 ${
                            isActive
                              ? `${meta.bg} ${meta.color} shadow-sm scale-100`
                              : 'text-slate-500 group-hover:text-slate-700 group-hover:bg-slate-50 scale-95'
                          }`}
                        >
                          {meta.icon}
                        </span>
                        <span className="relative z-10 leading-none sm:hidden text-[10px] truncate max-w-full">{tab.shortLabel}</span>
                        <span className="relative z-10 leading-none hidden sm:inline text-sm whitespace-nowrap">{tab.label}</span>
                        {isActive && (
                          <motion.span
                            layoutId="classroom-active-tab"
                            className="absolute inset-x-1.5 sm:inset-x-3 bottom-0 h-[3px] rounded-full"
                            style={{ background: 'linear-gradient(to right, var(--page-gradient-from, #06b6d4), var(--page-gradient-to, #14b8a6))' }}
                            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ── Content area ──
                Phones run edge-to-edge (no side gutters) so cards get the full
                screen width; the bottom padding keeps the floating assistant
                clear of the last card. */}
            <div className="relative z-10 max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 pt-4 pb-28 sm:pb-24">
              {/* Closed notice */}
              {closed && (
                <div className="mx-2 sm:mx-0 mb-4 px-4 py-3 bg-amber-50/90 backdrop-blur-sm border border-amber-200 rounded-2xl text-sm text-amber-800 flex items-center gap-2 shadow-sm">
                  <Lock size={15} />
                  This classroom has ended. Content is read-only.
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
                  bodyClassName="space-y-1"
                >
                  {classroom.members.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-8">No members yet</p>
                  ) : (
                    classroom.members.map(member => (
                      <div key={member.id} className="flex items-center gap-3 py-2.5 px-3 rounded-2xl hover:bg-slate-50 active:bg-slate-100 transition-colors">
                        <Avatar avatarUrl={member.user?.avatar_url} name={member.user?.full_name} size={40} userId={member.user?.id} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{member.user?.full_name || 'Unknown'}</p>
                          <p className="text-xs text-slate-500 truncate">{member.user?.email}</p>
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
