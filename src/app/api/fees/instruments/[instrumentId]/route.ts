import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/fees/serverGuard'
import { appendLedgerEntry, type FeeSource } from '@/lib/fees/ledger'
import { auditFeeAction } from '@/lib/fees/audit'

// The life of a cheque after the office takes it.
//
//   received → deposited → cleared
//                       ↘ bounced
//
// A cheque is a promise, not money, but the school's books credit it when the
// office accepts it — that is when the receipt is handed over and when the
// parent stops being chased. So a bounce cannot be an edit of that credit: the
// ledger is append-only and the credit genuinely happened. It is a compensating
// DEBIT, which puts the fee back into arrears and leaves the whole story on the
// record: money in on the 3rd, money out again on the 19th, cheque number and
// bank reason attached to both.
//
// The bank's return charge, where there is one, becomes a separate fee rather
// than being netted into the reversal. Netting it would make the reversal
// disagree with the cheque amount, and the first person to reconcile the two
// would have to guess why.

export const runtime = 'nodejs'

interface Body {
  status?: 'deposited' | 'cleared' | 'bounced' | 'cancelled'
  date?: string
  bounce_reason?: string
  bank_charge?: number
  /** Fee head to bill the bank's return charge under. */
  charge_head_id?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: { instrumentId: string } },
) {
  const guard = await requireCapability(request, 'record_payment')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  let body: Body
  try { body = await request.json() } catch { return bad('Invalid request body') }

  const status = body.status
  if (!status) return bad('status is required')

  const { data: instrument } = await db
    .from('fee_instruments')
    .select('id, transaction_id, kind, instrument_no, bank_name, status, reversal_txn_id')
    .eq('id', params.instrumentId)
    .maybeSingle()
  if (!instrument) return NextResponse.json({ success: false, error: 'Instrument not found' }, { status: 404 })

  if (instrument.status === 'bounced' && status !== 'bounced') {
    return bad('This instrument has already bounced and its reversal is on the ledger. Record a fresh payment instead.')
  }
  if (instrument.status === status) {
    return NextResponse.json({ success: true, already: true, status })
  }

  const today = body.date ?? new Date().toISOString().slice(0, 10)

  if (status !== 'bounced') {
    const patch: Record<string, unknown> = { status }
    if (status === 'cleared') patch.cleared_on = today
    await db.from('fee_instruments').update(patch).eq('id', instrument.id)

    await auditFeeAction(db, {
      actorId: userId, action: `instrument.${status}`, entityType: 'fee_payment', entityId: instrument.id,
      summary: `${instrument.kind} ${instrument.instrument_no ?? ''} marked ${status}`.trim(),
      before: { status: instrument.status }, after: { status },
      request,
    })
    return NextResponse.json({ success: true, status })
  }

  // Bounced. Reverse the credit.
  if (!body.bounce_reason?.trim()) {
    return bad('The bank’s reason for returning the cheque is required — the parent will ask.')
  }

  const { data: original } = await db
    .from('fee_transactions')
    .select('id, amount, source, fee_id, student_id, family_id')
    .eq('id', instrument.transaction_id)
    .maybeSingle()
  if (!original) return NextResponse.json({ success: false, error: 'The original payment is missing.' }, { status: 404 })

  const source = (original.source === 'bus' ? 'bus' : 'school') as FeeSource

  const reversal = await appendLedgerEntry(db, {
    kind: 'reversal',
    direction: 'debit',
    amount: Number(original.amount),
    source,
    feeId: original.fee_id,
    studentId: original.student_id,
    familyId: original.family_id,
    method: instrument.kind,
    reversesTxnId: original.id,
    idempotencyKey: `bounce:${instrument.id}`,
    actorId: userId,
    note: `${instrument.kind} ${instrument.instrument_no ?? ''} returned: ${body.bounce_reason.trim()}`.trim(),
    meta: { instrument_no: instrument.instrument_no, bank: instrument.bank_name, reason: body.bounce_reason.trim() },
    occurredAt: `${today}T00:00:00.000Z`,
  })

  if (!reversal.ok) {
    return NextResponse.json({ success: false, error: reversal.error ?? 'Could not reverse the payment.' }, { status: 400 })
  }

  await db.from('fee_instruments').update({
    status: 'bounced',
    bounced_on: today,
    bounce_reason: body.bounce_reason.trim(),
    bank_charge: body.bank_charge ?? null,
    reversal_txn_id: reversal.transactionId ?? null,
  }).eq('id', instrument.id)

  // Cancel any receipt that was issued for money the school no longer has.
  await db.from('fee_receipts').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancelled_by: userId,
    cancel_reason: `Cheque returned: ${body.bounce_reason.trim()}`,
  }).eq('transaction_id', original.id).eq('status', 'issued')

  // The bank's charge is its own fee, not a deduction from the reversal.
  let chargeFeeId: string | null = null
  if (body.bank_charge && body.bank_charge > 0 && original.student_id && source === 'school') {
    const { data: charge } = await db.from('school_fees').insert({
      fee_head_id: body.charge_head_id ?? null,
      student_id: original.student_id,
      amount: body.bank_charge,
      gross_amount: body.bank_charge,
      description: `Cheque return charge${instrument.instrument_no ? ` (${instrument.instrument_no})` : ''}`,
      due_date: today,
      created_by: userId,
    }).select('id').single()
    chargeFeeId = charge?.id ?? null
  }

  await auditFeeAction(db, {
    actorId: userId, action: 'instrument.bounced', entityType: 'fee_payment', entityId: instrument.id,
    studentId: original.student_id,
    summary: `${instrument.kind} ${instrument.instrument_no ?? ''} returned — ₹${Number(original.amount).toLocaleString('en-IN')} reversed`.trim(),
    before: { status: instrument.status },
    after: { status: 'bounced', reason: body.bounce_reason.trim(), reversal_txn: reversal.transactionId, charge_fee: chargeFeeId },
    request,
  })

  return NextResponse.json({
    success: true,
    status: 'bounced',
    reversal_txn_id: reversal.transactionId,
    fee_status: reversal.feeStatus,
    charge_fee_id: chargeFeeId,
  })
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
