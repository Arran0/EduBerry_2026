'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ClassroomWithDetails, FileStatus, fetchAllFilesForClassroom, fetchProgressForStudent,
} from '@/lib/classrooms'
import { fetchStudentHomeroomTasks } from '@/lib/smartboard'
import MiniWeekCalendar, { MiniCalendarItem, addDays, formatDateKey, getWeekStart } from './MiniWeekCalendar'

interface DatedItem extends MiniCalendarItem {
  dueDate: string
}

interface SchoolWorkMiniCalendarProps {
  userId: string
  classrooms: ClassroomWithDetails[]
}

/** Compact week-at-a-glance school work calendar for the home card carousel.
 *  See SchoolWorkManager for the full academics-page version this links out to. */
export default function SchoolWorkMiniCalendar({ userId, classrooms }: SchoolWorkMiniCalendarProps) {
  const [items, setItems] = useState<DatedItem[]>([])
  const [loading, setLoading] = useState(true)
  const weekStart = useMemo(() => getWeekStart(new Date()), [])

  const loadData = useCallback(async () => {
    if (classrooms.length === 0) { setItems([]); setLoading(false); return }
    setLoading(true)
    try {
      const fileArrays = await Promise.all(classrooms.map(c => fetchAllFilesForClassroom(c.id)))
      const dated = fileArrays.flat().filter(f => f.due_date)
      const progress = dated.length > 0 ? await fetchProgressForStudent(userId, dated.map(f => f.id)) : []
      const progressMap = new Map<string, FileStatus>(progress.map(p => [p.file_id, p.status]))
      const fileItems: DatedItem[] = dated.map(f => ({
        id: f.id,
        title: f.title,
        dueDate: f.due_date as string,
        done: progressMap.get(f.id) === 'completed',
      }))

      const fmt = (d: Date) => formatDateKey(d)
      const homework = await fetchStudentHomeroomTasks(userId, fmt(addDays(weekStart, -1)), fmt(addDays(weekStart, 7)))
      const hwItems: DatedItem[] = homework
        .filter(t => t.due_date)
        .map(t => ({
          id: t.id,
          title: t.title,
          dueDate: t.due_date as string,
          done: t.my_status === 'checked' || (t.my_status === 'done' && !t.require_check),
        }))

      setItems([...fileItems, ...hwItems])
    } catch (err) {
      console.error('Failed to load school work for home calendar:', err)
      setItems([])
    }
    setLoading(false)
  }, [classrooms, userId, weekStart])

  useEffect(() => { loadData() }, [loadData])

  const itemsByDay = useMemo(() => {
    const map = new Map<string, MiniCalendarItem[]>()
    for (const item of items) {
      if (!map.has(item.dueDate)) map.set(item.dueDate, [])
      map.get(item.dueDate)!.push(item)
    }
    return map
  }, [items])

  return <MiniWeekCalendar itemsByDay={itemsByDay} loading={loading} accent="violet" />
}
