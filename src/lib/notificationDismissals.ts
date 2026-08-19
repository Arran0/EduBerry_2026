'use client'

/**
 * Per-user record of home notifications the user has already dealt with.
 *
 * A notification row is derived state — it exists for as long as the leave
 * approval behind it exists — so "I've seen this, clear it" has to be stored
 * on the side. Kept in localStorage next to the other leave read-markers
 * (see useLeaveNotifications), keyed by the approval / application id the row
 * was built from.
 */

const STORAGE_KEY_PREFIX = 'home_notifications_dismissed_'

/** Cap on remembered ids — oldest dismissals fall off first so the entry
 *  cannot grow without bound on a long-lived account. */
const MAX_REMEMBERED = 500

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`
}

function read(userId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function write(userId: string, ids: string[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(ids.slice(-MAX_REMEMBERED)))
  } catch {
    // Storage full or unavailable — dismissals are a convenience, not a correctness concern.
  }
}

export function getDismissedNotifications(userId: string): Set<string> {
  return new Set(read(userId))
}

/**
 * Marks notification rows as addressed. Already-remembered ids keep their
 * place in the list rather than being re-appended: re-writing them on every
 * visit would keep shuffling them past ids from other categories and, once the
 * cap is reached, evict markers the user had already cleared — which is how a
 * dismissed forgotten-checkout warning could come back.
 */
export function dismissNotifications(userId: string, ids: string[]): void {
  if (ids.length === 0) return
  const existing = read(userId)
  const known = new Set(existing)
  const fresh = ids.filter(id => !known.has(id))
  if (fresh.length === 0) return
  write(userId, [...existing, ...new Set(fresh)])
}

export function clearDismissedNotifications(userId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKey(userId))
  } catch {
    // ignore
  }
}
