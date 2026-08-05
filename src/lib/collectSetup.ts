import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { normalizeCollectConfig, BANK_CONNECTION_DEFAULTS, type BankCollectConfig, type CollectMode } from './bankConfig'
import { getPaymentSecrets } from './serverSecrets'
import { verifyAndNormalizeWebhook, type CollectCredentials, type NormalizedCollectEvent } from './smartCollect'

// Resolves which collection setup is live and verifies incoming bank callbacks.
// School fees and bus fees share one bank arrangement, so both modules call
// these helpers and differ only in which tables the settlement resolves against.
//
// Two config generations are supported at once:
//   • bank_collect_config — a direct bank connection (current).
//   • smart_collect_config — the older aggregator-shaped config.
// The direct bank connection wins when enabled; otherwise the legacy config is
// used unchanged, so a school that has not migrated keeps collecting.

export interface ResolvedCollect {
  enabled: boolean
  mode: CollectMode
  config: BankCollectConfig
  creds: CollectCredentials
  /** True when the legacy smart_collect scope supplied the settings. */
  legacy: boolean
  /** Legacy allocation credentials, only set when legacy is true. */
  legacyBaseUrl?: string
  legacyApiKey?: string
}

export async function resolveCollectSetup(admin: SupabaseClient): Promise<ResolvedCollect> {
  const [{ data: bankRow }, { data: legacyRow }] = await Promise.all([
    admin.from('site_settings').select('value').eq('key', 'bank_collect_config').maybeSingle(),
    admin.from('site_settings').select('value').eq('key', 'smart_collect_config').maybeSingle(),
  ])

  const bankConfig = normalizeCollectConfig(bankRow?.value as Partial<BankCollectConfig> | null)

  if (bankConfig.enabled) {
    // The legacy scope is read alongside so a school that switches to a direct
    // bank connection without re-entering its callback secret keeps verifying
    // callbacks — losing that would silently stop confirming every payment.
    const [s, legacySecrets] = await Promise.all([
      getPaymentSecrets(admin, 'bank_collect'),
      getPaymentSecrets(admin, 'smart_collect'),
    ])
    return {
      enabled: true,
      mode: bankConfig.mode,
      config: bankConfig,
      legacy: false,
      creds: {
        api_key: s.api_key,
        client_id: s.client_id,
        client_secret: s.client_secret,
        oauth_audience: s.oauth_audience,
        signing_secret: s.signing_secret,
        webhook_secret: s.webhook_secret ?? legacySecrets.webhook_secret,
        client_cert_pem: s.client_cert_pem,
        client_key_pem: s.client_key_pem,
        client_cert_passphrase: s.client_cert_passphrase,
        corporate_id: s.corporate_id,
      },
    }
  }

  // Legacy path — the pre-bank-connection Smart Collect config.
  const legacy = (legacyRow?.value ?? {}) as { enabled?: boolean; mode?: 'reference' | 'virtual_vpa' }
  const s = await getPaymentSecrets(admin, 'smart_collect')
  return {
    enabled: legacy.enabled ?? false,
    mode: legacy.mode ?? 'reference',
    config: {
      ...bankConfig,
      enabled: legacy.enabled ?? false,
      mode: legacy.mode ?? 'reference',
      connection: {
        ...BANK_CONNECTION_DEFAULTS,
        api_base_url: (s.base_url ?? '').replace(/\/+$/, ''),
        auth_mode: 'api_key',
        api_key_header: 'x-api-key',
      },
    },
    legacy: true,
    legacyBaseUrl: s.base_url,
    legacyApiKey: s.api_key,
    creds: { api_key: s.api_key, webhook_secret: s.webhook_secret },
  }
}

export interface VerifiedCollect {
  ok: boolean
  status?: number
  error?: string
  event?: NormalizedCollectEvent
}

/**
 * Read the raw body of a bank collection callback, verify its signature using
 * whichever collection setup is live, and normalize it.
 */
export async function verifyCollectCallback(
  admin: SupabaseClient,
  request: NextRequest,
): Promise<VerifiedCollect> {
  const setup = await resolveCollectSetup(admin)
  const conn = setup.config.connection

  const rawBody = await request.text()

  // The configured header first, then the names banks commonly use — so a
  // callback still verifies before the admin has tuned the setting.
  const signature =
    request.headers.get(conn.signature_header || 'x-signature') ??
    request.headers.get('x-webhook-signature') ??
    request.headers.get('x-bank-signature') ??
    request.headers.get('signature')

  const verified = verifyAndNormalizeWebhook(rawBody, signature, setup.creds.webhook_secret, conn)
  if (!verified.ok || !verified.event) {
    return { ok: false, status: 400, error: verified.error ?? 'Verification failed' }
  }
  return { ok: true, event: verified.event }
}
