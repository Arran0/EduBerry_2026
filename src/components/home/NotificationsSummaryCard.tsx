'use client'

import React, { useCallback, useRef } from 'react'
import { CheckCircle2, XCircle, Inbox, Check, Loader2 } from 'lucide-react'
import { NotifItem, NotifTone, isApplicantDecision } from '@/lib/leaveNotifications'

export const TONE_ICON: Record<NotifTone, React.ReactNode> = {
  approved: <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />,
  rejected: <XCircle size={15} className="text-red-400 flex-shrink-0" />,
  incoming: <Inbox size={15} className="text-sky-500 flex-shrink-0" />,
}

interface NotificationsSummaryCardProps {
  items: NotifItem[]
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
    <div className="glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      <div className="flex-1 divide-y divide-white/25">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-start gap-2.5 px-5 py-3 animate-pulse">
            <span className="mt-0.5 w-[15px] h-[15px] rounded-full bg-slate-300/60 flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5 py-0.5">
              <div className="h-2.5 rounded-full bg-slate-300/60" style={{ width: `${85 - i * 8}%` }} />
              <div className="h-2.5 rounded-full bg-slate-300/40" style={{ width: `${55 - i * 5}%` }} />
            </div>
          </div>
        ))}
      </div>
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
  items, hasMore, loadingMore, onLoadMore, onRead, onOpen,
}: NotificationsSummaryCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || !hasMore || loadingMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) onLoadMore()
  }, [hasMore, loadingMore, onLoadMore])

  return (
    <div className="glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain divide-y divide-white/25"
      >
        {items.map(item => (
          <div key={item.id} className="flex items-start gap-1 pr-2 hover:bg-white/45 transition-colors">
            {/* Opening a decision on your own leave is the whole point of the
                row, so reading it clears it — here and on the application. An
                incoming request is not addressed just by being looked at; it
                clears when the decision is made. Opens the shared popup in
                place — never navigates away. */}
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="flex-1 min-w-0 flex items-start gap-2.5 pl-5 py-3 cursor-pointer text-left"
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
