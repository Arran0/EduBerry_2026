import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Turning a captured online payment into a receipt.
//
// Two callers reach this for the same order: the student's browser, the moment
// Razorpay's checkout hands back a signed payment, and Razorpay's webhook, which
// may arrive before it, after it, or instead of it if the tab was closed. The
// row is claimed by moving it out of 'created' in a single UPDATE, so whichever
// arrives second finds nothing to claim and reads back what the first did.
//
// The receipt itself is fee_collect's — the same RPC the counter uses — so an
// online payment is numbered, allocated, ledgered and sealed exactly like cash.
// ─────────────────────────────────────────────────────────────────────────────

export interface OnlineOrderRow {
  id: string
  student_id: string
  academic_year_id: string
  order_id: string
  amount: number
  allocations: { invoice_id: string; amount: number }[]
  status: 'created' | 'processing' | 'paid' | 'failed' | 'review'
  provider_payment_id: string | null
  payment_id: string | null
  receipt_no: string | null
  error: string | null
}

export type SettleResult =
  | { ok: true; status: 'paid'; payment_id: string | null; receipt_no: string | null }
  | { ok: false; status: OnlineOrderRow['status'] | 'unknown'; error?: string }

const COLS = 'id, student_id, academic_year_id, order_id, amount, allocations, status, provider_payment_id, payment_id, receipt_no, error'

export async function findOnlineOrder(admin: SupabaseClient, orderId: string): Promise<OnlineOrderRow | null> {
  const { data } = await admin.from('fee_online_orders').select(COLS).eq('order_id', orderId).maybeSingle()
  return (data as OnlineOrderRow | null) ?? null
}

/**
 * Record a captured payment against its order. `captured` is in rupees, as the
 * gateway reported it; the receipt is for what actually arrived.
 */
export async function settleOnlineOrder(
  admin: SupabaseClient,
  orderId: string,
  providerPaymentId: string,
  captured: number,
): Promise<SettleResult> {
  const now = new Date().toISOString()
  const { data: claimed } = await admin.from('fee_online_orders')
    .update({ status: 'processing', provider_payment_id: providerPaymentId, updated_at: now })
    .eq('order_id', orderId)
    .in('status', ['created', 'failed'])
    .select(COLS)
    .maybeSingle()

  if (!claimed) {
    const existing = await findOnlineOrder(admin, orderId)
    if (!existing) return { ok: false, status: 'unknown', error: 'This payment is not one we started.' }
    if (existing.status === 'paid') {
      return { ok: true, status: 'paid', payment_id: existing.payment_id, receipt_no: existing.receipt_no }
    }
    return { ok: false, status: existing.status, error: existing.error ?? undefined }
  }

  const order = claimed as OnlineOrderRow

  // The bills may have moved since the order was made — the office could have
  // taken cash for one. Put the money only against what is still owed; any
  // remainder is banked as a credit by fee_collect, never lost.
  const ids = order.allocations.map(a => a.invoice_id)
  const { data: open } = ids.length
    ? await admin.from('fee_invoices').select('id, balance, status').in('id', ids)
    : { data: [] as { id: string; balance: number; status: string }[] }
  const owed = new Map((open ?? [])
    .filter(i => ['pending', 'partly_paid', 'overdue'].includes(i.status))
    .map(i => [i.id, Number(i.balance) || 0]))
  let left = captured
  const allocations = order.allocations.flatMap(a => {
    const take = Math.min(Number(a.amount) || 0, owed.get(a.invoice_id) ?? 0, left)
    if (take <= 0) return []
    left -= take
    return [{ invoice_id: a.invoice_id, amount: Math.round(take * 100) / 100 }]
  })

  const { data, error } = await admin.rpc('fee_collect', {
    p_student: order.student_id,
    p_year: order.academic_year_id,
    p_amount: captured,
    p_method: 'razorpay',
    // An empty list lets fee_collect apply the money oldest bill first.
    p_allocations: allocations.length ? allocations : null,
    p_paid_on: null,
    p_reference: providerPaymentId,
    p_notes: 'Paid online',
    p_instrument: null,
    p_status: null,
    // The student paid it; the receipt says so.
    p_actor: order.student_id,
  })

  if (error) {
    // The money has been taken, so this is never "failed": the office has to
    // look at it. The order keeps the gateway's payment id for that.
    await admin.from('fee_online_orders')
      .update({ status: 'review', error: error.message, updated_at: new Date().toISOString() })
      .eq('id', order.id)
    return { ok: false, status: 'review', error: error.message }
  }

  const result = (data ?? {}) as { payment_id?: string; receipt_no?: string }
  await admin.from('fee_online_orders')
    .update({
      status: 'paid',
      payment_id: result.payment_id ?? null,
      receipt_no: result.receipt_no ?? null,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
  // fee_payments is immutable once written (fee_payments_guard); the receipt
  // carries the gateway's payment id as its reference, and this order row
  // ties the two together.

  return { ok: true, status: 'paid', payment_id: result.payment_id ?? null, receipt_no: result.receipt_no ?? null }
}

/** A payment the gateway reports as failed. Only an order nobody has settled moves. */
export async function failOnlineOrder(admin: SupabaseClient, orderId: string, reason: string): Promise<void> {
  await admin.from('fee_online_orders')
    .update({ status: 'failed', error: reason, updated_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('status', 'created')
}
