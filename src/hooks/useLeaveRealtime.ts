'use client'

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

/** What just happened to one of this user's OD / Leave applications. */
export interface LeaveRealtimeEvent {
  kind: 'incoming' | 'decided'
  applicationId: string
}

/**
 * Live OD / Leave events for one user, straight from Postgres.
 *
 * Two subscriptions, one per direction of an application:
 *
 *  • `leave_approvals` INSERT where this user is the named approver — someone
 *    has just asked them to review something.
 *  • `leave_applications` UPDATE where this user is the applicant — the row is
 *    touched by `sync_leave_application_status` on every decision, so this
 *    fires whether or not the decision changed the overall status (which it
 *    does not, when other reviewers are still to answer).
 *
 * Requires the two tables to be in the `supabase_realtime` publication — see
 * supabase-migrations/add_leave_realtime.sql. Without it this hook simply
 * never fires and everything falls back to fetch-on-load.
 */
export function useLeaveRealtime(
  userId: string | null,
  onEvent: (event: LeaveRealtimeEvent) => void,
): void {
  // Kept in a ref so a caller that rebuilds its handler every render doesn't
  // tear the subscription down and put it back up again with it.
  const handler = useRef(onEvent)
  useEffect(() => { handler.current = onEvent }, [onEvent])

  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`leave_notifications_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'leave_approvals',
          filter: `approver_id=eq.${userId}`,
        },
        payload => {
          const row = payload.new as { leave_application_id?: string; status?: string }
          if (!row?.leave_application_id || row.status !== 'pending') return
          handler.current({ kind: 'incoming', applicationId: row.leave_application_id })
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'leave_applications',
          filter: `applicant_id=eq.${userId}`,
        },
        payload => {
          const row = payload.new as { id?: string }
          if (!row?.id) return
          handler.current({ kind: 'decided', applicationId: row.id })
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])
}
