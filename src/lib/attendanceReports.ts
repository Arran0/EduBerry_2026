import { UserProfile } from './supabase'
import { fetchStaffDirectoryMap } from './staffDetails'
import {
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  HolidayGroup,
  NonWorkingDayGroup,
  enumerateDates,
  fetchAllTrackedStaff,
  fetchAttendanceTimezone,
  fetchDayRulesForRange,
  fetchStaffAttendanceForRange,
} from './attendance'

// ============================================
// Staff attendance documents — the data behind the Report section's
// document popup. Late Summary lives in attendance.ts (fetchLateSummaryReport);
// the Absence & Irregular summary and the Time Tracking report live here.
//
// Both resolve a day the way the on-screen report does: a record wins; with
// no record, a non-working-day rule, then a holiday rule (whole-school, or a
// team rule that names the staff member) excuses the day; any other past or
// present day with no record is Absent.
// ============================================

/** Longest range one document may cover. */
export const REPORT_MAX_DAYS = 31
/**
 * Above this many table rows the in-app PDF preview is skipped. The PDF is laid
 * out in the browser at roughly 35 rows a second, so this keeps a preview to
 * about ten seconds.
 */
export const PREVIEW_ROW_LIMIT = 400
/** Above this many table rows the PDF itself is refused (over a minute to build) — Excel still works. */
export const PDF_ROW_LIMIT = 2500

export type ReportKind = 'late' | 'absence' | 'time'

export interface ReportStaff {
  id: string
  full_name: string
  employee_code: string
  department: string
  designation: string
}

/** A staff member's resolved state for one day. null = a future day, not yet due. */
export type DayState = StaffAttendanceStatus | 'holiday' | 'non_working' | null

export const DAY_STATE_LABELS: Record<Exclude<DayState, null>, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  on_leave: 'On Leave',
  wfh: 'On Duty',
  half_day: 'Half Day',
  e: 'Exception',
  holiday: 'Holiday',
  non_working: 'Non-working',
}

/** Inclusive day count of a range; 0 when the range runs backwards. */
export function rangeDayCount(startDate: string, endDate: string): number {
  if (!startDate || !endDate || startDate > endDate) return 0
  const a = new Date(startDate + 'T12:00:00').getTime()
  const b = new Date(endDate + 'T12:00:00').getTime()
  return Math.round((b - a) / 86_400_000) + 1
}

/** Why a range can't be reported on, or null when it can. */
export function validateReportRange(startDate: string, endDate: string, today: string): string | null {
  if (!startDate || !endDate) return 'Pick both dates.'
  if (startDate > endDate) return 'The start date is after the end date.'
  if (endDate > today) return 'The range can’t end after today.'
  if (rangeDayCount(startDate, endDate) > REPORT_MAX_DAYS) {
    return `A report covers at most ${REPORT_MAX_DAYS} days. Shorten the range.`
  }
  return null
}

function ruleCovers(rules: (HolidayGroup | NonWorkingDayGroup)[] | undefined, staffId: string): boolean {
  return !!rules?.some(r => r.is_default || r.staff_ids.includes(staffId))
}

export function resolveStaffDay(
  date: string,
  staffId: string,
  record: StaffAttendanceRecord | undefined,
  holidays: Map<string, HolidayGroup[]>,
  nonWorking: Map<string, NonWorkingDayGroup[]>,
  today: string,
): DayState {
  if (record) return record.status
  if (ruleCovers(nonWorking.get(date), staffId)) return 'non_working'
  if (ruleCovers(holidays.get(date), staffId)) return 'holiday'
  if (date > today) return null
  return 'absent'
}

/** Minutes between two ISO timestamps, or null if either is missing or they run backwards. */
function spanMinutes(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const ms = new Date(to).getTime() - new Date(from).getTime()
  return ms >= 0 ? Math.round(ms / 60_000) : null
}

/** Clock time in the school's zone (falls back to the device's when unknown). */
export function formatClock(iso: string | null, timezone: string | null): string {
  if (!iso) return ''
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
  try {
    return new Date(iso).toLocaleTimeString('en-US', timezone ? { ...opts, timeZone: timezone } : opts)
  } catch {
    return new Date(iso).toLocaleTimeString('en-US', opts)
  }
}

