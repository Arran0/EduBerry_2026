import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import Razorpay from 'razorpay'
import { getPaymentSecrets } from '@/lib/serverSecrets'
import { requirePayerFor } from '@/lib/fees/serverGuard'
import { outstandingFor, type FeeSource } from '@/lib/fees/ledger'

// One parent-facing payment-initiation route, for school and bus fees alike.
// Replaces /api/fees/razorpay/create-order, /api/bus/razorpay/create-order and
// the two /upi/create-collect routes.
//
// ── Why one route, and why UPI Intent/QR ─────────────────────────────────────
// The module previously offered two parallel ways to pay: a Razorpay order, and
// a "UPI" tab that rendered a static intent link to the school's own VPA with
// the office confirming receipt by hand. The second had no gateway-side record
// of the attempt, no automatic confirmation without a bank connection, and used
// a P2P handle for merchant collection.
//
// Both now go through Razorpay:
//   • `order_id` drives Razorpay Checkout, which offers UPI Intent natively on
//     mobile (the parent is handed to GPay / PhonePe / Paytm and back).
//   • `qr` is a Razorpay dynamic UPI QR for the exact outstanding amount,
//     scannable from a second device. It confirms through the
//     `qr_code.credited` webhook, so nobody self-declares a payment.
//
// Both are recorded by the webhook against an immutable ledger row. The client
// is never trusted to report success — a checkout `handler` callback says only
// that the parent's browser thinks it worked.
//
// Charges the OUTSTANDING balance, computed from the ledger, so a parent is
// never asked twice for money they have already sent.
//
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.
// Razorpay credentials come from payment_secrets (env fallback).

export const runtime = 'nodejs'

/** Razorpay requires a QR's close_by to be at least 15 minutes out; give an hour. */
const QR_VALIDITY_SECONDS = 60 * 60

interface IntentBody {
  fee_id?: string
  source?: FeeSource
  /** Ask for a scannable QR as well as the checkout order. */
  want_qr?: boolean
  /** Pay less than the outstanding balance, where the structure allows it. */
  amount?: number
}

export async function POST(request: NextRequest) {
  let body: IntentBody
  try { body = await request.json() } catch { return bad('Invalid request body') }

  const source: FeeSource = body.source === 'bus' ? 'bus' : 'school'
  const feeId = body.fee_id
  if (!feeId) return bad('fee_id is required')

  const guard = await requirePayerFor(request, source, feeId)
  if (!guard.ok) return guard.response
  const { actor: { db, userId }, fee } = guard

  if (fee.status === 'paid' || fee.status === 'cancelled') {
    return NextResponse.json({ success: false, error: `This fee is already ${fee.status}.` }, { status: 409 })
  }

  const balance = await outstandingFor(db, source, feeId)
  if (!balance || balance.outstanding <= 0) {
    return NextResponse.json({ success: false, error: 'This fee is already fully paid.' }, { status: 409 })
  }

  // A partial payment is allowed only where the governing structure permits it,
  // and never more than what is owed.
  const requested = body.amount === undefined ? balance.outstanding : Number(body.amount)
  if (!Number.isFinite(requested) || requested <= 0) return bad('A payment must be a positive amount.')
  if (requested > balance.outstanding) {
    return bad(`That is more than the ₹${balance.outstanding.toLocaleString('en-IN')} still outstanding.`)
  }
  if (requested < balance.outstanding && !(await partialAllowed(db, source, feeId))) {
    return bad('This fee must be paid in full.')
  }

  const keyId = await resolveKeyId(db)
  const keySecret = (await getPaymentSecrets(db, 'razorpay')).key_secret
  if (!keyId || !keySecret) {
    return NextResponse.json({ success: false, error: 'Online payment is not set up yet. Please contact the school office.' }, { status: 503 })
  }

  const amountPaise = Math.round(requested * 100)
  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret })

  let orderId: string
  try {
    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `${source}fee_${fee.id}`.slice(0, 40),
      notes: { fee_id: fee.id, source, student_id: fee.student_id, payer_id: userId },
    })
    orderId = order.id
  } catch (e) {
    console.error('pay/intent: order creation failed', e)
    return NextResponse.json({ success: false, error: 'Could not start the payment. Please try again.' }, { status: 502 })
  }

  // The attempt row the webhook reconciles against. Its unique order-id index
  // is what makes the webhook's lookup unambiguous.
  const attemptTable = source === 'school' ? 'school_fee_payments' : 'bus_payments'
  const { error: attemptErr } = await db.from(attemptTable).insert({
    fee_id: fee.id,
    payer_id: userId,
    method: 'razorpay',
    amount: requested,
    status: 'pending',
    razorpay_order_id: orderId,
    idempotency_key: `order:${orderId}`,
  })
  if (attemptErr) {
    console.error('pay/intent: attempt insert failed', attemptErr)
    return NextResponse.json({ success: false, error: 'Could not record the payment attempt.' }, { status: 500 })
  }

  // A QR is best-effort: a school whose Razorpay account has QR codes disabled
  // still gets a working checkout, and the parent is simply not offered a QR.
  let qr: { id: string; image_url: string } | null = null
  if (body.want_qr !== false) {
    qr = await createQr(razorpay, {
      feeId: fee.id, source, studentId: fee.student_id, payerId: userId,
      amountPaise, reference: fee.upi_reference,
    })
  }

  return NextResponse.json({
    success: true,
    order_id: orderId,
    key_id: keyId,
    amount: amountPaise,
    amount_rupees: requested,
    currency: 'INR',
    outstanding: balance.outstanding,
    billed: balance.billed,
    paid: balance.paid,
    qr_id: qr?.id ?? null,
    qr_image_url: qr?.image_url ?? null,
    reference: fee.upi_reference,
  })
}

