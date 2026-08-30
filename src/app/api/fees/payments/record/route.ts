import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/fees/serverGuard'
import { appendLedgerEntry, outstandingFor, type FeeSource } from '@/lib/fees/ledger'
import { auditFeeAction } from '@/lib/fees/audit'

// Record a payment collected at the office — cash, cheque, card, bank transfer
// or a UPI payment made in front of the clerk.
//
// This used to be recordOfflinePayment() in src/lib/fees.ts, running in the
// browser against the anon key and relying on RLS. RLS correctly restricts WHO
// may write, but it cannot enforce WHAT a valid state transition is: a
// compromised or merely buggy admin session could insert a verified payment for
// any amount against any fee, indistinguishable from a legitimate one. Money
// decisions belong on the server, so this is where it lives now.
//
// The idempotency key is built from a client-supplied request id. A clerk
// double-clicking Save, or a flaky connection retried, must not credit twice.

export const runtime = 'nodejs'

const OFFLINE_METHODS = ['cash', 'cheque', 'card', 'bank', 'upi_qr'] as const
type OfflineMethod = (typeof OFFLINE_METHODS)[number]

interface Body {
  fee_id?: string
  source?: FeeSource
  method?: OfflineMethod
  amount?: number
  reference?: string
  /** Cheque particulars, kept so a bounce can be traced back. */
  instrument_no?: string
  instrument_bank?: string
  instrument_date?: string
  note?: string
  /** Client-generated, stable across retries of the SAME save. */
  request_id?: string
  received_at?: string
}

export async function POST(request: NextRequest) {
  const guard = await requireCapability(request, 'record_payment')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  let body: Body
  try { body = await request.json() } catch { return bad('Invalid request body') }

  const source: FeeSource = body.source === 'bus' ? 'bus' : 'school'
  const { fee_id: feeId, method, amount } = body

  if (!feeId) return bad('fee_id is required')
  if (!method || !OFFLINE_METHODS.includes(method)) {
    return bad(`method must be one of ${OFFLINE_METHODS.join(', ')}`)
  }
  if (!body.request_id) return bad('request_id is required so a retry cannot credit twice')

  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) return bad('A payment must be a positive amount.')

  const balance = await outstandingFor(db, source, feeId)
  if (!balance) return NextResponse.json({ success: false, error: 'Fee not found' }, { status: 404 })

  // Overpayment is a real thing at a school counter, but it should be a
  // deliberate act with somewhere to go — Round 2's advance/credit balance —
  // not an accident that silently inflates a fee's collection figure.
  if (value > balance.outstanding) {
    return bad(
      `That is more than the ₹${balance.outstanding.toLocaleString('en-IN')} outstanding. ` +
      `Record ₹${balance.outstanding.toLocaleString('en-IN')} against this fee and the remainder as an advance.`,
    )
  }

  const table = source === 'school' ? 'school_fees' : 'bus_fees'
  const studentCol = source === 'school' ? 'student_id' : 'passenger_id'
  const { data: feeRow } = await db.from(table).select(`id, status, ${studentCol}`).eq('id', feeId).maybeSingle()
  const fee = feeRow as Record<string, unknown> | null
  if (!fee) return NextResponse.json({ success: false, error: 'Fee not found' }, { status: 404 })
  if (fee.status === 'cancelled') return bad('This fee is cancelled. Restore it before recording a payment.')

  const attemptTable = source === 'school' ? 'school_fee_payments' : 'bus_payments'
  const idempotencyKey = `office:${body.request_id}`
  const now = new Date().toISOString()

  // The attempt row first, so the office's own list shows the receipt even if
  // the ledger write is the thing that races.
  const { data: attempt, error: attemptErr } = await db.from(attemptTable).insert({
    fee_id: feeId,
    payer_id: fee[studentCol] as string,
    method,
    amount: value,
    status: 'verified',
    verified_by: userId,
    verified_at: now,
    upi_txn_ref: body.reference?.trim() || null,
    idempotency_key: idempotencyKey,
  }).select('id').single()

  if (attemptErr && attemptErr.code !== '23505') {
    console.error('payments/record: attempt insert failed', attemptErr)
    return NextResponse.json({ success: false, error: 'Could not record the payment.' }, { status: 500 })
  }

  const write = await appendLedgerEntry(db, {
    kind: 'payment',
    direction: 'credit',
    amount: value,
    source,
    feeId,
    studentId: fee[studentCol] as string,
    payerId: fee[studentCol] as string,
    method,
    gateway: null,
    utr: body.reference?.trim() || null,
    idempotencyKey,
    attemptId: attempt?.id ?? null,
    attemptTable,
    actorId: userId,
    note: body.note ?? null,
    meta: body.instrument_no || body.instrument_bank || body.instrument_date
      ? {
          instrument_no: body.instrument_no ?? null,
          instrument_bank: body.instrument_bank ?? null,
          instrument_date: body.instrument_date ?? null,
        }
      : null,
    occurredAt: body.received_at ?? now,
  })

  if (!write.ok) {
    return NextResponse.json({ success: false, error: write.error ?? 'Could not record the payment.' }, { status: 500 })
  }

  if (attempt?.id && write.transactionId) {
    await db.from(attemptTable).update({ ledger_txn_id: write.transactionId }).eq('id', attempt.id)
  }

  await auditFeeAction(db, {
    actorId: userId,
    action: write.duplicate ? 'payment.record.duplicate' : 'payment.record',
    entityType: 'fee_payment',
    entityId: write.transactionId ?? feeId,
    studentId: fee[studentCol] as string,
    summary: `Recorded ₹${value.toLocaleString('en-IN')} by ${method} against ${source} fee`,
    after: { amount: value, method, reference: body.reference ?? null, fee_id: feeId },
    request,
  })

  return NextResponse.json({
    success: true,
    transaction_id: write.transactionId,
    fee_status: write.feeStatus,
    duplicate: write.duplicate ?? false,
    outstanding: Math.max(0, balance.outstanding - value),
  })
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
