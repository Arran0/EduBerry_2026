import 'server-only'
import { callBank, applyFieldMap, flatten, pickString, verifyBankSignature, type BankCredentials } from './bankClient'
import { normalizeCollectConfig, BANK_CONNECTION_DEFAULTS, type BankCollectConfig, type BankConnection } from './bankConfig'

// ============================================================
// Bank collection adapter (fee auto-reconciliation)
// ------------------------------------------------------------
// Talks to the school's OWN bank collection programme — the product Indian
// banks sell as Smart Collect / Virtual Account / eCollect / Easy Collect. All
// of them work the same way: the school gets either one VPA plus a unique
// reference per bill, or a per-bill virtual handle, and the bank calls a
// webhook when money lands.
//
// Three modes (BankCollectConfig.mode):
//   • 'reference'       — one school VPA; each fee carries a unique reference
//                         in the UPI note. No API call, so this works with a
//                         plain current account plus webhook access. Matched by
//                         reference.
//   • 'virtual_vpa'     — the bank allots a unique VPA per fee. Matched by VPA.
//   • 'virtual_account' — the bank allots a unique account number + IFSC per
//                         fee, so a parent can also pay by NEFT/IMPS from any
//                         bank. Matched by the virtual account number.
//
// The allotted handle — VPA or virtual account number — is stored in the
// payment row's `collect_vpa` column in every mode, so matching stays one
// lookup and no schema change is needed to add virtual accounts.
//
// Auth, mutual TLS and signature verification all come from the saved bank
// connection via bankClient, so a different bank is a Settings change.
// ============================================================

export interface NormalizedCollectEvent {
  /** Matches school_fees.upi_reference / bus_fees.upi_reference. */
  reference: string | null
  /** The handle paid to — VPA or virtual account number. Matches collect_vpa. */
  vpa: string | null
  /** Rupees. */
  amount: number | null
  /** Bank UTR / RRN — the settlement's unique id, used for idempotency. */
  utr: string | null
  status: 'success' | 'failed' | 'unknown'
}

/** Credentials for the bank_collect scope. */
export type CollectCredentials = BankCredentials

/**
 * Verify a collection callback's signature against the RAW body, then normalize
 * the bank's JSON into a NormalizedCollectEvent.
 *
 * `conn` is optional so the legacy Smart Collect call sites keep working; when
 * omitted the defaults (hex digest, no prefix) apply and both encodings are
 * still accepted, which is what the previous implementation did.
 */
export function verifyAndNormalizeWebhook(
  rawBody: string,
  signature: string | null,
  secret: string | undefined,
  conn?: Pick<BankConnection, 'signature_encoding' | 'signature_prefix'>,
): { ok: boolean; event?: NormalizedCollectEvent; error?: string } {
  const verified = verifyBankSignature(rawBody, signature, secret, conn ?? BANK_CONNECTION_DEFAULTS)
  if (!verified.ok) return { ok: false, error: verified.error }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return { ok: false, error: 'Callback body was not valid JSON' }
  }

  return { ok: true, event: normalizeCollectEvent(body) }
}

/** Pull the fields that matter out of a bank callback, whatever it names them. */
export function normalizeCollectEvent(body: unknown): NormalizedCollectEvent {
  const flat = flatten(body)

  const reference = pickString(flat, [
    'reference', 'referenceId', 'reference_id', 'merchantRef', 'customerRefNo',
    'note', 'remark', 'remarks', 'tn', 'billRef', 'narration', 'description',
  ])
  // Virtual account numbers and VPAs are both "the handle that was paid to".
  const vpa = pickString(flat, [
    'vpa', 'virtualVpa', 'virtual_vpa', 'payeeVpa', 'toVpa', 'collectVpa',
    'virtualAccountNumber', 'virtual_account_number', 'vanNumber', 'van',
    'creditAccountNumber', 'payeeAccount',
  ])
  const utr = pickString(flat, [
    'utr', 'rrn', 'bankRrn', 'txnId', 'transactionId', 'upiTransactionId',
    'utrNumber', 'bankReferenceNumber',
  ])
  const amountStr = pickString(flat, ['amount', 'txnAmount', 'amountPaid', 'transactionAmount', 'creditAmount'])
  const statusStr = (pickString(flat, ['status', 'txnStatus', 'transactionStatus', 'state', 'result']) ?? '').toLowerCase()

  const amount = amountStr != null ? Number(amountStr) : null
  const status: NormalizedCollectEvent['status'] =
    /success|captured|completed|credit|paid|settled/.test(statusStr) ? 'success'
    : /fail|declin|error|reject|revers/.test(statusStr) ? 'failed'
    // Some banks only ever post successful credits and omit a status field.
    : statusStr === '' ? 'success'
    : 'unknown'

  return {
    reference: reference ?? null,
    vpa: vpa ?? null,
    amount: Number.isFinite(amount as number) ? (amount as number) : null,
    utr: utr ?? null,
    status,
  }
}

