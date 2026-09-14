'use client'

import { useState, useEffect, useCallback } from 'react'
import { countUnreadAnnouncements } from '@/lib/announcements'
import { getAnnouncementsReadAt, setAnnouncementsReadAt } from '@/lib/announcementReads'
import { UserRole } from '@/lib/supabase'

/**
 * Unread announcement count for the navbar badge.
 *
 * Read state lives in localStorage as a high-water mark, matching the task and
 * leave badges (see useTaskNotifications) — a per-device "everything before
 * this moment has been seen" timestamp. The home notifications box needs finer
 * grain than a badge count does and keeps per-row markers in
 * `announcement_reads`; the two share this timestamp (see lib/announcementReads),
 * which is also the floor under the box's unread list, so both agree about what
 * an account had already caught up on before those markers existed.
 */

export function useAnnouncementNotifications(
  userId: string | null,
  userRole: UserRole | null,
  userGrade?: number,
  userSection?: string,
) {
  const [unreadCount, setUnreadCount] = useState(0)

  const refresh = useCallback(async () => {
    if (!userId || !userRole) { setUnreadCount(0); return }

    // First visit: treat everything already posted as seen, so a new account
    // doesn't open to a badge counting the school's entire history.
    let readAt = getAnnouncementsReadAt(userId)
    if (!readAt) {
      readAt = new Date().toISOString()
      setAnnouncementsReadAt(userId, readAt)
    }

    try {
      setUnreadCount(
        await countUnreadAnnouncements(userId, userRole, readAt, userGrade, userSection)
      )
    } catch {
      setUnreadCount(0)
    }
  }, [userId, userRole, userGrade, userSection])

  useEffect(() => { refresh() }, [refresh])

  const markAllRead = useCallback(() => {
    if (!userId) return
    setAnnouncementsReadAt(userId)
    setUnreadCount(0)
  }, [userId])

  return { unreadCount, markAllRead, refresh }
}
