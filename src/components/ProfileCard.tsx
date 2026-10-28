'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { sheetMotion, SCRIM_MOTION } from '@/lib/sheetMotion'
import { X, Mail, Phone as PhoneIcon, IdCard, Hash, Briefcase, CalendarDays, CalendarCheck, GraduationCap, Download, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useProfileCard, type ProfileCardSeed, type SupportCardPerson } from '@/contexts/ProfileCardContext'
import { supabase, UserProfile, getDisplayRole, getRoleBadgeColor } from '@/lib/supabase'
import { PROFILE_COLUMNS, fetchProfileCardEmail } from '@/lib/profileColumns'
import {
  getCachedProfileBanner,
  isProfileBannerDecoded,
  decodeProfileBanner,
  subscribeProfileBanner,
  warmProfileBanner,
} from '@/lib/profileBanner'
import { fetchStudentDetails } from '@/lib/studentDetails'
import { fetchStaffDirectory } from '@/lib/staffDetails'
import { Homeroom, fetchHomeromsForStudent } from '@/lib/homerooms'
import { currentAcademicYear } from '@/lib/fees'
import { gradeLabel } from '@/lib/grades'
import Avatar from '@/components/Avatar'
import useBodyScrollLock from '@/hooks/useBodyScrollLock'
import { useRouter } from 'next/navigation'
import type { StaffAttendanceRecord } from '@/lib/attendance'
import StaffCalendarModal from '@/components/attendance/StaffCalendarModal'
import StudentCalendarModal from '@/components/attendance/StudentCalendarModal'

// Loaded on demand — the read-only "self" view of the same calendar the
// attendance pages open when you click a name, reused here so a profile
// card gives a quick attendance glance without leaving the current page.

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

/**
 * The card's header image. The photo is drawn as an <img> over a placeholder
 * rather than as a CSS background: a background that is still downloading
 * paints nothing, so the header showed the dark fallback gradient — a black
 * blink — until the bytes arrived. The image is decoded off-screen first (see
 * lib/profileBanner) and, once it is, paints in the same frame as the card.
 *
 * `url` undefined means this device has never asked (a first visit): the
 * placeholder is a quiet light grey then, never the dark "no banner" gradient,
 * which is reserved for a school that genuinely has none.
 */
