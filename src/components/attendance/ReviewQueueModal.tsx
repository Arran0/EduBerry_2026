'use client'

import React, { useEffect, useState } from 'react'
import { Inbox, Loader2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import LeaveApplicationCard from '@/components/leave/LeaveApplicationCard'
import { fetchLeaveApplicationsByIdsPage, LeaveApplicationWithDetails } from '@/lib/leave'
import { dismissNotifications } from '@/lib/notificationDismissals'

/** Prefix for the "already surfaced this pending application once" marker —
 *  distinct from the Home card's dismissal ids so the two don't collide. */
function reviewSeenId(applicationId: string): string {
  return `review-seen-${applicationId}`
}

interface ReviewQueueModalProps {
  /** Application ids still pending this reviewer's decision (from
   *  `fetchApprovalQueueIds`, which resolves them from leave_approvals). */
  pendingIds: string[]
  currentUserId: string
  currentUserRole: string
  onClose: () => void
  /** Fires whenever a decision is made, so the caller can refresh badges/counts. */
  onDecided?: () => void
}

/**
 * Closable, scrollable queue of applications awaiting this reviewer's
 * decision. Each one renders with the existing `LeaveApplicationCard`, which
 * already has the full Approve/Reject + remarks flow built in — this is just
 * a focused place to work through several at once.
 */
export default function ReviewQueueModal({
  pendingIds, currentUserId, currentUserRole, onClose, onDecided,
}: ReviewQueueModalProps) {
  const [apps, setApps] = useState<LeaveApplicationWithDetails[] | null>(null)

  useEffect(() => {
    if (pendingIds.length === 0) { setApps([]); return }
    fetchLeaveApplicationsByIdsPage(pendingIds, 'any', { limit: pendingIds.length })
      .then(page => setApps(page.items))
    // Mark every id shown here as seen, so a still-undecided application
    // doesn't force this popup open again next visit — it stays reachable
    // through the regular Leave / OD manager instead.
    dismissNotifications(currentUserId, pendingIds.map(reviewSeenId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDecided = (id: string) => {
    setApps(prev => prev?.filter(a => a.id !== id) ?? prev)
    onDecided?.()
  }

  return (
    <ModalShell
      onClose={onClose}
      size="2xl"
      title="Applications to review"
      subtitle="New OD / Leave requests awaiting your decision"
      icon={<Inbox size={16} />}
      iconClassName="bg-violet-100 text-violet-600"
    >
      {apps === null ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400 text-sm">
          <Inbox size={24} />
          All caught up.
        </div>
      ) : (
        <div className="space-y-3">
          {apps.map(app => (
            <LeaveApplicationCard
              key={app.id}
              application={app}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              isApprover
              onStatusChange={() => handleDecided(app.id)}
            />
          ))}
        </div>
      )}
    </ModalShell>
  )
}
