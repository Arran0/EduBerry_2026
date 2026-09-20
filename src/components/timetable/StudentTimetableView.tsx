'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { CalendarRange, Loader2, Download } from 'lucide-react'
import { fetchTimetableForStudent, entryTeacherLabel } from '@/lib/timetable'
import type { TimetableViewData } from '@/lib/timetable'
import { exportTimetableToExcel } from '@/lib/timetable/export'
import TimetableGrid from './TimetableGrid'

export default function StudentTimetableView({ studentId }: { studentId: string }) {
  const [loading, setLoading] = useState(true)
  const [views, setViews] = useState<TimetableViewData[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setViews(await fetchTimetableForStudent(studentId))
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-[#A1A1AA]">
        <Loader2 className="animate-spin" size={22} />
      </div>
    )
  }

  if (views.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="space-y-8">
      {views.map(({ config, slots, timetable, entries }) => (
        <div key={config.id} className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <p className="text-sm text-[#71717A]">
                <span className="font-medium text-[#18181B]">{config.name}</span>
                {config.academic_year ? ` · ${config.academic_year}` : ''}
              </p>
              {timetable.name && <p className="text-xs text-[#A1A1AA]">{timetable.name}</p>}
            </div>
            <button
              onClick={() =>
                exportTimetableToExcel({
                  fileName: `timetable-${config.name.toLowerCase().replace(/\s+/g, '-')}.xlsx`,
                  sheetName: config.name,
                  days: config.working_days,
                  slots,
                  entries,
                  secondary: (e) => entryTeacherLabel(e),
                })
              }
              className="inline-flex items-center gap-1.5 text-[#18181B] bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] px-3 py-1.5 text-sm font-medium transition-colors"
            >
              <Download size={14} /> Export
            </button>
          </div>
          <TimetableGrid
            days={config.working_days}
            slots={slots}
            entries={entries}
            secondary={(e) => entryTeacherLabel(e)}
          />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="bg-white border border-[#D4D4D8] p-10 text-center">
      <div className="w-14 h-14 mx-auto bg-[#27272A] flex items-center justify-center mb-4">
        <CalendarRange className="w-7 h-7 text-[#B8983C]" strokeWidth={1.5} />
      </div>
      <h2 className="font-display text-lg font-semibold text-[#18181B]">No timetable yet</h2>
      <p className="text-[#71717A] text-sm mt-1">
        Once your school publishes the timetable for your class, your weekly schedule will appear here.
      </p>
    </div>
  )
}
