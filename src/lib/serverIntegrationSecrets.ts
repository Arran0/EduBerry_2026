import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-only reader for the admin-configured integration_secrets store.
 *
 * Mirrors src/lib/serverSecrets.ts one for one, for the same reason: in a
 * multi-tenant deployment each school configures its own credentials from the
 * in-app settings screens, and a self-hosted single-tenant install can still
 * set env vars. A DB value always wins; a blank DB value means "unset", so the
 * env var shows through.
 */

export type IntegrationScope = 'whatsapp' | 'sms' | `telemetry:${string}`

const ENV_FALLBACK: Record<string, Record<string, string | undefined>> = {
  whatsapp: {
    provider: process.env.WHATSAPP_PROVIDER,
    phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID,
    access_token: process.env.WHATSAPP_ACCESS_TOKEN,
    app_secret: process.env.WHATSAPP_APP_SECRET,
    verify_token: process.env.WHATSAPP_VERIFY_TOKEN,
    api_version: process.env.WHATSAPP_API_VERSION,
  },
}

export async function readIntegrationSecrets(
  client: SupabaseClient,
  scope: IntegrationScope,
): Promise<Record<string, string>> {
  const fallback = ENV_FALLBACK[scope] ?? {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(fallback)) if (v) out[k] = v

  const { data, error } = await client
    .from('integration_secrets')
    .select('value')
    .eq('key', scope)
    .maybeSingle()

  if (error) { console.error('readIntegrationSecrets failed:', error); return out }

  const stored = (data?.value ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(stored)) {
    // A blank stored value is "unset", not "override with empty".
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}
