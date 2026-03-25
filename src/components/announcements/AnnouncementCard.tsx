'use client'

import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Trash2,
  GraduationCap,
  Users,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  ExternalLink,
  Heart,
} from 'lucide-react'
import {
  AnnouncementWithDetails,
  AnnouncementAttachment,
  deleteAnnouncement,
  toggleAnnouncementLike,
} from '@/lib/announcements'
import Avatar from '@/components/Avatar'

interface AnnouncementCardProps {
  announcement: AnnouncementWithDetails
  canDelete: boolean
  onDelete: (id: string) => void
  userId: string
  initialLikeCount?: number
  initialUserLiked?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeDate(dateStr: string): string {
  const date    = new Date(dateStr)
  const now     = new Date()
  const diffMs  = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHrs = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHrs / 24)

  if (diffMin  <  1)  return 'just now'
  if (diffMin  < 60)  return `${diffMin}m ago`
  if (diffHrs  < 24)  return `${diffHrs}h ago`
  if (diffDays <  7)  return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

// ── Type visual config ────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  student: {
    bar: 'bg-gradient-to-r from-slate-400 to-slate-600',
    tint: 'from-slate-50/80',
    badge: 'bg-slate-100 text-slate-600',
    label: 'Students',
    Icon: GraduationCap,
  },
  staff: {
    bar: 'bg-gradient-to-r from-stone-400 to-stone-600',
    tint: 'from-stone-50/80',
    badge: 'bg-stone-100 text-stone-600',
    label: 'Staff',
    Icon: Users,
  },
  both: {
    bar: 'bg-gradient-to-r from-zinc-400 to-zinc-600',
    tint: 'from-zinc-50/80',
    badge: 'bg-zinc-100 text-zinc-600',
    label: 'Students & Staff',
    Icon: Users,
  },
} as const

// ── Audience summary ──────────────────────────────────────────────────────────

interface AudienceBadge { label: string; kind: 'student' | 'staff' }

