'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import {
  BookOpen, Check, GraduationCap, Pencil, Image as ImageIcon, X, CalendarDays, Search, Flame, Trophy,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import {
  ClassroomWithDetails, fetchClassroomsForUser,
} from '@/lib/classrooms'
import { sortByLastVisited } from '@/lib/classroomVisits'
import { useAutoLoadMore } from '@/hooks/useAutoLoadMore'
import { useGridColumns } from '@/hooks/useGridColumns'
import { useStaggeredRows } from '@/hooks/useStaggeredRows'
import { classroomGridMaxHeight, classroomItemWidth, CLASSROOM_PAD_TOP_RATIO } from '@/lib/classroomGridLayout'
import ClassroomGridItems from '@/components/classrooms/ClassroomGridItems'
import { Homeroom, fetchHomeroomsForClassTeacher } from '@/lib/homerooms'
import {
  WorkWeekCalendarSkeleton, BLEED_CARD_INSET, themeFromGradient,
} from '@/components/calendar/WorkWeekCalendar'
const SchoolWorkManager  = dynamic(() => import('@/components/classrooms/SchoolWorkManager'))
const HomeroomWorkCalendar = dynamic(() => import('@/components/academics/HomeroomWorkCalendar'))
const ReportCardsSection = dynamic(() => import('@/components/academics/ReportCardsSection'))
const StudentGameSection = dynamic(() => import('@/components/academics/StudentGameSection'))
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
import { BANNER_TEXTURE_URI, swatchBackground, isDarkLum } from '@/lib/bannerStyle'

function getSessionVibes(name: string): string[] {
  const h = new Date().getHours()
  const session = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  const first = name.split(' ')[0]
  return [
    `Hey ${first}! Ready to power up this ${session}?`,
    `${first} is back — class awaits. Let's go!`,
    `Good ${session}, ${first}. Big things start with small steps.`,
    `${first} returns. Time to make this ${session} legendary.`,
    `Rise and shine, ${first}! This ${session} is all yours.`,
    `${first}, every point earned proves you showed up.`,
    `Your future self will thank you for this ${session}, ${first}.`,
    `${first} levels up this ${session}. Watch out, leaderboard!`,
    `The best students show up consistently. That's you, ${first}.`,
    `${first}, curiosity is your superpower. Use it today.`,
    `This ${session}, ${first} writes their next success story.`,
    `One great ${session} can change everything, ${first}. Go for it.`,
  ]
}

/** The same greetings cut to a single phone line — the full sentences above
 *  wrap to three lines beside the streak flame on a narrow screen, which
 *  pushes the banner tall and buries the heading. */
function getShortSessionVibes(name: string): string[] {
  const h = new Date().getHours()
  const session = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  const first = name.split(' ')[0]
  return [
    `Hey ${first}! Let's go.`,
    `${first} is back.`,
    `Good ${session}, ${first}.`,
    `Make it count, ${first}.`,
    `Rise and shine, ${first}!`,
    `You showed up, ${first}.`,
    `Small steps, big wins.`,
    `${first} levels up.`,
    `Curiosity wins, ${first}.`,
    `Own this ${session}.`,
  ]
}

