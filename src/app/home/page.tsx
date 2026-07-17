'use client'

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getRoleDisplayName, isAdminRole } from '@/lib/supabase'
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion'
import Link from 'next/link'
import {
  Bell,
  Megaphone,
  ChevronRight,
  Pencil,
  GraduationCap,
  Sun,
  Sunset,
  Moon,
  ClipboardList,
  UserCheck,
  Calendar,
  CalendarDays,
  CalendarRange,
  CreditCard,
  Banknote,
  Bus,
  FileText,
  LayoutGrid,
  Image as ImageIcon,
  Shield,
  BarChart3,
  Users,
  Briefcase,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  CalendarCheck,
} from 'lucide-react'
import { isStaffRole } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { currentAcademicYear, academicYearOf } from '@/lib/fees'
import {
  fetchAttendanceConfig,
  fetchHolidayByDate,
  fetchAllTrackedStaff,
  fetchStaffAttendanceReportByDate,
  StaffAttendanceRecord,
} from '@/lib/attendance'
import { fetchTeamMembers } from '@/lib/tasks'
import {
  AnnouncementWithDetails,
  fetchAnnouncementsForUser,
} from '@/lib/announcements'
import { ClassroomWithDetails, fetchClassroomsForUser } from '@/lib/classrooms'
import { sortByLastVisited } from '@/lib/classroomVisits'
import { getShowClassroomsOnHome } from '@/lib/homeClassroomsVisibility'
import { sampleImageLuminance } from '@/lib/luminance'
import DailyQuoteCard from '@/components/home/DailyQuoteCard'
import ClassroomButton from '@/components/classrooms/ClassroomButton'
import { useStudentLeaveNotifications, useStaffLeaveNotifications } from '@/hooks/useLeaveNotifications'
import { useAutoLoadMore } from '@/hooks/useAutoLoadMore'
import { useGridColumns } from '@/hooks/useGridColumns'
import { classroomGridMaxHeight } from '@/lib/classroomGridLayout'

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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-1">
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

const itemVariants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
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
    <div className="flex items-end justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className={`icon-chip w-9 h-9 ${chipClass}`}>
          <Icon size={16} className="relative z-10 text-white drop-shadow-sm" />
        </div>
        <div>
          {eyebrow && (
            <p
              className={`eyebrow mb-1.5 ${dark ? 'text-white/70' : 'text-slate-400'}`}
              style={dark ? { textShadow: '0 1px 3px rgba(0,0,0,0.45)' } : undefined}
            >
              {eyebrow}
            </p>
          )}
          <h2
            className={`font-display text-[1.4rem] font-bold leading-none headline ${dark ? 'text-white' : 'text-slate-900'}`}
            style={dark ? { textShadow: '0 1px 4px rgba(0,0,0,0.5)' } : undefined}
          >
            {title}
          </h2>
          {subtitle && <p className={`text-[10px] leading-none mt-1.5 ${dark ? 'text-white/60' : 'text-slate-400'}`}>{subtitle}</p>}
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

/** Frosted announcements list — shared by the admin carousel and the
 *  student/staff standalone card so both stay pixel-identical. */
