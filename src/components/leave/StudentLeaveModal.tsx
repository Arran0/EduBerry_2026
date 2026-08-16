'use client'

import React, { useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Plus, X, ExternalLink } from 'lucide-react'
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
 * `/more/leave` still exists — the header links to it — and both render the
 * identical workspace, so there is only ever one copy of this app to maintain.
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
      title={isStudent ? 'My OD / Leave' : 'Student OD / Leave'}
      subtitle={isStudent
        ? 'Apply for OD, casual, or medical leave and track applications'
        : 'Review and manage student OD / leave applications'}
      icon={<CalendarDays size={16} />}
      iconClassName="bg-violet-100 text-violet-600"
      headerActions={
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Only students file student leave — staff are here to decide on it. */}
          {isStudent && (
            <button
              onClick={() => workspace.current?.toggleForm()}
              className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors"
            >
              {formOpen ? <X size={13} /> : <Plus size={13} />}
              <span className="hidden sm:inline">{formOpen ? 'Cancel' : 'New Application'}</span>
              <span className="sm:hidden">{formOpen ? 'Cancel' : 'New'}</span>
            </button>
          )}
          <Link
            href="/more/leave"
            title="Open the full Student OD / Leave page"
            aria-label="Open the full Student OD / Leave page"
            className="hidden sm:flex w-8 h-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors"
          >
            <ExternalLink size={14} />
          </Link>
        </div>
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
