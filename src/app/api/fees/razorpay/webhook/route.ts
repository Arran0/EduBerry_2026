import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { getPaymentSecrets } from '@/lib/serverSecrets'
import { settleSchoolFee } from '@/lib/fees/settleWebhook'
import { failOnlineOrder, findOnlineOrder, settleOnlineOrder } from '@/lib/fees/onlineSettle'

// Razorpay webhook for SCHOOL fees. Verifies the signature against the RAW
// request body, then on a captured payment marks the matching
// school_fee_payments row 'verified' and re-settles the fee from the money
// actually received — 'paid' only once the verified payments cover it. Uses
// the service role (no user session on a webhook call).
//
// The webhook secret is read from the admin-configured payment_secrets store
// (per-tenant, shared with the Bus module), falling back to the
// RAZORPAY_WEBHOOK_SECRET env var.
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.
//
// Point a Razorpay "payment.captured" webhook at POST /api/fees/razorpay/webhook
// (you can register both this and /api/bus/razorpay/webhook — each only matches
// orders in its own table, ignoring the rest).

// Ensure Node runtime (crypto + raw body), never edge.
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

  const webhookSecret = (await getPaymentSecrets(admin, 'razorpay')).webhook_secret
  if (!webhookSecret) {
    return NextResponse.json({ ok: false, error: 'Webhook not configured' }, { status: 500 })
  }

  // Read the raw body BEFORE parsing — signature is computed over these bytes.
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature') ?? ''

  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex')
  const valid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  if (!valid) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 400 })
  }

  let event: {
    event?: string
    payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number } } }
  }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const entity = event.payload?.payment?.entity
  const orderId = entity?.order_id
  const paymentId = entity?.id

  // A payment started from the student fee page (fee_online_orders) — the
  // fee app's bills, settled into a numbered receipt by fee_collect.
  if (orderId && (event.event === 'payment.captured' || event.event === 'payment.failed')) {
    const online = await findOnlineOrder(admin, orderId)
    if (online) {
      if (event.event === 'payment.failed') {
        await failOnlineOrder(admin, orderId, 'The payment did not go through')
        return NextResponse.json({ ok: true, status: 'failed' })
      }
      const result = await settleOnlineOrder(admin, orderId, paymentId ?? '', (entity?.amount ?? 0) / 100)
      return NextResponse.json({ ok: true, status: result.status })
    }
  }

  // Only act on a captured payment.
  if (event.event !== 'payment.captured') {
    return NextResponse.json({ ok: true, ignored: event.event })
  }

  if (!orderId) {
    return NextResponse.json({ ok: true, ignored: 'no order_id' })
  }

  const { data: payment, error: payErr } = await admin
    .from('school_fee_payments')
    .select('id, fee_id, status')
    .eq('razorpay_order_id', orderId)
    .maybeSingle()
  if (payErr || !payment) {
    // 200 so Razorpay doesn't retry forever for an order we don't track
    // (e.g. it belongs to the Bus module's table instead).
    return NextResponse.json({ ok: true, ignored: 'unknown order' })
  }
  if (payment.status === 'verified') {
    return NextResponse.json({ ok: true, already: true })
  }

  // Razorpay reports the captured amount in paise. The order was created
  // server-side for the outstanding balance, so this normally equals what was
  // asked for — recording it anyway means a partial capture cannot settle a
  // fee it did not cover.
  const captured = typeof entity?.amount === 'number' ? entity.amount / 100 : null

  await admin
    .from('school_fee_payments')
    .update({
      status: 'verified',
      razorpay_payment_id: paymentId,
      verified_at: new Date().toISOString(),
      ...(captured === null ? {} : { amount: captured }),
    })
    .eq('id', payment.id)

  // 'paid' only once the verified payments cover the fee. See settleWebhook.ts.
  const status = await settleSchoolFee(admin, payment.fee_id)

  return NextResponse.json({ ok: true, status })
}
