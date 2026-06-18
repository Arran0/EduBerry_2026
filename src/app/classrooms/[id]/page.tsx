'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { motion } from 'framer-motion'
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
  ImageIcon,
  X,
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

  // Gradient from-purple-500 via-blue-600 to-cyan-500 is always dark → null = white text
  useEffect(() => {
    if (classroom?.banner_url) {
      sampleImageLuminance(classroom.banner_url, 0.6).then(setBannerLum)
    } else {
      // Compute from the fixed gradient: average of purple-500, blue-600, cyan-500
      const gradLum = (hexToLuminance('#a855f7') + hexToLuminance('#2563eb') + hexToLuminance('#06b6d4')) / 3
      setBannerLum(gradLum)
    }
  }, [classroom?.banner_url])

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
    { id: 'coursework',  label: 'Course Work'  },
    { id: 'homework',    label: 'Homework'     },
    { id: 'assessments', label: 'Assessments'  },
    { id: 'discussion',  label: 'Discussion'   },
    // Staff-only performance analysis
    ...(canEditClassroom ? [{ id: 'analysis' as Tab, label: 'Analysis' }] : []),
  ]

  return (
    <ProtectedLayout>
      <div data-page-theme="academics">

        {loading ? (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="text-center py-16">
              <div className="spinner mx-auto mb-3" />
              <p className="text-sm text-slate-500">Loading classroom...</p>
            </div>
          </div>
        ) : !classroom ? (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="glass rounded-2xl p-10 text-center">
              <BookOpen size={40} className="text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600 font-medium">Classroom not found</p>
              <p className="text-sm text-slate-400 mt-1">You may not have access to this classroom.</p>
            </div>
          </div>
        ) : (
          <>
            {/* ── Immersive Banner ── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative overflow-hidden"
              style={{ minHeight: '200px' }}
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

              {/* Radial sheen */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.1),transparent_60%)] pointer-events-none" />

              {/* Change banner button (staff only) */}
              {canEditClassroom && !closed && (
                <label className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 bg-black/40 hover:bg-black/60 backdrop-blur-sm rounded-lg cursor-pointer transition-colors text-white/80 hover:text-white text-xs font-medium border border-white/20">
                  <ImageIcon size={13} />
                  Banner
                  <input type="file" accept="image/*" className="hidden" onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleImageUpload('banner', f)
                  }} />
                </label>
              )}

              {/* Content overlay */}
              <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-14">
                {/* Back button */}
                <button
                  onClick={() => router.back()}
                  className={`flex items-center gap-1.5 text-sm mb-5 transition-colors duration-300 ${bannerOnDark ? 'text-white/70 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <ChevronLeft size={16} />
                  Back
                </button>

                {/* Classroom info */}
                <div className="flex items-end gap-4">
                  {/* Logo */}
                  <div className="relative group flex-shrink-0">
                    <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-xl border-4 transition-colors duration-300 ${bannerOnDark ? 'border-white' : 'border-slate-200'} ${closed ? 'bg-slate-500' : 'bg-gradient-to-br from-purple-500 to-blue-600'} overflow-hidden`}>
                      {classroom.logo_url ? (
                        <img src={classroom.logo_url} alt="" className="w-full h-full object-cover" />
                      ) : closed ? (
                        <Lock size={26} />
                      ) : (
                        <span className="text-white/90">{classroom.title.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    {canEditClassroom && !closed && (
                      <label className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity text-white">
                        <Camera size={18} />
                        <input type="file" accept="image/*" className="hidden" onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) handleImageUpload('logo', f)
                        }} />
                      </label>
                    )}
                  </div>

                  {/* Title + meta */}
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h1
                        className={`font-display text-2xl sm:text-3xl font-bold leading-tight transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-900'}`}
                        style={bannerOnDark ? { textShadow: '0 1px 4px rgba(0,0,0,0.5)' } : undefined}
                      >
                        {classroom.title}
                      </h1>
                      {closed && (
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1 border transition-colors duration-300 ${bannerOnDark ? 'bg-white/20 text-white/80 border-white/20' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                          <Lock size={11} /> Closed
                        </span>
                      )}
                    </div>
                    {classroom.description && (
                      <p className={`hidden sm:block text-sm mb-2 line-clamp-2 transition-colors duration-300 ${bannerOnDark ? 'text-white/70' : 'text-slate-600'}`}>{classroom.description}</p>
                    )}
                    <div className={`flex flex-wrap items-center gap-3 text-xs transition-colors duration-300 ${bannerOnDark ? 'text-white/60' : 'text-slate-500'}`}>
                      <button
                        onClick={() => setShowMembersModal(true)}
                        className={`flex items-center gap-1 underline-offset-2 hover:underline cursor-pointer transition-colors duration-300 ${bannerOnDark ? 'hover:text-white' : 'hover:text-slate-800'}`}
                      >
                        <Users size={12} /> {classroom.member_count || 0} members
                      </button>
                      {classroom.start_date && (
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />
                          {new Date(classroom.start_date).toLocaleDateString()}
                          {classroom.end_date && (
                            <> – {new Date(classroom.end_date).toLocaleDateString()}</>
                          )}
                        </span>
                      )}
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

            {/* ── Content area ── */}
            <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">
              {/* Closed notice */}
              {closed && (
                <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 flex items-center gap-2 shadow-sm">
                  <Lock size={15} />
                  This classroom has ended. Content is read-only.
                </div>
              )}

              {/* ── Tabs ── */}
              <div className="bg-white border border-slate-200 rounded-2xl p-1.5 flex gap-1 mb-4 overflow-x-auto shadow-sm">
                {tabs.map(tab => {
                  const meta = TAB_META[tab.id]
                  const isActive = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all flex-1 justify-center ${
                        isActive
                          ? `${meta.bg} ${meta.color} shadow-sm`
                          : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className={isActive ? meta.color : 'text-slate-400'}>
                        {meta.icon}
                      </span>
                      {tab.label}
                    </button>
                  )
                })}
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
            <AIAssistantFloat />

            {/* Members Modal */}
            {showMembersModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowMembersModal(false)} />
                <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <Users size={16} className="text-slate-500" />
                      <h2 className="font-semibold text-slate-800">Members</h2>
                      <span className="text-xs text-slate-400">({classroom.members.length})</span>
                    </div>
                    <button
                      onClick={() => setShowMembersModal(false)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="overflow-y-auto p-4 space-y-2">
                    {classroom.members.length === 0 ? (
                      <p className="text-sm text-slate-500 text-center py-6">No members yet</p>
                    ) : (
                      classroom.members.map(member => (
                        <div key={member.id} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-slate-50 transition-colors">
                          <Avatar avatarUrl={member.user?.avatar_url} name={member.user?.full_name} size={36} userId={member.user?.id} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{member.user?.full_name || 'Unknown'}</p>
                            <p className="text-xs text-slate-400 truncate">{member.user?.email}</p>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize flex-shrink-0">{member.role}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ProtectedLayout>
  )
}
