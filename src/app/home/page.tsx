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

export default function HomePage() {
  const { user, profile } = useAuth()
  const isAdmin = profile ? isAdminRole(profile.role) : false
  const [announcements, setAnnouncements] = useState<AnnouncementWithDetails[]>([])
  const [welcomeBanner, setWelcomeBanner] = useState<string | null>(null)
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])

  // Load welcome banner from site_settings
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

  const topClassrooms = classrooms.slice(0, 7)

  return (
    <ProtectedLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-page-theme="home">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* Welcome Section */}
          <motion.div variants={itemVariants} className="mb-8">
            <div className="glass-strong rounded-3xl relative overflow-hidden">
              {welcomeBanner && (
                <div className="h-36 sm:h-44 relative">
                  <img src={welcomeBanner} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-white/80 to-transparent" />
                </div>
              )}
              {!welcomeBanner && (
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-mps-blue-200/30 to-mps-green-200/30 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
              )}
              <div className={`relative z-10 px-8 pt-6 pb-8 ${welcomeBanner ? 'mt-0' : ''}`}>
                <p className="text-mps-blue-600 font-medium mb-2">{getGreeting()}</p>
                <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-800 mb-2">
                  Welcome back, {profile?.full_name?.split(' ')[0] || 'User'}!
                </h1>
                <p className="text-slate-500">
                  You&apos;re logged in as <span className="font-medium text-slate-700">{profile ? getRoleDisplayName(profile.role) : 'User'}</span>
                </p>
                {isAdmin && (
                  <label className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs text-slate-600 font-medium cursor-pointer transition-colors">
                    <ImageIcon size={14} />
                    {welcomeBanner ? 'Change Banner' : 'Add Banner'}
                    <input type="file" accept="image/*" className="hidden" onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) handleBannerUpload(f)
                    }} />
                  </label>
                )}
              </div>
            </div>
          </motion.div>

          {/* Latest Announcements */}
          <motion.div variants={itemVariants} className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Bell className="text-mps-blue-600" size={20} />
                <h2 className="font-display text-xl font-bold text-slate-800">Latest Announcements</h2>
              </div>
              <Link href="/announcements" className="text-mps-blue-600 hover:text-mps-blue-700 text-sm font-medium flex items-center gap-1">
                More <ChevronRight size={16} />
              </Link>
            </div>

            <div className="glass rounded-2xl divide-y divide-slate-100">
              {announcements.length > 0 ? announcements.map((announcement) => (
                <Link key={announcement.id} href="/announcements">
                  <div className="p-4 hover:bg-slate-50/50 transition-colors cursor-pointer">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium text-slate-800 mb-0.5">{announcement.title}</h4>
                        <p className="text-sm text-slate-500">{formatRelativeDate(announcement.created_at)}</p>
                      </div>
                    </div>
                  </div>
                </Link>
              )) : (
                <div className="p-6 text-center">
                  <Megaphone size={24} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No announcements yet</p>
                </div>
              )}
            </div>
          </motion.div>

          {/* My Classrooms */}
          <motion.div variants={itemVariants}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <GraduationCap className="text-cyan-600" size={20} />
                <h2 className="font-display text-xl font-bold text-slate-800">My Classrooms</h2>
              </div>
            </div>

            {topClassrooms.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                  return (
                    <Link key={classroom.id} href={`/classrooms/${classroom.id}`}>
                      <div className="flex items-center gap-3 px-4 py-3 bg-white rounded-2xl border border-slate-100 hover:border-cyan-200 hover:shadow-sm transition-all group">
                        <div className={`w-9 h-9 flex-shrink-0 rounded-xl bg-gradient-to-br ${gradients[i % gradients.length]} flex items-center justify-center text-white shadow-sm`}>
                          <BookOpen size={16} />
                        </div>
                        <span className="font-medium text-slate-700 text-sm group-hover:text-cyan-700 transition-colors truncate flex-1">
                          {classroom.title}
                        </span>
                        <ChevronRight size={14} className="flex-shrink-0 text-slate-300 group-hover:text-cyan-400 transition-colors" />
                      </div>
                    </Link>
                  )
                })}

                {/* More classrooms button */}
                <Link href="/academics">
                  <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-2xl border border-dashed border-slate-200 hover:border-cyan-300 hover:bg-cyan-50/40 transition-all group">
                    <div className="w-9 h-9 flex-shrink-0 rounded-xl bg-gradient-to-br from-slate-200 to-slate-300 group-hover:from-cyan-100 group-hover:to-teal-100 flex items-center justify-center shadow-sm transition-all">
                      <Plus size={16} className="text-slate-500 group-hover:text-cyan-600 transition-colors" />
                    </div>
                    <span className="font-medium text-slate-500 text-sm group-hover:text-cyan-700 transition-colors">
                      {classrooms.length > 7 ? `${classrooms.length - 7} more classrooms` : 'All Classrooms'}
                    </span>
                    <ChevronRight size={14} className="flex-shrink-0 text-slate-300 group-hover:text-cyan-400 ml-auto transition-colors" />
                  </div>
                </Link>
              </div>
            ) : (
              <div className="glass rounded-2xl p-8 text-center">
                <BookOpen size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm mb-3">You are not enrolled in any classrooms yet.</p>
                <Link
                  href="/academics"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500 text-white rounded-xl text-sm font-medium hover:bg-cyan-600 transition-colors"
                >
                  <Plus size={14} /> Browse Classrooms
                </Link>
              </div>
            )}
          </motion.div>

        </motion.div>
      </div>
    </ProtectedLayout>
  )
}
