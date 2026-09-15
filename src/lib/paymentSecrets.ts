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

/**
 * The fields that are genuinely secret: they are never sent back to the
 * browser, only overwritten. Everything else in a scope is an identifier the
 * admin needs to read back to check they configured the right account — the
 * corporate id, the client id, the OAuth audience, the debit account and its
 * IFSC, and the *public* half of the TLS pair.
 *
 * Enforced server-side by payment_secrets_read(); this copy only drives the
 * "Configured" affordance and the blank-means-unchanged save logic.
 */
export const WRITE_ONLY_SECRET_KEYS: ReadonlySet<string> = new Set([
  'api_key', 'client_secret', 'signing_secret', 'webhook_secret',
  'client_key_pem', 'client_cert_passphrase', 'key_secret',
])

export interface StoredSecrets {
  /** Values safe to render back into the form. Write-only keys are absent. */
  values: Record<string, string>
  /** Every key that currently holds a non-empty value server-side. */
  configured: Set<string>
}

export const EMPTY_STORED_SECRETS: StoredSecrets = { values: {}, configured: new Set() }

/**
 * Read a scope's stored credentials (admin only).
 *
 * Goes through the payment_secrets_read RPC rather than selecting the row: the
 * form used to receive every secret it displayed, so opening Fee Settings or
 * Payroll Settings shipped the school's client secret, callback secret and
 * client PRIVATE KEY to the browser. Now it gets the identifiers plus a list of
 * which secrets are set, which is all the UI actually needs.
 */
export async function fetchPaymentSecrets(scope: PaymentSecretScope): Promise<StoredSecrets> {
  const { data, error } = await supabase.rpc('payment_secrets_read', { p_scope: scope })
  if (error) { console.error(`fetchPaymentSecrets(${scope}) failed:`, error); return EMPTY_STORED_SECRETS }
  const row = (data ?? {}) as { values?: Record<string, string>; configured?: string[] }
  return {
    values: row.values ?? {},
    configured: new Set(row.configured ?? []),
  }
}

/**
 * Save a scope's credentials (admin only).
 *
 * A blank write-only field means "leave whatever is stored alone" — the form
 * never held the real value, so sending the blank would erase it. Clearing a
 * credential on purpose goes through `clear`, which drops those keys outright.
 * Non-secret fields still round-trip, so blanking one clears it as before.
 */
export async function savePaymentSecrets<T extends object>(
  scope: PaymentSecretScope,
  value: T,
  clear: string[] = [],
): Promise<{ success: boolean; error?: string }> {
  const patch: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') continue
    const trimmed = v.trim()
    if (WRITE_ONLY_SECRET_KEYS.has(k) && trimmed === '') continue // unchanged
    patch[k] = trimmed
  }

  const { error } = await supabase.rpc('payment_secrets_write', {
    p_scope: scope,
    p_patch: patch,
    p_clear: clear,
  })
  if (error) { console.error(`savePaymentSecrets(${scope}) failed:`, error); return { success: false, error: error.message } }
  return { success: true }
}
