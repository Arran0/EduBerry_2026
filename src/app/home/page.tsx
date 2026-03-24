'use client'

import React, { useState, useEffect, useCallback } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getRoleDisplayName, isAdminRole } from '@/lib/supabase'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  Bell,
  Megaphone,
  BookOpen,
  ChevronRight,
  Plus,
  ImageIcon,
  GraduationCap,
  Sun,
  Sunset,
  Moon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  AnnouncementWithDetails,
  fetchAnnouncementsForUser,
} from '@/lib/announcements'
import { ClassroomWithDetails, fetchClassroomsForUser } from '@/lib/classrooms'

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
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const announcementColors = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
]

export default function HomePage() {
  const { user, profile } = useAuth()
  const isAdmin = profile ? isAdminRole(profile.role) : false
  const [announcements, setAnnouncements] = useState<AnnouncementWithDetails[]>([])
  const [welcomeBanner, setWelcomeBanner] = useState<string | null>(null)
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])

  useEffect(() => {
    supabase.from('site_settings').select('value').eq('key', 'welcome_banner').single()
      .then(({ data }) => { if (data?.value) setWelcomeBanner(data.value) })
  }, [])

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
        profile.section ?? undefined
      )
      setAnnouncements(data.slice(0, 5))
    } catch (err) {
      console.error('Failed to load announcements for home:', err)
    }
  }, [user, profile])

  const loadClassrooms = useCallback(async () => {
    if (!user || !profile) return
    try {
      const enrolled = await fetchClassroomsForUser(user.id, profile.role)
      setClassrooms(enrolled)
    } catch (err) {
      console.error('Failed to load classrooms for home:', err)
    }
  }, [user, profile])

  useEffect(() => { loadAnnouncements() }, [loadAnnouncements])
  useEffect(() => { loadClassrooms() }, [loadClassrooms])

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good Morning'
    if (hour < 18) return 'Good Afternoon'
    return 'Good Evening'
  }

  const getGreetingIcon = () => {
    const hour = new Date().getHours()
    if (hour < 12) return <Sun size={20} className="text-amber-400 drop-shadow-sm" />
    if (hour < 18) return <Sunset size={20} className="text-orange-400 drop-shadow-sm" />
    return <Moon size={20} className="text-indigo-400 drop-shadow-sm" />
  }

  const topClassrooms = classrooms.slice(0, 7)

  return (
    <ProtectedLayout>
      <div data-page-theme="home">
        <motion.div variants={containerVariants} initial="hidden" animate="visible">

          {/* ── Immersive full-width welcome banner ── */}
          <motion.div variants={itemVariants}>
            {/*
              380px tall. The bottom 70% (266px) carries two stacked overlays
              that together guarantee the text zone is on a fully white surface.
            */}
            <div className="relative w-full overflow-hidden" style={{ height: '380px' }}>

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

              {/*
                Layer 1 — progressive backdrop blur.
                Mask makes the blur fade in from the top of this layer so the
                photo dissolves gradually rather than cutting off sharply.
              */}
              <div
                className="absolute inset-x-0 bottom-0"
                style={{
                  height: '70%',
                  backdropFilter: 'blur(22px)',
                  WebkitBackdropFilter: 'blur(22px)',
                  maskImage: 'linear-gradient(to bottom, transparent 0%, black 45%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 45%)',
                }}
              />

              {/*
                Layer 2 — white fade.
                Reaches solid white at the 55% mark of this layer's height.
                Because the text lives in the bottom ~140px of the 380px banner,
                and this layer starts at y=114px (70% from bottom), the text
                region is always past the 55% opacity stop — i.e. fully white.
              */}
              <div
                className="absolute inset-x-0 bottom-0"
                style={{
                  height: '70%',
                  background: 'linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.5) 38%, rgba(255,255,255,0.75) 55%)',
                }}
              />

              {/* Welcome text — sits inside the fully white zone */}
              <div className="absolute inset-x-0 bottom-0 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
                  <div className="flex items-center gap-2 mb-2">
                    {getGreetingIcon()}
                    <p className="text-sky-600 font-semibold text-xs tracking-widest uppercase">{getGreeting()}</p>
                  </div>
                  <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-800 mb-1 leading-tight">
                    Welcome back,{' '}
                    <span className="bg-gradient-to-r from-sky-500 to-emerald-500 bg-clip-text text-transparent">
                      {profile?.full_name?.split(' ')[0] || 'User'}!
                    </span>
                  </h1>
                  <p className="text-slate-500 text-sm">
                    Signed in as <span className="font-semibold text-slate-600">{profile ? getRoleDisplayName(profile.role) : 'User'}</span>
                  </p>
                  {isAdmin && (
                    <label className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs text-slate-600 hover:text-sky-600 font-medium cursor-pointer transition-all">
                      <ImageIcon size={13} />
                      {welcomeBanner ? 'Change Banner' : 'Add Banner'}
                      <input type="file" accept="image/*" className="hidden" onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) handleBannerUpload(f)
                      }} />
                    </label>
                  )}
                </div>
              </div>

            </div>
          </motion.div>

          {/* ── Page content ── */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-8">

            {/* Latest Announcements */}
            <motion.div variants={itemVariants} className="mb-8">
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

              <div className="glass rounded-2xl overflow-hidden divide-y divide-slate-100 shadow-sm">
                {announcements.length > 0 ? announcements.map((announcement, i) => (
                  <Link key={announcement.id} href="/announcements">
                    <div className="flex items-center gap-4 px-5 py-4 hover:bg-sky-50/50 transition-colors group cursor-pointer">
                      <div className={`w-1.5 self-stretch rounded-full flex-shrink-0 ${announcementColors[i % announcementColors.length]}`} />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-slate-800 text-sm truncate group-hover:text-sky-700 transition-colors">{announcement.title}</h4>
                      </div>
                      <span className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 group-hover:bg-sky-100 group-hover:text-sky-600 transition-colors">
                        {formatRelativeDate(announcement.created_at)}
                      </span>
                      <ChevronRight size={14} className="flex-shrink-0 text-slate-300 group-hover:text-sky-400 transition-colors" />
                    </div>
                  </Link>
                )) : (
                  <div className="py-10 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-3">
                      <Megaphone size={22} className="text-slate-300" />
                    </div>
                    <p className="text-sm font-medium text-slate-400">No announcements yet</p>
                    <p className="text-xs text-slate-300 mt-1">Check back later for updates</p>
                  </div>
                )}
              </div>
            </motion.div>

            {/* My Classrooms */}
            <motion.div variants={itemVariants}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500 flex items-center justify-center shadow-sm">
                    <GraduationCap size={15} className="text-white" />
                  </div>
                  <h2 className="font-display text-xl font-bold text-slate-800">My Classrooms</h2>
                  {classrooms.length > 0 && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-600 border border-cyan-100">
                      {classrooms.length}
                    </span>
                  )}
                </div>
              </div>

              {topClassrooms.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {topClassrooms.map((classroom, i) => {
                    const gradients = [
                      'from-cyan-400 to-teal-500',
                      'from-violet-400 to-purple-500',
                      'from-rose-400 to-pink-500',
                      'from-amber-400 to-orange-500',
                      'from-emerald-400 to-green-500',
                      'from-blue-400 to-indigo-500',
                      'from-fuchsia-400 to-pink-500',
                    ]
                    const shadows = [
                      'group-hover:shadow-cyan-200/60',
                      'group-hover:shadow-violet-200/60',
                      'group-hover:shadow-rose-200/60',
                      'group-hover:shadow-amber-200/60',
                      'group-hover:shadow-emerald-200/60',
                      'group-hover:shadow-blue-200/60',
                      'group-hover:shadow-fuchsia-200/60',
                    ]
                    return (
                      <Link key={classroom.id} href={`/classrooms/${classroom.id}`}>
                        <div className={`flex items-center gap-4 px-5 py-4 bg-white rounded-2xl border border-slate-100 hover:border-slate-200 hover:shadow-md ${shadows[i % shadows.length]} transition-all group`}>
                          <div className={`w-10 h-10 flex-shrink-0 rounded-xl bg-gradient-to-br ${gradients[i % gradients.length]} flex items-center justify-center text-white shadow-sm`}>
                            <BookOpen size={17} />
                          </div>
                          <span className="font-semibold text-slate-700 text-sm group-hover:text-slate-900 transition-colors truncate flex-1">
                            {classroom.title}
                          </span>
                          <ChevronRight size={14} className="flex-shrink-0 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </Link>
                    )
                  })}

                  <Link href="/academics">
                    <div className="flex items-center gap-4 px-5 py-4 bg-slate-50/80 rounded-2xl border border-dashed border-slate-200 hover:border-cyan-300 hover:bg-cyan-50/40 transition-all group">
                      <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-gradient-to-br from-slate-200 to-slate-300 group-hover:from-cyan-100 group-hover:to-teal-200 flex items-center justify-center shadow-sm transition-all">
                        <Plus size={17} className="text-slate-500 group-hover:text-cyan-600 transition-colors" />
                      </div>
                      <span className="font-semibold text-slate-500 text-sm group-hover:text-cyan-700 transition-colors">
                        {classrooms.length > 7 ? `${classrooms.length - 7} more classrooms` : 'All Classrooms'}
                      </span>
                      <ChevronRight size={14} className="flex-shrink-0 text-slate-300 group-hover:text-cyan-400 ml-auto group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </Link>
                </div>
              ) : (
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
    </ProtectedLayout>
  )
}
