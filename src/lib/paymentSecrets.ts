import { supabase } from './supabase'

// Client-side helpers for the admin-only payment_secrets store. These let a
// school admin configure their own gateway / payout credentials from the
// settings screens (multi-tenant) instead of server env vars.
//
// The payment_secrets table has NO public read policy, so only an admin (or the
// server's service role) can read it — see add_payment_secrets.sql. Secret
// fields are rendered as password inputs in the settings forms; the server
// reads the same rows via the service role and falls back to env vars.

export type PaymentSecretScope = 'razorpay' | 'smart_collect' | 'payout'

/** The known secret fields per scope (used to type the forms). */
export interface RazorpaySecrets {
  key_secret: string
  webhook_secret: string
}
export interface SmartCollectSecrets {
  base_url: string
  api_key: string
  webhook_secret: string
}
export interface PayoutSecrets {
  key_secret: string
  account_number: string
  webhook_secret: string
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
export async function savePaymentSecrets(
  scope: PaymentSecretScope,
  value: Record<string, string>,
): Promise<{ success: boolean; error?: string }> {
  // Drop blank fields so we don't persist empty strings.
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' && v.trim() !== '') cleaned[k] = v.trim()
  }
  const { error } = await supabase
    .from('payment_secrets')
    .upsert({ key: scope, value: cleaned }, { onConflict: 'key' })
  if (error) { console.error(`savePaymentSecrets(${scope}) failed:`, error); return { success: false, error: error.message } }
  return { success: true }
}