function CardBanner({ url, children }: { url: string | null | undefined; children?: React.ReactNode }) {
  const [ready, setReady] = useState(() => !!url && isProfileBannerDecoded(url))
  useEffect(() => {
    if (!url) return
    if (isProfileBannerDecoded(url)) { setReady(true); return }
    setReady(false)
    let live = true
    decodeProfileBanner(url).then(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [url])

  return (
    <div
      className="relative h-32 flex-shrink-0 overflow-hidden"
      style={{
        background: url === null
          ? 'linear-gradient(140deg, #3f3f46 0%, #1c1c1e 100%)'
          : 'linear-gradient(140deg, #e2e8f0 0%, #cbd5e1 100%)',
      }}
    >
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-200"
          style={{ opacity: ready ? 1 : 0 }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.18),transparent_65%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-black/35" />
      {children}
    </div>
  )
}

/** The card's own layout in grey, for the opens that have nothing to draw yet. */
function ProfileCardSkeleton({ bannerUrl }: { bannerUrl: string | null | undefined }) {
  const bar = 'rounded-lg bg-slate-200/80 animate-pulse'
  return (
    <div style={{ minHeight: CARD_MIN_HEIGHT }}>
      <CardBanner url={bannerUrl} />
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
 * A name is enough to draw the card from. Every avatar now hands over what it
 * knows (name, face, often email); the role badge, email and action row hold
 * their places as placeholders until the profile lands, so the card opens as
 * itself rather than as a grey skeleton that then swaps for the real card — a
 * visible blink a beat after opening.
 */
function seedToProfile(seed?: ProfileCardSeed | null): UserProfile | null {
  if (!seed?.full_name) return null
  return { created_at: '', updated_at: '', email: '', role: '', ...seed } as unknown as UserProfile
}

/** The dimmed backdrop and the card's own surface — shared by every kind of card. */
function CardFrame({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const reduceMotion = useReducedMotion()
  return (
    <>
      <motion.div
        {...SCRIM_MOTION}
        onClick={onClose}
        // No backdrop-filter here. A blurred backdrop fading in over a page
        // that itself uses backdrop-filter (the transport admin's glass
        // panels) makes Chrome drop to black frames — the card, or the whole
        // app, flashed black as it opened. A plain dim does the job.
        className="fixed inset-0 z-[9998] bg-slate-900/55"
      />
      <motion.div
        // Slides up and back down, never fades or scales: fading the card
        // made Chrome paint it into a fresh offscreen surface on every open
        // and close, drawn black whenever it wasn't ready — see lib/sheetMotion.
        {...sheetMotion(reduceMotion)}
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none"
      >
        {/* A plain div: every slot inside is drawn whether or not it has a
            value, so the card is the same height from the frame it opens to
            the frame it closes. */}
        <div
          className="pointer-events-auto max-h-[88vh] w-full max-w-sm overflow-y-auto rounded-[28px] bg-white shadow-[0_28px_70px_-24px_rgba(15,23,42,0.55)] ring-1 ring-slate-900/[0.06]"
          onClick={e => e.stopPropagation()}
        >
          {children}
        </div>
      </motion.div>
    </>
  )
}

/** The close button on the banner. */
function CardClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Close profile"
      // No backdrop-filter: a blurred chip inside a card that is fading in is
      // one of the layers that made Chrome flash black.
      className="absolute top-3 right-3 grid h-7 w-7 place-items-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      <X size={14} />
    </button>
  )
}

/** The action row's placeholder while the viewer's or the target's role is still unknown. */
function ActionRowSkeleton() {
  return (
    <div className="mt-3 grid w-full grid-cols-4 gap-1.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[52px] rounded-xl border border-slate-200/70 bg-slate-100/80 animate-pulse" />
      ))}
    </div>
  )
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
  // Whether the full profile row has landed — a seeded card may be missing
  // fields (the email) until it has.
  const [profileFetched, setProfileFetched] = useState(false)
  const [phone, setPhone] = useState<string | null>(null)
  // Student-only facts
  const [admissionNo, setAdmissionNo] = useState<string | null>(null)
  const [rollNo, setRollNo] = useState<string | null>(null)
  // Staff-only facts
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [designation, setDesignation] = useState<string | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(true)

  // The site-wide banner as this device has it cached — see lib/profileBanner.
  const [profileBannerUrl, setProfileBannerUrl] = useState<string | null | undefined>(getCachedProfileBanner)
  useEffect(() => subscribeProfileBanner(setProfileBannerUrl), [])

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

  const loadProfile = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .single()
    if (!error && data) {
      const profile = data as unknown as UserProfile
      // A student's address is hidden from other students in lists, but the
      // card shows it to anyone who opens it — asked for only when hidden.
      if (!profile.email) profile.email = (await fetchProfileCardEmail(userId)) ?? ''
      setTargetProfile(profile)
    }
    setLoadingProfile(false)
    setProfileFetched(true)
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
      <CardFrame onClose={onClose}>
          {loadingProfile ? (
            <ProfileCardSkeleton bannerUrl={profileBannerUrl} />
          ) : !targetProfile || (profileFetched && !targetProfile.role) ? (
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
              {/* Banner — the admin's profile_banner image, with a scrim at
                  the bottom so the avatar's white ring and the close button
                  read against any photograph. */}
              <CardBanner url={profileBannerUrl}>
                <button
                  onClick={onClose}
                  aria-label="Close profile"
                  // No backdrop-filter: a blurred chip inside a card that is
                  // fading in is one of the layers that made Chrome flash black.
                  className="absolute top-3 right-3 grid h-7 w-7 place-items-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <X size={14} />
                </button>
              </CardBanner>

              {/* Body */}
              <div className="relative flex flex-col items-center -mt-10 px-5 pb-5">
                {/* Avatar */}
                <div
                  className="h-[84px] w-[84px] flex-shrink-0 overflow-hidden rounded-full ring-[5px] ring-white shadow-[0_10px_28px_-10px_rgba(15,23,42,0.55)] grid place-items-center"
                  // Light, not near-black: this disc shows for a beat before the face
                  // loads, and a dark one read as another blink.
                  style={{ background: '#e2e8f0' }}
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
                  {targetProfile.role ? (
                    <span className={`rounded-full px-2.5 py-[3px] text-[10px] font-bold uppercase leading-[14px] tracking-wide ${getRoleBadgeColor(targetProfile.role, targetProfile.is_non_teaching)}`}>
                      {getDisplayRole(targetProfile)}
                    </span>
                  ) : (
                    <span className="h-5 w-20 rounded-full bg-slate-200/80 animate-pulse" />
                  )}
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
                    value={targetProfile.email || null}
                    href={targetProfile.email ? `mailto:${targetProfile.email}` : undefined}
                    loading={!targetProfile.email && !profileFetched}
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
                {!viewerProfile || !targetProfile.role ? <ActionRowSkeleton /> : (() => {
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
      </CardFrame>
        </>
      )}

      {/* Attendance calendar drill-down — the same "self" view opened from the
          attendance pages when tapping a name, stacked above the card. */}
      <AnimatePresence>
        {showAttendance && targetProfile && !isStudentProfile && (
          <StaffCalendarModal
            person={targetProfile}
            subtitle="Attendance calendar"
            viewerId={viewerProfile?.id}
            viewerRole={viewerProfile?.role}
            onClose={() => setShowAttendance(false)}
            zClass="z-[10000]"
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showAttendance && targetProfile && isStudentProfile && (
          <StudentCalendarModal
            student={targetProfile}
            subtitle="Attendance calendar"
            homeroomId={homeroomId}
            loadingHomeroom={loadingHomerooms}
            year={calYear}
            month={calMonth}
            onMonthChange={(y, m) => { setCalYear(y); setCalMonth(m) }}
            viewerUserId={viewerProfile?.id}
            viewerRole={viewerProfile?.role}
            onClose={() => setShowAttendance(false)}
            zClass="z-[10000]"
            top={homerooms.length > 1 ? (
              <div className="h-8 flex gap-2 overflow-x-auto scrollbar-hide">
                {homerooms.map(hr => (
                  <button
                    key={hr.id}
                    onClick={() => setHomeroomId(hr.id)}
                    className={`px-3 h-8 rounded-full text-xs font-medium flex-shrink-0 transition-colors ${homeroomId === hr.id ? 'bg-violet-600 text-white' : 'bg-white/80 text-slate-600 hover:bg-white'}`}
                  >
                    {hr.name}
                  </button>
                ))}
              </div>
            ) : undefined}
          />
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

// ─── Support staff card ───────────────────────────────────────────────────────
/**
 * The same card for a ground support staff member. They have no account, so
 * the card is drawn entirely from their roster row — no fetch, nothing to wait
 * for — and offers what applies to them: a call or WhatsApp to their phone and
 * their attendance month.
 */
function SupportStaffCardModal({ person, onClose }: { person: SupportCardPerson; onClose: () => void }) {
  useBodyScrollLock()
  const { profile: viewerProfile } = useAuth()
  const [bannerUrl, setBannerUrl] = useState<string | null | undefined>(getCachedProfileBanner)
  useEffect(() => subscribeProfileBanner(setBannerUrl), [])
  const [showAttendance, setShowAttendance] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || showAttendance) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showAttendance, onClose])

  // Their month lives in support_staff_attendance, adapted into the shape the
  // staff calendar reads — the same adapter payroll and the report use.
  const fetchGroundRecords = useCallback(async (staffId: string, year: number, month: number): Promise<StaffAttendanceRecord[]> => {
    const { fetchSupportAttendanceRange, supportRecordToStaffShape } = await import('@/lib/supportStaff')
    const pad = (n: number) => String(n).padStart(2, '0')
    const recs = await fetchSupportAttendanceRange(`${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`)
    return recs.filter(r => r.support_staff_id === staffId).map(supportRecordToStaffShape)
  }, [])

  const dialable = person.phone ? person.phone.replace(/\D/g, '') : ''
  const canSeeAttendance = !!viewerProfile && isStaff(viewerProfile.role)
  const btnCls = 'h-[52px] flex flex-col items-center justify-center gap-1 rounded-xl border px-1 font-medium transition-colors active:scale-[0.97]'
  const off = `${btnCls} cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300`

  return (
    <>
      <CardFrame onClose={onClose}>
        <CardBanner url={bannerUrl}>
          <CardClose onClose={onClose} />
        </CardBanner>
        <div className="relative flex flex-col items-center -mt-10 px-5 pb-5">
          <div
            className="h-[84px] w-[84px] flex-shrink-0 overflow-hidden rounded-full ring-[5px] ring-white shadow-[0_10px_28px_-10px_rgba(15,23,42,0.55)] grid place-items-center"
            style={{ background: '#e2e8f0' }}
          >
            <Avatar name={person.full_name} size={84} />
          </div>
          <h2 className="mt-3 font-display text-[17px] font-bold leading-[22px] text-slate-900 text-center">{person.full_name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
            <span className="rounded-full px-2.5 py-[3px] text-[10px] font-bold uppercase leading-[14px] tracking-wide bg-lime-100 text-lime-800">
              Support staff
            </span>
            {person.department && (
              <span className="rounded-full bg-slate-100 px-2.5 py-[3px] text-[10px] font-bold uppercase leading-[14px] tracking-wide text-slate-500">
                {person.department}
              </span>
            )}
          </div>

          <div className="mt-4 w-full divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80">
            <ContactRow
              icon={<PhoneIcon size={13} />}
              label="Phone"
              value={person.phone ?? null}
              href={dialable ? `tel:${dialable}` : undefined}
              loading={false}
              empty="Nil"
            />
            <ContactRow
              icon={<PhoneIcon size={13} />}
              label="Alt."
              value={person.alternate_phone ?? null}
              href={person.alternate_phone ? `tel:${person.alternate_phone.replace(/\D/g, '')}` : undefined}
              loading={false}
              empty="Nil"
            />
          </div>

          <div className="mt-2 grid w-full grid-cols-2 gap-2">
            <InfoChip icon={<IdCard size={13} />} label="Employee ID" value={person.employee_id ?? null} loading={false} />
            <InfoChip icon={<Briefcase size={13} />} label="Designation" value={person.designation ?? null} loading={false} />
          </div>

          <div className={`mt-3 grid w-full ${canSeeAttendance ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5`}>
            {dialable ? (
              <a href={`https://wa.me/${dialable}`} target="_blank" rel="noopener noreferrer" title="WhatsApp"
                className={`${btnCls} bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100`}>
                <WhatsAppIcon size={17} /><ActionLabel>WhatsApp</ActionLabel>
              </a>
            ) : (
              <div className={off} title="No phone on file" aria-disabled><WhatsAppIcon size={17} /><ActionLabel>WhatsApp</ActionLabel></div>
            )}
            {dialable ? (
              <a href={`tel:${dialable}`} title="Call" className={`${btnCls} bg-sky-50 text-sky-600 border-sky-200 hover:bg-sky-100`}>
                <PhoneIcon size={16} /><ActionLabel>Call</ActionLabel>
              </a>
            ) : (
              <div className={off} title="No phone on file" aria-disabled><PhoneIcon size={16} /><ActionLabel>Call</ActionLabel></div>
            )}
            {canSeeAttendance && (
              <button onClick={() => setShowAttendance(true)} className={`${btnCls} bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100`}>
                <CalendarCheck size={16} /><ActionLabel>Attendance</ActionLabel>
              </button>
            )}
          </div>
        </div>
      </CardFrame>

      <AnimatePresence>
        {showAttendance && (
          <StaffCalendarModal
            person={person}
            subtitle={person.designation ?? 'Support staff'}
            viewerId={viewerProfile?.id}
            viewerRole={viewerProfile?.role}
            onClose={() => setShowAttendance(false)}
            fetchRecords={fetchGroundRecords}
            zClass="z-[10000]"
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ─── Portal wrapper (rendered in ProfileCardProvider) ─────────────────────────
export default function ProfileCard() {
  const { activeUserId, activeSeed, activeSupport, closeProfileCard } = useProfileCard()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    // Decode the banner now, while nobody is looking, so the first card of the
    // visit opens with its photo already drawn.
    warmProfileBanner()
  }, [])

  if (!mounted) return null

  return createPortal(
    // mode="wait" because the card is keyed by user: closing one and opening
    // another before the first has left would otherwise mount both at once,
    // stacking two backdrops into a visible double-darkening. The exits below
    // are short tweens, so waiting for one costs a frame or two.
    // profile-card-portal: the globals.css safety net that keeps every
    // backdrop-filter out of the card (the cause of the black blink).
    <div className="profile-card-portal">
    <AnimatePresence mode="wait">
      {activeSupport ? (
        <SupportStaffCardModal
          key={activeUserId}
          person={activeSupport}
          onClose={closeProfileCard}
        />
      ) : activeUserId && (
        <ProfileCardModal
          key={activeUserId}
          userId={activeUserId}
          seed={activeSeed}
          onClose={closeProfileCard}
        />
      )}
    </AnimatePresence>
    </div>,
    document.body
  )
}
