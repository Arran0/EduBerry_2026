import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// Writing to the ledger.
// ----------------------------------------------------------------------------
// The only module that inserts into fee_transactions. Every money-in and
// money-out path — the gateway webhook, the bank webhook, an office receipt, a
// refund — comes through here, so the idempotency key, the fee-status recompute
// and the audit entry cannot be forgotten by one caller and remembered by
// another. That divergence is exactly how the current module ended up with six
// write paths and only one of them doing the partial-payment arithmetic right.
//
// Server-only, service-role. A browser session with the anon key must never be
// the thing that records that money arrived; RLS can say who may write but not
// what a valid state transition is.
// ============================================================================

export type FeeSource = 'school' | 'bus'

export type LedgerKind =
  | 'payment' | 'refund' | 'adjustment' | 'write_off'
  | 'advance' | 'carry_forward' | 'reversal'

export interface LedgerEntryInput {
  kind: LedgerKind
  direction: 'credit' | 'debit'
  amount: number
  source: FeeSource
  feeId?: string | null
  studentId?: string | null
  familyId?: string | null
  payerId?: string | null
  method?: string | null
  gateway?: string | null
  gatewayOrderId?: string | null
  gatewayPaymentId?: string | null
  gatewayRefundId?: string | null
  utr?: string | null
  /**
   * Must be derived from stable facts — a provider event id, an attempt id —
   * never from a clock or a random value. A random key is not an idempotency
   * key; it is a guarantee of double-crediting on the first retry.
   */
  idempotencyKey: string
  attemptId?: string | null
  attemptTable?: 'school_fee_payments' | 'bus_payments' | null
  webhookEventId?: string | null
  reversesTxnId?: string | null
  actorId?: string | null
  note?: string | null
  meta?: Record<string, unknown> | null
  occurredAt?: string
}

export interface LedgerWriteResult {
  ok: boolean
  /** The ledger row id, whether it was written now or already existed. */
  transactionId?: string
  /** True when this exact entry was already on the ledger — a duplicate delivery. */
  duplicate?: boolean
  /** The fee's status after the ledger was applied to it. */
  feeStatus?: string | null
  error?: string
}

// Postgres unique-violation. The one error here that is not a failure.
const UNIQUE_VIOLATION = '23505'

/**
 * Append one entry and recompute the affected fee's status from the ledger.
 *
 * A duplicate idempotency key is a success, not an error: it means the same
 * money event reached us twice, which is normal for any webhook that retries.
 * The caller gets `duplicate: true` so it can answer 200 without pretending
 * anything new happened.
 */
export async function appendLedgerEntry(
  db: SupabaseClient,
  entry: LedgerEntryInput,
): Promise<LedgerWriteResult> {
  if (!(entry.amount > 0)) {
    return { ok: false, error: 'A ledger entry must carry a positive amount.' }
  }

  const row = {
    kind: entry.kind,
    direction: entry.direction,
    amount: entry.amount,
    source: entry.source,
    fee_id: entry.feeId ?? null,
    student_id: entry.studentId ?? null,
    family_id: entry.familyId ?? null,
    payer_id: entry.payerId ?? null,
    method: entry.method ?? null,
    gateway: entry.gateway ?? null,
    gateway_order_id: entry.gatewayOrderId ?? null,
    gateway_payment_id: entry.gatewayPaymentId ?? null,
    gateway_refund_id: entry.gatewayRefundId ?? null,
    utr: entry.utr ?? null,
    idempotency_key: entry.idempotencyKey,
    attempt_id: entry.attemptId ?? null,
    attempt_table: entry.attemptTable ?? null,
    webhook_event_id: entry.webhookEventId ?? null,
    reverses_txn_id: entry.reversesTxnId ?? null,
    actor_id: entry.actorId ?? null,
    note: entry.note ?? null,
    meta: entry.meta ?? null,
    occurred_at: entry.occurredAt ?? new Date().toISOString(),
  }

  const { data, error } = await db.from('fee_transactions').insert(row).select('id').single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: existing } = await db
        .from('fee_transactions').select('id').eq('idempotency_key', entry.idempotencyKey).maybeSingle()
      // Still recompute: an earlier attempt may have inserted the row and then
      // failed before applying it.
      const feeStatus = entry.feeId ? await applyLedgerToFee(db, entry.source, entry.feeId) : null
      return { ok: true, duplicate: true, transactionId: existing?.id, feeStatus }
    }
    console.error('appendLedgerEntry failed:', error)
    return { ok: false, error: error.message }
  }

  const feeStatus = entry.feeId ? await applyLedgerToFee(db, entry.source, entry.feeId) : null
  return { ok: true, transactionId: data.id, feeStatus }
}

/**
 * Recompute a fee's status from the ledger. This is the single definition of
 * unpaid / partial / paid, and it lives in the database (see
 * apply_ledger_to_school_fee in fees_v2_ledger.sql) so a direct SQL correction
 * gets the same answer the app does.
 */
export async function applyLedgerToFee(
  db: SupabaseClient,
  source: FeeSource,
  feeId: string,
): Promise<string | null> {
  const fn = source === 'school' ? 'apply_ledger_to_school_fee' : 'apply_ledger_to_bus_fee'
  const { data, error } = await db.rpc(fn, { p_fee: feeId })
  if (error) { console.error(`${fn} failed:`, error); return null }
  return (data as string | null) ?? null
}

/** What has been paid against a fee, net of refunds. */
export async function feePaidAmount(
  db: SupabaseClient,
  source: FeeSource,
  feeId: string,
): Promise<number> {
  const { data, error } = await db.rpc('fee_paid_amount', { p_source: source, p_fee: feeId })
  if (error) { console.error('fee_paid_amount failed:', error); return 0 }
  return Number(data) || 0
}

/**
 * What a fee still needs. Used by every initiation path so a parent is never
 * asked for money they have already sent.
 */
export async function outstandingFor(
  db: SupabaseClient,
  source: FeeSource,
  feeId: string,
): Promise<{ billed: number; paid: number; outstanding: number } | null> {
  const table = source === 'school' ? 'school_fees' : 'bus_fees'
  const { data: fee } = await db.from(table).select('amount').eq('id', feeId).maybeSingle()
  if (!fee) return null
  const billed = Number(fee.amount) || 0
  const paid = await feePaidAmount(db, source, feeId)
  return { billed, paid, outstanding: Math.max(0, round2(billed - paid)) }
}

/** Local copy of the engine's rounding so this server-only module stays leaf. */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  const s = n < 0 ? -1 : 1
  return (s * Math.round(Math.abs(n) * 100 + Number.EPSILON * 100)) / 100
}
