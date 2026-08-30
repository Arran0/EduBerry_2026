import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { serviceClient } from '@/lib/fees/serverGuard'
import { dispatchRazorpayEvent, markProcessed, verifyAndRecordRazorpay } from '@/lib/fees/webhook'

// Razorpay webhook for SCHOOL fees.
//
// The logic lives in src/lib/fees/webhook.ts, shared with the bus route. This
// file is only the wiring: which module's fees to match against, and what to
// answer.
//
// Register this for: payment.captured, payment.failed, qr_code.credited,
// refund.processed, refund.failed. You can register both this and
// /api/bus/razorpay/webhook — each ignores the other's orders with a 200.
//
// The webhook secret comes from the admin-configured payment_secrets store
// (per-tenant, shared with the Bus module), falling back to
// RAZORPAY_WEBHOOK_SECRET. Required env: SUPABASE_SERVICE_ROLE_KEY,
// NEXT_PUBLIC_SUPABASE_URL.

// Node runtime: crypto and a raw body, never edge.
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const svc = serviceClient()
  if (!svc.ok) return svc.response
  const { db } = svc

  const verified = await verifyAndRecordRazorpay(db, request)

  // Already seen. The provider is retrying; nothing further is owed.
  if (verified.duplicate) {
    return NextResponse.json({ ok: true, already: true })
  }
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status })
  }

  const result = await dispatchRazorpayEvent(db, 'school', verified)
  await markProcessed(db, verified.eventRowId, result.detail)

  // 200 even when unhandled: an order belonging to the bus module, or an event
  // type we do not act on, must not make Razorpay retry forever.
  return NextResponse.json({ ok: true, ...result.detail })
}
