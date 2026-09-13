import { supabase } from './supabase'

// Client-side helpers for the admin-only payment_secrets store. These let a
// school admin configure their own bank / gateway credentials from the settings
// screens (multi-tenant) instead of server env vars.
//
// The payment_secrets table has NO public read policy, so only an admin (or the
// server's service role) can read it — see add_payment_secrets.sql. Secret
// fields are rendered as password inputs in the settings forms; the server
// reads the same rows via the service role and falls back to env vars.
//
// Every credential a bank issues belongs here rather than in site_settings,
// which is world-readable. That includes things that look mundane but are not
// safe to publish: the debit account number, the corporate ID, and the client
// TLS certificate.

export type PaymentSecretScope = 'razorpay' | 'smart_collect' | 'payout' | 'bank_collect'

/**
 * Credentials shared by every bank connection, whatever the capability. Which
 * subset is required depends on the connection's auth_mode:
 *
 *   api_key → api_key            basic  → client_id + client_secret
 *   oauth2  → client_id + client_secret + (oauth_audience)
 *   hmac    → signing_secret
 *   none    → client certificate only
 *
 * The certificate fields apply to every mode when mutual TLS is switched on,
 * which most Indian corporate banking programmes require.
 */
export interface BankConnectionSecrets {
  /** Static key for api_key mode. */
  api_key: string
  /** OAuth2 / Basic client credentials. */
  client_id: string
  client_secret: string
  /** Optional audience/resource some token endpoints demand. */
  oauth_audience: string
  /** Shared secret used to sign outgoing requests in hmac mode. */
  signing_secret: string
  /** Verifies incoming callbacks from the bank. */
  webhook_secret: string
  /** Mutual TLS: PEM text pasted from the bank's certificate pack. */
  client_cert_pem: string
  client_key_pem: string
  client_cert_passphrase: string
  /** Corporate / customer identifier the bank stamps on every request. */
  corporate_id: string
}

/** Payout adds the account money is debited from. */
export interface PayoutSecrets extends BankConnectionSecrets {
  /** School current account that funds transfers. */
  account_number: string
  /** IFSC of the debit account — required by most bulk-transfer payloads. */
  account_ifsc: string
  /** Legacy aggregator secret; retained so older configs keep working. */
  key_secret: string
}

/** Legacy scopes, unchanged. */
export interface RazorpaySecrets {
  key_secret: string
  webhook_secret: string
}
export const BANK_CONNECTION_SECRET_DEFAULTS: BankConnectionSecrets = {
  api_key: '', client_id: '', client_secret: '', oauth_audience: '',
  signing_secret: '', webhook_secret: '',
  client_cert_pem: '', client_key_pem: '', client_cert_passphrase: '',
  corporate_id: '',
}

export const PAYOUT_SECRET_DEFAULTS: PayoutSecrets = {
  ...BANK_CONNECTION_SECRET_DEFAULTS,
  account_number: '', account_ifsc: '', key_secret: '',
}

/** Coerce a stored row into a fully-populated secrets object for the forms, so
 *  a field added after a school first saved still renders as a blank input. */
export function withSecretDefaults<T extends object>(
  defaults: T,
  stored: Record<string, string>,
): T {
  const out = { ...defaults } as Record<string, unknown>
  for (const key of Object.keys(defaults)) {
    const v = stored[key]
    if (typeof v === 'string') out[key] = v
  }
  return out as T
}

/** Read the stored secrets for a scope (admin only). Returns {} if none/blocked. */
export async function fetchPaymentSecrets(scope: PaymentSecretScope): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('payment_secrets')
    .select('value')
    .eq('key', scope)
    .maybeSingle()
  if (error) { console.error(`fetchPaymentSecrets(${scope}) failed:`, error); return {} }
  return (data?.value as Record<string, string> | null) ?? {}
}

/** Upsert the full secret object for a scope (admin only). */
export async function savePaymentSecrets<T extends object>(
  scope: PaymentSecretScope,
  value: T,
): Promise<{ success: boolean; error?: string }> {
  // Blank fields are persisted rather than dropped, so an admin can actually
  // clear a credential they no longer use (e.g. after switching auth mode).
  // The server-side reader treats a blank as "not set in the DB" and falls
  // back to the env var, which is the same meaning as an absent key.
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') cleaned[k] = v.trim()
  }
  const { error } = await supabase
    .from('payment_secrets')
    .upsert({ key: scope, value: cleaned }, { onConflict: 'key' })
  if (error) { console.error(`savePaymentSecrets(${scope}) failed:`, error); return { success: false, error: error.message } }
  return { success: true }
}
