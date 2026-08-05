import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { verifyBankSignature, flatten, pickString } from './bankClient'
import { normalizePayoutConfig, type PayoutConfig } from './bankConfig'
import { getPaymentSecrets } from './serverSecrets'

// Shared verification + mapping for the bank's payout-status callback. Staff
// salary and driver payroll both credit staff from the same corporate account
// under the same bank arrangement, so they share one webhook contract and only
// differ in which table the reference resolves against.
//
// The signature header, digest encoding and any prefix all come from the saved
// bank connection, so a bank that signs as `X-IB-Signature: sha256=<base64>` is
// a settings change rather than a code change.

export type PayoutOutcome = 'processed' | 'failed' | 'ignore'

export interface MappedPayoutEvent {
  reference?: string
  outcome: PayoutOutcome
  payoutId?: string
  utr?: string
}

/** Status words Indian bank callbacks use for a credit that actually landed. */
const SETTLED = /^(processed|success|successful|completed|credited|settled|paid|executed|accepted)$/i
const REJECTED = /^(failed|failure|reversed|rejected|returned|cancelled|declined|error)$/i

/**
 * Map a bank callback to a reference + outcome, trying the field names banks
 * actually use. Anything unrecognised maps to 'ignore' so an informational
 * callback (queued, in-process) never flips a record prematurely.
 */
export function mapPayoutEvent(raw: unknown): MappedPayoutEvent {
  const flat = flatten(raw)

  const reference = pickString(flat, [
    'reference_id', 'referenceId', 'reference', 'refNo', 'referenceNumber',
    'merchantRef', 'customerRefNo', 'txnRef', 'uniqueId', 'corpRefNo',
  ])
  const payoutId = pickString(flat, [
    'payoutId', 'payout_id', 'transactionId', 'txnId', 'bankRefNo',
    'bankReferenceNumber', 'utr', 'utrNumber', 'rrn', 'id',
  ])
  const utr = pickString(flat, ['utr', 'utrNumber', 'rrn', 'bankRrn'])
  const statusStr = (pickString(flat, [
    'status', 'txnStatus', 'transactionStatus', 'payoutStatus', 'state', 'statusCode', 'result',
  ]) ?? '').trim()

  if (SETTLED.test(statusStr)) return { reference, outcome: 'processed', payoutId, utr }
  if (REJECTED.test(statusStr)) return { reference, outcome: 'failed', payoutId, utr }
  return { reference, outcome: 'ignore', payoutId, utr }
}

export interface VerifiedPayout {
  ok: boolean
  /** HTTP status to reply with when ok is false. */
  status?: number
  error?: string
  event?: MappedPayoutEvent
}

/**
 * Read the raw body, verify it against the configured bank connection, and map
 * it. Returns the parsed event or the error the route should reply with.
 */
export async function verifyPayoutCallback(
  admin: SupabaseClient,
  request: NextRequest,
): Promise<VerifiedPayout> {
  const [{ data: cfgRow }, secrets] = await Promise.all([
    admin.from('site_settings').select('value').eq('key', 'payout_config').maybeSingle(),
    getPaymentSecrets(admin, 'payout'),
  ])
  const config = normalizePayoutConfig(cfgRow?.value as Partial<PayoutConfig> | null)
  const conn = config.connection

  const webhookSecret = secrets.webhook_secret
  if (!webhookSecret) {
    return { ok: false, status: 500, error: 'No payout webhook secret is configured' }
  }

  const rawBody = await request.text()

  // The configured header first, then the names banks and aggregators commonly
  // use — so a callback still verifies before the admin has tuned the setting.
  const signature =
    request.headers.get(conn.signature_header || 'x-signature') ??
    request.headers.get('x-webhook-signature') ??
    request.headers.get('x-bank-signature') ??
    request.headers.get('signature') ??
    request.headers.get('x-razorpay-signature')

  const verified = verifyBankSignature(rawBody, signature, webhookSecret, conn)
  if (!verified.ok) {
    return { ok: false, status: 400, error: verified.error ?? 'Signature verification failed' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return { ok: false, status: 400, error: 'Callback body was not valid JSON' }
  }

  return { ok: true, event: mapPayoutEvent(parsed) }
}
