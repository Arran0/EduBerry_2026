import { describe, it, expect } from 'vitest'
import { studentPresentPct } from './attendance'

/**
 * This number is printed on student certificates, so the rules it encodes are
 * worth pinning down rather than inferring from the call site.
 */
describe('a student’s attendance percentage', () => {
  it('is the share of school days they were present for', () => {
    expect(studentPresentPct(100, { present: 80, half_day: 0, on_leave: 0, on_duty: 0 })).toBe(80)
  })

  it('credits a half day as half a day present', () => {
    // 80 full + 10 half = 85 of 100 school days.
    expect(studentPresentPct(100, { present: 80, half_day: 10, on_leave: 0, on_duty: 0 })).toBe(85)
  })

  it('still counts a half day as a day that had to be attended', () => {
    // Were half days excluded from the denominator instead, 80/90 would read 89%.
    expect(studentPresentPct(100, { present: 80, half_day: 10, on_leave: 0, on_duty: 0 })).not.toBe(89)
  })

  it('takes approved leave and on-duty days out of the reckoning entirely', () => {
    // 10 leave + 10 on-duty are not school days for this student, so 80 of the
    // remaining 80 is a full attendance record, not 80%.
    expect(studentPresentPct(100, { present: 80, half_day: 0, on_leave: 10, on_duty: 10 })).toBe(100)
  })

  it('does not let a rounded 99% stand in for a perfect record', () => {
    expect(studentPresentPct(200, { present: 199, half_day: 0, on_leave: 0, on_duty: 0 })).toBe(100)
    expect(studentPresentPct(200, { present: 200, half_day: 0, on_leave: 0, on_duty: 0 })).toBe(100)
  })

  it('reads zero rather than dividing by nothing when no school days remain', () => {
    expect(studentPresentPct(0, { present: 0, half_day: 0, on_leave: 0, on_duty: 0 })).toBe(0)
    expect(studentPresentPct(5, { present: 0, half_day: 0, on_leave: 3, on_duty: 2 })).toBe(0)
  })

  it('rounds a half-day-only record to the nearest whole percent', () => {
    // 3 half days out of 7 = 1.5/7 = 21.4%.
    expect(studentPresentPct(7, { present: 0, half_day: 3, on_leave: 0, on_duty: 0 })).toBe(21)
  })
})
