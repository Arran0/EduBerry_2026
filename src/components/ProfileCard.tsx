'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Mail, Shield, Calendar, CalendarDays, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useProfileCard } from '@/contexts/ProfileCardContext'
import { supabase, UserProfile, getRoleDisplayName, getRoleBadgeColor } from '@/lib/supabase'
import { fetchMarksForStudent, StudentMarkWithContext } from '@/lib/classrooms'
import Avatar from '@/components/Avatar'
import { useRouter } from 'next/navigation'

// ─── Access check ─────────────────────────────────────────────────────────────
// Role rank — higher number = higher in the hierarchy.
// A viewer can see the calendar of anyone strictly below them.
// Only admins can see other admins' calendars.
const ROLE_RANK: Record<string, number> = {
  student:     0,
  teacher:     1,
  coordinator: 2,
  principal:   3,
  admin:       4,
}

function hasCalendarAccess(viewer: UserProfile, target: UserProfile): boolean {
  if (viewer.id === target.id) return true
  if (viewer.role === 'admin') return true
  const viewerRank = ROLE_RANK[viewer.role] ?? 0
  const targetRank = ROLE_RANK[target.role] ?? 0
  // Can only look down the hierarchy, never sideways or up
  return viewerRank > targetRank
}

// ─── Inner modal (needs auth + router) ────────────────────────────────────────
function ProfileCardModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { profile: viewerProfile } = useAuth()
  const router = useRouter()

  const [targetProfile, setTargetProfile] = useState<UserProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)

  const [marks, setMarks] = useState<StudentMarkWithContext[]>([])
  const [loadingMarks, setLoadingMarks] = useState(false)

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
    setMarks([])
    loadProfile()
  }, [userId, loadProfile])

  useEffect(() => {
    if (!targetProfile || targetProfile.role !== 'student') {
      setMarks([])
      return
    }
    setLoadingMarks(true)
    fetchMarksForStudent(targetProfile.id).then(m => {
      setMarks(m)
      setLoadingMarks(false)
    })
  }, [targetProfile])

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
              {/* Gradient banner */}
              <div
                className="relative h-32 flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--page-gradient-from, #4f46e5), var(--page-gradient-to, #7c3aed))' }}
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
                  style={{ background: 'linear-gradient(135deg, var(--page-gradient-from, #4f46e5), var(--page-gradient-to, #7c3aed))' }}
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

                {/* ── Calendar button — only shown if viewer has access ──── */}
                {viewerProfile && hasCalendarAccess(viewerProfile, targetProfile) && (
                  <div className="w-full mt-4">
                    <button
                      onClick={openCalendarPage}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-sm transition-colors
                        bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                    >
                      <CalendarDays size={15} />
                      View Calendar
                    </button>
                  </div>
                )}

                {/* ── Assessment marks (students only) ────────────────────── */}
                {targetProfile.role === 'student' && (
                  <div className="w-full mt-5">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
                      Assessment Marks
                    </p>
                    {loadingMarks ? (
                      <div className="flex items-center justify-center py-6 gap-2 text-sm text-slate-400">
                        <Loader2 size={14} className="animate-spin" /> Loading marks…
                      </div>
                    ) : marks.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-4">No assessment marks recorded</p>
                    ) : (() => {
                      const groups: Record<string, StudentMarkWithContext[]> = {}
                      for (const m of marks) {
                        const yr = m.classroom_start_date
                          ? `AY ${parseInt(m.classroom_start_date.split('-')[0])}-${String(parseInt(m.classroom_start_date.split('-')[0]) + 1).slice(-2)}`
                          : 'No Year'
                        if (!groups[yr]) groups[yr] = []
                        groups[yr].push(m)
                      }
                      return Object.entries(groups).map(([year, yearMarks]) => (
                        <div key={year} className="mb-4">
                          <p className="text-[11px] font-bold mb-2 flex items-center gap-1" style={{ color: 'var(--page-primary)' }}>
                            <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--page-primary)' }} />
                            {year}
                          </p>
                          {(() => {
                            const byClass: Record<string, StudentMarkWithContext[]> = {}
                            for (const m of yearMarks) {
                              if (!byClass[m.classroom_title]) byClass[m.classroom_title] = []
                              byClass[m.classroom_title].push(m)
                            }
                            return Object.entries(byClass).map(([cls, clsMarks]) => (
                              <div key={cls} className="mb-2 bg-slate-50 rounded-xl p-3">
                                <p className="text-xs font-semibold text-slate-600 mb-2 truncate">{cls}</p>
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
                            ))
                          })()}
                        </div>
                      ))
                    })()}
                  </div>
                )}
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
