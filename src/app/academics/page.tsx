'use client'

import React, {
  Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import {
  BookOpen, Check, GraduationCap, Pencil, Image as ImageIcon, X, CalendarDays, Search, Flame, Trophy,
  Home,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import {
  ClassroomWithDetails, fetchClassroomsForUser,
} from '@/lib/classrooms'
import { sortByLastVisited } from '@/lib/classroomVisits'
import ClassroomGridItems from '@/components/classrooms/ClassroomGridItems'
import { useAutoLoadMore } from '@/hooks/useAutoLoadMore'
import { useGridColumns } from '@/hooks/useGridColumns'
import { useStaggeredRows } from '@/hooks/useStaggeredRows'
import { classroomGridMaxHeight, classroomItemWidth, CLASSROOM_PAD_TOP_RATIO } from '@/lib/classroomGridLayout'
import SectionHeading from '@/components/academics/SectionHeading'
import { Homeroom, fetchHomeroomsForClassTeacher } from '@/lib/homerooms'
import {
  WorkWeekCalendarSkeleton, BLEED_CARD_INSET, themeFromGradient,
} from '@/components/calendar/WorkWeekCalendar'
// Lazy, not next/dynamic: a `dynamic` component renders NOTHING while its
// chunk is in flight, which collapsed the calendar section to zero height the
// moment its data was ready. React.lazy lets the page own that gap with a
// Suspense fallback — the same skeleton, so nothing moves.
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
  peekAcademicsBannerConfig,
  saveAcademicsBannerConfig,
  uploadSiteAsset,
} from '@/lib/pageConfig'
import { hexToLuminance, sampleImageLuminance } from '@/lib/luminance'
import { BANNER_TEXTURE_URI, swatchBackground, isDarkLum } from '@/lib/bannerStyle'
import { safeSrc } from '@/lib/safeUrl'

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

/** An empty state with the weight of a panel rather than a stray line of grey text. */
function EmptyState({
  icon: Icon, title, hint, action,
}: {
  icon: React.ElementType
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-[1.5rem] px-6 py-9 text-center bg-white/85 border border-white/70 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)]">
      <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200/70 flex items-center justify-center mx-auto mb-3">
        <Icon size={22} className="text-slate-400" />
      </div>
      <p className="text-sm font-semibold text-slate-700 break-words">{title}</p>
      {hint && <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function greeting(name: string): string {
  const h = new Date().getHours()
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return `${part}, ${name.split(' ')[0]}`
}

/** A student's streak: the flame that flickers, with the day count under it. */
function StreakHeaderItem({ userId, dark }: { userId: string; dark: boolean }) {
  const [days, setDays] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    fetchStreak(userId).then(s => { if (alive) setDays(s?.current_streak ?? 0) })
    return () => { alive = false }
  }, [userId])
  return (
    <div className="flex flex-col items-center flex-shrink-0 ml-1" title="Days in a row you have completed work">
      <motion.div
        animate={{ scale: [1, 1.22, 0.96, 1], rotate: [-5, 5, -3, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ filter: 'drop-shadow(0 0 14px rgba(251,146,60,0.9))' }}
      >
        <Flame size={40} className="text-orange-400 fill-orange-400" strokeWidth={1.2} />
      </motion.div>
      <p
        className={`font-black text-xl leading-none tabular-nums mt-0.5 ${dark ? 'text-white' : 'text-slate-800'}`}
        style={dark
          ? { textShadow: '0 0 16px rgba(251,146,60,0.8), 0 1px 4px rgba(0,0,0,0.5)' }
          : { textShadow: '0 0 8px rgba(251,146,60,0.5)' }}
      >
        {days ?? '·'}
      </p>
      <p className={`text-[10px] font-bold mt-0.5 ${dark ? 'text-white/90' : 'text-slate-500'}`}>
        day{days === 1 ? '' : 's'}
      </p>
    </div>
  )
}

/**
 * Animates its own height to whatever its content needs, so the calendar slot
 * eases between the skeleton and the loaded calendar instead of snapping. The
 * padding/negative-margin pair widens the clip box to where the calendar's
 * full-bleed phone edge lands, so nothing is cut off.
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
      style={{ height, overflow: 'hidden', transition: 'height 320ms cubic-bezier(0.22, 1, 0.36, 1)' }}
      className="-mx-4 px-4 sm:-mx-1 sm:px-1"
    >
      <div ref={inner}>{children}</div>
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

  // Banner: painted from the settings cache on the first frame, corrected by
  // the network read below. No waiting for the image before showing anything.
  const [bannerCfg,     setBannerCfg]     = useState<AnnouncementBannerConfig>(() => peekAcademicsBannerConfig() ?? ACADEMICS_BANNER_DEFAULT)
  const [pendingCfg,    setPendingCfg]    = useState<AnnouncementBannerConfig>(bannerCfg)
  const [editingBanner, setEditingBanner] = useState(false)
  const [savingBanner,  setSavingBanner]  = useState(false)
  const [uploadingImg,  setUploadingImg]  = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [bannerLum, setBannerLum] = useState(0)

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
  // four pills across a 1536px page. A student's grid shares its row with
  // EduPoints from `xl`, so it stops at three there.
  const classroomColumns = useGridColumns(true, isStudent)
  const CLASSROOM_VISIBLE_ROWS = 4
  const CLASSROOM_LIMIT = classroomColumns * CLASSROOM_VISIBLE_ROWS
  const CLASSROOM_COL_GAP = 12
  const CLASSROOM_ROW_GAP = 15 // 25% more than the column gap, for shadow-bleed margin between rows
  const classroomsMaxHeight = classroomGridMaxHeight(CLASSROOM_VISIBLE_ROWS, CLASSROOM_ROW_GAP)
  // Reveal exactly one row at a time, whatever the live column count is (see
  // useGridColumns), so an auto-load always lands a full row — never a
  // part-filled one on narrow screens or a short one on wide ones.
  const {
    visibleCount: classroomVisibleCount,
    containerRef: classroomsScrollRef,
    handleScroll: handleClassroomsScroll,
  } = useAutoLoadMore({ total: classrooms.length, initialCount: CLASSROOM_LIMIT, step: classroomColumns, intervalMs: 3000, bottomBufferPx: CLASSROOM_ROW_GAP })
  const filteredClassrooms = classroomSearch
    ? classrooms.filter(c => c.title.toLowerCase().includes(classroomSearch.toLowerCase()))
    : classrooms.slice(0, classroomVisibleCount)

  // Columns are balanced across the rows they actually fill rather than packed
  // left to right (six in a six-wide grid → 3 + 3, not 5 + 1). Only ever
  // narrows the grid, and only when it wraps.
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
      // The list shows title, subject and logo only — no member count, so skip
      // the classroom_members roll-up that pulls every membership row.
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
    let alive = true
    fetchAcademicsBannerConfig().then(cfg => {
      if (!alive) return
      setBannerCfg(cfg)
      setPendingCfg(cfg)
    })
    return () => { alive = false }
  }, [])

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
  const bannerImage = safeSrc(activeCfg.imageUrl)

  // One skeleton for both "still loading" and "chunk in flight", so the swap
  // between them is invisible.
  const calendarSkeleton = (
    <WorkWeekCalendarSkeleton
      theme={themeFromGradient(bannerCfg.gradFrom, bannerCfg.gradTo)}
      rootClassName={BLEED_CARD_INSET}
    />
  )

  const _gradFrom = activeCfg.gradFrom
  const _gradTo   = activeCfg.gradTo
  useEffect(() => {
    if (bannerImage) {
      sampleImageLuminance(bannerImage, 0.6).then(setBannerLum)
    } else {
      setBannerLum((hexToLuminance(_gradFrom) + hexToLuminance(_gradTo)) / 2)
    }
  }, [bannerImage, _gradFrom, _gradTo])
  const onDark = isDarkLum(bannerLum)

  const gradientBg = `${BANNER_TEXTURE_URI}, linear-gradient(140deg, ${activeCfg.gradFrom} 0%, ${activeCfg.gradTo} 100%)`

  if (!user || !profile) return null
  if (!loading && classrooms.length === 0 && (homerooms?.length ?? 0) === 0) return null

  const showCalendar = isStudent || isClassTeacher
  const shadowText = onDark ? { textShadow: '0 1px 8px rgba(0,0,0,0.35)' } : undefined

  return (
    <ProtectedLayout>
      {/* One soft-cornered look for every role; the full-width banner is the
          one square edge. */}
      <div data-page-theme="academics">

        {/* ── Banner: a short strip, painted on the first frame ── */}
        <div
          className="relative overflow-hidden"
          style={{ backgroundImage: gradientBg, backgroundSize: '180px, auto', backgroundBlendMode: 'soft-light' }}
        >
          {bannerImage && (
            <img
              src={bannerImage}
              alt=""
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          <div className="absolute -bottom-8 -right-6 opacity-[0.08] pointer-events-none select-none" aria-hidden>
            <GraduationCap size={150} className={onDark ? 'text-white' : 'text-slate-900'} />
          </div>

          <div className="relative max-w-7xl 2xl:max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 !rounded-2xl flex-shrink-0 ${onDark ? 'bg-white/20 ring-1 ring-inset ring-white/25' : 'bg-white/70 ring-1 ring-inset ring-white'}`}>
                <GraduationCap size={22} className={onDark ? 'text-white' : 'text-slate-700'} />
              </div>
              <div className="min-w-0 flex-1">
                <h1
                  className={`font-display text-[1.6rem] sm:text-[2rem] font-bold leading-tight break-words ${onDark ? 'text-white' : 'text-slate-900'}`}
                  style={shadowText}
                >
                  Academics
                </h1>
                <p className={`text-[13px] sm:text-sm font-medium leading-snug break-words ${onDark ? 'text-white/90' : 'text-slate-600'}`} style={shadowText}>
                  {isStudent
                    ? greeting(profile.full_name ?? 'there')
                    : isClassTeacher
                      ? 'Your classrooms, your homeroom’s homework and report cards'
                      : 'Your classrooms and report cards'}
                </p>
              </div>
              {isStudent && <StreakHeaderItem userId={user.id} dark={onDark} />}
              {isAdmin && !editingBanner && (
                <button
                  onClick={openEditor}
                  className="keep-round flex-shrink-0 w-9 h-9 rounded-full bg-black/25 hover:bg-black/40 flex items-center justify-center transition-colors"
                  title="Change banner"
                  aria-label="Change banner"
                >
                  <Pencil size={14} className="text-white" />
                </button>
              )}
            </div>
          </div>

          {/* Banner editor (admin only) */}
          <AnimatePresence initial={false}>
            {editingBanner && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="relative overflow-hidden border-t border-white/20 bg-black/35"
              >
                <div className="max-w-7xl 2xl:max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-2.5">
                  <span className="text-white/80 text-[12px] font-semibold mr-1">Banner colour</span>
                  {BANNER_PRESETS.map(p => {
                    const active = !pendingCfg.imageUrl && pendingCfg.gradFrom === p.from && pendingCfg.gradTo === p.to
                    return (
                      <button
                        key={p.label}
                        title={p.label}
                        aria-label={p.label}
                        aria-pressed={active}
                        onClick={() => setPendingCfg({ gradFrom: p.from, gradTo: p.to, imageUrl: '' })}
                        className={`keep-round w-8 h-8 rounded-full border-2 transition-transform flex-shrink-0 ${
                          active ? 'border-white scale-110 shadow-lg' : 'border-white/30 hover:border-white/70 hover:scale-105'
                        }`}
                        style={{ backgroundImage: swatchBackground(p.from, p.to), backgroundSize: '60px, auto', backgroundBlendMode: 'soft-light' }}
                      />
                    )
                  })}
                  <label className={`keep-round inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold rounded-full cursor-pointer transition-colors ${uploadingImg ? 'opacity-60 pointer-events-none' : ''}`}>
                    <ImageIcon size={13} />
                    {uploadingImg ? 'Uploading…' : 'Image'}
                    <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={handleImageUpload} />
                  </label>
                  {pendingCfg.imageUrl && (
                    <button
                      onClick={() => setPendingCfg(prev => ({ ...prev, imageUrl: '' }))}
                      className="keep-round inline-flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-medium rounded-full transition-colors"
                    >
                      <X size={11} /> Remove image
                    </button>
                  )}
                  <div className="flex items-center gap-2 ml-auto">
                    <button onClick={cancelEdit} className="keep-round px-3 py-1.5 text-white/80 hover:text-white text-xs font-semibold rounded-full ring-1 ring-inset ring-white/25 hover:bg-white/10 transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={savingBanner}
                      className="keep-round inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white text-slate-800 text-xs font-bold rounded-full hover:bg-slate-50 transition-colors disabled:opacity-60"
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

        {/* ── Page content (dims while the banner is being edited) ── */}
        <div
          className="max-w-7xl 2xl:max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-10 space-y-7"
          style={{ opacity: editingBanner ? 0.35 : 1, pointerEvents: editingBanner ? 'none' : 'auto', transition: 'opacity 0.2s ease' }}
          aria-hidden={editingBanner || undefined}
        >

          {/* Work calendar — a student's own work across their classrooms,
              or, for a class teacher, their homeroom's homework. */}
          {showCalendar && (
            <section>
              <SectionHeading
                icon={CalendarDays}
                chipClass="bg-gradient-to-br from-violet-400 to-indigo-500"
                title={isStudent ? 'Work calendar' : 'Homeroom homework'}
              />
              {/* No card wrapper — the calendar brings its own chrome and runs
                  edge to edge on phones. */}
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
            </section>
          )}

          {/* Classrooms — and, for a student, their EduPoints beside them from
              `xl`. Side by side the two sit on matching glass decks that
              stretch to one height, so neither reads as a stray box. */}
          <div className={isStudent ? 'grid gap-7 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] xl:items-stretch' : ''}>
            <section className="min-w-0 flex flex-col">
              <SectionHeading
                icon={BookOpen}
                chipClass="bg-gradient-to-br from-cyan-400 to-teal-500"
                title={isStudent ? 'My classrooms' : 'Classrooms'}
                titleAction={
                  <button
                    onClick={toggleShowOnHome}
                    // Bare glyph: bright blue when the home page shows the
                    // classrooms, grey when it doesn't.
                    className={`keep-round inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 ${
                      showOnHome ? 'text-sky-500 hover:text-sky-600' : 'text-slate-300 hover:text-slate-400'
                    }`}
                    title={showOnHome ? 'Shown on the home page. Click to hide.' : 'Not shown on the home page. Click to show.'}
                    aria-pressed={showOnHome}
                    aria-label={showOnHome ? 'Hide classrooms on the home page' : 'Show classrooms on the home page'}
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
                          <div className="keep-round flex items-center gap-1 bg-white/85 border border-cyan-200/70 rounded-full px-3 py-1.5 shadow-sm">
                            <input
                              ref={classroomSearchRef}
                              type="text"
                              value={classroomSearch}
                              onChange={e => setClassroomSearch(e.target.value)}
                              placeholder="Search classrooms"
                              aria-label="Search classrooms"
                              className="text-xs text-slate-700 placeholder:text-slate-400 bg-transparent focus:outline-none w-32 sm:w-40"
                            />
                            {classroomSearch && (
                              <button onClick={() => setClassroomSearch('')} className="text-slate-400 hover:text-slate-600 flex-shrink-0" aria-label="Clear search">
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
                      className="lg-control keep-round w-8 h-8 hover:text-cyan-600"
                      title={classroomSearchOpen ? 'Close search' : 'Search classrooms'}
                      aria-label={classroomSearchOpen ? 'Close search' : 'Search classrooms'}
                    >
                      {classroomSearchOpen ? <X size={15} /> : <Search size={15} />}
                    </button>
                  </div>
                }
              />

              <div className={isStudent ? 'ac-deck flex-1 flex flex-col justify-center' : ''}>
                {/* Loading and loaded both render this same grid container, so
                    ClassroomGridItems can morph its skeleton placeholders into
                    real buttons in place instead of the grid remounting. Its
                    height is computed (classroomGridMaxHeight) from the row
                    height and gap, so it always fits whole rows — never a
                    partial one peeking in — and snap-y with scroll padding
                    keeps that rhythm on whichever row a scroll settles on.
                    The -mx/px pair gives the pills' shadows room to bleed
                    without widening the page. */}
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
                    className={`flex flex-wrap justify-center content-start overflow-y-auto overscroll-contain scrollbar-hide snap-y snap-mandatory -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-2 lg:px-2 ${isStudent ? 'xl:mx-0 xl:px-3' : ''}`}
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
                    hint="A classroom appears here once a teacher adds you to it."
                  />
                ) : filteredClassrooms.length === 0 && classroomSearch ? (
                  <EmptyState
                    icon={Search}
                    title={`No classroom matches “${classroomSearch}”`}
                    hint="Try a shorter search, or clear it to see every classroom."
                    action={
                      <button
                        onClick={() => setClassroomSearch('')}
                        className="keep-round text-xs font-semibold text-cyan-700 bg-white/80 border border-white/80 shadow-sm px-3 py-1.5 rounded-full hover:bg-white transition-colors"
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
                    className={`flex flex-wrap justify-center content-start overflow-y-auto overscroll-contain scrollbar-hide snap-y snap-mandatory -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-2 lg:px-2 ${isStudent ? 'xl:mx-0 xl:px-3' : ''}`}
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
              </div>
            </section>

            {isStudent && (
              <section className="min-w-0 flex flex-col">
                <SectionHeading
                  icon={Trophy}
                  chipClass="bg-gradient-to-br from-amber-400 to-orange-500"
                  title="My EduPoints"
                />
                <div className="glass-card ac-deck rounded-[1.5rem] px-3 py-4 sm:px-5 flex-1 flex flex-col justify-center">
                  <StudentGameSection userId={user.id} />
                </div>
              </section>
            )}
          </div>

          {/* Report cards — the foot of the page, for every role. */}
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