async function createQr(
  razorpay: Razorpay,
  args: { feeId: string; source: FeeSource; studentId: string; payerId: string; amountPaise: number; reference: string },
): Promise<{ id: string; image_url: string } | null> {
  try {
    const qr = await razorpay.qrCode.create({
      type: 'upi_qr',
      name: 'School fees',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: args.amountPaise,
      description: args.reference,
      close_by: Math.floor(Date.now() / 1000) + QR_VALIDITY_SECONDS,
      // These notes are what handleQrCredited matches on — a QR payment has no
      // order id, so the fee has to travel with the QR itself.
      notes: {
        fee_id: args.feeId,
        source: args.source,
        student_id: args.studentId,
        payer_id: args.payerId,
      },
    })
    return { id: qr.id as string, image_url: qr.image_url as string }
  } catch (e) {
    console.error('pay/intent: QR creation failed (checkout still available)', e)
    return null
  }
}

/**
 * Whether the fee's governing structure allows paying less than the balance.
 * A hand-issued fee with no structure allows it — that matches how the office
 * already records part payments at the counter.
 */
async function partialAllowed(
  db: SupabaseClient,
  source: FeeSource,
  feeId: string,
): Promise<boolean> {
  if (source !== 'school') return true
  const { data } = await db
    .from('school_fees')
    .select('structure:fee_structures!structure_id(allow_partial)')
    .eq('id', feeId)
    .maybeSingle()
  const structure = (data as { structure?: { allow_partial?: boolean } | { allow_partial?: boolean }[] } | null)?.structure
  const resolved = Array.isArray(structure) ? structure[0] : structure
  return resolved?.allow_partial ?? true
}

async function resolveKeyId(db: SupabaseClient): Promise<string | undefined> {
  // The key id is public, so env is the cheap path; the stored config is the
  // per-tenant one.
  if (process.env.RAZORPAY_KEY_ID) return process.env.RAZORPAY_KEY_ID
  const { data } = await db.from('site_settings').select('value').eq('key', 'razorpay_config').maybeSingle()
  return (data?.value as { key_id?: string } | null)?.key_id
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
