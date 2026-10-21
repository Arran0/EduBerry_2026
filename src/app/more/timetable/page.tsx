'use client'

import React, { Suspense, useState } from 'react'
import dynamic from 'next/dynamic'
import { CalendarRange } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { TIMETABLE_BANNER_DEFAULT } from '@/lib/pageConfig'

// Kept local rather than imported from the timetable kit, so the page shell
// does not pull the kit in before the view it is waiting for.
const Loading = () => <div className="flex justify-center py-16"><div className="spinner" /></div>

const AdminTimetableBuilder = dynamic(() => import('@/components/timetable/AdminTimetableBuilder'), { loading: () => <Loading /> })
const StaffTimetableView    = dynamic(() => import('@/components/timetable/StaffTimetableView'), { loading: () => <Loading /> })
const StudentTimetableView  = dynamic(() => import('@/components/timetable/StudentTimetableView'), { loading: () => <Loading /> })

// Every view gets the wide canvas: the admin's master grid needs it, and a
// student or staff week reads better with its day columns given the room.
const MAX_W = 'max-w-7xl 2xl:max-w-[1720px]'

export default function TimetablePage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isStaff = profile ? isStaffRole(profile.role) : false
  const [bannerEditing, setBannerEditing] = useState(false)

  return (
    <ProtectedLayout>
      <div data-page-theme="timetable" className="overflow-x-clip" style={{ minHeight: '100vh' }}>
        <PageBanner
          settingKey="timetable_banner"
          defaultBanner={TIMETABLE_BANNER_DEFAULT}
          icon={<CalendarRange size={26} className="text-white" />}
          backgroundIcon={<CalendarRange size={150} className="text-white" />}
          title="Timetable"
          subtitle={isAdmin ? 'Periods, lessons and the published week' : isStaff ? 'The periods you teach' : 'Your class week'}
          isAdmin={isAdmin}
          maxWidth={MAX_W}
          onEditingChange={setBannerEditing}
          announcementRhythm
        />

        <div className={`${MAX_W} mx-auto px-4 sm:px-6 lg:px-8 pb-14`}>
          {/* Everything but the banner fades while the banner is being edited. */}
          <div
            aria-hidden={bannerEditing}
            style={{
              opacity: bannerEditing ? 0.35 : 1,
              pointerEvents: bannerEditing ? 'none' : 'auto',
              userSelect: bannerEditing ? 'none' : 'auto',
              transition: 'opacity 0.25s ease',
            }}
          >
            {!user ? null : isAdmin ? (
              // The view lives in the URL, which needs a Suspense boundary to
              // stay out of the static-render bailout.
              <Suspense fallback={<Loading />}>
                <AdminTimetableBuilder />
              </Suspense>
            ) : (
              <div className="pt-5 sm:pt-6">
                {isStaff ? <StaffTimetableView staffId={user.id} /> : <StudentTimetableView studentId={user.id} />}
              </div>
            )}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
