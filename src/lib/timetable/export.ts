'use client'

import * as XLSX from 'xlsx'
import { WEEKDAY_LABELS } from './types'
import type { PeriodSlot, TimetableEntry, Weekday } from './types'

// Builds a "Period × Day" sheet for one set of entries and triggers a download.
// `secondary` adds a second line of context to each cell (teacher or class).
export function exportTimetableToExcel(opts: {
  fileName: string
  sheetName: string
  days: Weekday[]
  slots: PeriodSlot[]
  entries: TimetableEntry[]
  secondary?: (entry: TimetableEntry) => string | null
}): void {
  const { fileName, sheetName, days, slots, entries, secondary } = opts

  const byCell = new Map<string, TimetableEntry>()
  for (const e of entries) byCell.set(`${e.day}__${e.slot_id}`, e)

  // Header row: Period | Mon | Tue | ...
  const header = ['Period', ...days.map((d) => WEEKDAY_LABELS[d])]
  const rows: string[][] = [header]

  for (const slot of slots) {
    const timeLabel = `${slot.label ?? ''} ${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`.trim()
    if (slot.is_break) {
      rows.push([timeLabel, ...days.map(() => 'Break')])
      continue
    }
    const row = [timeLabel]
    for (const day of days) {
      const e = byCell.get(`${day}__${slot.id}`)
      if (!e) {
        row.push('')
        continue
      }
      const parts = [e.subject?.name ?? 'Lesson']
      const sub = secondary?.(e)
      if (sub) parts.push(sub)
      if (e.room?.name) parts.push(e.room.name)
      row.push(parts.join('\n'))
    }
    rows.push(row)
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 18 }, ...days.map(() => ({ wch: 22 }))]

  const wb = XLSX.utils.book_new()
  // Excel sheet names cap at 31 chars and disallow some characters.
  XLSX.utils.book_append_sheet(wb, ws, sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Timetable')
  XLSX.writeFile(wb, fileName)
}
