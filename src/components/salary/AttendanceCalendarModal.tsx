'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { CalendarDays } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { UserProfile } from '@/lib/supabase'

// Loaded on demand — the calendar pulls in attendance, holiday and leave data
// that a payroll sheet has no use for until someone actually opens it.
const StaffAttendanceCalendar = dynamic(
  () => import('@/components/attendance/StaffAttendanceCalendar'),
  {
    ssr: false,
    loading: () => (
      <div className="py-16 text-center">
        <div className="spinner mx-auto mb-3" />
        <p className="text-sm text-[#71717A]">Loading calendar…</p>
      </div>
    ),
  },
)

/**
 * The staff attendance calendar, opened from a pay cycle row.
 *
 * Leave and late counts drive loss of pay, so the question "why is this
 * person's LOP so high?" comes up constantly while reviewing a cycle. This is
 * the same calendar the attendance manager uses, in the same admin mode, so
 * the day it disagrees about can be inspected — and corrected — without
 * leaving payroll. `onClosed` lets the cycle reload afterwards, since any
 * correction changes the figures behind it.
 *
 * It opens on the cycle's own month, never on today's: the row's Leave column
 * counts that month's Absent days, so landing anywhere else would put a
 * different month's count next to it and read as a disagreement.
 */
export default function AttendanceCalendarModal({ person, viewerId, year, month, periodLabel, onClose, onClosed }: {
  person: UserProfile
  viewerId: string
  /** Cycle period to open on — 1-based month. Defaults to the current month. */
  year?: number
  month?: number
  /** e.g. "June 2026", shown so it's plain which month's figures these are. */
  periodLabel?: string
  onClose: () => void
  onClosed?: () => void
}) {
  const close = () => {
    onClose()
    onClosed?.()
  }

  return (
    <ModalShell
      onClose={close}
      size="2xl"
      title={person.full_name}
      subtitle={periodLabel ? `Attendance calendar · ${periodLabel}` : 'Attendance calendar'}
      icon={<CalendarDays size={16} />}
      iconClassName="bg-slate-800 text-white"
    >
      <StaffAttendanceCalendar
        staffId={person.id}
        staffName={person.full_name}
        initialYear={year}
        initialMonth={month}
        mode="admin"
        viewerUserId={viewerId}
        viewerRole="admin"
      />
    </ModalShell>
  )
}
