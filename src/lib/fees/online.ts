// ─────────────────────────────────────────────────────────────────────────────
// Paying online, client side: start an order, open Razorpay's checkout, and
// confirm what came back. The amount is never decided here — the order route
// reads each bill's balance itself.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, authHeader, isMissingRelation } from '@/lib/supabase'

export interface OnlineOrder {
  order_id: string
  key_id: string
  /** Paise. */
  amount: number
  currency: string
  bills: string[]
  prefill: { name?: string; email?: string; contact?: string }
}

export type OnlineStatus = 'created' | 'processing' | 'paid' | 'failed' | 'review'

export interface OnlineOrderRow {
  id: string
  order_id: string
  amount: number
  status: OnlineStatus
  receipt_no: string | null
  payment_id: string | null
  error: string | null
  created_at: string
  allocations: { invoice_id: string; amount: number }[]
}

export interface VerifyResult {
  status: OnlineStatus | 'unknown'
  payment_id?: string | null
  receipt_no?: string | null
  error?: string
}

async function post<T>(url: string, body: unknown): Promise<T & { success: boolean; error?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  })
  try {
    return await res.json()
  } catch {
    return { success: false, error: 'The server did not answer. Try again.' } as T & { success: boolean; error?: string }
  }
}

export async function createOnlineOrder(invoiceIds: string[]): Promise<OnlineOrder> {
  const json = await post<OnlineOrder>('/api/fees/online/order', { invoice_ids: invoiceIds })
  if (!json.success) throw new Error(json.error ?? 'Could not start the payment.')
  return json
}

export async function verifyOnlinePayment(input: {
  order_id: string
  payment_id?: string
  signature?: string
}): Promise<VerifyResult> {
  const json = await post<VerifyResult>('/api/fees/online/verify', input)
  if (!json.success && !json.status) throw new Error(json.error ?? 'Could not confirm the payment.')
  return json
}

/** The caller's online payments in a session that have not become a receipt. */
export async function fetchOpenOnlineOrders(academicYearId: string): Promise<OnlineOrderRow[]> {
  const { data, error } = await supabase.from('fee_online_orders')
    .select('id, order_id, amount, status, receipt_no, payment_id, error, created_at, allocations')
    .eq('academic_year_id', academicYearId)
    .in('status', ['processing', 'review'])
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) {
    if (isMissingRelation(error)) return []
    throw error
  }
  return (data ?? []) as OnlineOrderRow[]
}

// ── Razorpay checkout ───────────────────────────────────────────────────

interface RazorpayResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}
interface RazorpayCheckout {
  open(): void
  on(event: 'payment.failed', cb: (r: { error?: { description?: string } }) => void): void
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayCheckout

export function loadRazorpay(): Promise<RazorpayCtor | null> {
  return new Promise(resolve => {
    const w = window as unknown as { Razorpay?: RazorpayCtor }
    if (w.Razorpay) return resolve(w.Razorpay)
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.async = true
    s.onload = () => resolve((window as unknown as { Razorpay?: RazorpayCtor }).Razorpay ?? null)
    s.onerror = () => resolve(null)
    document.body.appendChild(s)
  })
}

export type CheckoutOutcome =
  | { kind: 'paid'; response: RazorpayResponse }
  | { kind: 'dismissed' }
  | { kind: 'failed'; reason: string }

/** Opens checkout for an order and resolves once the person is done with it. */
export async function openCheckout(order: OnlineOrder, opts: {
  school: string
  description: string
}): Promise<CheckoutOutcome> {
  const Ctor = await loadRazorpay()
  if (!Ctor) return { kind: 'failed', reason: 'Could not load the payment window. Check your connection and try again.' }
  return new Promise(resolve => {
    let settled = false
    // A failed attempt leaves checkout open for another try, so it is only
    // remembered; what the person finally did decides the outcome.
    let lastFailure: string | null = null
    const done = (o: CheckoutOutcome) => { if (!settled) { settled = true; resolve(o) } }
    const rzp = new Ctor({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      order_id: order.order_id,
      name: opts.school,
      description: opts.description,
      prefill: order.prefill,
      theme: { color: '#3D3B40' },
      handler: (response: RazorpayResponse) => done({ kind: 'paid', response }),
      modal: {
        ondismiss: () => done(lastFailure ? { kind: 'failed', reason: lastFailure } : { kind: 'dismissed' }),
        confirm_close: true,
      },
    })
    rzp.on('payment.failed', r => { lastFailure = r.error?.description ?? 'The payment did not go through.' })
    rzp.open()
  })
}
