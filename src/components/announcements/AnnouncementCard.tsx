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
  User,
  Link2,
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
    bar: 'bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-600',
    cardTint: 'from-violet-500/[0.07] via-transparent to-transparent',
    badge: 'bg-violet-50 text-violet-700 border border-violet-200/80',
    expandedBadge: 'bg-violet-50 text-violet-700 border border-violet-200/80',
    label: 'Students',
    Icon: GraduationCap,
    glowRgba: 'rgba(139,92,246,0.22)',
  },
  staff: {
    bar: 'bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-600',
    cardTint: 'from-emerald-500/[0.07] via-transparent to-transparent',
    badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
    expandedBadge: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
    label: 'Staff',
    Icon: Users,
    glowRgba: 'rgba(16,185,129,0.22)',
  },
  both: {
    bar: 'bg-gradient-to-r from-rose-500 via-pink-500 to-orange-500',
    cardTint: 'from-rose-500/[0.07] via-transparent to-transparent',
    badge: 'bg-rose-50 text-rose-700 border border-rose-200/80',
    expandedBadge: 'bg-rose-50 text-rose-700 border border-rose-200/80',
    label: 'Students & Staff',
    Icon: Users,
    glowRgba: 'rgba(244,63,94,0.22)',
  },
} as const

// ── Audience summary ──────────────────────────────────────────────────────────

