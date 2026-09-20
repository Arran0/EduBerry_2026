'use client'

import React, {
  Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import {
  BookOpen, Check, GraduationCap, Pencil, Image as ImageIcon, X, CalendarDays, Search, Flame, Trophy,
  Home,
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
// Lazy, not next/dynamic: a `dynamic` component renders NOTHING while its
// chunk is in flight, which collapsed the calendar section to zero height the
// moment its data was ready — the page's own skeleton vanished, the classrooms
// jumped to the top, and the calendar's internal skeleton then pushed them back
// down. React.lazy lets the page own that gap with a Suspense fallback: the
// same skeleton, with the same theme, so nothing moves at all.
const SchoolWorkManager  = lazy(() => import('@/components/classrooms/SchoolWorkManager'))
const HomeroomWorkCalendar = lazy(() => import('@/components/academics/HomeroomWorkCalendar'))
const ReportCardsSection = dynamic(() => import('@/components/academics/ReportCardsSection'))
const StudentGameSection = dynamic(() => import('@/components/academics/StudentGameSection'))
import { fetchStreak } from '@/lib/gamification'
import { getShowClassroomsOnHome, setShowClassroomsOnHome } from '@/lib/homeClassroomsVisibility'
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

/** Softens the bottom edge of a scrollable grid, so an overflowing grid hints
 *  at the rows below instead of ending on a hard crop. */
const GRID_FADE_MASK: React.CSSProperties = {
  maskImage: 'linear-gradient(to bottom, #000 calc(100% - 26px), transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 26px), transparent 100%)',
}

/**
 * Columns to lay `count` items out in, given the most the width allows.
 *
 * Packing left to right strands a short last row — six items across six
 * columns is five and a lonely one. Spreading the same items over the rows
 * they already need (`ceil(count / rows)`) gives 3 + 3 instead, 4 + 3 for
 * seven, and leaves a full grid untouched. A single row is left alone: two
 * items should stay two pills, not stretch to half the page each.
 */
function balancedColumns(count: number, maxColumns: number): number {
  if (count <= maxColumns) return maxColumns
  const rows = Math.ceil(count / maxColumns)
  return Math.ceil(count / rows)
}

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
 * display title, a hairline rule running out to the section's action, and an
 * optional right-aligned action. Every academics section uses the exact same
 * chip size and title size so the four headers line up vertically and read as
 * one family; the rule is what ties a heading to the full width of the panel
 * beneath it without costing a pixel of height.
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
    <div className="flex items-center gap-3 mb-4 min-h-[2.5rem]">
      <div className={`icon-chip w-10 h-10 flex-shrink-0 ${chipClass}`}>
        <Icon size={18} className="relative z-10 text-white drop-shadow-sm" />
      </div>
      {/* Title and its action share a baseline row, so a glyph beside the
          title sits on the title's baseline rather than floating at the
          centre of the taller chip row. */}
      <div className="flex items-baseline gap-2 min-w-0">
        <h2 className="font-display text-[1.4rem] font-bold leading-none headline text-slate-900 truncate">{title}</h2>
        {titleAction && <span className="flex-shrink-0 inline-flex">{titleAction}</span>}
      </div>
      {/* Hairline rule — fades out as it travels, so it reads as the heading
          settling onto the panel rather than a divider bolted across it. */}
      <div
        className="flex-1 h-px min-w-[1rem]"
        style={{ background: 'linear-gradient(to right, rgba(148,163,184,0.45), rgba(148,163,184,0))' }}
        aria-hidden
      />
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

/**
 * An empty state with the weight of a panel rather than a stray line of grey
 * text — the same frosted card the sections themselves sit in.
 */
function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: React.ElementType
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    // Near-solid rather than the frosted .glass-card: over the page's own cyan
    // wash a 30%-white card all but disappears, and an empty state that reads
    // as an empty box is worse than the line of text it replaced.
    <div className="rounded-[1.5rem] px-6 py-9 text-center bg-white/85 backdrop-blur-xl border border-white/70 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)]">
      <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200/70 flex items-center justify-center mx-auto mb-3">
        <Icon size={22} className="text-slate-400" />
      </div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {hint && <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/**
 * Animates its own height to whatever its content currently needs, so a slot
 * whose contents swap — skeleton → real calendar, or a panel opening inside it
 * — eases between the two sizes instead of snapping and shoving the rest of the
 * page. Height is measured off the content, never guessed.
 *
 * The horizontal padding/negative-margin pair is what lets `overflow: hidden`
 * (needed to clip during a shrink) coexist with a child that deliberately
 * breaks out of the page gutter: the clip box is widened to exactly where that
 * child's full-bleed edge lands, so nothing is actually cut off.
 */
function SmoothHeight({ children }: { children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const measure = () => setHeight(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      // Until the first measurement lands, height is `auto` — the content must
      // never animate up from nothing on first paint.
      style={{
        height,
        overflow: 'hidden',
        transition: 'height 380ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      className="-mx-4 px-4 sm:-mx-1 sm:px-1"
    >
      <div ref={inner}>{children}</div>
    </div>
  )
}

/** Sections rise into place in order on first paint — a quarter-second of
 *  sequence that makes the page feel assembled rather than dumped.
 *  `wrapper` renders a plain div for a child that is already a <section>. */
function RevealSection({
  index, wrapper = false, children,
}: { index: number; wrapper?: boolean; children: React.ReactNode }) {
  const Tag = wrapper ? motion.div : motion.section
  return (
    <Tag
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: index * 0.07 }}
    >
      {children}
    </Tag>
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

  // The home page hides the classroom buttons unless the account opts in from
  // the heading toggle below (see homeClassroomsVisibility for the default).
  const [showOnHome, setShowOnHomeState] = useState(false)
  useEffect(() => {
    if (user) setShowOnHomeState(getShowClassroomsOnHome(user.id))
  }, [user])
  const toggleShowOnHome = () => {
    if (!user) return
    const next = !showOnHome
    setShowOnHomeState(next)
    setShowClassroomsOnHome(user.id, next)
  }

  // Homerooms this account is the class teacher of — null until the lookup
  // resolves, so the "no classrooms → go home" redirect below can wait for it.
  const [homerooms, setHomerooms] = useState<Homeroom[] | null>(null)
  const isClassTeacher = !isStudent && (homerooms?.length ?? 0) > 0

  // A full-page grid: it keeps adding columns past `lg` rather than stretching
  // four pills across a 1536px page.
  const classroomColumns = useGridColumns(true)
  const CLASSROOM_VISIBLE_ROWS = 4
  const CLASSROOM_LIMIT = classroomColumns * CLASSROOM_VISIBLE_ROWS
  const CLASSROOM_COL_GAP = 12
  const CLASSROOM_ROW_GAP = 15 // 25% more than the column gap, for shadow-bleed margin between rows
  const classroomsMaxHeight = classroomGridMaxHeight(CLASSROOM_VISIBLE_ROWS, CLASSROOM_ROW_GAP)
  const {
    visibleCount: classroomVisibleCount,
    containerRef: classroomsScrollRef,
    handleScroll: handleClassroomsScroll,
  } = useAutoLoadMore({ total: classrooms.length, initialCount: CLASSROOM_LIMIT, step: 4, intervalMs: 3000, bottomBufferPx: CLASSROOM_ROW_GAP })
  const filteredClassrooms = classroomSearch
    ? classrooms.filter(c => c.title.toLowerCase().includes(classroomSearch.toLowerCase()))
    : classrooms.slice(0, classroomVisibleCount)

  // Columns are balanced across the rows they actually fill rather than packed
  // left to right: six classrooms in a six-wide grid used to run five across
  // and one stranded underneath, where 3 + 3 reads as a block. Only ever
  // narrows the grid, and only when it wraps — a single row keeps the full
  // count so two classrooms stay two pills rather than stretching to halves.
  const gridColumns = balancedColumns(filteredClassrooms.length, classroomColumns)
  const classroomItemWidthCss = classroomItemWidth(gridColumns, CLASSROOM_COL_GAP)

  // The grid deals its rows out one at a time on first load (up to the four it
  // scrolls at), and the container's height follows a row at a time with it —
  // that easing is what carries the sections below the grid down the page.
  const classroomRowCount = Math.min(
    CLASSROOM_VISIBLE_ROWS,
    Math.max(1, Math.ceil(filteredClassrooms.length / gridColumns)),
  )
  const classroomRevealRows = useStaggeredRows(classroomRowCount, !loading)
  const classroomGridHeight = (rows: number) =>
    classroomGridMaxHeight(Math.max(1, Math.min(CLASSROOM_VISIBLE_ROWS, rows)), CLASSROOM_ROW_GAP)
  const GRID_HEIGHT_TRANSITION = 'height 320ms cubic-bezier(0.22, 1, 0.36, 1)'
  // True once the grid holds more rows than it can show — see GRID_FADE_MASK.
  const classroomGridScrolls =
    Math.ceil(filteredClassrooms.length / gridColumns) > CLASSROOM_VISIBLE_ROWS

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

  // One skeleton element for both the "still loading" and the "chunk in
  // flight" states, so the two are pixel-identical and swapping between them
  // is invisible.
  const calendarSkeleton = (
    <WorkWeekCalendarSkeleton
      theme={themeFromGradient(bannerCfg.gradFrom, bannerCfg.gradTo)}
      rootClassName={BLEED_CARD_INSET}
    />
  )

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

          {/* School Work Calendar — a student's own work across their
              classrooms, or, for a class teacher, their homeroom's homework. */}
          {(isStudent || isClassTeacher) && (
            <RevealSection index={0}>
              <SectionHeading
                icon={CalendarDays}
                chipClass="bg-gradient-to-br from-violet-400 to-indigo-500"
                title="School Work Calendar"
              />
              {/* No card wrapper — the calendar brings its own chrome and runs
                  edge-to-edge on phones (it cancels this container's gutter).
                  SmoothHeight eases the slot between the skeleton's height and
                  the loaded calendar's, and the Suspense fallback is that same
                  skeleton, so the swap is a resize and never a gap. */}
              <SmoothHeight>
                {loading ? (
                  calendarSkeleton
                ) : (
                  <Suspense fallback={calendarSkeleton}>
                    {isStudent ? (
                      <SchoolWorkManager classrooms={classrooms} userId={user.id} themeGradFrom={bannerCfg.gradFrom} themeGradTo={bannerCfg.gradTo} />
                    ) : (
                      <HomeroomWorkCalendar userId={user.id} homerooms={homerooms!} themeGradFrom={bannerCfg.gradFrom} themeGradTo={bannerCfg.gradTo} />
                    )}
                  </Suspense>
                )}
              </SmoothHeight>
            </RevealSection>
          )}

          {/* Classrooms */}
          <RevealSection index={1}>
            <SectionHeading
              icon={BookOpen}
              chipClass="bg-gradient-to-br from-cyan-400 to-teal-500"
              title={isStudent ? 'My Classrooms' : 'Classrooms'}
              titleAction={
                <button
                  onClick={toggleShowOnHome}
                  // Bare glyph, no chrome: bright blue when the home page
                  // shows the classrooms, grey when it doesn't. Padding (not a
                  // fixed box) keeps the target comfortable while leaving the
                  // glyph itself on the heading's baseline — see SectionHeading.
                  className={`inline-flex items-center justify-center p-1.5 -m-1.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 ${
                    showOnHome
                      ? 'text-sky-500 hover:text-sky-600'
                      : 'text-slate-300 hover:text-slate-400'
                  }`}
                  title={showOnHome
                    ? 'Shown on the home page — click to hide'
                    : 'Hidden on the home page — click to show'}
                  aria-pressed={showOnHome}
                  aria-label={showOnHome
                    ? 'Hide classrooms on the home page'
                    : 'Show classrooms on the home page'}
                >
                  <Home size={16} />
                </button>
              }
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
                own responsive gutter: 16/24px) gives shadow-bleed room
                horizontally without exceeding the page's own padding (which
                would risk page-level overflow). At lg the grid sits in the
                left half of a two-column row, so the bleed shrinks to 8px —
                enough for the shadow, well inside the column gap, and no
                longer reaching under the digest beside it. snap-y/snap-start (on
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
                className="flex flex-wrap justify-center content-start overflow-y-auto overscroll-contain scrollbar-hide snap-y snap-mandatory -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-2 lg:px-2"
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
              <EmptyState
                icon={BookOpen}
                title="No classrooms yet"
                hint="You are not enrolled in any classrooms. Once a teacher adds you, they will appear here."
              />
            ) : filteredClassrooms.length === 0 && classroomSearch ? (
              <EmptyState
                icon={Search}
                title={`No classrooms match “${classroomSearch}”`}
                hint="Try a shorter search, or clear it to see all of your classrooms."
                action={
                  <button
                    onClick={() => setClassroomSearch('')}
                    className="text-xs font-semibold text-cyan-700 bg-white/80 border border-white/80 shadow-sm px-3 py-1.5 rounded-full hover:bg-white transition-colors"
                  >
                    Clear search
                  </button>
                }
              />
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
                  // The scrollbar is hidden, so a grid deeper than its four
                  // visible rows softens out at the bottom edge instead of
                  // ending on a hard crop that reads as the last row.
                  ...(classroomGridScrolls ? GRID_FADE_MASK : null),
                }}
                className="flex flex-wrap justify-center content-start overflow-y-auto overscroll-contain scrollbar-hide snap-y snap-mandatory -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-2 lg:px-2"
              >
                <ClassroomGridItems
                  items={filteredClassrooms.map(classroom => ({ classroom }))}
                  skeletonCount={classroomColumns}
                  heightClass="h-[64px]"
                  itemWidth={classroomItemWidthCss}
                  columns={gridColumns}
                  maxRows={classroomRevealRows}
                  navigatingId={navigatingId}
                  onNavigate={setNavigatingId}
                />
              </div>
            )}
          </RevealSection>

          {/* Gamified dashboard — 3-card coverflow of per-classroom EduPoint
              briefs — students only. The strip sits in a bordered card rather
              than running loose across the page, so it reads as one section
              and sizes its cards to that card. */}
          {isStudent && (
            <RevealSection index={2}>
              <SectionHeading
                icon={Trophy}
                chipClass="bg-gradient-to-br from-amber-400 to-orange-500"
                title="My EduPoints"
              />
              <div className="glass-card rounded-[1.5rem] px-3 py-4 sm:px-5">
                <StudentGameSection userId={user.id} />
              </div>
            </RevealSection>
          )}

          {/* Report Cards — the foot of the page, for every role. */}
          <RevealSection index={3} wrapper>
            <ReportCardsSection
              user={{ id: user.id }}
              profile={profile}
              isStudent={isStudent}
            />
          </RevealSection>
        </div>
      </div>
    </ProtectedLayout>
  )
}

