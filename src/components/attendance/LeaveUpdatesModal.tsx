'use client'

import React, { useState } from 'react'
import { Bell, Check, Loader2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import LeaveAppPreviewModal from '@/components/leave/LeaveAppPreviewModal'
import { fetchLeaveApplicationById, LeaveApplicationWithDetails } from '@/lib/leave'
import type { NotifItem } from '@/lib/leaveNotifications'
import { TONE_ICON } from '@/components/home/NotificationsSummaryCard'

interface LeaveUpdatesModalProps {
  items: NotifItem[]
  currentUserId: string
  currentUserRole: string
  onClose: () => void
  /** Marks a row read — locally and on the application it points at, so the
   *  Home notification box and the OD / Leave app both agree it has been
   *  seen. */
  onRead: (item: NotifItem) => void
}

/**
 * "Your application was approved / rejected" — what an applicant is shown on
 * entering the Staff Attendance app, the counterpart to the review queue a
 * reviewer gets. Same sentences as the Home notification box.
 *
 * Seeing a decision here is reading it: everything listed is marked read on
 * the way out, on the notification and on the application itself, so a
 * decision the applicant has already seen never pops this open again — only a
 * new one does. Opening a row shows the full application in the shared popup.
 */
export default function LeaveUpdatesModal({
  items, currentUserId, currentUserRole, onClose, onRead,
}: LeaveUpdatesModalProps) {
  const [openApp, setOpenApp] = useState<LeaveApplicationWithDetails | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const openItem = async (item: NotifItem) => {
    setLoadingId(item.id)
    const app = await fetchLeaveApplicationById(item.appId)
    setLoadingId(null)
    if (app) setOpenApp(app)
    onRead(item)
  }

  return (
    <>
      <ModalShell
        onClose={onClose}
        size="md"
        title="Application updates"
        subtitle="Decisions on your OD / Leave applications"
        icon={<Bell size={16} />}
        iconClassName="bg-sky-100 text-sky-600"
        footer={
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 bg-slate-900 text-white rounded-xl font-medium text-sm hover:bg-slate-800 transition-colors"
          >
            Mark all as read
          </button>
        }
      >
        <div className="-mx-5 -my-4 divide-y divide-slate-100">
          {items.map(item => (
            <div key={item.id} className="flex items-start gap-2 pr-2 hover:bg-slate-50 transition-colors">
              <button
                type="button"
                onClick={() => openItem(item)}
                disabled={loadingId === item.id}
                className="flex-1 min-w-0 flex items-start gap-2.5 pl-5 py-3 text-left disabled:opacity-60"
              >
                <span className="mt-0.5">
                  {loadingId === item.id
                    ? <Loader2 size={15} className="animate-spin text-slate-400 flex-shrink-0" />
                    : TONE_ICON[item.tone]}
                </span>
                <p className="flex-1 min-w-0 text-[13px] leading-snug text-slate-600">{item.text}</p>
              </button>
              {/* Clear one without opening it — the whole list is marked read
                  on close anyway, this is just the finer-grained way. */}
              <button
                type="button"
                onClick={() => onRead(item)}
                title="Mark as read"
                aria-label="Mark as read"
                className="mt-2.5 p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
              >
                <Check size={14} />
              </button>
            </div>
          ))}
        </div>
      </ModalShell>

      {/* No "View in OD / Leave Manager" button: the applicant is already
          inside the Staff Attendance app, and the decision is read right here. */}
      {openApp && (
        <LeaveAppPreviewModal
          application={openApp}
          viewerUserId={currentUserId}
          viewerRole={currentUserRole}
          onClose={() => setOpenApp(null)}
        />
      )}
    </>
  )
}
