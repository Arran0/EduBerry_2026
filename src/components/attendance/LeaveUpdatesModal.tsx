'use client'

import React, { useState } from 'react'
import { Bell } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import LeaveAppPreviewModal from '@/components/leave/LeaveAppPreviewModal'
import { fetchLeaveApplicationById, LeaveApplicationWithDetails } from '@/lib/leave'
import { NotifItem, TONE_ICON } from '@/components/home/NotificationsSummaryCard'

interface LeaveUpdatesModalProps {
  items: NotifItem[]
  onClose: () => void
  /** Clears a row once its application has been opened — same store the Home
   *  page notification card reads, so the two stay in sync. */
  onDismiss: (id: string) => void
}

/**
 * "Your application was approved/rejected" — the same sentences as the Home
 * page notification card, opened from inside the Staff Attendance app.
 * Scrollable (ModalShell's body already scrolls), so any number of decisions
 * fit without redesigning the list.
 */
export default function LeaveUpdatesModal({ items, onClose, onDismiss }: LeaveUpdatesModalProps) {
  const [openApp, setOpenApp] = useState<LeaveApplicationWithDetails | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const openItem = async (item: NotifItem) => {
    setLoadingId(item.id)
    const app = await fetchLeaveApplicationById(item.appId)
    setLoadingId(null)
    if (app) setOpenApp(app)
    onDismiss(item.id)
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
      >
        <div className="-mx-5 -my-4 divide-y divide-slate-100">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => openItem(item)}
              disabled={loadingId === item.id}
              className="w-full flex items-start gap-2.5 px-5 py-3 text-left hover:bg-slate-50 transition-colors disabled:opacity-60"
            >
              <span className="mt-0.5">{TONE_ICON[item.tone]}</span>
              <p className="flex-1 min-w-0 text-[13px] leading-snug text-slate-600">{item.text}</p>
            </button>
          ))}
        </div>
      </ModalShell>

      {openApp && (
        <LeaveAppPreviewModal application={openApp} onClose={() => setOpenApp(null)} />
      )}
    </>
  )
}
