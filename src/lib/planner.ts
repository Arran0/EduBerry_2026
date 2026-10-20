// Weekly/monthly teacher planner: template generation, xlsx parsing, and
// bulk task creation. Mirrors the school's existing "DAY WISE & PERIOD WISE
// PLANNER" spreadsheet format (DATE | DAY | PERIOD-1 | PERIOD-2 | ...).
// Period count and timings come from the teacher's real Timetable (see
// fetchTeacherPeriodSlots in taskPeriods.ts) — not a manual input.
'use client'

import type { WorkBook } from 'xlsx'
import { TaskSlot } from './taskSlots'
import { createTask, NewTaskInput, Task } from './tasks'
import { supabase } from './supabase'

export type PlannerMode = 'week' | 'month'

export interface PlannerRow {
  /** ISO date, e.g. 2026-07-15 */
  date: string
  /** Full weekday name, e.g. Wednesday */
  day: string
  /** One entry per period column, index-aligned with the period slot list */
  periods: string[]
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
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

/** Column headers for a period slot list, e.g. "Period 1 (9:10–9:50)". */
export function periodColumnLabels(slots: TaskSlot[]): string[] {
  return slots.map(s => `${s.label} (${s.start}–${s.end})`)
}

// ── Template / export ───────────────────────────────────────────────────────

// The spreadsheet library is ~400 kB, and most visits to the Task Manager never
// touch a spreadsheet: it loads the first time someone downloads or uploads one.
const loadXLSX = () => import('xlsx')

/** Larger than any planner a month of periods could fill. */
export const PLANNER_MAX_BYTES = 2 * 1024 * 1024

interface PlannerSheetOptions {
  periodLabels: string[]
  rows: PlannerRow[]
}

function buildPlannerWorkbook(XLSX: typeof import('xlsx'), { periodLabels, rows }: PlannerSheetOptions): WorkBook {
  const totalCols = 2 + periodLabels.length

  const aoa: string[][] = []
  const titleRow = Array(totalCols).fill('')
  titleRow[0] = 'DAY WISE & PERIOD WISE PLANNER'
  aoa.push(titleRow)
  aoa.push(['DATE', 'DAY', ...periodLabels])
  for (const row of rows) {
    const d = new Date(row.date + 'T00:00:00')
    aoa.push([displayDate(d), row.day.toUpperCase(), ...row.periods.map(p => p ?? '')])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 13 }, { wch: 13 }, ...periodLabels.map(() => ({ wch: 32 }))]
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Planner')
  return wb
}

export async function downloadPlannerTemplate(opts: {
  mode: PlannerMode
  anchor: string
  periodSlots: TaskSlot[]
  fileName?: string
}): Promise<void> {
  const { mode, anchor, periodSlots, fileName } = opts
  const XLSX = await loadXLSX()
  const rows = emptyPlannerRows(mode, anchor, periodSlots.length)
  const wb = buildPlannerWorkbook(XLSX, { periodLabels: periodColumnLabels(periodSlots), rows })
  XLSX.writeFile(wb, fileName || `planner-template-${mode}.xlsx`)
}

export async function downloadPlannerRows(opts: {
  periodLabels: string[]
  rows: PlannerRow[]
  fileName?: string
}): Promise<void> {
  const XLSX = await loadXLSX()
  const wb = buildPlannerWorkbook(XLSX, opts)
  XLSX.writeFile(wb, opts.fileName || 'planner.xlsx')
}

// ── Import / parsing ────────────────────────────────────────────────────────

export interface ParsedPlanner {
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

/** Reads an uploaded planner file. Size-capped before the parser ever sees it. */
export async function readPlannerFile(file: File): Promise<ParsedPlanner | { error: string }> {
  if (file.size > PLANNER_MAX_BYTES) return { error: 'That file is larger than 2 MB. A planner is a few kilobytes; check you picked the right file.' }
  try {
    const [XLSX, buf] = await Promise.all([loadXLSX(), file.arrayBuffer()])
    const workbook = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true })
    return parsePlannerWorkbook(XLSX, workbook)
  } catch {
    return { error: 'The file could not be read. Upload an .xlsx file, ideally one made from the template.' }
  }
}

/** Parses an uploaded planner workbook. Tolerant of the exact header row position. */
export function parsePlannerWorkbook(XLSX: typeof import('xlsx'), workbook: WorkBook): ParsedPlanner | { error: string } {
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

  return { periodLabels, rows }
}

// ── Bulk task creation ──────────────────────────────────────────────────────

export function buildTaskInputsFromPlanner(opts: {
  rows: PlannerRow[]
  periodSlots: (TaskSlot | undefined)[]
  assigneeId: string
}): NewTaskInput[] {
  const { rows, periodSlots, assigneeId } = opts

  const inputs: NewTaskInput[] = []
  for (const row of rows) {
    row.periods.forEach((content, i) => {
      const title = content.trim()
      if (!title) return
      const slot = periodSlots[i]
      inputs.push({
        title,
        due_date: row.date,
        timing: slot?.start,
        end_time: slot?.end,
        assignee_ids: [assigneeId],
      })
    })
  }
  return inputs
}

/** Rows per insert: a month of eight periods is ~250 tasks, so one or two. */
const IMPORT_CHUNK = 200

/**
 * Creates the planner's tasks in batches: one insert for a chunk of tasks and
 * one for their assignees, rather than three round trips per task. Planner
 * rows are plain — one assignee, no checklist — so the rows of a chunk that
 * share an assignee are interchangeable and need no pairing by position.
 * Anything richer goes through createTask one at a time.
 */
export async function importPlannerTasks(
  inputs: NewTaskInput[],
  createdBy: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ created: Task[]; failed: number }> {
  const created: Task[] = []
  let failed = 0
  let done = 0
  const total = inputs.length

  const plain = inputs.filter(i => i.assignee_ids.length === 1 && !i.checklist_items?.length)
  const rich = inputs.filter(i => !plain.includes(i))

  const byAssignee = new Map<string, NewTaskInput[]>()
  for (const input of plain) {
    const id = input.assignee_ids[0]
    const list = byAssignee.get(id)
    if (list) list.push(input)
    else byAssignee.set(id, [input])
  }

  for (const [assigneeId, list] of byAssignee) {
    for (let at = 0; at < list.length; at += IMPORT_CHUNK) {
      const chunk = list.slice(at, at + IMPORT_CHUNK)
      const { data: tasks, error } = await supabase
        .from('tasks')
        // The same row createTask writes for a plain task.
        .insert(chunk.map(i => ({
          title: i.title,
          description: null,
          due_date: i.due_date || null,
          timing: i.timing || null,
          end_time: i.end_time || null,
          require_check: false,
          tag: null,
          bonus_points: 0,
          recurrence: 'none',
          created_by: createdBy,
        })))
        .select()
      if (error || !tasks) {
        failed += chunk.length
      } else {
        const { error: aErr } = await supabase
          .from('task_assignees')
          .insert(tasks.map(t => ({ task_id: t.id, user_id: assigneeId })))
        if (aErr) {
          // A task nobody is assigned to shows up on no calendar — take the
          // chunk back out rather than leave it invisible.
          await supabase.from('tasks').delete().in('id', tasks.map(t => t.id))
          failed += chunk.length
        } else {
          created.push(...(tasks as Task[]))
        }
      }
      done += chunk.length
      onProgress?.(done, total)
    }
  }

  for (const input of rich) {
    const task = await createTask(input, createdBy)
    if (task) created.push(task)
    else failed++
    onProgress?.(++done, total)
  }
  return { created, failed }
}
