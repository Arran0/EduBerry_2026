import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared by the staff and driver payout routes.
 *
 * A record handed to the bank keeps its 'approved' status until the bank
 * calls back or someone marks it paid, so payout_status is what says whether
 * it has already gone. Only a record never sent, or whose last attempt
 * failed, may be sent again — anything else would pay the person twice.
 */
export function isSent(payoutStatus: string | null | undefined): boolean {
  return payoutStatus != null && payoutStatus !== 'failed'
}

interface PayoutResult {
  reference: string
  status: 'initiated' | 'failed'
  payoutId?: string
}

/**
 * Write each record's outcome back.
 *
 * Results with no bank reference of their own collapse into one update per
 * status; the rest carry a distinct reference each and are written
 * concurrently, a few at a time, rather than one round trip after another.
 */
export async function reconcile(
  admin: SupabaseClient,
  table: 'salary_records' | 'driver_payroll_records',
  results: PayoutResult[],
): Promise<void> {
  const plain = new Map<string, string[]>()
  const withRef: PayoutResult[] = []
  for (const r of results) {
    if (r.payoutId) withRef.push(r)
    else plain.set(r.status, [...(plain.get(r.status) ?? []), r.reference])
  }

  const writes: (() => PromiseLike<unknown>)[] = []
  for (const [status, ids] of plain) {
    writes.push(() => admin.from(table).update({ payout_status: status, payout_reference: null }).in('id', ids))
  }
  for (const r of withRef) {
    writes.push(() => admin.from(table).update({ payout_status: r.status, payout_reference: r.payoutId }).eq('id', r.reference))
  }

  const BATCH = 10
  for (let i = 0; i < writes.length; i += BATCH) {
    const res = await Promise.all(writes.slice(i, i + BATCH).map(w => w()))
    for (const r of res as { error?: { message: string } | null }[]) {
      if (r?.error) console.error(`payout reconcile (${table}) failed:`, r.error.message)
    }
  }
}
