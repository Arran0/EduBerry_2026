'use client'

import React from 'react'
import { AlertTriangle, LogOut } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { StaffAttendanceRecord } from '@/lib/attendance'

function formatDayLabel(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

interface ForgottenCheckoutModalProps {
  records: StaffAttendanceRecord[]
  onClose: () => void
}

/**
 * Warns a staff member about past days left checked-in with no checkout —
 * a past day can't be checked out of any more, so this is informational
 * (dismiss it and, if needed, ask an admin to correct the record).
 */
export default function ForgottenCheckoutModal({ records, onClose }: ForgottenCheckoutModalProps) {
  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      title="Forgotten checkout"
      subtitle="These days were left checked in with no checkout"
      icon={<AlertTriangle size={16} />}
      iconClassName="bg-amber-100 text-amber-600"
      footer={
        <button
          onClick={onClose}
          className="w-full px-4 py-2.5 bg-slate-900 text-white rounded-xl font-medium text-sm hover:bg-slate-800 transition-colors"
        >
          Got it
        </button>
      }
    >
      <div className="space-y-2">
        {records.map(r => {
          const openFirst = r.check_in_time && !r.check_out_time
          const checkInTime = openFirst ? r.check_in_time : r.check_in_time_2
          return (
            <div key={r.id} className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <LogOut size={14} className="text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">{formatDayLabel(r.date)}</p>
                <p className="text-xs text-slate-500">
                  Checked in{checkInTime ? ` at ${formatTime(checkInTime)}` : ''} — no checkout recorded
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </ModalShell>
  )
}
