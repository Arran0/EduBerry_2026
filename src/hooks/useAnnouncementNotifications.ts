'use client'

import { useState, useEffect, useCallback } from 'react'
import { countUnreadAnnouncements } from '@/lib/announcements'

/**
 * Unread announcement count for the navbar badge.
 *
 * Read state lives in localStorage as a high-water mark, matching the task and
 * leave badges (see useTaskNotifications) — a per-device "everything before
 * this moment has been seen" timestamp rather than a per-row read table.
 */
const STORAGE_KEY_PREFIX = 'announcements_read_at_'

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`
}

/**
 * Which announcements count as "aimed at this user" is decided by RLS on the
 * server, so the caller only needs to say who is asking.
 */
export function useAnnouncementNotifications(userId: string | null) {
  const [unreadCount, setUnreadCount] = useState(0)

  const refresh = useCallback(async () => {
    if (!userId) { setUnreadCount(0); return }

    // First visit: treat everything already posted as seen, so a new account
    // doesn't open to a badge counting the school's entire history.
    let readAt = localStorage.getItem(storageKey(userId))
    if (!readAt) {
      readAt = new Date().toISOString()
      localStorage.setItem(storageKey(userId), readAt)
    }

    try {
      setUnreadCount(await countUnreadAnnouncements(readAt))
    } catch {
      setUnreadCount(0)
    }
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  const markAllRead = useCallback(() => {
    if (!userId) return
    localStorage.setItem(storageKey(userId), new Date().toISOString())
    setUnreadCount(0)
  }, [userId])

  return { unreadCount, markAllRead, refresh }
}
