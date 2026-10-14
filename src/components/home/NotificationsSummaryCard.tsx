'use client'

import React, { useCallback, useRef } from 'react'
import Link from 'next/link'
import { CheckCircle2, XCircle, Inbox, Check, Loader2, Megaphone, ChevronRight } from 'lucide-react'
import { NotifItem, NotifTone, isApplicantDecision } from '@/lib/leaveNotifications'
import { SkeletonRows } from './HomeCardSkeletons'

export const TONE_ICON: Record<NotifTone, React.ReactNode> = {
  approved: <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />,
  rejected: <XCircle size={15} className="text-red-400 flex-shrink-0" />,
  incoming: <Inbox size={15} className="text-sky-500 flex-shrink-0" />,
}

/** An unread announcement, as this box shows it: a headline and when it landed. */
export interface AnnouncementNotice {
  id: string
  title: string
  created_at: string
}

interface NotificationsSummaryCardProps {
  items: NotifItem[]
  /** Unread announcements, newest first — listed above the leave rows. */
  announcements?: AnnouncementNotice[]
  /** More unread rows exist behind the ones currently listed. */
  hasMore: boolean
  /** A page is in flight — the footer shows a spinner instead of re-asking. */
  loadingMore: boolean
  /** Pulls the next ten rows; fired on reaching the bottom of the list. */
  onLoadMore: () => void
  /** Marks an applicant's decision row read (here and on the application). */
  onRead: (item: NotifItem) => void
  /** Opens the row's application in the shared popup, in place. */
  onOpen: (item: NotifItem) => void
  /** Fired as an announcement headline is followed to the announcements page. */
  onAnnouncementOpen?: (announcement: AnnouncementNotice) => void
}

/** "Today" / "Yesterday" / weekday / date — the same scale the feed rows use. */
function formatNoticeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  if (sameDay(date, now)) return 'Today'
  if (sameDay(date, yesterday)) return 'Yesterday'

  const diffDays = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
     new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000
  )
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Placeholder shown while the notification list is still being fetched.
 *
 * The home carousel doesn't know whether the notifications slot will exist
 * until the fetch resolves, so it reserves the slot optimistically and shows
 * this in the meantime — same size and row rhythm as the real card, so
 * swapping in the loaded content (or dropping the slot, if it turns out
 * empty) never shifts layout.
 */
export function NotificationsCardSkeleton() {
  return (
    <div className="home-card glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      {/* Was an `animate-pulse` opacity throb while every other card on the
          page showed a spinner. Now it draws from the same `.skeleton` shimmer
          as the rest of the dashboard, so eight cards loading at once read as
          one page filling in rather than eight different kinds of waiting. */}
      <SkeletonRows rows={4} />
    </div>
  )
}

/**
 * The user's unread OD / Leave notifications as plain-language sentences, one
 * per row. The outer SectionHeading already reads "Notifications" so rows skip
 * repeating it.
 *
 * The list scrolls inside the card and holds ten rows at a time — reaching the
 * bottom pulls the next ten (see `createNotificationFeed`), so an inbox with a
 * hundred unread decisions costs the same first paint as one with three.
 *
 * Only an applicant's own decision can be marked read from here. A request
 * waiting on the viewer's decision has no such control: it is unread until it
 * is approved or rejected, at which point it leaves the feed by itself.
 */
export default function NotificationsSummaryCard({
  items, announcements = [], hasMore, loadingMore, onLoadMore, onRead, onOpen, onAnnouncementOpen,
}: NotificationsSummaryCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || !hasMore || loadingMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) onLoadMore()
  }, [hasMore, loadingMore, onLoadMore])

  // The carousel drops this slot when there is nothing unread at all — which
  // now means neither an announcement nor a leave notification.
  if (items.length === 0 && announcements.length === 0) {
    return (
      <div className="home-card glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center mb-3">
          <Inbox size={22} className="text-slate-300" />
        </div>
        <p className="text-sm font-medium text-slate-400">You&apos;re all caught up</p>
        <p className="text-xs text-slate-300 mt-1">No unread notifications</p>
      </div>
    )
  }

  return (
    <div className="home-card glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain divide-y divide-white/25"
      >
        {/* Announcements lead the box: they are school-wide news, and unlike a
            leave row there is nothing to decide — the headline links straight
            to the announcements page, which is where reading it marks it read
            and drops it from here. */}
        {announcements.map(a => (
          <Link
            key={a.id}
            href={`/announcements?a=${a.id}`}
            onClick={() => onAnnouncementOpen?.(a)}
            className="home-card-row flex items-center gap-2.5 px-5 py-3 hover:bg-white/45 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
          >
            <Megaphone size={15} className="text-violet-500 flex-shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-semibold text-slate-700 truncate group-hover:text-slate-900 transition-colors" title={a.title}>
                {a.title}
              </span>
            </span>
            <span className="flex-shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/55 text-slate-500 group-hover:bg-white/80 transition-colors">
              {formatNoticeDate(a.created_at)}
            </span>
            <ChevronRight size={14} className="flex-shrink-0 text-slate-300 transition-all duration-200 group-hover:text-slate-500 group-hover:translate-x-0.5" />
          </Link>
        ))}

        {items.map(item => (
          <div key={item.id} className="home-card-row flex items-start gap-1 pr-2 hover:bg-white/45 transition-colors">
            {/* Opening a decision on your own leave is the whole point of the
                row, so reading it clears it — here and on the application. An
                incoming request is not addressed just by being looked at; it
                clears when the decision is made. Opens the shared popup in
                place — never navigates away. */}
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="home-card-row flex-1 min-w-0 flex items-start gap-2.5 pl-5 py-3 cursor-pointer text-left"
            >
              <span className="mt-0.5">{TONE_ICON[item.tone]}</span>
              <p className="flex-1 min-w-0 text-[13px] leading-snug text-slate-600">{item.text}</p>
            </button>
            {isApplicantDecision(item) && (
              <button
                type="button"
                onClick={() => onRead(item)}
                aria-label="Mark as read"
                title="Mark as read"
                className="mt-3 p-1 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-white/60 transition-colors flex-shrink-0"
              >
                <Check size={13} />
              </button>
            )}
          </div>
        ))}

        {hasMore && (
          <div className="flex justify-center py-3">
            {loadingMore ? (
              <Loader2 size={15} className="animate-spin text-slate-400" />
            ) : (
              <button
                type="button"
                onClick={onLoadMore}
                className="text-[12px] font-semibold text-slate-500 hover:text-slate-700 transition-colors"
              >
                Load more
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
