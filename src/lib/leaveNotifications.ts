'use client'

/**
 * The OD / Leave notification feed behind the Home notification box and the
 * Staff Attendance popups.
 *
 * ── What counts as read ──────────────────────────────────────────────────────
 * A notification is a view of an application, so "read" means something
 * different on each side of it:
 *
 *  • Reviewer — an application waiting on their decision is unread until they
 *    actually decide it. Looking at it is not deciding it, so nothing here can
 *    mark it read; it leaves the feed on its own once the approval is no longer
 *    pending (`fetchApprovalQueueIds` stops returning it).
 *
 *  • Applicant — a decision on their own application is unread until they have
 *    seen it: opening the notification, or opening the application itself
 *    anywhere in the OD / Leave app. The second half is why the read test also
 *    consults the application's `leave_application_views` row — that marker is
 *    written by `LeaveApplicationCard` whenever a card is opened, so reading an
 *    application in the workspace clears its notification too, on any device.
 *
 * `markNotificationRead` writes both halves: the local marker (instant, and the
 * only thing the Home box can key off) and the application view row.
 */

import {
  fetchMyLeaveApplicationsPage,
  fetchApprovalQueueIds,
  fetchLeaveApplicationsByIdsPage,
  markLeaveApplicationViewed,
  LEAVE_TYPE_LABELS,
  type LeaveApplicationWithDetails,
} from '@/lib/leave'
import { dismissNotifications, getDismissedNotifications } from '@/lib/notificationDismissals'

export type NotifTone = 'approved' | 'rejected' | 'incoming'

export interface NotifItem {
  id: string
  /** The leave application this row is about — opens in the shared popup. */
  appId: string
  tone: NotifTone
  text: string
  /** Deep link into the full OD / Leave app. Only reviewers are offered it:
   *  an applicant reads the decision in the popup and is done. */
  href: string
  ts: number
}

/** Rows revealed per step in the notification box, and per fetched page. */
export const NOTIF_PAGE_SIZE = 10

export type NotifMode = 'student' | 'staff'

/** A decision the applicant has yet to see — the only kind of notification
 *  that can be marked read from the notification surfaces. */
export function isApplicantDecision(item: NotifItem): boolean {
  return item.tone !== 'incoming'
}

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

/** Has the applicant already looked at this application since the decision
 *  landed? Opening any card writes the view row, so this is what makes
 *  "opened it in the OD / Leave app" count as reading the notification. */
function viewedSinceDecision(
  app: LeaveApplicationWithDetails,
  decidedAt: string,
): boolean {
  const view = app.views?.find(v => v.user_id === app.applicant_id)
  if (!view) return false
  return new Date(view.viewed_at).getTime() >= new Date(decidedAt).getTime()
}

/**
 * Own decided applications → "X approved your leave on <when>.", minus the
 * ones already read (locally dismissed, or opened since the decision).
 */
