'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
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
  Pin,
  PinOff,
  Share2,
  Check,
  MoreHorizontal,
  BellRing,
} from 'lucide-react'
import {
  AnnouncementWithDetails,
  AnnouncementAttachment,
  deleteAnnouncement,
  toggleAnnouncementLike,
  setAnnouncementPinned,
} from '@/lib/announcements'
import Avatar from '@/components/Avatar'
import ImageGallery from './ImageGallery'
import dynamic from 'next/dynamic'

// WhatsApp reminders for this announcement — fetched only when opened.
const AnnouncementRemindersModal = dynamic(
  () => import('@/components/whatsapp/reminders/AnnouncementRemindersModal'), { ssr: false })

interface AnnouncementCardProps {
  announcement: AnnouncementWithDetails
  canDelete: boolean
  /** The announcer (creator) — and principal/admin — may pin/unpin */
  canPin?: boolean
  /** The announcer — and principal/admin — may WhatsApp its student audience */
  canRemind?: boolean
  onDelete: (id: string) => void
  onPinChange?: (id: string, pinned: boolean) => void
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
  if (diffMin  < 60)  return `${diffMin}m`
  if (diffHrs  < 24)  return `${diffHrs}h`
  if (diffDays <  7)  return `${diffDays}d`
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/** Normalise any YouTube URL shape into an embed URL. */
function toYouTubeEmbed(url: string): string {
  const idMatch =
    url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/)
  const id = idMatch?.[1]
  return id ? `https://www.youtube.com/embed/${id}` : url
}

// ── Type visual config — a single accent hue per audience type ────────────────

