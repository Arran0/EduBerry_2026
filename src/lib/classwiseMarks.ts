/**
 * Class-wide marks: the ordering, the single-column mark format, the class
 * averages and the workbook the Export preview writes.
 *
 * Pure of React so the format the teacher signs off on in the preview is the
 * one the file gets — and so that format can be tested rather than eyeballed.
 */

import { UserProfile } from './supabase'
import { ClasswiseCellData, ClasswiseSubject } from './classrooms'
import { gradeLetter } from './reportCardGrading'

/** How the matrix and the export are ordered. `subject` sorts on one column's
 *  marks; `overall` on the row total; `name` alphabetically. */
export type ClasswiseSort =
  | { by: 'name'; dir: SortDir }
  | { by: 'overall'; dir: SortDir }
  | { by: 'subject'; classroomId: string; dir: SortDir }

export type SortDir = 'asc' | 'desc'

/** Drops a pointless ".00"/".0" so a whole mark prints as "45", not "45.00",
 *  while a scaled one still shows the decimal it needs. */
export function num(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * One mark, as one string: "150 (75%)".
 *
 * The three columns this replaces (obtained, max, percent) said the same thing
 * three times over. The maximum belongs in the column heading, because it is
 * the same for the whole column — except for a student who did not sit every
 * assessment, whose own denominator is smaller and is therefore spelled out
 * rather than silently implied.
 */
export function markCell(obtained: number, attemptedMax: number, columnMax: number): string {
  if (attemptedMax <= 0) return '—'
  const pct = (obtained / attemptedMax) * 100
  const shortfall = Math.abs(attemptedMax - columnMax) > 0.005
  return shortfall
    ? `${num(obtained)}/${num(attemptedMax)} (${pct.toFixed(1)}%)`
    : `${num(obtained)} (${pct.toFixed(1)}%)`
}

/** A student's row totalled across every subject. */
export function overallOf(
  studentId: string,
  subjects: ClasswiseSubject[],
  cellData: Record<string, Record<string, ClasswiseCellData>>,
): { obtained: number; max: number } {
  let obtained = 0
  let max = 0
  for (const s of subjects) {
    const cell = cellData[studentId]?.[s.classroomId]
    if (cell?.hasAnyMark) { obtained += cell.obtained; max += cell.max }
  }
  return { obtained: Math.round(obtained * 100) / 100, max: Math.round(max * 100) / 100 }
}

/** The percentage a sort compares on — -1 for a student with nothing marked,
 *  so they collect at one end rather than scattering through the order. */
export function sortScore(
  studentId: string,
  sort: ClasswiseSort,
  subjects: ClasswiseSubject[],
  cellData: Record<string, Record<string, ClasswiseCellData>>,
): number {
  if (sort.by === 'subject') {
    const cell = cellData[studentId]?.[sort.classroomId]
    return cell?.hasAnyMark && cell.max > 0 ? cell.obtained / cell.max : -1
  }
  const { obtained, max } = overallOf(studentId, subjects, cellData)
  return max > 0 ? obtained / max : -1
}

export function sortStudents(
  students: UserProfile[],
  sort: ClasswiseSort,
  subjects: ClasswiseSubject[],
  cellData: Record<string, Record<string, ClasswiseCellData>>,
): UserProfile[] {
  return [...students].sort((a, b) => {
    if (sort.by === 'name') {
      const cmp = a.full_name.localeCompare(b.full_name)
      return sort.dir === 'asc' ? cmp : -cmp
    }
    const diff = sortScore(a.id, sort, subjects, cellData) - sortScore(b.id, sort, subjects, cellData)
    // Equal scores fall back to the name, so the order is stable and readable
    // rather than left to the sort's own tie-breaking.
    if (Math.abs(diff) < 1e-9) return a.full_name.localeCompare(b.full_name)
    return sort.dir === 'asc' ? diff : -diff
  })
}

/** Per-subject and overall class averages — the mean mark a student scored,
 *  counting only the students who have marks in that column. */
export interface ColumnAverage {
  /** Mean obtained per student who sat it. */
  mean: number
  /** Mean denominator those students were marked against. */
  meanMax: number
  pct: number | null
  counted: number
}

export function averageOf(values: { obtained: number; max: number }[]): ColumnAverage {
  const scored = values.filter(v => v.max > 0)
  if (scored.length === 0) return { mean: 0, meanMax: 0, pct: null, counted: 0 }
  const obtained = scored.reduce((s, v) => s + v.obtained, 0)
  const max = scored.reduce((s, v) => s + v.max, 0)
  return {
    mean: Math.round((obtained / scored.length) * 100) / 100,
    meanMax: Math.round((max / scored.length) * 100) / 100,
    pct: (obtained / max) * 100,
    counted: scored.length,
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

export interface ExportOptions {
  includeComponents: boolean
  sort: ClasswiseSort
}

export interface ExportTable {
  headers: string[]
  rows: string[][]
}

/**
 * The exact table the workbook is written from. The preview renders this too,
 * so what the teacher approves is what lands in the file rather than a
 * lookalike built by separate code.
 */
export function buildExportTable(
  students: UserProfile[],
  subjects: ClasswiseSubject[],
  cellData: Record<string, Record<string, ClasswiseCellData>>,
  opts: ExportOptions,
): ExportTable {
  const splitSubjects = subjects.filter(s => s.componentNames.length > 0)
  const withComponents = opts.includeComponents && splitSubjects.length > 0

  const headers = [
    'Student Name',
    'Grade',
    'Section',
    ...subjects.flatMap(s => [
      ...(withComponents
        ? s.componentNames.map(name => `${s.subject} · ${name} (out of ${num(s.componentMax[name] ?? 0)})`)
        : []),
      `${s.subject} (out of ${num(s.maxMarks)})`,
    ]),
    `Overall (out of ${num(subjects.reduce((sum, s) => sum + s.maxMarks, 0))})`,
    'Overall %',
    'Grade Band',
  ]

  const rows = sortStudents(students, opts.sort, subjects, cellData).map(student => {
    const cells: string[] = [
      student.full_name,
      student.grade != null ? String(student.grade) : '',
      student.section ?? '',
    ]

    for (const s of subjects) {
      const cell = cellData[student.id]?.[s.classroomId]
      if (withComponents) {
        for (const name of s.componentNames) {
          const part = cell?.components.find(c => c.name === name)
          cells.push(part ? markCell(part.obtained, part.max, s.componentMax[name] ?? part.max) : '—')
        }
      }
      cells.push(cell?.hasAnyMark ? markCell(cell.obtained, cell.max, s.maxMarks) : '—')
    }

    const total = overallOf(student.id, subjects, cellData)
    const columnMax = subjects.reduce((sum, s) => sum + s.maxMarks, 0)
    const pct = total.max > 0 ? (total.obtained / total.max) * 100 : null
    cells.push(total.max > 0 ? markCell(total.obtained, total.max, columnMax) : '—')
    cells.push(pct != null ? `${pct.toFixed(1)}%` : '—')
    cells.push(pct != null ? gradeLetter(pct).letter : '—')
    return cells
  })

  return { headers, rows }
}

/** Writes the approved table as a real .xlsx — the marks are strings like
 *  "150 (75%)", which a CSV would have left Excel free to reinterpret. */
export async function downloadClasswiseWorkbook(
  table: ExportTable,
  grade: number,
  section: string,
  reportCardTitle: string,
) {
  const XLSX = await import('xlsx')
  const title = `Grade ${grade} · Section ${section} — ${reportCardTitle}`
  const aoa = [[title], [], table.headers, ...table.rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = table.headers.map((h, i) => ({ wch: Math.min(38, Math.max(12, i === 0 ? 24 : h.length + 2)) }))
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, table.headers.length - 1) } }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Class Marks')
  XLSX.writeFile(wb, `Class_Marks_Grade${grade}${section}_${reportCardTitle.replace(/\s+/g, '_')}.xlsx`)
}
