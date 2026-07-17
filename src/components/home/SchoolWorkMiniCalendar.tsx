'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import { CheckCircle2 } from 'lucide-react'
import {
  ClassroomWithDetails, FileStatus, fetchAllFilesForClassroom, fetchProgressForStudent,
} from '@/lib/classrooms'
import { fetchStudentHomeroomTasks } from '@/lib/smartboard'

interface MiniWorkItem {
  id: string
  title: string
  dueDate: string
  done: boolean
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface SchoolWorkMiniCalendarProps {
  userId: string
  classrooms: ClassroomWithDetails[]
}

// Below this card width there isn't room for six normal-sized columns to sit
// comfortably alongside an expanded one at 3x, so narrow (phone-width) cards
// push the expanded/collapsed ratio up to 6x to make the open day legible.
const NARROW_WIDTH = 480

/** Compact week-at-a-glance school work calendar for the home card carousel.
 *  Today's column starts expanded (3x on wide cards, 6x on narrow/phone-width
 *  ones); clicking another day swaps which column is expanded. See
 *  SchoolWorkManager for the full academics-page version this links out to. */
export default function SchoolWorkMiniCalendar({ userId, classrooms }: SchoolWorkMiniCalendarProps) {
  const [items, setItems] = useState<MiniWorkItem[]>([])
  const [loading, setLoading] = useState(true)

  const rootRef = useRef<HTMLDivElement>(null)
  const [isNarrow, setIsNarrow] = useState(true)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setIsNarrow(el.offsetWidth < NARROW_WIDTH)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const expandRatio = isNarrow ? 6 : 3

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const [expandedDate, setExpandedDate] = useState<Date>(today)
  const weekStart = useMemo(() => getWeekStart(today), [today])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const loadData = useCallback(async () => {
    if (classrooms.length === 0) { setItems([]); setLoading(false); return }
    setLoading(true)
    try {
      const fileArrays = await Promise.all(classrooms.map(c => fetchAllFilesForClassroom(c.id)))
      const dated = fileArrays.flat().filter(f => f.due_date)
      const progress = dated.length > 0 ? await fetchProgressForStudent(userId, dated.map(f => f.id)) : []
      const progressMap = new Map<string, FileStatus>(progress.map(p => [p.file_id, p.status]))
      const fileItems: MiniWorkItem[] = dated.map(f => ({
        id: f.id,
        title: f.title,
        dueDate: f.due_date as string,
        done: progressMap.get(f.id) === 'completed',
      }))

      const pad = (n: number) => String(n).padStart(2, '0')
      const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const homework = await fetchStudentHomeroomTasks(userId, fmt(addDays(weekStart, -1)), fmt(addDays(weekStart, 7)))
      const hwItems: MiniWorkItem[] = homework
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
    const map = new Map<string, MiniWorkItem[]>()
    for (const item of items) {
      const key = formatDateKey(parseDate(item.dueDate))
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return map
  }, [items])

  return (
    <div ref={rootRef} className="glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="spinner" />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {weekDays.map((day, i) => {
            const key = formatDateKey(day)
            const dayItems = itemsByDay.get(key) ?? []
            const isToday = isSameDay(day, today)
            const isExpanded = isSameDay(day, expandedDate)
            const isLast = i === 6
            const collapsedPreview = dayItems.slice(0, 3)
            const collapsedOverflow = dayItems.length - collapsedPreview.length

            return (
              <div
                key={key}
                onClick={() => setExpandedDate(day)}
                style={{ flex: isExpanded ? expandRatio : 1, transition: 'flex 0.35s ease', minWidth: 0 }}
                className={`flex flex-col cursor-pointer select-none ${!isLast ? 'border-r border-white/25' : ''} ${isToday ? 'bg-violet-500/10' : ''}`}
              >
                <div className={`px-1 py-2 text-center flex-shrink-0 transition-colors duration-300 ${isExpanded ? 'bg-violet-500/15' : ''}`}>
                  <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{DAY_LETTERS[i]}</p>
                  <p className={`text-sm font-bold leading-tight mt-0.5 ${isToday ? 'text-violet-600' : 'text-slate-700'}`}>{day.getDate()}</p>
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-hide px-1 pb-2 space-y-1 min-w-0">
                  {dayItems.length === 0 ? (
                    isExpanded && <p className="text-[10px] text-slate-400 text-center mt-4">Nothing due</p>
                  ) : isExpanded ? (
                    dayItems.map(item => (
                      <div
                        key={item.id}
                        className={`flex items-center gap-1 px-1.5 py-1 rounded-lg text-[10px] leading-tight ${item.done ? 'bg-emerald-50 text-emerald-700' : 'bg-white/60 text-slate-600'}`}
                      >
                        {item.done
                          ? <CheckCircle2 size={10} className="flex-shrink-0 text-emerald-500" />
                          : <div className="w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0" />}
                        <span className="truncate">{item.title}</span>
                      </div>
                    ))
                  ) : (
                    <>
                      {collapsedPreview.map(item => (
                        <p
                          key={item.id}
                          title={item.title}
                          className={`text-[8px] leading-tight truncate text-center ${item.done ? 'text-emerald-500' : 'text-slate-500'}`}
                        >
                          {item.title}
                        </p>
                      ))}
                      {collapsedOverflow > 0 && (
                        <p className="text-[8px] leading-tight text-center text-violet-500 font-semibold">+{collapsedOverflow}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
