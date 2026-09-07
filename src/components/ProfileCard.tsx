'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Mail, Phone as PhoneIcon, IdCard, Hash, Briefcase, CalendarDays, CalendarCheck, GraduationCap, Download, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useProfileCard } from '@/contexts/ProfileCardContext'
import { supabase, UserProfile, getDisplayRole, getRoleBadgeColor } from '@/lib/supabase'
import { fetchStudentDetails } from '@/lib/studentDetails'
import { fetchStaffDetails } from '@/lib/staffDetails'
import { Homeroom, fetchHomeromsForStudent } from '@/lib/homerooms'
import { currentAcademicYear } from '@/lib/fees'
import Avatar from '@/components/Avatar'
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

// Calendar access: viewer must rank strictly above target (or be admin / same person).
const ROLE_RANK: Record<string, number> = {
  student: 0, teacher: 1, coordinator: 2, principal: 3, admin: 4,
}

function hasCalendarAccess(viewer: UserProfile, target: UserProfile): boolean {
  if (viewer.id === target.id) return true
  if (viewer.role === 'admin') return true
  return (ROLE_RANK[viewer.role] ?? 0) > (ROLE_RANK[target.role] ?? 0)
}

/** Small labeled fact chip — used for admission/roll no. and employee id/designation. */
function InfoChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 rounded-lg min-w-0">
      <span className="text-slate-400 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[8px] font-bold uppercase tracking-wide text-slate-400 leading-none">{label}</p>
        <p className="text-xs text-slate-600 truncate leading-tight mt-0.5">{value}</p>
      </div>
    </div>
  )
}

