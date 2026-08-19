'use client'

import React, { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { useLeaveRealtime, type LeaveRealtimeEvent } from '@/hooks/useLeaveRealtime'
import { fetchLeaveApplicationById } from '@/lib/leave'
import { liveNotifItem, emitLeaveNotificationsChanged, type NotifItem } from '@/lib/leaveNotifications'
import { showLocalNotification } from '@/lib/push'
import NotificationToastStack, { type ToastItem } from './NotificationToast'

/** Most toasts on screen at once — past three the stack is noise, not news. */
const MAX_TOASTS = 3

const TITLE: Record<'incoming' | 'decided', string> = {
  incoming: 'New OD / Leave application',
  decided: 'OD / Leave update',
}

/**
 * The notification tag this event's push would carry (see
 * src/app/api/leave/notify). Matching it means that when a device is both open
 * and subscribed, the local notification and the pushed one collapse into a
 * single entry instead of showing the same thing twice.
 */
function notificationTag(kind: 'incoming' | 'decided', applicationId: string): string {
  return `leave-${kind === 'incoming' ? 'submitted' : 'decided'}-${applicationId}`
}

/**
 * The app-wide live half of the OD / Leave notifications.
 *
 * The notification box on Home is the record of what is unread; this is what
 * happens the moment something arrives while the app is open — the same event
 * the push notification carries to a closed app, delivered three ways:
 *
 *  1. an in-app toast, wherever in the app the user currently is;
 *  2. a browser/OS notification when the tab is out of sight and permission
 *     has been granted (the push service is not involved — the page posts it
 *     directly, so it works even on a device that never enabled push);
 *  3. a broadcast that makes the notification box and every badge refetch,
 *     so the counts are right without a reload.
 *
 * Mounted once in ProtectedLayout, outside the remounting page content.
 */
export default function LeaveNotificationsListener() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // Href per toast id, so tapping one lands on the right application.
  const [hrefs, setHrefs] = useState<Record<string, string>>({})

  const mode = profile && isStaffRole(profile.role) ? 'staff' : 'student'

  const handleEvent = useCallback(async (event: LeaveRealtimeEvent) => {
    // The counts move whether or not this event turns out to be worth a toast
    // (a decision by a second reviewer, say), so refresh them either way.
    emitLeaveNotificationsChanged()

    const app = await fetchLeaveApplicationById(event.applicationId)
    if (!app) return

    const item: NotifItem | null = liveNotifItem(app, event.kind, mode)
    if (!item) return

    // A decision this user made themselves is not news to them — only the
    // applicant hears about it, and only a reviewer hears about a submission.
    if (event.kind === 'decided' && app.applicant_id !== user?.id) return

    const title = TITLE[event.kind]
    setToasts(prev => [
      { id: item.id, tone: item.tone, title, text: item.text },
      ...prev.filter(t => t.id !== item.id),
    ].slice(0, MAX_TOASTS))
    setHrefs(prev => ({ ...prev, [item.id]: item.href }))

    // The same words as the toast, as a real notification — but only when the
    // page is out of sight. In front of the user the toast already says it,
    // and a system notification on top of it is the same news twice.
    if (document.visibilityState !== 'visible') {
      showLocalNotification(title, item.text, item.href, notificationTag(event.kind, app.id))
    }
  }, [mode, user?.id])

  useLeaveRealtime(user?.id ?? null, handleEvent)

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const open = useCallback((toast: ToastItem) => {
    const href = hrefs[toast.id]
    dismiss(toast.id)
    if (href) router.push(href)
  }, [hrefs, dismiss, router])

  if (!user) return null

  return <NotificationToastStack items={toasts} onOpen={open} onDismiss={dismiss} />
}
