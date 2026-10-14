'use client'

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import { motion, AnimatePresence, useMotionValue, animate, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import {
  Bell,
  ChevronLeft,
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
  XCircle,
  AlertTriangle,
  Clock,
  CalendarCheck,
  Award,
  CalendarClock,
  FileSpreadsheet,
  ClipboardCheck,
  Pause,
  Play,
} from 'lucide-react'
import { isStaffRole } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { currentAcademicYear, academicYearOf, fetchFeesForStudent, isFeeOverdue, SchoolFee } from '@/lib/fees'
import { fetchGraderGradingQueues, GraderExamProgress } from '@/lib/exam'
import {
  fetchHolidayByDate,
  fetchAllTrackedStaff,
  fetchStaffAttendanceReportByDate,
  fetchStudentAttendanceTallyByDate,
  StaffAttendanceRecord,
} from '@/lib/attendance'
import { fetchCalendarData, isTaskCompleted } from '@/lib/tasks'
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
import DailyQuoteCard from '@/components/home/DailyQuoteCard'
import SchoolWorkMiniCalendar from '@/components/home/SchoolWorkMiniCalendar'
import LatestAssessmentsMiniList from '@/components/home/LatestAssessmentsMiniList'
import ReportCardsMiniList from '@/components/home/ReportCardsMiniList'
import OverdueFeesCard from '@/components/home/OverdueFeesCard'
import NotificationsSummaryCard, { NotificationsCardSkeleton } from '@/components/home/NotificationsSummaryCard'
import { SkeletonBar, SkeletonTiles } from '@/components/home/HomeCardSkeletons'
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
import { MiniCalendarItem, getWeekStart } from '@/components/home/MiniWeekCalendar'
import ClassroomGridItems from '@/components/classrooms/ClassroomGridItems'
import FeesInfographicPanel, { HomeFeesSummary } from '@/components/home/desktop/FeesInfographicPanel'
import AttendanceInfographicPanel, {
  AttendanceTally,
  HomeAttendanceCounts,
} from '@/components/home/desktop/AttendanceInfographicPanel'
import SchoolOverviewPanel from '@/components/home/desktop/SchoolOverviewPanel'
import { fmtINR } from '@/lib/formatMoney'
import { useIsDesktop, useIsTabletUp, useIsPhone, useHasHover } from '@/hooks/useMediaQuery'
import { useAutoLoadMore } from '@/hooks/useAutoLoadMore'
import { useGridColumns } from '@/hooks/useGridColumns'
import { useMidnightRefresh } from '@/hooks/useMidnightRefresh'
import { classroomGridMaxHeight, classroomItemWidth, CLASSROOM_PAD_TOP_RATIO } from '@/lib/classroomGridLayout'

function QuoteBanner() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 7000)
    return () => clearTimeout(t)
  }, [])
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
          transition={{ duration: 0.45, ease: 'easeInOut' }}
          className="overflow-hidden"
        >
          <div className="home-container pt-5 pb-1">
            <DailyQuoteCard />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

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
 * One home card, described once and rendered two ways: as a slide in the mobile
 * swipe strip, and as a cell in the desktop dashboard grid. `desktopBody` lets a
 * statistic swap its stacked mobile tiles for an infographic panel on desktop;
 * cards without one (feeds, lists, calendars) render the same body in both.
 * `span` is the card's desktop grid width — `wide` for anything that reads
 * side-by-side, `half` for everything else.
 */
interface HomeSlot {
  key: AdminCardView
  heading: React.ReactNode
  body: React.ReactNode
  desktopBody?: React.ReactNode
  span: 'half' | 'wide'
}

/** Each slot's accent, used by the carousel's active indicator dot. */
const DOT_COLORS: Record<AdminCardView, string> = {
  attendance: 'bg-emerald-500',
  'teacher-attendance': 'bg-emerald-500',
  fees: 'bg-teal-500',
  'bus-fees': 'bg-orange-500',
  calendar: 'bg-violet-500',
  'task-calendar': 'bg-sky-500',
  assessments: 'bg-amber-500',
  'report-cards': 'bg-rose-500',
  'overdue-fees': 'bg-red-500',
  notifications: 'bg-sky-500',
  timetable: 'bg-indigo-500',
  exams: 'bg-purple-500',
  grading: 'bg-indigo-500',
}

/**
 * Desktop step controls for the card strip. A pointer has no swipe, so the
 * strip needs something to click. The swipe track is full-bleed but the card
 * inside it is centred in the page's max-w-7xl box, so the arrows are anchored
 * to that same box — in the gutter either side of the card, not stranded at
 * the far edges of a 1440px screen. They stay out of the way until the strip
 * is hovered and come back on keyboard focus, so they are reachable without a
 * mouse. The wrapper stops above the indicator dots so the arrows sit against
 * the card rather than the strip's full height.
 */
function CarouselArrows({ onPrev, onNext }: { onPrev: () => void; onNext: () => void }) {
  const arrowClass = `pointer-events-auto absolute top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center
    bg-white/80 backdrop-blur-sm border border-white/70 shadow-sm text-slate-600
    opacity-0 group-hover/carousel:opacity-100 focus-visible:opacity-100
    hover:bg-white hover:text-slate-900 transition-all duration-200
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60`
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 bottom-10 z-10 max-w-7xl 2xl:max-w-[1600px] mx-auto">
      <button type="button" onClick={onPrev} aria-label="Previous card" className={`${arrowClass} left-0`}>
        <ChevronLeft size={18} />
      </button>
      <button type="button" onClick={onNext} aria-label="Next card" className={`${arrowClass} right-0`}>
        <ChevronRight size={18} />
      </button>
    </div>
  )
}

