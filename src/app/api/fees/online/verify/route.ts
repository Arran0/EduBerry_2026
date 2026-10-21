import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import Razorpay from 'razorpay'
import { adminClient, callerUserId } from '@/lib/serverAuth'
import { razorpayKeys } from '@/lib/fees/razorpayKeys'
import { findOnlineOrder, settleOnlineOrder } from '@/lib/fees/onlineSettle'

export const runtime = 'nodejs'

/**
 * The browser's half of settling an online payment.
 *
 * Checkout hands back a payment id with a signature over `order|payment`. The
 * signature proves the payment belongs to this order; the gateway is then
 * asked what was actually captured, and the receipt is for that. The webhook
 * does the same independently, and whichever is first makes the receipt.
 *
 * With no body beyond `order_id` it only reports the order's state, which is
 * what the page polls while the bank confirms.
 */
export async function POST(request: NextRequest) {
  const db = adminClient()
  if (!db) return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })

  const userId = await callerUserId(db, request)
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  let body: { order_id?: string; payment_id?: string; signature?: string }
  try { body = await request.json() } catch { body = {} }
  const orderId = typeof body.order_id === 'string' ? body.order_id : ''
  if (!orderId) return NextResponse.json({ success: false, error: 'order_id is required' }, { status: 400 })

  const order = await findOnlineOrder(db, orderId)
  if (!order || order.student_id !== userId) {
    return NextResponse.json({ success: false, error: 'That payment was not found.' }, { status: 404 })
  }
  if (order.status === 'paid') {
    return NextResponse.json({ success: true, status: 'paid', payment_id: order.payment_id, receipt_no: order.receipt_no })
  }
  if (!body.payment_id || !body.signature) {
    return NextResponse.json({ success: true, status: order.status })
  }

  const keys = await razorpayKeys(db)
  if (!keys.keyId || !keys.keySecret) {
    return NextResponse.json({ success: false, error: 'Razorpay is not configured' }, { status: 503 })
  }

  const expected = crypto.createHmac('sha256', keys.keySecret).update(`${orderId}|${body.payment_id}`).digest('hex')
  const valid = body.signature.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(body.signature), Buffer.from(expected))
  if (!valid) {
    return NextResponse.json({ success: false, error: 'The payment could not be verified.' }, { status: 400 })
  }

  try {
    const razorpay = new Razorpay({ key_id: keys.keyId, key_secret: keys.keySecret })
    let payment = await razorpay.payments.fetch(body.payment_id)
    if (payment.order_id !== orderId) {
      return NextResponse.json({ success: false, error: 'The payment could not be verified.' }, { status: 400 })
    }
    // An account without auto-capture leaves the payment authorised. The
    // order's amount was fixed here, so capturing it is safe.
    if (payment.status === 'authorized') {
      payment = await razorpay.payments.capture(body.payment_id, payment.amount, 'INR')
    }
    if (payment.status !== 'captured') {
      return NextResponse.json({ success: true, status: 'processing' })
    }
    const result = await settleOnlineOrder(db, orderId, body.payment_id, Number(payment.amount) / 100)
    return NextResponse.json({ success: result.ok, ...result })
  } catch (e) {
    console.error('fees online verify: razorpay error', e)
    // The webhook will still settle it; the page keeps asking.
    return NextResponse.json({ success: true, status: 'processing' })
  }
}
