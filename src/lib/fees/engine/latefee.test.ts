import { describe, it, expect } from 'vitest'
import {
  computeLateFee, lateFeeStartDate, validateRule, pickRule, type LateFeeRule,
} from './latefee'

const rule = (over: Partial<LateFeeRule> = {}): LateFeeRule => ({
  id: 'r1', name: 'Standard late fee',
  graceDays: 5, chargeType: 'flat', rate: 50, frequency: 'weekly', basis: 'unpaid',
  capAmount: 100_000, capPercent: null, enabled: true, enabledFrom: null,
  ...over,
})

const BILL = 850_000 // ₹8,500

describe('when counting starts', () => {
  it('starts after the grace period', () => {
    expect(lateFeeStartDate(rule(), '2026-04-10')).toBe('2026-04-15')
  })

  it('never starts before the rule was switched on', () => {
    // The bill was due in April; the rule was enabled in September. This is the
    // guarantee that stops a school back-charging a whole term the day they
    // turn late fees on.
    expect(lateFeeStartDate(rule({ enabledFrom: '2026-09-05' }), '2026-04-10'))
      .toBe('2026-09-05')
  })

  it('leaves the grace period alone when the rule predates the bill', () => {
    expect(lateFeeStartDate(rule({ enabledFrom: '2026-01-01' }), '2026-04-10'))
      .toBe('2026-04-15')
  })
})

describe('nothing is charged when nothing is owed', () => {
  it('charges nothing before the start date', () => {
    const r = computeLateFee(rule(), BILL, '2026-04-10', '2026-04-12')
    expect(r.amount).toBe(0)
    expect(r.why).toContain('Not late yet')
  })

  it('charges nothing on the start date itself', () => {
    expect(computeLateFee(rule(), BILL, '2026-04-10', '2026-04-15').amount).toBe(0)
  })

  it('charges nothing on a bill with no balance', () => {
    const r = computeLateFee(rule(), 0, '2026-04-10', '2026-12-01')
    expect(r.amount).toBe(0)
    expect(r.why).toContain('Nothing outstanding')
  })

  it('charges nothing on the day a rule is enabled, however old the bill', () => {
    const r = computeLateFee(
      rule({ enabledFrom: '2026-09-05' }), BILL, '2026-04-10', '2026-09-05')
    expect(r.amount).toBe(0)
  })
})

describe('accrual', () => {
  it('charges a flat weekly fee per started week', () => {
    // Start 15 Apr. On 22 Apr that is 7 days — one week.
    expect(computeLateFee(rule(), BILL, '2026-04-10', '2026-04-22').amount).toBe(5_000)
    // 23 Apr is into the second week and rounds up.
    expect(computeLateFee(rule(), BILL, '2026-04-10', '2026-04-23').amount).toBe(10_000)
  })

  it('charges a one-off fee once, however late', () => {
    const once = rule({ frequency: 'once', capAmount: null })
    expect(computeLateFee(once, BILL, '2026-04-10', '2026-04-16').amount).toBe(5_000)
    expect(computeLateFee(once, BILL, '2026-04-10', '2027-04-16').amount).toBe(5_000)
  })

  it('computes a percentage against the balance it was given', () => {
    const pct = rule({ chargeType: 'percent', rate: 2, frequency: 'once', capAmount: null })
    expect(computeLateFee(pct, BILL, '2026-04-10', '2026-05-01').amount).toBe(17_000)
  })

  it('counts daily and monthly the same way', () => {
    const daily = rule({ frequency: 'daily', rate: 10, capAmount: 100_000 })
    expect(computeLateFee(daily, BILL, '2026-04-10', '2026-04-25').amount).toBe(10_000)
    const monthly = rule({ frequency: 'monthly', rate: 200, capAmount: 100_000 })
    expect(computeLateFee(monthly, BILL, '2026-04-10', '2026-05-20').amount).toBe(40_000)
  })
})