/** Mobile stat-tile card for a fee ledger — the 2×2 grid of deep-linked tiles. */
function FeeTilesCard({
  summary, collectedHref, outstandingHref, todayHref, duesLabel, loading = false,
}: {
  summary: HomeFeesSummary | null
  collectedHref: string
  outstandingHref: string
  todayHref: string
  duesLabel: string
  /** The ledger's fetch is still in flight. The tiles keep their size, tints
   *  and captions — only the four figures shimmer, so the card never asserts a
   *  ₹0 that nobody counted and then quietly replaces it. */
  loading?: boolean
}) {
  return (
    <div className="pro-card h-[260px] p-4 flex items-center">
      <div className="grid grid-cols-2 gap-3 w-full">
        <Link href={collectedHref} className="flex flex-col items-center justify-center py-5 bg-[#27272A] border border-[#B8983C] hover:opacity-90 active:scale-95 transition-all shadow-sm">
          <CheckCircle2 size={15} className="text-[#B8983C] mb-1.5" />
          <p className="text-base font-bold text-white tabular-nums leading-tight">{loading ? <SkeletonBar w={62} h={15} className="opacity-30" /> : fmtINR(summary?.collected ?? 0)}</p>
          <p className="text-[9.5px] font-semibold text-[#A1A1AA] mt-0.5">Collected</p>
        </Link>
        <Link href={outstandingHref} className="flex flex-col items-center justify-center py-5 bg-white border border-[#E4E4E7] hover:bg-slate-50 active:scale-95 transition-all shadow-sm">
          <Clock size={15} className="text-[#A1A1AA] mb-1.5" />
          <p className="text-base font-bold text-[#18181B] tabular-nums leading-tight">{loading ? <SkeletonBar w={62} h={15} cool /> : fmtINR(summary?.outstanding ?? 0)}</p>
          <p className="text-[9.5px] font-semibold text-[#71717A] mt-0.5">Outstanding</p>
        </Link>
        <Link href={todayHref} className="flex flex-col items-center justify-center py-5 bg-[#F4F2EC] border border-[#E7E2D8] hover:bg-amber-50 active:scale-95 transition-all shadow-sm">
          <CalendarCheck size={15} className="text-[#A8896B] mb-1.5" />
          <p className="text-base font-bold text-[#18181B] tabular-nums leading-tight">{loading ? <SkeletonBar w={62} h={15} cool /> : fmtINR(summary?.todayCollection ?? 0)}</p>
          <p className="text-[10px] font-semibold text-[#52525B] mt-0.5">Today&apos;s Collection</p>
        </Link>
        <Link href={outstandingHref} className="flex flex-col items-center justify-center py-5 bg-white border border-[#E4E4E7] hover:bg-slate-50 active:scale-95 transition-all shadow-sm">
          <Users size={15} className="text-[#A1A1AA] mb-1.5" />
          <p className="text-base font-bold text-[#18181B] tabular-nums leading-tight">{loading ? <SkeletonBar w={34} h={15} cool /> : (summary?.studentsWithDues ?? '—')}</p>
          <p className="text-[9.5px] font-semibold text-[#71717A] mt-0.5">{duesLabel}</p>
        </Link>
      </div>
    </div>
  )
}

