import { describe, expect, it } from 'vitest'
import {
  inRange, matchesStatus, payModeOf, rangeFor, statusFacets, todayISO,
  type StatusFacet,
} from './ledger'
import type { InvoiceRow } from './invoices'

// The filter rules are the whole point of this module: a clerk who ticks
// "Overdue" is asking a question about the calendar and the balance, not about
// one column, and a bill can honestly answer to several of these words at
// once. These tests are about that, and about the masked case — where the
// amounts arrive as NULL and guessing would invent a settled bill.

type Bill = Pick<InvoiceRow, 'status' | 'due_date' | 'paid' | 'balance'>

const bill = (over: Partial<Bill>): Bill => ({
  status: 'pending', due_date: '2026-06-10', paid: 0, balance: 5000, ...over,
})

const TODAY = '2026-07-01'

describe('statusFacets', () => {
  it('calls a part-paid bill past its date both partly paid and overdue', () => {
    // The case the single-status column could never express, and the one the
    // office asks about most: money came in, not enough, and the date has gone.
    const facets = statusFacets(bill({ paid: 2000, balance: 3000 }), TODAY)
    expect([...facets].sort()).toEqual(['overdue', 'partly_paid'])
  })

  it('calls an untouched bill past its date both pending and overdue', () => {
    const facets = statusFacets(bill({ paid: 0, balance: 5000 }), TODAY)
    expect([...facets].sort()).toEqual(['overdue', 'pending'])
  })

  it('never calls a settled bill overdue, however long ago it was due', () => {
    const facets = statusFacets(
      bill({ status: 'paid', paid: 5000, balance: 0, due_date: '2025-01-01' }), TODAY)
    expect([...facets]).toEqual(['paid'])
  })

  it('leaves a bill that is not yet due out of overdue', () => {
    const facets = statusFacets(bill({ due_date: '2026-09-01' }), TODAY)
    expect([...facets]).toEqual(['pending'])
  })

  it('treats a zero-balance bill as paid even when nothing was collected', () => {
    // A bill discounted to nothing owes nothing. Calling it pending would put
    // it on a chase list forever.
    const facets = statusFacets(bill({ paid: 0, balance: 0 }), TODAY)
    expect([...facets]).toEqual(['paid'])
  })

  it('says cancelled and nothing else', () => {
    const facets = statusFacets(
      bill({ status: 'cancelled', balance: 5000, due_date: '2025-01-01' }), TODAY)
    expect([...facets]).toEqual(['cancelled'])
  })

  it('falls back to the stored status when the amounts are hidden', () => {
    // A caller without fees.view_amounts gets NULL money from the view.
    // Comparing that would read as "balance <= 0" and mark the bill paid.
    const facets = statusFacets(
      bill({ status: 'partly_paid', paid: null, balance: null }), TODAY)
    expect([...facets].sort()).toEqual(['overdue', 'partly_paid'])
  })
})

describe('matchesStatus', () => {
  const overdueAndPartly = bill({ paid: 2000, balance: 3000 })

  it('matches everything when nothing is ticked', () => {
    expect(matchesStatus(overdueAndPartly, new Set(), TODAY)).toBe(true)
    expect(matchesStatus(bill({ status: 'cancelled' }), new Set(), TODAY)).toBe(true)
  })

  it('matches on any ticked facet, so two ticks widen the list', () => {
    const paidOnly = new Set<StatusFacet>(['paid'])
    expect(matchesStatus(overdueAndPartly, paidOnly, TODAY)).toBe(false)

    const paidOrOverdue = new Set<StatusFacet>(['paid', 'overdue'])
    expect(matchesStatus(overdueAndPartly, paidOrOverdue, TODAY)).toBe(true)
  })

  it('keeps cancelled bills out unless cancelled is asked for', () => {
    const cancelled = bill({ status: 'cancelled', balance: 5000, due_date: '2025-01-01' })
    expect(matchesStatus(cancelled, new Set<StatusFacet>(['overdue']), TODAY)).toBe(false)
    expect(matchesStatus(cancelled, new Set<StatusFacet>(['cancelled']), TODAY)).toBe(true)
  })
})

describe('payModeOf', () => {
  it('folds the nine stored methods into the five words the office uses', () => {
    expect(payModeOf('cash')).toBe('cash')
    expect(payModeOf('upi')).toBe('upi')
    expect(payModeOf('razorpay')).toBe('upi')
    expect(payModeOf('netbanking')).toBe('bank')
    expect(payModeOf('bank_transfer')).toBe('bank')
    expect(payModeOf('dd')).toBe('cheque')
  })

  it('has no word for an internal adjustment, which is not a way of paying', () => {
    expect(payModeOf('adjustment')).toBeNull()
  })
})

describe('inRange', () => {
  it('lets everything through when the range is All', () => {
    expect(inRange('2020-01-01', rangeFor('all'))).toBe(true)
    expect(inRange(null, rangeFor('all'))).toBe(true)
  })

  it('holds a single day to that day', () => {
    const today = rangeFor('today')
    expect(inRange(todayISO(), today)).toBe(true)
    expect(inRange(todayISO(-1), today)).toBe(false)
    expect(inRange(todayISO(1), today)).toBe(false)
  })

  it('reads yesterday as yesterday, not as "up to today"', () => {
    const yesterday = rangeFor('yesterday')
    expect(inRange(todayISO(-1), yesterday)).toBe(true)
    expect(inRange(todayISO(), yesterday)).toBe(false)
  })

  it('takes both ends of a custom range inclusively, and tolerates one open end', () => {
    const custom = { key: 'custom' as const, from: '2026-04-01', to: '2026-04-30' }
    expect(inRange('2026-04-01', custom)).toBe(true)
    expect(inRange('2026-04-30', custom)).toBe(true)
    expect(inRange('2026-05-01', custom)).toBe(false)

    const openEnd = { key: 'custom' as const, from: '2026-04-01', to: null }
    expect(inRange('2030-01-01', openEnd)).toBe(true)
  })

  it('ignores the time half of a timestamp', () => {
    const today = rangeFor('today')
    expect(inRange(`${todayISO()}T23:59:00Z`, today)).toBe(true)
  })
})
