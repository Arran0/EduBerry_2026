// ============================================================================
// The pay cycle's Leave column and the attendance calendar's Absent chip are
// the same number, and these tests are what keeps them that way.
//
// An admin reviewing a cycle opens the mini attendance calendar straight off
// the row to ask "why is this person's LOP so high?". If the Leave column and
// the Absent count in that popup disagree, every rupee derived from the column
// — LOP days, earned wage, ESI, the items snapshotted on lock, the NCP days on
// the statutory returns — is under suspicion. So `computeStaffAttendanceStats`
// reads its leave count from `computeMonthlyStats` rather than re-deriving it.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { StaffAttendanceRecord, StaffAttendanceStatus, Holiday, NonWorkingDay } from './attendance'
import { computeMonthlyStats } from './attendance'
import { computeStaffAttendanceStats } from './payroll'

const STAFF = 'staff-1'
const OTHER = 'staff-2'

/** Only the four fields the derivation reads; the rest of the row is irrelevant here. */
function rec(staffId: string, date: string, status: StaffAttendanceStatus): StaffAttendanceRecord {
  return { id: `${staffId}-${date}`, staff_id: staffId, date, status } as StaffAttendanceRecord
}

function holiday(date: string, name = 'Holiday'): Holiday {
  return { id: `h-${date}`, date, name }
}

function nonWorking(date: string, name = 'Non-working'): NonWorkingDay {
  return { id: `n-${date}`, date, name }
}

/** Both sides of the pairing, for the same staff member, month and inputs. */
function bothCounts(args: {
  records: StaffAttendanceRecord[]
  holidays?: Holiday[]
  nonWorkingDays?: NonWorkingDay[]
  today: string
}) {
  const { records, holidays = [], nonWorkingDays = [], today } = args
  const payroll = computeStaffAttendanceStats(
    STAFF, records, holidays, nonWorkingDays, 2026, 6, today,
  )
  const calendar = computeMonthlyStats(
    2026, 6, records.filter(r => r.staff_id === STAFF), holidays, today, nonWorkingDays,
  )
  return { leaveCount: payroll.leaveCount, absent: calendar.absent, payroll, calendar }
}

describe('payroll Leave count = attendance calendar Absent count', () => {
  it('agrees across a month mixing every status, a holiday, a non-working day and unmarked days', () => {
    const records = [
      rec(STAFF, '2026-06-01', 'present'),
      rec(STAFF, '2026-06-02', 'late'),
      rec(STAFF, '2026-06-03', 'absent'),
      rec(STAFF, '2026-06-04', 'on_leave'),
      rec(STAFF, '2026-06-05', 'half_day'),
      rec(STAFF, '2026-06-06', 'wfh'),
      rec(STAFF, '2026-06-08', 'e'),
      rec(STAFF, '2026-06-09', 'absent'),
      // 10th–14th left unmarked: past working days, so both sides derive Absent.
      rec(STAFF, '2026-06-15', 'present'),
    ]
    const { leaveCount, absent } = bothCounts({
      records,
      holidays: [holiday('2026-06-07')],
      nonWorkingDays: [nonWorking('2026-06-12')],
      today: '2026-06-16',
    })
    // 3rd, 9th + the unmarked 10th, 11th, 13th, 14th and 16th (today itself
    // counts; the 12th is non-working and the 7th a holiday).
    expect(absent).toBe(7)
    expect(leaveCount).toBe(absent)
  })

  it('leaves on_leave days out of both counts', () => {
    const { leaveCount, absent, calendar } = bothCounts({
      records: [
        rec(STAFF, '2026-06-01', 'on_leave'),
        rec(STAFF, '2026-06-02', 'on_leave'),
        rec(STAFF, '2026-06-03', 'absent'),
      ],
      today: '2026-06-03',
      nonWorkingDays: [],
    })
    expect(calendar.on_leave).toBe(2)
    expect(absent).toBe(1)
    expect(leaveCount).toBe(1)
  })

  it('stops at today, so an in-progress month never charges for days ahead', () => {
    const onThe10th = bothCounts({ records: [], today: '2026-06-10' })
    expect(onThe10th.absent).toBe(10)
    expect(onThe10th.leaveCount).toBe(10)

    const afterTheMonth = bothCounts({ records: [], today: '2026-07-01' })
    expect(afterTheMonth.absent).toBe(30)
    expect(afterTheMonth.leaveCount).toBe(30)
  })

  it('counts neither holidays nor non-working days as absence', () => {
    const { leaveCount, absent } = bothCounts({
      records: [],
      holidays: [holiday('2026-06-01'), holiday('2026-06-02')],
      nonWorkingDays: [nonWorking('2026-06-03')],
      today: '2026-06-03',
    })
    expect(absent).toBe(0)
    expect(leaveCount).toBe(0)
  })

  it('reads only this staff member\'s rows out of a whole-cycle fetch', () => {
    const records = [
      rec(STAFF, '2026-06-01', 'present'),
      rec(OTHER, '2026-06-02', 'present'),
      rec(OTHER, '2026-06-03', 'present'),
    ]
    const { leaveCount, absent } = bothCounts({ records, today: '2026-06-03' })
    // The other staff member's presents are not this one's — the 2nd and 3rd
    // are unmarked here, and absent for it.
    expect(absent).toBe(2)
    expect(leaveCount).toBe(2)
  })

  it('keeps late and half-day occurrences out of the leave count', () => {
    const { payroll, leaveCount, absent } = bothCounts({
      records: [
        rec(STAFF, '2026-06-01', 'late'),
        rec(STAFF, '2026-06-02', 'half_day'),
        rec(STAFF, '2026-06-03', 'absent'),
      ],
      today: '2026-06-03',
    })
    expect(payroll.lateCount).toBe(1)
    expect(payroll.halfDayCount).toBe(1)
    expect(leaveCount).toBe(1)
    expect(absent).toBe(1)
  })
})
