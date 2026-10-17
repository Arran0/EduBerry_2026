'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Mail, Phone as PhoneIcon, IdCard, Hash, Briefcase, CalendarDays, CalendarCheck, GraduationCap, Download, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useProfileCard, type ProfileCardSeed } from '@/contexts/ProfileCardContext'
import { supabase, UserProfile, getDisplayRole, getRoleBadgeColor } from '@/lib/supabase'
import { fetchRawSetting } from '@/lib/pageConfig'
import { fetchStudentDetails } from '@/lib/studentDetails'
import { fetchStaffDirectory } from '@/lib/staffDetails'
import { Homeroom, fetchHomeromsForStudent } from '@/lib/homerooms'
import { currentAcademicYear } from '@/lib/fees'
import { gradeLabel } from '@/lib/grades'
import Avatar from '@/components/Avatar'
import useBodyScrollLock from '@/hooks/useBodyScrollLock'
import { useRouter } from 'next/navigation'

// Loaded on demand — the read-only "self" view of the same calendar the
// attendance pages open when you click a name, reused here so a profile
// card gives a quick attendance glance without leaving the current page.
const StaffAttendanceCalendar = dynamic(() => import('@/components/attendance/StaffAttendanceCalendar'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading calendar…</div>,
})
const AttendanceCalendar = dynamic(() => import('@/components/attendance/AttendanceCalendar'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading calendar…</div>,
})

// Loaded on demand — the same "Download Centre" document pickers already used
// on the fees/salary/bus admin pages, reused here so they're one tap away
// from any profile card instead of only reachable from those admin screens.
const downloadCentreLoading = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <Loader2 size={26} className="animate-spin text-white" />
  </div>
)
const StudentStatementsModal = dynamic(() => import('@/components/fees/StudentStatementsModal'), { ssr: false, loading: downloadCentreLoading })
const SalaryStatementsModal = dynamic(() => import('@/components/salary/SalaryStatementsModal'), { ssr: false, loading: downloadCentreLoading })
const DriverStatementsModal = dynamic(() => import('@/components/bus/DriverStatementsModal'), { ssr: false, loading: downloadCentreLoading })

// ─── Role helpers ──────────────────────────────────────────────────────────────
const STAFF_ROLES = new Set(['teacher', 'coordinator', 'principal', 'admin'])

function isStaff(role: string) { return STAFF_ROLES.has(role) }

/** WhatsApp's glyph — lucide has no brand icons, so this is a small inline SVG
 *  drawn to match the recognizable "phone in a speech bubble" mark. */
function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M20.52 3.449C12.831-3.984.106 1.407.101 11.893c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652a11.882 11.882 0 0 0 5.723 1.462h.005c9.968 0 15.096-11.876 8.396-19.398zM12.06 21.785h-.004a9.87 9.87 0 0 1-5.033-1.378l-.361-.214-3.741.975.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.253c0-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.883 9.884z" />
    </svg>
  )
}

/** The caption under an action button's glyph. Every button carries one now —
 *  WhatsApp and Call used to be bare icons among labelled neighbours. */
function ActionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="max-w-full truncate px-0.5 text-[8px] font-bold uppercase leading-none tracking-wide">
      {children}
    </span>
  )
}

// Calendar access: viewer must rank strictly above target (or be admin / same person).
const ROLE_RANK: Record<string, number> = {
  student: 0, teacher: 1, coordinator: 2, principal: 3, admin: 4,
}

function hasCalendarAccess(viewer: UserProfile, target: UserProfile): boolean {
  if (viewer.id === target.id) return true
  if (viewer.role === 'admin') return true
  return (ROLE_RANK[viewer.role] ?? 0) > (ROLE_RANK[target.role] ?? 0)
}

/**
 * The card's resting height: banner (128) + body (347) — avatar, name, role,
 * the two contact rows, the chip pair and the action row, each with its line
 * box pinned so this number stays true. Opening states are drawn to it, so a
 * card that has to fetch its profile is the same size as one handed it.
 */
