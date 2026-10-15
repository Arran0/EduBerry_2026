'use client'

import React from 'react'
import MiniWeekCalendar, { MiniCalendarItem } from './MiniWeekCalendar'

interface StaffWeeklyCalendarCardProps {
  itemsByDay: Map<string, MiniCalendarItem[]>
  loading: boolean
  onOpenDay?: (dateKey: string) => void
  fill?: boolean
}

/** Compact week-at-a-glance of a staff member's task-manager tasks for the
 *  home carousel. Mirrors the student school-work calendar. */
export default function StaffWeeklyCalendarCard({ itemsByDay, loading, onOpenDay, fill }: StaffWeeklyCalendarCardProps) {
  return <MiniWeekCalendar itemsByDay={itemsByDay} loading={loading} accent="sky" sharp onOpenDay={onOpenDay} fill={fill} />
}
