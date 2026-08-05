import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Server-only reader for the admin-configured payment_secrets store.
//
// In a multi-tenant deployment each school configures its own credentials from
// the in-app settings screens (stored in payment_secrets). Server routes read
// them here via the service-role client (which bypasses RLS) and fall back to
// process.env so single-tenant / self-hosted deployments that set env vars keep
// working. A DB value always takes precedence over the env fallback, and a
// blank DB value means "unset" — the env var shows through.

export type PaymentSecretScope = 'razorpay' | 'smart_collect' | 'payout' | 'bank_collect'

/** Map each scope's fields to the env var that backs them when the DB is blank. */
const ENV_FALLBACK: Record<PaymentSecretScope, Record<string, string | undefined>> = {
  razorpay: {
    key_secret: process.env.RAZORPAY_KEY_SECRET,
    webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },
  smart_collect: {
    base_url: process.env.SMART_COLLECT_BASE_URL,
    api_key: process.env.SMART_COLLECT_API_KEY,
    webhook_secret: process.env.SMART_COLLECT_WEBHOOK_SECRET,
  },
  // Direct bank collection (virtual accounts / virtual VPAs).
  bank_collect: {
    api_key: process.env.BANK_COLLECT_API_KEY,
    client_id: process.env.BANK_COLLECT_CLIENT_ID,
    client_secret: process.env.BANK_COLLECT_CLIENT_SECRET,
    oauth_audience: process.env.BANK_COLLECT_OAUTH_AUDIENCE,
    signing_secret: process.env.BANK_COLLECT_SIGNING_SECRET,
    // Falls back to the legacy Smart Collect secret so an existing deployment
    // keeps verifying callbacks after switching to a direct bank connection.
    webhook_secret: process.env.BANK_COLLECT_WEBHOOK_SECRET ?? process.env.SMART_COLLECT_WEBHOOK_SECRET,
    client_cert_pem: process.env.BANK_COLLECT_CLIENT_CERT_PEM,
    client_key_pem: process.env.BANK_COLLECT_CLIENT_KEY_PEM,
    client_cert_passphrase: process.env.BANK_COLLECT_CLIENT_CERT_PASSPHRASE,
    corporate_id: process.env.BANK_COLLECT_CORPORATE_ID,
  },
  // Direct bank payouts (bulk NEFT/RTGS/IMPS).
  payout: {
    api_key: process.env.BANK_PAYOUT_API_KEY,
    client_id: process.env.BANK_PAYOUT_CLIENT_ID,
    client_secret: process.env.BANK_PAYOUT_CLIENT_SECRET,
    oauth_audience: process.env.BANK_PAYOUT_OAUTH_AUDIENCE,
    signing_secret: process.env.BANK_PAYOUT_SIGNING_SECRET,
    client_cert_pem: process.env.BANK_PAYOUT_CLIENT_CERT_PEM,
    client_key_pem: process.env.BANK_PAYOUT_CLIENT_KEY_PEM,
    client_cert_passphrase: process.env.BANK_PAYOUT_CLIENT_CERT_PASSPHRASE,
    corporate_id: process.env.BANK_PAYOUT_CORPORATE_ID,
    account_number: process.env.BANK_PAYOUT_ACCOUNT_NUMBER ?? process.env.RAZORPAYX_ACCOUNT_NUMBER,
    account_ifsc: process.env.BANK_PAYOUT_ACCOUNT_IFSC,
    webhook_secret: process.env.PAYOUT_WEBHOOK_SECRET,
    // Legacy aggregator secret — still read so an unmigrated deployment works.
    key_secret: process.env.RAZORPAYX_KEY_SECRET ?? process.env.CASHFREE_KEY_SECRET,
  },
}

/**
 * Resolve the secrets for a scope: DB row (admin-configured) overlaid on the
 * env fallback. Returns a plain object of string fields (missing → undefined).
 */
export async function getPaymentSecrets(
  admin: SupabaseClient,
  scope: PaymentSecretScope,
): Promise<Record<string, string | undefined>> {
  const fallback = { ...ENV_FALLBACK[scope] }
  const { data } = await admin.from('payment_secrets').select('value').eq('key', scope).maybeSingle()
  const stored = (data?.value as Record<string, string> | null) ?? {}
  const out: Record<string, string | undefined> = { ...fallback }
  for (const [k, v] of Object.entries(stored)) {
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim()
  }
  return out
}
