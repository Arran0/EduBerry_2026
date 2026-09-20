import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { adminClient } from '@/lib/serverAuth'
import { sendPushToUsers } from '@/lib/notifications/push'
import { loadTemplates, render, type MessageTemplate } from '@/lib/notifications/templates'
import { readIntegrationSecrets } from '@/lib/serverIntegrationSecrets'
import { resolveProvider, toE164Digits } from '@/lib/notifications/whatsapp'

// web-push and the Meta API both need Node, not the edge runtime.
export const runtime = 'nodejs'

/**
 * Drains the notification outbox.
 *
 * Called every minute by pg_cron through pg_net, and safe to call by hand or
 * from a second scheduler as a backstop — rows are claimed with FOR UPDATE SKIP
 * LOCKED, so two drains overlapping is harmless rather than a double-send.
 *
 * Authenticated with a shared secret rather than a user session: there is no
 * user present when this fires.
 */
export async function POST(request: NextRequest) {
  const client = adminClient()
  if (!client) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 })
  }

  const { data: cfg } = await client
    .from('transport_runtime_config')
    .select('key, value')
    .in('key', ['cron_secret'])
  const expected = (cfg ?? []).find(r => r.key === 'cron_secret')?.value

  if (!expected || !timingSafeEqual(request.headers.get('x-cron-secret'), String(expected))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const limit = Math.min(Number((body as { limit?: number }).limit) || 50, 200)

  // Claim a batch. The RPC does the SKIP LOCKED select-and-mark in one
  // statement; without that, two overlapping drains would both pick up the
  // same rows and a parent would be messaged twice.
  const { data: claimed, error: claimErr } = await client.rpc('notify_claim_batch', { p_limit: limit })
  if (claimErr) {
    console.error('drain: claim failed', claimErr)
    return NextResponse.json({ success: false, error: claimErr.message }, { status: 500 })
  }

  const rows = (claimed ?? []) as OutboxRow[]
  if (rows.length === 0) return NextResponse.json({ success: true, sent: 0, failed: 0 })

  const [templates, waConfig] = await Promise.all([
    loadTemplates(client),
    readIntegrationSecrets(client, 'whatsapp'),
  ])
  const provider = resolveProvider(waConfig.provider)

  let sent = 0
  let failed = 0

  for (const row of rows) {
    const tpl = templates.get(`${row.event_type}|${row.channel}`) ?? null
    try {
      const result = row.channel === 'whatsapp'
        ? await sendWhatsApp(row, tpl, provider, waConfig)
        : await sendPush(client, row, tpl)

      if (result.ok) {
        sent++
        await client.from('notification_outbox').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider: result.provider ?? null,
          provider_message_id: result.providerMessageId ?? null,
          last_error: null,
        }).eq('id', row.id)
      } else {
        failed++
        await markFailed(client, row, result.error ?? 'Unknown error', result.retryable)
      }
    } catch (e) {
      failed++
      await markFailed(client, row, (e as Error).message, true)
    }
  }

  return NextResponse.json({ success: true, sent, failed, claimed: rows.length })
}

/** Length is not secret here, but the byte comparison must not short-circuit. */
function timingSafeEqual(a: string | null, b: string): boolean {
  if (!a) return false
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

interface OutboxRow {
  id: string
  event_type: string
  channel: 'push' | 'whatsapp' | 'sms' | 'email' | 'inapp'
  recipient_user_id: string | null
  recipient_address: string | null
  variables: Record<string, unknown>
  subject_ref: Record<string, unknown>
  attempts: number
}

interface DeliveryResult {
  ok: boolean
  provider?: string
  providerMessageId?: string
  error?: string
  retryable?: boolean
}

async function sendPush(
  client: ReturnType<typeof adminClient> & object,
  row: OutboxRow,
  tpl: MessageTemplate | null,
): Promise<DeliveryResult> {
  if (!row.recipient_user_id) return { ok: false, error: 'No recipient', retryable: false }

  const title = render(tpl?.title_template, row.variables) || 'School transport'
  const bodyText = render(tpl?.body_template, row.variables) || ''
  const url = render(tpl?.url_template, row.variables) || '/more/bus'

  const res = await sendPushToUsers(client, [row.recipient_user_id], {
    title,
    body: bodyText,
    url,
    // One tag per event per run, so a later update about the same trip replaces
    // the earlier one on the lock screen instead of stacking.
    tag: `${row.event_type}:${row.subject_ref?.run_id ?? row.id}`,
  })

  // No VAPID keys is a configuration gap, not a delivery failure — treat it as
  // handled so the row does not sit retrying forever.
  if (res.skipped) return { ok: true, provider: 'web-push' }
  if (res.sent === 0) return { ok: false, error: 'No registered devices', retryable: false }
  return { ok: true, provider: 'web-push' }
}

async function sendWhatsApp(
  row: OutboxRow,
  tpl: MessageTemplate | null,
  provider: ReturnType<typeof resolveProvider>,
  config: Record<string, string>,
): Promise<DeliveryResult> {
  const to = toE164Digits(row.recipient_address, config.default_country_code || '91')
  if (!to) return { ok: false, error: 'No usable phone number', retryable: false }

  const res = await provider.send(
    { to, template: tpl, variables: row.variables, fallbackBody: render(tpl?.body_template, row.variables) },
    config,
  )
  return {
    ok: res.ok,
    provider: provider.slug,
    providerMessageId: res.providerMessageId,
    error: res.error,
    retryable: res.retryable,
  }
}

/** Exponential backoff, five attempts, then give up and record why. */
async function markFailed(
  client: ReturnType<typeof adminClient> & object,
  row: OutboxRow,
  error: string,
  retryable = true,
) {
  const attempts = row.attempts + 1
  const giveUp = !retryable || attempts >= 5
  await client.from('notification_outbox').update({
    status: giveUp ? 'failed' : 'queued',
    attempts,
    last_error: error,
    failed_at: giveUp ? new Date().toISOString() : null,
    not_before: giveUp
      ? new Date().toISOString()
      : new Date(Date.now() + 2 ** attempts * 60_000).toISOString(),
  }).eq('id', row.id)
}