describe('the cap is the safety rail', () => {
  it('holds a weekly fee at the cap however long the bill runs', () => {
    const r = computeLateFee(rule(), BILL, '2026-04-10', '2027-04-10')
    expect(r.amount).toBe(100_000)
    expect(r.cappedBy).toBe('amount')
    expect(r.why).toContain('capped')
  })

  it('applies a percentage cap against the bill', () => {
    const r = computeLateFee(
      rule({ capAmount: null, capPercent: 5 }), BILL, '2026-04-10', '2027-04-10')
    expect(r.amount).toBe(42_500) // 5% of ₹8,500
    expect(r.cappedBy).toBe('percent')
  })

  it('takes the tighter of the two caps', () => {
    const r = computeLateFee(
      rule({ capAmount: 20_000, capPercent: 5 }), BILL, '2026-04-10', '2027-04-10')
    expect(r.amount).toBe(20_000)
  })

  it('never charges more than the cap even on day one of a huge rate', () => {
    const r = computeLateFee(
      rule({ chargeType: 'percent', rate: 50, frequency: 'daily', capAmount: 5_000 }),
      BILL, '2026-04-10', '2026-06-10')
    expect(r.amount).toBe(5_000)
  })
})

describe('what the rule builder warns about', () => {
  it('refuses a repeating rule with no cap', () => {
    const w = validateRule(rule({ capAmount: null, capPercent: null }), BILL)
    expect(w.some(x => x.level === 'error' && x.message.includes('needs a cap'))).toBe(true)
  })

  it('allows a one-off rule without a cap', () => {
    const w = validateRule(rule({ frequency: 'once', capAmount: null, capPercent: null }), BILL)
    expect(w.some(x => x.message.includes('needs a cap'))).toBe(false)
  })

  it('refuses a rule that would charge more than the bill in a term', () => {
    const w = validateRule(
      rule({ chargeType: 'percent', rate: 20, frequency: 'weekly', capAmount: 10_000_000 }), BILL)
    expect(w.some(x => x.level === 'error' && x.message.includes('more than the bill'))).toBe(true)
  })

  it('stays quiet about a modest rate', () => {
    // ₹50 a week reaches ₹650 over a term on an ₹8,500 bill. That is not
    // alarming and the builder should not cry wolf about it.
    const w = validateRule(rule({ capAmount: 500_000 }), BILL)
    expect(w.some(x => x.message.includes('more than a quarter'))).toBe(false)
  })

  it('warns when a rule reaches a quarter of the bill in a term', () => {
    // ₹250 a week is ₹3,250 over the same term — over a third of the bill.
    const w = validateRule(rule({ rate: 250, capAmount: 500_000 }), BILL)
    expect(w.some(x => x.level === 'warning' && x.message.includes('more than a quarter'))).toBe(true)
  })

  it('warns about no grace days, because a payment posted on the due date is not late', () => {
    const w = validateRule(rule({ graceDays: 0 }), BILL)
    expect(w.some(x => x.message.includes('no grace days'))).toBe(true)
  })

  it('refuses a zero rate', () => {
    const w = validateRule(rule({ rate: 0 }), BILL)
    expect(w.some(x => x.level === 'error' && x.message.includes('never charge'))).toBe(true)
  })

  it('passes a sane rule with nothing to say', () => {
    const w = validateRule(rule({ graceDays: 7, capAmount: 50_000 }), BILL)
    expect(w.filter(x => x.level === 'error')).toEqual([])
  })
})

describe('which rule wins', () => {
  const r = (scope: string, enabled = true) => ({ scope, enabled, id: scope })

  it('prefers the most specific scope', () => {
    expect(pickRule([r('all'), r('group'), r('installment')])?.scope).toBe('installment')
    expect(pickRule([r('all'), r('group')])?.scope).toBe('group')
  })

  it('ignores rules that are switched off', () => {
    expect(pickRule([r('installment', false), r('all')])?.scope).toBe('all')
  })

  it('returns nothing when every rule is off', () => {
    expect(pickRule([r('all', false)])).toBeNull()
  })
})

describe('the explanation the office reads aloud', () => {
  it('says how late, from when, and how it was worked out', () => {
    const r = computeLateFee(rule(), BILL, '2026-04-10', '2026-05-15')
    expect(r.why).toContain('30 days late from 2026-04-15')
    expect(r.why).toContain('₹50')
    expect(r.why).toContain('weekly')
  })
})
