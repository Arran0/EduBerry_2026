// Server-only payout provider abstraction.
//
// The app NEVER moves money directly from the school's bank account. Instead it
// calls a payout provider that exposes a Bulk Bank Transfer / Payouts API
// (e.g. RazorpayX, Cashfree Payouts, Decentro), which the school has authorized
// against its own payout account. This module isolates that integration so the
// UI and data layers never touch provider details or secrets.
//
// Secrets (API key secret, account number) come from server env vars, never
// from the client or site_settings. Keep all imports of this file server-side
// (API routes only).

import 'server-only'

export interface PayoutBankDetails {
  account_holder_name: string
  account_number: string
  ifsc: string
  bank_name: string | null
  payout_fund_account_id: string | null
}

export interface PayoutRequest {
  /** Our salary_records.id — used as the idempotency reference with the provider. */
  reference: string
  /** Amount in rupees (net pay). */
  amount: number
  bank: PayoutBankDetails
  /** Human-readable narration, e.g. "Salary June 2026 — Jane Doe". */
  note: string
}

export interface PayoutResult {
  reference: string
  success: boolean
  /** Provider-side payout id, when the transfer was accepted. */
  payoutId?: string
  /** 'initiated' on accept; 'failed' otherwise. */
  status: 'initiated' | 'failed'
  error?: string
}

export interface PayoutProviderConfig {
  enabled: boolean
  provider: 'manual' | 'razorpayx' | 'cashfree'
  key_id: string
  // Secrets resolved per-tenant from payment_secrets (with env fallback) by the
  // calling route. Never sourced from the client or site_settings.
  key_secret?: string
  account_number?: string
}

export interface PayoutProvider {
  readonly name: string
  /** Push a batch of transfers. Implementations should be resilient per-item. */
  createBulkPayout(requests: PayoutRequest[]): Promise<PayoutResult[]>
}

// ── Manual provider ──────────────────────────────────────────
// No external transfer. Used when payouts are not configured: the admin records
// disbursement manually (mark records paid) and pays out via their bank portal,
// optionally using an exported transfer file. We still return success so the
// caller can flow uniformly; records are NOT auto-marked initiated for manual.

const manualProvider: PayoutProvider = {
  name: 'manual',
  async createBulkPayout(requests) {
    return requests.map(r => ({
      reference: r.reference,
      success: true,
      status: 'initiated' as const,
    }))
  },
}

// ── RazorpayX provider (stub) ────────────────────────────────
// Phase-3 integration point. The real implementation will:
//   1. Ensure a contact + fund_account exists for each staff bank account
//      (persist the id back onto staff_bank_accounts.payout_fund_account_id).
//   2. POST /v1/payouts per request (or a batch) with the school's account number,
//      mode IMPS/NEFT, amount in paise, and `reference` as the idempotency key.
//   3. Return the provider payout id; reconcile final status via the webhook.
// Credentials come from `config` (key_id + key_secret + account_number), which
// the route resolved per-tenant from payment_secrets with env fallback.

function makeRazorpayXProvider(config: PayoutProviderConfig): PayoutProvider {
  return {
    name: 'razorpayx',
    async createBulkPayout(requests) {
      const hasCreds = !!config.key_secret && !!config.account_number
      if (!hasCreds) {
        return requests.map(r => ({
          reference: r.reference,
          success: false,
          status: 'failed' as const,
          error: 'RazorpayX is not fully configured — add the Key Secret and payout Account Number in Payout Settings.',
        }))
      }
      // TODO(phase-3): real RazorpayX Payouts API calls. Until then, fail closed
      // so money is never assumed to have moved.
      return requests.map(r => ({
        reference: r.reference,
        success: false,
        status: 'failed' as const,
        error: 'RazorpayX payout integration is not implemented yet.',
      }))
    },
  }
}

// ── Cashfree provider (stub) ─────────────────────────────────
function makeCashfreeProvider(_config: PayoutProviderConfig): PayoutProvider {
  return {
    name: 'cashfree',
    async createBulkPayout(requests) {
      return requests.map(r => ({
        reference: r.reference,
        success: false,
        status: 'failed' as const,
        error: 'Cashfree Payouts integration is not implemented yet.',
      }))
    },
  }
}

/** Select a provider implementation from the saved payout config. */
export function getPayoutProvider(config: PayoutProviderConfig): PayoutProvider {
  if (!config.enabled) return manualProvider
  switch (config.provider) {
    case 'razorpayx': return makeRazorpayXProvider(config)
    case 'cashfree':  return makeCashfreeProvider(config)
    default:          return manualProvider
  }
}
