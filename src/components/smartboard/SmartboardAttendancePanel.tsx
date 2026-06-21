'use client'

import React, { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { ClipboardCheck } from 'lucide-react'
import { fetchHomeroomAttendanceCounts, AttendanceCounts } from '@/lib/smartboard'

const AttendanceMarkSheet = dynamic(() => import('@/components/attendance/AttendanceMarkSheet'))

function todayISO(): string {
  // Must match how the attendance sheet stores its date (UTC-based) so the
  // counts line up with what was marked. Using a local date here silently
  // mismatched the stored rows and showed zeroes.
  return new Date().toISOString().split('T')[0]
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
    <section className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
      {/* Four stat cards + the Open-Sheet button, all the same size in one row. */}
      <div className="grid grid-cols-5 gap-1.5">
        {loading
          ? [0, 1, 2, 3, 4].map(i => (
              <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 h-[52px] animate-pulse" />
            ))
          : (
            <>
              {TILES.map(t => (
                <div key={t.key} className={`rounded-lg border px-1.5 py-1.5 text-center flex flex-col items-center justify-center min-h-[52px] ${t.cls}`}>
                  <p className="text-lg font-bold leading-none">{counts?.[t.key] ?? 0}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wide mt-0.5 opacity-80">{t.label}</p>
                </div>
              ))}
              <button
                onClick={() => setSheetOpen(true)}
                className="rounded-lg border border-indigo-600 bg-indigo-600 hover:bg-indigo-700 text-white px-1.5 py-1.5 text-center flex flex-col items-center justify-center gap-1 min-h-[52px] transition-colors"
                title="Open attendance sheet"
              >
                <ClipboardCheck size={16} />
                <span className="text-[9px] font-semibold uppercase tracking-wide leading-none">Open Sheet</span>
              </button>
            </>
          )}
      </div>

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