// ─── Inner modal (needs auth + router) ────────────────────────────────────────
function ProfileCardModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { profile: viewerProfile } = useAuth()
  const router = useRouter()

  const [targetProfile, setTargetProfile] = useState<UserProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [phone, setPhone] = useState<string | null>(null)
  // Student-only facts
  const [admissionNo, setAdmissionNo] = useState<string | null>(null)
  const [rollNo, setRollNo] = useState<string | null>(null)
  // Staff-only facts
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [designation, setDesignation] = useState<string | null>(null)

  const [profileBannerUrl, setProfileBannerUrl] = useState<string | null>(null)

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
    supabase.from('site_settings').select('value').eq('key', 'profile_banner').single()
      .then(({ data }) => { if (data?.value && typeof data.value === 'string') setProfileBannerUrl(data.value) })
  }, [])

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (!error && data) setTargetProfile(data as UserProfile)
    setLoadingProfile(false)
  }, [userId])

  useEffect(() => {
    setTargetProfile(null)
    setPhone(null)
    setAdmissionNo(null)
    setRollNo(null)
    setEmployeeId(null)
    setDesignation(null)
    loadProfile()
  }, [userId, loadProfile])

  // Load phone + a few identifying facts from the appropriate details table
  useEffect(() => {
    if (!targetProfile) return
    if (targetProfile.role === 'student') {
      fetchStudentDetails(targetProfile.id).then(d => {
        setPhone(d?.phone ?? null)
        setAdmissionNo(d?.admission_no ?? null)
        setRollNo(d?.roll_no ?? null)
      })
    } else {
      fetchStaffDetails(targetProfile.id).then(d => {
        setPhone(d?.phone ?? null)
        setEmployeeId(d?.employee_id ?? null)
        setDesignation(d?.designation ?? null)
      })
    }
  }, [targetProfile])

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
        onClick={onClose}
        className="fixed inset-0 bg-black/50 z-[9998]"
      />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none"
      >
        <div
          className="w-full max-w-sm rounded-3xl overflow-y-auto shadow-2xl bg-white border border-slate-100 max-h-[88vh] pointer-events-auto"
          onClick={e => e.stopPropagation()}
        >
          {loadingProfile ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 size={28} className="animate-spin text-slate-300" />
              <p className="text-sm text-slate-400">Loading profile…</p>
            </div>
          ) : !targetProfile ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 px-6 text-center">
              <p className="text-slate-500 text-sm">Profile not found.</p>
              <button onClick={onClose} className="text-xs text-slate-400 underline">Close</button>
            </div>
          ) : (
            <>
              {/* Gradient banner — uses the profiles_banner setting uploaded by admin */}
              <div
                className="relative h-32 flex-shrink-0"
                style={profileBannerUrl
                  ? { backgroundImage: `url(${profileBannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: 'linear-gradient(140deg, #3f3f46 0%, #1c1c1e 100%)' }
                }
              >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.15),transparent_70%)] pointer-events-none" />
                <button
                  onClick={onClose}
                  className="absolute top-2.5 right-2.5 p-1.5 bg-black/30 hover:bg-black/50 rounded-full text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Body */}
              <div className="relative flex flex-col items-center -mt-9 pb-4 px-5">
                {/* Avatar */}
                <div
                  className="w-[72px] h-[72px] rounded-full ring-4 ring-white shadow-lg overflow-hidden flex items-center justify-center flex-shrink-0"
                  style={{ background: profileBannerUrl ? '#27272A' : 'linear-gradient(135deg, #3f3f46, #1c1c1e)' }}
                >
                  <Avatar
                    avatarUrl={targetProfile.avatar_url}
                    name={targetProfile.full_name}
                    email={targetProfile.email}
                    size={72}
                  />
                </div>

                <h2 className="mt-2 font-display text-base font-bold text-slate-800 text-center leading-tight">
                  {targetProfile.full_name || 'No Name'}
                </h2>
                <div className="mt-1 flex items-center justify-center gap-1.5 flex-wrap">
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${getRoleBadgeColor(targetProfile.role, targetProfile.is_non_teaching)}`}>
                    {getDisplayRole(targetProfile)}
                  </span>
                  {targetProfile.role === 'student' && targetProfile.grade && (
                    <span className="text-[11px] text-slate-400">
                      Grade {targetProfile.grade}{targetProfile.section ? `-${targetProfile.section}` : ''}
                    </span>
                  )}
                </div>

                {/* Email + phone — each its own line — plus a couple of identifying facts */}
                <div className="mt-3 w-full flex flex-col gap-2">
                  <a
                    href={`mailto:${targetProfile.email}`}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors min-w-0"
                  >
                    <Mail size={12} className="text-slate-400 flex-shrink-0" />
                    <span className="text-xs text-slate-600 truncate">{targetProfile.email}</span>
                  </a>
                  {phone && (
                    <a
                      href={`tel:${phone.replace(/\D/g, '')}`}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors min-w-0"
                    >
                      <PhoneIcon size={12} className="text-slate-400 flex-shrink-0" />
                      <span className="text-xs text-slate-600 truncate">{phone}</span>
                    </a>
                  )}
                  {isStudentProfile && (admissionNo || rollNo) && (
                    <div className="grid grid-cols-2 gap-2">
                      {admissionNo && <InfoChip icon={<IdCard size={14} />} label="Admission No." value={admissionNo} />}
                      {rollNo && <InfoChip icon={<Hash size={14} />} label="Roll No." value={rollNo} />}
                    </div>
                  )}
                  {!isStudentProfile && (employeeId || designation) && (
                    <div className="grid grid-cols-2 gap-2">
                      {employeeId && <InfoChip icon={<IdCard size={14} />} label="Employee ID" value={employeeId} />}
                      {designation && <InfoChip icon={<Briefcase size={14} />} label="Designation" value={designation} />}
                    </div>
                  )}
                </div>

                {/* ── Action buttons — WhatsApp, Call, Attendance, Task, Academic Record,
                     Download Centre; rectangular, equally sized, spanning the card's full
                     width ──────────────────────────────────────────────────────────────── */}
                {viewerProfile && (() => {
                  // Staff can see student contact buttons; so can the student themselves
                  const canSeeStudentActions = isStudentProfile && (viewerProfile.id === targetProfile.id || isStaff(viewerProfile.role))
                  // Everyone can see staff contact buttons
                  const canSeeStaffActions = !isStudentProfile
                  const showAcademicRecord = canSeeStudentActions
                  const showTaskCalendar = canSeeStaffActions && hasCalendarAccess(viewerProfile, targetProfile)
                  const showAttendanceBtn = isStudentProfile
                    ? canSeeStudentActions
                    : canSeeStaffActions && hasCalendarAccess(viewerProfile, targetProfile)

                  type ActionBtn = { key: string; label: string; href?: string; external?: boolean; onClick?: () => void; cls: string; content: React.ReactNode }
                  const buttons: ActionBtn[] = []

                  if (phone) {
                    buttons.push({
                      key: 'whatsapp',
                      label: 'WhatsApp',
                      href: `https://wa.me/${phone.replace(/\D/g, '')}`,
                      external: true,
                      cls: 'bg-[#25D366] border-[#25D366] text-white hover:bg-[#20BD5A]',
                      content: <WhatsAppIcon size={20} />,
                    })
                    buttons.push({
                      key: 'call',
                      label: 'Call',
                      href: `tel:${phone.replace(/\D/g, '')}`,
                      cls: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100',
                      content: <PhoneIcon size={18} />,
                    })
                  }
                  if (showAttendanceBtn) {
                    buttons.push({
                      key: 'attendance',
                      label: 'Attendance',
                      onClick: () => setShowAttendance(true),
                      cls: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100',
                      content: <><CalendarCheck size={16} /><span className="text-[8px] font-bold uppercase tracking-wide">Attendance</span></>,
                    })
                  }
                  if (showTaskCalendar) {
                    buttons.push({
                      key: 'task',
                      label: 'Task Calendar',
                      onClick: openCalendarPage,
                      cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
                      content: <><CalendarDays size={16} /><span className="text-[8px] font-bold uppercase tracking-wide">Task</span></>,
                    })
                  }
                  if (showAcademicRecord) {
                    buttons.push({
                      key: 'record',
                      label: 'Academic Record',
                      onClick: openAcademicRecord,
                      cls: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
                      content: <><GraduationCap size={16} /><span className="text-[8px] font-bold uppercase tracking-wide">Record</span></>,
                    })
                  }
                  if (showDownloadCentreBtn) {
                    buttons.push({
                      key: 'downloads',
                      label: 'Download Centre',
                      onClick: () => setShowDownloadCentre(true),
                      cls: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100',
                      content: <><Download size={16} /><span className="text-[8px] font-bold uppercase tracking-wide">Downloads</span></>,
                    })
                  }

                  if (buttons.length === 0) return null

                  const GRID_COLS: Record<number, string> = {
                    1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5',
                  }
                  const btnCls = 'h-14 flex flex-col items-center justify-center gap-1 rounded-xl border font-medium transition-colors'

                  return (
                    <div className={`w-full mt-3 grid ${GRID_COLS[buttons.length] ?? 'grid-cols-5'} gap-2`}>
                      {buttons.map(b => b.href ? (
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
  const { activeUserId, closeProfileCard } = useProfileCard()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {activeUserId && (
        <ProfileCardModal key={activeUserId} userId={activeUserId} onClose={closeProfileCard} />
      )}
    </AnimatePresence>,
    document.body
  )
}
