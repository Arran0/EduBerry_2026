import { describe, expect, it } from 'vitest'
import { isSent, reconcile } from './payoutClaim'

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
