import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import Razorpay from 'razorpay'
import { getPaymentSecrets } from '@/lib/serverSecrets'
import { requireCapability } from '@/lib/fees/serverGuard'
import { appendLedgerEntry } from '@/lib/fees/ledger'
import { auditFeeAction } from '@/lib/fees/audit'

// Approve or reject a refund request.
//
// Maker–checker is enforced in the database (fee_refunds_validate), not here:
// the person who requested a refund cannot approve it, and a compromised
// session cannot route around a trigger. This route's job is to carry out an
// approved decision and make sure the ledger reflects it.
//
// Two settlement paths:
//   • gateway — Razorpay refunds asynchronously. This route moves the refund to
//     'processing'; the ledger debit is written when refund.processed arrives.
//     Writing it here would credit the parent's account in our books before the
//     money had actually left.
//   • manual (cash / cheque / bank transfer / adjustment) — the office hands the
//     money back, so the debit is written now.

export const runtime = 'nodejs'

interface Body {
  decision?: 'approve' | 'reject'
  note?: string
  /** Cheque or NEFT reference, for a manual refund. */
  reference?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: { refundId: string } },
) {
  const guard = await requireCapability(request, 'approve_refund')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  let body: Body
  try { body = await request.json() } catch { return bad('Invalid request body') }
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return bad("decision must be 'approve' or 'reject'")
  }

  const { data: refund } = await db
    .from('fee_refunds')
    .select('id, transaction_id, source, fee_id, student_id, amount, status, method, requested_by')
    .eq('id', params.refundId)
    .maybeSingle()
  if (!refund) return NextResponse.json({ success: false, error: 'Refund not found' }, { status: 404 })

  if (refund.status !== 'requested') {
    return bad(`This refund is already ${refund.status} and cannot be decided again.`)
  }
  // Checked here too so the caller gets a readable message rather than a raw
  // trigger exception — the database is still the thing that guarantees it.
  if (refund.requested_by === userId) {
    return NextResponse.json(
      { success: false, error: 'A refund cannot be approved by the person who requested it.' },
      { status: 403 },
    )
  }

  const now = new Date().toISOString()

  if (body.decision === 'reject') {
    const { error } = await db.from('fee_refunds').update({
      status: 'rejected', approved_by: userId, approved_at: now, decision_note: body.note ?? null,
    }).eq('id', refund.id)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })

    await auditFeeAction(db, {
      actorId: userId, action: 'refund.reject', entityType: 'fee_refund', entityId: refund.id,
      studentId: refund.student_id,
      summary: `Rejected a ₹${Number(refund.amount).toLocaleString('en-IN')} refund`,
      before: { status: 'requested' }, after: { status: 'rejected', note: body.note ?? null },
      request,
    })
    return NextResponse.json({ success: true, status: 'rejected' })
  }

  // Approve.
  const { error: approveErr } = await db.from('fee_refunds').update({
    status: 'approved', approved_by: userId, approved_at: now, decision_note: body.note ?? null,
  }).eq('id', refund.id)
  if (approveErr) return NextResponse.json({ success: false, error: approveErr.message }, { status: 400 })

  await auditFeeAction(db, {
    actorId: userId, action: 'refund.approve', entityType: 'fee_refund', entityId: refund.id,
    studentId: refund.student_id,
    summary: `Approved a ₹${Number(refund.amount).toLocaleString('en-IN')} ${refund.method} refund`,
    before: { status: 'requested' }, after: { status: 'approved' },
    request,
  })

  if (refund.method === 'gateway') {
    return settleViaGateway(db, request, refund, userId)
  }
  return settleManually(db, request, refund, userId, body.reference)
}

type RefundRow = {
  id: string; transaction_id: string; source: string; fee_id: string | null
  student_id: string | null; amount: number; status: string; method: string; requested_by: string | null
}

