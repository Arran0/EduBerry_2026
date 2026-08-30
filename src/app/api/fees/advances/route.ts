import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/fees/serverGuard'
import { appendLedgerEntry } from '@/lib/fees/ledger'
import { auditFeeAction } from '@/lib/fees/audit'

// Advance payments and family credit balances.
//
// A parent who pays before the term's demand exists, or who overpays, holds a
// credit. It sits at the FAMILY level, not the student's, because that is what
// a parent means: "put it towards next term" does not specify a child, and a
// family with two children should not have to guess which one to lodge it
// against.
//
// The balance is never stored. It is the sum of unapplied family-level ledger
// rows (public.fee_credit_balance). A stored balance that disagrees with the
// ledger is a reconciliation problem nobody wins, and it will disagree
// eventually.
//
// Applying a credit is two ledger rows written together by apply_fee_credit():
// the credit is spent (debit, no fee) and the fee is paid (credit, with fee).
// Both share an idempotency stem, so a retry cannot spend it twice.

export const runtime = 'nodejs'

interface RecordBody {
  family_id?: string
  amount?: number
  method?: string
  reference?: string
  note?: string
  request_id?: string
  received_at?: string
}

interface ApplyBody {
  family_id?: string
  fee_id?: string
  source?: 'school' | 'bus'
  amount?: number
  request_id?: string
}

/** Take money that has no demand to sit against yet. */
export async function POST(request: NextRequest) {
  const guard = await requireCapability(request, 'record_payment')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  let body: RecordBody
  try { body = await request.json() } catch { return bad('Invalid request body') }

  if (!body.family_id) return bad('family_id is required — an advance belongs to a family, not a fee')
  if (!body.request_id) return bad('request_id is required so a retry cannot credit twice')

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) return bad('An advance must be a positive amount.')

  const { data: family } = await db
    .from('fee_families').select('id, name').eq('id', body.family_id).maybeSingle()
  if (!family) return NextResponse.json({ success: false, error: 'Family not found' }, { status: 404 })

  const write = await appendLedgerEntry(db, {
    kind: 'advance',
    direction: 'credit',
    amount,
    source: 'school',
    // No fee: that is what makes it an advance rather than a payment.
    feeId: null,
    familyId: body.family_id,
    method: body.method ?? 'cash',
    utr: body.reference ?? null,
    idempotencyKey: `advance:${body.request_id}`,
    actorId: userId,
    note: body.note ?? 'Advance payment',
    occurredAt: body.received_at,
  })

  if (!write.ok) {
    return NextResponse.json({ success: false, error: write.error ?? 'Could not record the advance.' }, { status: 400 })
  }

  await auditFeeAction(db, {
    actorId: userId, action: 'advance.record', entityType: 'fee_transaction', entityId: write.transactionId ?? null,
    summary: `Recorded a ₹${amount.toLocaleString('en-IN')} advance for ${family.name}`,
    after: { amount, family_id: body.family_id, method: body.method ?? 'cash' },
    request,
  })

  const balance = await creditBalance(db, body.family_id)
  return NextResponse.json({
    success: true,
    transaction_id: write.transactionId,
    duplicate: write.duplicate ?? false,
    balance,
  })
}

/** Spend a family's credit against a specific fee. */
export async function PUT(request: NextRequest) {
  const guard = await requireCapability(request, 'record_payment')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  let body: ApplyBody
  try { body = await request.json() } catch { return bad('Invalid request body') }

  if (!body.family_id || !body.fee_id) return bad('family_id and fee_id are both required')
  if (!body.request_id) return bad('request_id is required so a retry cannot apply the credit twice')

  const source = body.source === 'bus' ? 'bus' : 'school'
  const available = await creditBalance(db, body.family_id)
  const amount = body.amount === undefined ? available : Number(body.amount)

  if (!Number.isFinite(amount) || amount <= 0) return bad('There is no credit to apply.')
  if (amount > available) {
    return bad(`This family holds ₹${available.toLocaleString('en-IN')} in credit; ₹${amount.toLocaleString('en-IN')} was requested.`)
  }

  // The two ledger rows are written together by the function, so a crash
  // between them cannot leave a credit spent with no fee paid.
  const { error } = await db.rpc('apply_fee_credit', {
    p_family: body.family_id,
    p_fee: body.fee_id,
    p_source: source,
    p_amount: amount,
    p_actor: userId,
    p_key: `credit:${body.request_id}`,
  })

  if (error) {
    // A duplicate key means this exact application already happened.
    if (error.code === '23505') {
      return NextResponse.json({ success: true, duplicate: true, balance: await creditBalance(db, body.family_id) })
    }
    console.error('advances/apply failed', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 400 })
  }

  await auditFeeAction(db, {
    actorId: userId, action: 'advance.apply', entityType: 'fee_transaction', entityId: body.fee_id,
    summary: `Applied ₹${amount.toLocaleString('en-IN')} of family credit to a fee`,
    after: { amount, fee_id: body.fee_id, family_id: body.family_id },
    request,
  })

  return NextResponse.json({ success: true, applied: amount, balance: await creditBalance(db, body.family_id) })
}

/** What a family currently holds. */
export async function GET(request: NextRequest) {
  const guard = await requireCapability(request, 'view_reports')
  if (!guard.ok) return guard.response
  const { db } = guard.actor

  const familyId = new URL(request.url).searchParams.get('family_id')
  if (familyId) {
    return NextResponse.json({ success: true, balance: await creditBalance(db, familyId) })
  }

  const { data, error } = await db
    .from('fee_credit_balance').select('family_id, balance').gt('balance', 0).limit(1000)
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, balances: data ?? [] })
}

async function creditBalance(
  db: Parameters<typeof appendLedgerEntry>[0],
  familyId: string,
): Promise<number> {
  const { data } = await db
    .from('fee_credit_balance').select('balance').eq('family_id', familyId).maybeSingle()
  return Number(data?.balance) || 0
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
