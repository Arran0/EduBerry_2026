'use client'

import React, {
  Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import {
  BookOpen, Check, GraduationCap, Pencil, Image as ImageIcon, X, CalendarDays, Search, Flame, Trophy,
  Home, ChevronDown,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import {
  ClassroomWithDetails, fetchClassroomsForUser,
} from '@/lib/classrooms'
import { sortByLastVisited } from '@/lib/classroomVisits'
import ClassroomTile, { ClassroomTileSkeleton } from '@/components/classrooms/ClassroomTile'
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

/** Rows of classrooms shown before "Show all". */
const CLASSROOM_ROWS = 3

/** Columns the classroom list runs at each width — mirrors the grid classes
 *  below. A student's list shares the row with EduPoints from `xl`. */
function useTileColumns(beside: boolean): number {
  const [cols, setCols] = useState(2)
  useEffect(() => {
    const steps: [string, number][] = beside
      ? [['(min-width: 1280px)', 3], ['(min-width: 1024px)', 4], ['(min-width: 640px)', 3]]
      : [['(min-width: 1536px)', 5], ['(min-width: 1024px)', 4], ['(min-width: 640px)', 3]]
    const mqs = steps.map(([q, n]) => [window.matchMedia(q), n] as const)
    const update = () => setCols(mqs.find(([mq]) => mq.matches)?.[1] ?? 2)
    update()
    mqs.forEach(([mq]) => mq.addEventListener('change', update))
    return () => mqs.forEach(([mq]) => mq.removeEventListener('change', update))
  }, [beside])
  return cols
}

function greeting(name: string): string {
  const h = new Date().getHours()
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return `${part}, ${name.split(' ')[0]}`
}

/** A student's streak as a small chip in the banner. */
function StreakChip({ userId, dark }: { userId: string; dark: boolean }) {
  const [days, setDays] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    fetchStreak(userId).then(s => { if (alive) setDays(s?.current_streak ?? 0) })
    return () => { alive = false }
  }, [userId])
  return (
    <div
      className={`keep-round flex-shrink-0 inline-flex items-center gap-1.5 rounded-full pl-2 pr-3 py-1.5 ${
        dark ? 'bg-white/18 text-white ring-1 ring-inset ring-white/25' : 'bg-white/75 text-slate-800 ring-1 ring-inset ring-white'
      }`}
      title="Days in a row you have completed work"
    >
      <Flame size={18} className="text-orange-400 fill-orange-400" strokeWidth={1.4} />
      <span className="text-[15px] font-bold tabular-nums leading-none">{days ?? '–'}</span>
      <span className={`text-[11px] font-medium leading-none ${dark ? 'text-white/80' : 'text-slate-500'}`}>
        day{days === 1 ? '' : 's'}
      </span>
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

  const [classroomSearch, setClassroomSearch] = useState('')
  const [showAllClassrooms, setShowAllClassrooms] = useState(false)
  // The classroom being opened, so its tile shows a spinner while the route loads.
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

  const tileColumns = useTileColumns(isStudent)
  const collapsedCount = tileColumns * CLASSROOM_ROWS

  const searchTerm = classroomSearch.trim().toLowerCase()
  const matchingClassrooms = useMemo(
    () => searchTerm
      ? classrooms.filter(c =>
          c.title.toLowerCase().includes(searchTerm) || (c.subject ?? '').toLowerCase().includes(searchTerm))
      : classrooms,
    [classrooms, searchTerm],
  )
  const visibleClassrooms = searchTerm || showAllClassrooms
    ? matchingClassrooms
    : matchingClassrooms.slice(0, collapsedCount)
  const hiddenCount = matchingClassrooms.length - visibleClassrooms.length

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
      {/* Staff work this page as a tool, so it takes the square-cornered pro
          chrome (see globals.css); students keep the rounded look. */}
      <div data-page-theme="academics" className={isStudent ? undefined : 'pro-chrome'}>

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
              {isStudent && <StreakChip userId={user.id} dark={onDark} />}
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

          {/* Classrooms — and, for a student, their EduPoints beside them on
              a wide screen. */}
          <div className={isStudent ? 'grid gap-7 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-start' : ''}>
            <section className="min-w-0">
              <SectionHeading
                icon={BookOpen}
                chipClass="bg-gradient-to-br from-cyan-400 to-teal-500"
                title="Classrooms"
                count={loading ? null : classrooms.length}
                titleAction={
                  <button
                    onClick={toggleShowOnHome}
                    className={`keep-round inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 ${
                      showOnHome ? 'text-sky-600 bg-sky-100/80 hover:bg-sky-100' : 'text-slate-400 hover:text-slate-600 hover:bg-white/70'
                    }`}
                    title={showOnHome ? 'Shown on the home page. Click to hide.' : 'Not shown on the home page. Click to show.'}
                    aria-pressed={showOnHome}
                    aria-label={showOnHome ? 'Hide classrooms on the home page' : 'Show classrooms on the home page'}
                  >
                    <Home size={15} />
                  </button>
                }
                action={classrooms.length > collapsedCount || classroomSearch ? (
                  <label className="keep-round relative flex items-center w-full sm:w-56">
                    <Search size={14} className="absolute left-3 text-slate-400 pointer-events-none" />
                    <input
                      type="search"
                      value={classroomSearch}
                      onChange={e => setClassroomSearch(e.target.value)}
                      placeholder="Find a classroom"
                      aria-label="Find a classroom"
                      className="keep-round w-full pl-8 pr-3 py-1.5 rounded-full bg-white/85 ring-1 ring-inset ring-slate-900/10 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-[color:var(--page-primary)]/50 focus:bg-white"
                    />
                  </label>
                ) : undefined}
              />

              <div className="lg-pane p-1.5 sm:p-2.5">
                {loading ? (
                  <div className={`relative z-[3] grid grid-cols-2 sm:grid-cols-3 ${isStudent ? 'lg:grid-cols-4 xl:grid-cols-3' : 'lg:grid-cols-4 2xl:grid-cols-5'} gap-2`}>
                    {Array.from({ length: tileColumns }, (_, i) => <ClassroomTileSkeleton key={i} />)}
                  </div>
                ) : classrooms.length === 0 ? (
                  <p className="relative z-[3] px-3 py-6 text-center text-sm text-slate-600">
                    You are not in any classrooms yet. They appear here once a teacher adds you.
                  </p>
                ) : visibleClassrooms.length === 0 ? (
                  <div className="relative z-[3] px-3 py-6 text-center">
                    <p className="text-sm text-slate-600 break-words">No classroom matches “{classroomSearch}”.</p>
                    <button
                      onClick={() => setClassroomSearch('')}
                      className="keep-round mt-2 text-xs font-semibold text-cyan-700 hover:underline"
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  <div className="relative z-[3]">
                    <div className={`grid grid-cols-2 sm:grid-cols-3 ${isStudent ? 'lg:grid-cols-4 xl:grid-cols-3' : 'lg:grid-cols-4 2xl:grid-cols-5'} gap-1.5 sm:gap-2`}>
                      {visibleClassrooms.map(c => (
                        <ClassroomTile
                          key={c.id}
                          classroom={c}
                          navigating={navigatingId === c.id}
                          onNavigate={() => setNavigatingId(c.id)}
                        />
                      ))}
                    </div>
                    {(hiddenCount > 0 || (showAllClassrooms && !searchTerm && matchingClassrooms.length > collapsedCount)) && (
                      <button
                        onClick={() => setShowAllClassrooms(v => !v)}
                        className="keep-round mt-2 w-full inline-flex items-center justify-center gap-1 py-2 rounded-full text-[13px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-white/70 transition-colors"
                        aria-expanded={showAllClassrooms}
                      >
                        {showAllClassrooms ? 'Show fewer' : `Show all ${matchingClassrooms.length}`}
                        <ChevronDown size={14} className={`transition-transform ${showAllClassrooms ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>

            {isStudent && (
              <section className="min-w-0">
                <SectionHeading
                  icon={Trophy}
                  chipClass="bg-gradient-to-br from-amber-400 to-orange-500"
                  title="EduPoints"
                />
                <div className="lg-pane p-1.5 sm:p-2">
                  <div className="relative z-[3]">
                    <StudentGameSection userId={user.id} />
                  </div>
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
