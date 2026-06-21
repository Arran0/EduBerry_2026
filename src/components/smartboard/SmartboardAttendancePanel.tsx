'use client'

import React, { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { fetchHomeroomAttendanceCounts, AttendanceCounts } from '@/lib/smartboard'

const AttendanceMarkSheet = dynamic(() => import('@/components/attendance/AttendanceMarkSheet'))

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA') // YYYY-MM-DD local
}

interface SmartboardAttendancePanelProps {
  homeroomId: string
  homeroomName: string
  markedBy: string
}

const TILES: { key: keyof AttendanceCounts; label: string; cls: string }[] = [
  { key: 'present',  label: 'Present',  cls: 'bg-green-50 text-green-700 border-green-200' },
  { key: 'absent',   label: 'Absent',   cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  { key: 'on_leave', label: 'On Leave', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'on_duty',  label: 'On Duty',  cls: 'bg-teal-50 text-teal-700 border-teal-200' },
]

export default function SmartboardAttendancePanel({ homeroomId, homeroomName, markedBy }: SmartboardAttendancePanelProps) {
  const [counts, setCounts] = useState<AttendanceCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchHomeroomAttendanceCounts(homeroomId, todayISO())
    setCounts(data)
    setLoading(false)
  }, [homeroomId])

  useEffect(() => { load() }, [load])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-bold text-slate-800">Attendance · Today</h2>
        <button
          onClick={() => setSheetOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <ClipboardCheck size={15} /> Open Sheet
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-3">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {TILES.map(t => (
            <div key={t.key} className={`rounded-xl border px-3 py-3 text-center ${t.cls}`}>
              <p className="text-2xl font-bold leading-none">{counts?.[t.key] ?? 0}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide mt-1 opacity-80">{t.label}</p>
            </div>
          ))}
        </div>
      )}

      {sheetOpen && (
        <AttendanceMarkSheet
          homeroomId={homeroomId}
          homeroomName={homeroomName}
          markedBy={markedBy}
          onClose={() => { setSheetOpen(false); load() }}
        />
      )}
    </section>
  )
}