function getAudienceBadges(ann: AnnouncementWithDetails): AudienceBadge[] {
  const badges: AudienceBadge[] = []
  const seen = new Set<string>()

  for (const aud of ann.audiences) {
    if (aud.all_students) {
      if (!seen.has('all-students')) { seen.add('all-students'); badges.push({ label: 'All Students', kind: 'student' }) }
    } else if (aud.grade != null) {
      const label = aud.section ? `Grade ${aud.grade} – ${aud.section}` : `Grade ${aud.grade} – All Sections`
      if (!seen.has(label)) { seen.add(label); badges.push({ label, kind: 'student' }) }
    }
    if (aud.all_teams) {
      if (!seen.has('all-staff')) { seen.add('all-staff'); badges.push({ label: 'All Staff', kind: 'staff' }) }
    } else if (aud.team_id) {
      const label = aud.team?.name ?? aud.team_id
      if (!seen.has(label)) { seen.add(label); badges.push({ label, kind: 'staff' }) }
    }
  }
  return badges
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AnnouncementCard({
  announcement,
  canDelete,
  onDelete,
  userId,
  initialLikeCount = 0,
  initialUserLiked = false,
}: AnnouncementCardProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const [likeCount, setLikeCount]     = useState(initialLikeCount)
  const [userLiked, setUserLiked]     = useState(initialUserLiked)
  const [liking, setLiking]           = useState(false)
  const [showAudience, setShowAudience] = useState(false)

  const typeKey = (announcement.type in TYPE_CONFIG ? announcement.type : 'student') as keyof typeof TYPE_CONFIG
  const cfg     = TYPE_CONFIG[typeKey]
  const badges  = getAudienceBadges(announcement)

  // ── Handlers ──

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteAnnouncement(announcement.id)
      setShowConfirm(false)
      onDelete(announcement.id)
    } catch (err) {
      console.error('Failed to delete announcement:', err)
    }
    setDeleting(false)
  }

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (liking) return
    setLiking(true)
    const prevLiked = userLiked
    const prevCount = likeCount
    const newLiked  = !userLiked
    setUserLiked(newLiked)
    setLikeCount(c => newLiked ? c + 1 : Math.max(0, c - 1))
    try {
      await toggleAnnouncementLike(announcement.id, userId, prevLiked)
    } catch {
      setUserLiked(prevLiked)
      setLikeCount(prevCount)
    }
    setLiking(false)
  }

  // ── Render ──

  return (
    <>
      <motion.article
        layout
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="relative rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow duration-300 border border-slate-100"
      >
        {/* Coloured top accent bar */}
        <div className={`h-[3px] w-full ${cfg.bar}`} />

        {/* Subtle type-colour tint at the top */}
        <div className={`absolute top-[3px] left-0 right-0 h-20 bg-gradient-to-b ${cfg.tint} to-transparent pointer-events-none`} />

        <div className="relative px-5 py-4">

          {/* ── Row 1: type badge · audience hint · time · delete ── */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full flex-shrink-0 ${cfg.badge}`}>
                <cfg.Icon size={10} />
                {cfg.label}
              </span>
              {badges.length > 0 && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setShowAudience(p => !p) }}
                  className="text-[11px] text-slate-400 font-medium hover:text-slate-600 truncate transition-colors flex items-center gap-0.5"
                >
                  {badges[0].label}
                  {badges.length > 1 && ` +${badges.length - 1}`}
                  {showAudience ? <ChevronUp size={10} className="flex-shrink-0" /> : <ChevronDown size={10} className="flex-shrink-0" />}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[11px] text-slate-400">{formatRelativeDate(announcement.created_at)}</span>
              {canDelete && (
                <button
                  onClick={e => { e.stopPropagation(); setShowConfirm(true) }}
                  className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Expanded audience chips */}
          <AnimatePresence>
            {showAudience && badges.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {badges.map((badge, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                        badge.kind === 'student' ? 'bg-slate-100 text-slate-600' : 'bg-stone-100 text-stone-600'
                      }`}
                    >
                      {badge.kind === 'student' ? <GraduationCap size={10} /> : <Users size={10} />}
                      {badge.label}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Title ── */}
          <h3 className="font-bold text-slate-800 text-[15px] sm:text-base leading-snug mb-2">
            {announcement.title}
          </h3>

          {/* ── Content – always fully visible ── */}
          <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
            {announcement.content}
          </p>

          {/* Attachments – always shown */}
          {announcement.attachments && announcement.attachments.length > 0 && (
            <div className="mt-3 space-y-2">
              {announcement.attachments.map((att: AnnouncementAttachment, i: number) => (
                <div key={i}>
                  {att.type === 'image' && (
                    <a href={att.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="block">
                      <img
                        src={att.url}
                        alt={att.name}
                        className="max-h-64 w-auto max-w-full rounded-xl border border-slate-100"
                      />
                    </a>
                  )}
                  {att.type === 'youtube' && (
                    <div className="rounded-xl overflow-hidden border border-slate-100" onClick={e => e.stopPropagation()}>
                      <iframe
                        src={att.url.replace('watch?v=', 'embed/').replace('youtu.be/', 'www.youtube.com/embed/')}
                        className="w-full aspect-video"
                        allowFullScreen
                        title={att.name}
                      />
                    </div>
                  )}
                  {att.type === 'document' && (
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors"
                    >
                      <FileText size={14} />
                      <span className="flex-1 truncate">{att.name}</span>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Footer: author + like ── */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <Avatar
                avatarUrl={announcement.creator?.avatar_url}
                name={announcement.creator?.full_name}
                size={26}
              />
              <span className="text-xs text-slate-500 font-medium">
                {announcement.creator?.full_name ?? 'Unknown'}
              </span>
            </div>

            {/* Heart / like button */}
            <motion.button
              onClick={handleLike}
              whileTap={{ scale: 0.85 }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors duration-200 ${
                userLiked
                  ? 'bg-red-50 text-red-500 border-red-200 hover:bg-red-100'
                  : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-red-50 hover:text-red-400 hover:border-red-200'
              }`}
            >
              <Heart
                size={13}
                fill={userLiked ? 'currentColor' : 'none'}
                strokeWidth={2}
              />
              {likeCount > 0 && <span>{likeCount}</span>}
            </motion.button>
          </div>

        </div>
      </motion.article>

      {/* Delete confirmation portal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
              onClick={() => !deleting && setShowConfirm(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-red-100 rounded-xl">
                    <AlertTriangle size={20} className="text-red-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">Delete Announcement</h3>
                    <p className="text-sm text-slate-500">This action cannot be undone.</p>
                  </div>
                </div>
                <p className="text-sm text-slate-600 mb-5">
                  Are you sure you want to delete &ldquo;{announcement.title}&rdquo;?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowConfirm(false)}
                    disabled={deleting}
                    className="flex-1 btn-secondary disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {deleting
                      ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Deleting...</>
                      : <><Trash2 size={14} /> Delete</>
                    }
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
