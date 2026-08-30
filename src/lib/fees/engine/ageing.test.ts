import { describe, expect, it } from 'vitest'
import {
  ageFee, daysBetween, summariseAgeing, reminderToneFor, reminderKey,
  DUE_SOON_DAYS, type AgeingState,
} from './ageing'

const TODAY = '2026-08-31'

function age(over: Partial<Parameters<typeof ageFee>[0]> = {}) {
  return ageFee({ dueDate: '2026-08-31', billed: 10000, paid: 0, today: TODAY, ...over })
}

function stateOn(dueDate: string, graceDays = 0): AgeingState {
  return age({ dueDate, graceDays }).state
}

describe('daysBetween', () => {
  it('counts whole days regardless of clock shifts', () => {
    expect(daysBetween('2026-08-01', '2026-08-31')).toBe(30)
    expect(daysBetween('2026-08-31', '2026-08-01')).toBe(-30)
    expect(daysBetween('2026-08-31', '2026-08-31')).toBe(0)
  })

  it('crosses a month and a year end', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })

  it('is unaffected by an India-vs-UTC date offset in the input', () => {
    expect(daysBetween('2026-08-01T23:30:00+05:30', '2026-08-02T00:15:00+05:30')).toBe(1)
  })
})

describe('the ageing state machine', () => {
  it('is upcoming while the due date is more than a week away', () => {
    expect(stateOn('2026-09-30')).toBe('upcoming')
    expect(stateOn('2026-09-08')).toBe('upcoming')
  })

  it('is due_soon inside the last week', () => {
    expect(stateOn('2026-09-07')).toBe('due_soon')
    expect(stateOn('2026-09-01')).toBe('due_soon')
  })

  it('treats exactly DUE_SOON_DAYS out as due_soon, not upcoming', () => {
    const boundary = new Date(Date.UTC(2026, 7, 31 + DUE_SOON_DAYS)).toISOString().slice(0, 10)
    expect(stateOn(boundary)).toBe('due_soon')
  })

  it('is due_today on the day', () => {
    expect(stateOn('2026-08-31')).toBe('due_today')
  })

  // The state that stops the module sending a defaulter notice on day two of a
  // grace period the school itself granted.
  it('sits in grace, not overdue, inside the grace period', () => {
    expect(stateOn('2026-08-25', 7)).toBe('grace')
    expect(stateOn('2026-08-24', 7)).toBe('grace')
  })

  it('becomes overdue the day the grace period ends', () => {
    expect(stateOn('2026-08-23', 7)).toBe('overdue_30')
  })

  it('is overdue immediately when there is no grace', () => {
    expect(stateOn('2026-08-30', 0)).toBe('overdue_30')
  })

  it('buckets by days past grace, not days past due', () => {
    // Due 40 days ago with 7 days' grace is 33 days past grace → 31–60.
    expect(stateOn('2026-07-22', 7)).toBe('overdue_60')
    // The same date with no grace is 40 days past → also 31–60, but the
    // boundary moves, which is the point.
    expect(stateOn('2026-08-01', 0)).toBe('overdue_30')
  })

  it('walks the whole escalation', () => {
    expect(stateOn('2026-08-25')).toBe('overdue_30')       // 6 days
    expect(stateOn('2026-07-15')).toBe('overdue_60')       // 47
    expect(stateOn('2026-06-15')).toBe('overdue_90')       // 77
    expect(stateOn('2026-04-01')).toBe('overdue_90_plus')  // 152
  })

  it('lands exactly on each bucket boundary', () => {
    expect(stateOn('2026-08-01')).toBe('overdue_30')       // 30 days
    expect(stateOn('2026-07-31')).toBe('overdue_60')       // 31
    expect(stateOn('2026-07-02')).toBe('overdue_60')       // 60
    expect(stateOn('2026-07-01')).toBe('overdue_90')       // 61
    expect(stateOn('2026-06-02')).toBe('overdue_90')       // 90
    expect(stateOn('2026-06-01')).toBe('overdue_90_plus')  // 91
  })
})

describe('what is never chased', () => {
  it('settles a fully paid fee', () => {
    const a = age({ dueDate: '2026-01-01', paid: 10000 })
    expect(a.state).toBe('settled')
    expect(a.outstanding).toBe(0)
  })

  it('settles an overpaid fee rather than reporting a negative balance', () => {
    expect(age({ dueDate: '2026-01-01', paid: 12000 }).outstanding).toBe(0)
  })

  it('never chases a cancelled fee', () => {
    expect(age({ dueDate: '2026-01-01', cancelled: true }).state).toBe('settled')
  })

  it('keeps a part-paid fee overdue for the remainder only', () => {
    const a = age({ dueDate: '2026-06-15', paid: 4000 })
    expect(a.state).toBe('overdue_90')
    expect(a.outstanding).toBe(6000)
  })

  // Every hand-issued fee has no due date, and treating those as overdue would
  // put the whole school in the defaulter list on day one.
  it('does not age a fee with no due date', () => {
    const a = age({ dueDate: null })
    expect(a.state).toBe('upcoming')
    expect(a.daysPastDue).toBeNull()
  })
})

describe('bucket totals', () => {
  it('sums outstanding into the right columns', () => {
    const rows = [
      age({ dueDate: '2026-09-30' }),                    // current, 10000
      age({ dueDate: '2026-08-10', billed: 5000 }),      // 1-30, 5000
      age({ dueDate: '2026-07-01', billed: 3000 }),      // 61-90, 3000
      age({ dueDate: '2026-01-01', billed: 2000, paid: 2000 }), // settled
    ]
    const b = summariseAgeing(rows)
    expect(b.current).toBe(10000)
    expect(b['1-30']).toBe(5000)
    expect(b['61-90']).toBe(3000)
    expect(b.total).toBe(18000)
  })

  it('excludes settled fees from the total', () => {
    const b = summariseAgeing([age({ dueDate: '2026-01-01', paid: 10000 })])
    expect(b.total).toBe(0)
  })
})

describe('reminders', () => {
  it('says nothing during a grace period', () => {
    expect(reminderToneFor('grace')).toBe('none')
    expect(reminderToneFor('upcoming')).toBe('none')
    expect(reminderToneFor('settled')).toBe('none')
  })

  it('escalates with age', () => {
    expect(reminderToneFor('due_soon')).toBe('gentle')
    expect(reminderToneFor('overdue_30')).toBe('firm')
    expect(reminderToneFor('overdue_60')).toBe('urgent')
    expect(reminderToneFor('overdue_90_plus')).toBe('escalate')
  })

  // A date-based key would re-send every night the cron runs.
  it('keys on the state so one message is sent per transition', () => {
    expect(reminderKey('fee-1', 'overdue_30')).toBe(reminderKey('fee-1', 'overdue_30'))
    expect(reminderKey('fee-1', 'overdue_30')).not.toBe(reminderKey('fee-1', 'overdue_60'))
  })
})
