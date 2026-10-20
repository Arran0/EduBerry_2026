import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyPayoutCallback } from '@/lib/payoutWebhook'

// Bank payout callback for STAFF salary. Reconciles a salary_records row by the
// `reference` we sent the bank (the record id), flipping payout_status and — on
// a settled transfer — the record status to 'paid'. Uses the service role (no
// user session on a callback).
//
// Signature scheme, digest encoding and the payload's field names all come from
// the saved bank connection, so onboarding a different bank is a Settings
// change. See src/lib/payoutWebhook.ts.
//
// The webhook secret is read from the admin-configured payment_secrets store
// (per-tenant), falling back to the PAYOUT_WEBHOOK_SECRET env var.
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

  const { data: record } = await admin
    .from('salary_records')
    .select('id, status')
    .eq('id', reference)
    .maybeSingle()
  if (!record) {
    // 200 so the bank doesn't retry forever for a reference we don't track —
    // driver payroll callbacks land here too and are correctly ignored.
    return NextResponse.json({ ok: true, ignored: 'unknown reference' })
  }

  if (outcome === 'processed') {
    await admin.from('salary_records').update({
      payout_status: 'processed',
      status: 'paid',
      payout_reference: payoutId ?? record.id,
    }).eq('id', record.id)
  } else {
    // A late or replayed failure never undoes a transfer the bank already
    // settled: only a record not yet paid can be marked failed.
    await admin.from('salary_records').update({ payout_status: 'failed' }).eq('id', record.id)
      .neq('status', 'paid')
  }

  return NextResponse.json({ ok: true })
}
