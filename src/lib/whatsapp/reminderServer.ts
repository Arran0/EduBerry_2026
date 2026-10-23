import 'server-only'
import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readIntegrationSecrets } from '@/lib/serverIntegrationSecrets'
import { metaCloudProvider } from './metaCloud'
import { orderedParams, type WhatsAppCredentials } from './provider'

// ─────────────────────────────────────────────────────────────────────────────
// The server half of WhatsApp reminders: credentials, the drain's runtime
// row, and one drain pass.
//
// Shared by the cron-called drain route and the send route, which runs a pass
// of its own right after queueing so "Remind" is answered in seconds rather
// than at the next minute's tick. Both claim through wa_claim_outbox's FOR
// UPDATE SKIP LOCKED, so the two overlapping is harmless.
// ─────────────────────────────────────────────────────────────────────────────

/** Five tries with a doubling wait, then the row is marked failed and says why. */
const MAX_ATTEMPTS = 5

/**
 * The phone number id comes from the fee module's WhatsApp settings — the one
 * screen where a school enters it — falling back to integration_secrets and
 * then env, so a self-hosted install that only sets env vars still sends.
 */
export async function resolveWhatsAppCredentials(
  db: SupabaseClient,
): Promise<WhatsAppCredentials & { connected: boolean }> {
  const [secrets, { data: cfg }] = await Promise.all([
    readIntegrationSecrets(db, 'whatsapp'),
    db.from('fee_settings').select('value')
      .eq('key', 'whatsapp').eq('status', 'published').is('effective_to', null)
      .order('version', { ascending: false }).limit(1),
  ])
  const phoneNumberId =
    (cfg?.[0]?.value as { phone_number_id?: string } | undefined)?.phone_number_id?.trim()
    || secrets.phone_number_id || ''
  const accessToken = secrets.access_token || ''
  return { phoneNumberId, accessToken, connected: !!phoneNumberId && !!accessToken }
}

/** Where pg_cron should call, from the request — never localhost, which pg_net cannot reach. */
export function publicOrigin(requestOrigin: string): string | null {
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || requestOrigin
  try {
    const host = new URL(origin).hostname
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return null
    return origin
  } catch {
    return null
  }
}

/**
 * Make sure the database knows where the drain is and has a secret to call it
 * with. Written on first use, so a school never pastes a URL or a secret. An
 * existing URL is left alone: a preview deployment opening a popup must not
 * repoint production's timer at itself.
 */
export async function ensureReminderRuntime(
  db: SupabaseClient, requestOrigin: string,
): Promise<{ drainReady: boolean }> {
  const { data } = await db.from('wa_runtime_config').select('key, value')
  const have = new Map((data ?? []).map(r => [r.key as string, r.value as string | null]))

  const rows: { key: string; value: string; updated_at: string }[] = []
  const now = new Date().toISOString()
  if (!have.get('drain_url')) {
    const origin = publicOrigin(requestOrigin)
    if (origin) rows.push({ key: 'drain_url', value: `${origin}/api/whatsapp/reminders/drain`, updated_at: now })
  }
  if (!have.get('cron_secret')) {
    rows.push({ key: 'cron_secret', value: crypto.randomBytes(32).toString('hex'), updated_at: now })
  }
  if (rows.length > 0) {
    const { error } = await db.from('wa_runtime_config').upsert(rows, { onConflict: 'key' })
    if (error) console.error('ensureReminderRuntime failed:', error)
  }

  const drainUrl = have.get('drain_url') || rows.find(r => r.key === 'drain_url')?.value
  return { drainReady: !!drainUrl }
}

/** Constant-time compare that also hides the secret's length. */
export function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false
  const a = crypto.createHash('sha256').update(given).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

interface OutboxRow {
  id: string
  template_key: string | null
  recipient_address: string | null
  variables: Record<string, unknown>
  attempts: number
}

interface TemplateRow {
  key: string
  provider_template_name: string | null
  provider_template_lang: string | null
  variable_order: string[] | null
  active: boolean
}

/** One pass over the reminder outbox. */
export async function drainReminders(
  db: SupabaseClient, limit = 50,
): Promise<{ sent: number; failed: number; claimed: number; note?: string }> {
  const creds = await resolveWhatsAppCredentials(db)
  // Not connected yet: leave everything queued rather than claiming and
  // failing it. It drains the minute the credentials are saved.
  if (!creds.connected) {
    return { sent: 0, failed: 0, claimed: 0, note: 'WhatsApp is not connected yet; reminders stay queued.' }
  }

  const { data: claimed, error } = await db.rpc('wa_claim_outbox', { p_limit: limit })
  if (error) throw new Error(error.message)
  const rows = (claimed ?? []) as OutboxRow[]
  if (rows.length === 0) return { sent: 0, failed: 0, claimed: 0 }

  const keys = [...new Set(rows.map(r => r.template_key).filter(Boolean))] as string[]
  const { data: tpls } = await db.from('message_templates')
    .select('key, provider_template_name, provider_template_lang, variable_order, active')
    .in('key', keys).eq('channel', 'whatsapp').eq('locale', 'en')
  const byKey = new Map(((tpls ?? []) as TemplateRow[]).map(t => [t.key, t]))

  let sent = 0
  let failed = 0

  for (const row of rows) {
    const tpl = row.template_key ? byKey.get(row.template_key) : undefined
    const now = new Date().toISOString()

    if (!tpl || !tpl.active || !tpl.provider_template_name || !row.recipient_address) {
      const why = !row.recipient_address ? 'No number to send to'
        : !tpl ? `No WhatsApp template for "${row.template_key}"`
        : !tpl.active ? 'This template is switched off'
        : 'No approved WhatsApp template name yet'
      failed++
      await db.from('notification_outbox')
        .update({ status: 'failed', last_error: why, failed_at: now, updated_at: now }).eq('id', row.id)
      await db.from('wa_reminder_log').update({ failed_at: now, error: why }).eq('outbox_id', row.id)
      continue
    }

    const result = await metaCloudProvider.send({
      to: row.recipient_address,
      templateName: tpl.provider_template_name,
      languageCode: tpl.provider_template_lang || 'en',
      bodyParams: orderedParams(row.variables, tpl.variable_order),
    }, creds)

    if (result.ok) {
      sent++
      await db.from('notification_outbox').update({
        status: 'sent', provider: 'meta_cloud', provider_message_id: result.providerMessageId ?? null,
        sent_at: now, last_error: null, updated_at: now,
      }).eq('id', row.id)
      await db.from('wa_reminder_log').update({ sent_at: now, error: null }).eq('outbox_id', row.id)
      continue
    }

    failed++
    const giveUp = !result.retryable || row.attempts >= MAX_ATTEMPTS
    await db.from('notification_outbox').update({
      status: giveUp ? 'failed' : 'queued',
      last_error: result.error ?? 'Send failed',
      failed_at: giveUp ? now : null,
      not_before: giveUp ? now : new Date(Date.now() + 2 ** row.attempts * 60_000).toISOString(),
      updated_at: now,
    }).eq('id', row.id)
    if (giveUp) {
      await db.from('wa_reminder_log')
        .update({ failed_at: now, error: result.error ?? 'Send failed' }).eq('outbox_id', row.id)
    }
  }

  return { sent, failed, claimed: rows.length }
}
