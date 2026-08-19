'use client'

/**
 * "This user's OD / Leave notifications have changed" — a new application
 * landed, a decision arrived, or something was marked read.
 *
 * A plain window event rather than a context: the notification box, the
 * More-apps badges and the Staff Attendance badge all read the same feed but
 * sit in unrelated trees, and none of them owns the others. Anything that
 * shows a count subscribes; anything that changes one emits.
 *
 * Kept in its own module so `lib/leave.ts` can emit on a decision without
 * importing the notification feed that is itself built on `lib/leave.ts`.
 */

const CHANGED_EVENT = 'eduberry:leave-notifications-changed'

export function emitLeaveNotificationsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
}

/** Subscribes `handler` to the change broadcast; returns the unsubscriber. */
export function onLeaveNotificationsChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGED_EVENT, handler)
  return () => window.removeEventListener(CHANGED_EVENT, handler)
}
