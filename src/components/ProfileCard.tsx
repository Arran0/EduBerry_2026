'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Mail, Shield, Calendar, GraduationCap, Phone, MessageCircle, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useProfileCard } from '@/contexts/ProfileCardContext'
import { supabase, UserProfile, getRoleDisplayName, getRoleBadgeColor } from '@/lib/supabase'
import { fetchStudentDetails } from '@/lib/studentDetails'
import { fetchStaffDetails } from '@/lib/staffDetails'
import Avatar from '@/components/Avatar'
import { useRouter } from 'next/navigation'

// ─── Role helpers ──────────────────────────────────────────────────────────────
const STAFF_ROLES = new Set(['teacher', 'coordinator', 'principal', 'admin'])

function isStaff(role: string) { return STAFF_ROLES.has(role) }

// ─── Inner modal (needs auth + router) ────────────────────────────────────────
function ProfileCardModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { profile: viewerProfile } = useAuth()
  const router = useRouter()

  const [targetProfile, setTargetProfile] = useState<UserProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [phone, setPhone] = useState<string | null>(null)

  const [profileBannerUrl, setProfileBannerUrl] = useState<string | null>(null)

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

  const openAcademicRecord = () => {
    if (!targetProfile) return
    onClose()
    router.push(`/academic-record/${targetProfile.id}`)
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
                className="relative h-32 flex-shrink-0"
                style={profileBannerUrl
                  ? { backgroundImage: `url(${profileBannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: 'linear-gradient(140deg, #3f3f46 0%, #1c1c1e 100%)' }
                }
              >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.15),transparent_70%)] pointer-events-none" />
                <button
                  onClick={onClose}
                  className="absolute top-3 right-3 p-1.5 bg-black/30 hover:bg-black/50 rounded-full text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="relative flex flex-col items-center -mt-12 pb-6 px-6">
                {/* Avatar */}
                <div
                  className="w-24 h-24 rounded-full ring-4 ring-white shadow-xl overflow-hidden flex items-center justify-center flex-shrink-0"
                  style={{ background: profileBannerUrl ? '#27272A' : 'linear-gradient(135deg, #3f3f46, #1c1c1e)' }}
                >
                  <Avatar
                    avatarUrl={targetProfile.avatar_url}
                    name={targetProfile.full_name}
                    email={targetProfile.email}
                    size={96}
                  />
                </div>

                <h2 className="mt-3 font-display text-xl font-bold text-slate-800 text-center leading-tight">
                  {targetProfile.full_name || 'No Name'}
                </h2>
                <div className="mt-1.5">
                  <span className={`text-xs px-3 py-1 rounded-full font-semibold ${getRoleBadgeColor(targetProfile.role)}`}>
                    {getRoleDisplayName(targetProfile.role)}
                  </span>
                </div>
                {targetProfile.role === 'student' && targetProfile.grade && (
                  <p className="mt-1 text-xs text-slate-400">
                    Grade {targetProfile.grade}{targetProfile.section ? `-${targetProfile.section}` : ''}
                  </p>
                )}

                {/* Info rows */}
                <div className="w-full mt-4 space-y-2">
                  <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                    <Mail size={15} className="text-emerald-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">Email</p>
                      <p className="font-medium text-slate-700 text-sm truncate">{targetProfile.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                    <Shield size={15} className="text-purple-500 flex-shrink-0" />
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">Role</p>
                      <p className="font-medium text-slate-700 text-sm">{getRoleDisplayName(targetProfile.role)}</p>
                    </div>
                  </div>
                  {targetProfile.created_at && (
                    <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                      <Calendar size={15} className="text-amber-500 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Member since</p>
                        <p className="font-medium text-slate-700 text-sm">
                          {new Date(targetProfile.created_at).toLocaleDateString('en-US', {
                            year: 'numeric', month: 'long', day: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Action buttons ───────────────────────────────────────────────────────────── */}
                {viewerProfile && (() => {
                  const isStudentProfile = targetProfile.role === 'student'
                  // Staff can see student contact buttons; so can the student themselves
                  const canSeeStudentActions = isStudentProfile && (viewerProfile.id === targetProfile.id || isStaff(viewerProfile.role))
                  // Everyone can see staff contact buttons
                  const canSeeStaffActions = !isStudentProfile

                  if (!canSeeStudentActions && !canSeeStaffActions) return null

                  return (
                    <div className="w-full mt-4 space-y-2">
                      {/* Academic Record — student profiles only */}
                      {isStudentProfile && (
                        <button
                          onClick={openAcademicRecord}
                          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-sm transition-colors
                            bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                        >
                          <GraduationCap size={15} />
                          Academic Record
                        </button>
                      )}

                      {/* WhatsApp + Call — shown when phone is available */}
                      {phone && (
                        <div className="flex gap-2">
                          <a
                            href={`https://wa.me/${phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-sm transition-colors
                              bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                          >
                            <MessageCircle size={15} />
                            WhatsApp
                          </a>
                          <a
                            href={`tel:${phone.replace(/\D/g, '')}`}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-sm transition-colors
                              bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100"
                          >
                            <Phone size={15} />
                            Call
                          </a>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </>
          )}
        </div>
      </motion.div>
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
