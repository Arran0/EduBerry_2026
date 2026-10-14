'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const STORAGE_KEY_PREFIX = 'tasks_notifications_read_at_'

// A user who has never opened the Task Manager has no stored read-at marker. Reading
// that as "everything since 1970" made the badge count the entire comment history, so
// the one query this hook runs degraded into a full scan for exactly the people whose
// first visit it was — the worst case landing on the busiest morning. Nobody acts on a
// month-old unread badge, so the window is capped.
const MAX_LOOKBACK_DAYS = 30

// Navbar (in ProtectedLayout) and BottomNav (in the root layout) are mounted at the
// same time, and both call this hook — so every page used to fire the badge query
// twice. They ask the identical question, so the first caller's promise is shared with
// anyone who asks again within TTL. At the 08:45 peak this halves the badge traffic
// before a single query runs.
const INFLIGHT_TTL_MS = 30_000
let inflight: { key: string; at: number; promise: Promise<number> } | null = null

function countUnread(userId: string, since: string): Promise<number> {
  const key = `${userId}|${since}`
  const now = Date.now()
  if (inflight && inflight.key === key && now - inflight.at < INFLIGHT_TTL_MS) {
    return inflight.promise
  }

  // The query builder is thenable rather than a real Promise, so it is wrapped before
  // being cached and shared between the two nav mounts.
  const promise = (async () => {
    try {
      const { data, error } = await supabase
        .rpc('task_unread_comment_count', { p_since: since })
      // A failed count must not clear a badge the user can still act on, so errors
      // propagate and the caller keeps whatever it last displayed.
      if (error) throw error
      return (data as number | null) ?? 0
    } catch (err) {
      // Let the next mount retry rather than serving a poisoned promise for the
      // rest of the TTL.
      if (inflight?.key === key) inflight = null
      throw err
    }
  })()

  inflight = { key, at: now, promise }
  return promise
}

export function useTaskNotifications(userId: string | null) {
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchUnreadCount = useCallback(async () => {
    if (!userId) { setUnreadCount(0); return }

    const storageKey = `${STORAGE_KEY_PREFIX}${userId}`
    const floor = new Date(Date.now() - MAX_LOOKBACK_DAYS * 86_400_000)
    const stored = localStorage.getItem(storageKey)
    const readAt = stored && new Date(stored) > floor ? stored : floor.toISOString()

    try {
      setUnreadCount(await countUnread(userId, readAt))
    } catch {
      // Keep the previous badge rather than showing a confident zero.
    }
  }, [userId])

  useEffect(() => { fetchUnreadCount() }, [fetchUnreadCount])

  const markAllRead = useCallback(() => {
    if (!userId) return
    const storageKey = `${STORAGE_KEY_PREFIX}${userId}`
    localStorage.setItem(storageKey, new Date().toISOString())
    // The cached promise answers the old question; drop it so the other nav's next
    // read reflects the mark-as-read instead of re-showing the count.
    inflight = null
    setUnreadCount(0)
  }, [userId])

  return { unreadCount, markAllRead, refresh: fetchUnreadCount }
}
