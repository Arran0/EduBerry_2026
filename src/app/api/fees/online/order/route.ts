import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import Razorpay from 'razorpay'
import { adminClient, callerUserId } from '@/lib/serverAuth'
import { razorpayKeys } from '@/lib/fees/razorpayKeys'

export const runtime = 'nodejs'

/**
 * Start an online payment for some of the caller's own bills.
 *
 * The browser names the bills; the amount is never taken from it. Each bill's
 * balance is read here, from the table, and the order is for exactly their sum.
 * The choice is kept on a fee_online_orders row so the receipt, made once the
 * money has arrived, goes against the bills the student picked.
 */
export async function POST(request: NextRequest) {
  const db = adminClient()
  if (!db) return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })

  const userId = await callerUserId(db, request)
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  let body: { invoice_ids?: unknown }
  try { body = await request.json() } catch { body = {} }
  const ids = Array.isArray(body.invoice_ids)
    ? [...new Set(body.invoice_ids.filter((x): x is string => typeof x === 'string'))].slice(0, 50)
    : []
  if (!ids.length) {
    return NextResponse.json({ success: false, error: 'Pick at least one bill to pay.' }, { status: 400 })
  }

  const { data: bills, error: billErr } = await db.from('fee_invoices')
    .select('id, student_id, academic_year_id, number, status, balance')
    .in('id', ids)
  if (billErr) return NextResponse.json({ success: false, error: 'Could not read those bills.' }, { status: 500 })

  const mine = (bills ?? []).filter(b => b.student_id === userId)
  if (mine.length !== ids.length) {
    return NextResponse.json({ success: false, error: 'One of those bills is not yours.' }, { status: 403 })
  }
  const payable = mine.filter(b => ['pending', 'partly_paid', 'overdue'].includes(b.status) && Number(b.balance) > 0)
  if (!payable.length) {
    return NextResponse.json({ success: false, error: 'Nothing is owed on those bills any more.' }, { status: 409 })
  }
  const years = new Set(payable.map(b => b.academic_year_id))
  if (years.size > 1) {
    return NextResponse.json({ success: false, error: 'Pay one session’s bills at a time.' }, { status: 400 })
  }

  const allocations = payable.map(b => ({ invoice_id: b.id, amount: Math.round(Number(b.balance) * 100) / 100 }))
  const amount = Math.round(allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100

  const keys = await razorpayKeys(db)
  if (!keys.enabled || !keys.keyId || !keys.keySecret) {
    return NextResponse.json({ success: false, error: 'Online payment is not switched on yet. The school office can take this at the counter.' }, { status: 503 })
  }

  const [{ data: profile }, { data: details }] = await Promise.all([
    db.from('profiles').select('full_name, email').eq('id', userId).maybeSingle(),
    db.from('student_details').select('guardian_phone').eq('student_id', userId).maybeSingle(),
  ])

  try {
    const razorpay = new Razorpay({ key_id: keys.keyId, key_secret: keys.keySecret })
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: `fee_${Date.now().toString(36)}`,
      notes: { kind: 'school_fee', student_id: userId, bills: payable.map(b => b.number).join(', ').slice(0, 250) },
    })

    const { error: insErr } = await db.from('fee_online_orders').insert({
      student_id: userId,
      academic_year_id: payable[0].academic_year_id,
      order_id: order.id,
      amount,
      allocations,
    })
    if (insErr) {
      console.error('fees online order: insert failed', insErr)
      return NextResponse.json({ success: false, error: 'Could not start the payment. Try again.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      order_id: order.id,
      key_id: keys.keyId,
      amount: Math.round(amount * 100),
      currency: 'INR',
      bills: payable.map(b => b.number),
      prefill: {
        name: (profile?.full_name as string | undefined) ?? undefined,
        email: (profile?.email as string | undefined) ?? undefined,
        contact: (details?.guardian_phone as string | undefined) ?? undefined,
      },
    })
  } catch (e) {
    console.error('fees online order: razorpay error', e)
    return NextResponse.json({ success: false, error: 'The payment gateway did not answer. Try again in a minute.' }, { status: 502 })
  }
}
