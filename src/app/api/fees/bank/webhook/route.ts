import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyCollectCallback } from '@/lib/collectSetup'
import { serviceClient } from '@/lib/fees/serverGuard'
import { appendLedgerEntry, type FeeSource } from '@/lib/fees/ledger'

// Bank credit reconciliation for SCHOOL fees. Replaces /api/fees/upi/webhook.
//
// ── What changed, and why this route survived ────────────────────────────────
// The route it replaces did two jobs: it reconciled bank credits, and it was
// half of a payment-initiation flow (/api/fees/upi/create-collect) that has
// been removed. Parent-initiated payment is now Razorpay UPI Intent/QR, which
// gives a gateway-side record of every attempt.
//
// This half stays because it covers something Razorpay genuinely cannot see: a
// parent who transfers straight to the school's bank account by NEFT, IMPS or
// UPI to a virtual account. That is ordinary in Indian schools and would
// otherwise be reconciled by hand from a bank statement. Note that this is a
// PUSH flow — the parent sends money and the bank tells us — not NPCI UPI
// Collect, which is a pull request into the payer's app and is not used here.
//
// Reconciliation only: this route matches money that has already arrived to a
// fee. It never creates a payment intent and never asks a bank for a handle.
//
// Point your bank's payment-received webhook at POST /api/fees/bank/webhook.
// The signature header, digest encoding and any prefix all come from the saved
// bank connection, so a different bank is a Settings change and not a deploy.
//
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, plus the
// bank connection's signing secret (payment_secrets → bank_collect).

export const runtime = 'nodejs'

const SOURCE: FeeSource = 'school'
const FEE_TABLE = 'school_fees'
const STUDENT_COL = 'student_id'
/** School references are minted as SCHFEE-…; bus ones as BUSFEE-…. */
const REFERENCE_PREFIX = 'SCHFEE-'

export async function POST(request: NextRequest) {
  return handleBankCredit(request, {
    source: SOURCE, feeTable: FEE_TABLE, studentCol: STUDENT_COL, prefix: REFERENCE_PREFIX,
  })
}

export interface BankRouteConfig {
  source: FeeSource
  feeTable: string
  studentCol: string
  prefix: string
}

export async function handleBankCredit(request: NextRequest, cfg: BankRouteConfig) {
  const svc = serviceClient()
  if (!svc.ok) return svc.response
  const { db } = svc

  const verified = await verifyCollectCallback(db, request)
  if (!verified.ok || !verified.event) {
    return NextResponse.json(
      { ok: false, error: verified.error ?? 'Verification failed' },
      { status: verified.status ?? 400 },
    )
  }

  const ev = verified.event

  // Record the credit before acting on it, for the same reason the Razorpay
  // route does: an event we cannot match is worth keeping so it can be
  // replayed, and an event we can match must not be processed twice.
  const eventId = ev.utr
    ? `utr:${ev.utr}`
    : ev.reference
      ? `ref:${ev.reference}:${ev.amount ?? 0}`
      : null

  if (!eventId) {
    return NextResponse.json({ ok: true, ignored: 'no UTR or reference to key on' })
  }

  const { data: eventRow, error: evErr } = await db
    .from('fee_webhook_events')
    .insert({
      provider: 'bank',
      event_id: eventId,
      event_type: ev.status,
      signature_verified: true,
      payload: ev as unknown as Record<string, unknown>,
    })
    .select('id')
    .single()

  if (evErr) {
    if (evErr.code === '23505') return NextResponse.json({ ok: true, already: true })
    console.error('bank webhook: could not record event', evErr)
    return NextResponse.json({ ok: false, error: 'Could not record event' }, { status: 500 })
  }

  const finish = async (result: Record<string, unknown>) => {
    await db.from('fee_webhook_events')
      .update({ processed_at: new Date().toISOString(), result })
      .eq('id', eventRow.id)
    return NextResponse.json({ ok: true, ...result })
  }

  if (ev.status === 'failed') return finish({ ignored: 'failed payment' })
  if (!ev.reference && !ev.vpa) return finish({ ignored: 'no reference or vpa' })

  // A reference that is plainly the other module's is not ours to match. 200,
  // because the other route will handle it.
  if (ev.reference && !ev.reference.startsWith(cfg.prefix)) {
    return finish({ ignored: 'reference belongs to another module' })
  }

  const feeId = await matchFee(db, cfg, ev.reference, ev.vpa)
  if (!feeId) return finish({ ignored: 'no matching fee' })

  // The column name is chosen by the caller, not by user input, so a template
  // string is safe here — but it defeats the client's generated column types,
  // hence the cast.
  const { data: feeRaw } = await db
    .from(cfg.feeTable).select(`id, amount, ${cfg.studentCol}`).eq('id', feeId).maybeSingle()
  const fee = feeRaw as Record<string, unknown> | null
  if (!fee) return finish({ ignored: 'fee disappeared' })

  // Credit what the bank says arrived. Falling back to the billed amount would
  // over-credit a part payment, which is the bug this rewrite exists to fix.
  const amount = ev.amount ?? null
  if (amount === null || amount <= 0) {
    return finish({ ignored: 'bank reported no amount', fee_id: feeId })
  }

  const write = await appendLedgerEntry(db, {
    kind: 'payment',
    direction: 'credit',
    amount,
    source: cfg.source,
    feeId,
    studentId: fee[cfg.studentCol] as string,
    method: 'bank_transfer',
    gateway: 'bank',
    utr: ev.utr,
    idempotencyKey: `bank:${eventId}`,
    webhookEventId: eventRow.id,
    note: ev.vpa ? `Credited to ${ev.vpa}` : 'Direct bank credit',
  })

  if (!write.ok) return finish({ error: write.error, fee_id: feeId })

  // Close any pending attempt row this credit satisfies, so the office does not
  // see a stale "awaiting payment" line.
  const attemptTable = cfg.source === 'school' ? 'school_fee_payments' : 'bus_payments'
  if (ev.reference) {
    await db.from(attemptTable).update({
      status: 'verified',
      utr: ev.utr,
      collect_vpa: ev.vpa,
      verified_at: new Date().toISOString(),
      ledger_txn_id: write.transactionId ?? null,
    }).eq('provider_ref', ev.reference).eq('status', 'pending')
  }

  return finish({
    fee_id: feeId,
    amount,
    fee_status: write.feeStatus,
    duplicate: write.duplicate ?? false,
  })
}

/**
 * Resolve the fee this credit belongs to. The unique reference embedded in the
 * UPI note or narration is the primary key; a per-fee virtual VPA or virtual
 * account number is the fallback for banks that allot one.
 */
async function matchFee(
  db: SupabaseClient,
  cfg: BankRouteConfig,
  reference: string | null,
  vpa: string | null,
): Promise<string | null> {
  if (reference) {
    const { data } = await db.from(cfg.feeTable).select('id').eq('upi_reference', reference).maybeSingle()
    if (data) return data.id as string
  }
  if (vpa) {
    const attemptTable = cfg.source === 'school' ? 'school_fee_payments' : 'bus_payments'
    const { data } = await db
      .from(attemptTable).select('fee_id').eq('collect_vpa', vpa).eq('status', 'pending').maybeSingle()
    if (data) return data.fee_id as string
  }
  return null
}
