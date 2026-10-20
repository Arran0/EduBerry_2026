import { describe, expect, it } from 'vitest'
import { failureApplies, isSent, reconcile } from './payoutClaim'

describe('isSent', () => {
  it('lets a record that was never sent, or whose last attempt failed, go again', () => {
    expect(isSent(null)).toBe(false)
    expect(isSent(undefined)).toBe(false)
    expect(isSent('failed')).toBe(false)
  })

  it('holds back a record the bank already has', () => {
    expect(isSent('initiated')).toBe(true)
    expect(isSent('processed')).toBe(true)
  })
})

describe('reconcile', () => {
  it('folds reference-less results into one update per status and writes the rest by id', async () => {
    const calls: { patch: Record<string, unknown>; ids?: string[]; id?: string }[] = []
    const admin = {
      from: () => ({
        update: (patch: Record<string, unknown>) => ({
          in: async (_col: string, ids: string[]) => { calls.push({ patch, ids }); return { error: null } },
          eq: async (_col: string, id: string) => { calls.push({ patch, id }); return { error: null } },
        }),
      }),
    }
    await reconcile(admin as never, 'salary_records', [
      { reference: 'a', status: 'initiated' },
      { reference: 'b', status: 'initiated' },
      { reference: 'c', status: 'failed' },
      { reference: 'd', status: 'initiated', payoutId: 'BANK-9' },
    ])
    expect(calls).toHaveLength(3)
    expect(calls).toContainEqual({ patch: { payout_status: 'initiated', payout_reference: null }, ids: ['a', 'b'] })
    expect(calls).toContainEqual({ patch: { payout_status: 'failed', payout_reference: null }, ids: ['c'] })
    expect(calls).toContainEqual({ patch: { payout_status: 'initiated', payout_reference: 'BANK-9' }, id: 'd' })
  })
})

describe('failureApplies', () => {
  const inFlight = { status: 'approved', payout_status: 'initiated', payout_reference: 'pay_2' }

  it('applies a failure for the attempt in flight', () => {
    expect(failureApplies(inFlight, 'pay_2')).toBe(true)
    expect(failureApplies(inFlight, undefined)).toBe(true)
    expect(failureApplies({ ...inFlight, payout_reference: null }, 'pay_2')).toBe(true)
  })

  it('ignores a replayed failure from an earlier attempt', () => {
    expect(failureApplies(inFlight, 'pay_1')).toBe(false)
  })

  it('ignores a failure when nothing is in flight', () => {
    expect(failureApplies({ ...inFlight, payout_status: 'failed' }, 'pay_2')).toBe(false)
    expect(failureApplies({ ...inFlight, payout_status: null }, 'pay_2')).toBe(false)
    expect(failureApplies({ ...inFlight, payout_status: 'processed' }, 'pay_2')).toBe(false)
  })

  it('never fails a record already paid', () => {
    expect(failureApplies({ ...inFlight, status: 'paid' }, 'pay_2')).toBe(false)
  })
})
