import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { adminClient } from '@/lib/serverAuth'
import { metaCloudProvider } from '@/lib/whatsapp/metaCloud'
import { orderedParams } from '@/lib/whatsapp/provider'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Constant-time compare that does not reveal length through an early exit. */
function timingSafeStringEqual(a: string, b: string): boolean {
  // Hash both to a fixed width first: timingSafeEqual throws on a length
  // mismatch, and that throw is itself an oracle for the secret's length.
  const ah = crypto.createHash('sha256').update(Buffer.from(a)).digest()
  const bh = crypto.createHash('sha256').update(Buffer.from(b)).digest()
  return crypto.timingSafeEqual(ah, bh)
}

/**
 * The attendance outbox worker.
 *
 * src/app/api/fees/cron/drain/route.ts with an attendance module filter and an
 * attendance log to write back to. Kept as its own route rather than generalised
 * into one: the two differ in which settings row holds the secret and which log
 * table takes the receipt, and a single route taking a module name would have to
 * be trusted to pick the right pair from a request body.
 *
 * Called every minute by `attendance_kick_drain()`, which only fires an HTTP
 * request when something is actually queued — a quiet minute costs a COUNT, not
 * a function invocation.
 *
 * Claiming happens in the database with FOR UPDATE SKIP LOCKED, so two
 * overlapping runs take different messages rather than both sending the same
 * one to the same parent.
 */
export async function POST(request: NextRequest) {
  const db = adminClient()
  if (!db) {
    return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })
  }

  const { data: runtimeRow } = await db.from('site_settings')
    .select('value').eq('key', 'attendance_runtime').maybeSingle()
  const expected = (runtimeRow?.value as { cron_secret?: string } | null)?.cron_secret

  // No secret configured means the drain has not been set up. Refuse rather
  // than running unauthenticated — this endpoint sends messages to parents.
  const secretHeader = request.headers.get('x-cron-secret')
  if (!expected || !secretHeader || !timingSafeStringEqual(secretHeader, expected)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  // The same WhatsApp Business number the fee reminders use. One number per
  // school is the whole point: a parent recognises one sender, and Meta rates
  // the quality of one number rather than two.
  const [{ data: secrets }, { data: config }] = await Promise.all([
    db.from('integration_secrets').select('value').eq('key', 'whatsapp').maybeSingle(),
    db.from('fee_settings').select('value')
      .eq('key', 'whatsapp').eq('status', 'published').is('effective_to', null).maybeSingle(),
  ])

  const creds = {
    phoneNumberId: (config?.value as { phone_number_id?: string } | null)?.phone_number_id ?? '',
    accessToken: (secrets?.value as { access_token?: string } | null)?.access_token ?? '',
  }

  // Credentials are not in yet. Leave everything queued; the queue drains the
  // moment they land, and nothing is marked as having been sent.
  if (!creds.phoneNumberId || !creds.accessToken) {
    return NextResponse.json({
      success: true, sent: 0, failed: 0,
      note: 'WhatsApp is not connected yet; messages stay queued.',
    })
  }

  const limit = await request.json()
    .then((b: { limit?: number }) => Math.min(Math.max(b?.limit ?? 50, 1), 100))
    .catch(() => 50)

  const { data: batch, error } = await db.rpc('attendance_claim_outbox', { p_limit: limit })
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const messages = (batch ?? []) as {
    id: string
    template_key: string | null
    recipient_address: string | null
    variables: Record<string, unknown>
  }[]

  if (messages.length === 0) {
    return NextResponse.json({ success: true, sent: 0, failed: 0 })
  }

  const keys = [...new Set(messages.map(m => m.template_key).filter(Boolean))] as string[]
  const { data: templates } = await db.from('message_templates')
    .select('key, provider_template_name, provider_template_lang, variable_order, active')
    .in('key', keys).eq('channel', 'whatsapp')

  const byKey = new Map((templates ?? []).map(t => [t.key as string, t]))

  let sent = 0
  let failed = 0

  for (const m of messages) {
    const tpl = m.template_key ? byKey.get(m.template_key) : undefined

    if (!tpl || !tpl.active || !m.recipient_address) {
      const now = new Date().toISOString()
      await db.from('notification_outbox').update({
        status: 'skipped',
        last_error: !m.recipient_address ? 'No number to send to'
                    : !tpl ? `No WhatsApp template for "${m.template_key}"`
                    : 'Template is switched off',
        updated_at: now,
      }).eq('id', m.id)
      // The log has to agree with the outbox. A row left with no failed_at
      // reads as "queued, on its way" in the history, which is the one thing
      // it must never say about a message that is never going to go.
      await db.from('attendance_message_log').update({ failed_at: now }).eq('outbox_id', m.id)
      continue
    }

    const result = await metaCloudProvider.send({
      to: m.recipient_address,
      templateName: (tpl.provider_template_name as string) ?? (m.template_key as string),
      languageCode: (tpl.provider_template_lang as string) ?? 'en',
      bodyParams: orderedParams(m.variables, tpl.variable_order as string[] | null),
    }, creds)

    const now = new Date().toISOString()

    if (result.ok) {
      sent++
      await db.from('notification_outbox').update({
        status: 'sent', provider: 'meta_cloud',
        provider_message_id: result.providerMessageId ?? null,
        sent_at: now, last_error: null, updated_at: now,
      }).eq('id', m.id)
      await db.from('attendance_message_log').update({ sent_at: now }).eq('outbox_id', m.id)
    } else {
      failed++
      // Retryable goes back on the queue; permanent is marked failed so it is
      // not retried forever against an error that cannot resolve itself.
      await db.from('notification_outbox').update({
        status: result.retryable ? 'queued' : 'failed',
        last_error: result.error ?? 'Send failed',
        failed_at: result.retryable ? null : now,
        // Back off a minute so a transient outage is not hammered.
        not_before: result.retryable ? new Date(Date.now() + 60_000).toISOString() : undefined,
        updated_at: now,
      }).eq('id', m.id)
      if (!result.retryable) {
        await db.from('attendance_message_log').update({ failed_at: now }).eq('outbox_id', m.id)
      }
    }
  }

  return NextResponse.json({ success: true, sent, failed, claimed: messages.length })
}
