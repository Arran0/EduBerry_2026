'use client'

import React from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { CalendarRange } from 'lucide-react'
import { TIMETABLE_BANNER_DEFAULT } from '@/lib/pageConfig'
import AdminTimetableBuilder from '@/components/timetable/AdminTimetableBuilder'
import StaffTimetableView from '@/components/timetable/StaffTimetableView'
import StudentTimetableView from '@/components/timetable/StudentTimetableView'

export default function TimetablePage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isStaff = profile ? isStaffRole(profile.role) : false

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
          maxWidth="max-w-6xl"
        />

        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
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
