'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const STUDENT_READ_KEY = 'leave_student_read_at_'
const STAFF_READ_KEY = 'leave_staff_read_at_'

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

/**
 * Notification count for the Student OD Leave Manager page (/more/leave).
 *
 * Students: pending own applications + unopened approved/rejected own applications.
 * Staff:    pending leave approvals where the applicant is a student.
 *
 * Call markAllRead() when the page is visited to clear the "unopened" tally.
 */
export function useStudentLeaveNotifications(userId: string | null, isStudent: boolean) {
  const [count, setCount] = useState(0)

  const fetchCount = useCallback(async () => {
    if (!userId) { setCount(0); return }

    if (isStudent) {
      const readAt =
        localStorage.getItem(`${STUDENT_READ_KEY}${userId}`) ?? new Date(0).toISOString()

      const [pendingResult, unopenedResult] = await Promise.all([
        supabase
          .from('leave_applications')
          .select('id', { count: 'exact', head: true })
          .eq('applicant_id', userId)
          .eq('status', 'pending'),
        supabase
          .from('leave_applications')
          .select('id', { count: 'exact', head: true })
          .eq('applicant_id', userId)
          .in('status', ['approved', 'rejected'])
          .gt('updated_at', readAt),
      ])
      setCount((pendingResult.count ?? 0) + (unopenedResult.count ?? 0))
    } else {
      const pending = await countPendingApprovalsByApplicantRole(userId, true)
      setCount(pending)
    }
  }, [userId, isStudent])

  useEffect(() => { fetchCount() }, [fetchCount])

  const markAllRead = useCallback(() => {
    if (!userId || !isStudent) return
    localStorage.setItem(`${STUDENT_READ_KEY}${userId}`, new Date().toISOString())
    fetchCount()
  }, [userId, isStudent, fetchCount])

  return { count, markAllRead, refresh: fetchCount }
}

/**
 * Notification count for the Staff OD/Leave Manager page (/more/staff-leave).
 *
 * Count: own pending applications + unopened own approved/rejected applications
 *        + pending leave approvals where the applicant is a staff member.
 *
 * Call markAllRead() when the page is visited to clear the "unopened own results" tally.
 */
export function useStaffLeaveNotifications(userId: string | null) {
  const [count, setCount] = useState(0)

  const fetchCount = useCallback(async () => {
    if (!userId) { setCount(0); return }

    const readAt =
      localStorage.getItem(`${STAFF_READ_KEY}${userId}`) ?? new Date(0).toISOString()

    const [ownPendingResult, ownUnopenedResult, staffApprovals] = await Promise.all([
      supabase
        .from('leave_applications')
        .select('id', { count: 'exact', head: true })
        .eq('applicant_id', userId)
        .eq('status', 'pending'),
      supabase
        .from('leave_applications')
        .select('id', { count: 'exact', head: true })
        .eq('applicant_id', userId)
        .in('status', ['approved', 'rejected'])
        .gt('updated_at', readAt),
      countPendingApprovalsByApplicantRole(userId, false),
    ])

    setCount(
      (ownPendingResult.count ?? 0) +
      (ownUnopenedResult.count ?? 0) +
      staffApprovals,
    )
  }, [userId])

  useEffect(() => { fetchCount() }, [fetchCount])

  const markAllRead = useCallback(() => {
    if (!userId) return
    localStorage.setItem(`${STAFF_READ_KEY}${userId}`, new Date().toISOString())
    fetchCount()
  }, [userId, fetchCount])

  return { count, markAllRead, refresh: fetchCount }
}
