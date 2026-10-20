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

export interface PayoutRecordState {
  status: string | null
  payout_status: string | null
  payout_reference: string | null
}

/**
 * Whether a bank "failed" callback applies to the attempt now in flight.
 *
 * Bank callbacks carry no timestamp or nonce, so a captured one can be
 * replayed. A replayed *failure* is the dangerous kind: once a failed transfer
 * has been retried, the old callback would mark the live retry failed too,
 * making it eligible for a third send while the second may still land — the
 * person is paid twice. So a failure only counts when a send is actually
 * outstanding and, when both sides carry the bank's payout id, it names that
 * attempt. A late success is always recorded: that money moved.
 */
export function failureApplies(record: PayoutRecordState, callbackPayoutId?: string | null): boolean {
  if (record.status === 'paid') return false
  if (record.payout_status !== 'initiated') return false
  if (record.payout_reference && callbackPayoutId && record.payout_reference !== callbackPayoutId) return false
  return true
}

/** Apply a verified bank payout callback to one staff or driver record. */
export async function applyPayoutCallback(
  admin: SupabaseClient,
  table: 'salary_records' | 'driver_payroll_records',
  event: { reference: string; outcome: 'processed' | 'failed'; payoutId?: string },
): Promise<'unknown' | 'paid' | 'failed' | 'stale'> {
  const { data: record } = await admin
    .from(table)
    .select('id, status, payout_status, payout_reference')
    .eq('id', event.reference)
    .maybeSingle()
  if (!record) return 'unknown'

  if (event.outcome === 'processed') {
    await admin.from(table).update({
      payout_status: 'processed',
      status: 'paid',
      payout_reference: event.payoutId ?? record.id,
    }).eq('id', record.id)
    return 'paid'
  }

  if (!failureApplies(record as PayoutRecordState, event.payoutId)) {
    console.warn(`payout webhook (${table}): ignored stale failure for ${record.id}`)
    return 'stale'
  }
  // Conditional on the state just checked, so a success that lands between the
  // read and this write is never overwritten.
  await admin.from(table).update({ payout_status: 'failed' })
    .eq('id', record.id)
    .eq('payout_status', 'initiated')
    .neq('status', 'paid')
  return 'failed'
}
