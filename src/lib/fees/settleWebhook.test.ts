import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { settleSchoolFee } from './settleWebhook'

/**
 * The underpayment hole, pinned.
 *
 * Both payment webhooks used to mark a fee `paid` on the arrival of any
 * payment at all. A UPI push payment's amount is chosen by the payer and the
 * reference that matches it to a bill is printed on the bill, so ₹1 against
 * your own slip settled the whole thing. These cover the rule that replaced
 * it: the fee is settled from the money actually received.
 */

/** A Supabase client stub covering just the two reads and the one write. */
function fakeAdmin(billed: number, verifiedAmounts: number[]) {
  const updates: { status: string }[] = []

  const client = {
    from(table: string) {
      if (table === 'school_fees') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { amount: billed } }) }),
          }),
          update: (patch: { status: string }) => ({
            eq: async () => { updates.push(patch); return { error: null } },
          }),
        }
      }
      // school_fee_payments
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: verifiedAmounts.map(amount => ({ amount })) }),
          }),
        }),
      }
    },
  } as unknown as SupabaseClient

  return { client, updates }
}

describe('settleSchoolFee', () => {
  it('leaves a short payment partial rather than paid', async () => {
    const { client, updates } = fakeAdmin(50_000, [1])
    expect(await settleSchoolFee(client, 'fee-1')).toBe('partial')
    expect(updates).toEqual([{ status: 'partial' }])
  })

  it('marks it paid once the verified payments cover the fee', async () => {
    const { client, updates } = fakeAdmin(50_000, [20_000, 30_000])
    expect(await settleSchoolFee(client, 'fee-1')).toBe('paid')
    expect(updates).toEqual([{ status: 'paid' }])
  })

  it('treats an overpayment as paid', async () => {
    const { client } = fakeAdmin(1_000, [1_500])
    expect(await settleSchoolFee(client, 'fee-1')).toBe('paid')
  })

  it('falls back to unpaid when nothing is verified', async () => {
    const { client } = fakeAdmin(1_000, [])
    expect(await settleSchoolFee(client, 'fee-1')).toBe('unpaid')
  })

  it('counts a string amount, which is how NUMERIC arrives', async () => {
    const { client } = fakeAdmin(100, ['100' as unknown as number])
    expect(await settleSchoolFee(client, 'fee-1')).toBe('paid')
  })
})
