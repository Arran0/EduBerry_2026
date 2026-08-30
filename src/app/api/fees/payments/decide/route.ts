import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/fees/serverGuard'
import { appendLedgerEntry, outstandingFor, type FeeSource } from '@/lib/fees/ledger'
import { auditFeeAction } from '@/lib/fees/audit'

// Approve or reject a pending payment claim — the office confirming a payment
// a parent said they made.
//
// Replaces verifyPayment() / rejectPayment() from src/lib/fees.ts, which ran in
// the browser and, on approval, set the fee to 'paid' outright. That is the
// partial-payment bug: a ₹2,000 claim against a ₹10,000 fee marked the whole
// thing settled. Here the ledger decides the status, so a short payment lands
// on 'partial' and the balance stays collectable.

export const runtime = 'nodejs'

interface Body {
  payment_id?: string
  source?: FeeSource
  decision?: 'verify' | 'reject'
  /** Confirm a different amount than the parent claimed. */
  amount?: number
  note?: string
}

export async function POST(request: NextRequest) {
  const guard = await requireCapability(request, 'verify_payment')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  let body: Body
  try { body = await request.json() } catch { return bad('Invalid request body') }

  const source: FeeSource = body.source === 'bus' ? 'bus' : 'school'
  const paymentId = body.payment_id
  const decision = body.decision
  if (!paymentId) return bad('payment_id is required')
  if (decision !== 'verify' && decision !== 'reject') return bad("decision must be 'verify' or 'reject'")

  const attemptTable = source === 'school' ? 'school_fee_payments' : 'bus_payments'
  const { data: attempt } = await db
    .from(attemptTable)
    .select('id, fee_id, amount, status, payer_id, method, upi_txn_ref, ledger_txn_id')
    .eq('id', paymentId)
    .maybeSingle()
  if (!attempt) return NextResponse.json({ success: false, error: 'Payment not found' }, { status: 404 })

  if (attempt.status === 'verified') {
    return NextResponse.json({ success: true, already: true, fee_status: null })
  }

  if (decision === 'reject') {
    await db.from(attemptTable).update({
      status: 'failed',
      failure_reason: body.note ?? 'Rejected by the office',
    }).eq('id', paymentId)

    await auditFeeAction(db, {
      actorId: userId,
      action: 'payment.reject',
      entityType: 'fee_payment',
      entityId: paymentId,
      summary: `Rejected a ₹${Number(attempt.amount).toLocaleString('en-IN')} payment claim`,
      before: { status: attempt.status },
      after: { status: 'failed', reason: body.note ?? null },
      request,
    })
    return NextResponse.json({ success: true, status: 'failed' })
  }

  // Verify. The confirmed amount is what the office actually saw arrive, which
  // may be less than the parent claimed.
  const claimed = Number(attempt.amount) || 0
  const value = body.amount === undefined ? claimed : Number(body.amount)
  if (!Number.isFinite(value) || value <= 0) return bad('A confirmed payment must be a positive amount.')

  const balance = await outstandingFor(db, source, attempt.fee_id)
  if (!balance) return NextResponse.json({ success: false, error: 'Fee not found' }, { status: 404 })
  if (value > balance.outstanding) {
    return bad(`That is more than the ₹${balance.outstanding.toLocaleString('en-IN')} still outstanding on this fee.`)
  }

  const table = source === 'school' ? 'school_fees' : 'bus_fees'
  const studentCol = source === 'school' ? 'student_id' : 'passenger_id'
  const { data: feeRow } = await db.from(table).select(`id, ${studentCol}`).eq('id', attempt.fee_id).maybeSingle()
  const fee = feeRow as Record<string, unknown> | null

  const write = await appendLedgerEntry(db, {
    kind: 'payment',
    direction: 'credit',
    amount: value,
    source,
    feeId: attempt.fee_id,
    studentId: (fee?.[studentCol] as string) ?? null,
    payerId: attempt.payer_id,
    method: attempt.method,
    utr: attempt.upi_txn_ref,
    // Keyed on the attempt, so verifying the same claim twice — two admins with
    // the queue open, a double click — credits once.
    idempotencyKey: `verify:${source}:${paymentId}`,
    attemptId: attempt.id,
    attemptTable,
    actorId: userId,
    note: body.note ?? (value !== claimed ? `Confirmed ₹${value} against a claimed ₹${claimed}.` : null),
  })

  if (!write.ok) {
    return NextResponse.json({ success: false, error: write.error ?? 'Could not verify the payment.' }, { status: 500 })
  }

  await db.from(attemptTable).update({
    status: 'verified',
    amount: value,
    verified_by: userId,
    verified_at: new Date().toISOString(),
    ledger_txn_id: write.transactionId ?? null,
  }).eq('id', paymentId)

  await auditFeeAction(db, {
    actorId: userId,
    action: 'payment.verify',
    entityType: 'fee_payment',
    entityId: paymentId,
    studentId: (fee?.[studentCol] as string) ?? null,
    summary: `Verified ₹${value.toLocaleString('en-IN')} against ${source} fee`,
    before: { status: attempt.status, amount: claimed },
    after: { status: 'verified', amount: value },
    request,
  })

  return NextResponse.json({
    success: true,
    transaction_id: write.transactionId,
    fee_status: write.feeStatus,
    duplicate: write.duplicate ?? false,
  })
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
