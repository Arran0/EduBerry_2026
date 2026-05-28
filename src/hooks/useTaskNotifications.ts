'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const STORAGE_KEY_PREFIX = 'tasks_notifications_read_at_'

export function useTaskNotifications(userId: string | null) {
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchUnreadCount = useCallback(async () => {
    if (!userId) { setUnreadCount(0); return }

    const storageKey = `${STORAGE_KEY_PREFIX}${userId}`
    const readAt = localStorage.getItem(storageKey) ?? new Date(0).toISOString()

    const { data: assignments } = await supabase
      .from('task_assignees')
      .select('task_id')
      .eq('user_id', userId)

    if (!assignments || assignments.length === 0) { setUnreadCount(0); return }

    const taskIds = assignments.map(a => a.task_id)

    const { count } = await supabase
      .from('task_comments')
      .select('id', { count: 'exact', head: true })
      .in('task_id', taskIds)
      .neq('user_id', userId)
      .gt('created_at', readAt)

    setUnreadCount(count ?? 0)
  }, [userId])

  useEffect(() => { fetchUnreadCount() }, [fetchUnreadCount])

  const markAllRead = useCallback(() => {
    if (!userId) return
    const storageKey = `${STORAGE_KEY_PREFIX}${userId}`
    localStorage.setItem(storageKey, new Date().toISOString())
    setUnreadCount(0)
  }, [userId])

  return { unreadCount, markAllRead, refresh: fetchUnreadCount }
}