// ── Allocation ───────────────────────────────────────────────

export interface CollectTarget {
  /** UPI VPA to pay, when the bank allotted one. */
  vpa?: string
  /** Virtual account number + IFSC, for NEFT/IMPS collection. */
  account_number?: string
  ifsc?: string
}

export interface AllocateInput {
  reference: string
  amount: number
  customerName?: string
  /** Rejects a credit after this date at the bank; blank leaves it open. */
  expiresOn?: string
}

/**
 * Ask the bank to allot a collection handle for one fee. Used by the
 * virtual_vpa and virtual_account modes; reference mode needs no call.
 *
 * Retried twice: allocation is idempotent on the bank side because the same
 * fee reference is sent, so a retry returns the existing handle rather than
 * creating a second one.
 */
export async function allocateCollectTarget(
  input: AllocateInput,
  rawConfig: Partial<BankCollectConfig>,
  creds: CollectCredentials,
): Promise<{ ok: boolean; target?: CollectTarget; error?: string }> {
  const config = normalizeCollectConfig(rawConfig)

  if (!config.connection.api_base_url) {
    return { ok: false, error: 'No bank API base URL is configured for collections' }
  }

  const body = applyFieldMap({
    reference: input.reference,
    amount: (Math.round(input.amount * 100) / 100).toFixed(2),
    customer_name: input.customerName ?? '',
    corporate_id: creds.corporate_id ?? '',
    expires_on: input.expiresOn ?? '',
  }, config.request_map)

  const res = await callBank(config.connection, creds, {
    path: config.allocate_path,
    method: 'POST',
    body,
    retries: 2,
  })

  if (!res.ok) {
    return { ok: false, error: res.error ?? 'The bank rejected the allocation request' }
  }

  const flat = flatten(res.json ?? {})
  const vpa = pickString(flat, ['vpa', 'virtualVpa', 'virtual_vpa', 'payeeVpa', 'collectVpa'])
  const accountNumber = pickString(flat, [
    'virtualAccountNumber', 'virtual_account_number', 'accountNumber', 'account_number', 'vanNumber', 'van',
  ])
  const ifsc = pickString(flat, ['ifsc', 'ifscCode', 'ifsc_code', 'virtualIfsc'])

  if (!vpa && !accountNumber) {
    return { ok: false, error: 'The bank did not return a UPI ID or virtual account number' }
  }
  return { ok: true, target: { vpa, account_number: accountNumber, ifsc } }
}

/**
 * Back-compat wrapper for the previous Smart Collect call shape. Kept so an
 * unmigrated deployment that still has SMART_COLLECT_BASE_URL / _API_KEY set
 * keeps allotting VPAs after this refactor.
 */
export async function createVirtualVpa(
  input: { reference: string; amount: number; customerName?: string },
  creds: { baseUrl: string | undefined; apiKey: string | undefined },
): Promise<{ ok: boolean; vpa?: string; error?: string }> {
  if (!creds.baseUrl || !creds.apiKey) {
    return { ok: false, error: 'Smart Collect (virtual VPA) is not configured' }
  }
  const res = await allocateCollectTarget(
    input,
    {
      connection: { ...BANK_CONNECTION_DEFAULTS, api_base_url: creds.baseUrl, auth_mode: 'api_key', api_key_header: 'x-api-key' },
      allocate_path: '/virtual-accounts',
    },
    { api_key: creds.apiKey },
  )
  if (!res.ok || !res.target) return { ok: false, error: res.error }
  const handle = res.target.vpa ?? res.target.account_number
  if (!handle) return { ok: false, error: 'The bank did not return a VPA' }
  return { ok: true, vpa: handle }
}
