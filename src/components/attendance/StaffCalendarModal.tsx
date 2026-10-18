'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import ModalShell from '@/components/ui/ModalShell'
import Avatar from '@/components/Avatar'
import type { StaffAttendanceRecord } from '@/lib/attendance'
import type { LeaveApplicationWithDetails } from '@/lib/leave'
import StaffAttendanceCalendarSkeleton from './StaffAttendanceCalendarSkeleton'

// The calendar's code arrives on first open; until then its skeleton stands in
// at the calendar's exact size, so the popup opens at its final height.
const StaffAttendanceCalendar = dynamic(() => import('./StaffAttendanceCalendar'), {
  ssr: false,
  loading: () => <StaffAttendanceCalendarSkeleton />,
})

/**
 * A person's month of attendance in a popup — what tapping a name opens in the
 * staff attendance report, for school staff, drivers and ground support staff
 * alike, so all three look and load the same way.
 *
 * Render inside <AnimatePresence> for the exit animation.
 */
export default function StaffCalendarModal({
  person, subtitle, viewerId, viewerRole, onClose, onViewLeave, fetchRecords, zClass, avatarUserId,
}: {
  person: { id: string; full_name: string; avatar_url?: string | null; email?: string | null }
  subtitle?: React.ReactNode
  viewerId?: string
  viewerRole?: string
  onClose: () => void
  onViewLeave?: (app: LeaveApplicationWithDetails) => void
  /** For people whose attendance lives outside staff_attendance_records (ground support staff). */
  fetchRecords?: (staffId: string, year: number, month: number) => Promise<StaffAttendanceRecord[]>
  zClass?: string
  /** Makes the header avatar open this account's profile card. */
  avatarUserId?: string
}) {
  return (
    // Glass, with the calendar straight on the sheet: the calendar is a fixed
    // size (six weeks, fixed bands) and so is its skeleton, so the sheet is
    // exactly the calendar's height from the first frame — no empty space and
    // no jump when the month arrives.
    <ModalShell
      onClose={onClose}
      size="md"
      glass
      cardless
      bodyClassName="!p-0"
      zClass={zClass}
      title={person.full_name}
      subtitle={subtitle}
      icon={
        <Avatar
          avatarUrl={person.avatar_url ?? null}
          name={person.full_name}
          email={person.email ?? null}
          size={40}
          userId={avatarUserId}
        />
      }
      iconClassName="!shadow-none overflow-hidden !rounded-full"
    >
      <StaffAttendanceCalendar
        staffId={person.id}
        mode="self"
        viewerUserId={viewerId}
        viewerRole={viewerRole}
        onViewLeave={onViewLeave}
        fetchRecords={fetchRecords}
      />
    </ModalShell>
  )
}