const TYPE_CONFIG = {
  student: {
    label: 'Students',
    Icon: GraduationCap,
    chip: 'bg-violet-50 text-violet-700 border-violet-200/80',
    dot: 'bg-violet-500',
  },
  staff: {
    label: 'Staff',
    Icon: Users,
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    dot: 'bg-emerald-500',
  },
  both: {
    label: 'Students & Staff',
    Icon: Users,
    chip: 'bg-rose-50 text-rose-700 border-rose-200/80',
    dot: 'bg-rose-500',
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
  canPin = false,
  canRemind = false,
  onDelete,
  onPinChange,
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
  const [pinned, setPinned]           = useState(!!announcement.pinned)
  const [pinning, setPinning]         = useState(false)
  const [pinError, setPinError]       = useState<string | null>(null)
  const [shared, setShared]           = useState(false)
  const [menuOpen, setMenuOpen]       = useState(false)
  const [remindOpen, setRemindOpen]   = useState(false)

  // Long-content handling: fixed-height scroll container + optional expand
  const contentRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [expanded,    setExpanded]    = useState(false)

  const typeKey = (announcement.type in TYPE_CONFIG ? announcement.type : 'student') as keyof typeof TYPE_CONFIG
  const cfg     = TYPE_CONFIG[typeKey]
  const badges  = getAudienceBadges(announcement)

  const attachments      = announcement.attachments ?? []
  const images           = attachments.filter(a => a.type === 'image')
  const otherAttachments = attachments.filter(a => a.type !== 'image')

  // ── Overflow detection (re-measured on resize, so the desktop and mobile
  //    height caps are both respected without duplicating breakpoint logic) ──
  const measure = useCallback(() => {
    const el = contentRef.current
    if (!el) return
    setOverflowing(el.scrollHeight - el.clientHeight > 8)
  }, [])

  useEffect(() => {
    if (expanded) return
    measure()
    const el = contentRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, expanded, announcement.content])

  // ── Close the overflow menu on outside click ──
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuOpen])

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

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/announcements#announcement-${announcement.id}`
    : ''

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const data = { title: announcement.title, text: announcement.title, url: shareUrl }
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(data)
        return
      }
      await navigator.clipboard.writeText(shareUrl)
      setShared(true)
      setTimeout(() => setShared(false), 1800)
    } catch {
      /* user dismissed the share sheet, or the clipboard was blocked */
    }
  }

  const handleTogglePin = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (pinning) return
    setPinning(true)
    setPinError(null)
    const next = !pinned
    setPinned(next)
    try {
      await setAnnouncementPinned(announcement.id, next)
      onPinChange?.(announcement.id, next)
    } catch (err) {
      setPinned(!next)
      setPinError(err instanceof Error ? err.message : 'Could not update pin')
      setTimeout(() => setPinError(null), 4000)
    }
    setPinning(false)
    setMenuOpen(false)
  }

  // ── Render ──

  const actionBtn =
    'group/act flex items-center gap-1.5 -ml-1.5 px-2 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors'

  return (
    <>
      <motion.article
        id={`announcement-${announcement.id}`}
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className={`group relative scroll-mt-24 ${pinned ? 'bg-amber-100/30' : ''}`}
      >
        {/* Pinned accent rail */}
        {pinned && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-400" />}

        <div className="px-3 sm:px-5 py-3.5 sm:py-4">

          {/* ── Pinned marker row ── */}
          {pinned && (
            <div className="flex items-center gap-1.5 mb-1.5 pl-[46px] sm:pl-[56px] text-amber-600">
              <Pin size={11} className="fill-amber-500 text-amber-500" />
              <span className="text-[11px] font-bold uppercase tracking-wider">Pinned</span>
            </div>
          )}

          <div className="flex gap-3 sm:gap-3.5">

            {/* ── Avatar column (x.com style) ── */}
            <div className="flex-shrink-0 pt-0.5">
              <Avatar
                avatarUrl={announcement.creator?.avatar_url}
                name={announcement.creator?.full_name}
                size={38}
                userId={announcement.creator?.id}
                className="sm:!w-[44px] sm:!h-[44px]"
              />
            </div>

            {/* ── Body column ── */}
            <div className="min-w-0 flex-1">

              {/* Author line */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="font-bold text-slate-900 text-[14px] sm:text-[15px] tracking-[-0.01em] truncate max-w-[190px] sm:max-w-none">
                    {announcement.creator?.full_name ?? 'Unknown'}
                  </span>
                  <span className="text-slate-300">·</span>
                  <time
                    className="text-[12.5px] text-slate-400 font-medium"
                    title={formatFullDate(announcement.created_at)}
                    dateTime={announcement.created_at}
                  >
                    {formatRelativeDate(announcement.created_at)}
                  </time>

                  {/* Audience chip — desktop shows the full label, mobile a dot */}
                  {badges.length > 0 && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setShowAudience(p => !p) }}
                      className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-all ${cfg.chip}`}
                    >
                      <cfg.Icon size={10} className="flex-shrink-0" />
                      {badges[0].label}
                      {badges.length > 1 && ` +${badges.length - 1}`}
                      {showAudience
                        ? <ChevronUp size={9} className="flex-shrink-0" />
                        : <ChevronDown size={9} className="flex-shrink-0" />}
                    </button>
                  )}
                  {badges.length > 0 && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setShowAudience(p => !p) }}
                      className="sm:hidden inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400"
                      aria-label="Show audience"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {badges.length > 1 ? `${badges.length} audiences` : badges[0].label}
                    </button>
                  )}
                </div>

                {/* Overflow menu — pin / delete */}
                {(canPin || canDelete) && (
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
                      className="p-1.5 -mr-1 rounded-full text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                      aria-label="More actions"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    <AnimatePresence>
                      {menuOpen && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -4 }}
                          transition={{ duration: 0.12 }}
                          onClick={e => e.stopPropagation()}
                          className="absolute right-0 top-8 z-20 w-44 rounded-xl border border-slate-200/80 bg-white shadow-xl shadow-slate-900/10 py-1.5"
                        >
                          {canPin && (
                            <button
                              onClick={handleTogglePin}
                              disabled={pinning}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                            >
                              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
                              {pinned ? 'Unpin' : 'Pin to top'}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowConfirm(true) }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
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
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {badges.map((badge, i) => (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                            badge.kind === 'student' ? 'bg-violet-50 text-violet-700 border-violet-200/80' :
                            badge.kind === 'staff'   ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80' :
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
              <h3 className="font-bold text-slate-900 text-[15px] sm:text-[16.5px] leading-snug mt-1.5 mb-1 tracking-[-0.015em]">
                {announcement.title}
              </h3>

              {/* ── Content — fixed-height scroll container when lengthy ── */}
              <div className="relative">
                <div
                  ref={contentRef}
                  className={`text-[14px] sm:text-[14.5px] text-slate-600 leading-relaxed whitespace-pre-wrap break-words ${
                    expanded
                      ? ''
                      : 'max-h-[220px] sm:max-h-[340px] overflow-y-auto ann-scroll pr-1'
                  }`}
                >
                  {announcement.content}
                </div>
              </div>

              {(overflowing || expanded) && (
                <button
                  onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
                  className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
                >
                  {expanded
                    ? <>Show less <ChevronUp size={13} /></>
                    : <>Show full announcement <ChevronDown size={13} /></>}
                </button>
              )}

              {/* ── Attachments — media sized for the wide desktop column ── */}
              {(images.length > 0 || otherAttachments.length > 0) && (
                <div className="mt-3 space-y-2.5">

                  {/* Images travel together as one Instagram-style gallery */}
                  {images.length > 0 && <ImageGallery images={images} />}

                  {otherAttachments.map((att: AnnouncementAttachment, i: number) => (
                    <div key={i}>
                      {att.type === 'youtube' && (
                        // Full column width — on desktop that is a genuinely
                        // watchable player, not a thumbnail-sized embed.
                        <div className="w-full max-w-full lg:max-w-[720px]">
                          <div className="rounded-2xl overflow-hidden border border-slate-200/70 bg-slate-900 relative">
                            {!loadedVideos.has(i) && (
                              <div className="skeleton w-full aspect-video rounded-none" />
                            )}
                            <iframe
                              src={toYouTubeEmbed(att.url)}
                              className="w-full aspect-video"
                              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
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
                          className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium border border-blue-200/70 bg-blue-50/60 text-blue-700 hover:bg-blue-50 transition-colors group/att max-w-full lg:max-w-[560px]"
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
                          className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium border border-violet-200/70 bg-violet-50/60 text-violet-700 hover:bg-violet-50 transition-colors group/att max-w-full lg:max-w-[560px]"
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

              {/* ── Action bar: like · share · pin ── */}
              <div className="flex items-center gap-1 sm:gap-6 mt-2.5 -mb-1">
                <motion.button
                  onClick={handleLike}
                  whileTap={{ scale: 0.88 }}
                  aria-pressed={userLiked}
                  aria-label={userLiked ? 'Unlike' : 'Like'}
                  className={`${actionBtn} ${
                    userLiked
                      ? 'text-rose-600 hover:bg-rose-50'
                      : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50'
                  }`}
                >
                  <Heart size={16} fill={userLiked ? 'currentColor' : 'none'} strokeWidth={2.2} />
                  <span className="tabular-nums">{likeCount > 0 ? likeCount : ''}</span>
                </motion.button>

                <motion.button
                  onClick={handleShare}
                  whileTap={{ scale: 0.88 }}
                  aria-label="Share announcement"
                  className={`${actionBtn} ${
                    shared ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                  }`}
                >
                  {shared ? <Check size={16} strokeWidth={2.4} /> : <Share2 size={16} strokeWidth={2.2} />}
                  <span className="hidden sm:inline">{shared ? 'Link copied' : 'Share'}</span>
                </motion.button>

                {canRemind && (
                  <motion.button
                    onClick={e => { e.stopPropagation(); setRemindOpen(true) }}
                    whileTap={{ scale: 0.88 }}
                    aria-label="WhatsApp reminders for this announcement"
                    className={`${actionBtn} text-slate-400 hover:text-violet-600 hover:bg-violet-50`}
                  >
                    <BellRing size={16} strokeWidth={2.2} />
                    <span className="hidden sm:inline">Remind</span>
                  </motion.button>
                )}

                {canPin && (
                  <motion.button
                    onClick={handleTogglePin}
                    whileTap={{ scale: 0.88 }}
                    disabled={pinning}
                    aria-pressed={pinned}
                    aria-label={pinned ? 'Unpin announcement' : 'Pin announcement'}
                    className={`${actionBtn} disabled:opacity-50 ${
                      pinned
                        ? 'text-amber-600 hover:bg-amber-50'
                        : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                    }`}
                  >
                    <Pin size={16} fill={pinned ? 'currentColor' : 'none'} strokeWidth={2.2} />
                    <span className="hidden sm:inline">{pinned ? 'Pinned' : 'Pin'}</span>
                  </motion.button>
                )}

                {pinError && (
                  <span className="text-[11.5px] font-semibold text-red-500 truncate">{pinError}</span>
                )}
              </div>

            </div>
          </div>
        </div>
      </motion.article>

      <AnimatePresence>
        {remindOpen && (
          <AnnouncementRemindersModal
            announcement={{ id: announcement.id, title: announcement.title }}
            onClose={() => setRemindOpen(false)}
          />
        )}
      </AnimatePresence>

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
