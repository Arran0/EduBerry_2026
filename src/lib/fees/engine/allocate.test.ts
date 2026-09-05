import { describe, it, expect } from 'vitest'
import {
  allocate, orderInvoices, describeAllocation, validatePayment,
  type PayableInvoice, type PaymentRules,
} from './allocate'
import { formatPaise } from './money'

const bill = (id: string, dueDate: string, balance: number, seq = 1): PayableInvoice =>
  ({ id, number: `INV/${id}`, dueDate, seq, balance })

const THREE = [
  bill('a', '2026-04-10', 1_080_000, 1),
  bill('b', '2026-08-10', 810_000, 2),
  bill('c', '2026-12-10', 810_000, 3),
]

const RULES: PaymentRules = {
  partialAllowed: true, minPartialAmount: 0,
  allowOverpayment: true, allowBackdatedDays: 30,
}

describe('ordering', () => {
  it('takes the oldest bill first by default', () => {
    expect(orderInvoices(THREE, 'oldest_due_first').map(i => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('can take the newest first', () => {
    expect(orderInvoices(THREE, 'newest_due_first').map(i => i.id)).toEqual(['c', 'b', 'a'])
  })

  it('keeps the clerk’s own order when they chose', () => {
    const picked = [THREE[2], THREE[0]]
    expect(orderInvoices(picked, 'manual').map(i => i.id)).toEqual(['c', 'a'])
  })

  it('breaks a same-day tie by issue order, not database order', () => {
    const sameDay = [
      bill('second', '2026-04-10', 100, 2),
      bill('first', '2026-04-10', 100, 1),
    ]
    expect(orderInvoices(sameDay, 'oldest_due_first').map(i => i.id)).toEqual(['first', 'second'])
  })
})

describe('allocation', () => {
  it('clears the oldest bill and part-pays the next', () => {
    const r = allocate(1_500_000, THREE)
    expect(r.allocations.map(a => [a.number, a.amount])).toEqual([
      ['INV/a', 1_080_000],
      ['INV/b', 420_000],
    ])
    expect(r.cleared).toBe(1)
    expect(r.credited).toBe(0)
    expect(r.allocated).toBe(1_500_000)
  })

  it('never allocates more than a bill owes', () => {
    const r = allocate(5_000_000, THREE)
    expect(r.allocated).toBe(2_700_000)
    expect(r.credited).toBe(2_300_000)
    expect(r.cleared).toBe(3)
  })

  it('turns everything into a credit when nothing is outstanding', () => {
    const r = allocate(500_000, [])
    expect(r.allocations).toEqual([])
    expect(r.credited).toBe(500_000)
  })

  it('skips a bill that is already settled, so a stale list cannot double-pay', () => {
    const withPaid = [bill('paid', '2026-04-10', 0, 1), ...THREE]
    const r = allocate(100_000, withPaid)
    expect(r.allocations).toHaveLength(1)
    expect(r.allocations[0].number).toBe('INV/a')
  })

  it('always accounts for every paisa', () => {
    for (const amount of [1, 99, 100_001, 2_699_999, 2_700_000, 2_700_001]) {
      const r = allocate(amount, THREE)
      expect(r.allocated + r.credited).toBe(amount)
    }
  })
})

describe('what the clerk reads out', () => {
  it('names each bill and what is left on it', () => {
    const r = allocate(1_500_000, THREE)
    expect(describeAllocation(r, formatPaise)).toBe(
      '₹10,800 to INV/a — cleared and ₹4,200 to INV/b (₹3,900 still due).')
  })

  it('mentions the credit when there is one', () => {
    const r = allocate(3_000_000, THREE)
    expect(describeAllocation(r, formatPaise)).toContain('held as a credit')
  })

  it('says so plainly when there is nothing to pay', () => {
    expect(describeAllocation(allocate(0, []), formatPaise))
      .toBe('There is nothing outstanding to put this against.')
  })
})

describe('what the counter will refuse', () => {
  it('rejects zero and negatives', () => {
    expect(validatePayment(0, 100_000, RULES).ok).toBe(false)
    expect(validatePayment(-500, 100_000, RULES).ok).toBe(false)
  })

  it('rejects a part payment when the school does not take them', () => {
    const r = validatePayment(50_000, 100_000, { ...RULES, partialAllowed: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('Part payment is switched off')
  })

  it('enforces a minimum part payment', () => {
    const r = validatePayment(5_000, 100_000, { ...RULES, minPartialAmount: 50_000 })
    expect(r.ok).toBe(false)
  })

  it('allows the exact outstanding amount even below the part-payment minimum', () => {
    expect(validatePayment(5_000, 5_000, { ...RULES, minPartialAmount: 50_000 }).ok).toBe(true)
  })

  it('rejects overpayment only when it is switched off', () => {
    expect(validatePayment(200_000, 100_000, RULES).ok).toBe(true)
    expect(validatePayment(200_000, 100_000, { ...RULES, allowOverpayment: false }).ok).toBe(false)
  })

  it('never accepts a future date', () => {
    const r = validatePayment(100_000, 100_000, RULES,
      { paidOn: '2026-09-10', today: '2026-09-04', canBackdate: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('future')
  })

  it('refuses to backdate without the permission', () => {
    const r = validatePayment(100_000, 100_000, RULES,
      { paidOn: '2026-09-01', today: '2026-09-04', canBackdate: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('permission')
  })

  it('caps how far back even a permitted user can reach', () => {
    expect(validatePayment(100_000, 100_000, RULES,
      { paidOn: '2026-08-20', today: '2026-09-04', canBackdate: true }).ok).toBe(true)
    expect(validatePayment(100_000, 100_000, RULES,
      { paidOn: '2026-06-01', today: '2026-09-04', canBackdate: true }).ok).toBe(false)
  })
})
