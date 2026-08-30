'use client'

import { supabase } from '@/lib/supabase'

// ============================================================================
// The parent's side of paying a fee.
// ----------------------------------------------------------------------------
// One client for school and bus fees, hitting /api/fees/pay/intent. Replaces
// createRazorpayOrder + startUpiCollect in both src/lib/fees.ts and
// src/lib/bus.ts — four near-identical functions that drifted apart.
//
// Nothing here confirms a payment. Razorpay Checkout's `handler` callback fires
// when the parent's browser thinks it worked, which is not the same as the money
// having arrived, and treating it as confirmation is how a fee gets marked paid
// on a failed transaction. Confirmation comes from the webhook; the UI polls the
// fee's own status and says so plainly while it waits.
// ============================================================================

export type PaySource = 'school' | 'bus'

export interface PaymentIntent {
  success: boolean
  error?: string
  /** For Razorpay Checkout — UPI Intent, cards, netbanking, wallets. */
  order_id?: string
  key_id?: string
  /** Paise, what Checkout wants. */
  amount?: number
  /** Rupees, what a human wants. */
  amount_rupees?: number
  /** A dynamic UPI QR for this exact amount. Null when the account has QR disabled. */
  qr_image_url?: string | null
  qr_id?: string | null
  outstanding?: number
  billed?: number
  paid?: number
  reference?: string
}

export interface StartPaymentOptions {
  source?: PaySource
  /** Pay less than the outstanding balance, where the structure allows it. */
  amount?: number
  /** Skip QR creation when the UI will not show one. */
  wantQr?: boolean
}

/**
 * Start a payment. Returns everything the modal needs: a checkout order and,
 * where the account supports it, a scannable QR for the same amount.
 */
export async function startPayment(feeId: string, opts: StartPaymentOptions = {}): Promise<PaymentIntent> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { success: false, error: 'Please sign in again.' }

  try {
    const res = await fetch('/api/fees/pay/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        fee_id: feeId,
        source: opts.source ?? 'school',
        amount: opts.amount,
        want_qr: opts.wantQr ?? true,
      }),
    })
    const json = await res.json()
    if (!json.success) return { success: false, error: json.error ?? 'Could not start the payment.' }
    return json as PaymentIntent
  } catch (e) {
    console.error('startPayment failed:', e)
    return { success: false, error: 'Network error. Check your connection and try again.' }
  }
}

// ── Razorpay Checkout ───────────────────────────────────────────────────────

interface RazorpayCheckout { open(): void }
interface RazorpayWindow extends Window {
  Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout
}

export function loadRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof window === 'undefined') return resolve(false)
    if ((window as RazorpayWindow).Razorpay) return resolve(true)
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

export interface CheckoutOptions {
  intent: PaymentIntent
  name: string
  description: string
  prefill?: { name?: string; email?: string; contact?: string }
  /** The parent closed Checkout without paying. */
  onDismiss?: () => void
  /** Checkout reported success. Start polling — do NOT treat this as confirmation. */
  onSubmitted?: () => void
}

export async function openCheckout(opts: CheckoutOptions): Promise<{ ok: boolean; error?: string }> {
  const ok = await loadRazorpayScript()
  if (!ok) return { ok: false, error: 'Could not load the payment window. Check your connection.' }

  const Ctor = (window as RazorpayWindow).Razorpay
  if (!Ctor) return { ok: false, error: 'The payment window is unavailable.' }

  const { intent } = opts
  if (!intent.order_id || !intent.key_id) return { ok: false, error: 'The payment could not be started.' }

  const checkout = new Ctor({
    key: intent.key_id,
    order_id: intent.order_id,
    amount: intent.amount,
    currency: 'INR',
    name: opts.name,
    description: opts.description,
    prefill: opts.prefill,
    theme: { color: '#334155' },
    handler: () => opts.onSubmitted?.(),
    modal: { ondismiss: () => opts.onDismiss?.() },
  })
  checkout.open()
  return { ok: true }
}

// ── Waiting for the webhook ─────────────────────────────────────────────────

export type FeeSettleState = 'pending' | 'partial' | 'paid'

/**
 * Poll the fee's own status until the webhook has been and gone.
 *
 * A payment that reaches us but leaves a balance settles on 'partial', which is
 * a success for the parent — they paid what they chose to pay — and the caller
 * must say so rather than continuing to spin.
 */
export async function waitForSettlement(
  feeId: string,
  source: PaySource,
  opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<{ settled: boolean; state: FeeSettleState }> {
  const table = source === 'school' ? 'school_fees' : 'bus_fees'
  const timeout = opts.timeoutMs ?? 90_000
  const interval = opts.intervalMs ?? 3_000
  const until = Date.now() + timeout

  while (Date.now() < until) {
    if (opts.signal?.aborted) return { settled: false, state: 'pending' }

    const { data } = await supabase.from(table).select('status').eq('id', feeId).maybeSingle()
    const status = data?.status as string | undefined
    if (status === 'paid') return { settled: true, state: 'paid' }
    if (status === 'partial') return { settled: true, state: 'partial' }

    await new Promise(r => setTimeout(r, interval))
  }
  return { settled: false, state: 'pending' }
}

/** What the parent still owes, read from the ledger rather than the fee's status. */
export async function fetchOutstanding(feeId: string, source: PaySource): Promise<number | null> {
  const table = source === 'school' ? 'school_fees' : 'bus_fees'
  const [{ data: fee }, { data: txns }] = await Promise.all([
    supabase.from(table).select('amount').eq('id', feeId).maybeSingle(),
    supabase.from('fee_transactions').select('amount, direction').eq('source', source).eq('fee_id', feeId),
  ])
  if (!fee) return null
  const paid = (txns ?? []).reduce(
    (s, t) => s + (t.direction === 'credit' ? Number(t.amount) : -Number(t.amount)),
    0,
  )
  return Math.max(0, Math.round(((Number(fee.amount) || 0) - paid) * 100) / 100)
}
