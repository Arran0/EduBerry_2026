'use client'

import React, { useState, useEffect, useCallback } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getRoleDisplayName, isAdminRole } from '@/lib/supabase'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  Bell,
  Megaphone,
  BookOpen,
  ChevronRight,
  Plus,
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
} from 'lucide-react'
import { isStaffRole } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import {
  AnnouncementWithDetails,
  fetchAnnouncementsForUser,
} from '@/lib/announcements'
import { ClassroomWithDetails, fetchClassroomsForUser } from '@/lib/classrooms'
import { sortByLastVisited } from '@/lib/classroomVisits'
import { sampleImageLuminance } from '@/lib/luminance'
import DailyQuoteCard from '@/components/home/DailyQuoteCard'

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
    transition: { staggerChildren: 0.1 }
  }
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
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
  const [announcements, setAnnouncements] = useState<AnnouncementWithDetails[]>([])
  const [welcomeBanner, setWelcomeBanner] = useState<string | null>(null)
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])
  const [moreAppsImage, setMoreAppsImage] = useState('')
  const [editingMoreAppsBg, setEditingMoreAppsBg] = useState(false)
  const [bannerLum, setBannerLum] = useState<number | null>(null)
  const [appsLum, setAppsLum] = useState<number | null>(null)
  const [bannerReady, setBannerReady] = useState(false)

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
    try {
      const enrolled = await fetchClassroomsForUser(user.id, profile.role, false, 7)
      setClassrooms(sortByLastVisited(enrolled))
    } catch (err) {
      console.error('Failed to load classrooms for home:', err)
    }
  }, [user, profile])

  useEffect(() => { loadAnnouncements() }, [loadAnnouncements])
  useEffect(() => { loadClassrooms() }, [loadClassrooms])

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
  const topClassrooms = classrooms.slice(0, 5)

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
                transition={{ type: 'spring', stiffness: 28, damping: 12 }}
                className="relative w-full overflow-hidden"
              >
                <div className="absolute inset-0">

              {/* Background: photo or vivid gradient */}
              {welcomeBanner ? (
                <img
                  src={welcomeBanner}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
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

              {/* Welcome text — pinned inside the blur zone */}
              <div className="absolute inset-x-0 bottom-0 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-7">
                  {(() => {
                    const { line1, line2, icon } = getGreetingData()
                    return (
                      <>
                        <h1
                          className={`font-display text-3xl sm:text-4xl font-bold mb-1.5 leading-tight transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-900'}`}
                          style={bannerOnDark ? { textShadow: '0 1px 4px rgba(0,0,0,0.6)' } : undefined}
                        >
                          Welcome back, {profile?.full_name?.split(' ')[0] || 'User'}!
                        </h1>
                        <div className="flex items-center gap-1.5">
                          {icon}
                          <p className={`text-sm transition-colors duration-300 ${bannerOnDark ? 'text-white/85' : 'text-slate-600'}`}>{line1} {line2}</p>
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Daily Quote — auto-dismisses after 7 s, collapses gap ── */}
          {bannerReady && <QuoteBanner />}

          {/* ── Latest Announcements ── */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
            <motion.div variants={itemVariants} className="mb-0">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-sm">
                    <Bell size={15} className="text-white" />
                  </div>
                  <h2 className="font-display text-xl font-bold text-slate-800">Latest Announcements</h2>
                </div>
                <Link href="/announcements" className="text-sky-600 hover:text-sky-700 text-sm font-medium flex items-center gap-1 transition-colors">
                  View all <ChevronRight size={15} />
                </Link>
              </div>

              <div
                className="rounded-2xl overflow-hidden divide-y divide-white/20 shadow-md border border-white/50"
                style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.14) 100%)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}
              >
                {announcements.length > 0 ? announcements.map((announcement, i) => (
                  <Link key={announcement.id} href="/announcements">
                    <div className="flex items-center gap-4 px-5 py-4 hover:bg-white/40 transition-colors group cursor-pointer">
                      <div className={`w-1.5 self-stretch rounded-full flex-shrink-0 ${announcementColors[i % announcementColors.length]}`} />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-slate-800 text-sm truncate group-hover:text-slate-900 transition-colors">{announcement.title}</h4>
                      </div>
                      <span className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-white/50 text-slate-500 group-hover:bg-white/70 transition-colors">
                        {formatRelativeDate(announcement.created_at)}
                      </span>
                      <ChevronRight size={14} className="flex-shrink-0 text-slate-300 group-hover:text-slate-500 transition-colors" />
                    </div>
                  </Link>
                )) : (
                  <div className="py-10 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-white/40 flex items-center justify-center mx-auto mb-3">
                      <Megaphone size={22} className="text-slate-300" />
                    </div>
                    <p className="text-sm font-medium text-slate-400">No announcements yet</p>
                    <p className="text-xs text-slate-300 mt-1">Check back later for updates</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>

          {/* ── More Apps (full-bleed) ── */}
          <motion.div variants={itemVariants}>
            <div
              className="relative w-full overflow-hidden mt-6"
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
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-sm">
                    <LayoutGrid size={15} className="text-white" />
                  </div>
                  <h2
                    className={`font-display text-xl font-bold transition-colors duration-300 ${appsOnDark ? 'text-white' : 'text-slate-800'}`}
                    style={appsOnDark ? { textShadow: '0 1px 4px rgba(0,0,0,0.6)' } : undefined}
                  >More Apps</h2>
                </div>

                <div className="overflow-x-auto scrollbar-hide -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
                  <div className="flex gap-1.5">
                    {moreApps.map((app, idx) => {
                      const Icon = app.icon
                      return (
                        <Link
                          key={app.key}
                          href={app.href}
                          className="flex-1 min-w-[5.375rem] flex flex-col items-center gap-1.5 py-2.5 px-0.5 rounded-xl active:scale-95 transition-all border border-white/50"
                          style={{
                            background: 'linear-gradient(160deg, rgba(255,255,255,0.52) 0%, rgba(255,255,255,0.20) 100%)',
                            backdropFilter: 'blur(12px)',
                            WebkitBackdropFilter: 'blur(12px)',
                          }}
                        >
                          <div
                            className="w-full max-w-[2.5rem] aspect-square mx-auto rounded-xl flex items-center justify-center shadow-md"
                            style={{ background: ICON_GRADIENTS[idx % ICON_GRADIENTS.length] }}
                          >
                            <Icon size={17} className="text-white drop-shadow-sm" />
                          </div>
                          <span className="text-[8.5px] font-semibold text-slate-700 leading-tight text-center line-clamp-2 w-full px-0.5">{app.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── My Classrooms ── */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-8">
            <motion.div variants={itemVariants}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500 flex items-center justify-center shadow-sm">
                    <GraduationCap size={15} className="text-white" />
                  </div>
                  <h2 className="font-display text-xl font-bold text-slate-800">My Classrooms</h2>
                </div>
                {classrooms.length > 0 && (
                  <Link href="/academics" className="text-sky-600 hover:text-sky-700 text-sm font-medium flex items-center gap-1 transition-colors">
                    View all <ChevronRight size={15} />
                  </Link>
                )}
              </div>

              {topClassrooms.length > 0 ? (() => {
                const palettes = [
                  { grad: 'from-cyan-500 to-teal-600'     },
                  { grad: 'from-violet-500 to-purple-700' },
                  { grad: 'from-rose-500 to-pink-600'     },
                  { grad: 'from-amber-500 to-orange-600'  },
                  { grad: 'from-emerald-500 to-teal-700'  },
                ]
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {topClassrooms.map((classroom, i) => {
                      const p = palettes[i % palettes.length]
                      const teacherName = classroom.coordinator?.full_name ?? classroom.creator?.full_name ?? null
                      return (
                        <Link key={classroom.id} href={`/classrooms/${classroom.id}`}>
                          <div
                            className={`relative h-[77px] rounded-xl overflow-hidden bg-gradient-to-br ${p.grad} group cursor-pointer transition-all duration-200 hover:scale-[1.03] hover:brightness-110 shadow-md`}
                          >
                            {/* Banner photo or fallback texture */}
                            {classroom.banner_url ? (
                              <img src={classroom.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                            ) : (
                              <>
                                <svg className="absolute inset-0 w-full h-full opacity-[0.10]" xmlns="http://www.w3.org/2000/svg">
                                  <defs>
                                    <pattern id={`hg-${i}`} x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
                                      <circle cx="1.5" cy="1.5" r="1" fill="white" />
                                    </pattern>
                                  </defs>
                                  <rect width="100%" height="100%" fill={`url(#hg-${i})`} />
                                </svg>
                                <div className="absolute -top-4 -right-4 w-14 h-14 bg-white/10 rounded-full blur-xl" />
                              </>
                            )}
                            {/* Dark scrim so text is always readable */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/5 to-transparent" />
                            <div className="absolute inset-0 p-2 flex flex-col justify-end">
                              <p
                                className="font-bold text-white text-[12px] leading-tight line-clamp-1"
                                style={{ textShadow: '0 0 16px rgba(255,255,255,0.4), 0 1px 3px rgba(0,0,0,0.4)' }}
                              >{classroom.title}</p>
                              {teacherName && (
                                <p className="text-white/60 text-[9px] mt-0.5 truncate">{teacherName}</p>
                              )}
                            </div>
                          </div>
                        </Link>
                      )
                    })}
                    <Link href="/academics">
                      <div className="relative h-[77px] rounded-xl overflow-hidden bg-slate-100 hover:bg-slate-200 border-2 border-dashed border-slate-300 hover:border-slate-400 group cursor-pointer transition-all duration-200 hover:scale-[1.03] flex flex-col items-center justify-center gap-1">
                        <Plus size={18} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                        {classrooms.length > 5 ? (
                          <p className="text-slate-400 group-hover:text-slate-600 text-xs font-semibold transition-colors">
                            View all
                          </p>
                        ) : (
                          <p className="text-slate-400 group-hover:text-slate-600 text-xs font-semibold transition-colors">View all</p>
                        )}
                      </div>
                    </Link>
                  </div>
                )
              })() : (
                <div className="glass rounded-2xl p-10 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center mx-auto mb-4">
                    <BookOpen size={26} className="text-slate-400" />
                  </div>
                  <p className="text-slate-600 font-medium text-sm mb-1">No classrooms yet</p>
                  <p className="text-slate-400 text-xs mb-4">You are not enrolled in any classrooms.</p>
                  <Link
                    href="/academics"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-500 text-white rounded-xl text-sm font-semibold hover:from-cyan-600 hover:to-teal-600 transition-all shadow-sm shadow-cyan-200"
                  >
                    <Plus size={14} /> Browse Classrooms
                  </Link>
                </div>
              )}
            </motion.div>
          </div>

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
