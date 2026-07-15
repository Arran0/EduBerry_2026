// Weekly/monthly teacher planner: template generation, xlsx parsing, and
// bulk task creation. Mirrors the school's existing "DAY WISE & PERIOD WISE
// PLANNER" spreadsheet format (DATE | DAY | PERIOD-1 | PERIOD-2 | ...).
'use client'

import * as XLSX from 'xlsx'
import { TASK_SLOTS } from './taskSlots'
import { createTask, NewTaskInput, Task } from './tasks'

export type PlannerMode = 'week' | 'month'

export interface PlannerRow {
  /** ISO date, e.g. 2026-07-15 */
  date: string
  /** Full weekday name, e.g. Wednesday */
  day: string
  /** One entry per period column, index-aligned with periodLabels */
  periods: string[]
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function toISODate(d: Date): string {
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function weekdayName(d: Date): string {
  return WEEKDAY_NAMES[d.getDay()]
}

function displayDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}-${MONTH_SHORT[d.getMonth()]}-${d.getFullYear()}`
}

/** Monday of the ISO week containing `date` (matches WeeklyCalendar's week start). */
function mondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Builds the Date/Day columns for a blank planner grid — 7 days for a week
 * (Monday-start, matching the calendar) or every day of the chosen month.
 */
export function generatePlannerDates(mode: PlannerMode, anchorISO: string): { date: string; day: string }[] {
  const dates: Date[] = []
  if (mode === 'week') {
    const start = mondayOf(new Date(anchorISO + 'T00:00:00'))
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      dates.push(d)
    }
  } else {
    // anchorISO is "YYYY-MM"
    const [y, m] = anchorISO.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    for (let day = 1; day <= daysInMonth; day++) {
      dates.push(new Date(y, m - 1, day))
    }
  }
  return dates.map(d => ({ date: toISODate(d), day: weekdayName(d) }))
}

export function emptyPlannerRows(mode: PlannerMode, anchorISO: string, periodCount: number): PlannerRow[] {
  return generatePlannerDates(mode, anchorISO).map(({ date, day }) => ({
    date, day, periods: Array.from({ length: periodCount }, () => ''),
  }))
}

export function defaultPeriodLabels(periodCount: number): string[] {
  return Array.from({ length: periodCount }, (_, i) => `PERIOD-${i + 1}`)
}

// ── Template / export ───────────────────────────────────────────────────────

export interface PlannerSheetOptions {
  grade?: string
  subject?: string
  periodLabels: string[]
  rows: PlannerRow[]
}

export function buildPlannerWorkbook({ grade, subject, periodLabels, rows }: PlannerSheetOptions): XLSX.WorkBook {
  const periodCount = periodLabels.length
  const totalCols = 2 + periodCount
  const gradeSpan = Math.ceil(totalCols / 2)

  const aoa: (string)[][] = []
  aoa.push(Array(totalCols).fill(''))
  const titleRow = Array(totalCols).fill('')
  titleRow[0] = 'DAY WISE & PERIOD WISE PLANNER'
  aoa.push(titleRow)
  const metaRow = Array(totalCols).fill('')
  metaRow[0] = `GRADE: ${grade || ''}`
  metaRow[gradeSpan] = `SUBJECT: ${subject || ''}`
  aoa.push(metaRow)
  aoa.push(['DATE', 'DAY', ...periodLabels])
  for (const row of rows) {
    const d = new Date(row.date + 'T00:00:00')
    aoa.push([displayDate(d), row.day.toUpperCase(), ...row.periods.map(p => p ?? '')])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 13 }, { wch: 13 }, ...periodLabels.map(() => ({ wch: 32 }))]
  ws['!merges'] = [
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: gradeSpan - 1 } },
    { s: { r: 2, c: gradeSpan }, e: { r: 2, c: totalCols - 1 } },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Planner')
  return wb
}

export function downloadPlannerTemplate(opts: {
  mode: PlannerMode
  anchor: string
  grade?: string
  subject?: string
  periodCount: number
  fileName?: string
}): void {
  const { mode, anchor, grade, subject, periodCount, fileName } = opts
  const rows = emptyPlannerRows(mode, anchor, periodCount)
  const wb = buildPlannerWorkbook({ grade, subject, periodLabels: defaultPeriodLabels(periodCount), rows })
  XLSX.writeFile(wb, fileName || `planner-template-${mode}.xlsx`)
}

export function downloadPlannerRows(opts: {
  grade?: string
  subject?: string
  periodLabels: string[]
  rows: PlannerRow[]
  fileName?: string
}): void {
  const wb = buildPlannerWorkbook(opts)
  XLSX.writeFile(wb, opts.fileName || 'planner.xlsx')
}

// ── Import / parsing ────────────────────────────────────────────────────────

export interface ParsedPlanner {
  grade?: string
  subject?: string
  periodLabels: string[]
  rows: PlannerRow[]
}

function normalizeCell(v: unknown): string {
  return String(v ?? '').trim()
}

function parseDateCell(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v
  const s = normalizeCell(v)
  if (!s) return null
  // dd-mmm-yyyy / dd/mm/yyyy / yyyy-mm-dd all parse reasonably via Date, but
  // dd/mm/yyyy is ambiguous in JS's Date parser (reads as mm/dd), so handle it explicitly.
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) {
    const [, dd, mm, yyyy] = dmy
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/** Parses an uploaded planner workbook. Tolerant of the exact header row position and grade/subject placement. */
export function parsePlannerWorkbook(workbook: XLSX.WorkBook): ParsedPlanner | { error: string } {
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return { error: 'The file has no sheets.' }

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false })

  let headerRowIdx = -1
  let dateCol = -1
  let dayCol = -1
  const periodCols: number[] = []
  const periodLabels: string[] = []

  for (let r = 0; r < Math.min(aoa.length, 15); r++) {
    const row = aoa[r] || []
    const dIdx = row.findIndex(c => normalizeCell(c).toLowerCase() === 'date')
    const wIdx = row.findIndex(c => normalizeCell(c).toLowerCase() === 'day')
    if (dIdx !== -1 && wIdx !== -1) {
      headerRowIdx = r
      dateCol = dIdx
      dayCol = wIdx
      row.forEach((c, i) => {
        const label = normalizeCell(c)
        if (i !== dIdx && i !== wIdx && /^period/i.test(label)) {
          periodCols.push(i)
          periodLabels.push(label)
        }
      })
      break
    }
  }

  if (headerRowIdx === -1 || periodCols.length === 0) {
    return { error: 'Could not find DATE / DAY / PERIOD-N columns. Please use the downloaded template format.' }
  }

  let grade: string | undefined
  let subject: string | undefined
  for (let r = 0; r < headerRowIdx; r++) {
    for (const cell of aoa[r] || []) {
      const s = normalizeCell(cell)
      const gMatch = s.match(/grade\s*:?\s*(.*)/i)
      const sMatch = s.match(/subject\s*:?\s*(.*)/i)
      if (gMatch && gMatch[1].replace(/_/g, '').trim()) grade = gMatch[1].replace(/_+$/, '').trim()
      if (sMatch && sMatch[1].replace(/_/g, '').trim()) subject = sMatch[1].replace(/_+$/, '').trim()
    }
  }

  const rows: PlannerRow[] = []
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    const parsedDate = parseDateCell(row[dateCol])
    if (!parsedDate) continue
    const day = normalizeCell(row[dayCol]) || weekdayName(parsedDate)
    const periods = periodCols.map(c => normalizeCell(row[c]))
    rows.push({ date: toISODate(parsedDate), day, periods })
  }

  if (rows.length === 0) return { error: 'No dated rows found in the sheet.' }

  return { grade, subject, periodLabels, rows }
}

// ── Bulk task creation ──────────────────────────────────────────────────────

export function buildTaskInputsFromPlanner(opts: {
  rows: PlannerRow[]
  periodSlotIndices: number[]
  assigneeId: string
  grade?: string
  subject?: string
}): NewTaskInput[] {
  const { rows, periodSlotIndices, assigneeId, grade, subject } = opts
  const context = [grade && `Grade: ${grade}`, subject && `Subject: ${subject}`].filter(Boolean).join(' · ')

  const inputs: NewTaskInput[] = []
  for (const row of rows) {
    row.periods.forEach((content, i) => {
      const title = content.trim()
      if (!title) return
      const slot = TASK_SLOTS[periodSlotIndices[i]]
      inputs.push({
        title,
        description: context || undefined,
        due_date: row.date,
        timing: slot?.start,
        end_time: slot?.end,
        assignee_ids: [assigneeId],
      })
    })
  }
  return inputs
}

export async function importPlannerTasks(
  inputs: NewTaskInput[],
  createdBy: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ created: Task[]; failed: number }> {
  const created: Task[] = []
  let failed = 0
  for (let i = 0; i < inputs.length; i++) {
    const task = await createTask(inputs[i], createdBy)
    if (task) created.push(task)
    else failed++
    onProgress?.(i + 1, inputs.length)
  }
  return { created, failed }
}
