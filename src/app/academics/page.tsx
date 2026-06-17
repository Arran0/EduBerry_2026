'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen, Check, GraduationCap, Pencil, Image as ImageIcon, X, CalendarDays, Search, Flame,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePageConfig } from '@/contexts/PageConfigContext'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import {
  ClassroomWithDetails, fetchClassroomsForUser,
} from '@/lib/classrooms'
import { sortByLastVisited } from '@/lib/classroomVisits'
import SchoolWorkManager from '@/components/classrooms/SchoolWorkManager'
import ReportCardsSection from '@/components/academics/ReportCardsSection'
import StudentGameSection from '@/components/academics/StudentGameSection'
import { fetchStreak } from '@/lib/gamification'
import {
  AnnouncementBannerConfig,
  ACADEMICS_BANNER_DEFAULT,
  BANNER_PRESETS,
  fetchAcademicsBannerConfig,
  saveAcademicsBannerConfig,
  uploadSiteAsset,
} from '@/lib/pageConfig'
import { hexToLuminance, sampleImageLuminance } from '@/lib/luminance'

function getSessionVibes(name: string): string[] {
  const h = new Date().getHours()
  const session = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  const first = name.split(' ')[0]
  return [
    `Hi ${first}, ready for your ${session} study session?`,
    `${first} is back — let's crush this ${session}!`,
    `Good ${session}, ${first}. Your classmates are already ahead.`,
    `${first} returns. Time to make this ${session} count.`,
    `Hey ${first}! Another ${session}, another step forward.`,
    `${first}, the grind never stops. Make this ${session} count.`,
    `Back at it, ${first}? This ${session} belongs to you.`,
    `${first}, every ${session} is a chance to pull ahead.`,
    `This ${session}, ${first} gets ahead while others wait.`,
    `${first} shows up — the leaderboard notices.`,
    `This ${session}, ${first} is making moves. Quietly.`,
    `${first}, the best students show up every single ${session}.`,
  ]
}

function getStudentGreeting(name: string): string {
  const vibes = getSessionVibes(name)
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000)
  return vibes[doy % vibes.length]
}

function TypingGreeting({ name, dark }: { name: string; dark: boolean }) {
  const vibes = useMemo(() => getSessionVibes(name), [name])
  const [vibeIdx, setVibeIdx] = useState(0)
  const [displayed, setDisplayed] = useState('')
  const [phase, setPhase] = useState<'typing' | 'hold' | 'deleting'>('typing')

  useEffect(() => {
    const text = vibes[vibeIdx]
    if (phase === 'typing') {
      if (displayed.length < text.length) {
        const t = setTimeout(() => setDisplayed(text.slice(0, displayed.length + 1)), 38)
        return () => clearTimeout(t)
      }
      const t = setTimeout(() => setPhase('hold'), 3200)
      return () => clearTimeout(t)
    }
    if (phase === 'hold') {
      const t = setTimeout(() => setPhase('deleting'), 400)
      return () => clearTimeout(t)
    }
    if (displayed.length > 0) {
      const t = setTimeout(() => setDisplayed(d => d.slice(0, -1)), 20)
      return () => clearTimeout(t)
    }
    setVibeIdx(v => (v + 1) % vibes.length)
    setPhase('typing')
  }, [displayed, phase, vibeIdx, vibes])

  return (
    <p className={`text-sm mt-1 font-medium leading-snug min-h-[1.25rem] ${dark ? 'text-white/90' : 'text-slate-600'}`}>
      {displayed}
      <motion.span
        animate={{ opacity: [1, 0] }}
        transition={{ duration: 0.55, repeat: Infinity, repeatType: 'reverse' }}
      >|</motion.span>
    </p>
  )
}

