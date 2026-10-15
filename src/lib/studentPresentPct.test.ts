import { describe, it, expect } from 'vitest'
import { studentPresentPct, STUDENT_PRESENT_STATUSES } from './attendance'

/**
 * This number is printed on student certificates and decides who sits an exam, so
 * the rules it encodes are worth pinning down rather than inferring from the call
 * site.
 */

const days = (over: Partial<Parameters<typeof studentPresentPct>[1]> = {}) => ({
  present: 0, late: 0, half_day: 0, on_leave: 0, on_duty: 0, ...over,
})

describe('a student’s attendance percentage', () => {
  it('is the share of school days they were present for', () => {
    expect(studentPresentPct(100, days({ present: 80 }))).toBe(80)
  })

  it('counts a child who arrived late as having been in school', () => {
    // The register treats late as present everywhere else; this figure used to be
    // the one place it did not, which cost 459 students an average of 5.4 points.
    expect(studentPresentPct(100, days({ present: 70, late: 10 }))).toBe(80)
  })

  it('credits every status the rest of the app counts as present', () => {
    // Guards against the sets drifting apart again: if a status joins
    // STUDENT_PRESENT_STATUSES it needs crediting here too.
    expect([...STUDENT_PRESENT_STATUSES].sort()).toEqual(['late', 'on_duty', 'present'])
    expect(studentPresentPct(90, days({ present: 30, late: 30, on_duty: 30 }))).toBe(100)
  })

  it('credits a half day as half a day present', () => {
    // 80 full + 10 half = 85 of 100 school days.
    expect(studentPresentPct(100, days({ present: 80, half_day: 10 }))).toBe(85)
  })

  it('still counts a half day as a day that had to be attended', () => {
    // Were half days excluded from the denominator instead, 80/90 would read 89%.
    expect(studentPresentPct(100, days({ present: 80, half_day: 10 }))).not.toBe(89)
  })

  it('neither rewards nor punishes approved leave', () => {
    // 100 days: 80 present, 10 on approved leave, 10 absent. The leave days leave
    // the reckoning, so this reads 80 of 90 — identical to a student who simply had
    // 90 school days, 80 of them present.
    expect(studentPresentPct(100, days({ present: 80, on_leave: 10 }))).toBe(89)
    expect(studentPresentPct(90, days({ present: 80 }))).toBe(89)
  })

  it('does not let a rounded 99% stand in for a perfect record', () => {
    expect(studentPresentPct(200, days({ present: 199 }))).toBe(100)
    expect(studentPresentPct(200, days({ present: 200 }))).toBe(100)
  })

  it('reads zero rather than dividing by nothing when no school days remain', () => {
    expect(studentPresentPct(0, days())).toBe(0)
    expect(studentPresentPct(5, days({ on_leave: 5 }))).toBe(0)
  })

  it('rounds a half-day-only record to the nearest whole percent', () => {
    // 3 half days out of 7 = 1.5/7 = 21.4%.
    expect(studentPresentPct(7, days({ half_day: 3 }))).toBe(21)
  })

  it('reaches the 75% exam threshold on lates alone', () => {
    // The case that moved 97 students: mostly present, often late, and previously
    // scored as if every late day were an absence.
    expect(studentPresentPct(100, days({ present: 60, late: 20 }))).toBe(80)
  })
})
