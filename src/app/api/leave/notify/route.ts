import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, callerUserId } from '@/lib/serverAuth'
import { pushConfigured, sendPushToUsers } from '@/lib/notifications/push'

/**
 * Send the Web Push notification for an OD / Leave event — the push half of
 * the same two notifications the Home notification box lists:
 *
 *  • `submitted` → every reviewer the application is now waiting on.
 *  • `decided`   → the applicant, once a reviewer approves or rejects.
 *
 * Called by the browser right after the application (or the decision) lands,
 * the same way announcements notify. Runs with the service role because it has
 * to read profiles and subscriptions across users — so it re-checks that the
 * caller is actually a party to this application first, and it never accepts a
 * recipient list from the client: recipients are derived from the application.
 */

const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: 'Casual Leave',
  medical: 'Medical Leave',
  on_duty: 'On Duty',
  half_day: 'Half Day',
  late: 'Late Permit',
}

type LeaveEvent = 'submitted' | 'decided'

interface ApprovalRow {
  id: string
  approver_id: string | null
  approver_role: string | null
  status: string
}

/** Deep link into the app — the same targets the notification box uses. */
function leaveHref(applicantIsStudent: boolean, applicationId: string): string {
  return applicantIsStudent
    ? `/more/leave?openApp=${applicationId}`
    : `/more/staff-leave?app=${applicationId}`
}

/**
 * Who a pending approval is addressed to. An approval names either one
 * reviewer or a role that anyone holding it may answer — the second kind is
 * resolved here so a role-addressed request still reaches someone.
 */
async function resolveApprovers(
  client: SupabaseClient,
  approvals: ApprovalRow[],
): Promise<Set<string>> {
  const recipients = new Set<string>()
  const roles = new Set<string>()

  for (const a of approvals) {
    if (a.approver_id) recipients.add(a.approver_id)
    else if (a.approver_role) roles.add(a.approver_role)
  }

  if (roles.size > 0) {
    const { data } = await client
      .from('profiles')
      .select('id')
      .in('role', [...roles])
      .neq('is_banned', true)
    ;(data ?? []).forEach(r => recipients.add(r.id))
  }

  return recipients
}

export async function POST(request: NextRequest) {

  const client = adminClient()
  if (!client) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 })
  }

  const callerId = await callerUserId(client, request)
  if (!callerId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const applicationId = body?.applicationId
  const event: LeaveEvent = body?.event === 'decided' ? 'decided' : 'submitted'
  const approvalId = typeof body?.approvalId === 'string' ? body.approvalId : null

  if (typeof applicationId !== 'string' || !applicationId) {
    return NextResponse.json({ success: false, error: 'Missing applicationId' }, { status: 400 })
  }

  const { data: application } = await client
    .from('leave_applications')
    .select('id, applicant_id, leave_type, start_date, end_date, status')
    .eq('id', applicationId)
    .single()

  if (!application) {
    return NextResponse.json({ success: false, error: 'Application not found' }, { status: 404 })
  }

  const { data: approvals } = await client
    .from('leave_approvals')
    .select('id, approver_id, approver_role, status')
    .eq('leave_application_id', applicationId)

  const allApprovals = (approvals ?? []) as ApprovalRow[]

  // ── Authorise ──
  // Submitting notifies on the applicant's behalf; deciding notifies on the
  // reviewer's. Anyone else is not a party to this application and gets
  // nothing — this route cannot be used to push arbitrary messages at people.
  const isApplicant = application.applicant_id === callerId
  const decidedApproval = approvalId ? allApprovals.find(a => a.id === approvalId) : null
  const isDecidingReviewer = !!decidedApproval && decidedApproval.approver_id === callerId

  if (event === 'submitted' ? !isApplicant : !isDecidingReviewer) {
    return NextResponse.json({ success: false, error: 'Not a party to this application' }, { status: 403 })
  }

  // Push is optional infrastructure — without keys the application itself is
  // still fine, so report the skip rather than failing the caller.
  if (!pushConfigured()) {
    return NextResponse.json({ success: true, sent: 0, skipped: 'VAPID keys not configured' })
  }

  const { data: applicant } = await client
    .from('profiles')
    .select('full_name, role, grade, section')
    .eq('id', application.applicant_id)
    .single()

  const applicantIsStudent = applicant?.role === 'student'
  const typeLabel = LEAVE_TYPE_LABELS[application.leave_type] ?? 'Leave'
  const url = leaveHref(applicantIsStudent, application.id)

  let recipients: Set<string>
  let title: string
  let bodyText: string

  if (event === 'submitted') {
    // Only the reviewers still owed a decision — someone who has already
    // answered doesn't need telling again.
    recipients = await resolveApprovers(client, allApprovals.filter(a => a.status === 'pending'))
    const who = applicant?.full_name || 'A member'
    const gradeSuffix = applicantIsStudent && applicant?.grade != null
      ? `, Grade ${applicant.grade}${applicant.section ? ' ' + applicant.section : ''}`
      : ''
    title = 'New OD / Leave application'
    bodyText = `${who}${gradeSuffix} applied for ${typeLabel} (${application.start_date}` +
      `${application.end_date !== application.start_date ? ` – ${application.end_date}` : ''}).`
  } else {
    recipients = new Set([application.applicant_id])
    const { data: reviewer } = await client
      .from('profiles')
      .select('full_name')
      .eq('id', callerId)
      .single()
    const verb = decidedApproval!.status === 'approved' ? 'approved' : 'rejected'
    title = `OD / Leave ${verb}`
    bodyText = `${reviewer?.full_name || 'A reviewer'} ${verb} your ${typeLabel} ` +
      `(${application.start_date}${application.end_date !== application.start_date ? ` – ${application.end_date}` : ''}).`
  }

  recipients.delete(callerId)   // never notify whoever caused the event

  if (recipients.size === 0) {
    return NextResponse.json({ success: true, sent: 0 })
  }

  const { sent, pruned } = await sendPushToUsers(client, [...recipients], {
    title,
    body: bodyText,
    url,
    // Same application + event replaces rather than stacks, so a double-tap on
    // Submit can never leave two identical notifications on the lock screen.
    tag: `leave-${event}-${application.id}`,
  })

  return NextResponse.json({ success: true, sent, pruned })
}
