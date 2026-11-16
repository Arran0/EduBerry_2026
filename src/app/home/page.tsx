'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import { motion, animate, useMotionTemplate, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Bell,
  ChevronRight,
  Pencil,
  GraduationCap,
  Sun,
  Sunset,
  Moon,
  ClipboardList,
  UserCheck,
  CalendarDays,
  CalendarRange,
  CreditCard,
  Banknote,
  Bus,
  FileText,
  LayoutGrid,
  Shield,
  BarChart3,
  Users,
  Briefcase,
  CheckCircle2,
  AlertTriangle,
  Clock,
  CalendarCheck,
  Award,
  CalendarClock,
  FileSpreadsheet,
  ClipboardCheck,
} from 'lucide-react'
import { isStaffRole } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { fetchOverdueBills, type OverdueBill } from '@/lib/fees/invoices'
import { fetchHomeFeeSummary, type HomeFeeFigures, type HomeFeeHead } from '@/lib/fees/reports'
import { todayIn } from '@/lib/fees/engine/dates'
import { fetchGraderGradingQueues, GraderExamProgress } from '@/lib/exam'
import {
  fetchHolidayByDate,
  fetchAllTrackedStaff,
  fetchStaffAttendanceReportByDate,
  fetchStudentAttendanceTallyByDate,
  StaffAttendanceRecord,
} from '@/lib/attendance'
import { fetchCalendarData, isTaskCompleted } from '@/lib/tasks'
import { taskDisplayTitle } from '@/lib/taskClasses'
import { fetchMyTeamRosters, mergeTeamRosters } from '@/lib/teams'
import {
  UnreadAnnouncement,
  fetchUnreadAnnouncements,
} from '@/lib/announcements'
import { ClassroomWithDetails, fetchClassroomsForUser } from '@/lib/classrooms'
import { sortByLastVisited } from '@/lib/classroomVisits'
import { getShowTaskCalendarOnHome } from '@/lib/homeTaskCalendarVisibility'
import { getShowClassroomsOnHome } from '@/lib/homeClassroomsVisibility'
import { sampleImageLuminance } from '@/lib/luminance'
import { fetchRawSetting, saveSetting } from '@/lib/pageConfig'
import { compressImageIfNeeded } from '@/lib/imageCompression'
import BannerQuote from '@/components/home/BannerQuote'
import SchoolWorkMiniCalendar from '@/components/home/SchoolWorkMiniCalendar'
import LatestAssessmentsMiniList from '@/components/home/LatestAssessmentsMiniList'
import ReportCardsMiniList from '@/components/home/ReportCardsMiniList'
import OverdueFeesCard from '@/components/home/OverdueFeesCard'
import NotificationsSummaryCard, { NotificationsCardSkeleton } from '@/components/home/NotificationsSummaryCard'
import { SkeletonBar } from '@/components/home/HomeCardSkeletons'
import {
  createNotificationFeed,
  markNotificationRead,
  isApplicantDecision,
  onLeaveNotificationsChanged,
  NOTIF_PAGE_SIZE,
  type NotifItem,
  type NotificationFeed,
} from '@/lib/leaveNotifications'
import PushToggle from '@/components/notifications/PushToggle'
import {
  getAnnouncementsReadAt,
  markAnnouncementsRead,
  onAnnouncementReadsChanged,
} from '@/lib/announcementReads'
import LeaveAppPreviewModal from '@/components/leave/LeaveAppPreviewModal'
import { fetchLeaveApplicationById, LeaveApplicationWithDetails } from '@/lib/leave'
import TodayTimetableCard from '@/components/home/TodayTimetableCard'
import ExamsMiniCard from '@/components/home/ExamsMiniCard'
import StaffWeeklyCalendarCard from '@/components/home/StaffWeeklyCalendarCard'
import ExamGradingCard from '@/components/home/ExamGradingCard'
import TeacherAttendanceCard from '@/components/home/TeacherAttendanceCard'
import AttendanceScopesCard from '@/components/home/AttendanceScopesCard'
import { MiniCalendarItem, getWeekStart } from '@/components/home/MiniWeekCalendar'
import ClassroomGridItems from '@/components/classrooms/ClassroomGridItems'
import { HomeFeesSummary } from '@/components/home/desktop/FeesInfographicPanel'
import { HomeAttendanceCounts } from '@/components/home/desktop/AttendanceInfographicPanel'
import SchoolOverviewPanel, {
  BUS_FEE_COLOR, FEE_HEAD_COLORS, FeeHeadStat, HomeFeeBreakdown, OTHER_FEE_COLOR,
} from '@/components/home/desktop/SchoolOverviewPanel'
import HomeCardDeck, { DeckSlot } from '@/components/home/HomeCardDeck'
import AnimatedNumber from '@/components/charts/AnimatedNumber'
import { fmtINR, fmtINRExact } from '@/lib/formatMoney'
import { useIsDesktop, useIsTabletUp, useIsPhone } from '@/hooks/useMediaQuery'
import { useAutoLoadMore } from '@/hooks/useAutoLoadMore'
import { useGridColumns } from '@/hooks/useGridColumns'
import { useMidnightRefresh } from '@/hooks/useMidnightRefresh'
import { classroomGridMaxHeight, classroomItemWidth, CLASSROOM_PAD_TOP_RATIO } from '@/lib/classroomGridLayout'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.09, delayChildren: 0.04 }
  }
}

/* Reduced-motion counterparts. The CSS @media block only reaches .pressable
   and .sheen-animate; every framer-motion animation on this page (the 2 s
   banner reveal, the 9 s Ken Burns drift, these staggered springs, the strip's
   autoplay) ran regardless of the OS setting. These keep the same end state
   and drop the travel. */
const staticContainerVariants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0, delayChildren: 0 } },
}

const staticItemVariants = {
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0, transition: { duration: 0 } },
}

const itemVariants = {
  // No filter/blur here: animating it forces the browser to repaint on the
  // main thread every frame (it can't be composited like transform/opacity),
  // and doing that across several staggered sections at once dropped frames
  // badly enough to look like a low-fps video. opacity/y alone stay smooth.
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 240, damping: 26, mass: 0.9 },
  },
}

/**
 * Unified, editorial section heading — a small frosted icon chip with an
 * uppercase eyebrow kicker over a tightly-tracked display title, and an
 * optional right-aligned action. Gives every section the same premium rhythm.
 */