async function settleViaGateway(
  db: Parameters<typeof appendLedgerEntry>[0],
  request: NextRequest,
  refund: RefundRow,
  userId: string,
) {
  const { data: original } = await db
    .from('fee_transactions').select('gateway_payment_id').eq('id', refund.transaction_id).maybeSingle()
  const paymentId = original?.gateway_payment_id as string | undefined
  if (!paymentId) {
    await markFailed(db, refund.id, 'The original payment has no gateway reference.')
    return NextResponse.json({ success: false, error: 'The original payment has no gateway reference.' }, { status: 400 })
  }

  const secrets = await getPaymentSecrets(db, 'razorpay')
  const keyId = process.env.RAZORPAY_KEY_ID ?? await storedKeyId(db)
  if (!keyId || !secrets.key_secret) {
    await markFailed(db, refund.id, 'Razorpay is not configured.')
    return NextResponse.json({ success: false, error: 'Razorpay is not configured.' }, { status: 503 })
  }

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: secrets.key_secret })
    const created = await razorpay.payments.refund(paymentId, {
      amount: Math.round(Number(refund.amount) * 100),
      speed: 'normal',
      notes: { refund_id: refund.id, fee_id: refund.fee_id ?? '', source: refund.source },
    })

    // 'processing', not 'processed'. The ledger debit is written by
    // handleRefundProcessed when the gateway confirms the money has left.
    await db.from('fee_refunds').update({
      status: 'processing', gateway_refund_id: created.id,
    }).eq('id', refund.id)

    await auditFeeAction(db, {
      actorId: userId, action: 'refund.gateway_initiated', entityType: 'fee_refund', entityId: refund.id,
      studentId: refund.student_id,
      summary: `Razorpay refund ${created.id} initiated`,
      after: { gateway_refund_id: created.id }, request,
    })

    return NextResponse.json({ success: true, status: 'processing', gateway_refund_id: created.id })
  } catch (e) {
    console.error('refunds/decide: gateway refund failed', e)
    await markFailed(db, refund.id, 'The gateway rejected this refund.')
    return NextResponse.json({ success: false, error: 'The gateway rejected this refund.' }, { status: 502 })
  }
}

async function settleManually(
  db: Parameters<typeof appendLedgerEntry>[0],
  request: NextRequest,
  refund: RefundRow,
  userId: string,
  reference?: string,
) {
  const write = await appendLedgerEntry(db, {
    kind: 'refund',
    direction: 'debit',
    amount: Number(refund.amount),
    source: refund.source === 'bus' ? 'bus' : 'school',
    feeId: refund.fee_id,
    studentId: refund.student_id,
    method: refund.method,
    reversesTxnId: refund.transaction_id,
    idempotencyKey: `refund:${refund.id}`,
    actorId: userId,
    note: reference ? `Manual refund, reference ${reference}` : 'Manual refund',
  })

  if (!write.ok) {
    await markFailed(db, refund.id, write.error ?? 'Could not write the refund to the ledger.')
    return NextResponse.json({ success: false, error: write.error ?? 'Could not record the refund.' }, { status: 400 })
  }

  await db.from('fee_refunds').update({
    status: 'processed',
    processed_at: new Date().toISOString(),
    reference: reference ?? null,
    ledger_txn_id: write.transactionId ?? null,
  }).eq('id', refund.id)

  await auditFeeAction(db, {
    actorId: userId, action: 'refund.processed', entityType: 'fee_refund', entityId: refund.id,
    studentId: refund.student_id,
    summary: `Paid out a ₹${Number(refund.amount).toLocaleString('en-IN')} refund by ${refund.method}`,
    after: { status: 'processed', reference: reference ?? null, transaction_id: write.transactionId },
    request,
  })

  return NextResponse.json({
    success: true, status: 'processed',
    transaction_id: write.transactionId, fee_status: write.feeStatus,
  })
}

async function markFailed(db: Parameters<typeof appendLedgerEntry>[0], refundId: string, reason: string) {
  await db.from('fee_refunds').update({ status: 'failed', failure_reason: reason }).eq('id', refundId)
}

async function storedKeyId(db: Parameters<typeof appendLedgerEntry>[0]): Promise<string | undefined> {
  const { data } = await db.from('site_settings').select('value').eq('key', 'razorpay_config').maybeSingle()
  return (data?.value as { key_id?: string } | null)?.key_id
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
