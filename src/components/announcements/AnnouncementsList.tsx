'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Megaphone } from 'lucide-react'
import AnnouncementCard from './AnnouncementCard'
import NewAnnouncementForm from './NewAnnouncementForm'
import {
  AnnouncementWithDetails,
  fetchAnnouncementsForUser,
  fetchLikesForAnnouncements,
} from '@/lib/announcements'
import { UserRole } from '@/lib/supabase'

interface AnnouncementsListProps {
  userId: string
  userRole: UserRole
  userGrade?: number
  userSection?: string
  userTeams?: { id: string; name: string }[]
  allTeams?: { id: string; name: string }[]
  teamGradeRanges?: { teamId: string; grades: number[] }[]
  showNewForm?: boolean
  onNewFormChange?: (show: boolean) => void
}

// ── Date grouping ─────────────────────────────────────────────────────────────

function dateGroupLabel(dateStr: string): string {
  const date  = new Date(dateStr)
  const now   = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const annDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((today.getTime() - annDay.getTime()) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)
    return date.toLocaleDateString('en-US', { weekday: 'long' })
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: diffDays > 365 ? 'numeric' : undefined,
  })
}

function groupByDate(items: AnnouncementWithDetails[]) {
  const groups: { label: string; items: AnnouncementWithDetails[] }[] = []
  const indexMap = new Map<string, number>()

  for (const ann of items) {
    const label = dateGroupLabel(ann.created_at)
    if (!indexMap.has(label)) {
      indexMap.set(label, groups.length)
      groups.push({ label, items: [] })
    }
    groups[indexMap.get(label)!].items.push(ann)
  }
  return groups
}

// ── Animation variants ────────────────────────────────────────────────────────

const listVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } },
}
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AnnouncementsList({
  userId,
  userRole,
  userGrade,
  userSection,
  userTeams = [],
  allTeams  = [],
  teamGradeRanges = [],
  showNewForm: externalShowNewForm,
  onNewFormChange,
}: AnnouncementsListProps) {
  const [announcements, setAnnouncements] = useState<AnnouncementWithDetails[]>([])
  const [loading,  setLoading]  = useState(true)
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({})
  const [likedSet,   setLikedSet]   = useState<Set<string>>(new Set())
  const [localShowNewForm, setLocalShowNewForm] = useState(false)

  const showNewForm    = externalShowNewForm ?? localShowNewForm
  const setShowNewForm = (show: boolean) => {
    if (onNewFormChange) onNewFormChange(show)
    else setLocalShowNewForm(show)
  }

  const canCreate    = ['coordinator', 'principal', 'admin'].includes(userRole)
  const canDeleteOwn = ['coordinator', 'principal', 'admin'].includes(userRole)

  const loadAnnouncements = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAnnouncementsForUser(userId, userRole, userGrade, userSection)
      setAnnouncements(data)

      // Fetch likes for all loaded announcements
      const ids = data.map(a => a.id)
      const { counts, liked } = await fetchLikesForAnnouncements(ids, userId)
      setLikeCounts(counts)
      setLikedSet(liked)
    } catch (err) {
      console.error('Failed to load announcements:', err)
    } finally {
      setLoading(false)
    }
  }, [userId, userRole, userGrade, userSection])

  useEffect(() => { loadAnnouncements() }, [loadAnnouncements])

  const handleDelete  = (id: string) => setAnnouncements(prev => prev.filter(a => a.id !== id))
  const handleCreated = () => loadAnnouncements()

  // ── Render ──

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="spinner mx-auto mb-3" />
        <p className="text-sm text-slate-400">Loading announcements…</p>
      </div>
    )
  }

  if (announcements.length === 0) {
    return (
      <>
        <div className="glass rounded-2xl p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto mb-4">
            <Megaphone size={28} className="text-violet-400" />
          </div>
          <p className="text-slate-500 text-sm font-medium">No announcements yet.</p>
          {canCreate && (
            <button
              onClick={() => setShowNewForm(true)}
              className="mt-3 text-sm text-violet-600 hover:text-violet-700 font-semibold"
            >
              Create the first announcement
            </button>
          )}
        </div>
        {canCreate && (
          <NewAnnouncementForm
            isOpen={showNewForm}
            onClose={() => setShowNewForm(false)}
            onCreated={handleCreated}
            currentUserId={userId}
            currentUserRole={userRole}
            userTeams={userTeams}
            allTeams={allTeams}
            teamGradeRanges={teamGradeRanges}
          />
        )}
      </>
    )
  }

  const groups = groupByDate(announcements)

  return (
    <>
      <motion.div
        variants={listVariants}
        initial="hidden"
        animate="show"
        className="space-y-6"
      >
        {groups.map(group => (
          <div key={group.label}>
            {/* Date group header */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                {group.label}
              </span>
              <div className="flex-1 h-px bg-slate-200/70" />
            </div>

            {/* Cards */}
            <AnimatePresence mode="popLayout">
              <div className="space-y-3">
                {group.items.map(ann => (
                  <motion.div key={ann.id} variants={itemVariants}>
                    <AnnouncementCard
                      announcement={ann}
                      canDelete={
                        canDeleteOwn && (
                          ann.created_by === userId ||
                          userRole === 'principal' ||
                          userRole === 'admin'
                        )
                      }
                      onDelete={handleDelete}
                      userId={userId}
                      initialLikeCount={likeCounts[ann.id] ?? 0}
                      initialUserLiked={likedSet.has(ann.id)}
                    />
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          </div>
        ))}
      </motion.div>

      {canCreate && (
        <NewAnnouncementForm
          isOpen={showNewForm}
          onClose={() => setShowNewForm(false)}
          onCreated={handleCreated}
          currentUserId={userId}
          currentUserRole={userRole}
          userTeams={userTeams}
          allTeams={allTeams}
          teamGradeRanges={teamGradeRanges}
        />
      )}
    </>
  )
}
