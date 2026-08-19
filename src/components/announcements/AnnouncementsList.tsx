'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Megaphone, Plus, Pin } from 'lucide-react'
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

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
}

function dateGroupLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const now  = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  if (sameDay(date, now))       return 'Today'
  if (sameDay(date, yesterday)) return 'Yesterday'

  const diffDays = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
     new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000
  )
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

// ── Skeleton card ─────────────────────────────────────────────────────────────

function AnnouncementRowSkeleton() {
  return (
    <div className="px-3 sm:px-5 py-4">
      <div className="flex gap-3 sm:gap-3.5">
        <div className="skeleton w-[38px] h-[38px] sm:w-[44px] sm:h-[44px] rounded-full flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className="skeleton h-3.5 w-32 rounded-full" />
            <div className="skeleton h-3 w-10 rounded-full" />
          </div>
          <div className="skeleton h-4 w-2/3 rounded-lg mb-2" />
          <div className="space-y-2">
            <div className="skeleton h-3 w-full rounded-lg" />
            <div className="skeleton h-3 w-5/6 rounded-lg" />
          </div>
          <div className="flex items-center gap-6 mt-3">
            <div className="skeleton h-4 w-10 rounded-full" />
            <div className="skeleton h-4 w-14 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A hairline that runs the full width of the viewport, not just the feed
 * column. `w-screen` centred on the column reaches both screen edges; the page
 * wrapper clips the overflow so this can never introduce sideways scrolling.
 */
function FullBleedRule({ className = 'bg-slate-300/45' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-screen max-w-[100vw] h-px pointer-events-none ${className}`}
    />
  )
}

/** Sticky in-stream separator — the Linear changelog's date marker rhythm. */
function StreamMarker({
  label,
  count,
  accent = false,
  children,
}: {
  label: string
  count?: number
  accent?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      className="sticky z-10 flex items-center gap-2.5 px-3 sm:px-5 py-2"
      style={{ top: 'calc(4rem + env(safe-area-inset-top))' }}
    >
      {/* Full-width frosted band so the marker stays readable over content */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-screen max-w-[100vw] pointer-events-none"
        style={{
          background: accent ? 'rgba(255,251,235,0.72)' : 'rgba(248,247,255,0.72)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      />
      <FullBleedRule className={accent ? 'bg-amber-300/50' : 'bg-slate-300/45'} />
      <div className="relative flex items-center gap-2.5 w-full">
        {children}
        <span
          className={`text-[10.5px] font-black uppercase tracking-[0.18em] whitespace-nowrap ${
            accent ? 'text-amber-600' : 'text-slate-500'
          }`}
        >
          {label}
        </span>
        <div className="flex-1" />
        {count != null && (
          <span className="text-[10.5px] font-bold text-slate-400 tabular-nums flex-shrink-0">{count}</span>
        )}
      </div>
    </div>
  )
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

const PAGE_SIZE = 10

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
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore,     setHasMore]     = useState(false)
  const [nextOffset,  setNextOffset]  = useState(0)
  const [likeCounts,  setLikeCounts]  = useState<Record<string, number>>({})
  const [likedSet,    setLikedSet]    = useState<Set<string>>(new Set())
  const [localShowNewForm, setLocalShowNewForm] = useState(false)

  const showNewForm    = externalShowNewForm ?? localShowNewForm
  const setShowNewForm = (show: boolean) => {
    if (onNewFormChange) onNewFormChange(show)
    else setLocalShowNewForm(show)
  }

  const canCreate    = ['coordinator', 'principal', 'admin'].includes(userRole)
  const canDeleteOwn = ['coordinator', 'principal', 'admin'].includes(userRole)

  const loadPage = useCallback(async (currentOffset: number, append: boolean) => {
    if (append) setLoadingMore(true)
    else setLoading(true)

    try {
      const data = await fetchAnnouncementsForUser(
        userId, userRole, userGrade, userSection, PAGE_SIZE, currentOffset
      )

      setAnnouncements(prev => append ? [...prev, ...data] : data)
      setHasMore(data.length === PAGE_SIZE)
      setNextOffset(currentOffset + data.length)

      if (data.length > 0) {
        const ids = data.map(a => a.id)
        const { counts, liked } = await fetchLikesForAnnouncements(ids, userId)
        if (append) {
          setLikeCounts(prev => ({ ...prev, ...counts }))
          setLikedSet(prev => new Set([...prev, ...liked]))
        } else {
          setLikeCounts(counts)
          setLikedSet(liked)
        }
      }
    } catch (err) {
      console.error('Failed to load announcements:', err)
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }, [userId, userRole, userGrade, userSection])

  useEffect(() => { loadPage(0, false) }, [loadPage])

  const handleLoadMore = () => loadPage(nextOffset, true)
  const handleDelete   = (id: string) => setAnnouncements(prev => prev.filter(a => a.id !== id))
  const handleCreated  = () => loadPage(0, false)

  /** Re-sort locally so a freshly pinned item jumps to the top of the feed. */
  const handlePinChange = (id: string, pinned: boolean) =>
    setAnnouncements(prev =>
      prev
        .map(a => (a.id === id ? { ...a, pinned, pinned_at: pinned ? new Date().toISOString() : null } : a))
        .sort((a, b) =>
          Number(!!b.pinned) - Number(!!a.pinned) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
    )

  /** The announcer owns their post; principal/admin can pin anything. */
  const mayPin = (ann: AnnouncementWithDetails) =>
    canCreate && (ann.created_by === userId || userRole === 'principal' || userRole === 'admin')

  // ── Render ──

  if (loading) {
    return (
      <div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="relative">
            <AnnouncementRowSkeleton />
            <FullBleedRule />
          </div>
        ))}
      </div>
    )
  }

  if (announcements.length === 0) {
    return (
      <>
        <div className="relative">
          <FullBleedRule />
          <div className="px-6 py-14 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mx-auto mb-4">
              <Megaphone size={24} className="text-white" />
            </div>
            <p className="text-slate-800 text-base font-bold mb-1">Nothing here yet</p>
            <p className="text-slate-400 text-sm mb-5">No announcements have been posted.</p>
            {canCreate && (
              <button
                onClick={() => setShowNewForm(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold hover:from-violet-700 hover:to-indigo-700 transition-all"
              >
                <Plus size={15} />
                Create the first announcement
              </button>
            )}
          </div>
          <FullBleedRule />
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

  const pinnedItems = announcements.filter(a => a.pinned)
  const restItems   = announcements.filter(a => !a.pinned)
  const groups      = groupByDate(restItems)

  const renderCard = (ann: AnnouncementWithDetails) => (
    <motion.div key={ann.id} variants={itemVariants} className="relative">
      <AnnouncementCard
        announcement={ann}
        canDelete={
          canDeleteOwn && (
            ann.created_by === userId ||
            userRole === 'principal' ||
            userRole === 'admin'
          )
        }
        canPin={mayPin(ann)}
        onDelete={handleDelete}
        onPinChange={handlePinChange}
        userId={userId}
        initialLikeCount={likeCounts[ann.id] ?? 0}
        initialUserLiked={likedSet.has(ann.id)}
      />
      <FullBleedRule />
    </motion.div>
  )

  return (
    <>
      <motion.div variants={listVariants} initial="hidden" animate="show">
        <div>
          {/* ── Pinned by the announcer ── */}
          {pinnedItems.length > 0 && (
            <>
              <StreamMarker label="Pinned" accent>
                <Pin size={11} className="text-amber-500 fill-amber-500 flex-shrink-0" />
              </StreamMarker>
              <AnimatePresence mode="popLayout" initial={false}>
                {pinnedItems.map(renderCard)}
              </AnimatePresence>
            </>
          )}

          {/* ── Date-marked stream ── */}
          {groups.map(group => (
            <React.Fragment key={group.label}>
              <StreamMarker label={group.label} count={group.items.length} />
              <AnimatePresence mode="popLayout" initial={false}>
                {group.items.map(renderCard)}
              </AnimatePresence>
            </React.Fragment>
          ))}
        </div>
      </motion.div>

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center pt-4 pb-4">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 px-7 py-2.5 rounded-full text-sm font-bold bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/25 hover:from-violet-700 hover:to-indigo-700 hover:shadow-violet-500/35 hover:shadow-xl transition-all disabled:opacity-60"
          >
            {loadingMore ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin flex-shrink-0" />
                Loading…
              </>
            ) : (
              'Load more'
            )}
          </button>
        </div>
      )}

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
