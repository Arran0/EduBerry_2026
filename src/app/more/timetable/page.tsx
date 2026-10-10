'use client'

import React, { useState } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { CalendarRange } from 'lucide-react'
import { TIMETABLE_BANNER_DEFAULT } from '@/lib/pageConfig'
import dynamic from 'next/dynamic'
const AdminTimetableBuilder = dynamic(() => import('@/components/timetable/AdminTimetableBuilder'))
const StaffTimetableView    = dynamic(() => import('@/components/timetable/StaffTimetableView'))
const StudentTimetableView  = dynamic(() => import('@/components/timetable/StudentTimetableView'))

// The admin builder hosts an information-dense master grid, so it gets a much
// wider canvas than the single-week student / staff views.
const MAX_W_ADMIN = 'max-w-[112rem]'
const MAX_W_VIEWER = 'max-w-7xl'

export default function TimetablePage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isStaff = profile ? isStaffRole(profile.role) : false
  const [bannerEditing, setBannerEditing] = useState(false)
  const MAX_W = isAdmin ? MAX_W_ADMIN : MAX_W_VIEWER

  return (
    <ProtectedLayout>
      <div data-page-theme="timetable">
        <PageBanner
          settingKey="timetable_banner"
          defaultBanner={TIMETABLE_BANNER_DEFAULT}
          icon={<CalendarRange size={24} className="text-white" />}
          backgroundIcon={<CalendarRange size={180} className="text-white" />}
          title="Timetable"
          subtitle={
            isAdmin
              ? 'Build, generate, and publish class timetables'
              : isStaff
                ? 'Your weekly teaching schedule'
                : 'Your weekly class schedule'
          }
          isAdmin={isAdmin}
          maxWidth={MAX_W}
          onEditingChange={setBannerEditing}
        />

        <div
          className={`${MAX_W} mx-auto px-1.5 sm:px-3 lg:px-5 py-3 sm:py-4 transition-all duration-200 ${
            bannerEditing ? 'opacity-30 blur-[1px] pointer-events-none select-none' : ''
          }`}
          aria-hidden={bannerEditing}
        >
          {!user ? null : isAdmin ? (
            <AdminTimetableBuilder />
          ) : isStaff ? (
            <StaffTimetableView staffId={user.id} />
          ) : (
            <StudentTimetableView studentId={user.id} />
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
