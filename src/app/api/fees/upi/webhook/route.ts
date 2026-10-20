import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyCollectCallback } from '@/lib/collectSetup'
import { settleSchoolFee } from '@/lib/fees/settleWebhook'

// Incoming-UPI webhook from your bank / PSP (Smart Collect) for SCHOOL fees. On
// a successful payment it matches the settlement to a fee — by the per-fee
// virtual VPA (vpa mode) or by the unique SCHFEE- reference carried in the UPI
// note (reference mode) — and marks the payment verified + the fee paid. No
// student self-declaration is involved: confirmation comes from the money
// arriving — and from how much of it did: a push payment's amount is the
// payer's choice, so the fee is re-settled from the verified total rather than
// marked paid on arrival.
//
// Point your provider's payment-received webhook at POST /api/fees/upi/webhook
// and set SMART_COLLECT_WEBHOOK_SECRET to the same HMAC secret (shared with the
// Bus module). A school fee carries a SCHFEE- reference, so this route only
// matches its own fees and ignores bus settlements.
//
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL,
//               SMART_COLLECT_WEBHOOK_SECRET.

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

  // Signature header, digest encoding and any prefix all come from the saved
  // bank connection, so a different bank is a Settings change, not a deploy.
  const verified = await verifyCollectCallback(admin, request)
  if (!verified.ok || !verified.event) {
    return NextResponse.json({ ok: false, error: verified.error ?? 'Verification failed' }, { status: verified.status ?? 400 })
  }

  const ev = verified.event
  if (ev.status === 'failed') {
    return NextResponse.json({ ok: true, ignored: 'failed payment' })
  }
  if (!ev.reference && !ev.vpa) {
    return NextResponse.json({ ok: true, ignored: 'no reference or vpa' })
  }

  // Idempotency: a settlement (UTR) we've already credited is a no-op.
  if (ev.utr) {
    const { data: existing } = await admin.from('school_fee_payments').select('id').eq('utr', ev.utr).maybeSingle()
    if (existing) return NextResponse.json({ ok: true, already: true })
  }

  // 1) Prefer matching a pre-created pending payment (virtual_vpa mode, or a
  //    reference-mode row we created up front).
  let payment = await findPendingPayment(admin, ev.vpa, ev.reference)

  // 2) Reference mode with no pre-created row: resolve the fee by its reference.
  let feeId = payment?.fee_id ?? null
  if (!feeId && ev.reference) {
    const { data: fee } = await admin
      .from('school_fees')
      .select('id, amount, student_id')
      .eq('upi_reference', ev.reference)
      .maybeSingle()
    feeId = fee?.id ?? null
    // A row created here has no pending payment behind it, so the UTR is the
    // only thing that stops a replayed callback crediting the same money again,
    // and the amount is the only record of how much arrived. Without both,
    // leave it for the counter to reconcile rather than guess.
    if (fee && !payment && ev.utr && typeof ev.amount === 'number' && ev.amount > 0) {
      const { data: inserted } = await admin
        .from('school_fee_payments')
        .insert({
          fee_id: fee.id,
          payer_id: fee.student_id,
          method: 'upi_qr',
          provider: 'smart_collect',
          provider_ref: ev.reference,
          amount: ev.amount,
          status: 'pending',
        })
        .select('id, fee_id')
        .single()
      payment = inserted ?? null
    }
  }

  if (!feeId || !payment) {
    // 200 so the provider doesn't retry forever for something we don't track
    // (e.g. a bus settlement, matched by the bus webhook instead).
    return NextResponse.json({ ok: true, ignored: 'no matching fee' })
  }

  // Credit what actually arrived, not what was expected. A UPI push payment's
  // amount is chosen by the payer, so a short payment must land on the row as
  // the short amount — otherwise the fee below settles against a figure nobody
  // paid.
  await admin
    .from('school_fee_payments')
    .update({
      status: 'verified',
      utr: ev.utr,
      collect_vpa: ev.vpa,
      verified_at: new Date().toISOString(),
      ...(ev.amount === null || ev.amount === undefined ? {} : { amount: ev.amount }),
    })
    .eq('id', payment.id)

  // 'paid' only once the verified payments cover the fee; a short payment
  // leaves it 'partial' and still owing. See settleWebhook.ts.
  const status = await settleSchoolFee(admin, feeId)

  return NextResponse.json({ ok: true, status })
}

async function findPendingPayment(
  admin: SupabaseClient,
  vpa: string | null,
  reference: string | null,
): Promise<{ id: string; fee_id: string } | null> {
  if (vpa) {
    const { data } = await admin
      .from('school_fee_payments')
      .select('id, fee_id')
      .eq('collect_vpa', vpa)
      .eq('status', 'pending')
      .maybeSingle()
    if (data) return data
  }
  if (reference) {
    const { data } = await admin
      .from('school_fee_payments')
      .select('id, fee_id')
      .eq('provider_ref', reference)
      .eq('status', 'pending')
      .maybeSingle()
    if (data) return data
  }
  return null
}
