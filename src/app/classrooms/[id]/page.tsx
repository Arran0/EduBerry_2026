'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
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

export default function ClassroomDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
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

  // Gradient from-purple-500 via-blue-600 to-cyan-500 is always dark → null = white text
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
      const gradLum = (hexToLuminance('#a855f7') + hexToLuminance('#2563eb') + hexToLuminance('#06b6d4')) / 3
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

  const tabs: { id: Tab; label: string }[] = [
    { id: 'coursework',  label: 'Content'            },
    { id: 'homework',    label: 'Classroom Calendar' },
    { id: 'assessments', label: 'Assessments'        },
    { id: 'discussion',  label: 'Discussion'         },
    // Staff-only performance analysis
    ...(canEditClassroom ? [{ id: 'analysis' as Tab, label: 'Analysis' }] : []),
  ]

  // Smart boards open classrooms inside their own shell (permanent board nav),
  // everyone else inside the normal app layout.
  const isSmartboard = profile.role === 'smartboard'

  const inner = (
      <div data-page-theme="academics">

        {loading ? (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
            {/* Banner / tabs / cards skeleton mirrors the loaded layout */}
            <div className="skeleton rounded-3xl h-44 sm:h-52" />
            <div className="skeleton rounded-2xl h-14" />
            <div className="space-y-3">
              <div className="skeleton rounded-2xl h-24" />
              <div className="skeleton rounded-2xl h-24" />
            </div>
          </div>
        ) : !classroom ? (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="glass-card rounded-3xl p-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <BookOpen size={28} className="text-slate-300" />
              </div>
              <p className="text-slate-700 font-semibold">Classroom not found</p>
              <p className="text-sm text-slate-400 mt-1">You may not have access to this classroom.</p>
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
              {/* Background: banner image or gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500 via-blue-600 to-cyan-500">
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
                  <div className="absolute -top-16 -right-10 w-64 h-64 rounded-full bg-cyan-300/30 blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-20 left-1/4 w-72 h-72 rounded-full bg-fuchsia-400/25 blur-3xl pointer-events-none" />
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

              {/* Content overlay */}
              <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-5 pb-16">
                {/* Back button — icon-only so it doesn't add banner height */}
                <button
                  onClick={() => router.back()}
                  aria-label="Back"
                  className={`inline-flex items-center justify-center w-8 h-8 mb-4 rounded-full backdrop-blur-md transition-all active:scale-90 ${
                    bannerOnDark
                      ? 'bg-white/15 hover:bg-white/25 text-white/90 hover:text-white'
                      : 'bg-white/55 hover:bg-white/80 text-slate-700'
                  }`}
                >
                  <ChevronLeft size={18} />
                </button>

                {/* Classroom info */}
                <div className="flex items-end gap-4 sm:gap-5">
                  {/* Logo */}
                  <div className="relative group flex-shrink-0">
                    <div className={`w-[4.5rem] h-[4.5rem] sm:w-24 sm:h-24 rounded-full flex items-center justify-center text-white font-bold text-2xl sm:text-3xl shadow-[0_12px_32px_-8px_rgba(15,23,42,0.45)] ring-4 transition-all duration-300 ${bannerOnDark ? 'ring-white/90' : 'ring-white'} ${closed ? 'bg-slate-500' : 'bg-gradient-to-br from-purple-500 to-blue-600'} overflow-hidden`}>
                      {classroom.logo_url ? (
                        <img src={classroom.logo_url} alt="" className="w-full h-full object-cover" />
                      ) : closed ? (
                        <Lock size={26} />
                      ) : (
                        <span className="text-white/95 drop-shadow-sm">{classroom.title.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    {canEditClassroom && !closed && (
                      <label className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity text-white">
                        <Camera size={20} />
                        <input type="file" accept="image/*" className="hidden" onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) handleImageUpload('logo', f)
                        }} />
                      </label>
                    )}
                  </div>

                  {/* Title + meta */}
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                      <h1
                        className={`font-display headline text-[1.7rem] sm:text-4xl font-bold leading-tight transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-900'}`}
                        style={bannerOnDark ? { textShadow: '0 2px 12px rgba(0,0,0,0.45)' } : undefined}
                      >
                        {classroom.title}
                      </h1>
                      {closed && (
                        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1 border backdrop-blur-md transition-colors duration-300 ${bannerOnDark ? 'bg-white/20 text-white/90 border-white/25' : 'bg-white/60 text-slate-600 border-white/70'}`}>
                          <Lock size={11} /> Closed
                        </span>
                      )}
                    </div>
                    {classroom.description && (
                      <p
                        className={`hidden sm:block text-sm mb-2.5 line-clamp-2 max-w-2xl transition-colors duration-300 ${bannerOnDark ? 'text-white/75' : 'text-slate-600'}`}
                        style={bannerOnDark ? { textShadow: '0 1px 6px rgba(0,0,0,0.35)' } : undefined}
                      >
                        {classroom.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        onClick={() => setShowMembersModal(true)}
                        className={`inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 hover:underline transition-colors duration-300 ${
                          bannerOnDark ? 'text-white/70 hover:text-white' : 'text-slate-600 hover:text-slate-900'
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
                              bannerOnDark ? 'text-white/60' : 'text-slate-500'
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

            {/* ── Content area ── */}
            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-9 pb-10">
              {/* Closed notice */}
              {closed && (
                <div className="mb-4 px-4 py-3 bg-amber-50/90 backdrop-blur-sm border border-amber-200 rounded-2xl text-sm text-amber-700 flex items-center gap-2 shadow-sm">
                  <Lock size={15} />
                  This classroom has ended. Content is read-only.
                </div>
              )}

              {/* ── Tabs — segmented control with a floating active pill ── */}
              <div className="glass-card rounded-2xl p-1.5 mb-5">
                <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                  {tabs.map(tab => {
                    const meta = TAB_META[tab.id]
                    const isActive = activeTab === tab.id
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap flex-none sm:flex-1 justify-center min-h-[42px] transition-colors ${
                          isActive ? meta.color : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {isActive && (
                          <motion.span
                            layoutId="classroom-tab-pill"
                            className="absolute inset-0 rounded-xl bg-white shadow-[0_2px_10px_rgba(15,23,42,0.1),0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.04]"
                            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                          />
                        )}
                        <span className={`relative z-10 ${isActive ? meta.color : 'text-slate-400'}`}>
                          {meta.icon}
                        </span>
                        <span className="relative z-10">{tab.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

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
                          <p className="text-xs text-slate-400 truncate">{member.user?.email}</p>
                        </div>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold capitalize flex-shrink-0 ${
                          member.role === 'teacher'
                            ? 'bg-indigo-50 text-indigo-600'
                            : 'bg-slate-100 text-slate-500'
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
