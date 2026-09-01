// ============================================================================
// The Salary Manager's headline figures.
//
// The trap this file exists for: a pay cycle stores no PF, ESI, loss-of-pay or
// bonus rows while it is open — those are computed live and only snapshotted
// onto the records when the cycle is locked. Summing the stored items alone
// therefore reports an open month as having zero deductions and a net equal to
// its gross, which is both wrong and plausible-looking, and is exactly what the
// dashboard used to show. So the open and locked paths are pinned separately,
// along with which month the page should open on (payroll is processed in the
// first days of the *following* month).
// ============================================================================

import { describe, it, expect } from 'vitest'
import { PAYROLL_ITEM_LABELS } from './payroll'
import {
  CycleRecordLike, LiveFigures,
  defaultPayrollMonth, shiftMonth, monthIndex, percentChange, comparable,
  recordFigures, aggregateMonth,
} from './salaryStats'

function rec(over: Partial<CycleRecordLike> = {}): CycleRecordLike {
  return {
    id: 'r1',
    person_id: 'p1',
    base_amount: 30000,
    status: 'draft',
    working_days_override: null,
    leave_override: null,
    late_override: null,
    half_day_override: null,
    pf_amount_override: null,
    esi_amount_override: null,
    items: [],
    ...over,
  }
}

const LIVE: LiveFigures = { pf: 1800, esi: 225, lop: 1150, bonus: 400 }

describe('defaultPayrollMonth', () => {
  it('opens on last month while last month is being processed', () => {
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

describe('recordFigures — open cycle', () => {
  it('reports the live deductions on a record that stores no items at all', () => {
    // The regression: an open cycle has nothing in salary_record_items, and
    // reading only those made the month look deduction-free.
    const f = recordFigures(rec(), false, LIVE)

    expect(f.gross).toBe(30400)                 // base + the live bonus
    expect(f.pf).toBe(1800)
    expect(f.esi).toBe(225)
    expect(f.lop).toBe(1150)
    expect(f.deductions).toBe(3175)
    expect(f.net).toBe(27225)
  })

  it('ignores auto-labelled rows left behind by an interrupted close', () => {
    // These would otherwise be counted a second time on top of the live preview.
    const withLeftovers = rec({
      items: [
        { label: PAYROLL_ITEM_LABELS.pf, amount: -1800 },
        { label: PAYROLL_ITEM_LABELS.lopLeave, amount: -1150 },
        { label: 'Task bonus (June 2026) · 8 pts', amount: 400 },
      ],
    })
    expect(recordFigures(withLeftovers, false, LIVE)).toEqual(recordFigures(rec(), false, LIVE))
  })

  it('still counts what a person added by hand', () => {
    const f = recordFigures(rec({
      items: [
        { label: PAYROLL_ITEM_LABELS.pf, amount: -1800 },  // auto — ignored
        { label: 'Festival advance', amount: -2000 },      // manual — counted
        { label: 'Overtime', amount: 900 },                // manual — counted
      ],
    }), false, LIVE)

    expect(f.gross).toBe(31300)        // base + live bonus + overtime
    expect(f.deductions).toBe(5175)    // live PF/ESI/LOP + the advance
    expect(f.net).toBe(26125)
  })

  it('falls back to base alone when the engine has nothing to say', () => {
    const f = recordFigures(rec(), false, null)
    expect(f.gross).toBe(30000)
    expect(f.deductions).toBe(0)
    expect(f.net).toBe(30000)
  })
})

describe('recordFigures — locked cycle', () => {
  it('reads the stored items and ignores the live engine entirely', () => {
    const f = recordFigures(rec({
      items: [
        { label: PAYROLL_ITEM_LABELS.bonus, amount: 2400 },
        { label: PAYROLL_ITEM_LABELS.pf, amount: -1800 },
        { label: PAYROLL_ITEM_LABELS.esi, amount: -315 },
        { label: PAYROLL_ITEM_LABELS.lopLate, amount: -650 },
        { label: PAYROLL_ITEM_LABELS.lopLeave, amount: -1300 },
        { label: 'Uniform recovery', amount: -500 },
      ],
    }), true, LIVE)

    expect(f.gross).toBe(32400)
    expect(f.bonus).toBe(2400)
    expect(f.pf).toBe(1800)
    expect(f.esi).toBe(315)
    expect(f.lop).toBe(1950)          // both LOP rows
    expect(f.deductions).toBe(4565)   // …plus the manual recovery
    expect(f.net).toBe(27835)
  })

  it('recognises the older recommendation-flow labels as the same money', () => {
    const f = recordFigures(rec({
      base_amount: 20000,
      items: [
        { label: 'Task bonus (June 2026) · 4 pts', amount: 200 },
        { label: 'Absence penalty · 1 day', amount: -800 },
      ],
    }), true, null)

    expect(f.bonus).toBe(200)
    expect(f.lop).toBe(800)
  })

  it('reads numeric columns that arrive as strings', () => {
    const f = recordFigures(rec({
      base_amount: '30000.00',
      items: [{ label: 'PF', amount: '-1800.00' }],
    }), true, null)

    expect(f.gross).toBe(30000)
    expect(f.pf).toBe(1800)
    expect(f.net).toBe(28200)
  })

  it('survives a record with no items at all', () => {
    const f = recordFigures(rec({ items: null }), true, null)
    expect(f.gross).toBe(30000)
    expect(f.net).toBe(30000)
  })
})

describe('aggregateMonth', () => {
  it('leaves ₹0 placeholder records out of the headcount and payout progress', () => {
    // Running a cycle generates a row for everyone, including people who have
    // no base salary set. Counting them made a fully-paid month read "80/95".
    const s = aggregateMonth(2026, 8, [{
      locked: true,
      live: {},
      records: [
        rec({ id: 'a', base_amount: 30000, status: 'paid' }),
        rec({ id: 'b', base_amount: 25000, status: 'approved' }),
        rec({ id: 'c', base_amount: 0, status: 'draft' }),
      ],
    }])

    expect(s.headcount).toBe(2)
    expect(s.totalCount).toBe(2)
    expect(s.paidCount).toBe(1)
    expect(s.pendingAmount).toBe(25000)   // the paid record is not pending
    expect(s.net).toBe(55000)             // …but is still part of the month
  })

  it('adds an open cycle and a locked one together, each by its own rule', () => {
    const s = aggregateMonth(2026, 8, [
      { locked: true, live: {}, records: [rec({ id: 'a', items: [{ label: 'PF', amount: -1800 }] })] },
      { locked: false, live: { b: LIVE }, records: [rec({ id: 'b' })] },
    ])

    expect(s.gross).toBe(60400)      // 30000 locked + 30400 open (incl. bonus)
    expect(s.deductions).toBe(4975)  // 1800 stored + 3175 live
    expect(s.net).toBe(55425)
    expect(s.actual).toBe(true)
    expect(s.locked).toBe(false)     // one cycle is still open
  })

  it('marks the month locked only once every cycle in it is', () => {
    const locked = aggregateMonth(2026, 8, [
      { locked: true, live: {}, records: [rec()] },
      { locked: true, live: {}, records: [rec({ id: 'b' })] },
    ])
    expect(locked.locked).toBe(true)
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
  const withActuals = aggregateMonth(2026, 8, [{ locked: true, live: {}, records: [rec()] }])
  const empty = aggregateMonth(2026, 7, [])

  it('needs real figures on the earlier month before showing a change', () => {
    expect(comparable(withActuals, withActuals)).toBe(true)
    expect(comparable(withActuals, empty)).toBe(false)
  })
})
