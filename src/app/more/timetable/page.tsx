'use client'

import React from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import UnderConstruction from '@/components/UnderConstruction'
import { CalendarRange } from 'lucide-react'

export default function TimetablePage() {
  return (
    <ProtectedLayout>
      <UnderConstruction
        title="Timetable"
        description="View your class schedule, periods, and teacher timetables. Coming soon!"
        icon={<CalendarRange className="w-14 h-14 text-slate-500" strokeWidth={1.5} />}
        backLink="/home"
        backLabel="Back to Home"
      />
    </ProtectedLayout>
  )
}
