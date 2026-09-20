'use client'

import { supabase } from '@/lib/supabase'

/**
 * Per-announcement read markers.
 *
 * The navbar badge has always tracked reading as a single localStorage
 * high-water mark ("everything before this moment has been seen"), which is
 * fine for a count but can't answer "which announcements has this user read?".
 * The home notifications box needs exactly that, on every device, so reads are
 * also written to `announcement_reads` (user_id, announcement_id).
 *
 * The two live side by side on purpose: the timestamp still floors the unread
 * set, so accounts that had already caught up under the old scheme don't open
 * to a box full of the school's back catalogue the day this ships.
 */

const READ_AT_PREFIX = 'announcements_read_at_'
const CHANGED_EVENT = 'eduberry:announcement-reads-changed'

export function announcementsReadAtKey(userId: string): string {
  return `${READ_AT_PREFIX}${userId}`
}

/**
 * The "everything before this was seen" mark, set on this device. Returns null
 * when the account has never opened the announcements page here.
 */
export function getAnnouncementsReadAt(userId: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(announcementsReadAtKey(userId))
  } catch {
    return null
  }
}

export function setAnnouncementsReadAt(userId: string, iso = new Date().toISOString()): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(announcementsReadAtKey(userId), iso)
  } catch {
    /* private mode / blocked storage — the DB markers still do their job */
  }
}

/** "This user has read something" — the home box re-pulls its list on this. */
export function emitAnnouncementReadsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
}

/** Subscribes `handler` to the change broadcast; returns the unsubscriber. */
export function onAnnouncementReadsChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGED_EVENT, handler)
  return () => window.removeEventListener(CHANGED_EVENT, handler)
}

/** Which of `announcementIds` this user has already read. */
export async function fetchReadAnnouncementIds(
  userId: string,
  announcementIds: string[],
): Promise<Set<string>> {
  if (announcementIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from('announcement_reads')
    .select('announcement_id')
    .eq('user_id', userId)
    .in('announcement_id', announcementIds)

  if (error) {
    console.warn('Could not load announcement read markers:', error.message)
    return new Set()
  }
  return new Set((data ?? []).map(r => r.announcement_id as string))
}

/**
 * Marks announcements read for this user. One upsert for the whole batch —
 * the announcements page marks a page of ten at a time, and a row per call
 * would be ten round trips for one scroll.
 *
 * Idempotent: re-reading an announcement keeps the original read_at (the
 * marker means "has read", so the first time is the true answer) and never
 * errors on the primary key.
 */
export async function markAnnouncementsRead(userId: string, announcementIds: string[]): Promise<void> {
  if (announcementIds.length === 0) return
  const rows = [...new Set(announcementIds)].map(announcement_id => ({ user_id: userId, announcement_id }))
  const { error } = await supabase
    .from('announcement_reads')
    .upsert(rows, { onConflict: 'user_id,announcement_id', ignoreDuplicates: true })

  if (error) {
    console.warn('Could not mark announcements read:', error.message)
    return
  }
  emitAnnouncementReadsChanged()
}
