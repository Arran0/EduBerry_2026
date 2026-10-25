'use client'

import React, { useEffect, useState } from 'react'
import { CalendarOff } from 'lucide-react'
import { fetchStudentHolidayForHomeroom } from '@/lib/attendanceCalendars'

/**
 * A strip across the class register when the student holiday calendars mark
 * the day off for this homeroom (Admin Space → Attendance Rules → Student).
 * It only informs: the register stays open, for a school that opens on a
 * listed holiday after all.
 */
export default function StudentHolidayNotice({ homeroomId, date, className = '' }: {
  homeroomId: string
  date: string
  className?: string
}) {
  const [holiday, setHoliday] = useState<{ name: string; calendar: string } | null>(null)

  useEffect(() => {
    let live = true
    setHoliday(null)
    fetchStudentHolidayForHomeroom(homeroomId, date).then(h => { if (live) setHoliday(h) })
    return () => { live = false }
  }, [homeroomId, date])

  if (!holiday) return null
  return (
    <div className={`flex items-center gap-2 px-3 sm:px-3.5 py-2 bg-amber-50 border-b border-amber-100 text-[12.5px] text-amber-800 ${className}`}>
      <CalendarOff size={14} className="flex-shrink-0 text-amber-600" />
      <span className="min-w-0 truncate">
        <strong className="font-semibold">Holiday: {holiday.name}</strong>
        <span className="text-amber-700/80"> · {holiday.calendar}. No register is needed for this day.</span>
      </span>
    </div>
  )
}