function AnnouncementsList({ items }: { items: AnnouncementWithDetails[] }) {
  return (
    <div className="glass-card rounded-[1.4rem] h-[260px] overflow-y-auto scrollbar-hide">
      {items.length > 0 ? (
        <div className="divide-y divide-white/25">
          {items.map((announcement, i) => (
            <Link key={announcement.id} href="/announcements">
              <div className="flex items-center gap-3.5 px-5 py-4 hover:bg-white/45 transition-colors group cursor-pointer">
                <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${announcementColors[i % announcementColors.length]}`} />
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-slate-800 text-sm truncate group-hover:text-slate-900 transition-colors">{announcement.title}</h4>
                </div>
                <span className="flex-shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/55 text-slate-500 group-hover:bg-white/80 transition-colors">
                  {formatRelativeDate(announcement.created_at)}
                </span>
                <ChevronRight size={14} className="flex-shrink-0 text-slate-300 transition-all duration-200 group-hover:text-slate-500 group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="h-full flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center mb-3">
            <Megaphone size={22} className="text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-400">No announcements yet</p>
          <p className="text-xs text-slate-300 mt-1">Check back later for updates</p>
        </div>
      )}
    </div>
  )
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now  = new Date()

  // Compare calendar dates in local timezone (not raw elapsed ms)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  if (sameDay(date, now))        return 'Today'
  if (sameDay(date, yesterday))  return 'Yesterday'

  const diffDays = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
     new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000
  )
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const announcementColors = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
]

type AdminCardView = 'attendance' | 'fees' | 'bus-fees' | 'announcements'

function fmtINR(amount: number): string {
  const n = Number(amount) || 0
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(1) + 'Cr'
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L'
  if (n >= 1000) return '₹' + (n / 1000).toFixed(0) + 'K'
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

interface HomeFeesSummary {
  collected: number
  outstanding: number
  todayCollection: number
  studentsWithDues: number
}

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
  const [announcements, setAnnouncements] = useState<AnnouncementWithDetails[]>([])
  const [welcomeBanner, setWelcomeBanner] = useState<string | null>(null)
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])
  const [classroomsLoaded, setClassroomsLoaded] = useState(false)
  // Tracks the classroom whose page is being navigated to, for instant tap feedback.
  const [navigatingId, setNavigatingId] = useState<string | null>(null)
  const [moreAppsImage, setMoreAppsImage] = useState('')
  const [editingMoreAppsBg, setEditingMoreAppsBg] = useState(false)
  const [bannerLum, setBannerLum] = useState<number | null>(null)
  const [appsLum, setAppsLum] = useState<number | null>(null)
  const [bannerReady, setBannerReady] = useState(false)
  const [adminCardView, setAdminCardView] = useState<AdminCardView>('attendance')
  const [containerW, setContainerW] = useState(0)
  const [attendanceCounts, setAttendanceCounts] = useState<{
    students: { present: number; absent: number; exception: number }
    staff: { present: number; absent: number; exception: number }
  } | null>(null)
  const [schoolFeesSummary, setSchoolFeesSummary] = useState<HomeFeesSummary | null>(null)
  const [busFeesSummary, setBusFeesSummary] = useState<HomeFeesSummary | null>(null)
  const swipeStartXRef = useRef<number | null>(null)
  const baseOffsetRef = useRef(0)
  const dragX = useMotionValue(0)
  const cardContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.from('site_settings').select('value').eq('key', 'welcome_banner').single()
      .then(({ data }) => {
        const url = data?.value as string | undefined
        if (url) {
          const img = new window.Image()
          img.onload = () => { window.scrollTo(0, 0); setWelcomeBanner(url); setBannerReady(true) }
          img.onerror = () => { window.scrollTo(0, 0); setWelcomeBanner(url); setBannerReady(true) }
          img.src = url
        } else {
          window.scrollTo(0, 0)
          setBannerReady(true)
        }
      })
    supabase.from('site_settings').select('value').eq('key', 'more_apps_bg').single()
      .then(({ data }) => { if (data?.value) { try { const v = JSON.parse(data.value); if (v.imageUrl) setMoreAppsImage(v.imageUrl) } catch {} } })
  }, [])

  useEffect(() => {
    if (welcomeBanner) {
      sampleImageLuminance(welcomeBanner, 0.4).then(setBannerLum)
    } else {
      setBannerLum(null)
    }
  }, [welcomeBanner])

  useEffect(() => {
    if (moreAppsImage) {
      sampleImageLuminance(moreAppsImage, 1.0).then(setAppsLum)
    } else {
      setAppsLum(null)
    }
  }, [moreAppsImage])

  const handleMoreAppsBgUpload = async (file: File) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `site/more_apps_bg_${Date.now()}_${safeName}`
    const { data, error } = await supabase.storage.from('classroom-files').upload(path, file, { upsert: true })
    if (error) { alert('Upload failed: ' + error.message); return }
    const { data: { publicUrl } } = supabase.storage.from('classroom-files').getPublicUrl(data.path)
    setMoreAppsImage(publicUrl)
    await supabase.from('site_settings').upsert({ key: 'more_apps_bg', value: JSON.stringify({ imageUrl: publicUrl }) }, { onConflict: 'key' })
    setEditingMoreAppsBg(false)
  }

  const removeMoreAppsImage = async () => {
    setMoreAppsImage('')
    await supabase.from('site_settings').upsert({ key: 'more_apps_bg', value: JSON.stringify({ imageUrl: '' }) }, { onConflict: 'key' })
    setEditingMoreAppsBg(false)
  }

  const handleBannerUpload = async (file: File) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `site/welcome_banner_${Date.now()}_${safeName}`
    const { data, error } = await supabase.storage.from('classroom-files').upload(path, file, { upsert: true })
    if (error) { alert('Upload failed: ' + error.message); return }
    const { data: { publicUrl } } = supabase.storage.from('classroom-files').getPublicUrl(data.path)
    await supabase.from('site_settings').upsert({ key: 'welcome_banner', value: publicUrl }, { onConflict: 'key' })
    setWelcomeBanner(publicUrl)
  }

  const loadAnnouncements = useCallback(async () => {
    if (!user || !profile) return
    try {
      const data = await fetchAnnouncementsForUser(
        user.id,
        profile.role,
        profile.grade ?? undefined,
        profile.section ?? undefined,
        5,
      )
      setAnnouncements(data)
    } catch (err) {
      console.error('Failed to load announcements for home:', err)
    }
  }, [user, profile])

  const loadClassrooms = useCallback(async () => {
    if (!user || !profile) return
    // Admin/principal accounts don't get this section on home unless they've
    // opted in from the Academics page — skip the fetch entirely by default.
    const isAdminOrPrincipal = isAdminRole(profile.role) || profile.role === 'principal'
    if (isAdminOrPrincipal && !getShowClassroomsOnHome(user.id)) {
      setClassrooms([])
      setClassroomsLoaded(true)
      return
    }
    try {
      const enrolled = await fetchClassroomsForUser(user.id, profile.role)
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

    // Coordinator: scope staff counts to their team only, including themself
    // (matching the roster shown on the Staff Attendance report) and excluding
    // hidden/banned staff so they don't inflate the absent count.
    let staffIds: string[] | null = null
    if (isCoordinator) {
      const team = await fetchTeamMembers(user.id, 'coordinator')
      staffIds = [user.id, ...team.filter(m => !m.attendance_hidden && !m.is_banned).map(m => m.id)]
    }

    // Fetch status values for today and count client-side.
    // Using { head: true } count queries can silently return 0 for specific
    // enum values due to PostgREST HEAD request behaviour; data fetches are reliable.
    const noStaff = staffIds !== null && staffIds.length === 0

    const isWeekend = (() => { const d = new Date(today + 'T12:00:00').getDay(); return d === 0 || d === 6 })()

    const [sRecords, allStaffRecords, attendanceCfg, holidayToday, allTracked] = await Promise.all([
      supabase.from('attendance_records').select('status').eq('date', today).then(r => r.data ?? []),
      // Already excludes hidden/banned staff (joined + filtered server-side),
      // matching the actual Staff Attendance report's numbers.
      noStaff ? Promise.resolve([] as StaffAttendanceRecord[]) : fetchStaffAttendanceReportByDate(today),
      isWeekend ? Promise.resolve({ late_cutoff: null, checkout_cutoff: null }) : fetchAttendanceConfig(),
      isWeekend ? Promise.resolve(null as null) : fetchHolidayByDate(today),
      // Admins/principals need the full tracked-staff list; coordinators use staffIds
      (!isWeekend && !isCoordinator) ? fetchAllTrackedStaff() : Promise.resolve([] as { id: string }[]),
    ])

    // Need staff_id to compute virtual absents (staff with no record = shown as absent
    // in the staff attendance page after the late cutoff, matching its "Absentees" list).
    const stRecords = staffIds !== null
      ? allStaffRecords.filter(r => staffIds!.includes(r.staff_id))
      : allStaffRecords

    const STUDENT_PRESENT = new Set(['present', 'late', 'on_duty'])
    const STUDENT_ABSENT  = new Set(['absent', 'on_leave'])
    const STAFF_PRESENT   = new Set(['present', 'wfh', 'late'])
    const STAFF_ABSENT    = new Set(['absent', 'on_leave'])

    const tallyStudents = (rows: { status: string }[]) => ({
      present:   rows.filter(r => STUDENT_PRESENT.has(r.status)).length,
      absent:    rows.filter(r => STUDENT_ABSENT.has(r.status)).length,
      exception: rows.filter(r => !STUDENT_PRESENT.has(r.status) && !STUDENT_ABSENT.has(r.status)).length,
    })
    const tallyStaff = (rows: { status: string }[]) => ({
      present:   rows.filter(r => STAFF_PRESENT.has(r.status)).length,
      absent:    rows.filter(r => STAFF_ABSENT.has(r.status)).length,
      exception: rows.filter(r => !STAFF_PRESENT.has(r.status) && !STAFF_ABSENT.has(r.status)).length,
    })

    // Mirror the virtual-absent logic from AllStaffAttendanceReport:
    // after the late cutoff on a working day, tracked staff with no record count as absent.
    let virtualAbsentCount = 0
    if (!isWeekend && !holidayToday && !noStaff) {
      let pastCutoff = false
      if (attendanceCfg.late_cutoff) {
        const [h, m] = attendanceCfg.late_cutoff.split(':').map(Number)
        if (!Number.isNaN(h) && !Number.isNaN(m)) {
          const now = new Date()
          pastCutoff = (now.getHours() * 60 + now.getMinutes()) > (h * 60 + m)
        }
      }
      if (pastCutoff) {
        const recordedIds = new Set(stRecords.map(r => r.staff_id))
        const scope = isCoordinator ? (staffIds ?? []) : allTracked.map(s => s.id)
        virtualAbsentCount = scope.filter(id => !recordedIds.has(id)).length
      }
    }

    const staffTally = tallyStaff(stRecords)
    setAttendanceCounts({
      students: tallyStudents(sRecords),
      staff: { ...staffTally, absent: staffTally.absent + virtualAbsentCount },
    })
  }, [isAttendanceViewer, isCoordinator, user])

  const CARD_VIEWS = useMemo<AdminCardView[]>(
    () => isAdmin ? ['attendance', 'fees', 'bus-fees', 'announcements'] : ['attendance', 'announcements'],
    [isAdmin],
  )

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

  useLayoutEffect(() => {
    const el = cardContainerRef.current
    if (!el) return
    const measure = () => setContainerW(el.offsetWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { loadAnnouncements() }, [loadAnnouncements])
  useEffect(() => { loadClassrooms() }, [loadClassrooms])
  useEffect(() => { if (isAttendanceViewer) loadAttendanceCounts() }, [isAttendanceViewer, loadAttendanceCounts])
  useEffect(() => { if (isAdmin) loadFeeSummaries() }, [isAdmin, loadFeeSummaries])
  useEffect(() => {
    if (!isAttendanceViewer) return
    const t = setInterval(() => {
      const W = cardContainerRef.current?.offsetWidth ?? window.innerWidth
      const views: AdminCardView[] = isAdmin ? ['attendance', 'fees', 'bus-fees', 'announcements'] : ['attendance', 'announcements']
      const currentIdx = Math.round(-dragX.get() / W)
      const nextIdx = (currentIdx + 1) % views.length
      setAdminCardView(views[nextIdx])
      animate(dragX, -nextIdx * W, { type: 'spring', stiffness: 300, damping: 32, mass: 0.9 })
    }, 6000)
    return () => clearInterval(t)
  }, [isAttendanceViewer, isAdmin, dragX])

  const getGreetingData = () => {
    const hour = new Date().getHours()
    if (hour < 5)  return { line1: 'Good evening.',    line2: 'Wishing you a restful and peaceful night.',          icon: <Moon    size={16} className="text-indigo-300" /> }
    if (hour < 8)  return { line1: 'Good morning.',    line2: 'An early start sets the tone for a great day.',      icon: <Sun     size={16} className="text-amber-300" /> }
    if (hour < 12) return { line1: 'Good morning.',    line2: 'Wishing you a focused and productive morning.',      icon: <Sun     size={16} className="text-yellow-300" /> }
    if (hour < 16) return { line1: 'Good afternoon.',  line2: 'Trust you are having a smooth and productive day.',  icon: <Sun     size={16} className="text-orange-300" /> }
    if (hour < 19) return { line1: 'Good afternoon.',  line2: 'You have made great progress — keep it going.',      icon: <Sunset  size={16} className="text-orange-400" /> }
    return               { line1: 'Good evening.',     line2: 'Hope the day has been rewarding and worthwhile.',    icon: <Moon    size={16} className="text-indigo-300" /> }
  }

  const isStaff = profile ? isStaffRole(profile.role) : false
  const isStudent = !isStaff
  const classroomColumns = useGridColumns()
  const HOME_CLASSROOM_VISIBLE_ROWS = 3
  const HOME_CLASSROOM_LIMIT = classroomColumns * HOME_CLASSROOM_VISIBLE_ROWS
  const HOME_CLASSROOM_COL_GAP = 10
  const HOME_CLASSROOM_ROW_GAP = 12.5 // 25% more than the column gap, for shadow-bleed margin between rows
  const homeClassroomsMaxHeight = classroomGridMaxHeight(HOME_CLASSROOM_VISIBLE_ROWS, HOME_CLASSROOM_ROW_GAP)
  const {
    visibleCount: classroomVisibleCount,
    containerRef: classroomsScrollRef,
    handleScroll: handleClassroomsScroll,
  } = useAutoLoadMore({ total: classrooms.length, initialCount: HOME_CLASSROOM_LIMIT, step: 4, intervalMs: 3000, bottomBufferPx: HOME_CLASSROOM_ROW_GAP })
  const topClassrooms = classrooms.slice(0, classroomVisibleCount)

  const { count: studentLeaveCount } = useStudentLeaveNotifications(user?.id ?? null, isStudent)
  const { count: staffLeaveCount } = useStaffLeaveNotifications(isStaff ? (user?.id ?? null) : null)

  const snapToView = useCallback((targetView: AdminCardView) => {
    const W = cardContainerRef.current?.offsetWidth ?? window.innerWidth
    const views: AdminCardView[] = isAdmin ? ['attendance', 'fees', 'bus-fees', 'announcements'] : ['attendance', 'announcements']
    const targetIdx = views.indexOf(targetView)
    setAdminCardView(targetView)
    animate(dragX, -targetIdx * W, { type: 'spring', stiffness: 300, damping: 32, mass: 0.9 })
  }, [isAdmin, dragX])

  const handleSwipeStart = useCallback((e: React.TouchEvent) => {
    swipeStartXRef.current = e.touches[0].clientX
    baseOffsetRef.current = dragX.get()
  }, [dragX])

  const handleSwipeMove = useCallback((e: React.TouchEvent) => {
    if (swipeStartXRef.current === null) return
    const W = cardContainerRef.current?.offsetWidth ?? window.innerWidth
    const views: AdminCardView[] = isAdmin ? ['attendance', 'fees', 'bus-fees', 'announcements'] : ['attendance', 'announcements']
    const dx = e.touches[0].clientX - swipeStartXRef.current
    const raw = baseOffsetRef.current + dx
    const minX = -(views.length - 1) * W
    const maxX = 0
    // Rubber-band resistance at edges
    const x = raw < minX ? minX + (raw - minX) * 0.22 : raw > maxX ? raw * 0.22 : raw
    dragX.set(x)
  }, [isAdmin, dragX])

  const handleSwipeEnd = useCallback((e: React.TouchEvent) => {
    if (swipeStartXRef.current === null) return
    const dx = e.changedTouches[0].clientX - swipeStartXRef.current
    swipeStartXRef.current = null
    const W = cardContainerRef.current?.offsetWidth ?? window.innerWidth
    const views: AdminCardView[] = isAdmin ? ['attendance', 'fees', 'bus-fees', 'announcements'] : ['attendance', 'announcements']
    const currentX = dragX.get()
    const fractional = -currentX / W
    let targetIdx: number
    if (dx < -40) {
      targetIdx = Math.min(Math.ceil(fractional - 0.1), views.length - 1)
    } else if (dx > 40) {
      targetIdx = Math.max(Math.floor(fractional + 0.1), 0)
    } else {
      targetIdx = Math.max(0, Math.min(Math.round(fractional), views.length - 1))
    }
    setAdminCardView(views[targetIdx])
    animate(dragX, -targetIdx * W, { type: 'spring', stiffness: 300, damping: 32, mass: 0.9 })
  }, [isAdmin, dragX])

  // bannerLum===null means default gradient (white fade makes it light → dark text)
  // bannerLum set means custom image → use luminance threshold
  const bannerOnDark = bannerLum !== null && bannerLum < 0.4
  // appsLum===null means default light gradient → dark text
  const appsOnDark = appsLum !== null && appsLum < 0.4

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
    {
      key: 'student-leave',
      href: '/more/leave',
      icon: Calendar,
      label: 'Student OD/Leave',
      iconGradient: 'from-violet-500 to-purple-700',
      cardBg: 'bg-violet-50',
      cardBorder: 'border-violet-200',
      notificationCount: studentLeaveCount,
    },
    {
      key: 'staff-leave',
      href: '/more/staff-leave',
      icon: CalendarDays,
      label: 'Staff OD/Leave',
      iconGradient: 'from-sky-400 to-blue-600',
      cardBg: 'bg-sky-50',
      cardBorder: 'border-sky-200',
      staffOnly: true,
      notificationCount: staffLeaveCount,
    },
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

  return (
    <ProtectedLayout>
      <div data-page-theme="home">
        <motion.div variants={containerVariants} initial="hidden" animate="visible">

          {/* ── Immersive full-width welcome banner ── */}
          <AnimatePresence>
            {bannerReady && (
              <motion.div
                key="home-banner"
                initial={{ height: 0 }}
                animate={{ height: 340 }}
                exit={{ height: 0 }}
                transition={{ duration: 1.05, ease: [0.22, 1, 0.36, 1] }}
                className="relative w-full overflow-hidden sheen sheen-animate"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 1.04 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-x-0 top-0"
                  style={{ height: 340, willChange: 'transform, opacity' }}
                >

              {/* Background: photo (slow Ken Burns drift) or vivid gradient */}
              {welcomeBanner ? (
                <motion.img
                  src={welcomeBanner}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  initial={{ scale: 1.12 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 9, ease: 'easeOut' }}
                  style={{ willChange: 'transform' }}
                />
              ) : (
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
              )}

              {/* Admin: small pencil icon pinned to top-right corner */}
              {isAdmin && (
                <label className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur-sm flex items-center justify-center cursor-pointer transition-all">
                  <Pencil size={13} className="text-white" />
                  <input type="file" accept="image/*" className="hidden" onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleBannerUpload(f)
                  }} />
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

              {/* Welcome text — pinned inside the blur zone */}
              <div className="absolute inset-x-0 bottom-0 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-7">
                  {(() => {
                    const { line1, line2, icon } = getGreetingData()
                    const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                    return (
                      <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.35 }}
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
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Daily Quote — auto-dismisses after 7 s, collapses gap ── */}
          {bannerReady && <QuoteBanner />}

          {/* ── Admin dashboard cards (rotate every 6 s, swipe left/right to navigate) ── */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
            <motion.div variants={itemVariants} className="mb-0">
              {isAttendanceViewer ? (
                <div ref={cardContainerRef} onTouchStart={handleSwipeStart} onTouchMove={handleSwipeMove} onTouchEnd={handleSwipeEnd} className="overflow-hidden min-h-[330px]">
                  {/* All cards live in a single horizontal strip — dragX slides the whole strip */}
                  <motion.div style={{ x: dragX, display: 'flex' }}>
                  {(<>

                    {/* ── Slot: Attendance ── */}
                    <div style={{ width: containerW || '100%', flexShrink: 0 }}>
                      <SectionHeading
                        icon={BarChart3}
                        chipClass="bg-gradient-to-br from-emerald-400 to-teal-500"
                        eyebrow="Today"
                        title="Attendance"
                        subtitle={isCoordinator ? 'Your team' : undefined}
                        action={
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span className="text-[10px] font-semibold text-emerald-700">Live</span>
                            </div>
                            <span className="text-xs font-medium text-slate-400">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                          </div>
                        }
                      />
                      <div className="glass-card rounded-[1.4rem] h-[260px] overflow-hidden">
                        <div className="px-4 pt-3 pb-2 border-b border-white/25">
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-1.5">
                              <Users size={12} className="text-slate-500" />
                              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Students</span>
                            </div>
                            <Link href="/more/attendance" className="flex items-center gap-0.5 text-[10px] font-semibold text-sky-600 hover:text-sky-700 transition-colors">
                              View report <ChevronRight size={11} />
                            </Link>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <Link href="/more/attendance#student-present" className="group flex flex-col items-center justify-center py-2.5 rounded-xl bg-emerald-50/90 border border-emerald-200/60 hover:bg-emerald-100/90 hover:border-emerald-300/70 active:scale-95 transition-all">
                              <CheckCircle2 size={13} className="text-emerald-500 mb-1" />
                              <span className="text-xl font-black text-emerald-600 leading-none">{attendanceCounts?.students.present ?? '—'}</span>
                              <span className="text-[9.5px] font-semibold text-emerald-500 mt-1">Present</span>
                            </Link>
                            <Link href="/more/attendance#student-absent" className="group flex flex-col items-center justify-center py-2.5 rounded-xl bg-red-50/90 border border-red-200/60 hover:bg-red-100/90 hover:border-red-300/70 active:scale-95 transition-all">
                              <XCircle size={13} className="text-red-400 mb-1" />
                              <span className="text-xl font-black text-red-500 leading-none">{attendanceCounts?.students.absent ?? '—'}</span>
                              <span className="text-[9.5px] font-semibold text-red-400 mt-1">Absent</span>
                            </Link>
                            <Link href="/more/attendance#student-exceptions" className="group flex flex-col items-center justify-center py-2.5 rounded-xl bg-amber-50/90 border border-amber-200/60 hover:bg-amber-100/90 hover:border-amber-300/70 active:scale-95 transition-all">
                              <AlertTriangle size={12} className="text-amber-400 mb-1" />
                              <span className="text-xl font-black text-amber-500 leading-none">{attendanceCounts?.students.exception ?? '—'}</span>
                              <span className="text-[9.5px] font-semibold text-amber-400 mt-1">Irregular</span>
                            </Link>
                          </div>
                        </div>
                        <div className="px-4 pt-3 pb-2">
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-1.5">
                              <Briefcase size={12} className="text-slate-500" />
                              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Staff</span>
                            </div>
                            <Link href="/more/staff-attendance" className="flex items-center gap-0.5 text-[10px] font-semibold text-sky-600 hover:text-sky-700 transition-colors">
                              View report <ChevronRight size={11} />
                            </Link>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <Link href="/more/staff-attendance#staff-present" className="group flex flex-col items-center justify-center py-2.5 rounded-xl bg-emerald-50/90 border border-emerald-200/60 hover:bg-emerald-100/90 hover:border-emerald-300/70 active:scale-95 transition-all">
                              <CheckCircle2 size={13} className="text-emerald-500 mb-1" />
                              <span className="text-xl font-black text-emerald-600 leading-none">{attendanceCounts?.staff.present ?? '—'}</span>
                              <span className="text-[9.5px] font-semibold text-emerald-500 mt-1">Present</span>
                            </Link>
                            <Link href="/more/staff-attendance#staff-absent" className="group flex flex-col items-center justify-center py-2.5 rounded-xl bg-red-50/90 border border-red-200/60 hover:bg-red-100/90 hover:border-red-300/70 active:scale-95 transition-all">
                              <XCircle size={13} className="text-red-400 mb-1" />
                              <span className="text-xl font-black text-red-500 leading-none">{attendanceCounts?.staff.absent ?? '—'}</span>
                              <span className="text-[9.5px] font-semibold text-red-400 mt-1">Absent</span>
                            </Link>
                            <Link href="/more/staff-attendance#staff-exceptions" className="group flex flex-col items-center justify-center py-2.5 rounded-xl bg-amber-50/90 border border-amber-200/60 hover:bg-amber-100/90 hover:border-amber-300/70 active:scale-95 transition-all">
                              <AlertTriangle size={12} className="text-amber-400 mb-1" />
                              <span className="text-xl font-black text-amber-500 leading-none">{attendanceCounts?.staff.exception ?? '—'}</span>
                              <span className="text-[9.5px] font-semibold text-amber-400 mt-1">Irregular</span>
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── Slots: Fee Manager + Bus Fees (admin only) ── */}
                    {isAdmin && (
                      <>
                        <div style={{ width: containerW || '100%', flexShrink: 0 }}>
                          <SectionHeading
                            icon={CreditCard}
                            chipClass="bg-gradient-to-br from-teal-400 to-cyan-600"
                            eyebrow="School"
                            title="Fee Manager"
                            action={<ViewAllLink href="/more/fees" className="text-teal-600 hover:text-teal-700" />}
                          />
                          <div className="glass-card rounded-[1.4rem] h-[260px] p-4 flex items-center">
                            <div className="grid grid-cols-2 gap-3 w-full">
                              <Link href="/more/fees?section=issued&filter=collected" className="flex flex-col items-center justify-center py-5 rounded-xl bg-[#27272A] border border-[#B8983C] hover:opacity-90 active:scale-95 transition-all shadow-sm">
                                <CheckCircle2 size={15} className="text-[#B8983C] mb-1.5" />
                                <p className="text-base font-bold text-white tabular-nums leading-tight">{fmtINR(schoolFeesSummary?.collected ?? 0)}</p>
                                <p className="text-[9.5px] font-semibold text-[#A1A1AA] mt-0.5">Collected</p>
                              </Link>
                              <Link href="/more/fees?section=issued&filter=outstanding" className="flex flex-col items-center justify-center py-5 rounded-xl bg-white border border-[#E4E4E7] hover:bg-slate-50 active:scale-95 transition-all shadow-sm">
                                <Clock size={15} className="text-[#A1A1AA] mb-1.5" />
                                <p className="text-base font-bold text-[#18181B] tabular-nums leading-tight">{fmtINR(schoolFeesSummary?.outstanding ?? 0)}</p>
                                <p className="text-[9.5px] font-semibold text-[#71717A] mt-0.5">Outstanding</p>
                              </Link>
                              <Link href="/more/fees?section=collection" className="flex flex-col items-center justify-center py-5 rounded-xl bg-[#F4F2EC] border border-[#E7E2D8] hover:bg-amber-50 active:scale-95 transition-all shadow-sm">
                                <CalendarCheck size={15} className="text-[#A8896B] mb-1.5" />
                                <p className="text-base font-bold text-[#18181B] tabular-nums leading-tight">{fmtINR(schoolFeesSummary?.todayCollection ?? 0)}</p>
                                <p className="text-[9.5px] font-semibold text-[#71717A] mt-0.5">Today&apos;s Collection</p>
                              </Link>
                              <Link href="/more/fees?section=issued&filter=outstanding" className="flex flex-col items-center justify-center py-5 rounded-xl bg-white border border-[#E4E4E7] hover:bg-slate-50 active:scale-95 transition-all shadow-sm">
                                <Users size={15} className="text-[#A1A1AA] mb-1.5" />
                                <p className="text-base font-bold text-[#18181B] tabular-nums leading-tight">{schoolFeesSummary?.studentsWithDues ?? '—'}</p>
                                <p className="text-[9.5px] font-semibold text-[#71717A] mt-0.5">Students with Dues</p>
                              </Link>
                            </div>
                          </div>
                        </div>

                        <div style={{ width: containerW || '100%', flexShrink: 0 }}>
                          <SectionHeading
                            icon={Bus}
                            chipClass="bg-gradient-to-br from-orange-400 to-rose-500"
                            eyebrow="Transport"
                            title="Bus Fees"
                            action={<ViewAllLink href="/more/bus?tab=fees" className="text-orange-600 hover:text-orange-700" />}
                          />
                          <div className="glass-card rounded-[1.4rem] h-[260px] p-4 flex items-center">
                            <div className="grid grid-cols-2 gap-3 w-full">
                              <Link href="/more/bus?tab=fees&section=issued&filter=collected" className="flex flex-col items-center justify-center py-5 rounded-xl bg-[#27272A] border border-[#B8983C] hover:opacity-90 active:scale-95 transition-all shadow-sm">
                                <CheckCircle2 size={15} className="text-[#B8983C] mb-1.5" />
                                <p className="text-base font-bold text-white tabular-nums leading-tight">{fmtINR(busFeesSummary?.collected ?? 0)}</p>
                                <p className="text-[9.5px] font-semibold text-[#A1A1AA] mt-0.5">Collected</p>
                              </Link>
                              <Link href="/more/bus?tab=fees&section=issued&filter=outstanding" className="flex flex-col items-center justify-center py-5 rounded-xl bg-white border border-[#E4E4E7] hover:bg-slate-50 active:scale-95 transition-all shadow-sm">
                                <Clock size={15} className="text-[#A1A1AA] mb-1.5" />
                                <p className="text-base font-bold text-[#18181B] tabular-nums leading-tight">{fmtINR(busFeesSummary?.outstanding ?? 0)}</p>
                                <p className="text-[9.5px] font-semibold text-[#71717A] mt-0.5">Outstanding</p>
                              </Link>
                              <Link href="/more/bus?tab=fees&section=collection" className="flex flex-col items-center justify-center py-5 rounded-xl bg-[#F4F2EC] border border-[#E7E2D8] hover:bg-amber-50 active:scale-95 transition-all shadow-sm">
                                <CalendarCheck size={15} className="text-[#A8896B] mb-1.5" />
                                <p className="text-base font-bold text-[#18181B] tabular-nums leading-tight">{fmtINR(busFeesSummary?.todayCollection ?? 0)}</p>
                                <p className="text-[9.5px] font-semibold text-[#71717A] mt-0.5">Today&apos;s Collection</p>
                              </Link>
                              <Link href="/more/bus?tab=fees&section=issued&filter=outstanding" className="flex flex-col items-center justify-center py-5 rounded-xl bg-white border border-[#E4E4E7] hover:bg-slate-50 active:scale-95 transition-all shadow-sm">
                                <Users size={15} className="text-[#A1A1AA] mb-1.5" />
                                <p className="text-base font-bold text-[#18181B] tabular-nums leading-tight">{busFeesSummary?.studentsWithDues ?? '—'}</p>
                                <p className="text-[9.5px] font-semibold text-[#71717A] mt-0.5">Passengers with Dues</p>
                              </Link>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* ── Slot: Announcements ── */}
                    <div style={{ width: containerW || '100%', flexShrink: 0 }}>
                      <SectionHeading
                        icon={Bell}
                        chipClass="bg-gradient-to-br from-sky-400 to-blue-500"
                        eyebrow="Latest"
                        title="Announcements"
                        action={<ViewAllLink href="/announcements" className="text-sky-600 hover:text-sky-700" />}
                      />
                      <AnnouncementsList items={announcements} />
                    </div>

                  </>)}
                  </motion.div>
                  {/* Slide indicator dots */}
                  <div className="flex justify-center gap-1.5 mt-3">
                    {CARD_VIEWS.map((v: AdminCardView) => {
                      const dotColors: Record<AdminCardView, string> = {
                        attendance: 'bg-emerald-500',
                        fees: 'bg-teal-500',
                        'bus-fees': 'bg-orange-500',
                        announcements: 'bg-sky-500',
                      }
                      return (
                        <button
                          key={v}
                          onClick={() => { if (v !== adminCardView) snapToView(v) }}
                          className={`rounded-full transition-all duration-300 ${adminCardView === v ? `w-4 h-1.5 ${dotColors[v]}` : 'w-1.5 h-1.5 bg-slate-300 hover:bg-slate-400'}`}
                        />
                      )
                    })}
                  </div>
                </div>
              ) : (
                <>
                  <SectionHeading
                    icon={Bell}
                    chipClass="bg-gradient-to-br from-sky-400 to-blue-500"
                    eyebrow="Latest"
                    title="Announcements"
                    action={<ViewAllLink href="/announcements" className="text-sky-600 hover:text-sky-700" />}
                  />
                  <AnnouncementsList items={announcements} />
                </>
              )}
            </motion.div>
          </div>

          {/* ── Classrooms (hidden entirely for accounts not enrolled in any classroom) ── */}
          {classroomsLoaded && topClassrooms.length > 0 && (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-8">
              <motion.div variants={itemVariants}>
                <SectionHeading
                  icon={GraduationCap}
                  chipClass="bg-gradient-to-br from-cyan-400 to-teal-500"
                  eyebrow="Your spaces"
                  title={isStudent ? 'My Classrooms' : 'Classrooms'}
                  action={<ViewAllLink href="/academics" className="text-cyan-600 hover:text-cyan-700" />}
                />

                <div
                  ref={classroomsScrollRef}
                  onScroll={handleClassroomsScroll}
                  // maxHeight/gap are computed (classroomGridMaxHeight) from
                  // the same row-height/row-gap constants, so the container
                  // always fits exactly HOME_CLASSROOM_VISIBLE_ROWS full rows
                  // — never a partial row peeking in. Top edge sits flush
                  // against the first row (zero top padding); the bottom
                  // edge leaves exactly one row-gap's worth of space after
                  // the last row (paddingBottom/scrollPaddingBottom below) —
                  // the same rhythm as the gap between rows, not a separate
                  // buffer. -mx/px (matching the page's own responsive
                  // gutter: 16/24/32px) gives shadow-bleed room horizontally
                  // without exceeding the page's own padding (which would
                  // risk page-level overflow). snap-y/snap-start (on
                  // ClassroomButton) plus scroll-pb make that same bottom
                  // spacing hold for *whichever* row a scroll settles on,
                  // not just the true last row.
                  // The initial batch (HOME_CLASSROOM_LIMIT) matches the live
                  // column count exactly, so those rows load pre-filled with
                  // no partial row; auto-load/scroll reveals anything beyond.
                  style={{
                    maxHeight: homeClassroomsMaxHeight,
                    rowGap: HOME_CLASSROOM_ROW_GAP,
                    columnGap: HOME_CLASSROOM_COL_GAP,
                    paddingBottom: HOME_CLASSROOM_ROW_GAP,
                    scrollPaddingBottom: HOME_CLASSROOM_ROW_GAP,
                  }}
                  className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 content-start overflow-y-auto overscroll-contain scrollbar-hide snap-y snap-mandatory -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
                >
                  {topClassrooms.map((classroom, i) => (
                    <ClassroomButton
                      key={classroom.id}
                      classroom={classroom}
                      index={i}
                      heightClass="h-[64px]"
                      showTeacher
                      navigating={navigatingId === classroom.id}
                      onNavigate={() => setNavigatingId(classroom.id)}
                    />
                  ))}
                </div>
              </motion.div>
            </div>
          )}

          {/* ── More Apps (full-bleed) ── */}
          <motion.div variants={itemVariants}>
            <div
              className="relative w-full overflow-hidden"
              style={moreAppsImage ? {} : { background: 'linear-gradient(160deg, #ffffff 0%, #f4f6fb 100%)' }}
            >
              {/* Custom background image */}
              {moreAppsImage && (
                <img src={moreAppsImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
              )}

              {/* Admin: pencil pinned top-right */}
              {isAdmin && (
                <button
                  onClick={() => setEditingMoreAppsBg(p => !p)}
                  className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/20 hover:bg-black/40 backdrop-blur-sm flex items-center justify-center transition-all"
                >
                  <Pencil size={13} className="text-white" />
                </button>
              )}

              {/* Admin: inline editor bar */}
              {isAdmin && editingMoreAppsBg && (
                <div className="relative z-10 bg-black/20 backdrop-blur-md border-b border-white/15 px-4 sm:px-6 lg:px-8 py-3">
                  <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-2.5">
                    <label className="flex items-center gap-1.5 px-4 py-1.5 bg-white/25 hover:bg-white/40 text-white text-[11px] font-semibold rounded-full cursor-pointer border border-white/30 transition-colors">
                      <ImageIcon size={12} /> Upload photo
                      <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleMoreAppsBgUpload(f) }} />
                    </label>
                    {moreAppsImage && (
                      <button
                        onClick={removeMoreAppsImage}
                        className="px-4 py-1.5 bg-white/15 hover:bg-white/25 text-white/80 text-[11px] rounded-full border border-white/20 transition-colors"
                      >
                        Remove photo
                      </button>
                    )}
                    <button
                      onClick={() => setEditingMoreAppsBg(false)}
                      className="ml-auto px-4 py-1.5 text-white/70 hover:text-white text-[11px] font-semibold rounded-full border border-white/20 hover:bg-white/10 transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}

              {/* Content */}
              <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
                <SectionHeading
                  icon={LayoutGrid}
                  chipClass="bg-gradient-to-br from-sky-500 to-indigo-600"
                  eyebrow="Shortcuts"
                  title="More Apps"
                  dark={appsOnDark}
                />

                <div className="overflow-x-auto scrollbar-hide -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
                  <div className="flex gap-2">
                    {moreApps.map((app, idx) => {
                      const Icon = app.icon
                      return (
                        <Link
                          key={app.key}
                          href={app.href}
                          className="pressable glass-tile flex-1 min-w-[5.375rem] flex flex-col items-center gap-2 py-3 px-0.5 rounded-2xl"
                        >
                          <div className="relative w-full max-w-[2.6rem] aspect-square mx-auto">
                            <div
                              className="icon-chip w-full h-full"
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
                          <span className="text-[9.5px] font-semibold text-slate-700 leading-tight text-center line-clamp-2 w-full px-0.5">{app.label}</span>
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
      <footer className="relative pt-4 pb-4 text-center text-xs text-slate-400 border-t border-slate-100 bg-white">
        {/* white pseudo-fill — covers the bottom padding gap so the page gradient doesn't bleed through */}
        <span className="pointer-events-none absolute inset-x-0 top-full bg-white" style={{ height: 'calc(4rem + env(safe-area-inset-bottom))' }} aria-hidden />
        Powered by{' '}
        <a href="https://edzee.org/" target="_blank" rel="noopener noreferrer" className="font-medium text-slate-500 hover:text-slate-700 transition-colors">Edzee</a>
        <span className="mx-2 text-slate-300">·</span>
        <a href="https://edzee.org/terms" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600 transition-colors">Terms</a>
        <span className="mx-2 text-slate-300">·</span>
        <a href="https://edzee.org/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600 transition-colors">Privacy</a>
        <span className="mx-2 text-slate-300">·</span>
        <a href="https://edzee.org/cookies" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600 transition-colors">Cookies</a>
      </footer>
    </ProtectedLayout>
  )
}
