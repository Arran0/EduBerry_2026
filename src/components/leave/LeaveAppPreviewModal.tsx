'use client'

import React from 'react'
import { CheckCircle2, XCircle, Inbox, CalendarDays, ExternalLink } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import LeaveApplicationCard from '@/components/leave/LeaveApplicationCard'
import { LeaveApplicationWithDetails } from '@/lib/leave'

/**
 * The approval this viewer still owes a decision on, if any — either named to
 * them directly or left open for whoever holds their role.
 */
function myPendingApproval(
  app: LeaveApplicationWithDetails,
  viewerUserId?: string,
  viewerRole?: string,
) {
  if (!viewerUserId) return null
  return app.approvals.find(a =>
    a.status === 'pending' &&
    (a.approver_id === viewerUserId || (!a.approver_id && !!viewerRole && a.approver_role === viewerRole))
  ) ?? null
}

export function canViewLeaveApp(
  app: LeaveApplicationWithDetails,
  viewerUserId?: string,
  viewerRole?: string,
): boolean {
  if (!viewerUserId || !viewerRole) return false
  if (viewerRole === 'admin' || viewerRole === 'principal') return true
  if (app.applicant_id === viewerUserId) return true
  return app.approvals.some(a =>
    a.approver_id === viewerUserId ||
    (!a.approver_id && a.approver_role === viewerRole)
  )
}

/** The decision this viewer is being told about, when the application is
 *  their own — what the popup's header reports back to them. */
function myLatestDecision(app: LeaveApplicationWithDetails, viewerUserId?: string) {
  if (!viewerUserId || app.applicant_id !== viewerUserId) return null
  return app.approvals
    .filter(a => (a.status === 'approved' || a.status === 'rejected') && a.decided_at)
    .sort((a, b) => new Date(b.decided_at!).getTime() - new Date(a.decided_at!).getTime())[0] ?? null
}

interface LeaveAppPreviewModalProps {
  application: LeaveApplicationWithDetails
  onClose: () => void
  viewerUserId?: string
  viewerRole?: string
  /**
   * Opens the full OD / Leave app on this application. Omit to hide the
   * button — which is what the applicant's own notifications do: a decision is
   * read here and finished with, not followed by a trip to another screen.
   */
  onViewFull?: (app: LeaveApplicationWithDetails) => void
  /**
   * Fires once the viewer approves or rejects from inside this popup. Passing
   * it is what turns the preview into a decision surface — without it the
   * popup stays read-only.
   */
  onDecided?: () => void
  /** Overlay stacking, for hosts that already own a popup layer. */
  zClass?: string
}

/**
 * One leave application on its own, opened from a notification.
 *
 * Same surface as the review queue the Staff Attendance app opens with
 * (`ReviewQueueModal`): the shared `ModalShell` sheet, and the application
 * rendered by `LeaveApplicationCard` — so the reviewer's remarks box and
 * Approve / Reject buttons come with it, and a request that arrives as a
 * notification is answered where it lands rather than two screens away.
 * Shared by the calendar's leave-day dot, the updates popup, and the Home
 * page notification click, so all of them open the exact same card.
 */
export default function LeaveAppPreviewModal({
  application, onClose, viewerUserId, viewerRole, onViewFull, onDecided, zClass = 'z-50',
}: LeaveAppPreviewModalProps) {
  const pendingMine = onDecided ? myPendingApproval(application, viewerUserId, viewerRole) : null
  const decision = myLatestDecision(application, viewerUserId)

  const header = pendingMine
    ? {
        title: 'Application to review',
        subtitle: 'Awaiting your decision',
        icon: <Inbox size={16} />,
        iconClassName: 'bg-violet-100 text-violet-600',
      }
    : decision
      ? {
          title: decision.status === 'approved' ? 'Application approved' : 'Application rejected',
          subtitle: `${decision.approver?.full_name ?? 'A reviewer'} decided on your OD / Leave application`,
          icon: decision.status === 'approved' ? <CheckCircle2 size={16} /> : <XCircle size={16} />,
          iconClassName: decision.status === 'approved'
            ? 'bg-emerald-100 text-emerald-600'
            : 'bg-rose-100 text-rose-600',
        }
      : {
          title: 'Leave application',
          subtitle: 'OD / Leave details',
          icon: <CalendarDays size={16} />,
          iconClassName: 'bg-slate-100 text-slate-600',
        }

  const showViewFull = !!onViewFull && canViewLeaveApp(application, viewerUserId, viewerRole)

  return (
    <ModalShell
      onClose={onClose}
      size="lg"
      zClass={zClass}
      title={header.title}
      subtitle={header.subtitle}
      icon={header.icon}
      iconClassName={header.iconClassName}
      footer={showViewFull ? (
        <button
          onClick={() => onViewFull!(application)}
          className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors"
        >
          <ExternalLink size={13} />
          View in OD / Leave Manager
        </button>
      ) : undefined}
    >
      <LeaveApplicationCard
        application={application}
        currentUserId={viewerUserId ?? ''}
        currentUserRole={viewerRole ?? ''}
        isApprover={!!pendingMine}
        onStatusChange={() => { onDecided?.(); onClose() }}
      />
    </ModalShell>
  )
}
