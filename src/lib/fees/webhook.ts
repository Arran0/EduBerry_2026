import 'server-only'
import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { getPaymentSecrets } from '@/lib/serverSecrets'
import { appendLedgerEntry, type FeeSource } from './ledger'

// ============================================================================
// The webhook edge.
// ----------------------------------------------------------------------------
// Shared by the school and bus Razorpay webhooks, which previously each had
// their own copy of the same logic and the same two defects.
//
// The order of operations is the substance of this file:
//
//   1. Verify the HMAC over the RAW body. Never over a re-serialised object —
//      JSON.parse followed by JSON.stringify does not round-trip byte for byte,
//      and a signature checked against different bytes than the ones sent is
//      not a check.
//   2. Record the event, verified or not, keyed on the provider's event id.
//      A forged or misconfigured caller is worth a forensic record.
//   3. If that insert conflicts, this is a duplicate DELIVERY. Answer 200 and
//      stop. This replaces `if (payment.status === 'verified')`, which two
//      concurrent deliveries both passed because both read the row while it was
//      still pending.
//   4. Do the work, keyed again on fee_transactions.idempotency_key so a
//      duplicate CREDIT is impossible even if step 3 is somehow bypassed —
//      a replay from the dashboard, a second route, a manual retry.
//   5. Recompute the fee's status from the ledger. Never set 'paid'
//      unconditionally: create-order charges only the outstanding balance, so a
//      parent clearing ₹2,000 of a ₹10,000 fee must land on 'partial'.
//
// Every handler answers 200 for anything it does not recognise. A 4xx makes
// Razorpay retry forever for an order that belongs to another table.
// ============================================================================

export interface RazorpayEntity {
  id?: string
  order_id?: string
  amount?: number
  status?: string
  method?: string
  error_description?: string
  acquirer_data?: { rrn?: string; upi_transaction_id?: string }
  payment_id?: string
  notes?: Record<string, string>
}

export interface RazorpayEvent {
  event?: string
  payload?: {
    payment?: { entity?: RazorpayEntity }
    refund?: { entity?: RazorpayEntity }
    order?: { entity?: RazorpayEntity }
    qr_code?: { entity?: RazorpayEntity }
  }
}

export interface VerifiedWebhook {
  ok: boolean
  status: number
  /** True when this exact event has already been processed. */
  duplicate?: boolean
  eventRowId?: string
  eventId?: string
  event?: RazorpayEvent
  error?: string
}

