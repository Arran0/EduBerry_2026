'use client'

import React from 'react'
import { CheckCircle2, XCircle, Inbox, X } from 'lucide-react'
import {
  fetchMyLeaveApplicationsPage,
  fetchApprovalQueueIds,
  fetchLeaveApplicationsByIdsPage,
  LEAVE_TYPE_LABELS,
  type LeaveApplicationWithDetails,
} from '@/lib/leave'
import { getDismissedNotifications } from '@/lib/notificationDismissals'

type Tone = 'approved' | 'rejected' | 'incoming'

export interface NotifItem {
  id: string
  /** The leave application this row is about — opens in the shared preview popup. */
  appId: string
  tone: Tone
  text: string
  /** Deep link into the full OD / Leave app, used by the popup's "View in
   *  OD / Leave Manager" button rather than for the row's own click. */
  href: string
  ts: number
}

const MAX_ITEMS = 5

/** Applications scanned per source when building the box. Only the newest few
 *  can ever fit in five rows, so there is no reason to pull the whole history. */
const SOURCE_LIMIT = 20

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase()
  return `${date}, ${time}`
}

function applicantLabel(app: LeaveApplicationWithDetails): string {
  const p = app.applicant
  if (!p) return 'a member'
  const name = p.full_name || 'a member'
  if (p.role === 'student' && p.grade != null) {
    return `${name}, Grade ${p.grade}${p.section ? ' ' + p.section : ''}`
  }
  return name
}

/** Deep-links straight to the application: student applicants open on the
 *  leave page, staff applicants open on the staff-leave page (both open it in
 *  a detail popup rather than loading the surrounding list). */
function leaveHref(isStudentApplicant: boolean, appId: string): string {
  return isStudentApplicant ? `/more/leave?openApp=${appId}` : `/more/staff-leave?app=${appId}`
}

/** Own decided applications → "X approved your leave on <when>." */
function ownDecisionItems(mode: 'student' | 'staff', apps: LeaveApplicationWithDetails[]): NotifItem[] {
  const items: NotifItem[] = []
  for (const app of apps) {
    for (const ap of app.approvals) {
      if ((ap.status !== 'approved' && ap.status !== 'rejected') || !ap.decided_at) continue
      const who = ap.approver?.full_name || 'A reviewer'
      const verb = ap.status === 'approved' ? 'approved' : 'rejected'
      items.push({
        id: ap.id,
        appId: app.id,
        tone: ap.status,
        text: `${who} ${verb} your ${LEAVE_TYPE_LABELS[app.leave_type]} on ${formatDateTime(ap.decided_at)}.`,
        href: leaveHref(mode === 'student', app.id),
        ts: new Date(ap.decided_at).getTime(),
      })
    }
  }
  return items
}

/** Pending applications awaiting this staffer → "New leave application from …". */
function incomingItems(apps: LeaveApplicationWithDetails[]): NotifItem[] {
  return apps.map(app => ({
    id: app.id,
    appId: app.id,
    tone: 'incoming' as Tone,
    text: `New leave application from ${applicantLabel(app)} on ${formatDateTime(app.created_at)}.`,
    href: leaveHref(app.applicant?.role === 'student', app.id),
    ts: new Date(app.created_at).getTime(),
  }))
}

/** Applications still awaiting this staffer's decision. Once they decide, the
 *  approval leaves the pending queue and the row disappears on its own. */
async function fetchIncoming(userId: string): Promise<LeaveApplicationWithDetails[]> {
  const { pendingIds } = await fetchApprovalQueueIds(userId)
  const { items } = await fetchLeaveApplicationsByIdsPage(pendingIds, 'any', { limit: SOURCE_LIMIT })
  return items
}

/**
 * Fetches and builds the (already sorted + capped to 5) notification
 * sentences for the home card, minus any the user has dismissed. Used by the
 * home page to decide whether the slot should render at all.
 */
export async function fetchNotificationItems(userId: string, mode: 'student' | 'staff'): Promise<NotifItem[]> {
  const mine = fetchMyLeaveApplicationsPage(userId, { limit: SOURCE_LIMIT })
    .then(({ items }) => ownDecisionItems(mode, items))

  const list = mode === 'staff'
    ? await Promise.all([fetchIncoming(userId), mine])
        .then(([incoming, own]) => [...incomingItems(incoming), ...own])
    : await mine

  const dismissed = getDismissedNotifications(userId)
  return list
    .filter(item => !dismissed.has(item.id))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_ITEMS)
}

export const TONE_ICON: Record<Tone, React.ReactNode> = {
  approved: <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />,
  rejected: <XCircle size={15} className="text-red-400 flex-shrink-0" />,
  incoming: <Inbox size={15} className="text-sky-500 flex-shrink-0" />,
}

interface NotificationsSummaryCardProps {
  items: NotifItem[]
  /** Clears a row once it has been addressed — opened, or dismissed outright. */
  onDismiss: (id: string) => void
  /** Opens the row's application in the shared preview popup, in place. */
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

/** Turns the user's leave notifications (the only More-Apps badge source) into
 *  plain-language sentences, one per row, sized to fit without scrolling. The
 *  outer SectionHeading already reads "Notifications" so rows skip repeating it. */
export default function NotificationsSummaryCard({ items, onDismiss, onOpen }: NotificationsSummaryCardProps) {
  return (
    <div className="glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      <div className="flex-1 divide-y divide-white/25">
        {items.map(item => (
          <div key={item.id} className="flex items-start gap-1 pr-2 hover:bg-white/45 transition-colors">
            {/* Opening a decision on your own leave is the whole point of the
                row, so reading it clears it. An incoming request is not
                addressed just by being looked at — it clears when the decision
                is made (the approval leaves the pending queue) or on the X.
                Opens the shared preview popup in place — never navigates away. */}
            <button
              type="button"
              onClick={() => { onOpen(item); if (item.tone !== 'incoming') onDismiss(item.id) }}
              className="flex-1 min-w-0 flex items-start gap-2.5 pl-5 py-3 cursor-pointer text-left"
            >
              <span className="mt-0.5">{TONE_ICON[item.tone]}</span>
              <p className="flex-1 min-w-0 text-[13px] leading-snug text-slate-600">{item.text}</p>
            </button>
            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              aria-label="Dismiss notification"
              title="Dismiss"
              className="mt-3 p-1 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-white/60 transition-colors flex-shrink-0"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