function unreadDecisionItems(
  mode: NotifMode,
  apps: LeaveApplicationWithDetails[],
  dismissed: Set<string>,
): NotifItem[] {
  const items: NotifItem[] = []
  for (const app of apps) {
    for (const ap of app.approvals) {
      if ((ap.status !== 'approved' && ap.status !== 'rejected') || !ap.decided_at) continue
      if (dismissed.has(ap.id) || viewedSinceDecision(app, ap.decided_at)) continue
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

/**
 * Pending applications awaiting this reviewer → "New leave application from …".
 * Never filtered against the read markers: a pending application stays unread
 * for its reviewer until they approve or reject it.
 */
function incomingItems(apps: LeaveApplicationWithDetails[]): NotifItem[] {
  return apps.map(app => ({
    id: app.id,
    appId: app.id,
    tone: 'incoming' as NotifTone,
    text: `New leave application from ${applicantLabel(app)} on ${formatDateTime(app.created_at)}.`,
    href: leaveHref(app.applicant?.role === 'student', app.id),
    ts: new Date(app.created_at).getTime(),
  }))
}

/**
 * Marks a notification read on the applicant's side — both the local marker
 * the notification box filters on and the application's own view row, so the
 * application no longer reads as unread inside the OD / Leave app either.
 *
 * A reviewer's pending row is not markable: it clears by being decided.
 */
export function markNotificationRead(userId: string, item: NotifItem): void {
  if (!isApplicantDecision(item)) return
  dismissNotifications(userId, [item.id])
  markLeaveApplicationViewed(item.appId)
}

/** Batch form of `markNotificationRead`, for "mark all as read". */
export function markNotificationsRead(userId: string, items: NotifItem[]): void {
  const decisions = items.filter(isApplicantDecision)
  if (decisions.length === 0) return
  dismissNotifications(userId, decisions.map(i => i.id))
  for (const appId of new Set(decisions.map(i => i.appId))) markLeaveApplicationViewed(appId)
}

// ============================================
// Paged feed
// ============================================

/**
 * How deep a source is willing to dig before calling itself exhausted.
 *
 * Read rows are dropped as pages arrive, so an account with a long, fully-read
 * leave history would otherwise page through all of it to prove there is
 * nothing unread left. Ten pages of ten is far past what any notification box
 * shows; anything older than that is stale news, reachable in the OD / Leave
 * app itself.
 */
const MAX_SOURCE_PAGES = 10

/** One source of rows, drained a page at a time, newest first. */
interface Source {
  done: boolean
  page: () => Promise<NotifItem[]>
}

function ownSource(userId: string, mode: NotifMode, maxPages = MAX_SOURCE_PAGES): Source {
  let offset = 0
  let pages = 0
  const source: Source = {
    done: false,
    page: async () => {
      pages += 1
      // No status filter: with several approvers an application stays
      // `pending` while one of them has already decided, and that decision is
      // exactly what the applicant needs to be told about.
      const { items, hasMore } = await fetchMyLeaveApplicationsPage(userId, {
        offset,
        limit: NOTIF_PAGE_SIZE,
      })
      offset += items.length
      source.done = !hasMore || pages >= maxPages
      return unreadDecisionItems(mode, items, getDismissedNotifications(userId))
    },
  }
  return source
}

function incomingSource(userId: string, maxPages = MAX_SOURCE_PAGES): Source {
  let offset = 0
  let pages = 0
  let pendingIds: string[] | null = null
  const source: Source = {
    done: false,
    page: async () => {
      pages += 1
      if (pendingIds === null) pendingIds = (await fetchApprovalQueueIds(userId)).pendingIds
      if (pendingIds.length === 0) { source.done = true; return [] }
      const { items, hasMore } = await fetchLeaveApplicationsByIdsPage(pendingIds, 'any', {
        offset,
        limit: NOTIF_PAGE_SIZE,
      })
      offset += items.length
      source.done = !hasMore || pages >= maxPages
      return incomingItems(items)
    },
  }
  return source
}

export interface NotifPage {
  items: NotifItem[]
  hasMore: boolean
}

export interface NotificationFeed {
  /** The next `size` unread notifications, newest first. */
  next: (size?: number) => Promise<NotifPage>
}

/**
 * Opens a feed over this user's unread OD / Leave notifications.
 *
 * Both sources are pulled a page at a time and merged newest-first, so the
 * notification box only ever loads the rows it is about to show — the whole
 * leave history is never fetched to fill a ten-row list. Read rows are dropped
 * as each page arrives, so a page that is entirely read pulls the next one
 * rather than handing back a short list.
 */
export function createNotificationFeed(userId: string, mode: NotifMode): NotificationFeed {
  const sources: Source[] = mode === 'staff'
    ? [ownSource(userId, mode), incomingSource(userId)]
    : [ownSource(userId, mode)]

  let buffer: NotifItem[] = []

  return {
    next: async (size = NOTIF_PAGE_SIZE) => {
      while (buffer.length < size && sources.some(s => !s.done)) {
        const pages = await Promise.all(sources.filter(s => !s.done).map(s => s.page()))
        buffer.push(...pages.flat())
        buffer.sort((a, b) => b.ts - a.ts)
      }
      const items = buffer.slice(0, size)
      buffer = buffer.slice(size)
      return { items, hasMore: buffer.length > 0 || sources.some(s => !s.done) }
    },
  }
}

/**
 * The first page of the feed — what the Home page uses to decide whether the
 * notifications slot renders at all.
 */
export async function fetchNotificationItems(
  userId: string,
  mode: NotifMode,
  size = NOTIF_PAGE_SIZE,
): Promise<NotifItem[]> {
  const { items } = await createNotificationFeed(userId, mode).next(size)
  return items
}

/**
 * Just the applicant's unread decisions — the "your application was
 * approved / rejected" popup shown on entering the Staff Attendance app.
 * Capped: the popup is a heads-up, not an archive.
 */
export async function fetchUnreadDecisionItems(
  userId: string,
  mode: NotifMode,
  limit = 20,
): Promise<NotifItem[]> {
  const source = ownSource(userId, mode)
  // (bounded by MAX_SOURCE_PAGES — see ownSource)
  const items: NotifItem[] = []
  while (items.length < limit && !source.done) items.push(...await source.page())
  return items.sort((a, b) => b.ts - a.ts).slice(0, limit)
}