/** Constant-time compare that does not leak length through an exception. */
function signatureMatches(signature: string, expected: string): boolean {
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * A stable id for a provider that did not send one. Derived from the payload's
 * own identifying fields, never from a clock or a random value — a random id
 * would make every retry look like a new event, which is the exact bug this
 * whole mechanism exists to prevent.
 */
export function deriveEventId(eventType: string, entity: RazorpayEntity | undefined, rawBody: string): string {
  if (entity?.id) return `${eventType}:${entity.id}`
  return `${eventType}:sha256:${crypto.createHash('sha256').update(rawBody).digest('hex').slice(0, 32)}`
}

/**
 * Verify, then durably record. Returns `duplicate` when this event id has been
 * seen before, which is the caller's signal to answer 200 and do nothing.
 */
export async function verifyAndRecordRazorpay(
  db: SupabaseClient,
  request: NextRequest,
): Promise<VerifiedWebhook> {
  const secret = (await getPaymentSecrets(db, 'razorpay')).webhook_secret
  if (!secret) return { ok: false, status: 500, error: 'Webhook not configured' }

  // Raw bytes, read before anything parses them.
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature') ?? ''
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const verified = signatureMatches(signature, expected)

  let event: RazorpayEvent = {}
  let parsed = true
  try { event = JSON.parse(rawBody) } catch { parsed = false }

  const eventType = event.event ?? 'unparsed'
  const headerId = request.headers.get('x-razorpay-event-id')
  const entity =
    event.payload?.payment?.entity ??
    event.payload?.refund?.entity ??
    event.payload?.qr_code?.entity ??
    event.payload?.order?.entity
  const eventId = headerId || deriveEventId(eventType, entity, rawBody)

  const { data: row, error } = await db
    .from('fee_webhook_events')
    .insert({
      provider: 'razorpay',
      event_id: eventId,
      event_type: eventType,
      signature_verified: verified,
      payload: parsed ? (event as unknown as Record<string, unknown>) : { raw: rawBody.slice(0, 20000) },
    })
    .select('id')
    .single()

  if (error) {
    // 23505 — we have seen this event id before. That is the whole point.
    if (error.code === '23505') {
      return { ok: true, status: 200, duplicate: true, eventId, event }
    }
    console.error('fee webhook: could not record event', error)
    // Fail closed. Without a durable record there is no idempotency guarantee,
    // and processing anyway is how a retry double-credits. A 500 makes the
    // provider retry, which is the correct outcome.
    return { ok: false, status: 500, error: 'Could not record event' }
  }

  if (!verified) {
    await markProcessed(db, row.id, { ignored: 'invalid signature' })
    return { ok: false, status: 400, eventRowId: row.id, eventId, error: 'Invalid signature' }
  }
  if (!parsed) {
    await markProcessed(db, row.id, { ignored: 'unparseable body' })
    return { ok: false, status: 400, eventRowId: row.id, eventId, error: 'Invalid JSON' }
  }

  return { ok: true, status: 200, eventRowId: row.id, eventId, event }
}

export async function markProcessed(
  db: SupabaseClient,
  eventRowId: string | undefined,
  result: Record<string, unknown>,
): Promise<void> {
  if (!eventRowId) return
  await db.from('fee_webhook_events')
    .update({ processed_at: new Date().toISOString(), result })
    .eq('id', eventRowId)
}

// ── Handlers ────────────────────────────────────────────────────────────────

interface AttemptRow {
  id: string
  fee_id: string
  status: string
  amount: number
  payer_id: string | null
}

const ATTEMPT_TABLE: Record<FeeSource, 'school_fee_payments' | 'bus_payments'> = {
  school: 'school_fee_payments',
  bus: 'bus_payments',
}

async function findAttemptByOrder(
  db: SupabaseClient, source: FeeSource, orderId: string,
): Promise<AttemptRow | null> {
  const { data } = await db
    .from(ATTEMPT_TABLE[source])
    .select('id, fee_id, status, amount, payer_id')
    .eq('razorpay_order_id', orderId)
    .maybeSingle()
  return (data as AttemptRow | null) ?? null
}

async function studentOf(db: SupabaseClient, source: FeeSource, feeId: string): Promise<string | null> {
  const table = source === 'school' ? 'school_fees' : 'bus_fees'
  const col = source === 'school' ? 'student_id' : 'passenger_id'
  const { data } = await db.from(table).select(col).eq('id', feeId).maybeSingle()
  return (data as Record<string, string> | null)?.[col] ?? null
}

export interface HandleResult {
  handled: boolean
  detail: Record<string, unknown>
}

/**
 * A captured payment. The amount credited is Razorpay's, converted from paise —
 * never the attempt's expected amount. If the two disagree, the money that
 * actually moved is the truth and the difference is worth recording.
 */
export async function handlePaymentCaptured(
  db: SupabaseClient,
  source: FeeSource,
  event: RazorpayEvent,
  eventId: string,
  eventRowId?: string,
): Promise<HandleResult> {
  const entity = event.payload?.payment?.entity
  const orderId = entity?.order_id
  const paymentId = entity?.id
  if (!orderId) return { handled: false, detail: { ignored: 'no order_id' } }

  const attempt = await findAttemptByOrder(db, source, orderId)
  // Not ours — very likely the other module's order. Not an error.
  if (!attempt) return { handled: false, detail: { ignored: 'unknown order', order_id: orderId } }

  const amount = entity?.amount !== undefined ? entity.amount / 100 : Number(attempt.amount) || 0
  const studentId = await studentOf(db, source, attempt.fee_id)

  const write = await appendLedgerEntry(db, {
    kind: 'payment',
    direction: 'credit',
    amount,
    source,
    feeId: attempt.fee_id,
    studentId,
    payerId: attempt.payer_id,
    method: entity?.method ?? 'razorpay',
    gateway: 'razorpay',
    gatewayOrderId: orderId,
    gatewayPaymentId: paymentId ?? null,
    utr: entity?.acquirer_data?.rrn ?? entity?.acquirer_data?.upi_transaction_id ?? null,
    idempotencyKey: `rzp:${eventId}:${paymentId ?? orderId}`,
    attemptId: attempt.id,
    attemptTable: ATTEMPT_TABLE[source],
    webhookEventId: eventRowId ?? null,
    note: amount !== Number(attempt.amount)
      ? `Captured ₹${amount} against an expected ₹${attempt.amount}.`
      : null,
  })

  if (!write.ok) return { handled: false, detail: { error: write.error } }

  // The attempt is the mutable half and may be updated freely.
  await db.from(ATTEMPT_TABLE[source]).update({
    status: 'verified',
    razorpay_payment_id: paymentId,
    verified_at: new Date().toISOString(),
    ledger_txn_id: write.transactionId ?? null,
  }).eq('id', attempt.id)

  return {
    handled: true,
    detail: {
      fee_id: attempt.fee_id,
      amount,
      fee_status: write.feeStatus,
      duplicate: write.duplicate ?? false,
    },
  }
}

/** A failed payment closes the attempt. Nothing reaches the ledger — no money moved. */
export async function handlePaymentFailed(
  db: SupabaseClient,
  source: FeeSource,
  event: RazorpayEvent,
): Promise<HandleResult> {
  const entity = event.payload?.payment?.entity
  const orderId = entity?.order_id
  if (!orderId) return { handled: false, detail: { ignored: 'no order_id' } }

  const attempt = await findAttemptByOrder(db, source, orderId)
  if (!attempt) return { handled: false, detail: { ignored: 'unknown order' } }
  // A captured payment that later reports a failed attempt on the same order
  // must not un-verify the money we already hold.
  if (attempt.status === 'verified') return { handled: false, detail: { ignored: 'already verified' } }

  await db.from(ATTEMPT_TABLE[source]).update({
    status: 'failed',
    failure_reason: entity?.error_description ?? 'Payment failed at the gateway',
  }).eq('id', attempt.id)

  return { handled: true, detail: { fee_id: attempt.fee_id, status: 'failed' } }
}

/**
 * A dynamic QR was paid. Razorpay reports the payment entity with the QR's id
 * in notes; the order id is carried there when we created the QR against one.
 */
export async function handleQrCredited(
  db: SupabaseClient,
  source: FeeSource,
  event: RazorpayEvent,
  eventId: string,
  eventRowId?: string,
): Promise<HandleResult> {
  const payment = event.payload?.payment?.entity
  const feeId = payment?.notes?.fee_id
  if (!payment || !feeId) return { handled: false, detail: { ignored: 'no fee_id in QR notes' } }
  if (payment.notes?.source && payment.notes.source !== source) {
    return { handled: false, detail: { ignored: 'other module' } }
  }

  const amount = payment.amount !== undefined ? payment.amount / 100 : 0
  if (amount <= 0) return { handled: false, detail: { ignored: 'zero amount' } }

  const studentId = await studentOf(db, source, feeId)
  const write = await appendLedgerEntry(db, {
    kind: 'payment',
    direction: 'credit',
    amount,
    source,
    feeId,
    studentId,
    payerId: payment.notes?.payer_id ?? null,
    method: payment.method ?? 'upi',
    gateway: 'razorpay',
    gatewayPaymentId: payment.id ?? null,
    utr: payment.acquirer_data?.rrn ?? payment.acquirer_data?.upi_transaction_id ?? null,
    idempotencyKey: `rzp:${eventId}:${payment.id ?? feeId}`,
    webhookEventId: eventRowId ?? null,
    note: 'Paid via Razorpay UPI QR',
  })

  if (!write.ok) return { handled: false, detail: { error: write.error } }
  return {
    handled: true,
    detail: { fee_id: feeId, amount, fee_status: write.feeStatus, duplicate: write.duplicate ?? false },
  }
}

/**
 * A refund settled at the gateway. Writes the ledger debit and closes the
 * fee_refunds row; if the refund was raised elsewhere (the Razorpay dashboard,
 * say) there is no local row and the ledger still records the money leaving.
 */
export async function handleRefundProcessed(
  db: SupabaseClient,
  source: FeeSource,
  event: RazorpayEvent,
  eventId: string,
  eventRowId?: string,
): Promise<HandleResult> {
  const entity = event.payload?.refund?.entity
  const refundId = entity?.id
  const paymentId = entity?.payment_id
  if (!refundId || !paymentId) return { handled: false, detail: { ignored: 'no refund/payment id' } }

  const { data: original } = await db
    .from('fee_transactions')
    .select('id, fee_id, student_id, source')
    .eq('gateway_payment_id', paymentId)
    .eq('direction', 'credit')
    .maybeSingle()
  if (!original) return { handled: false, detail: { ignored: 'unknown payment', payment_id: paymentId } }
  if (original.source !== source) return { handled: false, detail: { ignored: 'other module' } }

  const amount = entity?.amount !== undefined ? entity.amount / 100 : 0
  if (amount <= 0) return { handled: false, detail: { ignored: 'zero amount' } }

  const write = await appendLedgerEntry(db, {
    kind: 'refund',
    direction: 'debit',
    amount,
    source,
    feeId: original.fee_id,
    studentId: original.student_id,
    gateway: 'razorpay',
    gatewayPaymentId: paymentId,
    gatewayRefundId: refundId,
    reversesTxnId: original.id,
    idempotencyKey: `rzp:${eventId}:${refundId}`,
    webhookEventId: eventRowId ?? null,
    note: 'Refund settled at the gateway',
  })
  if (!write.ok) return { handled: false, detail: { error: write.error } }

  await db.from('fee_refunds').update({
    status: 'processed',
    processed_at: new Date().toISOString(),
    ledger_txn_id: write.transactionId ?? null,
  }).eq('gateway_refund_id', refundId).neq('status', 'processed')

  return {
    handled: true,
    detail: { refund_id: refundId, amount, fee_status: write.feeStatus, duplicate: write.duplicate ?? false },
  }
}

/** A refund that failed at the gateway. The money never left; no ledger row. */
export async function handleRefundFailed(
  db: SupabaseClient,
  event: RazorpayEvent,
): Promise<HandleResult> {
  const refundId = event.payload?.refund?.entity?.id
  if (!refundId) return { handled: false, detail: { ignored: 'no refund id' } }
  await db.from('fee_refunds').update({
    status: 'failed',
    failure_reason: 'The gateway could not process this refund.',
  }).eq('gateway_refund_id', refundId).neq('status', 'processed')
  return { handled: true, detail: { refund_id: refundId, status: 'failed' } }
}

/**
 * Dispatch. Both the school and bus routes call this with their own source, so
 * an order belonging to the other module is ignored with a 200 rather than
 * retried forever.
 */
export async function dispatchRazorpayEvent(
  db: SupabaseClient,
  source: FeeSource,
  verified: VerifiedWebhook,
): Promise<HandleResult> {
  const { event, eventId, eventRowId } = verified
  if (!event || !eventId) return { handled: false, detail: { ignored: 'no event' } }

  switch (event.event) {
    case 'payment.captured':
      return handlePaymentCaptured(db, source, event, eventId, eventRowId)
    case 'payment.failed':
      return handlePaymentFailed(db, source, event)
    case 'qr_code.credited':
      return handleQrCredited(db, source, event, eventId, eventRowId)
    case 'refund.processed':
      return handleRefundProcessed(db, source, event, eventId, eventRowId)
    case 'refund.failed':
      return handleRefundFailed(db, event)
    // order.paid arrives alongside payment.captured for the same money and is
    // deliberately not acted on — crediting both would double-count.
    default:
      return { handled: false, detail: { ignored: event.event ?? 'unknown' } }
  }
}
