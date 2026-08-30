import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/fees/serverGuard'
import { auditFeeAction } from '@/lib/fees/audit'

// Cancel a receipt, and optionally reissue it.
//
// Two quite different situations look the same from the outside, and conflating
// them is how a school loses money:
//
//   • Wrong on paper, right in the bank — a typo in the payer's name, the wrong
//     fee head. Cancel and reissue: a new numbered receipt replaces the old,
//     both remain findable, and the LEDGER IS UNTOUCHED because the money did
//     arrive and still has.
//
//   • Wrong in the bank — the payment never actually cleared, or was recorded
//     against the wrong student. That is not a receipt problem. Reverse the
//     payment (a compensating ledger entry) and the receipt follows.
//
// So this route only ever does the first. `reverse_payment: true` is refused
// with an explanation pointing at the refund flow, rather than quietly writing
// a ledger entry from a screen that says "cancel receipt".

export const runtime = 'nodejs'

interface Body {
  reason?: string
  /** Issue a replacement carrying the same payment. */
  reissue?: boolean
  paid_by_name?: string
  reverse_payment?: boolean
}

export async function POST(
  request: NextRequest,
  { params }: { params: { receiptId: string } },
) {
  const guard = await requireCapability(request, 'cancel_receipt')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  let body: Body
  try { body = await request.json() } catch { return bad('Invalid request body') }
  if (!body.reason?.trim()) {
    return bad('A reason is required. A cancelled receipt with no stated reason cannot be explained at an audit.')
  }
  if (body.reverse_payment) {
    return bad(
      'Cancelling a receipt does not take money back. If the payment itself was wrong, raise a refund — that writes a compensating ledger entry and leaves both records in place.',
    )
  }

  const { data: receipt } = await db
    .from('fee_receipts')
    .select('id, receipt_no, transaction_id, source, fee_id, student_id, family_id, amount, method, academic_year, paid_by_name, paid_by_id, snapshot, status')
    .eq('id', params.receiptId)
    .maybeSingle()
  if (!receipt) return NextResponse.json({ success: false, error: 'Receipt not found' }, { status: 404 })
  if (receipt.status === 'cancelled') {
    return bad(`Receipt ${receipt.receipt_no} is already cancelled.`)
  }

  const now = new Date().toISOString()
  const { error: cancelErr } = await db.from('fee_receipts').update({
    status: 'cancelled',
    cancelled_at: now,
    cancelled_by: userId,
    cancel_reason: body.reason.trim(),
  }).eq('id', receipt.id)

  if (cancelErr) {
    console.error('receipts/cancel: update failed', cancelErr)
    return NextResponse.json({ success: false, error: cancelErr.message }, { status: 400 })
  }

  await auditFeeAction(db, {
    actorId: userId, action: 'receipt.cancel', entityType: 'fee_receipt', entityId: receipt.id,
    studentId: receipt.student_id,
    summary: `Cancelled receipt ${receipt.receipt_no} — ${body.reason.trim()}`,
    before: { status: 'issued' }, after: { status: 'cancelled', reason: body.reason.trim() },
    request,
  })

  if (!body.reissue) {
    return NextResponse.json({ success: true, cancelled: receipt.receipt_no })
  }

  // The replacement carries the same payment and a fresh number. Numbers are
  // never reused: a gap where a cancelled receipt was is exactly what an
  // auditor expects to see.
  const { data: numbered, error: numErr } = await db
    .rpc('next_receipt_no', { p_year: receipt.academic_year ?? null })
  if (numErr) {
    return NextResponse.json({
      success: false,
      error: `Receipt ${receipt.receipt_no} was cancelled, but a replacement number could not be allocated. Issue the replacement manually.`,
    }, { status: 500 })
  }

  const { data: replacement, error: reissueErr } = await db.from('fee_receipts').insert({
    receipt_no: numbered as string,
    transaction_id: receipt.transaction_id,
    source: receipt.source,
    fee_id: receipt.fee_id,
    student_id: receipt.student_id,
    family_id: receipt.family_id,
    paid_by_name: body.paid_by_name ?? receipt.paid_by_name,
    paid_by_id: receipt.paid_by_id,
    amount: receipt.amount,
    method: receipt.method,
    academic_year: receipt.academic_year,
    issued_by: userId,
    replaces_id: receipt.id,
    snapshot: {
      ...(receipt.snapshot as Record<string, unknown> ?? {}),
      reissued_from: receipt.receipt_no,
      reissue_reason: body.reason.trim(),
    },
  }).select('id, receipt_no').single()

  if (reissueErr) {
    return NextResponse.json({
      success: false,
      error: `Receipt ${receipt.receipt_no} was cancelled, but the replacement could not be issued: ${reissueErr.message}`,
    }, { status: 400 })
  }

  await db.from('fee_receipts').update({ replaced_by_id: replacement.id }).eq('id', receipt.id)

  await auditFeeAction(db, {
    actorId: userId, action: 'receipt.reissue', entityType: 'fee_receipt', entityId: replacement.id,
    studentId: receipt.student_id,
    summary: `Reissued ${receipt.receipt_no} as ${replacement.receipt_no}`,
    after: { replaces: receipt.receipt_no, receipt_no: replacement.receipt_no },
    request,
  })

  return NextResponse.json({
    success: true,
    cancelled: receipt.receipt_no,
    reissued_as: replacement.receipt_no,
    receipt_id: replacement.id,
  })
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
