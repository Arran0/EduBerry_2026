// ============================================================================
// Working calendars — what each day of a period is worth before anyone turns up.
// ----------------------------------------------------------------------------
// Schools do not share one calendar. Teaching staff may work a six-day week with
// alternate Saturdays off, transport staff a different pattern again, and the
// office a straight five-day week. This module turns a `WorkingCalendar` plus
// the holiday list into a per-day classification, and derives the divisor a
// day's pay is calculated against.
//
// Date handling is deliberately string-based ('YYYY-MM-DD') and constructed at
// midday UTC when a weekday is needed. Building `new Date('2026-04-01')` and
// reading `.getDay()` shifts a day backwards for anyone west of UTC, which
// silently moves a school's week-offs for a reviewer sitting in a different
// timezone. Midday has no such edge.
// ============================================================================

import type {
  WorkingCalendar, EngineHoliday, CalendarDayStatus, EngineEmployee, WeekdayMode,
} from './types'

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 0 = Sunday .. 6 = Saturday, read at midday so no timezone can shift it. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}

/** Which occurrence of its own weekday this date is within its month (1-based). */
export function nthWeekdayOfMonth(date: string): number {
  const day = Number(date.slice(8, 10))
  return Math.floor((day - 1) / 7) + 1
}

/** True when this is the last occurrence of its weekday in the month. */
export function isLastWeekdayOfMonth(date: string): boolean {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  return day + 7 > daysInMonth(year, month)
}

export function listDates(from: string, to: string): string[] {
  const out: string[] = []
  const start = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/** A holiday applies to everyone when `isDefault`, otherwise only to its listed staff. */
export function holidayFor(
  holidays: EngineHoliday[], date: string, employeeId: string,
): EngineHoliday | null {
  // A staff-scoped holiday beats the whole-school one on the same date, which is
  // how the existing attendance_holidays / attendance_holiday_members pair is
  // already meant to be read.
  const onDate = holidays.filter(h => h.date === date)
  return (
    onDate.find(h => !h.isDefault && h.staffIds.includes(employeeId)) ??
    onDate.find(h => h.isDefault) ??
    null
  )
}

function weekdayMode(calendar: WorkingCalendar, date: string): WeekdayMode {
  const wd = weekdayOf(date)
  // An nth-weekday rule ("2nd and 4th Saturday off") is more specific than the
  // base week pattern, so it is checked first.
  for (const rule of calendar.nthWeekdayRules) {
    if (rule.weekday !== wd) continue
    const nth = nthWeekdayOfMonth(date)
    const hit = rule.nth.some(n => (n === -1 ? isLastWeekdayOfMonth(date) : n === nth))
    if (hit) return rule.mode
  }
  return calendar.weekPattern[wd] ?? 'full'
}

export interface CalendarDay {
  date: string
  status: CalendarDayStatus
  /** How much of a working day this is: 1 for a full day, 0.5 for a half day, 0 for off. */
  weight: number
  holidayName: string | null
}

/** Classify every date in the period for one employee. */
export function classifyDays(
  from: string,
  to: string,
  calendar: WorkingCalendar,
  holidays: EngineHoliday[],
  employee: EngineEmployee,
): CalendarDay[] {
  return listDates(from, to).map(date => {
    if (employee.dateOfJoining && date < employee.dateOfJoining) {
      return { date, status: 'before_join' as const, weight: 0, holidayName: null }
    }
    if (employee.dateOfExit && date > employee.dateOfExit) {
      return { date, status: 'after_exit' as const, weight: 0, holidayName: null }
    }
    const holiday = holidayFor(holidays, date, employee.id)
    if (holiday) {
      return { date, status: 'holiday' as const, weight: 0, holidayName: holiday.name }
    }
    const mode = weekdayMode(calendar, date)
    if (mode === 'off') return { date, status: 'week_off' as const, weight: 0, holidayName: null }
    if (mode === 'half') return { date, status: 'half_working' as const, weight: 0.5, holidayName: null }
    return { date, status: 'working' as const, weight: 1, holidayName: null }
  })
}

export interface PayableDaysResult {
  /** The divisor: what one day of pay is worth is salary ÷ this. */
  payableDays: number
  /** Days the employee was actually on the roll this period (drives mid-month join/exit proration). */
  onRollDays: number
  /** Total days in the period, however the calendar counts them. */
  periodDays: number
  basis: WorkingCalendar['basis']
  explanation: string
}

/**
 * The per-day divisor.
 *
 * Four bases, because schools genuinely differ and the choice moves real money:
 *   calendar_days          — salary ÷ every day in the month (30 or 31). The
 *                            commonest, and the one the current app hardcodes.
 *   fixed_days             — always ÷ 30, so a day costs the same in February
 *                            as in March. Preferred where staff compare payslips.
 *   calendar_minus_holidays— salary ÷ (month − holidays), so a holiday-heavy
 *                            month makes each remaining day dearer.
 *   actual_working_days    — salary ÷ scheduled working days only.
 */
export function computePayableDays(
  days: CalendarDay[], calendar: WorkingCalendar,
): PayableDaysResult {
  const periodDays = days.length
  const onRollDays = days.filter(d => d.status !== 'before_join' && d.status !== 'after_exit').length
  const holidayCount = days.filter(d => d.status === 'holiday').length
  const workingWeight = days.reduce((s, d) => s + d.weight, 0)

  switch (calendar.basis) {
    case 'fixed_days':
      return {
        payableDays: calendar.fixedDays || 30, onRollDays, periodDays, basis: calendar.basis,
        explanation: `A fixed ${calendar.fixedDays || 30}-day month, so a day's pay is the same in every month.`,
      }
    case 'calendar_minus_holidays':
      return {
        payableDays: Math.max(1, periodDays - holidayCount), onRollDays, periodDays, basis: calendar.basis,
        explanation: `${periodDays} days in the period less ${holidayCount} holiday(s).`,
      }
    case 'actual_working_days':
      return {
        payableDays: Math.max(1, workingWeight), onRollDays, periodDays, basis: calendar.basis,
        explanation: `${workingWeight} scheduled working day(s) on the "${calendar.name}" calendar.`,
      }
    case 'calendar_days':
    default:
      return {
        payableDays: Math.max(1, periodDays), onRollDays, periodDays, basis: 'calendar_days',
        explanation: `Every one of the ${periodDays} days in the period counts.`,
      }
  }
}
