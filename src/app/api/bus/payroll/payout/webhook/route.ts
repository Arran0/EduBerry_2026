import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyPayoutCallback } from '@/lib/payoutWebhook'
import { applyPayoutCallback } from '@/lib/payoutClaim'

// Bank payout callback for DRIVER payroll. Reconciles a driver_payroll_records
// row by the `reference` we sent the bank (the record id), flipping
// payout_status and — on a settled transfer — the record status to 'paid'.
// Uses the service role (no user session on a callback).
//
// Mirrors /api/salary/payout/webhook: both share one bank connection and one
// webhook secret, because both credit staff from the same corporate account.
// Signature scheme and payload field names come from the saved bank connection.
//
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ ok: false, error: 'Webhook not configured' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const verified = await verifyPayoutCallback(admin, request)
  if (!verified.ok || !verified.event) {
    return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status ?? 400 })
  }

  const { reference, outcome, payoutId } = verified.event
  if (!reference || outcome === 'ignore') {
    return NextResponse.json({ ok: true, ignored: true })
  }

  const result = await applyPayoutCallback(admin, 'driver_payroll_records', { reference, outcome, payoutId })
  if (result === 'unknown') {
    // 200 so the bank doesn't retry forever for a reference we don't track —
    // staff salary callbacks land here too and are correctly ignored.
    return NextResponse.json({ ok: true, ignored: 'unknown reference' })
  }
  if (result === 'stale') {
    // A failure for an attempt that is no longer in flight (replayed or late).
    return NextResponse.json({ ok: true, ignored: 'stale failure' })
  }

  return NextResponse.json({ ok: true })
}
