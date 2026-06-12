'use client'

import React from 'react'
import { CalendarRange } from 'lucide-react'

// Placeholder — the full read-only personal teaching grid is implemented in Round 4.
export default function StaffTimetableView({ staffId }: { staffId: string }) {
  void staffId
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <CalendarRange className="w-7 h-7 text-slate-500" strokeWidth={1.5} />
      </div>
      <h2 className="font-display text-lg font-semibold text-slate-800">Your teaching schedule</h2>
      <p className="text-slate-500 text-sm mt-1">
        Once the timetable is published, your weekly teaching periods will appear here.
      </p>
    </div>
  )
}
