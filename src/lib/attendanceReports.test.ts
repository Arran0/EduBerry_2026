import { describe, it, expect } from 'vitest'
import type { StaffAttendanceRecord, StaffAttendanceStatus, HolidayGroup, NonWorkingDayGroup } from './attendance'
import { enumerateDates } from './attendance'
import {
  ReportStaff,
  buildAbsenceIrregularRows,
  buildTimeTracking,
  rangeDayCount,
  resolveStaffDay,
  validateReportRange,
  REPORT_MAX_DAYS,
} from './attendanceReports'

const A: ReportStaff = { id: 'a', full_name: 'Asha', employee_code: 'E1', department: 'Maths', designation: 'TGT' }
const B: ReportStaff = { id: 'b', full_name: 'Bala', employee_code: 'E2', department: 'Science', designation: 'PGT' }

function rec(staffId: string, date: string, status: StaffAttendanceStatus, extra: Partial<StaffAttendanceRecord> = {}): StaffAttendanceRecord {
  return { id: `${staffId}-${date}`, staff_id: staffId, date, status, check_in_time: null, check_out_time: null, check_in_time_2: null, check_out_time_2: null, ...extra } as StaffAttendanceRecord
}

function rule(name: string, isDefault: boolean, staffIds: string[] = []): HolidayGroup & NonWorkingDayGroup {
  return { id: name, scope_type: 'date', scope_date: null, scope_weekday: null, name, is_default: isDefault, staff_ids: staffIds }
}

describe('report range', () => {
  it('counts days inclusively', () => {
    expect(rangeDayCount('2026-10-01', '2026-10-01')).toBe(1)
    expect(rangeDayCount('2026-10-01', '2026-10-31')).toBe(31)
    expect(rangeDayCount('2026-10-02', '2026-10-01')).toBe(0)
  })

  it(`allows up to ${REPORT_MAX_DAYS} days and no more`, () => {
    expect(validateReportRange('2026-09-01', '2026-10-01', '2026-10-17')).toBeNull()
    expect(validateReportRange('2026-09-01', '2026-10-02', '2026-10-17')).toMatch(/at most 31 days/)
  })

  it('rejects backwards and future ranges', () => {
    expect(validateReportRange('2026-10-05', '2026-10-01', '2026-10-17')).toMatch(/after the end/)
    expect(validateReportRange('2026-10-10', '2026-10-18', '2026-10-17')).toMatch(/after today/)
  })

  it('enumerates across a month boundary', () => {
    expect(enumerateDates('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
  })
})

describe('resolveStaffDay', () => {
  const none = new Map<string, HolidayGroup[]>()
  it('takes the record when there is one, even on a holiday', () => {
    const hol = new Map([['2026-10-02', [rule('Gandhi Jayanti', true)]]])
    expect(resolveStaffDay('2026-10-02', 'a', rec('a', '2026-10-02', 'present'), hol, none, '2026-10-17')).toBe('present')
  })
  it('excuses only the staff a team rule names', () => {
    const hol = new Map([['2026-10-03', [rule('Sports day off', false, ['a'])]]])
    expect(resolveStaffDay('2026-10-03', 'a', undefined, hol, none, '2026-10-17')).toBe('holiday')
    expect(resolveStaffDay('2026-10-03', 'b', undefined, hol, none, '2026-10-17')).toBe('absent')
  })
  it('lets a non-working rule win over a holiday', () => {
    const hol = new Map([['2026-10-04', [rule('H', true)]]])
    const nw = new Map([['2026-10-04', [rule('NW', true)]]])
    expect(resolveStaffDay('2026-10-04', 'a', undefined, hol, nw, '2026-10-17')).toBe('non_working')
  })
  it('leaves future days unresolved', () => {
    expect(resolveStaffDay('2026-10-20', 'a', undefined, none, none, '2026-10-17')).toBeNull()
  })
})

describe('buildAbsenceIrregularRows', () => {
  const dates = enumerateDates('2026-10-01', '2026-10-03')
  const hol = new Map([['2026-10-02', [rule('Holiday', true)]]])
  const nw = new Map<string, NonWorkingDayGroup[]>()

  it('lists derived absences, leave and irregular days, and skips holidays', () => {
    const records = [
      rec('a', '2026-10-01', 'present'),
      rec('a', '2026-10-03', 'half_day'),
      rec('b', '2026-10-01', 'on_leave'),
      rec('b', '2026-10-03', 'e'),
    ]
    const { rows, totals } = buildAbsenceIrregularRows([A, B], records, dates, hol, nw, '2026-10-17')
    expect(rows.map(r => `${r.date} ${r.staff.id} ${r.category}${r.derived ? '*' : ''}`)).toEqual([
      '2026-10-01 b on_leave',
      '2026-10-03 a half_day',
      '2026-10-03 b e',
    ])
    // Most days first.
    expect(totals.map(t => [t.staff.id, t.total])).toEqual([['b', 2], ['a', 1]])
  })

  it('marks a day with no record as a derived absence', () => {
    const { rows } = buildAbsenceIrregularRows([A], [], ['2026-10-01'], hol, nw, '2026-10-17')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ category: 'absent', derived: true, record: null })
  })
})

describe('buildTimeTracking', () => {
  it('sums both closed spans and flags an open punch', () => {
    const records = [
      rec('a', '2026-10-01', 'e', {
        check_in_time: '2026-10-01T03:30:00Z', check_out_time: '2026-10-01T06:30:00Z',
        check_in_time_2: '2026-10-01T07:00:00Z', check_out_time_2: '2026-10-01T10:15:00Z',
      }),
      rec('a', '2026-10-02', 'present', { check_in_time: '2026-10-02T03:30:00Z' }),
    ]
    const [a] = buildTimeTracking([A], records, ['2026-10-01', '2026-10-02', '2026-10-03'], new Map(), new Map(), '2026-10-17')
    expect(a.days[0]).toMatchObject({ workedMinutes: 180 + 195, openPunch: false })
    expect(a.days[1]).toMatchObject({ workedMinutes: null, openPunch: true })
    expect(a.days[2]).toMatchObject({ state: 'absent', workedMinutes: null })
    expect(a.daysAttended).toBe(2)
    expect(a.totalWorkedMinutes).toBe(375)
  })
})
