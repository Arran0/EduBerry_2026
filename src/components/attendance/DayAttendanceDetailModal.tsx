'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, Clock, MessageSquare } from 'lucide-react'
import {
  StaffAttendanceRecord,
  STAFF_ATTENDANCE_STATUS_LABELS,
  STAFF_ATTENDANCE_STATUS_COLORS,
  PUNCH_SLOTS,
  describeLocationWarning,
} from '@/lib/attendance'
import { LocationWarningBanner } from '@/components/attendance/LocationWarning'
import { SHEET_MOTION } from '@/lib/sheetMotion'

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * Opened by tapping an already-marked day on the personal attendance
 * calendar. Shows the four punch slots (check-in, checkout, return check-in,
 * final checkout) plus the day's status, remarks, and — when the day carries
 * one — the same location warning the office sees (LocationWarningBanner,
 * shared with the admin report so the two never say different things).
 */
export default function DayAttendanceDetailModal({
  record, dateLabel, staffName, onClose,
}: {
  record: StaffAttendanceRecord
  dateLabel: string
  staffName?: string
  onClose: () => void
}) {
  if (typeof document === 'undefined') return null
  const warning = describeLocationWarning(record)

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-[#1c1a1e]/45"
      onClick={onClose}
    >
      <motion.div
        {...SHEET_MOTION} // slides, never fades — see lib/sheetMotion
        className="lg-sheet relative rounded-[28px] w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Attendance for ${dateLabel}`}
      >
        <div className="relative z-[3] flex items-center gap-3 px-4 sm:px-5 pt-4 pb-3">
          <span className="icon-chip w-10 h-10 flex-shrink-0 bg-[linear-gradient(135deg,#3D3B40,#27272A)]">
            <Clock size={17} className="relative z-10 text-[#E9DDBB]" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-display text-[1.05rem] font-bold text-slate-900 leading-tight headline truncate">{dateLabel}</p>
            {staffName && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{staffName}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="lg-control w-9 h-9 flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="lg-sheet-card relative z-[3] mx-2 mb-2 p-4 space-y-4">
          <span className={`inline-flex items-center px-2.5 py-1 text-xs font-bold rounded-full border ${STAFF_ATTENDANCE_STATUS_COLORS[record.status]}`}>
            {STAFF_ATTENDANCE_STATUS_LABELS[record.status]}
          </span>

          <div className="grid grid-cols-2 gap-2.5">
            {PUNCH_SLOTS.map(slot => (
              <div key={slot.label} className="p-3 rounded-2xl border border-slate-100 bg-slate-50">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{slot.label}</p>
                <p className="text-sm font-bold text-slate-800 tabular-nums mt-0.5">
                  {formatTime(record[slot.time])}
                </p>
              </div>
            ))}
          </div>

          {warning && (
            <LocationWarningBanner
              warning={warning}
              footnote={warning.strict
                ? 'Attendance still counts. The day stays flagged at the top of the report for the admin to review.'
                : 'Attendance still counts. The day stays flagged on the report.'}
            />
          )}

          {record.remarks && (
            <div className="flex items-start gap-2 p-3 rounded-2xl border border-slate-100 bg-slate-50">
              <MessageSquare size={13} className="text-slate-400 flex-shrink-0 mt-[2px]" />
              <p className="text-xs text-slate-600 leading-relaxed">{record.remarks}</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