/** Mobile stat-tile card for today's attendance — students over staff. */
function AttendanceTilesCard({ counts }: { counts: HomeAttendanceCounts | null }) {
  // `null` is "the fetch hasn't come back" — the page never hands this a loaded
  // zero as null. Six em dashes in six tinted boxes read as a finished card
  // reporting nothing recorded, so it shimmers the tiles instead.
  if (counts === null) {
    return (
      <div className="pro-card h-[260px] overflow-hidden flex flex-col">
        <SkeletonTiles rows={2} />
      </div>
    )
  }
  const scopes: { title: string; icon: React.ElementType; base: string; tally: AttendanceTally | null; anchors: [string, string, string] }[] = [
    {
      title: 'Students', icon: Users, base: '/more/attendance', tally: counts?.students ?? null,
      anchors: ['student-present', 'student-absent', 'student-irregular'],
    },
    {
      title: 'Staff', icon: Briefcase, base: '/more/staff-attendance', tally: counts?.staff ?? null,
      anchors: ['staff-present', 'staff-absent', 'staff-exceptions'],
    },
  ]
  return (
    <div className="pro-card h-[260px] overflow-hidden">
      {scopes.map((scope, i) => {
        const Icon = scope.icon
        return (
          <div key={scope.title} className={`px-4 pt-3 pb-2 ${i === 0 ? 'border-b border-slate-200' : ''}`}>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                <Icon size={12} className="text-slate-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{scope.title}</span>
              </div>
              <Link href={scope.base} className="flex items-center gap-0.5 text-[10px] font-semibold text-sky-700 hover:text-sky-800 transition-colors">
                View report <ChevronRight size={11} />
              </Link>
            </div>
            {/* Tints stay, but the ink on them steps down to the 700 ramp: the
                400/500 tones these used read at 1.6–2.5:1 on their own 50-level
                tint — the headline number on an admin's home page was below
                even the 3:1 large-text floor. The 700s hold the same semantic
                hue at 4.8–5.9:1. */}
            <div className="grid grid-cols-3 gap-2">
              <Link href={`${scope.base}#${scope.anchors[0]}`} className="group flex flex-col items-center justify-center py-2.5 bg-emerald-50/90 border border-emerald-200/60 hover:bg-emerald-100/90 hover:border-emerald-300/70 active:scale-95 transition-all">
                <CheckCircle2 size={13} className="text-emerald-600 mb-1" />
                <span className="text-xl font-black text-emerald-700 leading-none">{scope.tally?.present ?? '—'}</span>
                <span className="text-[10.5px] font-semibold text-emerald-700 mt-1">Present</span>
              </Link>
              <Link href={`${scope.base}#${scope.anchors[1]}`} className="group flex flex-col items-center justify-center py-2.5 bg-red-50/90 border border-red-200/60 hover:bg-red-100/90 hover:border-red-300/70 active:scale-95 transition-all">
                <XCircle size={13} className="text-red-600 mb-1" />
                <span className="text-xl font-black text-red-700 leading-none">{scope.tally?.absent ?? '—'}</span>
                <span className="text-[10.5px] font-semibold text-red-700 mt-1">Absent</span>
              </Link>
              <Link href={`${scope.base}#${scope.anchors[2]}`} className="group flex flex-col items-center justify-center py-2.5 bg-amber-50/90 border border-amber-200/60 hover:bg-amber-100/90 hover:border-amber-300/70 active:scale-95 transition-all">
                <AlertTriangle size={12} className="text-amber-700 mb-1" />
                <span className="text-xl font-black text-amber-700 leading-none">{scope.tally?.exception ?? '—'}</span>
                <span className="text-[10.5px] font-semibold text-amber-700 mt-1">Irregular</span>
              </Link>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * `inert` on an offscreen carousel slide, spelled so React 18 actually emits it.
 * React 18 doesn't carry `inert` in its known-property list, so a boolean value
 * is dropped with a "Received `true` for a non-boolean attribute" warning and
 * never reaches the DOM; an empty string is the HTML spelling of a *present*
 * boolean attribute and passes straight through as an unknown attribute. The
 * cast is only to satisfy @types/react, which already types `inert` the React 19
 * way (boolean) — drop both the constant and the cast on the React 19 upgrade
 * and write `inert={!active}`.
 */
const INERT_ATTR = { inert: '' } as unknown as { inert?: boolean }

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
  const showCardCarousel = isStudent || isStaff
  const [unreadAnnouncements, setUnreadAnnouncements] = useState<UnreadAnnouncement[]>([])
  const [welcomeBanner, setWelcomeBanner] = useState<string | null>(null)
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])
  const [classroomsLoaded, setClassroomsLoaded] = useState(false)
  // Tracks the classroom whose page is being navigated to, for instant tap feedback.
  const [navigatingId, setNavigatingId] = useState<string | null>(null)
  const [bannerLum, setBannerLum] = useState<number | null>(null)
  const [adminCardView, setAdminCardView] = useState<AdminCardView>('attendance')
  const [containerW, setContainerW] = useState(0)
  // Three hinges. All of them are read on the *first* render rather than on
  // mount (useMediaQuerySync): this whole page lives behind ProtectedLayout's
  // auth gate, so it is never part of the server HTML and has no server render
  // to agree with. Deferring to an effect only meant a 1440px window laid out
  // and committed the phone carousel before flipping to the grid — a full
  // layout swap, and the very first thing anyone saw on opening the app.
  //
  //   gridLayout (≥768px)  the feed cards stop being a one-at-a-time swipe
  //                        strip and become a dashboard grid, and the standing
  //                        statistics leave the strip for fixed rows of their
  //                        own. A pointer has no swipe, and two cards already
  //                        fit side by side at this width.
  //   isDesktop  (≥1024px) the statistics have the width to stop being stacked
  //                        2×2 tiles and become chart-plus-rows infographic
  //                        panels, and the grid opens its third column.
  //   isPhone    (<640px)  the hero band is deeper, relative to the viewport.
  const isDesktop = useIsDesktop()
  const gridLayout = useIsTabletUp()
  const isMobileBanner = useIsPhone()
  const [attendanceCounts, setAttendanceCounts] = useState<HomeAttendanceCounts | null>(null)
  const [schoolFeesSummary, setSchoolFeesSummary] = useState<HomeFeesSummary | null>(null)
  const [busFeesSummary, setBusFeesSummary] = useState<HomeFeesSummary | null>(null)
  // Presence data for conditional carousel slots (resolved so the slot list is
  // built before the strip settles, avoiding a visible resnap).
  const [overdueFees, setOverdueFees] = useState<SchoolFee[]>([])
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
  const interactedRef = useRef(false)
  const swipeStartXRef = useRef<number | null>(null)
  const swipeStartYRef = useRef(0)
  const swipeDirectionRef = useRef<'horizontal' | 'vertical' | null>(null)
  const baseOffsetRef = useRef(0)
  const dragX = useMotionValue(0)
  const cardContainerRef = useRef<HTMLDivElement | null>(null)
  // The strip is unmounted entirely when it has no cards (rather than left as
  // an empty band), so the node comes and goes. Tracking it in state — set from
  // a callback ref — lets the measure and touch effects re-run when it returns;
  // keying them on the ref alone would leave them attached to nothing.
  const [stripNode, setStripNode] = useState<HTMLDivElement | null>(null)
  const attachStrip = useCallback((node: HTMLDivElement | null) => {
    cardContainerRef.current = node
    setStripNode(node)
  }, [])
  const [autoplayResetKey, setAutoplayResetKey] = useState(0)
  // OS-level "reduce motion". Drives both the entrance animations and whether
  // the strip rotates on its own at all.
  const reduceMotion = useReducedMotion()
  // WCAG 2.2.2 (Pause, Stop, Hide): content that moves on its own for more
  // than five seconds needs a way to stop it. `userPausedAutoplay` is the
  // explicit control below the dots; `autoplayHeld` is the implicit pause
  // while a pointer is over the strip or focus is inside it, so the card can't
  // slide out from under someone mid-read.
  const [userPausedAutoplay, setUserPausedAutoplay] = useState(false)
  const [autoplayHeld, setAutoplayHeld] = useState(false)
  // The implicit hold is for pointer devices only — see useHasHover: a tap on
  // a phone leaves a phantom hover behind, which would latch the hold on and
  // stop the strip rotating for the rest of the session. Touch already resets
  // the autoplay clock on every swipe and tap (autoplayResetKey), and has the
  // pause button for a deliberate stop.
  const hasHover = useHasHover()
  const holdAutoplay = useCallback((held: boolean) => {
    if (hasHover) setAutoplayHeld(held)
  }, [hasHover])
  // Resolved once here rather than branching at each of the dozen motion.div
  // call sites below.
  const pageVariants = reduceMotion ? staticContainerVariants : containerVariants
  const cardVariants = reduceMotion ? staticItemVariants : itemVariants


  // The banner photo. Decoded off-screen first so it swaps in complete rather
  // than painting in bands, then cross-faded over the gradient the hero already
  // shows. Nothing here gates the page any more: the band holds its own height
  // from the first paint whether or not a school has set a photo, so there is
  // no scroll to correct afterwards — the `window.scrollTo(0, 0)` this used to
  // fire on every load existed only to undo the height animation's drift.
  useEffect(() => {
    let cancelled = false
    fetchRawSetting<string>('welcome_banner')
      .then(url => {
        if (!url || cancelled) return
        const img = new window.Image()
        const show = () => { if (!cancelled) setWelcomeBanner(url) }
        img.onload = show
        img.onerror = show
        img.src = url
      })
      .catch(err => console.error('Failed to load welcome banner:', err))
    return () => { cancelled = true }
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
    const currentYear = currentAcademicYear()
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

    const [{ data: schoolFees }, { data: busFees }, { data: todaySchoolPay }, { data: todayBusPay }] = await Promise.all([
      supabase.from('school_fees').select('status, amount, student_id').eq('academic_year', currentYear).neq('status', 'cancelled'),
      supabase.from('bus_fees').select('status, amount, passenger_id, due_date, created_at').neq('status', 'cancelled'),
      supabase.from('school_fee_payments').select('amount').eq('status', 'verified').gte('verified_at', todayStart.toISOString()),
      supabase.from('bus_payments').select('amount').eq('status', 'verified').gte('verified_at', todayStart.toISOString()),
    ])

    let sCollected = 0, sOutstanding = 0
    const sDueStudents = new Set<string>()
    for (const f of schoolFees ?? []) {
      const amt = Number(f.amount) || 0
      if (f.status === 'paid') sCollected += amt
      else { sOutstanding += amt; sDueStudents.add(f.student_id) }
    }
    const sTodayCollection = (todaySchoolPay ?? []).reduce((s: number, p: { amount: number }) => s + (Number(p.amount) || 0), 0)
    setSchoolFeesSummary({ collected: sCollected, outstanding: sOutstanding, todayCollection: sTodayCollection, studentsWithDues: sDueStudents.size })

    let bCollected = 0, bOutstanding = 0
    const bDuePassengers = new Set<string>()
    type BusFeeRow = { due_date: string | null; created_at: string; status: string; amount: number; passenger_id: string }
    const scopedBusFees = ((busFees ?? []) as BusFeeRow[]).filter(f => academicYearOf(f.due_date ?? f.created_at) === currentYear)
    for (const f of scopedBusFees) {
      const amt = Number(f.amount) || 0
      if (f.status === 'paid') bCollected += amt
      else { bOutstanding += amt; bDuePassengers.add(f.passenger_id) }
    }
    const bTodayCollection = (todayBusPay ?? []).reduce((s: number, p: { amount: number }) => s + (Number(p.amount) || 0), 0)
    setBusFeesSummary({ collected: bCollected, outstanding: bOutstanding, todayCollection: bTodayCollection, studentsWithDues: bDuePassengers.size })
  }, [isAdmin])

  // Re-runs when the dashboard grid hands the page back to the swipe track, so
  // a carousel remounted by a window resize measures itself instead of reusing
  // a stale width. Above `md:` there is no strip at all: the node is gone, so
  // this bails and the observer is disconnected rather than left watching a
  // detached element.
  useLayoutEffect(() => {
    const el = cardContainerRef.current
    if (!el) return
    const measure = () => setContainerW(el.offsetWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [gridLayout, stripNode])

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
    const today = new Date().toISOString().split('T')[0]
    fetchFeesForStudent(user.id, undefined, ['unpaid', 'partial'])
      .then(fees => setOverdueFees(fees.filter(f => isFeeOverdue(f, today))))
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
   * last row goes the whole slot drops out of the carousel (see CARD_VIEWS).
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
          map.get(t.due_date)!.push({ id: t.id, title: t.title, done: isTaskCompleted(t) })
        }
        setTaskItemsByDay(map)
      })
      .catch(err => console.error('Failed to load task calendar for home card:', err))
      .finally(() => setTaskCalendarLoading(false))
  }, [isStaff, user])

  /* ────────────────────────────────────────────────────────────────────────
     The home cards, as data. One list feeds both presentations: the mobile
     swipe strip (one slot per screen, gesture-driven) and the desktop
     dashboard grid (every slot visible at once, statistics rendered as
     infographic panels). Deriving CARD_VIEWS from this list — rather than
     maintaining a parallel array of keys — makes it impossible for the
     carousel's index maths to drift out of step with the DOM order.
     ──────────────────────────────────────────────────────────────────────── */
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  /* The three standing statistics, as one set of gates. The mobile slot list
     and the desktop School Overview panel both read these, so "who is entitled
     to see this ledger" is decided in exactly one place. */
  const showAttendanceStat = isStaff && isAttendanceViewer && showAttendanceViewerCard
  const showFeesStat = isAdmin && showFees
  const showBusFeesStat = isAdmin && showBusFees

  const slots: HomeSlot[] = []

  if (isStudent && showOverdueFeesSlot) {
    slots.push({
      key: 'overdue-fees',
      span: 'half',
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

  if (showNotifSlot) {
    slots.push({
      key: 'notifications',
      span: 'half',
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

  if (showAttendanceStat) {
    slots.push({
      key: 'attendance',
      // Two scopes of donuts side by side — this one earns the full width.
      span: 'wide',
      heading: (
        <SectionHeading
          icon={BarChart3}
          chipClass="bg-gradient-to-br from-emerald-400 to-teal-500"
          eyebrow="Today"
          title="Attendance"
          subtitle={isCoordinator ? (coordinatorTeamNames.length > 0 ? coordinatorTeamNames.join(', ') : 'Your team') : undefined}
          action={
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-semibold text-emerald-700">Live</span>
              </div>
              <span className="text-xs font-medium text-slate-500">{today}</span>
            </div>
          }
        />
      ),
      body: <AttendanceTilesCard counts={attendanceCounts} />,
      desktopBody: <AttendanceInfographicPanel counts={attendanceCounts} loading={attendanceCounts === null} />,
    })
  }

  if (isStaff && !isAttendanceViewer && user) {
    slots.push({
      key: 'teacher-attendance',
      span: 'half',
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

  if (isStaff && showTaskCalendar) {
    slots.push({
      key: 'task-calendar',
      span: 'wide',
      heading: (
        <SectionHeading
          icon={CalendarDays}
          chipClass="bg-gradient-to-br from-sky-400 to-cyan-500"
          eyebrow="This week"
          title="My Tasks"
          action={<ViewAllLink href="/tasks" className="text-sky-600 hover:text-sky-700" />}
        />
      ),
      body: <StaffWeeklyCalendarCard itemsByDay={taskItemsByDay} loading={taskCalendarLoading} />,
    })
  }

  if (isStaff && showGradingSlot) {
    slots.push({
      key: 'grading',
      span: 'half',
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

  if (isStudent && user && showSchoolWork) {
    slots.push({
      key: 'calendar',
      span: 'wide',
      heading: (
        <SectionHeading
          icon={CalendarDays}
          chipClass="bg-gradient-to-br from-violet-400 to-indigo-500"
          eyebrow="This week"
          title="School Work"
          action={<ViewAllLink href="/academics" className="text-violet-600 hover:text-violet-700" />}
        />
      ),
      body: <SchoolWorkMiniCalendar userId={user.id} classrooms={classrooms} />,
    })
  }

  if (isStudent && user && showAssessments) {
    slots.push({
      key: 'assessments',
      span: 'half',
      heading: (
        <SectionHeading
          icon={ClipboardList}
          chipClass="bg-gradient-to-br from-amber-400 to-orange-500"
          eyebrow="Latest"
          title="Assessments"
        />
      ),
      body: <LatestAssessmentsMiniList classrooms={classrooms} />,
    })
  }

  if (isStudent && user && showReportCards) {
    slots.push({
      key: 'report-cards',
      span: 'half',
      heading: (
        <SectionHeading
          icon={Award}
          chipClass="bg-gradient-to-br from-rose-400 to-pink-600"
          eyebrow="This year"
          title="Report Cards"
          action={<ViewAllLink href="/academics?section=reportcards" className="text-rose-600 hover:text-rose-700" />}
        />
      ),
      body: <ReportCardsMiniList userId={user.id} />,
    })
  }

  if (isStudent && user && showTimetable) {
    slots.push({
      key: 'timetable',
      span: 'half',
      heading: (
        <SectionHeading
          icon={CalendarClock}
          chipClass="bg-gradient-to-br from-indigo-400 to-blue-500"
          eyebrow="Today"
          title="Timetable"
          action={<ViewAllLink href="/more/timetable" className="text-indigo-600 hover:text-indigo-700" />}
        />
      ),
      body: <TodayTimetableCard userId={user.id} />,
    })
  }

  if (isStudent && user && showExams) {
    slots.push({
      key: 'exams',
      span: 'half',
      heading: (
        <SectionHeading
          icon={FileSpreadsheet}
          chipClass="bg-gradient-to-br from-purple-400 to-fuchsia-600"
          eyebrow="Upcoming & results"
          title="Exams"
          action={<ViewAllLink href="/more/exam" className="text-purple-600 hover:text-purple-700" />}
        />
      ),
      body: <ExamsMiniCard userId={user.id} />,
    })
  }

  if (showFeesStat) {
    slots.push({
      key: 'fees',
      span: 'half',
      heading: (
        <SectionHeading
          icon={CreditCard}
          chipClass="bg-gradient-to-br from-teal-400 to-cyan-600"
          eyebrow="School"
          title="Fee Manager"
          action={<ViewAllLink href="/more/fees" className="text-teal-600 hover:text-teal-700" />}
        />
      ),
      body: (
        <FeeTilesCard
          loading={schoolFeesSummary === null}
          summary={schoolFeesSummary}
          collectedHref="/more/fees?section=issued&filter=collected"
          outstandingHref="/more/fees?section=issued&filter=outstanding"
          todayHref="/more/fees?section=collection"
          duesLabel="Students with Dues"
        />
      ),
      desktopBody: (
        <FeesInfographicPanel
          loading={schoolFeesSummary === null}
          summary={schoolFeesSummary}
          collectedHref="/more/fees?section=issued&filter=collected"
          outstandingHref="/more/fees?section=issued&filter=outstanding"
          todayHref="/more/fees?section=collection"
          duesLabel="Students with Dues"
        />
      ),
    })
  }

  if (showBusFeesStat) {
    slots.push({
      key: 'bus-fees',
      span: 'half',
      heading: (
        <SectionHeading
          icon={Bus}
          chipClass="bg-gradient-to-br from-orange-400 to-rose-500"
          eyebrow="Transport"
          title="Bus Fees"
          action={<ViewAllLink href="/more/bus?tab=fees" className="text-orange-600 hover:text-orange-700" />}
        />
      ),
      body: (
        <FeeTilesCard
          loading={busFeesSummary === null}
          summary={busFeesSummary}
          collectedHref="/more/bus?tab=fees&section=issued&filter=collected"
          outstandingHref="/more/bus?tab=fees&section=issued&filter=outstanding"
          todayHref="/more/bus?tab=fees&section=collection"
          duesLabel="Passengers with Dues"
        />
      ),
      desktopBody: (
        <FeesInfographicPanel
          loading={busFeesSummary === null}
          summary={busFeesSummary}
          collectedHref="/more/bus?tab=fees&section=issued&filter=collected"
          outstandingHref="/more/bus?tab=fees&section=issued&filter=outstanding"
          todayHref="/more/bus?tab=fees&section=collection"
          duesLabel="Passengers with Dues"
        />
      ),
    })
  }

  /* One slot list, laid out two ways.

     On a phone every slot is a slide in the swipe strip, one card per screen.
     At `md:` and up the strip is gone entirely and the same slots become a
     dashboard: the statistics take fixed rows of their own — attendance across
     the full width, then the two fee ledgers side by side — and the feeds fill
     a 12-column grid above them, every card in a fixed place and on screen at
     once.

     Why the strip doesn't survive: a statistic is a standing number read at a
     glance, and a gesture or a 7-second rotation between the viewer and it is
     the phone habit this view exists to drop. The feeds are the less obvious
     half of the same argument — a teacher can have nine of them (timetable,
     exams, grading, tasks, school work, assessments, report cards,
     notifications, attendance), and at 7 seconds a card that is a full minute
     of waiting to see today's timetable on a screen with room for all nine.
     `span` on each slot — already declared with the slot, and until now unused
     — says which ones read better across the full width. */
  const STAT_KEYS: AdminCardView[] = ['attendance', 'fees', 'bus-fees']
  const gridSlots = gridLayout ? slots.filter(s => !STAT_KEYS.includes(s.key)) : []
  const carouselSlots = gridLayout ? [] : slots
  const attendanceSlot = gridLayout ? slots.find(s => s.key === 'attendance') : undefined
  const feeSlots = gridLayout ? slots.filter(s => s.key === 'fees' || s.key === 'bus-fees') : []

  /* A slot's width in the 12-column grid.

     `half` is the default — two up at `md:`, three at `xl:` where a 1600px
     container has the room. `wide` is for the cards that read side-by-side
     internally (a week calendar, the two-scope attendance panel): full width
     at `md:`, two thirds at `xl:` so a `half` can sit beside it.

     The count overrides both when the deck is nearly empty. A student whose
     cards have all resolved to empty but one was left with that one card at a
     third of a 1280px page and two thirds of nothing beside it — the span is
     only a *share* of a full row, and it needs a row to share. One card takes
     the width; two split it. */
  const spanClassFor = (slot: HomeSlot) => {
    if (gridSlots.length === 1) return 'md:col-span-12'
    if (gridSlots.length === 2) return 'md:col-span-6'
    return slot.span === 'wide' ? 'md:col-span-12 xl:col-span-8' : 'md:col-span-6 xl:col-span-4'
  }

  /* The combined statistics panel stands in for the separate stat rows at
     `lg:`, so it appears whenever this account is entitled to any of them. */
  const showOverviewPanel = showAttendanceStat || showFeesStat || showBusFeesStat

  /* A coordinator's attendance is scoped to their own teams; the panel says
     which, the same way the standalone attendance heading did. */
  const coordinatorSubtitle = isCoordinator
    ? (coordinatorTeamNames.length > 0 ? coordinatorTeamNames.join(', ') : 'Your team')
    : undefined

  // The carousel's index space — the strip's own slots, so the dots and the
  // drag maths stay in step with what is actually in the strip at this width.
  // Memoised on the joined keys so the array identity only changes when that
  // list does; the effects below depend on it and must not re-run every render.
  const slotKeys = carouselSlots.map(s => s.key).join('|')
  const CARD_VIEWS = useMemo<AdminCardView[]>(
    () => (slotKeys ? slotKeys.split('|') as AdminCardView[] : []),
    [slotKeys],
  )

  // When the slot list changes (role resolved, or a conditional card appears/
  // disappears), keep the carousel coherent: before the user has interacted,
  // pin to the first slot (so e.g. overdue-fees lands first once it loads);
  // after interaction, hold their current card at its new index.
  useEffect(() => {
    if (CARD_VIEWS.length === 0) return
    if (!interactedRef.current) {
      setAdminCardView(CARD_VIEWS[0])
      dragX.set(0)
      return
    }
    const idx = CARD_VIEWS.indexOf(adminCardView)
    if (idx === -1) {
      setAdminCardView(CARD_VIEWS[0])
      dragX.set(0)
    } else {
      const W = cardContainerRef.current?.offsetWidth ?? window.innerWidth
      dragX.set(-idx * W)
    }
    // Only realign when the slot list itself changes — not on every swipe
    // (which updates adminCardView and would fight the swipe spring animation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [CARD_VIEWS])

  useEffect(() => {
    if (!showCardCarousel || CARD_VIEWS.length < 2) return
    // Reduced motion, the explicit pause button, and a pointer or focus inside
    // the strip each stop the clock entirely — the user still has the dots,
    // the arrows and the swipe to move through the deck themselves.
    if (reduceMotion || userPausedAutoplay || autoplayHeld) return
    const t = setInterval(() => {
      // A background tab shouldn't burn through the deck: the user would come
      // back several cards on from the one they left open.
      if (typeof document !== 'undefined' && document.hidden) return
      const W = cardContainerRef.current?.offsetWidth ?? window.innerWidth
      const currentIdx = Math.round(-dragX.get() / W)
      const nextIdx = (currentIdx + 1) % CARD_VIEWS.length
      setAdminCardView(CARD_VIEWS[nextIdx])
      animate(dragX, -nextIdx * W, { type: 'spring', stiffness: 300, damping: 32, mass: 0.9 })
    }, 7000)
    return () => clearInterval(t)
  }, [showCardCarousel, CARD_VIEWS, dragX, autoplayResetKey, reduceMotion, userPausedAutoplay, autoplayHeld])

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

  const snapToView = useCallback((targetView: AdminCardView) => {
    const W = cardContainerRef.current?.offsetWidth ?? window.innerWidth
    const targetIdx = CARD_VIEWS.indexOf(targetView)
    interactedRef.current = true
    setAdminCardView(targetView)
    animate(dragX, -targetIdx * W, { type: 'spring', stiffness: 300, damping: 32, mass: 0.9 })
    setAutoplayResetKey(k => k + 1)
  }, [CARD_VIEWS, dragX])

  // Native (non-passive) touch handlers so we can call preventDefault() once a
  // gesture is confirmed horizontal — React's synthetic onTouchMove is passive
  // by default and preventDefault() inside it is silently ignored, which let
  // the page's vertical scroll fire alongside our horizontal drag and produced
  // the wobble. Direction is locked from the first few pixels of movement:
  // horizontal gestures drive the card drag (and block page scroll for the
  // rest of the gesture); vertical gestures are left alone so native scroll
  // (page or a nested list) behaves normally.
  useEffect(() => {
    const el = cardContainerRef.current
    if (!el) return

    const onStart = (e: TouchEvent) => {
      interactedRef.current = true
      swipeDirectionRef.current = null
      swipeStartXRef.current = e.touches[0].clientX
      swipeStartYRef.current = e.touches[0].clientY
      baseOffsetRef.current = dragX.get()
      setAutoplayResetKey(k => k + 1)
    }

    const onMove = (e: TouchEvent) => {
      if (swipeStartXRef.current === null) return
      const touch = e.touches[0]
      const dx = touch.clientX - swipeStartXRef.current
      const dy = touch.clientY - swipeStartYRef.current

      if (swipeDirectionRef.current === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        swipeDirectionRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
      }
      if (swipeDirectionRef.current === 'vertical') return

      e.preventDefault()
      const W = cardContainerRef.current?.offsetWidth ?? window.innerWidth
      const raw = baseOffsetRef.current + dx
      const minX = -(CARD_VIEWS.length - 1) * W
      const maxX = 0
      // Rubber-band resistance at edges
      const x = raw < minX ? minX + (raw - minX) * 0.22 : raw > maxX ? raw * 0.22 : raw
      dragX.set(x)
    }

    const onEnd = (e: TouchEvent) => {
      if (swipeStartXRef.current === null) return
      const wasHorizontal = swipeDirectionRef.current === 'horizontal'
      const dx = (e.changedTouches[0]?.clientX ?? swipeStartXRef.current) - swipeStartXRef.current
      swipeStartXRef.current = null
      swipeDirectionRef.current = null
      if (!wasHorizontal) return

      const W = cardContainerRef.current?.offsetWidth ?? window.innerWidth
      const currentX = dragX.get()
      const fractional = -currentX / W
      let targetIdx: number
      if (dx < -40) {
        targetIdx = Math.min(Math.ceil(fractional - 0.1), CARD_VIEWS.length - 1)
      } else if (dx > 40) {
        targetIdx = Math.max(Math.floor(fractional + 0.1), 0)
      } else {
        targetIdx = Math.max(0, Math.min(Math.round(fractional), CARD_VIEWS.length - 1))
      }
      setAdminCardView(CARD_VIEWS[targetIdx])
      animate(dragX, -targetIdx * W, { type: 'spring', stiffness: 300, damping: 32, mass: 0.9 })
    }

    // Buttons/links inside a card (mark-as-read, load-more, view-all, …) don't
    // go through the touch-drag path above, but tapping/clicking one is still
    // "interacting with the card" — reset the autoplay clock on any click
    // inside the strip so it doesn't jump to the next card mid-interaction.
    const onClick = () => setAutoplayResetKey(k => k + 1)

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    el.addEventListener('click', onClick)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      el.removeEventListener('click', onClick)
    }
  }, [CARD_VIEWS, dragX, gridLayout, stripNode])

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
      <div data-page-theme="home">
        <motion.div variants={pageVariants} initial="hidden" animate="visible">

          {/* ── Immersive full-width welcome banner ──
              This used to open by animating `height` from 0 to its final value
              over two seconds, and it only started once a settings fetch and an
              image decode had both come back. Animating height is a layout
              animation: every frame re-flowed the whole document, so for two
              seconds after the data had landed the entire dashboard slid down
              the screen — and because it began late, the page had already drawn
              itself once at the wrong offset before it did. That slide is most
              of what reads as "not smooth" on this page.

              The height is a constant per breakpoint and owes nothing to the
              network, so the band now occupies its final height from the very
              first paint and never animates it again. Only the photo fades in
              over the gradient when it arrives — opacity and transform, which
              the compositor can do without touching layout. Nothing below the
              banner moves at any point. */}
          <div
            className={`relative w-full overflow-hidden sheen ${reduceMotion ? '' : 'sheen-animate'}`}
            style={{ height: bannerHeight }}
          >
            <div className="absolute inset-0">

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
                  className="absolute top-2 right-2 z-20 w-11 h-11 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur-sm flex items-center justify-center cursor-pointer transition-all focus-within:ring-2 focus-within:ring-white/90 focus-within:bg-black/45"
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

              {/* Layer 1 — progressive backdrop blur */}
              <div
                className="absolute inset-x-0 bottom-0"
                style={{
                  height: '30%',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  maskImage: 'linear-gradient(to bottom, transparent 0%, black 40%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 40%)',
                }}
              />

              {/* Layer 2 — white fade for the default gradient only */}
              {!welcomeBanner && (
                <div
                  className="absolute inset-x-0 bottom-0"
                  style={{
                    height: '30%',
                    background: 'linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.22) 45%, rgba(255,255,255,0.35) 100%)',
                  }}
                />
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

              {/* Welcome text — pinned inside the blur zone.
                  The greeting is the user's own name and the clock: both known
                  the instant the page mounts, neither waiting on anything. It
                  used to sit out the first 0.9 s and then take another 0.9 s to
                  fade, so the hero stood empty through the whole load and the
                  headline arrived last of all — after the cards it is supposed
                  to introduce. Now it is there from the start, with a short
                  fade to take the hard edge off. */}
              <div className="absolute inset-x-0 bottom-0 z-10">
                <div className="home-container pb-7">
                  {(() => {
                    const { line1, icon } = getGreetingData()
                    const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                    return (
                      <motion.div
                        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
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
                      </motion.div>
                    )
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* ── Daily Quote — auto-dismisses after 7 s, collapses gap ──
              No longer gated on `bannerReady`: the quote comes from a local
              table keyed on the date, so waiting on a banner settings fetch to
              show it only meant the row below the hero appeared late and pushed
              the dashboard down a second time. */}
          <QuoteBanner />

          {/* ── Phone: every slot in a full-bleed swipe track, one card per
              screen, rotating every 7 s. The track (this div plus
              cardContainerRef) is edge-to-edge while each slide still centers
              its own content in the page's container, so the visible card is
              exactly the width it always was and only the swipe hit area is
              wider.
              This whole branch is gone at `md:` — see the dashboard grid below
              it. Not merely hidden: an off-screen strip still ticking would
              re-render the page every 7 s for a deck nobody can see. With
              `carouselSlots` empty the autoplay, the ResizeObserver and the
              touch listeners all bail on their own. ── */}
          {carouselSlots.length > 0 && (
          <div className="w-full px-2 pt-6">
            <motion.div variants={cardVariants} className="mb-0">
              <div
                  ref={attachStrip}
                  role="group"
                  aria-roledescription="carousel"
                  aria-label="Today at a glance"
                  className="group/carousel strip-compact relative overflow-hidden min-h-[330px] pb-6"
                  style={{ touchAction: 'pan-y' }}
                  // Hold the rotation while the strip is being read or used.
                  // Focus is tracked with the capture phase so it fires for a
                  // link *inside* a card, not just the strip itself.
                  onMouseEnter={() => holdAutoplay(true)}
                  onMouseLeave={() => holdAutoplay(false)}
                  onFocusCapture={() => holdAutoplay(true)}
                  onBlurCapture={() => holdAutoplay(false)}
                >
                  {/* All cards live in a single horizontal strip — dragX slides the whole strip */}
                  <motion.div style={{ x: dragX, display: 'flex' }}>
                    {carouselSlots.map((slot, idx) => {
                      const active = slot.key === adminCardView
                      return (
                      /* The strip is `overflow-hidden`, so the slides either
                         side are invisible but were still in the tab order —
                         tabbing off the active card dropped focus onto links
                         no one could see and dragged the strip sideways. `inert`
                         takes the whole offscreen subtree out of the tab order
                         and out of the a11y tree in one go (and, unlike
                         `tabIndex={-1}`, it reaches descendants); aria-hidden
                         covers the browsers that don't support it yet. */
                      <div
                        key={slot.key}
                        role="group"
                        aria-roledescription="slide"
                        aria-label={`${idx + 1} of ${carouselSlots.length}: ${slot.key.replace(/-/g, ' ')}`}
                        aria-hidden={!active}
                        {...(active ? {} : INERT_ATTR)}
                        style={{ width: containerW || '100%', flexShrink: 0 }}
                      >
                        <div className="home-container">
                          {slot.heading}
                          <div className="mx-2 sm:mx-4">{slot.body}</div>
                        </div>
                      </div>
                      )
                    })}
                  </motion.div>

                  {/* A pointer has no swipe, so where there is one the strip
                      grows arrows either side (revealed on hover, and on focus
                      for keyboard users) on top of the dots below. Keyed on the
                      pointer rather than the width: the strip only survives
                      below `md:` now, and a mouse user in a narrow window is
                      exactly the case that has no other way to page through
                      it. */}
                  {hasHover && CARD_VIEWS.length > 1 && (
                    <CarouselArrows
                      onPrev={() => snapToView(CARD_VIEWS[(CARD_VIEWS.indexOf(adminCardView) - 1 + CARD_VIEWS.length) % CARD_VIEWS.length])}
                      onNext={() => snapToView(CARD_VIEWS[(CARD_VIEWS.indexOf(adminCardView) + 1) % CARD_VIEWS.length])}
                    />
                  )}

                  {/* Slide indicator dots, plus the autoplay stop control.
                      The dots keep their 6 px look but each one now sits in a
                      44 px-tall tap target (a transparent padded button with
                      the dot drawn inside) — at their old size they were a
                      6 px target, well under the 44 px floor, and on a phone
                      they sit right where a thumb lands. */}
                  <div className="flex justify-center items-center gap-0.5 mt-1">
                    {CARD_VIEWS.map((v: AdminCardView) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => { if (v !== adminCardView) snapToView(v) }}
                        aria-label={`Show ${v.replace(/-/g, ' ')}`}
                        aria-current={adminCardView === v}
                        className="group/dot h-11 px-1.5 flex items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
                      >
                        <span
                          className={`block rounded-full transition-all duration-300 ${adminCardView === v ? `w-4 h-1.5 ${DOT_COLORS[v]}` : 'w-1.5 h-1.5 bg-slate-300 group-hover/dot:bg-slate-400'}`}
                        />
                      </button>
                    ))}

                    {/* WCAG 2.2.2 — the deck advances itself every 7 s, so
                        there has to be a way to stop it that doesn't depend on
                        hovering. Hidden when the OS already asks for reduced
                        motion, since nothing is rotating to stop. */}
                    {CARD_VIEWS.length > 1 && !reduceMotion && (
                      <button
                        type="button"
                        onClick={() => setUserPausedAutoplay(p => !p)}
                        aria-label={userPausedAutoplay ? 'Resume automatic card rotation' : 'Stop automatic card rotation'}
                        aria-pressed={userPausedAutoplay}
                        className="ml-1 w-11 h-11 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
                      >
                        {userPausedAutoplay ? <Play size={12} /> : <Pause size={12} />}
                      </button>
                    )}
                  </div>
                </div>
            </motion.div>
          </div>
          )}

          {/* ── md: and up, row 1 — the feeds, as a 12-column dashboard grid.
              Every card in a fixed place and on screen at once, which is the
              whole point: a card that moves position between visits can never
              be learned, and one behind a rotation can't be glanced at.
              Deliberately *not* `grid-flow-row-dense`: dense packing back-fills
              the gap a `wide` card leaves at the end of a row by pulling a
              later `half` up into it, which tiles the deck without holes but
              makes the visual order diverge from the DOM order — a keyboard
              user would then tab through the cards in a different sequence from
              the one they are reading. One trailing gap is cosmetic; a tab
              order that disagrees with the page is not.
              `items-stretch` plus `.home-grid`'s `height: 100%` gives every
              card in a row a shared bottom edge. ── */}
          {/* The dashboard is one region with one rhythm — the feed grid and
              the statistics below it, separated by a single `space-y-6` step
              and closed by its own bottom padding. Two sibling containers each
              with their own padding is what left the last card butted against
              the white More Apps band with nothing between them. */}
          {gridLayout && (gridSlots.length > 0 || showOverviewPanel || attendanceSlot || feeSlots.length > 0) && (
            <div className="home-container pt-6 pb-6 space-y-6">

              {gridSlots.length > 0 && (
                <motion.div
                  variants={cardVariants}
                  className="home-grid grid grid-cols-1 md:grid-cols-12 items-stretch gap-4 lg:gap-5"
                >
                  {gridSlots.map(slot => (
                    <section
                      key={slot.key}
                      className={`flex flex-col min-w-0 ${spanClassFor(slot)}`}
                      aria-label={slot.key.replace(/-/g, ' ')}
                    >
                      {slot.heading}
                      {/* min-h-0 lets an overflow-y-auto card inside actually
                          scroll instead of growing the row; the min-height is
                          the floor a short card holds so a row of one list and
                          one near-empty card doesn't collapse to nothing. */}
                      <div className="flex-1 min-h-0 md:min-h-[230px]">
                        {slot.desktopBody ?? slot.body}
                      </div>
                    </section>
                  ))}
                </motion.div>
              )}

              {/* The standing statistics, never behind a gesture.
                  At `lg:` they are one panel: attendance, school fees and bus
                  fees are the same question asked of three ledgers, so they
                  share a surface, a header and a footer strip instead of
                  sitting in three cards with three headings and three borders
                  between them.
                  Between 768 and 1024 they stay as separate tile cards — a
                  donut beside its metric rows needs more than a half of
                  900px. */}
              {isDesktop && showOverviewPanel && (
                <motion.div variants={cardVariants}>
                  <SchoolOverviewPanel
                    attendance={showAttendanceStat
                      ? { counts: attendanceCounts, subtitle: coordinatorSubtitle }
                      : null}
                    schoolFees={schoolFeesSummary}
                    busFees={busFeesSummary}
                    showAttendance={showAttendanceStat}
                    showSchoolFees={showFeesStat}
                    showBusFees={showBusFeesStat}
                    today={today}
                  />
                </motion.div>
              )}

              {!isDesktop && attendanceSlot && (
                <motion.section variants={cardVariants}>
                  {attendanceSlot.heading}
                  {attendanceSlot.body}
                </motion.section>
              )}
              {!isDesktop && feeSlots.length > 0 && (
                <motion.div
                  variants={cardVariants}
                  className={`grid gap-4 items-stretch ${feeSlots.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}
                >
                  {feeSlots.map(slot => (
                    <section key={slot.key} className="flex flex-col min-w-0">
                      {slot.heading}
                      <div className="flex-1">{slot.body}</div>
                    </section>
                  ))}
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
          <motion.div variants={cardVariants}>
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
