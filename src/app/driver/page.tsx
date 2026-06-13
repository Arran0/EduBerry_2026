'use client'

import React from 'react'
import { Bus } from 'lucide-react'
import DriverLayout from '@/components/DriverLayout'
import { useAuth } from '@/contexts/AuthContext'

export default function DriverDashboardPage() {
  const { profile } = useAuth()
  const firstName = profile?.full_name?.split(' ')[0] ?? 'Driver'

  return (
    <DriverLayout>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-slate-800">Hi {firstName} 👋</h1>
        <p className="text-slate-500 text-sm">Your bus dashboard</p>
      </div>

      {/* Placeholder until trips/attendance land in a later round */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-orange-50 flex items-center justify-center">
          <Bus size={30} className="text-orange-500" strokeWidth={1.5} />
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">No trip assigned today</h2>
        <p className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
          When an admin assigns you to a bus trip, today&apos;s passenger list and
          pickup/drop controls will appear here.
        </p>
      </div>
    </DriverLayout>
  )
}