export function formatReportDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatReportWeekday(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
}

/** "7h 05m" — durations in the time tracking report. */
export function formatWorked(mins: number | null): string {
  if (mins === null) return ''
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

// ── Absence & irregular summary ──────────────────────────────────────────────

export type AbsenceCategory = 'absent' | 'on_leave' | 'half_day' | 'e'

export const ABSENCE_CATEGORY_LABELS: Record<AbsenceCategory, string> = {
  absent: 'Absent',
  on_leave: 'On Leave',
  half_day: 'Half Day',
  e: 'Exception',
}

export interface AbsenceIrregularRow {
  date: string
  staff: ReportStaff
  category: AbsenceCategory
  /** True when there is no record at all — absent because nobody checked in. */
  derived: boolean
  record: StaffAttendanceRecord | null
}

export interface AbsenceIrregularTotals {
  staff: ReportStaff
  absent: number
  on_leave: number
  half_day: number
  e: number
  total: number
}

export interface AbsenceIrregularReport {
  kind: 'absence'
  startDate: string
  endDate: string
  timezone: string | null
  rows: AbsenceIrregularRow[]
  totals: AbsenceIrregularTotals[]
}

const ABSENCE_CATEGORIES = new Set<DayState>(['absent', 'on_leave', 'half_day', 'e'])

export function buildAbsenceIrregularRows(
  staff: ReportStaff[],
  records: StaffAttendanceRecord[],
  dates: string[],
  holidays: Map<string, HolidayGroup[]>,
  nonWorking: Map<string, NonWorkingDayGroup[]>,
  today: string,
): { rows: AbsenceIrregularRow[]; totals: AbsenceIrregularTotals[] } {
  const byKey = new Map(records.map(r => [`${r.staff_id}|${r.date}`, r]))
  const rows: AbsenceIrregularRow[] = []
  const totals: AbsenceIrregularTotals[] = []

  for (const s of staff) {
    const t: AbsenceIrregularTotals = { staff: s, absent: 0, on_leave: 0, half_day: 0, e: 0, total: 0 }
    for (const date of dates) {
      const record = byKey.get(`${s.id}|${date}`)
      const state = resolveStaffDay(date, s.id, record, holidays, nonWorking, today)
      if (!ABSENCE_CATEGORIES.has(state)) continue
      const category = state as AbsenceCategory
      rows.push({ date, staff: s, category, derived: !record, record: record ?? null })
      t[category]++
      t.total++
    }
    if (t.total > 0) totals.push(t)
  }

  rows.sort((a, b) => a.date === b.date ? a.staff.full_name.localeCompare(b.staff.full_name) : a.date.localeCompare(b.date))
  totals.sort((a, b) => b.total - a.total || a.staff.full_name.localeCompare(b.staff.full_name))
  return { rows, totals }
}

// ── Time tracking ────────────────────────────────────────────────────────────

export interface TimeTrackingDay {
  date: string
  state: DayState
  checkIn: string | null
  checkOut: string | null
  checkIn2: string | null
  checkOut2: string | null
  /** Closed spans only; null when nothing was both started and finished. */
  workedMinutes: number | null
  /** A check-in with no matching check-out. */
  openPunch: boolean
}

export interface TimeTrackingStaff {
  staff: ReportStaff
  days: TimeTrackingDay[]
  daysAttended: number
  totalWorkedMinutes: number
}

export interface TimeTrackingReport {
  kind: 'time'
  startDate: string
  endDate: string
  timezone: string | null
  staff: TimeTrackingStaff[]
}

const ATTENDED_STATES = new Set<DayState>(['present', 'late', 'wfh', 'half_day', 'e'])

export function buildTimeTracking(
  staff: ReportStaff[],
  records: StaffAttendanceRecord[],
  dates: string[],
  holidays: Map<string, HolidayGroup[]>,
  nonWorking: Map<string, NonWorkingDayGroup[]>,
  today: string,
): TimeTrackingStaff[] {
  const byKey = new Map(records.map(r => [`${r.staff_id}|${r.date}`, r]))
  return staff.map(s => {
    let daysAttended = 0
    let totalWorkedMinutes = 0
    const days = dates.map(date => {
      const r = byKey.get(`${s.id}|${date}`)
      const state = resolveStaffDay(date, s.id, r, holidays, nonWorking, today)
      const first = spanMinutes(r?.check_in_time ?? null, r?.check_out_time ?? null)
      const second = spanMinutes(r?.check_in_time_2 ?? null, r?.check_out_time_2 ?? null)
      const workedMinutes = first === null && second === null ? null : (first ?? 0) + (second ?? 0)
      const openPunch = !!r && (
        (!!r.check_in_time && !r.check_out_time) || (!!r.check_in_time_2 && !r.check_out_time_2)
      )
      if (ATTENDED_STATES.has(state)) daysAttended++
      totalWorkedMinutes += workedMinutes ?? 0
      return {
        date,
        state,
        checkIn: r?.check_in_time ?? null,
        checkOut: r?.check_out_time ?? null,
        checkIn2: r?.check_in_time_2 ?? null,
        checkOut2: r?.check_out_time_2 ?? null,
        workedMinutes,
        openPunch,
      }
    })
    return { staff: s, days, daysAttended, totalWorkedMinutes }
  })
}

/** PDF table rows a time tracking report renders: one per staff per day, plus a heading per staff. */
export function timeTrackingRowCount(staffCount: number, dayCount: number): number {
  return staffCount * (dayCount + 1)
}

// ── Fetching ─────────────────────────────────────────────────────────────────

/** Tracked staff (optionally narrowed to a roster) with their directory columns. */
export async function fetchReportStaff(staffIds?: string[]): Promise<ReportStaff[]> {
  const all = await fetchAllTrackedStaff()
  const scope = staffIds ? new Set(staffIds) : null
  const people = (scope ? all.filter(s => scope.has(s.id)) : all) as UserProfile[]
  const directory = await fetchStaffDirectoryMap(people.map(p => p.id))
  return people
    .map(p => ({
      id: p.id,
      full_name: p.full_name ?? p.email ?? 'Unnamed',
      employee_code: directory[p.id]?.employee_id || '—',
      department: directory[p.id]?.department || '—',
      designation: directory[p.id]?.designation || '—',
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

async function fetchRangeInputs(startDate: string, endDate: string, staffIds?: string[]) {
  const [staff, records, rules, timezone] = await Promise.all([
    fetchReportStaff(staffIds),
    fetchStaffAttendanceForRange(startDate, endDate),
    fetchDayRulesForRange(startDate, endDate),
    fetchAttendanceTimezone(),
  ])
  return { staff, records, rules, timezone }
}

/** null when the records could not be read in full. */
export async function fetchAbsenceIrregularReport(
  startDate: string, endDate: string, today: string, staffIds?: string[],
): Promise<AbsenceIrregularReport | null> {
  const { staff, records, rules, timezone } = await fetchRangeInputs(startDate, endDate, staffIds)
  if (!records) return null
  const { rows, totals } = buildAbsenceIrregularRows(
    staff, records, enumerateDates(startDate, endDate), rules.holidays, rules.nonWorking, today,
  )
  return { kind: 'absence', startDate, endDate, timezone, rows, totals }
}

/** null when the records could not be read in full. */
export async function fetchTimeTrackingReport(
  startDate: string, endDate: string, today: string, staffIds?: string[],
): Promise<TimeTrackingReport | null> {
  const { staff, records, rules, timezone } = await fetchRangeInputs(startDate, endDate, staffIds)
  if (!records) return null
  // Days still ahead of the school clock have nothing to show yet.
  const dates = enumerateDates(startDate, endDate).filter(d => d <= today)
  return {
    kind: 'time', startDate, endDate, timezone,
    staff: buildTimeTracking(staff, records, dates, rules.holidays, rules.nonWorking, today),
  }
}
