'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchUnreadDecisionItems } from '@/lib/leaveNotifications'

/** Cap on decisions counted for a badge — past this it reads "9+" anyway. */
const DECISION_COUNT_LIMIT = 50

// Count pending leave_approvals for this user where the applicant has the given role.
// Uses a 3-step query to join leave_approvals → leave_applications → profiles.
async function countPendingApprovalsByApplicantRole(
  userId: string,
  applicantIsStudent: boolean,
): Promise<number> {
  const { data: approvals } = await supabase
    .from('leave_approvals')
    .select('leave_application_id')
    .eq('approver_id', userId)
    .eq('status', 'pending')

  if (!approvals || approvals.length === 0) return 0

  const appIds = approvals.map(a => a.leave_application_id)

  const { data: apps } = await supabase
    .from('leave_applications')
    .select('applicant_id')
    .in('id', appIds)

  if (!apps || apps.length === 0) return 0

  const applicantIds = [...new Set(apps.map(a => a.applicant_id))]

  const query = supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .in('id', applicantIds)

  const { count } = applicantIsStudent
    ? await query.eq('role', 'student')
    : await query.neq('role', 'student')

  return count ?? 0
}

/** Decisions on the user's own applications they have not read yet — the same
 *  rows the notification box lists, so badge and box can never disagree. */
async function countUnreadDecisions(userId: string, mode: 'student' | 'staff'): Promise<number> {
  const items = await fetchUnreadDecisionItems(userId, mode, DECISION_COUNT_LIMIT)
  return items.length
}

/**
 * Badge count for the Student OD Leave Manager page (/more/leave).
 *
 * Students: unread decisions on their own applications.
 * Staff:    leave approvals still pending their decision, where the applicant
 *           is a student — pending means unread, so these clear only by being
 *           approved or rejected.
 */
export function useStudentLeaveNotifications(userId: string | null, isStudent: boolean) {
  const [count, setCount] = useState(0)

  const fetchCount = useCallback(async () => {
    if (!userId) { setCount(0); return }
    setCount(isStudent
      ? await countUnreadDecisions(userId, 'student')
      : await countPendingApprovalsByApplicantRole(userId, true))
  }, [userId, isStudent])

  useEffect(() => { fetchCount() }, [fetchCount])

  return { count, refresh: fetchCount }
}

/**
 * Badge count for the Staff OD/Leave Manager (page and popup).
 *
 * Unread decisions on the user's own applications, plus the applications
 * still waiting on their own decision.
 *
 * Nothing here is cleared by visiting a page: a decision is read when the
 * applicant opens it (which writes the application's view row — see
 * `markNotificationRead`), and an application waiting on this user is read
 * only by being approved or rejected.
 */
export function useStaffLeaveNotifications(userId: string | null) {
  const [count, setCount] = useState(0)

  const fetchCount = useCallback(async () => {
    if (!userId) { setCount(0); return }
    const [unreadDecisions, staffApprovals] = await Promise.all([
      countUnreadDecisions(userId, 'staff'),
      countPendingApprovalsByApplicantRole(userId, false),
    ])
    setCount(unreadDecisions + staffApprovals)
  }, [userId])

  useEffect(() => { fetchCount() }, [fetchCount])

  return { count, refresh: fetchCount }
}