function StreakHeaderItem({ userId, dark }: { userId: string; dark: boolean }) {
  const [days, setDays] = useState<number | null>(null)
  useEffect(() => {
    fetchStreak(userId).then(s => setDays(s?.current_streak ?? 0))
  }, [userId])
  return (
    <div className="flex flex-col items-center flex-shrink-0 ml-2">
      <motion.div
        animate={{ scale: [1, 1.22, 0.96, 1], rotate: [-5, 5, -3, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ filter: 'drop-shadow(0 0 14px rgba(251,146,60,0.9))' }}
      >
        <Flame size={54} className="text-orange-400 fill-orange-400" strokeWidth={1.2} />
      </motion.div>
      <p
        className={`font-black text-2xl leading-none tabular-nums mt-0.5 ${dark ? 'text-white' : 'text-slate-800'}`}
        style={dark
          ? { textShadow: '0 0 16px rgba(251,146,60,0.8), 0 1px 4px rgba(0,0,0,0.5)' }
          : { textShadow: '0 0 8px rgba(251,146,60,0.5)' }}
      >
        {days ?? '·'}
      </p>
      <p className={`text-[9px] font-black uppercase tracking-widest mt-0.5 ${dark ? 'text-white/90' : 'text-slate-500'}`}>
        day{days === 1 ? '' : 's'}
      </p>
    </div>
  )
}

export default function AcademicsPage() {
  const { user, profile } = useAuth()
  const { pageIcons: pageConfig } = usePageConfig()
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  // Classrooms section
  const [showAllClassrooms, setShowAllClassrooms] = useState(false)
  const [classroomSearchOpen, setClassroomSearchOpen] = useState(false)
  const [classroomSearch, setClassroomSearch] = useState('')
  const classroomSearchRef = useRef<HTMLInputElement>(null)

  // Banner config state
  const [bannerCfg,     setBannerCfg]     = useState<AnnouncementBannerConfig>(ACADEMICS_BANNER_DEFAULT)
  const [pendingCfg,    setPendingCfg]    = useState<AnnouncementBannerConfig>(ACADEMICS_BANNER_DEFAULT)
  const [editingBanner, setEditingBanner] = useState(false)
  const [savingBanner,  setSavingBanner]  = useState(false)
  const [uploadingImg,  setUploadingImg]  = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [bannerLum, setBannerLum] = useState(0)

  const isStudent = profile?.role === 'student'
  const isStaff   = profile ? isStaffRole(profile.role) : false
  const isAdmin   = profile?.role === 'admin'

  const loadClassrooms = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    try {
      const enrolled = await fetchClassroomsForUser(user.id, profile.role)
      setClassrooms(sortByLastVisited(enrolled))
    } catch (error) {
      console.error('Failed to load classrooms:', error)
      setClassrooms([])
    } finally {
      setLoading(false)
    }
  }, [user, profile])

  useEffect(() => {
    loadClassrooms()
  }, [loadClassrooms])

  useEffect(() => {
    fetchAcademicsBannerConfig().then(cfg => {
      setBannerCfg(cfg)
      setPendingCfg(cfg)
    })
  }, [])

  // Banner editor handlers
  const openEditor = () => { setPendingCfg({ ...bannerCfg }); setEditingBanner(true) }
  const cancelEdit = () => { setPendingCfg({ ...bannerCfg }); setEditingBanner(false) }
  const saveEdit = async () => {
    setSavingBanner(true)
    await saveAcademicsBannerConfig(pendingCfg)
    setBannerCfg({ ...pendingCfg })
    setSavingBanner(false)
    setEditingBanner(false)
  }
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImg(true)
    const url = await uploadSiteAsset(file, 'academics_banner')
    if (url) setPendingCfg(prev => ({ ...prev, imageUrl: url }))
    setUploadingImg(false)
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

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
  const bannerOnDark = bannerLum < 0.4

  const bannerBg: React.CSSProperties = activeCfg.imageUrl
    ? { backgroundImage: `url(${activeCfg.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(140deg, ${activeCfg.gradFrom} 0%, ${activeCfg.gradTo} 100%)` }

  if (!user || !profile) return null

  return (
    <ProtectedLayout>
      <div data-page-theme="academics">

        {/* ── Immersive full-bleed banner ── */}
        <div className="relative overflow-hidden" style={bannerBg}>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.12),transparent_65%)] pointer-events-none" />

          {/* Decorative background icon */}
          <div className="absolute -bottom-6 -right-6 opacity-[0.07] pointer-events-none select-none">
            <GraduationCap size={180} className={bannerOnDark ? 'text-white' : 'text-slate-900'} />
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

          {/* Main header */}
          <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-7 pb-10">
            <div className="flex items-center gap-4">
              <div className={`p-3 backdrop-blur-sm rounded-2xl flex-shrink-0 border transition-colors duration-300 ${bannerOnDark ? 'bg-white/20 border-white/20' : 'bg-white/70 border-white/50'}`}>
                <GraduationCap size={24} className={`transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-700'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className={`font-display text-2xl sm:text-3xl font-bold leading-tight transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-900'}`}>
                  Academics
                </h1>
                {isStudent ? (
                  <TypingGreeting name={profile.full_name ?? 'there'} dark={bannerOnDark} />
                ) : (
                  <p className={`hidden sm:block text-sm mt-0.5 transition-colors duration-300 ${bannerOnDark ? 'text-white/70' : 'text-slate-600'}`}>
                    Access your classrooms and grade data in one place.
                  </p>
                )}
              </div>
              {isStudent && <StreakHeaderItem userId={user.id} dark={bannerOnDark} />}
            </div>
          </div>

          {/* Inline banner editor (admin only) */}
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
                        pendingCfg.gradFrom === p.from &&
                        pendingCfg.gradTo   === p.to
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

        {/* ── Page content ── */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">

          {/* Personalized greeting — students only */}
          {isStudent && (
            <p
              className="font-display text-xl font-black text-center leading-snug tracking-tight bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(135deg, #0f172a 0%, #0369a1 60%, #0891b2 100%)' }}
            >
              {getStudentGreeting(profile.full_name ?? 'there')}
            </p>
          )}

          {/* Classrooms */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={16} className="text-cyan-600" />
              <h2 className="font-semibold text-slate-700 text-sm">My Classrooms</h2>
              <button
                onClick={() => {
                  setClassroomSearchOpen(v => {
                    if (v) setClassroomSearch('')
                    return !v
                  })
                  setTimeout(() => classroomSearchRef.current?.focus(), 50)
                }}
                className="ml-1 p-1 rounded-lg text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 transition-colors"
                title={classroomSearchOpen ? 'Close search' : 'Search classrooms'}
              >
                {classroomSearchOpen ? <X size={14} /> : <Search size={14} />}
              </button>
              <AnimatePresence>
                {classroomSearchOpen && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-1 bg-white border border-cyan-200 rounded-xl px-2.5 py-1 shadow-sm">
                      <input
                        ref={classroomSearchRef}
                        type="text"
                        value={classroomSearch}
                        onChange={e => { setClassroomSearch(e.target.value); setShowAllClassrooms(false) }}
                        placeholder="Search classrooms…"
                        className="text-xs text-slate-700 placeholder:text-slate-400 bg-transparent focus:outline-none w-36"
                      />
                      {classroomSearch && (
                        <button onClick={() => setClassroomSearch('')} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {loading ? (
              <p className="text-sm text-slate-500">Loading classrooms…</p>
            ) : classrooms.length === 0 ? (
              <p className="text-sm text-slate-500">You are not enrolled in any classrooms yet.</p>
            ) : (() => {
              const CLASSROOM_LIMIT = 9
              const filtered = classroomSearch
                ? classrooms.filter(c => c.title.toLowerCase().includes(classroomSearch.toLowerCase()))
                : showAllClassrooms ? classrooms : classrooms.slice(0, CLASSROOM_LIMIT)
              const hasMore = !classroomSearch && !showAllClassrooms && classrooms.length > CLASSROOM_LIMIT

              const palettes = [
                { grad: 'from-cyan-500 to-teal-600'     },
                { grad: 'from-violet-500 to-purple-700' },
                { grad: 'from-rose-500 to-pink-600'     },
                { grad: 'from-amber-500 to-orange-600'  },
                { grad: 'from-emerald-500 to-teal-700'  },
                { grad: 'from-blue-500 to-indigo-700'   },
              ]

              return (
                <>
                  {filtered.length === 0 && classroomSearch ? (
                    <p className="text-sm text-slate-500">No classrooms match &ldquo;{classroomSearch}&rdquo;</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {filtered.map((classroom, i) => {
                        const p = palettes[classrooms.indexOf(classroom) % palettes.length]
                        return (
                          <Link key={classroom.id} href={`/classrooms/${classroom.id}`}>
                            <div
                              className={`relative h-[52px] rounded-xl overflow-hidden bg-gradient-to-br ${p.grad} group cursor-pointer transition-all duration-200 hover:scale-[1.03] hover:brightness-110 shadow-md`}
                            >
                              {classroom.banner_url ? (
                                <img src={classroom.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                              ) : (
                                <svg className="absolute inset-0 w-full h-full opacity-[0.08]" xmlns="http://www.w3.org/2000/svg">
                                  <defs>
                                    <pattern id={`ag-${classrooms.indexOf(classroom)}`} x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
                                      <circle cx="1.5" cy="1.5" r="1" fill="white" />
                                    </pattern>
                                  </defs>
                                  <rect width="100%" height="100%" fill={`url(#ag-${classrooms.indexOf(classroom)})`} />
                                </svg>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
                              <div className="absolute inset-0 p-2 flex flex-col justify-end">
                                <p
                                  className="font-bold text-white text-[12px] leading-tight line-clamp-1"
                                  style={{ textShadow: '0 0 16px rgba(255,255,255,0.4), 0 1px 3px rgba(0,0,0,0.4)' }}
                                >{classroom.title}</p>
                              </div>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                  {hasMore && (
                    <button
                      onClick={() => setShowAllClassrooms(true)}
                      className="mt-2.5 w-full py-2 text-xs font-medium text-cyan-600 hover:text-cyan-700 bg-cyan-50 hover:bg-cyan-100 border border-cyan-100 rounded-xl transition-colors"
                    >
                      Show all classrooms ({classrooms.length})
                    </button>
                  )}
                </>
              )
            })()}
          </section>

          {/* Gamified dashboard — greeting, Edu Points columns — students only */}
          {isStudent && <StudentGameSection userId={user.id} userName={profile.full_name ?? 'there'} />}

          {/* My School Work Manager — students only */}
          {isStudent && (
            <section className="glass rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-slate-100/80">
                <div className="p-1.5 bg-cyan-100 rounded-lg">
                  <CalendarDays size={14} className="text-cyan-600" />
                </div>
                <h2 className="font-semibold text-slate-700 text-sm">My School Work Manager</h2>
              </div>
              <div className="p-4">
                {loading ? (
                  <p className="text-sm text-slate-500">Loading…</p>
                ) : (
                  <SchoolWorkManager classrooms={classrooms} userId={user.id} />
                )}
              </div>
            </section>
          )}

          {/* Report Cards — expandable */}
          <ReportCardsSection
            user={{ id: user.id }}
            profile={profile}
            isStudent={isStudent}
          />
        </div>
      </div>
    </ProtectedLayout>
  )
}

