'use client'

import React, { useRef, useState } from 'react'
import { CalendarDays, Plus, X } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { useAuth } from '@/contexts/AuthContext'
import StudentLeaveWorkspace, { StudentLeaveWorkspaceHandle } from './StudentLeaveWorkspace'

interface StudentLeaveModalProps {
  onClose: () => void
  /** Opens the form prefilled for this date (e.g. a day picked on a calendar). */
  initialNewDate?: string | null
  /** Last day of a prefilled range, when several calendar days were picked. */
  initialNewEndDate?: string | null
  /** Opens straight into one application's detail popup. */
  initialAppId?: string | null
}

/**
 * The whole Student OD / Leave app in a popup.
 *
 * Applying for leave and looking at the attendance it explains are the same
 * errand, so Student Attendance hosts the leave app rather than sending people
 * to a second screen (and needing a second home-page icon to get there).
 * `/more/leave` still exists and renders the identical workspace, so there is
 * only ever one copy of this app to maintain — but this popup does not send
 * anyone there: it is the whole app already.
 *
 * Render inside <AnimatePresence> so the sheet animates out on close.
 */
export default function StudentLeaveModal({
  onClose,
  initialNewDate = null,
  initialNewEndDate = null,
  initialAppId = null,
}: StudentLeaveModalProps) {
  const { profile } = useAuth()
  const isStudent = profile?.role === 'student'

  const workspace = useRef<StudentLeaveWorkspaceHandle>(null)
  const [formOpen, setFormOpen] = useState(false)

  return (
    <ModalShell
      onClose={onClose}
      size="2xl"
      // A fixed height: tabs, a search box and a list should not shrink to fit
      // an empty folder and grow again when a full one is picked — the list
      // scrolls inside the popup instead.
      minHClass="h-[88dvh] sm:h-[min(44rem,86dvh)]"
      title={isStudent ? 'My OD / Leave' : 'Student OD / Leave'}
      subtitle={isStudent
        ? 'Apply for OD, casual, or medical leave and track applications'
        : 'Review and manage student OD / leave applications'}
      icon={<CalendarDays size={16} />}
      iconClassName="bg-violet-100 text-violet-600"
      headerActions={
        /* Only students file student leave — staff are here to decide on it. */
        isStudent ? (
          <button
            onClick={() => workspace.current?.toggleForm()}
            className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors flex-shrink-0"
          >
            {formOpen ? <X size={13} /> : <Plus size={13} />}
            <span className="hidden sm:inline">{formOpen ? 'Cancel' : 'New Application'}</span>
            <span className="sm:hidden">{formOpen ? 'Cancel' : 'New'}</span>
          </button>
        ) : undefined
      }
    >
      {/* Carries the student-leave palette (--page-primary and friends) into the
          popup, so the leave app looks like itself inside the host page. */}
      <div data-page-theme="student-leave">
        <StudentLeaveWorkspace
          ref={workspace}
          embedded
          initialNewDate={initialNewDate}
          initialNewEndDate={initialNewEndDate}
          initialAppId={initialAppId}
          onFormOpenChange={setFormOpen}
        />
      </div>
    </ModalShell>
  )
}
