'use client'

import React, { useState, useCallback, useRef, Suspense } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, Plus, X } from 'lucide-react'
import StudentLeaveWorkspace, { StudentLeaveWorkspaceHandle } from '@/components/leave/StudentLeaveWorkspace'
import { LEAVE_BANNER_DEFAULT } from '@/lib/pageConfig'

/**
 * The full-page Student OD / Leave app: page furniture around the shared
 * workspace. The same workspace also runs in a popup inside Student Attendance
 * (see StudentLeaveModal), so this page and that popup can never drift apart.
 */
function LeavePageContent() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const isStudent = profile?.role === 'student'
  const isAdmin = profile?.role === 'admin'

  // Deep-link params (from the attendance calendar / home notifications)
  const deepLinkNewDate = searchParams.get('newLeave')
  const deepLinkApp     = searchParams.get('openApp')

  const workspace = useRef<StudentLeaveWorkspaceHandle>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [bannerEditing, setBannerEditing] = useState(false)

  // Closing the detail popup drops ?openApp= so a refresh doesn't reopen it.
  const clearAppParam = useCallback(() => {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    params.delete('openApp')
    const qs = params.toString()
    router.replace(qs ? `/more/leave?${qs}` : '/more/leave', { scroll: false })
  }, [router, searchParams])

  if (!user || !profile) return null

  // The student's own lists sit in a narrower column than the approver's.
  const contentMaxW = isStudent ? 'max-w-2xl' : 'max-w-3xl'

  return (
    <ProtectedLayout>
      <div data-page-theme="student-leave">
        <PageBanner
          settingKey="leave_banner"
          defaultBanner={LEAVE_BANNER_DEFAULT}
          icon={<CalendarDays size={26} className="text-white" />}
          title={isStudent ? 'My OD Leave' : 'OD Leave Requests'}
          subtitle={isStudent ? 'Apply for OD, casual, or medical leave' : 'Review and manage student OD/leave applications'}
          isAdmin={isAdmin}
          onEditingChange={setBannerEditing}
          onBack={() => router.back()}
          maxWidth="max-w-3xl"
          actions={isStudent ? (
            <>
              <button
                onClick={() => workspace.current?.toggleForm()}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white font-medium text-sm rounded-xl border border-white/30 transition-colors"
              >
                {formOpen ? <X size={15} /> : <Plus size={15} />}
                {formOpen ? 'Cancel' : 'New OD/Leave'}
              </button>
              <button
                onClick={() => workspace.current?.toggleForm()}
                className="sm:hidden w-10 h-10 bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center text-white transition-colors"
              >
                {formOpen ? <X size={16} /> : <Plus size={18} />}
              </button>
            </>
          ) : undefined}
        />
        <div
          className={`relative z-0 ${contentMaxW} mx-auto px-4 sm:px-6 lg:px-8 mt-4 pb-10`}
          style={{
            opacity: bannerEditing ? 0.35 : 1,
            filter: bannerEditing ? 'blur(1.5px)' : 'none',
            pointerEvents: bannerEditing ? 'none' : 'auto',
            userSelect: bannerEditing ? 'none' : 'auto',
            transition: 'opacity 0.25s ease, filter 0.25s ease',
          }}
        >
          <StudentLeaveWorkspace
            ref={workspace}
            initialNewDate={deepLinkNewDate}
            initialAppId={deepLinkApp}
            onFormOpenChange={setFormOpen}
            onDetailClose={clearAppParam}
          />
        </div>
      </div>
    </ProtectedLayout>
  )
}

export default function LeavePage() {
  return (
    <Suspense fallback={
      <ProtectedLayout>
        <div className="text-center py-20">
          <div className="spinner mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading…</p>
        </div>
      </ProtectedLayout>
    }>
      <LeavePageContent />
    </Suspense>
  )
}