function SectionHeading({
  icon: Icon,
  chipClass,
  eyebrow,
  title,
  subtitle,
  action,
  dark = false,
}: {
  icon: React.ElementType
  chipClass: string
  eyebrow?: string
  title: string
  subtitle?: string
  action?: React.ReactNode
  dark?: boolean
}) {
  return (
    /* Desktop tightens this header: several sections are visible at once in the
       dashboard grid, so the titles step *down* a size and the row loses a
       little height — the numbers inside the cards carry the scale instead. */
    <div className="flex items-end justify-between mb-4 lg:mb-3">
      <div className="flex items-center gap-3 lg:gap-2.5 min-w-0">
        <div className={`icon-chip w-9 h-9 lg:w-8 lg:h-8 flex-shrink-0 ${chipClass}`}>
          <Icon size={16} className="relative z-10 text-white drop-shadow-sm" />
        </div>
        <div className="min-w-0">
          {eyebrow && (
            <p
              className={`eyebrow mb-1.5 lg:mb-1 ${dark ? 'text-white/80' : 'text-slate-500'}`}
              style={dark ? { textShadow: '0 1px 3px rgba(0,0,0,0.45)' } : undefined}
            >
              {eyebrow}
            </p>
          )}
          <h2
            className={`font-display text-[1.4rem] lg:text-[1.2rem] font-bold leading-none headline truncate ${dark ? 'text-white' : 'text-slate-900'}`}
            style={dark ? { textShadow: '0 1px 4px rgba(0,0,0,0.5)' } : undefined}
          >
            {title}
          </h2>
          {subtitle && <p className={`text-[10px] lg:text-[11px] leading-none mt-1.5 truncate ${dark ? 'text-white/80' : 'text-slate-500'}`}>{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

/** Subtle "View all" pill that inherits a tint colour. */
function ViewAllLink({ href, className = '' }: { href: string; className?: string }) {
  return (
    <Link
      href={href}
      className={`group/va inline-flex items-center gap-1 text-sm font-semibold transition-colors ${className}`}
    >
      View all
      <ChevronRight size={15} className="transition-transform duration-200 group-hover/va:translate-x-0.5" />
    </Link>
  )
}

type AdminCardView =
  | 'attendance' | 'fees' | 'bus-fees' | 'calendar' | 'assessments' | 'report-cards'
  | 'overdue-fees' | 'notifications' | 'timetable' | 'exams'
  | 'teacher-attendance' | 'task-calendar' | 'grading'

/**
 * One home card, described once. It becomes a slide in the card deck
 * (HomeCardDeck); from 768px up the calendar and the standing statistics are
 * lifted out of the deck into places of their own and reuse the same heading
 * and body.
 */
interface HomeSlot {
  key: AdminCardView
  /** Read out by the pager ("Show notifications"). */
  label: string
  heading: React.ReactNode
  body: React.ReactNode
}

/** Each card's accent: tints the deck's glass and its pager capsule while the
 *  card is up. */
const SLOT_ACCENTS: Record<AdminCardView, string> = {
  attendance: '#10b981',
  'teacher-attendance': '#10b981',
  fees: '#14b8a6',
  'bus-fees': '#f97316',
  calendar: '#8b5cf6',
  'task-calendar': '#0ea5e9',
  assessments: '#f59e0b',
  'report-cards': '#f43f5e',
  'overdue-fees': '#ef4444',
  notifications: '#0ea5e9',
  timetable: '#6366f1',
  exams: '#a855f7',
  grading: '#6366f1',
}

const countFmt = (n: number) => Math.round(n).toLocaleString('en-IN')

/** One deep-linked figure in a stat card's grid. */
function StatTile({
  href, icon: Icon, value, label, tint, loading, title,
}: {
  href: string
  icon: React.ElementType
  value: React.ReactNode
  label: string
  /** Tailwind classes for the icon chip's tint and ink. */
  tint: string
  loading: boolean
  title?: string
}) {
  return (
    <Link
      href={href}
      title={title}
      className="group flex items-center gap-2.5 px-3 py-2.5 rounded-2xl bg-slate-50/80 border border-slate-200/70 hover:bg-white hover:border-slate-300/80 hover:-translate-y-px hover:shadow-sm active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
    >
      <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${tint}`}>
        <Icon size={15} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-black text-slate-900 tabular-nums leading-none">
          {loading ? <SkeletonBar w={48} h={13} cool /> : value}
        </span>
        <span className="block text-[10.5px] font-semibold text-slate-500 mt-1 truncate">{label}</span>
      </span>
    </Link>
  )
}

/**
 * A fee ledger as a phone/tablet card: the collected figure and rate up top,
 * a paid-vs-owed bar that fills on arrival, and the four deep-linked figures
 * below it.
 */
function FeeTilesCard({
  summary, accent, collectedHref, outstandingHref, todayHref, duesLabel, loading = false,
}: {
  summary: HomeFeesSummary | null
  accent: string
  collectedHref: string
  outstandingHref: string
  todayHref: string
  duesLabel: string
  /** The ledger's fetch is still in flight: the figures shimmer rather than
   *  asserting a ₹0 nobody counted and then quietly replacing it. */
  loading?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const collected = summary?.collected ?? 0
  const outstanding = summary?.outstanding ?? 0
  const billed = collected + outstanding
  const rate = billed > 0 ? (collected / billed) * 100 : 0
  return (
    <div className="home-card pro-card h-full rounded-[20px] p-4 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Collected this year</p>
          <p className="mt-1 font-display text-[1.65rem] font-black leading-none text-slate-900 tabular-nums" title={fmtINRExact(collected)}>
            {loading ? <SkeletonBar w={110} h={24} cool /> : <AnimatedNumber value={collected} format={fmtINR} />}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
            {loading ? <SkeletonBar w={90} h={9} cool /> : <>of <span className="font-semibold text-slate-700">{fmtINR(billed)}</span> billed</>}
          </p>
        </div>
        <span
          className="flex-shrink-0 px-2.5 py-1 rounded-full text-[12px] font-black tabular-nums"
          style={{ background: `${accent}1f`, color: accent }}
        >
          {loading ? '—' : <AnimatedNumber value={rate} format={n => `${Math.round(n)}%`} />}
        </span>
      </div>

      <div className="mt-3 h-2.5 rounded-full bg-slate-200/80 overflow-hidden flex" aria-hidden>
        {!loading && billed > 0 && (
          <>
            <motion.div
              className="fee-solid h-full"
              style={{ ['--fee-c' as string]: accent, width: `${rate}%`, transformOrigin: 'left' }}
              initial={reduceMotion ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: reduceMotion ? 0 : 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
            />
            <motion.div
              className="fee-stripes h-full flex-1"
              style={{ ['--fee-c' as string]: '#f59e0b' }}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.5, delay: 0.9 }}
            />
          </>
        )}
      </div>

      <div className="mt-auto pt-3 grid grid-cols-2 gap-2">
        <StatTile
          href={collectedHref} icon={CheckCircle2} label="Collected" loading={loading}
          tint="bg-emerald-500/10 text-emerald-700" title={`Collected: ${fmtINRExact(collected)}`}
          value={<AnimatedNumber value={collected} format={fmtINR} />}
        />
        <StatTile
          href={outstandingHref} icon={Clock} label="Outstanding" loading={loading}
          tint="bg-amber-500/10 text-amber-700" title={`Outstanding: ${fmtINRExact(outstanding)}`}
          value={<AnimatedNumber value={outstanding} format={fmtINR} />}
        />
        <StatTile
          href={todayHref} icon={CalendarCheck} label="Today's collection" loading={loading}
          tint="bg-sky-500/10 text-sky-700" title={`Today's collection: ${fmtINRExact(summary?.todayCollection ?? 0)}`}
          value={<AnimatedNumber value={summary?.todayCollection ?? 0} format={fmtINR} />}
        />
        <StatTile
          href={outstandingHref} icon={Users} label={duesLabel} loading={loading}
          tint="bg-rose-500/10 text-rose-700"
          value={<AnimatedNumber value={summary?.studentsWithDues ?? 0} format={countFmt} />}
        />
      </div>
    </div>
  )
}

/** Today's attendance for admins, principals and coordinators — students
 *  over staff (a coordinator's staff row is their own teams). */
function AttendanceTilesCard({ counts }: { counts: HomeAttendanceCounts | null }) {
  // `null` is "the fetch hasn't come back" — the page never hands this a loaded
  // zero as null — so the card shimmers rather than reporting nothing recorded.
  return (
    <AttendanceScopesCard
      scopes={counts === null ? null : [
        {
          key: 'students', title: 'Students', icon: Users, tally: counts.students, href: '/more/attendance',
          hrefs: {
            present: '/more/attendance#student-present',
            absent: '/more/attendance#student-absent',
            exception: '/more/attendance#student-irregular',
          },
        },
        {
          key: 'staff', title: 'Staff', icon: Briefcase, tally: counts.staff, href: '/more/staff-attendance',
          hrefs: {
            present: '/more/staff-attendance#staff-present',
            absent: '/more/staff-attendance#staff-absent',
            exception: '/more/staff-attendance#staff-exceptions',
          },
        },
      ]}
    />
  )
}

/** This device's copy of the school's banner URL — see the banner effect. */
const BANNER_CACHE_KEY = 'home_welcome_banner_url'

const ICON_GRADIENTS = [
  'linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 55%, white), var(--brand-primary))',
  'linear-gradient(135deg, var(--brand-primary), color-mix(in srgb, var(--brand-primary) 65%, black))',
  'linear-gradient(135deg, color-mix(in srgb, var(--brand-secondary, var(--brand-primary)) 55%, white), var(--brand-secondary, var(--brand-primary)))',
  'linear-gradient(135deg, var(--brand-secondary, var(--brand-primary)), color-mix(in srgb, var(--brand-secondary, var(--brand-primary)) 65%, black))',
  'linear-gradient(135deg, var(--brand-primary), var(--brand-secondary, var(--brand-primary)))',
  'linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 75%, white), color-mix(in srgb, var(--brand-primary) 30%, white))',
  'linear-gradient(135deg, color-mix(in srgb, var(--brand-secondary, var(--brand-primary)) 75%, white), color-mix(in srgb, var(--brand-secondary, var(--brand-primary)) 30%, white))',
  'linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 60%, var(--brand-secondary, var(--brand-primary))), color-mix(in srgb, var(--brand-primary) 30%, var(--brand-secondary, var(--brand-primary))))',
  'linear-gradient(135deg, color-mix(in srgb, var(--brand-secondary, var(--brand-primary)) 40%, var(--brand-primary)), color-mix(in srgb, var(--brand-secondary, var(--brand-primary)) 80%, black))',
]

export default function HomePage() {
  const { user, profile } = useAuth()
  const isAdmin = profile ? isAdminRole(profile.role) : false
  const isCoordinator = profile?.role === 'coordinator'
  const isPrincipal = profile?.role === 'principal'
  const isAttendanceViewer = isAdmin || isPrincipal || isCoordinator
  const isStaff = profile ? isStaffRole(profile.role) : false
  const isStudent = !isStaff
  // Every role now shares the swipeable card container — students, regular
  // teachers, and attendance-viewers (admin/principal/coordinator) each get
  // their own set of slots.
  const [unreadAnnouncements, setUnreadAnnouncements] = useState<UnreadAnnouncement[]>([])
  const [welcomeBanner, setWelcomeBanner] = useState<string | null>(null)
  // Whether the band may finish sliding open: the photo has decoded, or the
  // school has none, or the fallback timer gave up waiting.
  const [bannerReady, setBannerReady] = useState(false)
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])
  const [classroomsLoaded, setClassroomsLoaded] = useState(false)
  // Tracks the classroom whose page is being navigated to, for instant tap feedback.
  const [navigatingId, setNavigatingId] = useState<string | null>(null)
  const [bannerLum, setBannerLum] = useState<number | null>(null)
  // Three hinges. All of them are read on the *first* render rather than on
  // mount (useMediaQuerySync): this whole page lives behind ProtectedLayout's
  // auth gate, so it is never part of the server HTML and has no server render
  // to agree with. Deferring to an effect only meant a 1440px window laid out
  // and committed the phone layout before flipping to the desktop one — a
  // full layout swap, and the very first thing anyone saw on opening the app.
  //
  //   gridLayout (≥768px)  the page splits: the week calendar gets a column of
  //                        its own beside the card deck, and the standing
  //                        statistics leave the deck for fixed rows below.
  //   isDesktop  (≥1024px) the split goes 2:1 side by side, and the statistics
  //                        become the one School Overview panel.
  //   isPhone    (<640px)  the hero band is deeper, relative to the viewport.
  const isDesktop = useIsDesktop()
  const gridLayout = useIsTabletUp()
  const isMobileBanner = useIsPhone()
  const [attendanceCounts, setAttendanceCounts] = useState<HomeAttendanceCounts | null>(null)
  const [schoolFeesSummary, setSchoolFeesSummary] = useState<HomeFeesSummary | null>(null)
  const [busFeesSummary, setBusFeesSummary] = useState<HomeFeesSummary | null>(null)
  // Both ledgers as one, by fee head — the desktop School Overview's bar.
  const [feeBreakdown, setFeeBreakdown] = useState<HomeFeeBreakdown | null>(null)
  // Presence data for conditional carousel slots (resolved so the slot list is
  // built before the strip settles, avoiding a visible resnap).
  const [overdueFees, setOverdueFees] = useState<OverdueBill[]>([])
  const [gradingQueues, setGradingQueues] = useState<GraderExamProgress[]>([])
  /* Whether those two fetches have returned. They decide what the card SAYS,
     never whether the card EXISTS — an empty array means "not asked yet" on the
     first render and "genuinely nothing" after, and the cards' empty states
     ("No fees overdue", "Nothing to grade") are good news that must not be
     announced before anyone has checked. Presence is settled by role alone;
     see THE LAYOUT RULE below. */
  const [overdueFeesLoaded, setOverdueFeesLoaded] = useState(false)
  const [gradingLoaded, setGradingLoaded] = useState(false)
  // Whether the unread-announcements pull has resolved yet. The notifications
  // card no longer comes and goes with it — see the layout note below — but the
  // card still needs to know whether to shimmer or to say "all caught up".
  const [announcementsLoaded, setAnnouncementsLoaded] = useState(false)
  // Team names for a coordinator's "Your team" subtitle on the admin
  // attendance card (mirrors the roster loadAttendanceCounts scopes to).
  const [coordinatorTeamNames, setCoordinatorTeamNames] = useState<string[]>([])
  const [notifItems, setNotifItems] = useState<NotifItem[]>([])
  const [notifLoading, setNotifLoading] = useState(true)
  // More unread rows behind the ones listed, and whether a page is in flight.
  const [notifHasMore, setNotifHasMore] = useState(false)
  const [notifLoadingMore, setNotifLoadingMore] = useState(false)
  // The open feed cursor — the box pulls ten rows at a time off it rather
  // than loading the whole leave history to fill a short list.
  const notifFeed = useRef<NotificationFeed | null>(null)
  const [taskItemsByDay, setTaskItemsByDay] = useState<Map<string, MiniCalendarItem[]>>(new Map())
  const [taskCalendarLoading, setTaskCalendarLoading] = useState(true)
  /* The two per-account "show this section on home" preferences.
     Both live in localStorage, so both are answerable synchronously — and they
     have to be, because each one adds or removes a whole section. Read in an
     effect (as they were) they defaulted to off for the first commit and then
     flipped, which is a layout change after the first paint: exactly what this
     page must not do. There is no SSR render to disagree with, since the page
     sits behind ProtectedLayout's auth gate. */
  const showTaskCalendarOnHome = useMemo(
    () => (user ? getShowTaskCalendarOnHome(user.id) : false),
    [user],
  )
  const showClassroomsOnHome = useMemo(
    () => (user ? getShowClassroomsOnHome(user.id) : false),
    [user],
  )
  // OS-level "reduce motion" — drives the entrance animations and the banner.
  const reduceMotion = useReducedMotion()
  // Resolved once here rather than branching at each motion.div call site.
  const pageVariants = reduceMotion ? staticContainerVariants : containerVariants
  const cardVariants = reduceMotion ? staticItemVariants : itemVariants

  /* The banner reveal, 0 → 1. One value drives all of it: the band's soft
     bottom edge (a mask that fades the photo into the page) slides from
     halfway down to the bottom, the greeting rides that edge down, and
     everything below the band is carried down with it to its resting place.
     The page below moves by transform, not by animating the band's height,
     so the slide is composited rather than re-flowing the document each
     frame; at rest the transform is dropped altogether. */
  const bannerReveal = useMotionValue(reduceMotion ? 1 : 0)
  useEffect(() => {
    if (reduceMotion) { bannerReveal.set(1); return }
    if (!bannerReady) return
    const c = animate(bannerReveal, 1, { duration: 1.15, ease: [0.65, 0, 0.35, 1], delay: 0.08 })
    return () => c.stop()
  }, [bannerReady, reduceMotion, bannerReveal])
  const bannerMaskSolid = useTransform(bannerReveal, [0, 1], [34, 84])
  const bannerMaskEnd = useTransform(bannerReveal, [0, 1], [50, 100])
  const bannerMask = useMotionTemplate`linear-gradient(to bottom, #000 ${bannerMaskSolid}%, transparent ${bannerMaskEnd}%)`
  const belowBannerTransform = useTransform(bannerReveal, p =>
    p >= 1 ? 'none' : `translateY(calc(${((p - 1) * 0.5).toFixed(4)} * var(--home-banner-h)))`)
  // While the page below is lifted, its foot sits that far above where it will
  // rest, and the strip it leaves above the sticky footer would show the body
  // gradient. A white skirt under More Apps, exactly as tall as the lift,
  // fills it; at rest it is 0 tall, so it never adds scroll.
  const belowBannerSkirtHeight = useTransform(bannerReveal, p =>
    p >= 1 ? '0px' : `calc(${((1 - p) * 0.5).toFixed(4)} * var(--home-banner-h))`)


  // The banner photo. Decoded off-screen first so it swaps in complete rather
  // than painting in bands, then cross-faded over the gradient the hero already
  // shows. Nothing here gates the page any more: the band holds its own height
  // from the first paint whether or not a school has set a photo, so there is
  // no scroll to correct afterwards — the `window.scrollTo(0, 0)` this used to
  // fire on every load existed only to undo the height animation's drift.
  //
  // The band opens half-drawn and slides the rest of the way down once the
  // photo is ready (see `bannerReady`). Waiting on the settings round trip
  // every time meant the theme gradient always showed first and the photo
  // arrived over it; the URL is remembered on this device, so from the second
  // visit on the photo is decoding (from the HTTP cache) before the settings
  // fetch has even left, and the slide reveals the photo itself.
  useEffect(() => {
    let cancelled = false
    let shownUrl: string | null = null
    const load = (url: string) => {
      if (url === shownUrl) return
      shownUrl = url
      const img = new window.Image()
      const show = () => {
        if (cancelled || shownUrl !== url) return
        setWelcomeBanner(url)
        setBannerReady(true)
      }
      img.onload = show
      img.onerror = show
      img.src = url
    }
    let cached: string | null = null
    try { cached = window.localStorage.getItem(BANNER_CACHE_KEY) } catch { /* private mode */ }
    if (cached) load(cached)
    // Never hold the band half-open on a slow network: past this the
    // gradient slides down on its own and the photo cross-fades in later.
    const fallback = window.setTimeout(() => { if (!cancelled) setBannerReady(true) }, 1400)
    fetchRawSetting<string>('welcome_banner')
      .then(url => {
        if (cancelled) return
        try {
          if (url) window.localStorage.setItem(BANNER_CACHE_KEY, url)
          else window.localStorage.removeItem(BANNER_CACHE_KEY)
        } catch { /* private mode */ }
        if (!url) { setWelcomeBanner(null); setBannerReady(true); return }
        load(url)
      })
      .catch(err => {
        console.error('Failed to load welcome banner:', err)
        if (!cancelled) setBannerReady(true)
      })
    return () => { cancelled = true; window.clearTimeout(fallback) }
  }, [])

  useEffect(() => {
    if (welcomeBanner) {
      sampleImageLuminance(welcomeBanner, 0.4).then(setBannerLum)
    } else {
      setBannerLum(null)
    }
  }, [welcomeBanner])

  const handleBannerUpload = async (file: File) => {
    const compressed = await compressImageIfNeeded(file)
    const safeName = compressed.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `site/welcome_banner_${Date.now()}_${safeName}`
    const { data, error } = await supabase.storage.from('classroom-files').upload(path, compressed, { upsert: true, cacheControl: '31536000' })
    if (error) { alert('Upload failed: ' + error.message); return }
    const { data: { publicUrl } } = supabase.storage.from('classroom-files').getPublicUrl(data.path)
    // Show the new banner immediately — persisting it site-wide can finish in
    // the background instead of blocking the admin's own view of the change.
    setWelcomeBanner(publicUrl)
    try { window.localStorage.setItem(BANNER_CACHE_KEY, publicUrl) } catch { /* private mode */ }
    saveSetting('welcome_banner', publicUrl).then(ok => {
      if (!ok) console.error('Failed to save welcome banner')
    })
  }

  /**
   * The announcements this user hasn't read, for the notifications card. Only
   * unread ones: an announcement leaves the box for good once it has been read
   * on the announcements page — whether the user got there from a headline
   * here or went to the page directly.
   *
   * `getAnnouncementsReadAt` floors the list at this device's old "everything
   * before this was seen" badge mark, so accounts that were already caught up
   * before per-row read markers existed don't open to a box full of history.
   */
  const loadAnnouncements = useCallback(async () => {
    if (!user || !profile) return
    try {
      // Visibility is RLS's job now (see lib/announcements) — the only thing
      // this caller supplies is the read floor and how many rows it wants.
      setUnreadAnnouncements(await fetchUnreadAnnouncements(getAnnouncementsReadAt(user.id), 5))
    } catch (err) {
      console.error('Failed to load announcements for home:', err)
    } finally {
      setAnnouncementsLoaded(true)
    }
  }, [user, profile])

  const loadClassrooms = useCallback(async () => {
    if (!user || !profile) return
    try {
      // The home grid never shows member_count, so skip that extra
      // classroom_members query (a full roster scan on top of the classroom rows).
      const enrolled = await fetchClassroomsForUser(user.id, profile.role, false, undefined, false)
      setClassrooms(sortByLastVisited(enrolled))
    } catch (err) {
      console.error('Failed to load classrooms for home:', err)
    } finally {
      setClassroomsLoaded(true)
    }
  }, [user, profile])

  const loadAttendanceCounts = useCallback(async () => {
    if (!isAttendanceViewer || !user) return
    const today = new Date().toISOString().split('T')[0]

    // Coordinator: scope staff counts to their own teams, aggregated across all
    // of them and including themself (matching the roster shown on the Staff
    // Attendance report), excluding hidden/banned staff so they don't inflate
    // the absent count.
    let staffIds: string[] | null = null
    if (isCoordinator) {
      const rosters = await fetchMyTeamRosters(user.id)
      setCoordinatorTeamNames(rosters.map(r => r.name))
      const team = mergeTeamRosters(rosters).filter(m => !m.attendance_hidden && !m.is_banned)
      staffIds = [...new Set([user.id, ...team.map(m => m.id)])]
    }

    // Fetch status values for today and count client-side.
    // Using { head: true } count queries can silently return 0 for specific
    // enum values due to PostgREST HEAD request behaviour; data fetches are reliable.
    const noStaff = staffIds !== null && staffIds.length === 0

    const [studentTally, allStaffRecords, holidayToday, allTracked] = await Promise.all([
      // Exact-count queries, not a raw row fetch — stays correct past
      // PostgREST's 1000-row response cap, which is what let this drift out
      // of sync with the Student Attendance report on a day with a lot of
      // records. Uses the exact same present/absent status split the report
      // itself now uses (late/on-duty present, on-leave absent).
      fetchStudentAttendanceTallyByDate(today),
      // Already excludes hidden/banned staff (joined + filtered server-side),
      // matching the actual Staff Attendance report's numbers.
      noStaff ? Promise.resolve([] as StaffAttendanceRecord[]) : fetchStaffAttendanceReportByDate(today),
      fetchHolidayByDate(today),
      // Admins/principals need the full tracked-staff list; coordinators use staffIds
      isCoordinator ? Promise.resolve([] as { id: string }[]) : fetchAllTrackedStaff(),
    ])

    // Need staff_id to compute virtual absents (staff with no record = shown as absent
    // in the staff attendance page after the late cutoff, matching its "Absentees" list).
    const stRecords = staffIds !== null
      ? allStaffRecords.filter(r => staffIds!.includes(r.staff_id))
      : allStaffRecords

    const STAFF_PRESENT = new Set(['present', 'wfh', 'late'])
    const STAFF_ABSENT   = new Set(['absent', 'on_leave'])

    const tallyStaff = (rows: { status: string }[]) => ({
      present:   rows.filter(r => STAFF_PRESENT.has(r.status)).length,
      absent:    rows.filter(r => STAFF_ABSENT.has(r.status)).length,
      exception: rows.filter(r => !STAFF_PRESENT.has(r.status) && !STAFF_ABSENT.has(r.status)).length,
    })

    // Mirror the virtual-absent logic from AllStaffAttendanceReport: on a
    // working day, tracked staff with no record count as absent.
    let virtualAbsentCount = 0
    if (!holidayToday && !noStaff) {
      const recordedIds = new Set(stRecords.map(r => r.staff_id))
      const scope = isCoordinator ? (staffIds ?? []) : allTracked.map(s => s.id)
      virtualAbsentCount = scope.filter(id => !recordedIds.has(id)).length
    }

    const staffTally = tallyStaff(stRecords)
    setAttendanceCounts({
      students: {
        present: studentTally.present,
        absent: studentTally.absent,
        exception: studentTally.irregular,
      },
      // Support staff & drivers are intentionally excluded here — this card
      // is scoped to tracked (main) staff only. The Support Staff tab of the
      // attendance report is where their own numbers live.
      staff: { ...staffTally, absent: staffTally.absent + virtualAbsentCount },
    })
  }, [isAttendanceViewer, isCoordinator, user])

  /* ════════════════════════════════════════════════════════════════════════
     THE LAYOUT RULE: which cards exist is decided by WHO YOU ARE, never by
     WHAT YOUR DATA SAYS.

     Every gate below reads only from `profile.role`, the two stored
     show-on-home preferences, and the viewport width. Not one of them touches
     a fetch. That is the whole point: all three of those are answerable on the
     very first render, so the deck's shape is final before a single query has
     been sent, and the page never rearranges itself afterwards.

     It used to work the other way. "Should there be a Notifications card?" was
     answered by fetching the notifications; "a Grading card?" by fetching the
     queue. Eight such questions, eight answers arriving at eight different
     moments, and since a card's width is a share of however many cards there
     are, each answer resized and reshuffled the ones around it. Batching them
     into a single settle point made it one rearrangement instead of eight —
     better, but one is still one, and it still landed after the user had
     started reading.

     The cost of deciding up front is that a card whose data turns out empty
     keeps its place and says so. That is the deliberate trade: "Nothing to
     grade", "No fees overdue", "You're all caught up" are real answers to real
     questions, and a dashboard whose tiles are always in the same place is
     worth more than one that hides the quiet ones. Every card here already had
     an empty state designed for exactly this — they were just rarely reached,
     because the slot was usually dropped before anyone could see one.

     So: to add or remove a card, change a role gate. Never reintroduce a
     `.length > 0` here. Emptiness belongs inside the card, where it can only
     change that card's own contents.
     ════════════════════════════════════════════════════════════════════════ */

  // A week calendar is a fixture, not a feed: the week itself is the content,
  // and a week with nothing due says "nothing due". Admins opt in; everyone
  // else on staff gets it.
  const showTaskCalendar = !isAdmin || showTaskCalendarOnHome

  // Everyone has an inbox, so everyone has the card. Empty, it says they are
  // caught up — which on a Monday morning is worth knowing.
  const showNotifSlot = true

  // Student cards. Each is a standing part of a student's dashboard rather
  // than something that comes and goes with the week's workload.
  const showSchoolWork = true
  const showAssessments = true
  const showReportCards = true
  const showTimetable = true
  const showExams = true

  // The attendance-viewer summary and the two fee ledgers: entitlement only.
  // A day nobody has been marked yet is a reading the panel states honestly
  // ("not marked yet"), not a reason for the panel to be absent.
  const showAttendanceViewerCard = true
  const showFees = true
  const showBusFees = true

  /* The two that read as alerts — fees a student owes, papers waiting on a
     grader. These are the ones the rule above costs something real: a quiet
     card that says "No fees overdue" is not an alert, and under the old
     behaviour it simply would not have been drawn. Both already answer the
     empty case with good news rather than a blank box, which is what makes
     keeping their place affordable; the alternative was them dropping into
     the middle of a settled grid a second after it had been read. */
  const showOverdueFeesSlot = true
  const showGradingSlot = true

  const loadFeeSummaries = useCallback(async () => {
    if (!isAdmin) return
    // One call for the open session's figures: every bill, its non-transport
    // and transport shares, and each fee head (fee_home_summary). A figure the
    // viewer may not see comes back null and reads as zero here.
    const summary = await fetchHomeFeeSummary(todayIn())
    if (!summary) return
    const n = (v: number | null) => v ?? 0
    const toSummary = (f: HomeFeeFigures): HomeFeesSummary => ({
      collected: n(f.collected), outstanding: n(f.outstanding), todayCollection: n(f.today), studentsWithDues: f.students_with_dues,
    })
    setSchoolFeesSummary(toSummary(summary.school))
    setBusFeesSummary(toSummary(summary.transport))

    /* Five named heads at most, largest first; the rest fold into "Other
       fees" rather than being handed an invented sixth hue. Bus fee (the
       transport heads) keeps its own slot (orange) at the end. The palette is
       the validated categorical set (dataviz validator: lightness, chroma, CVD
       and normal-vision separation all pass in this order). A head is matched
       to the monthly chart by its key and by its name, which is how the chart
       reports heads across sessions. */
    const size = (h: HomeFeeHead) => n(h.collected) + n(h.outstanding) + n(h.today)
    const live = summary.heads.filter(h => size(h) > 0)
    const bus = live.filter(h => h.is_transport)
    const ranked = live.filter(h => !h.is_transport)
    const named = ranked.filter(h => h.key !== 'other').slice(0, FEE_HEAD_COLORS.length)
    const folded = ranked.filter(h => !named.includes(h))
    const heads: FeeHeadStat[] = named.map((h, i) => ({
      id: h.key,
      memberIds: [h.key, h.name],
      name: h.name,
      color: FEE_HEAD_COLORS[i],
      collected: n(h.collected),
      outstanding: n(h.outstanding),
      todayCollection: n(h.today),
      studentsWithDues: h.students_with_dues,
      todayHref: '/more/fees?section=collection',
      duesHref: '/more/fees?section=issued&filter=outstanding',
    }))
    if (folded.length > 0) {
      heads.push({
        id: '__other',
        memberIds: folded.flatMap(h => [h.key, h.name]),
        name: 'Other fees',
        color: OTHER_FEE_COLOR,
        collected: folded.reduce((t, h) => t + n(h.collected), 0),
        outstanding: folded.reduce((t, h) => t + n(h.outstanding), 0),
        todayCollection: folded.reduce((t, h) => t + n(h.today), 0),
        // A student can owe on several folded heads; the largest is a floor.
        studentsWithDues: Math.max(...folded.map(h => h.students_with_dues)),
        todayHref: '/more/fees?section=collection',
        duesHref: '/more/fees?section=issued&filter=outstanding',
      })
    }
    if (bus.length > 0) {
      heads.push({
        id: '__bus',
        memberIds: ['__bus', ...bus.flatMap(h => [h.key, h.name])],
        name: 'Bus fee',
        color: BUS_FEE_COLOR,
        collected: n(summary.transport.collected),
        outstanding: n(summary.transport.outstanding),
        todayCollection: n(summary.transport.today),
        studentsWithDues: summary.transport.students_with_dues,
        todayHref: '/more/bus?tab=fees&section=collection',
        duesHref: '/more/bus?tab=fees&section=issued&filter=outstanding',
      })
    }
    setFeeBreakdown({ total: toSummary(summary.total), heads })
  }, [isAdmin])


  useEffect(() => { loadAnnouncements() }, [loadAnnouncements])
  // The announcements page marks a page of notices read as it loads them;
  // that broadcast is what drops them from this box without a refresh.
  useEffect(() => onAnnouncementReadsChanged(() => { loadAnnouncements() }), [loadAnnouncements])

  /**
   * A headline in the notifications box was followed to the announcements page.
   * The marker is written here as well as on the page it opens, so the row
   * disappears from the box straight away rather than after the navigation
   * settles — and stays gone if the user turns back before the page loads.
   */
  const handleOpenAnnouncement = useCallback((announcement: { id: string }) => {
    if (!user) return
    setUnreadAnnouncements(prev => prev.filter(a => a.id !== announcement.id))
    markAnnouncementsRead(user.id, [announcement.id])
  }, [user])
  useEffect(() => { loadClassrooms() }, [loadClassrooms])
  useEffect(() => { if (isAttendanceViewer) loadAttendanceCounts() }, [isAttendanceViewer, loadAttendanceCounts])
  useEffect(() => { if (isAdmin) loadFeeSummaries() }, [isAdmin, loadFeeSummaries])

  // Re-pulls the attendance tiles once the day rolls over, so a session left
  // open overnight doesn't keep showing yesterday's counts. The admin/
  // principal/coordinator tile re-fetches directly; the regular-teacher card
  // manages its own fetch off `userId` alone, so it's remounted via `dayKey`.
  const [dayKey, setDayKey] = useState(0)
  const handleDayRollover = useCallback(() => {
    setAttendanceCounts(null)
    loadAttendanceCounts()
    setDayKey(k => k + 1)
  }, [loadAttendanceCounts])
  useMidnightRefresh(handleDayRollover)

  // Presence checks that gate conditional student/staff slots.
  useEffect(() => {
    if (!isStudent || !user) return
    fetchOverdueBills(user.id, todayIn())
      .then(setOverdueFees)
      .catch(err => console.error('Failed to load student fees for home card:', err))
      .finally(() => setOverdueFeesLoaded(true))
  }, [isStudent, user])

  useEffect(() => {
    if (!isStaff || !user) return
    fetchGraderGradingQueues(user.id)
      .then(setGradingQueues)
      .catch(err => console.error('Failed to load grading queues for home card:', err))
      .finally(() => setGradingLoaded(true))
  }, [isStaff, user])

  // Re-opens the feed from the top. Runs on mount, and again whenever a live
  // event or a read-marker anywhere in the app says the list has moved on.
  const [notifReloadKey, setNotifReloadKey] = useState(0)
  useEffect(() => onLeaveNotificationsChanged(() => setNotifReloadKey(k => k + 1)), [])

  // How deep the box had been scrolled, so a refresh refills to the same depth
  // instead of snapping back to the first ten rows.
  const notifDepth = useRef(0)
  notifDepth.current = Math.max(notifDepth.current, notifItems.length)
  // Whose list is currently on screen — a refresh for the same user keeps the
  // rows up rather than flashing the skeleton over them.
  const notifLoadedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    if (notifLoadedFor.current !== user.id) setNotifLoading(true)
    const feed = createNotificationFeed(user.id, isStudent ? 'student' : 'staff')
    notifFeed.current = feed
    feed.next(Math.max(NOTIF_PAGE_SIZE, notifDepth.current))
      .then(({ items, hasMore }) => {
        if (cancelled) return
        setNotifItems(items)
        setNotifHasMore(hasMore)
      })
      .catch(err => console.error('Failed to load notifications for home card:', err))
      .finally(() => {
        if (cancelled) return
        notifLoadedFor.current = user.id
        setNotifLoading(false)
      })
    return () => { cancelled = true }
  }, [isStudent, user, notifReloadKey])

  // Reaching the bottom of the box pulls the next ten unread rows.
  const handleLoadMoreNotifications = useCallback(() => {
    const feed = notifFeed.current
    if (!feed || notifLoadingMore) return
    setNotifLoadingMore(true)
    feed.next()
      .then(({ items, hasMore }) => {
        setNotifItems(prev => [...prev, ...items])
        setNotifHasMore(hasMore)
      })
      .catch(err => console.error('Failed to load more notifications:', err))
      .finally(() => setNotifLoadingMore(false))
  }, [notifLoadingMore])

  /**
   * Marks a row read and drops it from the box, for good — the marker is
   * written both locally and on the application itself, so opening the same
   * application in the OD / Leave app agrees it has been seen. Only an
   * applicant's own decision can be read this way: a request waiting on this
   * user's decision stays unread until they approve or reject it. When the
   * last row goes the card says so, and hands the deck on after 3 s.
   */
  const handleReadNotification = useCallback((item: NotifItem) => {
    if (!user || !isApplicantDecision(item)) return
    markNotificationRead(user.id, item)
    setNotifItems(prev => prev.filter(i => i.id !== item.id))
  }, [user])

  // Opens a notification's application in the same compact preview popup the
  // Staff Attendance app uses — never navigates away from Home.
  const [openNotif, setOpenNotif] =
    useState<{ app: LeaveApplicationWithDetails; item: NotifItem } | null>(null)
  const handleOpenNotification = useCallback((item: NotifItem) => {
    fetchLeaveApplicationById(item.appId).then(app => {
      if (!app) return
      setOpenNotif({ app, item })
      // Reading a decision on your own application is what the row is for, so
      // opening it clears it. A request awaiting this user's decision is not
      // addressed by being looked at — it clears when they decide.
      handleReadNotification(item)
    })
  }, [handleReadNotification])

  useEffect(() => {
    if (!isStaff || !user) return
    setTaskCalendarLoading(true)
    fetchCalendarData(user.id, getWeekStart(new Date()))
      .then(({ week }) => {
        const map = new Map<string, MiniCalendarItem[]>()
        for (const t of week) {
          if (!t.due_date) continue
          if (!map.has(t.due_date)) map.set(t.due_date, [])
          map.get(t.due_date)!.push({ id: t.id, title: taskDisplayTitle(t), done: isTaskCompleted(t) })
        }
        setTaskItemsByDay(map)
      })
      .catch(err => console.error('Failed to load task calendar for home card:', err))
      .finally(() => setTaskCalendarLoading(false))
  }, [isStaff, user])

  /* ────────────────────────────────────────────────────────────────────────
     The home cards, as data. One list feeds every width: on a phone all of
     it is the card deck; from 768px up the calendar and the statistics are
     lifted out into their own places and the deck carries the rest.
     ──────────────────────────────────────────────────────────────────────── */
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  /* The three standing statistics, as one set of gates. The mobile slot list
     and the desktop School Overview panel both read these, so "who is entitled
     to see this ledger" is decided in exactly one place. */
  const showAttendanceStat = isStaff && isAttendanceViewer && showAttendanceViewerCard
  const showFeesStat = isAdmin && showFees
  const showBusFeesStat = isAdmin && showBusFees

  /* From 768px up the page is a split: the week calendar on the left, the
     card deck on the right (2:1 at `lg:`, stacked at `md:`), with the
     standing statistics below. On a phone everything is one deck. */
  const splitLayout = gridLayout

  /* The calendar is a fixture of the split for every role that has one —
     staff (admins included, since the left column is the layout, not an
     opt-in) get their task week, students their school week. On a phone an
     admin keeps the opt-in, as before. */
  const calendarSlotKey: AdminCardView | null = isStudent
    ? (showSchoolWork ? 'calendar' : null)
    : (splitLayout || showTaskCalendar ? 'task-calendar' : null)

  const router = useRouter()
  /* The day already open in the mini calendar, clicked again: follow it into
     the full calendar it previews. */
  const openTaskDay = useCallback((dateKey: string) => {
    router.push(`/tasks?tab=weekly&date=${dateKey}`)
  }, [router])
  const openSchoolWorkDay = useCallback(() => {
    router.push('/academics')
  }, [router])

  // The notifications box has loaded and has nothing in it — it still opens
  // the deck, but hands over after 3 s rather than 7.
  const notificationsEmpty = !notifLoading && announcementsLoaded
    && notifItems.length === 0 && unreadAnnouncements.length === 0

  /* The one exception to THE LAYOUT RULE: the swipeable deck. A deck card
     with nothing in it is a stop the rotation makes for no reason, so only
     Notifications is shown empty (and hands on after 3 s); every other deck
     card stays out of the strip until it is known to have something. The
     deck can afford this where the grid could not: Notifications is always
     its first card, so a card joining later lands behind the one on screen
     and nothing visible moves. Cards that load their own data report in
     through `onContent`; the rest are judged here from the page's data. */
  const [selfReported, setSelfReported] = useState<Partial<Record<AdminCardView, boolean>>>({})
  const reportContent = useCallback((key: AdminCardView) => (has: boolean) => {
    setSelfReported(prev => (prev[key] === has ? prev : { ...prev, [key]: has }))
  }, [])
  const deckHasContent = (key: AdminCardView): boolean => {
    switch (key) {
      case 'notifications':
      case 'attendance':
      case 'teacher-attendance':
      case 'fees':
      case 'bus-fees':
        // Notifications by the rule above; the rest are standing figures —
        // a reading of zero is still a reading.
        return true
      case 'grading': return gradingLoaded && gradingQueues.length > 0
      case 'overdue-fees': return overdueFeesLoaded && overdueFees.length > 0
      case 'task-calendar': return !taskCalendarLoading && taskItemsByDay.size > 0
      default: return selfReported[key] === true
    }
  }

  const slots: HomeSlot[] = []

  if (showNotifSlot) {
    slots.push({
      key: 'notifications',
      label: 'notifications',
      heading: (
        <SectionHeading
          icon={Bell}
          chipClass="bg-gradient-to-br from-sky-400 to-blue-500"
          eyebrow="For you"
          title="Notifications"
          // One switch for every notification this app sends — the same
          // control the announcements banner carries.
          action={<PushToggle onDark={false} compact />}
        />
      ),
      // Both halves of this box arrive separately — the leave feed and the
      // unread announcements. It shimmers until both are in, so it can never
      // settle to "you're all caught up" and then sprout announcement rows
      // underneath someone who has already read it and moved on.
      body: notifLoading || !announcementsLoaded
        ? <NotificationsCardSkeleton />
        : (
          <NotificationsSummaryCard
            items={notifItems}
            announcements={unreadAnnouncements}
            hasMore={notifHasMore}
            loadingMore={notifLoadingMore}
            onLoadMore={handleLoadMoreNotifications}
            onRead={handleReadNotification}
            onOpen={handleOpenNotification}
            onAnnouncementOpen={handleOpenAnnouncement}
          />
        ),
    })
  }

  if (isStudent && showOverdueFeesSlot) {
    slots.push({
      key: 'overdue-fees',
      label: 'fees due',
      heading: (
        <SectionHeading
          icon={AlertTriangle}
          chipClass="bg-gradient-to-br from-red-400 to-rose-600"
          eyebrow="Action needed"
          title="Fees Due"
          action={<ViewAllLink href="/more/fees" className="text-red-600 hover:text-red-700" />}
        />
      ),
      body: <OverdueFeesCard fees={overdueFees} loading={!overdueFeesLoaded} />,
    })
  }

  if (showAttendanceStat) {
    slots.push({
      key: 'attendance',
      label: 'attendance',
      heading: (
        <SectionHeading
          icon={BarChart3}
          chipClass="bg-gradient-to-br from-emerald-400 to-teal-500"
          eyebrow="Today"
          title="Attendance"
          subtitle={isCoordinator ? (coordinatorTeamNames.length > 0 ? coordinatorTeamNames.join(', ') : 'Your team') : undefined}
          action={
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-semibold text-emerald-700">Live</span>
              </div>
              <span className="text-xs font-medium text-slate-500">{today}</span>
            </div>
          }
        />
      ),
      body: <AttendanceTilesCard counts={attendanceCounts} />,
    })
  }

  if (isStaff && !isAttendanceViewer && user) {
    slots.push({
      key: 'teacher-attendance',
      label: 'attendance',
      heading: (
        <SectionHeading
          icon={BarChart3}
          chipClass="bg-gradient-to-br from-emerald-400 to-teal-500"
          eyebrow="Today"
          title="Attendance"
          action={<span className="text-xs font-medium text-slate-500">{today}</span>}
        />
      ),
      body: <TeacherAttendanceCard key={dayKey} userId={user.id} />,
    })
  }

  const taskCalendarHeading = (
    <SectionHeading
      icon={CalendarDays}
      chipClass="bg-gradient-to-br from-sky-400 to-cyan-500"
      eyebrow="This week"
      title="My Tasks"
      action={<ViewAllLink href="/tasks" className="text-sky-600 hover:text-sky-700" />}
    />
  )
  const schoolWorkHeading = (
    <SectionHeading
      icon={CalendarDays}
      chipClass="bg-gradient-to-br from-violet-400 to-indigo-500"
      eyebrow="This week"
      title="School Work"
      action={<ViewAllLink href="/academics" className="text-violet-600 hover:text-violet-700" />}
    />
  )

  if (calendarSlotKey === 'task-calendar' && !splitLayout) {
    slots.push({
      key: 'task-calendar',
      label: 'my tasks',
      heading: taskCalendarHeading,
      body: <StaffWeeklyCalendarCard itemsByDay={taskItemsByDay} loading={taskCalendarLoading} onOpenDay={openTaskDay} />,
    })
  }

  if (isStaff && showGradingSlot) {
    slots.push({
      key: 'grading',
      label: 'grading',
      heading: (
        <SectionHeading
          icon={ClipboardCheck}
          chipClass="bg-gradient-to-br from-indigo-400 to-violet-600"
          eyebrow="Awaiting you"
          title="Grading"
          action={<ViewAllLink href="/more/exam" className="text-indigo-600 hover:text-indigo-700" />}
        />
      ),
      body: <ExamGradingCard queues={gradingQueues} loading={!gradingLoaded} />,
    })
  }

  if (calendarSlotKey === 'calendar' && user && !splitLayout) {
    slots.push({
      key: 'calendar',
      label: 'school work',
      heading: schoolWorkHeading,
      body: <SchoolWorkMiniCalendar userId={user.id} classrooms={classrooms} onOpenDay={openSchoolWorkDay} onContent={reportContent('calendar')} />,
    })
  }

  if (isStudent && user && showAssessments) {
    slots.push({
      key: 'assessments',
      label: 'assessments',
      heading: (
        <SectionHeading
          icon={ClipboardList}
          chipClass="bg-gradient-to-br from-amber-400 to-orange-500"
          eyebrow="Latest"
          title="Assessments"
        />
      ),
      body: <LatestAssessmentsMiniList classrooms={classrooms} onContent={reportContent('assessments')} />,
    })
  }

  if (isStudent && user && showReportCards) {
    slots.push({
      key: 'report-cards',
      label: 'report cards',
      heading: (
        <SectionHeading
          icon={Award}
          chipClass="bg-gradient-to-br from-rose-400 to-pink-600"
          eyebrow="This year"
          title="Report Cards"
          action={<ViewAllLink href="/academics?section=reportcards" className="text-rose-600 hover:text-rose-700" />}
        />
      ),
      body: <ReportCardsMiniList userId={user.id} onContent={reportContent('report-cards')} />,
    })
  }

  if (isStudent && user && showTimetable) {
    slots.push({
      key: 'timetable',
      label: 'timetable',
      heading: (
        <SectionHeading
          icon={CalendarClock}
          chipClass="bg-gradient-to-br from-indigo-400 to-blue-500"
          eyebrow="Today"
          title="Timetable"
          action={<ViewAllLink href="/more/timetable" className="text-indigo-600 hover:text-indigo-700" />}
        />
      ),
      body: <TodayTimetableCard userId={user.id} onContent={reportContent('timetable')} />,
    })
  }

  if (isStudent && user && showExams) {
    slots.push({
      key: 'exams',
      label: 'exams',
      heading: (
        <SectionHeading
          icon={FileSpreadsheet}
          chipClass="bg-gradient-to-br from-purple-400 to-fuchsia-600"
          eyebrow="Upcoming & results"
          title="Exams"
          action={<ViewAllLink href="/more/exam" className="text-purple-600 hover:text-purple-700" />}
        />
      ),
      body: <ExamsMiniCard userId={user.id} onContent={reportContent('exams')} />,
    })
  }

  const feeHeading = (
    <SectionHeading
      icon={CreditCard}
      chipClass="bg-gradient-to-br from-teal-400 to-cyan-600"
      eyebrow="School"
      title="Fee Manager"
      action={<ViewAllLink href="/more/fees" className="text-teal-600 hover:text-teal-700" />}
    />
  )
  const busFeeHeading = (
    <SectionHeading
      icon={Bus}
      chipClass="bg-gradient-to-br from-orange-400 to-rose-500"
      eyebrow="Transport"
      title="Bus Fees"
      action={<ViewAllLink href="/more/bus?tab=fees" className="text-orange-600 hover:text-orange-700" />}
    />
  )
  const feeBody = (
    <FeeTilesCard
      loading={schoolFeesSummary === null}
      summary={schoolFeesSummary}
      accent="#14b8a6"
      collectedHref="/more/fees?section=issued&filter=collected"
      outstandingHref="/more/fees?section=issued&filter=outstanding"
      todayHref="/more/fees?section=collection"
      duesLabel="Students with dues"
    />
  )
  const busFeeBody = (
    <FeeTilesCard
      loading={busFeesSummary === null}
      summary={busFeesSummary}
      accent="#f97316"
      collectedHref="/more/bus?tab=fees&section=issued&filter=collected"
      outstandingHref="/more/bus?tab=fees&section=issued&filter=outstanding"
      todayHref="/more/bus?tab=fees&section=collection"
      duesLabel="Passengers with dues"
    />
  )

  if (showFeesStat) {
    slots.push({ key: 'fees', label: 'school fees', heading: feeHeading, body: feeBody })
  }
  if (showBusFeesStat) {
    slots.push({ key: 'bus-fees', label: 'bus fees', heading: busFeeHeading, body: busFeeBody })
  }

  /* What the deck carries at this width. On a phone, every slot. In the split
     the calendar has its own column, and the standing statistics have their
     own place below (the School Overview at `lg:`, tile cards at `md:`), so
     the deck skips them rather than showing the same figures twice — for an
     admin that is attendance and both fee ledgers. A coordinator has no
     School Overview (see below), so their attendance card stays in the deck
     at every width. */
  const STAT_KEYS: AdminCardView[] = ['attendance', 'fees', 'bus-fees']
  const statsOutsideDeck = splitLayout && !isCoordinator
  const deckSlots: DeckSlot[] = slots
    .filter(s => !statsOutsideDeck || !STAT_KEYS.includes(s.key))
    .map(s => ({
      key: s.key,
      label: s.label,
      heading: s.heading,
      body: s.body,
      accent: SLOT_ACCENTS[s.key],
      quickAdvance: s.key === 'notifications' && notificationsEmpty,
      hidden: !deckHasContent(s.key),
    }))

  /* The combined statistics panel stands in for the separate stat cards at
     `lg:`, for admins and principals. Coordinators don't get it: their one
     statistic is their own teams' attendance, which reads better as the card
     in their deck than as a school-wide panel with one half filled. */
  const showOverviewPanel = !isCoordinator && (showAttendanceStat || showFeesStat || showBusFeesStat)

  /* A coordinator's attendance is scoped to their own teams; the panel says
     which, the same way the standalone attendance heading did. */
  const coordinatorSubtitle = isCoordinator
    ? (coordinatorTeamNames.length > 0 ? coordinatorTeamNames.join(', ') : 'Your team')
    : undefined

  const getGreetingData = () => {
    const hour = new Date().getHours()
    if (hour < 5)  return { line1: 'Good evening.',    line2: 'Wishing you a restful and peaceful night.',          icon: <Moon    size={16} className="text-indigo-300" /> }
    if (hour < 8)  return { line1: 'Good morning.',    line2: 'An early start sets the tone for a great day.',      icon: <Sun     size={16} className="text-amber-300" /> }
    if (hour < 12) return { line1: 'Good morning.',    line2: 'Wishing you a focused and productive morning.',      icon: <Sun     size={16} className="text-yellow-300" /> }
    if (hour < 16) return { line1: 'Good afternoon.',  line2: 'Trust you are having a smooth and productive day.',  icon: <Sun     size={16} className="text-orange-300" /> }
    if (hour < 19) return { line1: 'Good afternoon.',  line2: 'You have made great progress — keep it going.',      icon: <Sunset  size={16} className="text-orange-400" /> }
    return               { line1: 'Good evening.',     line2: 'Hope the day has been rewarding and worthwhile.',    icon: <Moon    size={16} className="text-indigo-300" /> }
  }

  const classroomColumns = useGridColumns()
  const HOME_CLASSROOM_VISIBLE_ROWS = 3
  const HOME_CLASSROOM_LIMIT = classroomColumns * HOME_CLASSROOM_VISIBLE_ROWS
  const HOME_CLASSROOM_COL_GAP = 10
  const HOME_CLASSROOM_ROW_GAP = 12.5 // 25% more than the column gap, for shadow-bleed margin between rows
  /** The grid's height, fixed for the life of the page.
   *
   *  This used to be a function of how many rows had been dealt out so far: one
   *  row while the enrolment query was in flight, then growing a row at a time
   *  as `useStaggeredRows` revealed them. Easing rather than jumping made it
   *  pleasant to watch, but it is still the section — and everything below it,
   *  More Apps included — moving down the page after the user can already see
   *  it, which is the thing this page is not allowed to do any more.
   *
   *  So the box is its full three rows from the first paint and never changes.
   *  The staggered reveal still runs; it now deals the rows into a container
   *  that is already their size, which is the same animation without the page
   *  underneath it being dragged along. */
  const homeClassroomsMaxHeight = classroomGridMaxHeight(HOME_CLASSROOM_VISIBLE_ROWS, HOME_CLASSROOM_ROW_GAP)
  const homeClassroomItemWidth = classroomItemWidth(classroomColumns, HOME_CLASSROOM_COL_GAP)
  const {
    visibleCount: classroomVisibleCount,
    containerRef: classroomsScrollRef,
    handleScroll: handleClassroomsScroll,
  } = useAutoLoadMore({ total: classrooms.length, initialCount: HOME_CLASSROOM_LIMIT, step: 4, intervalMs: 3000, bottomBufferPx: HOME_CLASSROOM_ROW_GAP })
  const topClassrooms = classrooms.slice(0, classroomVisibleCount)


  // bannerLum===null means default gradient (white fade makes it light → dark text)
  // bannerLum set means custom image → use luminance threshold
  const bannerOnDark = bannerLum !== null && bannerLum < 0.4

  // Three deliberate tiers rather than one phone height stretched wide. The
  // desktop hero is deliberately shallow: at 1440px wide it is a band, not a
  // cover image, and every pixel it gives back is a dashboard row that clears
  // the fold. (178 = 296 × 0.6 — see the 40% trim.)
  const bannerHeight = isMobileBanner ? 204 : isDesktop ? 178 : 255

  interface AppEntry {
    key: string
    href: string
    icon: React.ElementType
    label: string
    iconGradient: string
    cardBg: string
    cardBorder: string
    notificationCount?: number
    staffOnly?: boolean
    adminOnly?: boolean
    adminOrStudentOnly?: boolean
  }

  const allMoreApps: AppEntry[] = [
    {
      key: 'staff-attendance',
      href: '/more/staff-attendance',
      icon: UserCheck,
      label: 'Staff Attendance',
      iconGradient: 'from-blue-500 to-indigo-600',
      cardBg: 'bg-blue-50',
      cardBorder: 'border-blue-200',
      staffOnly: true,
    },
    {
      key: 'attendance',
      href: '/more/attendance',
      icon: ClipboardList,
      label: 'Student Attendance',
      iconGradient: 'from-emerald-400 to-teal-600',
      cardBg: 'bg-emerald-50',
      cardBorder: 'border-emerald-200',
    },
    // No Student OD/Leave tile either: Student Attendance hosts that app in a
    // popup, badged with the same pending count.
    // No Staff OD/Leave tile: the leave app is hosted in a popup inside Staff
    // Attendance (badged there with the same pending count), and incoming
    // applications still surface in the notifications card above.
    {
      key: 'exam',
      href: '/more/exam',
      icon: FileText,
      label: 'Exam',
      iconGradient: 'from-amber-400 to-orange-500',
      cardBg: 'bg-amber-50',
      cardBorder: 'border-amber-200',
    },
    {
      key: 'bus',
      href: '/more/bus',
      icon: Bus,
      label: 'Bus',
      iconGradient: 'from-orange-400 to-rose-500',
      cardBg: 'bg-orange-50',
      cardBorder: 'border-orange-200',
    },
    {
      key: 'timetable',
      href: '/more/timetable',
      icon: CalendarRange,
      label: 'Timetable',
      iconGradient: 'from-indigo-500 to-violet-600',
      cardBg: 'bg-indigo-50',
      cardBorder: 'border-indigo-200',
    },
    {
      key: 'fee',
      href: '/more/fees',
      icon: CreditCard,
      label: 'Fee',
      iconGradient: 'from-teal-400 to-cyan-600',
      cardBg: 'bg-teal-50',
      cardBorder: 'border-teal-200',
      adminOrStudentOnly: true,
    },
    {
      key: 'salary',
      href: '/more/salary',
      icon: Banknote,
      label: 'Salary',
      iconGradient: 'from-slate-500 to-zinc-700',
      cardBg: 'bg-slate-100',
      cardBorder: 'border-slate-300',
      staffOnly: true,
    },
    {
      key: 'admin-space',
      href: '/more/admin-space',
      icon: Shield,
      label: 'Admin Space',
      iconGradient: 'from-zinc-600 to-stone-800',
      cardBg: 'bg-zinc-100',
      cardBorder: 'border-zinc-300',
      adminOnly: true,
    },
  ]

  const moreApps = allMoreApps.filter(app => {
    if (app.staffOnly && !isStaff) return false
    if (app.adminOnly && !isAdmin) return false
    if (app.adminOrStudentOnly && isStaff && !isAdmin) return false
    return true
  })

  /* Nothing at all until the layout is decided.
     The deck's shape is a pure function of the role, the two stored
     preferences and the viewport width (see THE LAYOUT RULE above). Two of
     those are free, but the role comes from the profile — so until the profile
     is in hand there is no honest answer to "what does this page look like",
     and the page draws nothing rather than guessing. Guessing is what it used
     to do: with no profile `isStaff` is false and `isStudent` is therefore
     true, so a teacher's first commit was a *student's* dashboard, replaced
     wholesale a moment later.
     In practice this is zero frames — AuthContext sets the profile before it
     clears its loading flag, and ProtectedLayout holds its own branded spinner
     over the whole route until then, so what the user sees is that spinner
     giving way directly to a fully-shaped dashboard. The guard is here so the
     guarantee holds even when that ordering doesn't (a slow profile fetch
     landing after the auth safety timeout). The div carries the page theme so
     the body keeps the home gradient throughout — the blank moment is the home
     page's own background, not a white flash. */
  if (!user || !profile) {
    return (
      <ProtectedLayout>
        <div data-page-theme="home" className="min-h-screen" aria-busy="true" />
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      {/* --home-banner-h: the band's height, for the reveal's translate. */}
      <div data-page-theme="home" style={{ ['--home-banner-h' as string]: `${bannerHeight}px` }}>
        <motion.div variants={pageVariants} initial="hidden" animate="visible">

          {/* ── Welcome banner ──
              The band's box is its full height from the first paint. What
              moves is `bannerReveal` (see its note): the photo opens half-way,
              then its soft bottom edge slides down to the band's foot while
              the page beneath is carried down with it. The edge is a mask, not
              a hard cut — the photo dilutes into the page background — and it
              stays soft at rest. The greeting and the quote of the day sit on
              their own unmasked layer so they are never faded by it. */}
          <div className="relative w-full" style={{ height: bannerHeight }}>
            <motion.div
              className={`absolute inset-0 overflow-hidden sheen ${reduceMotion ? '' : 'sheen-animate'}`}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: reduceMotion || bannerReady ? 1 : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.3, ease: 'easeOut' }}
              // `position` inline, not from a class: `.sheen` is unlayered
              // CSS that sets `position: relative`, which beats Tailwind's
              // `absolute` and collapsed this layer to nothing.
              style={{ position: 'absolute', maskImage: bannerMask, WebkitMaskImage: bannerMask }}
            >
              {/* Background: the gradient is always there — it is the banner's
                  own placeholder, not a fallback — and a school's photo cross-
                  fades over it once loaded. Rendering the gradient first also
                  means the greeting below has a surface to sit on immediately,
                  so its contrast never changes out from under the reader. */}
              <div className="absolute inset-0 bg-gradient-to-br from-sky-500 via-cyan-400 to-emerald-400">
                <div className="absolute -top-16 -right-16 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
                <div className="absolute top-6 left-1/4 w-48 h-48 bg-teal-300/20 rounded-full blur-2xl" />
                <div className="absolute bottom-0 -left-10 w-64 h-64 bg-emerald-300/15 rounded-full blur-3xl" />
                <svg className="absolute inset-0 w-full h-full opacity-[0.06]" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <pattern id="wd" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
                      <circle cx="2" cy="2" r="1.5" fill="white" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#wd)" />
                </svg>
              </div>

              {welcomeBanner && (
                <motion.img
                  key={welcomeBanner}
                  src={welcomeBanner}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  initial={reduceMotion ? false : { opacity: 0, scale: 1.06 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={reduceMotion
                    ? { duration: 0 }
                    : { opacity: { duration: 0.6, ease: 'easeOut' }, scale: { duration: 6, ease: 'easeOut' } }}
                  style={{ willChange: 'transform, opacity' }}
                />
              )}

              {/* Admin: small pencil icon pinned to top-right corner.
                  The file input used to be `hidden` (display:none), which takes
                  it out of the tab order — and a <label> isn't focusable in its
                  own right, so the only way to change the banner was a mouse.
                  `sr-only` keeps it invisible but focusable, focus-within draws
                  the ring on the chip, and the input carries the accessible
                  name the icon alone didn't give it. 44 px target, like the
                  other controls on the page. */}
              {isAdmin && (
                <label
                  title="Change welcome banner"
                  className="absolute top-2 right-2 z-20 w-11 h-11 rounded-full bg-black/30 hover:bg-black/45 flex items-center justify-center cursor-pointer transition-all focus-within:ring-2 focus-within:ring-white/90 focus-within:bg-black/45"
                >
                  <Pencil size={14} className="text-white" aria-hidden="true" />
                  <input
                    type="file"
                    accept="image/*"
                    aria-label="Change welcome banner image"
                    className="sr-only"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) handleBannerUpload(f)
                    }}
                  />
                </label>
              )}

              {/* Layer 1 — progressive blur at the foot of the photo. Drawn as a
                  blurred copy of the photo (a plain filter), masked to the
                  bottom 30%, rather than a backdrop-filter: a backdrop-filtered
                  layer under a popup or the profile card is what Chrome draws
                  black for a frame as the popup opens (see globals.css, "No
                  backdrop-filter in the glass materials"). Same look. */}
              {welcomeBanner && (
                <div
                  aria-hidden
                  className="absolute inset-0 overflow-hidden pointer-events-none"
                  style={{
                    maskImage: 'linear-gradient(to bottom, transparent 70%, black 82%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 70%, black 82%)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={welcomeBanner} alt="" className="absolute inset-0 w-full h-full object-cover scale-110" style={{ filter: 'blur(20px)' }} />
                </div>
              )}

              {/* Layer 3 — graduated dark scrim for dark photos, so the
                  greeting always clears the WCAG contrast bar. */}
              {welcomeBanner && bannerOnDark && (
                <div
                  className="absolute inset-x-0 bottom-0"
                  style={{
                    height: '62%',
                    background: 'linear-gradient(to bottom, transparent 0%, rgba(2,6,23,0.18) 45%, rgba(2,6,23,0.52) 100%)',
                  }}
                />
              )}

            </motion.div>

            {/* Greeting + quote — rides the sliding edge down. */}
            <motion.div
              className="absolute inset-x-0 bottom-0 z-10 pointer-events-none"
              style={{ transform: belowBannerTransform }}
            >
              <div className="home-container pb-10">
                  {(() => {
                    const { line1, icon } = getGreetingData()
                    const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                    return (
                      <motion.div
                        initial={reduceMotion ? false : { opacity: 0 }}
                        // Fades up as the sliding edge carries it down.
                        animate={reduceMotion || bannerReady ? { opacity: 1 } : { opacity: 0 }}
                        transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: 'easeOut', delay: 0.55 }}
                      >
                        <div className="flex items-center gap-1.5 mb-2">
                          {icon}
                          <span
                            className={`eyebrow ${bannerOnDark ? 'text-white/80' : 'text-slate-500'}`}
                            style={bannerOnDark ? { textShadow: '0 1px 3px rgba(0,0,0,0.5)' } : undefined}
                          >
                            {line1.replace(/\.$/, '')} · {dateLabel}
                          </span>
                        </div>
                        <h1
                          className={`font-display text-[2rem] sm:text-[2.6rem] font-bold mb-1 leading-[1.05] headline transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-900'}`}
                          style={bannerOnDark ? { textShadow: '0 2px 10px rgba(0,0,0,0.45)' } : undefined}
                        >
                          Welcome back, {profile?.full_name?.split(' ')[0] || 'User'}.
                        </h1>
                        <BannerQuote onDark={bannerOnDark} show={reduceMotion || bannerReady} />
                      </motion.div>
                    )
                  })()}
              </div>
            </motion.div>
          </div>

          {/* Everything below the band, carried down by the reveal. */}
          <motion.div style={{ transform: belowBannerTransform }}>

          {/* ── Today at a glance — the section under the quote.
              Fixed height at every width, whichever card is up: the deck and
              the calendar take their height from the layout, never from the
              content, so turning a card or loading a list can't move the
              page.

              Phone: one Liquid Glass deck carrying every card.
              768px+: the week calendar beside the deck (2:1 from `lg:`,
              stacked below it), the deck now carrying only the feeds — the
              standing statistics have their own place underneath. ── */}
          {!splitLayout && deckSlots.length > 0 && (
            <div className="home-container pt-6 pb-2">
              <motion.div variants={cardVariants}>
                <HomeCardDeck slots={deckSlots} heightClass="h-[408px]" />
              </motion.div>
            </div>
          )}

          {splitLayout && (calendarSlotKey || deckSlots.length > 0 || showOverviewPanel) && (
            <div className="home-container pt-6 pb-6 space-y-6">
              {(calendarSlotKey || deckSlots.length > 0) && (
                <motion.div
                  variants={cardVariants}
                  className={`grid grid-cols-1 gap-5 ${calendarSlotKey && deckSlots.length > 0 ? 'lg:grid-cols-3' : ''}`}
                >
                  {calendarSlotKey && (
                    <section
                      aria-label={calendarSlotKey === 'calendar' ? 'School work this week' : 'My tasks this week'}
                      className={`flex flex-col min-w-0 h-[340px] lg:h-[440px] ${deckSlots.length > 0 ? 'lg:col-span-2' : ''}`}
                    >
                      {calendarSlotKey === 'calendar' ? schoolWorkHeading : taskCalendarHeading}
                      <div className="flex-1 min-h-0">
                        {calendarSlotKey === 'calendar'
                          ? <SchoolWorkMiniCalendar userId={user.id} classrooms={classrooms} onOpenDay={openSchoolWorkDay} fill />
                          : <StaffWeeklyCalendarCard itemsByDay={taskItemsByDay} loading={taskCalendarLoading} onOpenDay={openTaskDay} fill />}
                      </div>
                    </section>
                  )}
                  {deckSlots.length > 0 && (
                    <HomeCardDeck slots={deckSlots} heightClass="h-[408px] lg:h-[440px]" />
                  )}
                </motion.div>
              )}

              {/* The standing statistics, never behind a gesture. At `lg:`
                  they are one School Overview panel; between 768 and 1024
                  they stay as separate tile cards. */}
              {isDesktop && showOverviewPanel && (
                <motion.div variants={cardVariants}>
                  <SchoolOverviewPanel
                    attendance={showAttendanceStat
                      ? { counts: attendanceCounts, subtitle: coordinatorSubtitle }
                      : null}
                    fees={feeBreakdown}
                    showAttendance={showAttendanceStat}
                    showFees={showFeesStat || showBusFeesStat}
                    today={today}
                  />
                </motion.div>
              )}

              {!isDesktop && showAttendanceStat && !isCoordinator && (
                <motion.section variants={cardVariants} className="flex flex-col h-[330px]">
                  {slots.find(s => s.key === 'attendance')?.heading}
                  <div className="flex-1 min-h-0">{slots.find(s => s.key === 'attendance')?.body}</div>
                </motion.section>
              )}
              {!isDesktop && (showFeesStat || showBusFeesStat) && (
                <motion.div
                  variants={cardVariants}
                  className={`grid gap-4 items-stretch ${showFeesStat && showBusFeesStat ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}
                >
                  {showFeesStat && (
                    <section className="flex flex-col min-w-0 h-[330px]">
                      {feeHeading}
                      <div className="flex-1 min-h-0">{feeBody}</div>
                    </section>
                  )}
                  {showBusFeesStat && (
                    <section className="flex flex-col min-w-0 h-[330px]">
                      {busFeeHeading}
                      <div className="flex-1 min-h-0">{busFeeBody}</div>
                    </section>
                  )}
                </motion.div>
              )}
            </div>
          )}

          {/* ── Classrooms — off by default, shown when the account turns it on
              from the Academics classrooms heading (home leads with the day's
              work, and the same buttons live on Academics either way).

              The stored preference is the whole gate, by the layout rule above.
              It used to also wait on an enrolment probe and then on the real
              list, which meant the section faded in partway down the load and
              pushed More Apps down the page. Anyone who has turned this on has
              classrooms to turn it on *from* — the Academics heading that
              carries the toggle — so the enrolment check was guarding against
              a case the preference already rules out. ── */}
          {showClassroomsOnHome && (
            <div className="home-container pt-6 pb-8">
              <motion.div variants={cardVariants}>
                <SectionHeading
                  icon={GraduationCap}
                  chipClass="bg-gradient-to-br from-cyan-400 to-teal-500"
                  eyebrow="Your spaces"
                  title={isStudent ? 'My Classrooms' : 'Classrooms'}
                  action={<ViewAllLink href="/academics" className="text-cyan-600 hover:text-cyan-700" />}
                />

                {/* One persistent grid container across the loading→loaded
                    transition (ClassroomGridItems switches from skeletons to
                    real buttons internally) — see ClassroomGridItems for how
                    that keeps the swap smooth instead of an abrupt DOM
                    remount. maxHeight/gap are computed (classroomGridMaxHeight)
                    from the same row-height/row-gap constants, so the
                    container always fits exactly HOME_CLASSROOM_VISIBLE_ROWS
                    full rows — never a partial row peeking in. Top edge
                    leaves half a row-gap above the first row; the bottom edge
                    leaves a full row-gap after the last row
                    (padding{Top,Bottom} / scrollPadding{Top,Bottom} below) —
                    both a fraction of the same rhythm as the gap between
                    rows, not separately chosen buffers. -mx/px (matching the
                    page's own responsive gutter: 16/24/32px) gives
                    shadow-bleed room horizontally without exceeding the
                    page's own padding (which would risk page-level overflow).
                    snap-y/snap-start (on ClassroomButton) plus
                    scroll-pt/scroll-pb make that same top/bottom spacing hold
                    for *whichever* row a scroll settles on, not just the true
                    first/last row. The initial batch (HOME_CLASSROOM_LIMIT)
                    matches the live column count exactly, so those rows load
                    pre-filled with no partial row; auto-load/scroll reveals
                    anything beyond. */}
                <div
                  ref={classroomsScrollRef}
                  onScroll={handleClassroomsScroll}
                  style={{
                    height: homeClassroomsMaxHeight,
                    rowGap: HOME_CLASSROOM_ROW_GAP,
                    columnGap: HOME_CLASSROOM_COL_GAP,
                    paddingTop: HOME_CLASSROOM_ROW_GAP * CLASSROOM_PAD_TOP_RATIO,
                    paddingBottom: HOME_CLASSROOM_ROW_GAP,
                    scrollPaddingTop: HOME_CLASSROOM_ROW_GAP * CLASSROOM_PAD_TOP_RATIO,
                    scrollPaddingBottom: HOME_CLASSROOM_ROW_GAP,
                  }}
                  className="flex flex-wrap justify-center content-start overflow-y-auto overscroll-contain scrollbar-hide snap-y snap-mandatory -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
                >
                  {/* A full box of placeholders, not one row of them. The
                      staged row-by-row reveal this used to do existed to make
                      the *container growing* feel smooth; the container no
                      longer grows, so the stagger would now just be three rows
                      of skeleton collapsing to one and dealing themselves back
                      out. Slots are position-keyed, so each placeholder becomes
                      its real button in place with no unmount, and any surplus
                      folds away inside the fixed box. */}
                  <ClassroomGridItems
                    items={classroomsLoaded ? topClassrooms.map(classroom => ({ classroom })) : null}
                    skeletonCount={HOME_CLASSROOM_LIMIT}
                    heightClass="h-[64px]"
                    itemWidth={homeClassroomItemWidth}
                    columns={classroomColumns}
                    showTeacher
                    navigatingId={navigatingId}
                    onNavigate={id => setNavigatingId(id)}
                  />
                </div>
              </motion.div>
            </div>
          )}

          {/* ── More Apps (full-bleed). Background is a fixed white, matching
              the sticky footer below — no custom background image here. ── */}
          {/* Breathing room above the band, at every width — it used to sit
              hard against whatever section came before it. */}
          <motion.div variants={cardVariants} className="relative mt-8 lg:mt-12">
            <motion.div
              aria-hidden
              className="absolute inset-x-0 top-full bg-white pointer-events-none"
              style={{ height: belowBannerSkirtHeight }}
            />
            <div className="relative w-full overflow-hidden bg-white">
              {/* Content */}
              <div className="relative z-10 home-container py-5">
                <SectionHeading
                  icon={LayoutGrid}
                  chipClass="bg-gradient-to-br from-sky-500 to-indigo-600"
                  eyebrow="Shortcuts"
                  title="More Apps"
                />

                {/* Below lg this is a scrollable strip of phone-sized tiles; at
                    lg it becomes a fixed grid across the full container width,
                    with legible (11px) labels rather than the 9.5px ones that
                    only work at arm's length on a phone. */}
                <div className="overflow-x-auto lg:overflow-visible scrollbar-hide -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
                  <div className="flex gap-2 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] lg:gap-3">
                    {moreApps.map((app, idx) => {
                      const Icon = app.icon
                      return (
                        <Link
                          key={app.key}
                          href={app.href}
                          className="pressable glass-tile flex-1 min-w-[5.375rem] lg:min-w-0 flex flex-col items-center gap-2 py-3 lg:py-3.5 px-0.5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
                        >
                          <div className="relative w-full max-w-[2.6rem] lg:max-w-[2.9rem] aspect-square mx-auto">
                            <div
                              className="icon-chip brand-fade w-full h-full"
                              style={{ background: ICON_GRADIENTS[idx % ICON_GRADIENTS.length] }}
                            >
                              <Icon size={18} className="relative z-10 text-white drop-shadow-sm" />
                            </div>
                            {!!app.notificationCount && app.notificationCount > 0 && (
                              <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 text-[8px] font-bold bg-red-500 text-white rounded-full inline-flex items-center justify-center leading-none shadow-sm ring-2 ring-white z-20">
                                {app.notificationCount > 4 ? '4+' : app.notificationCount}
                              </span>
                            )}
                          </div>
                          <span className="text-[9.5px] lg:text-[11px] font-semibold text-slate-700 leading-tight text-center line-clamp-2 w-full px-0.5">{app.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          </motion.div>
        </motion.div>
      </div>

      {/* Opens an OD/Leave notification's application in place — the same
          compact popup the Staff Attendance app uses, without leaving Home.
          A request waiting on this user is decided right in it: remarks, then
          Approve or Reject, and the notification clears itself. */}
      {openNotif && (
        <LeaveAppPreviewModal
          application={openNotif.app}
          onClose={() => setOpenNotif(null)}
          viewerUserId={user?.id}
          viewerRole={profile?.role}
          // No link out to the full OD / Leave app: a decision is read here and
          // finished with, and a request is answered here — the popup carries
          // the remarks box and the Approve / Reject buttons itself.
          onDecided={isApplicantDecision(openNotif.item)
            ? undefined
            : () => setNotifItems(prev => prev.filter(i => i.id !== openNotif.item.id))}
        />
      )}
    </ProtectedLayout>
  )
}
