import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/fees/serverGuard'
import { auditFeeAction } from '@/lib/fees/audit'

// Request a refund against a specific ledger credit.
//
// A refund names the payment it returns, not just the fee. That is what makes
// it auditable: "we returned ₹4,500 of the ₹12,000 received on 14 August by
// Razorpay pay_XYZ" is a sentence somebody can check against a bank statement.
// "The fee was refunded" is not.
//
// The database enforces the arithmetic (fee_refunds_validate in
// fees_v2_refunds_audit.sql): a refund cannot exceed what is left of the
// original payment, counting refunds already in flight — so two half-refunds
// approved in parallel cannot both look affordable.

export const runtime = 'nodejs'

const REASON_CATEGORIES = [
  'withdrawal', 'transfer', 'overpayment', 'duplicate_payment',
  'fee_revision', 'deposit_return', 'cancelled_service', 'other',
] as const

interface Body {
  transaction_id?: string
  amount?: number
  reason?: string
  reason_category?: (typeof REASON_CATEGORIES)[number]
  method?: 'gateway' | 'cash' | 'cheque' | 'bank_transfer' | 'adjustment'
}

export async function POST(request: NextRequest) {
  const guard = await requireCapability(request, 'request_refund')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  let body: Body
  try { body = await request.json() } catch { return bad('Invalid request body') }

  const txnId = body.transaction_id
  if (!txnId) return bad('transaction_id is required — a refund must name the payment it returns')
  if (!body.reason?.trim()) return bad('A reason is required. A refund with no stated reason cannot be reviewed later.')

  const category = body.reason_category ?? 'other'
  if (!REASON_CATEGORIES.includes(category)) return bad('Unknown reason category')

  const { data: original } = await db
    .from('fee_transactions')
    .select('id, direction, amount, source, fee_id, student_id, gateway, gateway_payment_id')
    .eq('id', txnId)
    .maybeSingle()
  if (!original) return NextResponse.json({ success: false, error: 'Payment not found' }, { status: 404 })
  if (original.direction !== 'credit') return bad('Only a payment can be refunded.')

  const amount = body.amount === undefined ? Number(original.amount) : Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) return bad('A refund must be a positive amount.')

  // Default the method to how the money came in: a gateway payment refunds to
  // the original instrument, which is both faster for the parent and the only
  // route that leaves a matching gateway record.
  const method = body.method ?? (original.gateway === 'razorpay' && original.gateway_payment_id ? 'gateway' : 'bank_transfer')
  if (method === 'gateway' && !original.gateway_payment_id) {
    return bad('This payment did not come through the gateway, so it cannot be refunded to one.')
  }

  const { data: refund, error } = await db.from('fee_refunds').insert({
    transaction_id: txnId,
    source: original.source,
    fee_id: original.fee_id,
    student_id: original.student_id,
    amount,
    kind: amount >= Number(original.amount) ? 'full' : 'partial',
    reason_category: category,
    reason: body.reason.trim(),
    method,
    status: 'requested',
    requested_by: userId,
  }).select('id, status, amount, kind').single()

  if (error) {
    // The over-refund guard is a raised exception, and its message is written
    // to be shown to a person.
    console.error('refunds: insert failed', error)
    return NextResponse.json({ success: false, error: humanise(error.message) }, { status: 400 })
  }

  await auditFeeAction(db, {
    actorId: userId,
    action: 'refund.request',
    entityType: 'fee_refund',
    entityId: refund.id,
    studentId: original.student_id,
    summary: `Requested a ${refund.kind} refund of ₹${amount.toLocaleString('en-IN')} — ${category}`,
    after: { amount, method, reason: body.reason.trim(), transaction_id: txnId },
    request,
  })

  return NextResponse.json({ success: true, refund_id: refund.id, status: refund.status })
}

/** List refunds, newest first. Admin-only via the capability check. */
export async function GET(request: NextRequest) {
  const guard = await requireCapability(request, 'view_reports')
  if (!guard.ok) return guard.response
  const { db } = guard.actor

  const status = new URL(request.url).searchParams.get('status')
  let q = db.from('fee_refunds')
    .select('id, transaction_id, source, fee_id, student_id, amount, kind, reason, reason_category, status, method, gateway_refund_id, requested_by, requested_at, approved_by, approved_at, processed_at, failure_reason')
    .order('requested_at', { ascending: false })
    .limit(500)
  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, refunds: data ?? [] })
}

function humanise(message: string): string {
  if (message.includes('exceeds what is left')) return message.replace(/^.*?ERROR:\s*/, '')
  return message
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
