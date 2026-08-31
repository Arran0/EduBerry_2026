// ============================================================================
// The Salary Manager's headline figures.
//
// Two things here are easy to get quietly wrong and impossible to spot from
// the dashboard itself: which month it should open on (payroll is processed in
// the first days of the *following* month, so "this month" is the wrong answer
// for the first ten days), and how a record's line items roll up into payroll
// cost / net pay / deductions — where a sign error turns a deduction into an
// earning and the totals still look plausible.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { PAYROLL_ITEM_LABELS } from './payroll'
import {
  PayrollRecordLike,
  defaultPayrollMonth, shiftMonth, monthIndex, percentChange, comparable,
  tallyPayrollRecords,
} from './salaryStats'

function record(
  base: number,
  items: [string, number][] = [],
  status: string = 'draft',
): PayrollRecordLike {
  return { base_amount: base, status, items: items.map(([label, amount]) => ({ label, amount })) }
}

describe('defaultPayrollMonth', () => {
  it('opens on last month while last month is being processed', () => {
    // The 1st through the 10th: the office is running August's salaries.
    expect(defaultPayrollMonth(new Date(2026, 8, 3))).toEqual({ year: 2026, month: 8 })
    expect(defaultPayrollMonth(new Date(2026, 8, 10))).toEqual({ year: 2026, month: 8 })
  })

  it('moves to the month in progress once the processing window has passed', () => {
    expect(defaultPayrollMonth(new Date(2026, 8, 11))).toEqual({ year: 2026, month: 9 })
    expect(defaultPayrollMonth(new Date(2026, 8, 28))).toEqual({ year: 2026, month: 9 })
  })

  it('steps back across a year boundary in January', () => {
    expect(defaultPayrollMonth(new Date(2026, 0, 5))).toEqual({ year: 2025, month: 12 })
  })
})

describe('shiftMonth', () => {
  it('stays 1-based and rolls the year over in both directions', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 6, 0)).toEqual({ year: 2026, month: 6 })
  })

  it('orders periods by monthIndex regardless of the year boundary', () => {
    expect(monthIndex(2026, 1)).toBeGreaterThan(monthIndex(2025, 12))
  })
})

describe('tallyPayrollRecords', () => {
  it('splits line items by sign — positives raise the cost, negatives are withheld', () => {
    const t = tallyPayrollRecords([
      record(30000, [[PAYROLL_ITEM_LABELS.bonus, 2000], [PAYROLL_ITEM_LABELS.pf, -1800]]),
    ], 2026, 8)

    expect(t.gross).toBe(32000)        // base + the bonus
    expect(t.deductions).toBe(1800)    // reported positive, not as −1800
    expect(t.net).toBe(30200)
    expect(t.bonus).toBe(2000)
    expect(t.pf).toBe(1800)
    expect(t.actual).toBe(true)
  })

  it('files each deduction under its own heading, LOP included', () => {
    const t = tallyPayrollRecords([
      record(40000, [
        [PAYROLL_ITEM_LABELS.pf, -1800],
        [PAYROLL_ITEM_LABELS.esi, -300],
        [PAYROLL_ITEM_LABELS.lopLeave, -1300],
        [PAYROLL_ITEM_LABELS.lopLate, -650],
        ['Uniform recovery', -500],
      ]),
    ], 2026, 8)

    expect(t.pf).toBe(1800)
    expect(t.esi).toBe(300)
    expect(t.lop).toBe(1950)                 // both LOP rows, summed
    expect(t.deductions).toBe(4550)          // …plus the manual recovery
    expect(t.net).toBe(35450)
  })

  it('recognises the older recommendation-flow labels as the same money', () => {
    const t = tallyPayrollRecords([
      record(20000, [['Task bonus (June 2026) · 4 pts', 200], ['Absence penalty · 1 day', -800]]),
    ], 2026, 6)

    expect(t.bonus).toBe(200)
    expect(t.lop).toBe(800)
  })

  it('counts what is still to be disbursed, and only that', () => {
    const t = tallyPayrollRecords([
      record(30000, [], 'paid'),
      record(25000, [], 'approved'),
      record(20000, [], 'draft'),
    ], 2026, 8)

    expect(t.totalCount).toBe(3)
    expect(t.paidCount).toBe(1)
    expect(t.headcount).toBe(3)
    expect(t.pendingAmount).toBe(45000)      // the paid record is not pending
    expect(t.net).toBe(75000)                // …but is still part of the month
  })

  it('reads numeric columns that arrive as strings', () => {
    const t = tallyPayrollRecords([
      { base_amount: '30000.00', status: 'paid', items: [{ label: 'PF', amount: '-1800.00' }] },
    ], 2026, 8)

    expect(t.gross).toBe(30000)
    expect(t.pf).toBe(1800)
    expect(t.net).toBe(28200)
  })

  it('survives a record with no items at all', () => {
    const t = tallyPayrollRecords([{ base_amount: 15000, status: 'draft', items: null }], 2026, 8)
    expect(t.gross).toBe(15000)
    expect(t.net).toBe(15000)
    expect(t.deductions).toBe(0)
  })
})

describe('percentChange', () => {
  it('reports the move from the earlier month to the later one', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10)
    expect(percentChange(90, 100)).toBeCloseTo(-10)
    expect(percentChange(100, 100)).toBe(0)
  })

  it('refuses to divide by a month that had nothing to compare against', () => {
    expect(percentChange(5000, 0)).toBeNull()
    expect(percentChange(5000, -1)).toBeNull()
  })
})

describe('comparable', () => {
  const withActuals = tallyPayrollRecords([record(30000)], 2026, 8)
  const empty = tallyPayrollRecords([], 2026, 7)

  it('needs real figures on the earlier month before showing a change', () => {
    expect(comparable(withActuals, withActuals)).toBe(true)
    expect(comparable(withActuals, empty)).toBe(false)
  })
})
