'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { CalendarRange, Monitor } from 'lucide-react'
import { TIMETABLE_BANNER_DEFAULT } from '@/lib/pageConfig'
import dynamic from 'next/dynamic'
const AdminTimetableBuilder = dynamic(() => import('@/components/timetable/AdminTimetableBuilder'))
const StaffTimetableView    = dynamic(() => import('@/components/timetable/StaffTimetableView'))
const StudentTimetableView  = dynamic(() => import('@/components/timetable/StudentTimetableView'))

const MAX_W = 'max-w-7xl'

export default function TimetablePage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isStaff = profile ? isStaffRole(profile.role) : false
  const [bannerEditing, setBannerEditing] = useState(false)

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
          onBack={() => router.back()}
          onEditingChange={setBannerEditing}
        />

        <div
          className={`${MAX_W} mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 transition-all duration-200 ${
            bannerEditing ? 'opacity-30 blur-[1px] pointer-events-none select-none' : ''
          }`}
          aria-hidden={bannerEditing}
        >
          {!user ? null : isAdmin ? (
            <>
              {/* Desktop-only restriction for admin timetable builder */}
              <div className="md:hidden flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
                <div className="p-4 bg-zinc-100 rounded-2xl">
                  <Monitor size={36} className="text-zinc-400" />
                </div>
                <div>
                  <p className="text-base font-semibold text-zinc-700">Desktop required</p>
                  <p className="text-sm text-zinc-500 mt-1 max-w-xs">
                    The timetable builder is designed for desktop use. Please open this page on a larger screen to build and manage timetables.
                  </p>
                </div>
              </div>
              <div className="hidden md:block">
                <AdminTimetableBuilder />
              </div>
            </>
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
