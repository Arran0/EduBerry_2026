'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { CalendarRange, Loader2, Download } from 'lucide-react'
import { fetchTimetableForStaff, fetchTimetableContext } from '@/lib/timetable'
import type { PeriodSlot, TimetableConfig, TimetableEntry } from '@/lib/timetable'
import { exportTimetableToExcel } from '@/lib/timetable/export'
import { fetchAllHomerooms } from '@/lib/homerooms'
import TimetableGrid from './TimetableGrid'

export default function StaffTimetableView({ staffId }: { staffId: string }) {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<TimetableEntry[]>([])
  const [config, setConfig] = useState<TimetableConfig | null>(null)
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [homeroomNames, setHomeroomNames] = useState<Map<string, string>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    const [e, homerooms] = await Promise.all([fetchTimetableForStaff(staffId), fetchAllHomerooms()])
    setEntries(e)
    setHomeroomNames(new Map(homerooms.map((h) => [h.id, h.name])))
    if (e.length > 0) {
      const ctx = await fetchTimetableContext(e[0].timetable_id)
      if (ctx) {
        setConfig(ctx.config)
        setSlots(ctx.slots)
      }
    }
    setLoading(false)
  }, [staffId])

  useEffect(() => {
    load()
  }, [load])

  const periodCount = useMemo(() => entries.length, [entries])

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Loader2 className="animate-spin" size={22} />
      </div>
    )
  }

  if (entries.length === 0 || !config) {
    return <EmptyState />
  }

  const handleExport = () =>
    exportTimetableToExcel({
      fileName: 'my-teaching-timetable.xlsx',
      sheetName: config.name,
      days: config.working_days,
      slots,
      entries,
      secondary: (e) => homeroomNames.get(e.homeroom_id) ?? 'Class',
    })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-700">{config.name}</span>
          {config.academic_year ? ` · ${config.academic_year}` : ''} · {periodCount} periods / week
        </p>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Download size={14} /> Export
        </button>
      </div>
      <TimetableGrid
        days={config.working_days}
        slots={slots}
        entries={entries}
        secondary={(e) => homeroomNames.get(e.homeroom_id) ?? 'Class'}
      />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <CalendarRange className="w-7 h-7 text-slate-500" strokeWidth={1.5} />
      </div>
      <h2 className="font-display text-lg font-semibold text-slate-800">No teaching schedule yet</h2>
      <p className="text-slate-500 text-sm mt-1">
        Once the timetable is published, the periods you teach will appear here as your weekly schedule.
      </p>
    </div>
  )
}
