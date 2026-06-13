import crypto from 'crypto'

// ============================================================
// Smart Collect adapter (bank / PSP UPI auto-reconciliation)
// ------------------------------------------------------------
// This is a PROVIDER-AGNOSTIC SHELL. It implements the parts that are the
// same across providers (HMAC webhook verification, field normalization,
// an optional "allocate a virtual VPA" call) and isolates the few
// provider-specific bits behind clearly marked mapping points.
//
// Two supported models (chosen via site_settings.smart_collect_config.mode):
//   • 'reference'   — one merchant VPA; each fee carries a unique reference
//                     (bus_fees.upi_reference) in the UPI note. The bank/PSP
//                     posts a webhook on receipt; we match by reference.
//                     No create call is needed. (This is the PayNow/NTU model.)
//   • 'virtual_vpa' — the provider allots a unique VPA per fee via an API
//                     call; we match the webhook by that VPA. More robust when
//                     the UPI note can't be relied on.
//
// Required env:
//   SMART_COLLECT_WEBHOOK_SECRET   — HMAC secret to verify incoming webhooks
// Required env for 'virtual_vpa' mode only:
//   SMART_COLLECT_BASE_URL         — provider API base
//   SMART_COLLECT_API_KEY          — provider API key (sent as a header)
// ============================================================

export interface NormalizedCollectEvent {
  reference: string | null   // matches bus_fees.upi_reference / bus_payments.provider_ref
  vpa: string | null         // the virtual VPA paid to (vpa mode)
  amount: number | null      // rupees
  utr: string | null         // bank UTR / RRN — the settlement's unique id
  status: 'success' | 'failed' | 'unknown'
}

export function smartCollectWebhookConfigured(): boolean {
  return !!process.env.SMART_COLLECT_WEBHOOK_SECRET
}

/**
 * Verify a webhook's HMAC-SHA256 signature over the RAW body, then normalize
 * the (provider-specific) JSON into a NormalizedCollectEvent.
 *
 * PROVIDER MAPPING POINT: adjust the signature header name and the field
 * extraction below to match your bank/PSP's webhook contract.
 */
export function verifyAndNormalizeWebhook(
  rawBody: string,
  signature: string | null,
): { ok: boolean; event?: NormalizedCollectEvent; error?: string } {
  const secret = process.env.SMART_COLLECT_WEBHOOK_SECRET
  if (!secret) return { ok: false, error: 'SMART_COLLECT_WEBHOOK_SECRET not set' }
  if (!signature) return { ok: false, error: 'Missing signature' }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  // Some providers send base64 — accept either by comparing both encodings.
  const expectedB64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
  if (!timingEqual(signature, expected) && !timingEqual(signature, expectedB64)) {
    return { ok: false, error: 'Invalid signature' }
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return { ok: false, error: 'Invalid JSON' }
  }

  // PROVIDER MAPPING POINT — pluck the common fields, trying several key names
  // so most providers work out of the box. Tighten to your provider's exact
  // schema once known.
  const flat = flatten(body)
  const reference = pick(flat, ['reference', 'referenceId', 'reference_id', 'merchantRef', 'note', 'remark', 'tn', 'billRef'])
  const vpa = pick(flat, ['vpa', 'virtualVpa', 'virtual_vpa', 'payeeVpa', 'toVpa', 'collectVpa'])
  const utr = pick(flat, ['utr', 'rrn', 'bankRrn', 'txnId', 'transactionId', 'upiTransactionId'])
  const amountStr = pick(flat, ['amount', 'txnAmount', 'amountPaid', 'transactionAmount'])
  const statusStr = (pick(flat, ['status', 'txnStatus', 'transactionStatus', 'state']) ?? '').toLowerCase()

  const amount = amountStr != null ? Number(amountStr) : null
  const status: NormalizedCollectEvent['status'] =
    /success|captured|completed|credit|paid|settled/.test(statusStr) ? 'success'
    : /fail|declin|error|reject/.test(statusStr) ? 'failed'
    : statusStr === '' ? 'success' /* some providers only post successes */ : 'unknown'

  return {
    ok: true,
    event: {
      reference: reference ?? null,
      vpa: vpa ?? null,
      amount: Number.isFinite(amount as number) ? (amount as number) : null,
      utr: utr ?? null,
      status,
    },
  }
}

/**
 * Allocate a per-fee virtual VPA (only used in 'virtual_vpa' mode).
 *
 * PROVIDER MAPPING POINT: replace the request/response mapping with your
 * provider's "create virtual account / collect" endpoint.
 */
export async function createVirtualVpa(input: {
  reference: string
  amount: number
  customerName?: string
}): Promise<{ ok: boolean; vpa?: string; error?: string }> {
  const baseUrl = process.env.SMART_COLLECT_BASE_URL
  const apiKey = process.env.SMART_COLLECT_API_KEY
  if (!baseUrl || !apiKey) {
    return { ok: false, error: 'Smart Collect (virtual VPA) is not configured on the server' }
  }
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/virtual-accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        reference: input.reference,
        amount: input.amount,
        customer_name: input.customerName,
      }),
    })
    const json = (await res.json()) as Record<string, unknown>
    if (!res.ok) return { ok: false, error: (json?.message as string) ?? 'Provider error' }
    const flat = flatten(json)
    const vpa = pick(flat, ['vpa', 'virtualVpa', 'virtual_vpa', 'payeeVpa'])
    if (!vpa) return { ok: false, error: 'Provider did not return a VPA' }
    return { ok: true, vpa }
  } catch (e) {
    console.error('createVirtualVpa failed:', e)
    return { ok: false, error: 'Could not reach the payment provider' }
  }
}

// ── helpers ──────────────────────────────────────────────────

function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** Flatten a nested object to a single level (last key wins) for easy lookup. */
function flatten(obj: unknown, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, out)
      else out[k] = v
    }
  }
  return out
}

function pick(flat: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = flat[k]
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  return undefined
}
