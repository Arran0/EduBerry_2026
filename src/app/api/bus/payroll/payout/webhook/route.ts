import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { getPaymentSecrets } from '@/lib/serverSecrets'

// Payout provider webhook for DRIVER payroll. Reconciles a driver_payroll_records
// row by the `reference` we sent the provider (the record id), flipping
// payout_status and — on a processed transfer — the record status to 'paid'.
// Uses the service role (no user session on a webhook call). Mirrors
// /api/salary/payout/webhook.
//
// The webhook secret is read from the admin-configured payment_secrets store
// (per-tenant, shared with staff salary payouts), falling back to the
// PAYOUT_WEBHOOK_SECRET env var.
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.

export const runtime = 'nodejs'

/** Map a raw provider event to { reference, outcome }. Adjust per provider. */
function mapEvent(raw: {
  event?: string
  payload?: { payout?: { entity?: { reference_id?: string; status?: string; id?: string } } }
}): { reference?: string; outcome: 'processed' | 'failed' | 'ignore'; payoutId?: string } {
  const entity = raw.payload?.payout?.entity
  const reference = entity?.reference_id
  const payoutId = entity?.id
  const status = (entity?.status ?? '').toLowerCase()
  if (status === 'processed') return { reference, outcome: 'processed', payoutId }
  if (status === 'failed' || status === 'reversed' || status === 'rejected') {
    return { reference, outcome: 'failed', payoutId }
  }
  return { reference, outcome: 'ignore', payoutId }
}

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ ok: false, error: 'Webhook not configured' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const webhookSecret = (await getPaymentSecrets(admin, 'payout')).webhook_secret
  if (!webhookSecret) {
    return NextResponse.json({ ok: false, error: 'Webhook not configured' }, { status: 500 })
  }

  // Verify signature against the RAW body before parsing.
  const rawBody = await request.text()
  const signature =
    request.headers.get('x-razorpay-signature') ??
    request.headers.get('x-webhook-signature') ??
    ''
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex')
  const valid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  if (!valid) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 400 })
  }

  let event: Parameters<typeof mapEvent>[0]
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { reference, outcome, payoutId } = mapEvent(event)
  if (!reference || outcome === 'ignore') {
    return NextResponse.json({ ok: true, ignored: true })
  }

  const { data: record } = await admin
    .from('driver_payroll_records')
    .select('id, status')
    .eq('id', reference)
    .maybeSingle()
  if (!record) {
    // 200 so the provider doesn't retry forever for a reference we don't track.
    return NextResponse.json({ ok: true, ignored: 'unknown reference' })
  }

  if (outcome === 'processed') {
    await admin.from('driver_payroll_records').update({
      payout_status: 'processed',
      status: 'paid',
      payout_reference: payoutId ?? record.id,
    }).eq('id', record.id)
  } else {
    await admin.from('driver_payroll_records').update({ payout_status: 'failed' }).eq('id', record.id)
  }

  return NextResponse.json({ ok: true })
}
