'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchCalendarData, isTaskCompleted } from '@/lib/tasks'
import MiniWeekCalendar, { MiniCalendarItem, getWeekStart } from './MiniWeekCalendar'

interface DatedItem extends MiniCalendarItem {
  dueDate: string
}

interface StaffWeeklyCalendarCardProps {
  userId: string
}

/** Compact week-at-a-glance of a staff member's task-manager tasks for the
 *  home carousel. Mirrors the student school-work calendar; links out to the
 *  full task manager. */
export default function StaffWeeklyCalendarCard({ userId }: StaffWeeklyCalendarCardProps) {
  const [items, setItems] = useState<DatedItem[]>([])
  const [loading, setLoading] = useState(true)
  const weekStart = useMemo(() => getWeekStart(new Date()), [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { week } = await fetchCalendarData(userId, weekStart)
      const list: DatedItem[] = week
        .filter(t => t.due_date)
        .map(t => ({
          id: t.id,
          title: t.title,
          dueDate: t.due_date as string,
          done: isTaskCompleted(t),
        }))
      setItems(list)
    } catch (err) {
      console.error('Failed to load task calendar for home card:', err)
      setItems([])
    }
    setLoading(false)
  }, [userId, weekStart])

  useEffect(() => { loadData() }, [loadData])

  const itemsByDay = useMemo(() => {
    const map = new Map<string, MiniCalendarItem[]>()
    for (const item of items) {
      if (!map.has(item.dueDate)) map.set(item.dueDate, [])
      map.get(item.dueDate)!.push(item)
    }
    return map
  }, [items])

  return <MiniWeekCalendar itemsByDay={itemsByDay} loading={loading} accent="sky" />
}
