'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import ModalShell from '@/components/ui/ModalShell'
import Avatar from '@/components/Avatar'
import type { UserProfile } from '@/lib/supabase'
import type { LeaveApplicationWithDetails } from '@/lib/leave'
import { MonthCalendarSkeleton, STUDENT_CAL_LEGEND } from './MonthCalendarFrame'

const AttendanceCalendar = dynamic(() => import('./AttendanceCalendar'), {
  ssr: false,
  loading: () => <MonthCalendarSkeleton legend={STUDENT_CAL_LEGEND} />,
})

/**
 * A student's month in a popup — the student-app twin of StaffCalendarModal,
 * on the same glass sheet with the same calendar frame, so tapping a name
 * opens the same popup in either app.
 *
 * The sheet is exactly as tall as what it holds: the calendar is a fixed size
 * (and so is its skeleton), and anything passed as `top` or `below` must be a
 * fixed height too — then nothing moves when the month loads.
 *
 * Render inside <AnimatePresence> for the exit animation.
 */
export default function StudentCalendarModal({
  student, subtitle, headerActions, homeroomId, loadingHomeroom = false,
  year, month, onMonthChange, viewerUserId, viewerRole, onAppOpen, onClose, top, below, zClass,
}: {
  student: Pick<UserProfile, 'id' | 'full_name'> & Partial<Pick<UserProfile, 'avatar_url' | 'email'>>
  subtitle?: React.ReactNode
  headerActions?: React.ReactNode
  /** null = no homeroom assigned. */
  homeroomId: string | null
  /** The homeroom is still being looked up — the skeleton stands in. */
  loadingHomeroom?: boolean
  year: number
  month: number
  onMonthChange: (year: number, month: number) => void
  viewerUserId?: string
  viewerRole?: string
  onAppOpen?: (app: LeaveApplicationWithDetails) => void
  onClose: () => void
  /** A fixed-height strip above the calendar (a homeroom switch). */
  top?: React.ReactNode
  /** A fixed-height block under the calendar (that month's applications). */
  below?: React.ReactNode
  zClass?: string
}) {
  return (
    <ModalShell
      onClose={onClose}
      size="md"
      glass
      cardless
      bodyClassName="!p-0 space-y-2"
      zClass={zClass}
      title={student.full_name}
      subtitle={subtitle}
      headerActions={headerActions}
      icon={
        <Avatar
          avatarUrl={student.avatar_url ?? null}
          name={student.full_name}
          email={student.email ?? null}
          size={40}
          userId={student.id}
        />
      }
      iconClassName="!shadow-none overflow-hidden !rounded-full"
    >
      {top}
      {loadingHomeroom ? (
        <MonthCalendarSkeleton legend={STUDENT_CAL_LEGEND} />
      ) : homeroomId ? (
        <AttendanceCalendar
          studentId={student.id}
          homeroomId={homeroomId}
          year={year}
          month={month}
          onMonthChange={onMonthChange}
          viewerUserId={viewerUserId}
          viewerRole={viewerRole}
          onAppOpen={onAppOpen}
        />
      ) : (
        <div className="rounded-[20px] bg-white ring-1 ring-slate-900/[0.06] h-[464px] flex items-center justify-center text-slate-400 text-sm">
          No homeroom assigned.
        </div>
      )}
      {below}
    </ModalShell>
  )
}
