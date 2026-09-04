// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp credentials.
//
// The permanent token, the app secret and the webhook verify token go in
// `integration_secrets`, which has no public read policy — admin or the
// server's service role only. They must never go in `site_settings`, which is
// world-readable; src/lib/bankConfig.ts already documents that split for bank
// credentials and this follows it.
//
// The non-secret half (phone number id, WABA id, whether credentials are
// present) lives in `fee_settings.whatsapp` so the settings screen and the send
// worker can both see the configuration state without reading a secret.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'

export const WHATSAPP_SECRET_KEY = 'whatsapp'

export interface WhatsAppSecrets {
  /** System-user token with whatsapp_business_messaging + _management. Never expires. */
  access_token: string
  /** App secret, used to verify the X-Hub-Signature-256 on inbound webhooks. */
  app_secret: string
  /** The random string you also type into Meta's Callback Verify Token box. */
  verify_token: string
}

export const EMPTY_WHATSAPP_SECRETS: WhatsAppSecrets = {
  access_token: '', app_secret: '', verify_token: '',
}

export async function fetchWhatsAppSecrets(): Promise<WhatsAppSecrets> {
  const { data, error } = await supabase
    .from('integration_secrets')
    .select('value')
    .eq('key', WHATSAPP_SECRET_KEY)
    .maybeSingle()
  if (error) return EMPTY_WHATSAPP_SECRETS
  return { ...EMPTY_WHATSAPP_SECRETS, ...((data?.value ?? {}) as Partial<WhatsAppSecrets>) }
}

export async function saveWhatsAppSecrets(patch: Partial<WhatsAppSecrets>): Promise<void> {
  const current = await fetchWhatsAppSecrets()
  // Blank fields mean "leave it alone", not "clear it": the form renders stored
  // secrets as empty password inputs, so saving after editing only the phone
  // number id must not wipe the token.
  const next: WhatsAppSecrets = {
    access_token: patch.access_token || current.access_token,
    app_secret:   patch.app_secret   || current.app_secret,
    verify_token: patch.verify_token || current.verify_token,
  }
  const { error } = await supabase
    .from('integration_secrets')
    .upsert({ key: WHATSAPP_SECRET_KEY, value: next, updated_at: new Date().toISOString() },
            { onConflict: 'key' })
  if (error) throw error
}

/** Which credentials are present, without returning any of them. */
export async function whatsAppCredentialStatus(): Promise<{
  access_token: boolean; app_secret: boolean; verify_token: boolean; complete: boolean
}> {
  const s = await fetchWhatsAppSecrets()
  const status = {
    access_token: !!s.access_token,
    app_secret: !!s.app_secret,
    verify_token: !!s.verify_token,
  }
  return { ...status, complete: status.access_token && status.verify_token }
}
