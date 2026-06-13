import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import Razorpay from 'razorpay'

// Creates a Razorpay order for a school fee. The caller must be the fee's
// student. A pending school_fee_payments row is recorded; the webhook flips it
// to 'verified' (and the fee to 'paid') once Razorpay confirms capture.
//
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL,
//               RAZORPAY_KEY_ID (or stored in site_settings.razorpay_config),
//               RAZORPAY_KEY_SECRET. Shared with the Bus module.

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const keySecret = process.env.RAZORPAY_KEY_SECRET

  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate the caller.
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.slice(7))
  if (authErr || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { fee_id } = await request.json()
  if (!fee_id) {
    return NextResponse.json({ success: false, error: 'fee_id is required' }, { status: 400 })
  }

  // Load the fee and verify ownership + payability.
  const { data: fee, error: feeErr } = await admin
    .from('school_fees')
    .select('id, student_id, amount, status, description')
    .eq('id', fee_id)
    .single()
  if (feeErr || !fee) {
    return NextResponse.json({ success: false, error: 'Fee not found' }, { status: 404 })
  }
  if (fee.student_id !== user.id) {
    return NextResponse.json({ success: false, error: 'This fee is not yours' }, { status: 403 })
  }
  if (fee.status === 'paid' || fee.status === 'cancelled') {
    return NextResponse.json({ success: false, error: `Fee is already ${fee.status}` }, { status: 409 })
  }

  // Resolve the key_id: prefer env, fall back to the stored public config.
  let keyId = process.env.RAZORPAY_KEY_ID
  if (!keyId) {
    const { data: cfg } = await admin.from('site_settings').select('value').eq('key', 'razorpay_config').maybeSingle()
    keyId = (cfg?.value as { key_id?: string } | null)?.key_id
  }
  if (!keyId || !keySecret) {
    return NextResponse.json({ success: false, error: 'Razorpay is not configured' }, { status: 503 })
  }

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret })
    const amountPaise = Math.round(Number(fee.amount) * 100)
    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `schoolfee_${fee.id}`,
      notes: { fee_id: fee.id, student_id: user.id },
    })

    // Record a pending payment keyed by the order id (webhook reconciles on this).
    const { error: payErr } = await admin.from('school_fee_payments').insert({
      fee_id: fee.id,
      payer_id: user.id,
      method: 'razorpay',
      amount: fee.amount,
      status: 'pending',
      razorpay_order_id: order.id,
    })
    if (payErr) {
      console.error('fees create-order: payment insert failed', payErr)
      return NextResponse.json({ success: false, error: 'Could not record payment' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      order_id: order.id,
      key_id: keyId,
      amount: amountPaise,
      currency: 'INR',
    })
  } catch (e) {
    console.error('fees create-order: razorpay error', e)
    return NextResponse.json({ success: false, error: 'Failed to create payment order' }, { status: 502 })
  }
}