const CARD_MIN_HEIGHT = 475

/** The card's own layout in grey, for the opens that have nothing to draw yet. */
function ProfileCardSkeleton({ bannerUrl }: { bannerUrl: string | null }) {
  const bar = 'rounded-lg bg-slate-200/80 animate-pulse'
  return (
    <div style={{ minHeight: CARD_MIN_HEIGHT }}>
      <div
        className="relative h-32 flex-shrink-0"
        style={bannerUrl
          ? { backgroundImage: `url(${bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: 'linear-gradient(140deg, #3f3f46 0%, #1c1c1e 100%)' }}
      >
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-black/35" />
      </div>
      <div className="relative flex flex-col items-center -mt-10 px-5 pb-5">
        <div className="h-[84px] w-[84px] animate-pulse rounded-full bg-slate-200 ring-[5px] ring-white" />
        <div className={`mt-3 h-[22px] w-44 ${bar}`} />
        <div className={`mt-1.5 h-5 w-24 rounded-full ${bar}`} />
        <div className={`mt-4 h-[89px] w-full ${bar}`} />
        <div className="mt-2 grid w-full grid-cols-2 gap-2">
          <div className={`h-[46px] ${bar}`} />
          <div className={`h-[46px] ${bar}`} />
        </div>
        <div className={`mt-3 h-[52px] w-full ${bar}`} />
      </div>
    </div>
  )
}

/** A value still in flight, drawn at the height the value itself will take. */
function ValueSkeleton({ className = 'w-16' }: { className?: string }) {
  return <span className={`inline-block h-3 align-middle rounded bg-slate-200 animate-pulse ${className}`} />
}

/**
 * Small labeled fact chip — admission/roll no., employee id/designation.
 *
 * Always renders, blank or not: these chips are filled by a query that lands
 * after the card is open, so dropping the empty ones made the card's height a
 * function of data it did not have yet.
 */
function InfoChip({ icon, label, value, loading }: {
  icon: React.ReactNode
  label: string
  value: string | null
  loading: boolean
}) {
  return (
    <div className="flex h-[46px] min-w-0 items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-2.5">
      <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200/80">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[8px] font-bold uppercase leading-none tracking-wider text-slate-400">{label}</p>
        <p className="mt-1 truncate text-xs leading-tight">
          {loading
            ? <ValueSkeleton className="w-12" />
            : value
              ? <span className="font-medium text-slate-700">{value}</span>
              : <span className="text-slate-300">Nil</span>}
        </p>
      </div>
    </div>
  )
}

/** A contact line that holds its place whether or not there is anything on it. */
function ContactRow({ icon, label, value, href, loading, empty }: {
  icon: React.ReactNode
  label: string
  value: string | null
  href?: string
  loading: boolean
  empty: string
}) {
  const body = (
    <>
      <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 transition-colors group-hover:bg-white">
        {icon}
      </span>
      <span className="w-11 flex-shrink-0 text-[8px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      {loading
        ? <ValueSkeleton className="w-28" />
        : <span className={`truncate text-xs ${value ? 'font-medium text-slate-700' : 'text-slate-300'}`}>{value ?? empty}</span>}
    </>
  )
  const shell = 'group flex h-11 min-w-0 items-center gap-2.5 px-3'
  return href
    ? <a href={href} className={`${shell} transition-colors hover:bg-slate-50`}>{body}</a>
    : <div className={shell}>{body}</div>
}

/**
 * The banner is one site-wide setting, identical for every card. Fetching it
 * per open meant the header painted as the fallback gradient and then swapped
 * to the image a moment later — a flash on every single open. Read once.
 */
let bannerCache: string | null | undefined

/**
 * A seed is only good enough to render from if it carries the fields the card
 * shows above the fold. Anything less falls back to the loading state rather
 * than drawing a half-empty card.
 */
function seedToProfile(seed?: ProfileCardSeed | null): UserProfile | null {
  if (!seed?.full_name || !seed.email || !seed.role) return null
  return { created_at: '', updated_at: '', ...seed } as UserProfile
}

// ─── Inner modal (needs auth + router) ────────────────────────────────────────
function ProfileCardModal({ userId, seed, onClose }: { userId: string; seed: ProfileCardSeed | null; onClose: () => void }) {
  // Freeze the page underneath. Without this the card floats over a document
  // that is still free to scroll — and over a horizontally scrolled table, such
  // as the class-marks matrix, the page visibly lurches as the card opens and
  // again as it closes. The lock is refcounted, so the statement modals this
  // card can open on top of it nest safely.
  useBodyScrollLock()

  const { profile: viewerProfile } = useAuth()
  const router = useRouter()

  // Opened from a list that already knows this person, the card starts fully
  // drawn and the fetch below only fills in what the list didn't have.
  const [targetProfile, setTargetProfile] = useState<UserProfile | null>(() => seedToProfile(seed))
  const [loadingProfile, setLoadingProfile] = useState(() => !seedToProfile(seed))
  const [phone, setPhone] = useState<string | null>(null)
  // Student-only facts
  const [admissionNo, setAdmissionNo] = useState<string | null>(null)
  const [rollNo, setRollNo] = useState<string | null>(null)
  // Staff-only facts
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [designation, setDesignation] = useState<string | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(true)

  const [profileBannerUrl, setProfileBannerUrl] = useState<string | null>(bannerCache ?? null)

  // Attendance calendar drill-down (stacked on top of the card)
  const [showAttendance, setShowAttendance] = useState(false)
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [homeroomId, setHomeroomId] = useState<string | null>(null)
  const [loadingHomerooms, setLoadingHomerooms] = useState(false)
  const [calYear, setCalYear] = useState(() => new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth() + 1)

  // Download Centre — the same fee/salary/driver statement pickers used
  // elsewhere, opened in place of the card (it hides while this is up).
  const [showDownloadCentre, setShowDownloadCentre] = useState(false)


  const isStudentProfile = targetProfile?.role === 'student'
  const isDriverProfile = targetProfile?.role === 'driver'
  const isSalaryStaffProfile = !!targetProfile && isStaff(targetProfile.role)
  const showDownloadCentreBtn = !!viewerProfile && !!targetProfile
    && (viewerProfile.id === targetProfile.id || viewerProfile.role === 'admin')
    && (isStudentProfile || isDriverProfile || isSalaryStaffProfile)

  useEffect(() => {
    if (bannerCache !== undefined) return
    fetchRawSetting<string>('profile_banner').then(url => {
      bannerCache = typeof url === 'string' && url ? url : null
      setProfileBannerUrl(bannerCache)
    })
  }, [])

  const loadProfile = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (!error && data) setTargetProfile(data as UserProfile)
    setLoadingProfile(false)
  }, [userId])

  useEffect(() => { loadProfile() }, [loadProfile])

  // Load phone + a few identifying facts from the appropriate details table.
  //
  // Keyed on the id and role rather than the profile object: a seeded card
  // replaces `targetProfile` once its own fetch lands, and depending on the
  // object meant that second, identical profile ran this query all over again.
  const detailsId = targetProfile?.id
  const detailsRole = targetProfile?.role
  useEffect(() => {
    if (!detailsId || !detailsRole) return
    let active = true
    setLoadingDetails(true)
    if (detailsRole === 'student') {
      fetchStudentDetails(detailsId).then(d => {
        if (!active) return
        setPhone(d?.phone ?? null)
        setAdmissionNo(d?.admission_no ?? null)
        setRollNo(d?.roll_no ?? null)
        setLoadingDetails(false)
      })
    } else {
      fetchStaffDirectory(detailsId).then(d => {
        if (!active) return
        setPhone(d?.phone ?? null)
        setEmployeeId(d?.employee_id ?? null)
        setDesignation(d?.designation ?? null)
        setLoadingDetails(false)
      })
    }
    return () => { active = false }
  }, [detailsId, detailsRole])

  // Look up the student's homeroom the first time the attendance drill-down opens
  useEffect(() => {
    if (!showAttendance || !isStudentProfile || !targetProfile) return
    let active = true
    setLoadingHomerooms(true)
    fetchHomeromsForStudent(targetProfile.id).then(hrs => {
      if (!active) return
      setHomerooms(hrs)
      setHomeroomId(hrs[0]?.id ?? null)
      setLoadingHomerooms(false)
    })
    return () => { active = false }
  }, [showAttendance, isStudentProfile, targetProfile])

  // Escape closes whatever is actually on top: the Download Centre, then the
  // attendance drill-down, then the card itself. Without this the only way out
  // of a stack was to find each close button in turn.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showDownloadCentre) setShowDownloadCentre(false)
      else if (showAttendance) setShowAttendance(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showDownloadCentre, showAttendance, onClose])

  const openAcademicRecord = () => {
    if (!targetProfile) return
    onClose()
    router.push(`/academic-record/${targetProfile.id}`)
  }

  const openCalendarPage = () => {
    if (!targetProfile) return
    onClose()
    router.push(`/tasks?user=${targetProfile.id}&tab=weekly`)
  }

  return (
    <>
      {/* Backdrop + Card — hidden (not unmounted) while the Download Centre is open,
          so its own full-screen modal owns the screen and state is kept for the return trip. */}
      {!showDownloadCentre && (
        <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        onClick={onClose}
        // No backdrop-filter here. A blurred backdrop fading in over a page
        // that itself uses backdrop-filter (the transport admin's glass
        // panels) makes Chrome drop to black frames — the card, or the whole
        // app, flashed black as it opened. A plain dim does the job.
        className="fixed inset-0 z-[9998] bg-slate-900/55"
      />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        // A spring has no duration to wait on, which made closing drift; the
        // exit is an explicit short tween so the card leaves as decisively as
        // it arrives and AnimatePresence knows exactly when it is gone.
        exit={{ opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.14, ease: 'easeIn' } }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none"
      >
        {/* A plain div again: every slot inside is drawn whether or not it has
            a value, so the card is the same height from the frame it opens to
            the frame it closes. Nothing left to animate — and the layout
            animation that used to cover the resizing was itself what made
            closing lurch, since it re-measures against a card that is at the
            same time being scaled away. */}
        <div
          className="pointer-events-auto max-h-[88vh] w-full max-w-sm overflow-y-auto rounded-[28px] bg-white shadow-[0_28px_70px_-24px_rgba(15,23,42,0.55)] ring-1 ring-slate-900/[0.06]"
          onClick={e => e.stopPropagation()}
        >
          {loadingProfile ? (
            <ProfileCardSkeleton bannerUrl={profileBannerUrl} />
          ) : !targetProfile ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ minHeight: CARD_MIN_HEIGHT }}>
              <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-300">
                <X size={22} />
              </div>
              <p className="text-sm font-medium text-slate-600">Profile not found.</p>
              <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50">
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Banner — the admin's profiles_banner image. Its height is
                  deliberately left alone; what changed is that it now carries a
                  scrim at the bottom, so the avatar's white ring and the close
                  button read against any photograph rather than only against
                  the dark default gradient. */}
              <div
                className="relative h-32 flex-shrink-0"
                style={profileBannerUrl
                  ? { backgroundImage: `url(${profileBannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: 'linear-gradient(140deg, #3f3f46 0%, #1c1c1e 100%)' }
                }
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.18),transparent_65%)]" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-black/35" />
                <button
                  onClick={onClose}
                  aria-label="Close profile"
                  className="absolute top-3 right-3 grid h-7 w-7 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Body */}
              <div className="relative flex flex-col items-center -mt-10 px-5 pb-5">
                {/* Avatar */}
                <div
                  className="h-[84px] w-[84px] flex-shrink-0 overflow-hidden rounded-full ring-[5px] ring-white shadow-[0_10px_28px_-10px_rgba(15,23,42,0.55)] grid place-items-center"
                  style={{ background: profileBannerUrl ? '#27272A' : 'linear-gradient(135deg, #3f3f46, #1c1c1e)' }}
                >
                  <Avatar
                    avatarUrl={targetProfile.avatar_url}
                    name={targetProfile.full_name}
                    email={targetProfile.email}
                    size={84}
                  />
                </div>

                <h2 className="mt-3 font-display text-[17px] font-bold leading-[22px] text-slate-900 text-center">
                  {targetProfile.full_name || 'No Name'}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                  <span className={`rounded-full px-2.5 py-[3px] text-[10px] font-bold uppercase leading-[14px] tracking-wide ${getRoleBadgeColor(targetProfile.role, targetProfile.is_non_teaching)}`}>
                    {getDisplayRole(targetProfile)}
                  </span>
                  {/* gradeLabel, not `Grade ${grade}`: pre-primary years are
                      stored as negative numbers, so the old string rendered
                      LKG as "Grade -2". */}
                  {targetProfile.role === 'student' && targetProfile.grade != null && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-[3px] text-[10px] font-bold uppercase leading-[14px] tracking-wide text-slate-500">
                      {gradeLabel(targetProfile.grade)}{targetProfile.section ? ` · ${targetProfile.section}` : ''}
                    </span>
                  )}
                </div>

                {/* Contact — two rows of one bordered panel rather than two
                    floating grey pills, so the card reads as a record with
                    fields instead of a pile of chips.

                    Every slot here is drawn whether or not it has a value.
                    These arrive from a second query after the card is already
                    open, and hiding the blank ones made the card's height a
                    function of data it did not have yet — it resized under the
                    cursor, and animating that away only traded a jump for a
                    slide. "Nil" is also a straighter answer than an absence. */}
                <div className="mt-4 w-full divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80">
                  <ContactRow
                    icon={<Mail size={13} />}
                    label="Email"
                    value={targetProfile.email}
                    href={targetProfile.email ? `mailto:${targetProfile.email}` : undefined}
                    loading={false}
                    empty="Nil"
                  />
                  <ContactRow
                    icon={<PhoneIcon size={13} />}
                    label="Phone"
                    value={phone}
                    href={phone ? `tel:${phone.replace(/\D/g, '')}` : undefined}
                    loading={loadingDetails}
                    empty="Nil"
                  />
                </div>

                <div className="mt-2 grid w-full grid-cols-2 gap-2">
                  {isStudentProfile ? (
                    <>
                      <InfoChip icon={<IdCard size={13} />} label="Admission No." value={admissionNo} loading={loadingDetails} />
                      <InfoChip icon={<Hash size={13} />} label="Roll No." value={rollNo} loading={loadingDetails} />
                    </>
                  ) : (
                    <>
                      <InfoChip icon={<IdCard size={13} />} label="Employee ID" value={employeeId} loading={loadingDetails} />
                      <InfoChip icon={<Briefcase size={13} />} label="Designation" value={designation} loading={loadingDetails} />
                    </>
                  )}
                </div>

                {/* ── Actions — WhatsApp, Call, Attendance, Tasks, Record, Files.
                     One shared shape: a tinted tile with a glyph over a caption,
                     equally sized across the card's width. WhatsApp used to be
                     the one solid button among pale ones and the only two
                     without captions, which made the row read as two unrelated
                     groups. The row also keeps its place before the viewer's own
                     profile resolves, so the card is never briefly a tile
                     shorter. ─────────────────────────────────────────────────── */}
                {!viewerProfile ? <div className="mt-3 h-[52px] w-full" /> : (() => {
                  // Staff can see student contact buttons; so can the student themselves
                  const canSeeStudentActions = isStudentProfile && (viewerProfile.id === targetProfile.id || isStaff(viewerProfile.role))
                  // Everyone can see staff contact buttons
                  const canSeeStaffActions = !isStudentProfile
                  const showAcademicRecord = canSeeStudentActions
                  // Drivers don't use the task manager — they're routed straight to
                  // /driver and never see it — so their profile card skips this button.
                  const showTaskCalendar = canSeeStaffActions && !isDriverProfile && hasCalendarAccess(viewerProfile, targetProfile)
                  const showAttendanceBtn = isStudentProfile
                    ? canSeeStudentActions
                    : canSeeStaffActions && hasCalendarAccess(viewerProfile, targetProfile)

                  type ActionBtn = { key: string; label: string; href?: string; external?: boolean; onClick?: () => void; cls: string; content: React.ReactNode; disabled?: boolean }
                  const buttons: ActionBtn[] = []

                  // Always both, whether or not there is a number to dial.
                  // They used to appear only once the phone lookup came back,
                  // which re-columned this grid a beat after the card opened;
                  // greyed out they say the same thing without moving.
                  const dialable = phone ? phone.replace(/\D/g, '') : ''
                  buttons.push({
                    key: 'whatsapp',
                    label: dialable ? 'WhatsApp' : 'No phone on file',
                    href: dialable ? `https://wa.me/${dialable}` : undefined,
                    external: true,
                    disabled: !dialable,
                    cls: 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100',
                    content: <><WhatsAppIcon size={17} /><ActionLabel>WhatsApp</ActionLabel></>,
                  })
                  buttons.push({
                    key: 'call',
                    label: dialable ? 'Call' : 'No phone on file',
                    href: dialable ? `tel:${dialable}` : undefined,
                    disabled: !dialable,
                    cls: 'bg-sky-50 text-sky-600 border-sky-200 hover:bg-sky-100',
                    content: <><PhoneIcon size={16} /><ActionLabel>Call</ActionLabel></>,
                  })
                  if (showAttendanceBtn) {
                    buttons.push({
                      key: 'attendance',
                      label: 'Attendance',
                      onClick: () => setShowAttendance(true),
                      cls: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100',
                      content: <><CalendarCheck size={16} /><ActionLabel>Attendance</ActionLabel></>,
                    })
                  }
                  if (showTaskCalendar) {
                    buttons.push({
                      key: 'task',
                      label: 'Task Calendar',
                      onClick: openCalendarPage,
                      cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
                      content: <><CalendarDays size={16} /><ActionLabel>Tasks</ActionLabel></>,
                    })
                  }
                  if (showAcademicRecord) {
                    buttons.push({
                      key: 'record',
                      label: 'Academic Record',
                      onClick: openAcademicRecord,
                      cls: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
                      content: <><GraduationCap size={16} /><ActionLabel>Record</ActionLabel></>,
                    })
                  }
                  if (showDownloadCentreBtn) {
                    buttons.push({
                      key: 'downloads',
                      label: 'Download Centre',
                      onClick: () => setShowDownloadCentre(true),
                      cls: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100',
                      content: <><Download size={16} /><ActionLabel>Files</ActionLabel></>,
                    })
                  }

                  if (buttons.length === 0) return null

                  const GRID_COLS: Record<number, string> = {
                    1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5',
                  }
                  const btnCls = 'h-[52px] flex flex-col items-center justify-center gap-1 rounded-xl border px-1 font-medium transition-colors active:scale-[0.97]'

                  return (
                    <div className={`mt-3 grid w-full ${GRID_COLS[buttons.length] ?? 'grid-cols-5'} gap-1.5`}>
                      {buttons.map(b => b.disabled ? (
                        <div
                          key={b.key}
                          title={b.label}
                          aria-disabled
                          className={`${btnCls} cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300`}
                        >
                          {b.content}
                        </div>
                      ) : b.href ? (
                        <a
                          key={b.key}
                          href={b.href}
                          target={b.external ? '_blank' : undefined}
                          rel={b.external ? 'noopener noreferrer' : undefined}
                          title={b.label}
                          className={`${btnCls} ${b.cls}`}
                        >
                          {b.content}
                        </a>
                      ) : (
                        <button key={b.key} onClick={b.onClick} className={`${btnCls} ${b.cls}`}>
                          {b.content}
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </>
          )}
        </div>
      </motion.div>
        </>
      )}

      {/* Attendance calendar drill-down — the same "self" view opened from the
          attendance pages when tapping a name, stacked above the card. */}
      <AnimatePresence>
        {showAttendance && targetProfile && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowAttendance(false)}
              className="fixed inset-0 bg-black/60 z-[10000]"
            />
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 16 }}
              className="fixed inset-0 z-[10001] flex items-end sm:items-center justify-center p-3 sm:p-4 pointer-events-none"
            >
              <div
                className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
                  <Avatar avatarUrl={targetProfile.avatar_url} name={targetProfile.full_name} email={targetProfile.email} size={32} userId={targetProfile.id} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{targetProfile.full_name}</p>
                    <p className="text-[11px] text-slate-500">Attendance calendar</p>
                  </div>
                  <button
                    onClick={() => setShowAttendance(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
                {isStudentProfile && homerooms.length > 1 && (
                  <div className="px-5 pt-3 flex gap-2 flex-wrap flex-shrink-0">
                    {homerooms.map(hr => (
                      <button
                        key={hr.id}
                        onClick={() => setHomeroomId(hr.id)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${homeroomId === hr.id ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      >
                        {hr.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="overflow-y-auto flex-1 px-4 py-4">
                  {isStudentProfile ? (
                    loadingHomerooms ? (
                      <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading calendar…</div>
                    ) : homeroomId ? (
                      <AttendanceCalendar
                        studentId={targetProfile.id}
                        homeroomId={homeroomId}
                        year={calYear}
                        month={calMonth}
                        onMonthChange={(y, m) => { setCalYear(y); setCalMonth(m) }}
                        viewerUserId={viewerProfile?.id}
                        viewerRole={viewerProfile?.role}
                      />
                    ) : (
                      <div className="flex items-center justify-center py-16 text-slate-400 text-sm">No homeroom assigned.</div>
                    )
                  ) : (
                    <StaffAttendanceCalendar
                      staffId={targetProfile.id}
                      staffName={targetProfile.full_name}
                      mode="self"
                      viewerUserId={viewerProfile?.id}
                      viewerRole={viewerProfile?.role}
                    />
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Download Centre — the same document pickers used on the fees/salary/bus
          admin pages, opened in place of the card (see the hide-not-unmount above). */}
      {showDownloadCentre && targetProfile && (
        isStudentProfile ? (
          <StudentStatementsModal student={targetProfile} year={currentAcademicYear()} onClose={() => setShowDownloadCentre(false)} />
        ) : isDriverProfile ? (
          <DriverStatementsModal driver={targetProfile} onClose={() => setShowDownloadCentre(false)} />
        ) : (
          <SalaryStatementsModal staff={targetProfile} onClose={() => setShowDownloadCentre(false)} />
        )
      )}
    </>
  )
}

// ─── Portal wrapper (rendered in ProfileCardProvider) ─────────────────────────
export default function ProfileCard() {
  const { activeUserId, activeSeed, closeProfileCard } = useProfileCard()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  if (!mounted) return null

  return createPortal(
    // mode="wait" because the card is keyed by user: closing one and opening
    // another before the first has left would otherwise mount both at once,
    // stacking two backdrops into a visible double-darkening. The exits below
    // are short tweens, so waiting for one costs a frame or two.
    <AnimatePresence mode="wait">
      {activeUserId && (
        <ProfileCardModal
          key={activeUserId}
          userId={activeUserId}
          seed={activeSeed}
          onClose={closeProfileCard}
        />
      )}
    </AnimatePresence>,
    document.body
  )
}