function TypingGreeting({ name, dark }: { name: string; dark: boolean }) {
  // Phones get the short set; the breakpoint matches Tailwind's `sm`.
  const [isPhone, setIsPhone] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const update = () => setIsPhone(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  const vibes = useMemo(
    () => (isPhone ? getShortSessionVibes(name) : getSessionVibes(name)),
    [name, isPhone],
  )
  const [vibeIdx, setVibeIdx] = useState(0)
  const [displayed, setDisplayed] = useState('')
  const [phase, setPhase] = useState<'typing' | 'hold' | 'deleting'>('typing')

  // Crossing the breakpoint swaps the set (and its length), so restart the line
  // rather than leave half a sentence from the other set on screen.
  useEffect(() => {
    setVibeIdx(0)
    setDisplayed('')
    setPhase('typing')
  }, [vibes])

  useEffect(() => {
    const text = vibes[vibeIdx] ?? ''
    if (phase === 'typing') {
      if (displayed.length < text.length) {
        const t = setTimeout(() => setDisplayed(text.slice(0, displayed.length + 1)), 38)
        return () => clearTimeout(t)
      }
      const t = setTimeout(() => setPhase('hold'), 45000)
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
        <Flame size={44} className="text-orange-400 fill-orange-400" strokeWidth={1.2} />
      </motion.div>
      <p
        className={`font-black text-xl leading-none tabular-nums mt-0.5 ${dark ? 'text-white' : 'text-slate-800'}`}
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

/**
 * Unified section heading — a frosted gradient icon chip beside a single-line
 * display title, with an optional right-aligned action. Every academics
 * section uses the exact same chip size and title size so the four headers
 * line up vertically and read as one family.
 */
function SectionHeading({
  icon: Icon,
  chipClass,
  title,
  titleAction,
  action,
}: {
  icon: React.ElementType
  chipClass: string
  title: string
  titleAction?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4 min-h-[2.5rem]">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`icon-chip w-10 h-10 flex-shrink-0 ${chipClass}`}>
          <Icon size={18} className="relative z-10 text-white drop-shadow-sm" />
        </div>
        <h2 className="font-display text-[1.4rem] font-bold leading-none headline text-slate-900 truncate">{title}</h2>
        {titleAction && <span className="flex-shrink-0 inline-flex self-center">{titleAction}</span>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

export default function AcademicsPage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  // Classrooms section
  const [classroomSearchOpen, setClassroomSearchOpen] = useState(false)
  const [classroomSearch, setClassroomSearch] = useState('')
  const classroomSearchRef = useRef<HTMLInputElement>(null)
  // Tracks the classroom whose page is currently being navigated to, so the
  // tapped button can show instant feedback while the next route loads.
  const [navigatingId, setNavigatingId] = useState<string | null>(null)

  // Banner config state
  const [bannerCfg,     setBannerCfg]     = useState<AnnouncementBannerConfig>(ACADEMICS_BANNER_DEFAULT)
  const [pendingCfg,    setPendingCfg]    = useState<AnnouncementBannerConfig>(ACADEMICS_BANNER_DEFAULT)
  const [editingBanner, setEditingBanner] = useState(false)
  const [savingBanner,  setSavingBanner]  = useState(false)
  const [uploadingImg,  setUploadingImg]  = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [bannerLum, setBannerLum] = useState(0)
  const [bannerLoaded, setBannerLoaded] = useState(false)

  const isStudent   = profile?.role === 'student'
  const isAdmin     = profile?.role === 'admin'

  // Homerooms this account is the class teacher of — null until the lookup
  // resolves, so the "no classrooms → go home" redirect below can wait for it.
  const [homerooms, setHomerooms] = useState<Homeroom[] | null>(null)
  const isClassTeacher = !isStudent && (homerooms?.length ?? 0) > 0

  const classroomColumns = useGridColumns()
  const CLASSROOM_VISIBLE_ROWS = 4
  const CLASSROOM_LIMIT = classroomColumns * CLASSROOM_VISIBLE_ROWS
  const CLASSROOM_COL_GAP = 12
  const CLASSROOM_ROW_GAP = 15 // 25% more than the column gap, for shadow-bleed margin between rows
  const classroomsMaxHeight = classroomGridMaxHeight(CLASSROOM_VISIBLE_ROWS, CLASSROOM_ROW_GAP)
  const classroomItemWidthCss = classroomItemWidth(classroomColumns, CLASSROOM_COL_GAP)
  const {
    visibleCount: classroomVisibleCount,
    containerRef: classroomsScrollRef,
    handleScroll: handleClassroomsScroll,
  } = useAutoLoadMore({ total: classrooms.length, initialCount: CLASSROOM_LIMIT, step: 4, intervalMs: 3000, bottomBufferPx: CLASSROOM_ROW_GAP })
  const filteredClassrooms = classroomSearch
    ? classrooms.filter(c => c.title.toLowerCase().includes(classroomSearch.toLowerCase()))
    : classrooms.slice(0, classroomVisibleCount)

  // The grid deals its rows out one at a time on first load (up to the four it
  // scrolls at), and the container's height follows a row at a time with it —
  // that easing is what carries the sections below the grid down the page.
  const classroomRowCount = Math.min(
    CLASSROOM_VISIBLE_ROWS,
    Math.max(1, Math.ceil(filteredClassrooms.length / classroomColumns)),
  )
  const classroomRevealRows = useStaggeredRows(classroomRowCount, !loading)
  const classroomGridHeight = (rows: number) =>
    classroomGridMaxHeight(Math.max(1, Math.min(CLASSROOM_VISIBLE_ROWS, rows)), CLASSROOM_ROW_GAP)
  const GRID_HEIGHT_TRANSITION = 'height 320ms cubic-bezier(0.22, 1, 0.36, 1)'

  const loadClassrooms = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    try {
      // The grid shows title/banner only — no member count, so skip the
      // classroom_members roll-up that pulls every membership row.
      const enrolled = await fetchClassroomsForUser(user.id, profile.role, false, undefined, false)
      setClassrooms(sortByLastVisited(enrolled))
    } catch (error) {
      console.error('Failed to load classrooms:', error)
      setClassrooms([])
    } finally {
      setLoading(false)
    }
  }, [user, profile])

  useEffect(() => { loadClassrooms() }, [loadClassrooms])

  useEffect(() => {
    if (!user || !profile) return
    if (profile.role === 'student') { setHomerooms([]); return }
    let alive = true
    fetchHomeroomsForClassTeacher(user.id).then(hrs => { if (alive) setHomerooms(hrs) })
    return () => { alive = false }
  }, [user, profile])

  // Accounts with neither a classroom nor a homeroom of their own don't get an
  // Academics page — a class teacher keeps it for their homeroom calendar.
  useEffect(() => {
    if (!loading && homerooms !== null && classrooms.length === 0 && homerooms.length === 0) {
      router.push('/home')
    }
  }, [loading, classrooms, homerooms, router])

  useEffect(() => {
    fetchAcademicsBannerConfig().then(cfg => {
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
  const bannerOnDark = isDarkLum(bannerLum)

  const bannerBg: React.CSSProperties = activeCfg.imageUrl
    ? { backgroundImage: `url(${activeCfg.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundImage: `${BANNER_TEXTURE_URI}, linear-gradient(140deg, ${activeCfg.gradFrom} 0%, ${activeCfg.gradTo} 100%)`, backgroundSize: '180px, auto', backgroundBlendMode: 'soft-light' }

  if (!user || !profile) return null
  if (!loading && classrooms.length === 0 && (homerooms?.length ?? 0) === 0) return null

  return (
    <ProtectedLayout>
      {/* Staff work this page as a tool, so it takes the square-cornered pro
          chrome (see globals.css); students keep the rounded, frosted look. */}
      <div data-page-theme="academics" className={isStudent ? undefined : 'pro-chrome'}>

        {/* ── Immersive full-bleed banner ── */}
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
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.12),transparent_65%)] pointer-events-none" />

          {/* Decorative background icon */}
          <div className="absolute -bottom-6 -right-6 opacity-[0.07] pointer-events-none select-none">
            <GraduationCap size={180} className={bannerOnDark ? 'text-white' : 'text-slate-900'} />
          </div>

          {/* Bottom blur merge */}
          <div
            className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.07))',
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
              className="keep-round absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur-sm flex items-center justify-center transition-all"
              title="Customise banner"
            >
              <Pencil size={13} className="text-white" />
            </button>
          )}

          {/* Main header */}
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-6">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                {/* Centred, not top-aligned: the chip sits against a two-line
                    block (eyebrow + title for staff, title + greeting for a
                    student) rather than hanging off its first line. */}
                <div className="flex items-center gap-3">
                  <div className={`p-3 backdrop-blur-sm !rounded-2xl flex-shrink-0 border transition-colors duration-300 ${bannerOnDark ? 'bg-white/20 border-white/20' : 'bg-white/70 border-white/50'}`}>
                    <GraduationCap size={26} className={`transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-700'}`} />
                  </div>
                  <div className="min-w-0">
                    {!isStudent && (
                      <p
                        className={`eyebrow mb-1.5 transition-colors duration-300 ${bannerOnDark ? 'text-white/75' : 'text-slate-500'}`}
                        style={bannerOnDark ? { textShadow: '0 1px 3px rgba(0,0,0,0.45)' } : undefined}
                      >
                        Teach &amp; Track
                      </p>
                    )}
                    <h1
                      className={`font-display text-[2rem] sm:text-[2.6rem] font-bold leading-[1.04] headline transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-900'}`}
                      style={bannerOnDark ? { textShadow: '0 2px 10px rgba(0,0,0,0.4)' } : undefined}
                    >
                      Academics
                    </h1>
                    {isStudent && (
                      <TypingGreeting name={profile.full_name ?? 'there'} dark={bannerOnDark} />
                    )}
                  </div>
                </div>
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
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
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
                          style={{ backgroundImage: swatchBackground(p.from, p.to), backgroundSize: '60px, auto', backgroundBlendMode: 'soft-light' }}
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Page content (dims while the banner is being edited) ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 space-y-8" style={{ opacity: editingBanner ? 0.35 : 1, filter: editingBanner ? 'blur(1.5px)' : 'none', pointerEvents: editingBanner ? 'none' : 'auto', userSelect: editingBanner ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>

          {/* Classrooms */}
          <section>
            <SectionHeading
              icon={BookOpen}
              chipClass="bg-gradient-to-br from-cyan-400 to-teal-500"
              title={isStudent ? 'My Classrooms' : 'Classrooms'}
              action={
                <div className="flex items-center gap-2">
                  <AnimatePresence>
                    {classroomSearchOpen && (
                      <motion.div
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: 'auto' }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-1 bg-white/80 backdrop-blur-sm border border-cyan-200/70 rounded-full px-3 py-1.5 shadow-sm">
                          <input
                            ref={classroomSearchRef}
                            type="text"
                            value={classroomSearch}
                            onChange={e => setClassroomSearch(e.target.value)}
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
                  <button
                    onClick={() => {
                      setClassroomSearchOpen(v => {
                        if (v) setClassroomSearch('')
                        return !v
                      })
                      setTimeout(() => classroomSearchRef.current?.focus(), 50)
                    }}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-cyan-600 bg-white/70 hover:bg-cyan-50 border border-white/60 shadow-sm transition-colors"
                    title={classroomSearchOpen ? 'Close search' : 'Search classrooms'}
                  >
                    {classroomSearchOpen ? <X size={15} /> : <Search size={15} />}
                  </button>
                </div>
              }
            />

            {/* Loading and loaded both render this same grid container (only
                the "not enrolled" / "no search matches" states swap it out
                for a <p>), so ClassroomGridItems (below) can morph its
                skeleton placeholders into real buttons in place instead of
                the whole grid remounting — see ClassroomGridItems for how
                that keeps the swap smooth. maxHeight/gap are computed
                (classroomGridMaxHeight) from the same row-height/row-gap
                constants, so the container always fits exactly
                CLASSROOM_VISIBLE_ROWS full rows — never a partial row
                peeking in. Top edge leaves half a row-gap above the first
                row; the bottom edge leaves a full row-gap after the last row
                (padding{Top,Bottom} / scrollPadding{Top,Bottom} below) —
                both a fraction of the same rhythm as the gap between rows,
                not separately chosen buffers. -mx/px (matching the page's
                own responsive gutter: 16/24/32px) gives shadow-bleed room
                horizontally without exceeding the page's own padding (which
                would risk page-level overflow). snap-y/snap-start (on
                ClassroomButton) plus scroll-pt/scroll-pb make that same
                top/bottom spacing hold for *whichever* row a scroll settles
                on, not just the true first/last row. The initial batch
                (CLASSROOM_LIMIT) matches the live column count exactly, so
                those rows load pre-filled with no partial row; auto-load/
                scroll reveals the rest. */}
            {loading ? (
              <div
                ref={classroomsScrollRef}
                onScroll={handleClassroomsScroll}
                style={{
                  height: classroomGridHeight(1),
                  maxHeight: classroomsMaxHeight,
                  transition: GRID_HEIGHT_TRANSITION,
                  rowGap: CLASSROOM_ROW_GAP,
                  columnGap: CLASSROOM_COL_GAP,
                  paddingTop: CLASSROOM_ROW_GAP * CLASSROOM_PAD_TOP_RATIO,
                  paddingBottom: CLASSROOM_ROW_GAP,
                  scrollPaddingTop: CLASSROOM_ROW_GAP * CLASSROOM_PAD_TOP_RATIO,
                  scrollPaddingBottom: CLASSROOM_ROW_GAP,
                }}
                className="flex flex-wrap justify-center content-start overflow-y-auto overscroll-contain scrollbar-hide snap-y snap-mandatory -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
              >
                <ClassroomGridItems
                  items={null}
                  skeletonCount={classroomColumns}
                  heightClass="h-[64px]"
                  itemWidth={classroomItemWidthCss}
                  columns={classroomColumns}
                  navigatingId={navigatingId}
                  onNavigate={setNavigatingId}
                />
              </div>
            ) : classrooms.length === 0 ? (
              <p className="text-sm text-slate-500">You are not enrolled in any classrooms yet.</p>
            ) : filteredClassrooms.length === 0 && classroomSearch ? (
              <p className="text-sm text-slate-500">No classrooms match &ldquo;{classroomSearch}&rdquo;</p>
            ) : (
              <div
                ref={classroomSearch ? undefined : classroomsScrollRef}
                onScroll={classroomSearch ? undefined : handleClassroomsScroll}
                style={{
                  height: classroomGridHeight(Math.min(classroomRowCount, classroomRevealRows)),
                  maxHeight: classroomsMaxHeight,
                  transition: GRID_HEIGHT_TRANSITION,
                  rowGap: CLASSROOM_ROW_GAP,
                  columnGap: CLASSROOM_COL_GAP,
                  paddingTop: CLASSROOM_ROW_GAP * CLASSROOM_PAD_TOP_RATIO,
                  paddingBottom: CLASSROOM_ROW_GAP,
                  scrollPaddingTop: CLASSROOM_ROW_GAP * CLASSROOM_PAD_TOP_RATIO,
                  scrollPaddingBottom: CLASSROOM_ROW_GAP,
                }}
                className="flex flex-wrap justify-center content-start overflow-y-auto overscroll-contain scrollbar-hide snap-y snap-mandatory -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
              >
                <ClassroomGridItems
                  items={filteredClassrooms.map(classroom => ({ classroom }))}
                  skeletonCount={classroomColumns}
                  heightClass="h-[64px]"
                  itemWidth={classroomItemWidthCss}
                  columns={classroomColumns}
                  maxRows={classroomRevealRows}
                  navigatingId={navigatingId}
                  onNavigate={setNavigatingId}
                />
              </div>
            )}
          </section>

          {/* Gamified dashboard — 3-card coverflow of per-classroom EduPoint briefs — students only */}
          {isStudent && (
            <section>
              <SectionHeading
                icon={Trophy}
                chipClass="bg-gradient-to-br from-amber-400 to-orange-500"
                title="My EduPoints"
              />
              <StudentGameSection userId={user.id} />
            </section>
          )}

          {/* School Work Calendar — a student's own work across their
              classrooms, or, for a class teacher, their homeroom's homework. */}
          {(isStudent || isClassTeacher) && (
            <section>
              <SectionHeading
                icon={CalendarDays}
                chipClass="bg-gradient-to-br from-violet-400 to-indigo-500"
                title="School Work Calendar"
              />
              {/* No card wrapper — the calendar brings its own chrome and runs
                  edge-to-edge on phones (it cancels this container's gutter). */}
              {loading ? (
                <WorkWeekCalendarSkeleton
                  theme={themeFromGradient(bannerCfg.gradFrom, bannerCfg.gradTo)}
                  rootClassName={BLEED_CARD_INSET}
                />
              ) : isStudent ? (
                <SchoolWorkManager classrooms={classrooms} userId={user.id} themeGradFrom={bannerCfg.gradFrom} themeGradTo={bannerCfg.gradTo} />
              ) : (
                <HomeroomWorkCalendar userId={user.id} homerooms={homerooms!} themeGradFrom={bannerCfg.gradFrom} themeGradTo={bannerCfg.gradTo} />
              )}
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

