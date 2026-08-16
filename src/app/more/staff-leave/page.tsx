'use client'

import React, { useState, useCallback, useRef, Suspense } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, Plus, X } from 'lucide-react'
import StaffLeaveWorkspace, { StaffLeaveWorkspaceHandle } from '@/components/leave/StaffLeaveWorkspace'
import { STAFF_LEAVE_BANNER_DEFAULT } from '@/lib/pageConfig'

// Banner and content share one width so the hero's title lines up with the
// lists beneath it.
const MAX_W = 'max-w-3xl'

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
  const deepLinkEnd  = searchParams.get('end')
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
        {/* Same treatment as Staff Attendance: elevated hero, eyebrow kicker,
            faint background icon, no Back button. */}
        <PageBanner
          settingKey="staff_leave_banner"
          defaultBanner={STAFF_LEAVE_BANNER_DEFAULT}
          icon={<CalendarDays size={28} className="text-white" />}
          backgroundIcon={<CalendarDays size={180} className="text-white" />}
          eyebrow="Apply · Track · Approve"
          title="Staff OD / Leave"
          elevated
          isAdmin={isAdmin}
          maxWidth={MAX_W}
          onEditingChange={setBannerEditing}
          actions={
            <button
              onClick={() => workspace.current?.toggleForm()}
              className="group relative flex items-center gap-2 sm:gap-2.5 pl-1.5 pr-3 sm:pr-4 py-1.5 rounded-full bg-white/95 hover:bg-white border border-white/70 shadow-[0_6px_20px_-6px_rgba(0,0,0,0.45)] hover:shadow-[0_10px_26px_-6px_rgba(0,0,0,0.5)] active:scale-95 transition-all"
            >
              <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-violet-500 to-indigo-600 shadow-inner">
                {formOpen ? <X size={16} className="text-white" /> : <Plus size={17} className="text-white" />}
              </span>
              <span className="flex flex-col items-start leading-none">
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {formOpen ? 'Close' : 'Create'}
                </span>
                <span className="text-[13px] sm:text-sm font-bold text-slate-900 whitespace-nowrap mt-0.5">
                  {formOpen ? 'Cancel' : 'New Application'}
                </span>
              </span>
            </button>
          }
        />
        <div
          className={`relative z-0 ${MAX_W} mx-auto px-4 sm:px-6 lg:px-8 mt-4 pb-10`}
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
            initialNewEndDate={deepLinkNew ? deepLinkEnd : null}
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
