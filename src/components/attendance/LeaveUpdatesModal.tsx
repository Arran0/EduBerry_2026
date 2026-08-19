'use client'

import React, { useState } from 'react'
import { Bell, Check } from 'lucide-react'
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
 *
 * Everything listed here is marked read on the way out, so a decision the user
 * has already seen never pops this open again — only a new one does.
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
                <span className="mt-0.5">{TONE_ICON[item.tone]}</span>
                <p className="flex-1 min-w-0 text-[13px] leading-snug text-slate-600">{item.text}</p>
              </button>
              {/* Clear one without opening it — the whole list is marked read
                  on close anyway, this is just the finer-grained way. */}
              <button
                type="button"
                onClick={() => onDismiss(item.id)}
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

      {openApp && (
        <LeaveAppPreviewModal application={openApp} onClose={() => setOpenApp(null)} />
      )}
    </>
  )
}
