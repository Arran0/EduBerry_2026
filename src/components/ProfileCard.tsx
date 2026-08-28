'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Mail, CalendarDays, CalendarCheck, GraduationCap, Phone, MessageCircle, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useProfileCard } from '@/contexts/ProfileCardContext'
import { supabase, UserProfile, getDisplayRole, getRoleBadgeColor } from '@/lib/supabase'
import { fetchStudentDetails } from '@/lib/studentDetails'
import { fetchStaffDetails } from '@/lib/staffDetails'
import { Homeroom, fetchHomeromsForStudent } from '@/lib/homerooms'
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

// ─── Role helpers ──────────────────────────────────────────────────────────────
const STAFF_ROLES = new Set(['teacher', 'coordinator', 'principal', 'admin'])

function isStaff(role: string) { return STAFF_ROLES.has(role) }

// Calendar access: viewer must rank strictly above target (or be admin / same person).
const ROLE_RANK: Record<string, number> = {
  student: 0, teacher: 1, coordinator: 2, principal: 3, admin: 4,
}

function hasCalendarAccess(viewer: UserProfile, target: UserProfile): boolean {
  if (viewer.id === target.id) return true
  if (viewer.role === 'admin') return true
  return (ROLE_RANK[viewer.role] ?? 0) > (ROLE_RANK[target.role] ?? 0)
}

// ─── Inner modal (needs auth + router) ────────────────────────────────────────
function ProfileCardModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { profile: viewerProfile } = useAuth()
  const router = useRouter()

  const [targetProfile, setTargetProfile] = useState<UserProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [phone, setPhone] = useState<string | null>(null)

  const [profileBannerUrl, setProfileBannerUrl] = useState<string | null>(null)

  // Attendance calendar drill-down (stacked on top of the card)
  const [showAttendance, setShowAttendance] = useState(false)
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [homeroomId, setHomeroomId] = useState<string | null>(null)
  const [loadingHomerooms, setLoadingHomerooms] = useState(false)
  const [calYear, setCalYear] = useState(() => new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth() + 1)

  const isStudentProfile = targetProfile?.role === 'student'

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
    loadProfile()
  }, [userId, loadProfile])

  // Load phone number from the appropriate details table
  useEffect(() => {
    if (!targetProfile) return
    if (targetProfile.role === 'student') {
      fetchStudentDetails(targetProfile.id).then(d => setPhone(d?.phone ?? null))
    } else {
      fetchStaffDetails(targetProfile.id).then(d => setPhone(d?.phone ?? null))
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
                className="relative h-16 flex-shrink-0"
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

                {/* Email — a single compact line instead of a stack of info cards */}
                <a
                  href={`mailto:${targetProfile.email}`}
                  className="mt-3 w-full flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors min-w-0"
                >
                  <Mail size={12} className="text-slate-400 flex-shrink-0" />
                  <span className="text-xs text-slate-600 truncate">{targetProfile.email}</span>
                </a>

                {/* ── Action buttons — WhatsApp, Call, Attendance, Task, Academic Record; all
                     the same size, on one row ─────────────────────────────────────────────── */}
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

                  if (!showAcademicRecord && !showTaskCalendar && !showAttendanceBtn && !phone) return null

                  const btnCls = 'w-14 h-14 flex-shrink-0 flex flex-col items-center justify-center gap-1 rounded-xl border font-medium transition-colors'

                  return (
                    <div className="w-full mt-3 flex items-center justify-center gap-2 flex-wrap">
                      {phone && (
                        <a
                          href={`https://wa.me/${phone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="WhatsApp"
                          className={`${btnCls} bg-green-50 text-green-700 border-green-200 hover:bg-green-100`}
                        >
                          <MessageCircle size={18} />
                        </a>
                      )}
                      {phone && (
                        <a
                          href={`tel:${phone.replace(/\D/g, '')}`}
                          title="Call"
                          className={`${btnCls} bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100`}
                        >
                          <Phone size={18} />
                        </a>
                      )}
                      {showAttendanceBtn && (
                        <button
                          onClick={() => setShowAttendance(true)}
                          className={`${btnCls} bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100`}
                        >
                          <CalendarCheck size={16} />
                          <span className="text-[8px] font-bold uppercase tracking-wide">Attendance</span>
                        </button>
                      )}
                      {showTaskCalendar && (
                        <button
                          onClick={openCalendarPage}
                          className={`${btnCls} bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100`}
                        >
                          <CalendarDays size={16} />
                          <span className="text-[8px] font-bold uppercase tracking-wide">Task</span>
                        </button>
                      )}
                      {showAcademicRecord && (
                        <button
                          onClick={openAcademicRecord}
                          className={`${btnCls} bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100`}
                        >
                          <GraduationCap size={16} />
                          <span className="text-[8px] font-bold uppercase tracking-wide">Record</span>
                        </button>
                      )}
                    </div>
                  )
                })()}
              </div>
            </>
          )}
        </div>
      </motion.div>

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
