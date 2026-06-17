'use client'

import React, { useState, useEffect, useRef } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getRoleDisplayName, getRoleBadgeColor, supabase } from '@/lib/supabase'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { fetchMarksForStudent, StudentMarkWithContext } from '@/lib/classrooms'
import {
  Mail,
  Shield,
  Calendar,
  LogOut,
  KeyRound,
  Loader2,
  Check,
  AlertCircle,
  Camera,
  User,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import PageBanner from '@/components/PageBanner'
import { AnnouncementBannerConfig } from '@/lib/pageConfig'

const STORAGE_BUCKET = 'classroom-files'

const PROFILE_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: 'var(--brand-primary, #0284c7)',
  gradTo:   'var(--brand-secondary, #16a34a)',
  imageUrl: '',
}

export default function ProfilePage() {
  const { user, profile, signOut, refreshProfile } = useAuth()
  const router = useRouter()
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [myMarks, setMyMarks] = useState<StudentMarkWithContext[]>([])
  const [loadingMarks, setLoadingMarks] = useState(false)

  const isAdmin = profile?.role === 'admin'

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  useEffect(() => {
    if (profile?.avatar_url) setAvatarUrl(profile.avatar_url)
  }, [profile])

  useEffect(() => {
    if (!user || profile?.role !== 'student') return
    setLoadingMarks(true)
    fetchMarksForStudent(user.id).then(marks => {
      setMyMarks(marks)
      setLoadingMarks(false)
    })
  }, [user, profile?.role])

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setUploadingAvatar(true)
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `avatars/${user.id}.${ext}`
      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, { upsert: true })
      if (error) throw error
      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
      const url = `${urlData.publicUrl}?t=${Date.now()}`
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id)
      setAvatarUrl(url)
      await refreshProfile()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      alert('Upload failed: ' + msg)
    }
    setUploadingAvatar(false)
    e.target.value = ''
  }

  const handlePasswordReset = async () => {
    if (!user?.email) return
    setPasswordLoading(true)
    setPasswordMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/update-password`,
    })
    setPasswordMsg(
      error
        ? { type: 'error', text: error.message }
        : { type: 'success', text: `Reset link sent to ${user.email}` }
    )
    setPasswordLoading(false)
  }

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  if (!user || !profile) return null

  const initials =
    profile.full_name
      ?.split(' ')
      .map((n: string) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ||
    user.email?.charAt(0).toUpperCase() ||
    'U'

  const markGroups: Record<string, StudentMarkWithContext[]> = {}
  for (const m of myMarks) {
    const ay = m.classroom_start_date
      ? `AY ${parseInt(m.classroom_start_date.split('-')[0])}-${String(parseInt(m.classroom_start_date.split('-')[0]) + 1).slice(-2)}`
      : 'No Year'
    if (!markGroups[ay]) markGroups[ay] = []
    markGroups[ay].push(m)
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-white" data-page-theme="profile">

        {/* ─── Banner ───────────────────────────────────────────────── */}
        <PageBanner
          settingKey="profile_banner"
          defaultBanner={PROFILE_BANNER_DEFAULT}
          icon={<User size={26} className="text-white" />}
          title={profile.full_name || 'My Profile'}
          subtitle={getRoleDisplayName(profile.role)}
          isAdmin={isAdmin}
          onBack={() => router.back()}
          maxWidth="max-w-lg"
          backgroundIcon={<User size={150} className="text-white" />}
        />

        {/* ─── Content ──────────────────────────────────────────────── */}
        <div className="max-w-lg mx-auto px-4 sm:px-6 -mt-6 pb-10">

          {/* ─── Profile Card ───────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl border border-slate-200 shadow-lg mb-5 overflow-hidden"
          >
            {/* Avatar + identity — always visible, never scrolled */}
            <div className="flex flex-col items-center pt-8 pb-6 px-6">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <button
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="relative group/av rounded-full focus:outline-none"
                title="Change profile picture"
              >
                <div
                  className="w-28 h-28 rounded-full ring-4 ring-white shadow-xl overflow-hidden flex items-center justify-center"
                  style={{ background: 'linear-gradient(to bottom right, var(--brand-primary), var(--brand-secondary))' }}
                >
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt="Avatar"
                      width={112}
                      height={112}
                      className="object-cover w-full h-full"
                      unoptimized
                    />
                  ) : (
                    <span className="text-white text-4xl font-bold select-none">{initials}</span>
                  )}
                </div>
                <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover/av:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                  {uploadingAvatar
                    ? <Loader2 size={22} className="text-white animate-spin" />
                    : <Camera size={22} className="text-white" />
                  }
                </div>
              </button>

              <p className="mt-2 text-xs text-slate-500">Click to change photo</p>

              <h2 className="mt-3 font-display text-2xl font-bold text-slate-900 text-center leading-tight">
                {profile.full_name || 'User'}
              </h2>
              <span className={`mt-2 text-xs px-3 py-1.5 rounded-full font-semibold ${getRoleBadgeColor(profile.role)}`}>
                {getRoleDisplayName(profile.role)}
              </span>
            </div>

            {/* Scrollable info section */}
            <div className="max-h-[45vh] overflow-y-auto scrollbar-hide border-t border-slate-100 px-6 pt-5 pb-6 space-y-3">
              <div className="flex items-center gap-3 bg-slate-50 rounded-2xl px-4 py-3.5">
                <Mail size={16} className="text-emerald-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Email</p>
                  <p className="font-medium text-slate-700 text-sm truncate">{user.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-slate-50 rounded-2xl px-4 py-3.5">
                <Shield size={16} className="text-purple-500 flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Role</p>
                  <p className="font-medium text-slate-700 text-sm">{getRoleDisplayName(profile.role)}</p>
                </div>
              </div>
              {profile.created_at && (
                <div className="flex items-center gap-3 bg-slate-50 rounded-2xl px-4 py-3.5">
                  <Calendar size={16} className="text-amber-500 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Member since</p>
                    <p className="font-medium text-slate-700 text-sm">{formatDate(profile.created_at)}</p>
                  </div>
                </div>
              )}

              {/* Assessment Marks — students only */}
              {profile.role === 'student' && (
                <div className="pt-3">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
                    Assessment Marks
                  </p>
                  {loadingMarks ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-400 py-4">
                      <Loader2 size={14} className="animate-spin" /> Loading marks...
                    </div>
                  ) : myMarks.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">No assessment marks recorded yet</p>
                  ) : Object.entries(markGroups).map(([year, yearMarks]) => {
                    const byClass: Record<string, StudentMarkWithContext[]> = {}
                    for (const m of yearMarks) {
                      if (!byClass[m.classroom_title]) byClass[m.classroom_title] = []
                      byClass[m.classroom_title].push(m)
                    }
                    return (
                      <div key={year} className="mb-4">
                        <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: 'var(--brand-primary)' }}>
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--brand-primary)' }} />
                          {year}
                        </p>
                        {Object.entries(byClass).map(([cls, clsMarks]) => (
                          <div key={cls} className="mb-2 bg-slate-50 rounded-xl p-3">
                            <p className="text-xs font-semibold text-slate-700 mb-2 truncate">{cls}</p>
                            <div className="space-y-1.5">
                              {clsMarks.map((m, i) => (
                                <div key={i} className="flex items-center justify-between gap-2">
                                  <p className="text-xs text-slate-600 truncate flex-1">{m.assessment_title}</p>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <span className={`text-xs font-bold ${
                                      m.marks === null ? 'text-slate-400'
                                      : m.marks / m.max_marks >= 0.75 ? 'text-green-600'
                                      : m.marks / m.max_marks >= 0.5  ? 'text-amber-600'
                                      : 'text-red-600'
                                    }`}>
                                      {m.marks ?? '—'}
                                    </span>
                                    <span className="text-[10px] text-slate-400">/ {m.max_marks}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </motion.div>

          {/* ─── Actions ────────────────────────────────────────────── */}
          <div className="space-y-3">

            {/* Change Password */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.07 }}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                    <KeyRound size={15} className="text-violet-500" /> Change Password
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">A reset link will be sent to your email</p>
                </div>
                <button
                  onClick={handlePasswordReset}
                  disabled={passwordLoading}
                  className="page-btn-primary !text-sm !py-2 !px-4 flex items-center gap-1.5 flex-shrink-0"
                >
                  {passwordLoading ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  {passwordLoading ? 'Sending…' : 'Send link'}
                </button>
              </div>
              <AnimatePresence>
                {passwordMsg && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs overflow-hidden ${
                      passwordMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {passwordMsg.type === 'success' ? <Check size={13} /> : <AlertCircle size={13} />}
                    {passwordMsg.text}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Sign Out */}
            <motion.button
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.11 }}
              onClick={handleSignOut}
              className="w-full flex items-center justify-center gap-2 px-5 py-4 rounded-2xl bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors text-rose-600 font-semibold text-sm"
            >
              <LogOut size={18} />
              Sign Out
            </motion.button>
          </div>

          <p className="text-center text-xs text-slate-400 mt-6">
            Account details (name, email, role) can only be updated by an administrator.
          </p>
        </div>
      </div>
    </ProtectedLayout>
  )
}