interface AudienceBadge { label: string; kind: 'student' | 'staff' | 'individual' }

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
    if (aud.user_id) {
      if (!seen.has(aud.user_id)) { seen.add(aud.user_id); badges.push({ label: 'Individual member', kind: 'individual' }) }
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
  const [loadedVideos, setLoadedVideos] = useState<Set<number>>(new Set())
  const [hovered, setHovered]         = useState(false)

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
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        className="relative rounded-2xl overflow-hidden max-h-[884px]"
        style={{
          background: 'linear-gradient(158deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.38) 100%)',
          backdropFilter: 'blur(32px) saturate(180%)',
          WebkitBackdropFilter: 'blur(32px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.65)',
          boxShadow: hovered
            ? `0 2px 4px rgba(15,23,42,0.04), 0 20px 48px -12px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.85), 0 12px 32px -8px ${cfg.glowRgba}`
            : '0 1px 2px rgba(15,23,42,0.03), 0 8px 28px -10px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.8)',
          transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
          transition: 'box-shadow 0.35s cubic-bezier(0.2,0.9,0.25,1), transform 0.25s cubic-bezier(0.2,0.9,0.25,1)',
        }}
      >
        {/* Coloured top accent bar — vivid, type-specific */}
        <div className={`h-[5px] w-full ${cfg.bar}`} />

        {/* Inner top highlight */}
        <div className="absolute inset-x-0 top-[5px] h-16 bg-gradient-to-b from-white/40 to-transparent pointer-events-none" />

        {/* Type-colour tint wash */}
        <div className={`absolute top-[5px] left-0 right-0 h-24 bg-gradient-to-b ${cfg.cardTint} pointer-events-none`} />

        <div className="relative px-5 py-4">

          {/* ── Row 1: audience hint · time · delete ── */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              {badges.length > 0 && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setShowAudience(p => !p) }}
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full transition-all ${cfg.badge}`}
                >
                  <cfg.Icon size={10} className="flex-shrink-0" />
                  {badges[0].label}
                  {badges.length > 1 && ` +${badges.length - 1}`}
                  {showAudience ? <ChevronUp size={9} className="flex-shrink-0 ml-0.5" /> : <ChevronDown size={9} className="flex-shrink-0 ml-0.5" />}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[11px] text-slate-400">{formatRelativeDate(announcement.created_at)}</span>
              {canDelete && (
                <button
                  onClick={e => { e.stopPropagation(); setShowConfirm(true) }}
                  className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50/70 rounded-lg transition-colors"
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
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                        badge.kind === 'student'    ? 'bg-violet-50 text-violet-700 border-violet-200/80' :
                        badge.kind === 'staff'      ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80' :
                                                      'bg-purple-50 text-purple-700 border-purple-200/80'
                      }`}
                    >
                      {badge.kind === 'student' ? <GraduationCap size={10} /> :
                       badge.kind === 'staff'   ? <Users size={10} /> :
                                                  <User size={10} />}
                      {badge.label}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Title ── */}
          <h3 className="font-bold text-slate-900 text-[15px] sm:text-[16px] leading-snug mb-2 tracking-[-0.01em]">
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
                        className="max-h-[260px] w-auto max-w-full rounded-xl border border-white/50 shadow-sm"
                      />
                    </a>
                  )}
                  {att.type === 'youtube' && (
                    <div
                      className="mx-auto"
                      style={{ maxWidth: 'calc(220px * 16 / 9)', maxHeight: '220px' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="rounded-xl overflow-hidden border border-white/50 shadow-sm relative">
                        {!loadedVideos.has(i) && (
                          <div className="skeleton w-full aspect-video rounded-none" />
                        )}
                        <iframe
                          src={att.url.replace('watch?v=', 'embed/').replace('youtu.be/', 'www.youtube.com/embed/')}
                          className="w-full aspect-video"
                          allowFullScreen
                          title={att.name}
                          style={loadedVideos.has(i) ? undefined : { position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}
                          onLoad={() => setLoadedVideos(prev => new Set(prev).add(i))}
                        />
                      </div>
                    </div>
                  )}
                  {att.type === 'document' && (
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group/att"
                      style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#1d4ed8' }}
                    >
                      <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 group-hover/att:bg-blue-200 transition-colors">
                        <FileText size={13} className="text-blue-600" />
                      </div>
                      <span className="flex-1 truncate">{att.name}</span>
                      <ExternalLink size={12} className="flex-shrink-0 text-blue-400" />
                    </a>
                  )}
                  {att.type === 'link' && (
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group/att"
                      style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', color: '#6d28d9' }}
                    >
                      <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0 group-hover/att:bg-violet-200 transition-colors">
                        <Link2 size={13} className="text-violet-600" />
                      </div>
                      <span className="flex-1 truncate">{att.name !== att.url ? att.name : att.url}</span>
                      <ExternalLink size={12} className="flex-shrink-0 text-violet-400" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Footer: author + like ── */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/40">
            <div className="flex items-center gap-2">
              <Avatar
                avatarUrl={announcement.creator?.avatar_url}
                name={announcement.creator?.full_name}
                size={28}
                userId={announcement.creator?.id}
              />
              <span className="text-xs text-slate-500 font-semibold">
                {announcement.creator?.full_name ?? 'Unknown'}
              </span>
            </div>

            {/* Heart / like button */}
            <motion.button
              onClick={handleLike}
              whileTap={{ scale: 0.82 }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-200 ${
                userLiked
                  ? 'bg-red-50 text-red-500 border-red-200 shadow-sm shadow-red-500/20'
                  : 'bg-white/50 text-slate-400 border-white/60 hover:bg-red-50/80 hover:text-red-400 hover:border-red-200/70'
              }`}
            >
              <Heart
                size={13}
                fill={userLiked ? 'currentColor' : 'none'}
                strokeWidth={2.5}
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
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md"
              onClick={() => !deleting && setShowConfirm(false)}
            >
              <motion.div
                initial={{ scale: 0.93, opacity: 0, y: 8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.93, opacity: 0, y: 8 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl w-full max-w-sm p-6 border border-white/80"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-red-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                    <AlertTriangle size={18} className="text-red-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-[15px]">Delete Announcement</h3>
                    <p className="text-sm text-slate-400 mt-0.5">This cannot be undone.</p>
                  </div>
                </div>
                <p className="text-sm text-slate-600 mb-5 leading-relaxed">
                  Are you sure you want to delete &ldquo;{announcement.title}&rdquo;?
                </p>
                <div className="flex gap-2.5">
                  <button
                    onClick={() => setShowConfirm(false)}
                    disabled={deleting}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-md shadow-red-500/25"
                  >
                    {deleting
                      ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Deleting…</>
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
