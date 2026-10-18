'use client'

import React from 'react'
import { MonthCalendarSkeleton, STAFF_CAL_LEGEND } from './MonthCalendarFrame'

/**
 * The staff month calendar in grey, at its exact size — the fallback while
 * StaffAttendanceCalendar's code downloads. Kept in its own small file so a
 * page can show it without first loading the calendar it stands in for.
 */
export default function StaffAttendanceCalendarSkeleton() {
  return <MonthCalendarSkeleton legend={STAFF_CAL_LEGEND} />
}
