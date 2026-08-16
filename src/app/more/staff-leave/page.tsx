'use client'

import React, { useState, useCallback, useRef, Suspense } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, Plus, X } from 'lucide-react'
import StaffLeaveWorkspace, { StaffLeaveWorkspaceHandle } from '@/components/leave/StaffLeaveWorkspace'
import { STAFF_LEAVE_BANNER_DEFAULT } from '@/lib/pageConfig'

/**
 * The full-page Staff OD / Leave app: page furniture around the shared
 * workspace. The same workspace also runs in a popup inside Staff Attendance
 * (see StaffLeaveModal), so this page and that popup can never drift apart.
 */
function StaffLeaveContent() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Deep-link params (from the attendance calendar / home notifications)
  const deepLinkNew  = searchParams.get('new') === '1'
  const deepLinkDate = searchParams.get('date')
  const deepLinkApp  = searchParams.get('app')

  const isAdmin = profile?.role === 'admin'

  const workspace = useRef<StaffLeaveWorkspaceHandle>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [bannerEditing, setBannerEditing] = useState(false)

  // Closing the detail popup drops ?app= so a refresh doesn't reopen it.
  const clearAppParam = useCallback(() => {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    params.delete('app')
    const qs = params.toString()
    router.replace(qs ? `/more/staff-leave?${qs}` : '/more/staff-leave', { scroll: false })
  }, [router, searchParams])

  if (!user || !profile) return null

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="staff-leave">
        <PageBanner
          settingKey="staff_leave_banner"
          defaultBanner={STAFF_LEAVE_BANNER_DEFAULT}
          icon={<CalendarDays size={26} className="text-white" />}
          title="Staff OD / Leave"
          subtitle="Apply for on duty or leave and manage applications"
          isAdmin={isAdmin}
          onEditingChange={setBannerEditing}
          onBack={() => router.back()}
          maxWidth="max-w-3xl"
          actions={
            <>
              <button
                onClick={() => workspace.current?.toggleForm()}
                className="hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white font-medium text-sm rounded-xl border border-white/30 transition-colors"
              >
                {formOpen ? <X size={15} /> : <Plus size={15} />}
                {formOpen ? 'Cancel' : 'New Application'}
              </button>
              <button
                onClick={() => workspace.current?.toggleForm()}
                className="sm:hidden w-10 h-10 bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center text-white transition-colors"
              >
                {formOpen ? <X size={16} /> : <Plus size={18} />}
              </button>
            </>
          }
        />
        <div
          className="relative z-0 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 pb-10"
          style={{
            opacity: bannerEditing ? 0.35 : 1,
            filter: bannerEditing ? 'blur(1.5px)' : 'none',
            pointerEvents: bannerEditing ? 'none' : 'auto',
            userSelect: bannerEditing ? 'none' : 'auto',
            transition: 'opacity 0.25s ease, filter 0.25s ease',
          }}
        >
          <StaffLeaveWorkspace
            ref={workspace}
            initialNewDate={deepLinkNew ? deepLinkDate : null}
            initialAppId={deepLinkApp}
            onFormOpenChange={setFormOpen}
            onDetailClose={clearAppParam}
          />
        </div>
      </div>
    </ProtectedLayout>
  )
}

export default function StaffLeavePage() {
  return (
    <Suspense fallback={
      <ProtectedLayout staffOnly>
        <div className="text-center py-20">
          <div className="spinner mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading…</p>
        </div>
      </ProtectedLayout>
    }>
      <StaffLeaveContent />
    </Suspense>
  )
}
