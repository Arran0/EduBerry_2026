'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { CalendarRange, Download } from 'lucide-react'
import { fetchTimetableForStaff } from '@/lib/timetable'
import type { TimetableViewData } from '@/lib/timetable'
import { fetchAllHomerooms } from '@/lib/homerooms'
import { BTN_NEUTRAL, Loading } from './ui'
import TimetableGrid from './TimetableGrid'
import DateChangesNotice from './DateChangesNotice'

export default function StaffTimetableView({ staffId }: { staffId: string }) {
  const [loading, setLoading] = useState(true)
  const [views, setViews] = useState<TimetableViewData[]>([])
  const [homeroomNames, setHomeroomNames] = useState<Map<string, string>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    const [v, homerooms] = await Promise.all([fetchTimetableForStaff(staffId), fetchAllHomerooms()])
    setViews(v)
    setHomeroomNames(new Map(homerooms.map((h) => [h.id, h.name])))
    setLoading(false)
  }, [staffId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return <Loading />
  }

  if (views.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="space-y-8 sm:space-y-10">
      {views.map(({ config, slots, timetable, entries, overrides }) => (
        <section key={config.id} className="space-y-3">
          <div className="flex items-end justify-between gap-x-3 gap-y-2 flex-wrap">
            <div className="min-w-0 flex-1 basis-[200px]">
              <h2 className="font-display text-[17px] sm:text-[19px] font-bold text-slate-900 leading-snug headline break-words">
                {config.name}
              </h2>
              <p className="text-[12.5px] text-slate-500 break-words">
                {[config.academic_year, `${entries.length} periods a week`, timetable.name].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button
              onClick={async () => {
                // Loaded on demand: most visits never export.
                const { exportTimetableToExcel } = await import('@/lib/timetable/export')
                exportTimetableToExcel({
                  fileName: `teaching-timetable-${config.name.toLowerCase().replace(/\s+/g, '-')}.xlsx`,
                  sheetName: config.name,
                  days: config.working_days,
                  slots,
                  entries,
                  secondary: (e) => homeroomNames.get(e.homeroom_id) ?? 'Class',
                })
              }}
              className={BTN_NEUTRAL}
            >
              <Download size={14} /> Export
            </button>
          </div>
          <TimetableGrid
            days={config.working_days}
            slots={slots}
            entries={entries}
            secondary={(e) => homeroomNames.get(e.homeroom_id) ?? 'Class'}
            overrides={overrides}
          />
          <DateChangesNotice overrides={overrides} slots={slots} />
        </section>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="fx-card fx-bleed px-6 py-12 text-center">
      <span className="icon-chip w-12 h-12 mx-auto mb-3" style={{ background: 'linear-gradient(135deg, #3D3B40, #8B6F47)' }}>
        <CalendarRange className="relative z-10 w-6 h-6 text-white" strokeWidth={1.75} />
      </span>
      <h2 className="font-display text-[17px] font-bold text-slate-900">No teaching schedule yet</h2>
      <p className="text-slate-500 text-[13px] mt-1 max-w-sm mx-auto leading-relaxed">
        The periods you teach appear here once the timetable is published.
      </p>
    </div>
  )
}
