import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { adminClient } from '@/lib/serverAuth'
import { verifyMetaSignature } from '@/lib/whatsapp/metaCloud'

export const runtime = 'nodejs'

/**
 * Meta's webhook verification handshake.
 *
 * Meta calls this once when the callback URL is saved in the app dashboard and
 * expects the challenge echoed back verbatim. It is live before any credentials
 * exist so step 11 of the setup guide verifies first try.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  const db = adminClient()
  if (!db) return new NextResponse('Server not configured', { status: 500 })

  const { data } = await db.from('integration_secrets')
    .select('value').eq('key', 'whatsapp').maybeSingle()
  const expected = (data?.value as { verify_token?: string } | null)?.verify_token

  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new NextResponse(challenge, {
      status: 200, headers: { 'Content-Type': 'text/plain' },
    })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

/**
 * Delivery receipts, read receipts, and inbound messages.
 *
 * Signature-checked against the app secret. Without that, anyone who learns
 * this URL could post a fake STOP and silently opt a family out of every future
 * message, or fake delivery receipts that make the reminder log lie.
 *
 * Always answers 200 once verified: Meta retries anything else, and a retry
 * storm over a row we could not match is worse than dropping one receipt.
 */
export async function POST(request: NextRequest) {
  const db = adminClient()
  if (!db) return NextResponse.json({ ok: true })

  const raw = await request.text()

  const { data } = await db.from('integration_secrets')
    .select('value').eq('key', 'whatsapp').maybeSingle()
  const appSecret = (data?.value as { app_secret?: string } | null)?.app_secret

  if (appSecret) {
    const ok = await verifyMetaSignature(
      raw, request.headers.get('x-hub-signature-256'), appSecret)
    if (!ok) return new NextResponse('Bad signature', { status: 401 })
  } else {
    // No app secret configured yet. Refuse rather than trusting an unsigned
    // body — an unverified STOP is a silent opt-out we cannot undo.
    return new NextResponse('Webhook signature not configured', { status: 401 })
  }

  let payload: MetaWebhook
  try { payload = JSON.parse(raw) as MetaWebhook } catch { return NextResponse.json({ ok: true }) }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {}

      for (const status of value.statuses ?? []) {
        await recordStatus(db, status)
      }

      for (const message of value.messages ?? []) {
        await handleInbound(db, message)
      }
    }
  }

  return NextResponse.json({ ok: true })
}

interface MetaWebhook {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id: string; status: string; timestamp?: string; errors?: { title?: string }[] }[]
        messages?: { from: string; type: string; text?: { body?: string } }[]
      }
    }[]
  }[]
}

type Db = NonNullable<ReturnType<typeof adminClient>>

/** delivered / read / failed, matched back by Meta's message id. */
async function recordStatus(
  db: Db,
  status: { id: string; status: string; timestamp?: string; errors?: { title?: string }[] },
) {
  const at = status.timestamp
    ? new Date(Number(status.timestamp) * 1000).toISOString()
    : new Date().toISOString()

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const logPatch: Record<string, unknown> = {}

  if (status.status === 'delivered') {
    patch.status = 'delivered'; patch.delivered_at = at; logPatch.delivered_at = at
  } else if (status.status === 'read') {
    // Meta does not always send `delivered` before `read`; a read message was
    // certainly delivered, so fill both rather than leaving a gap in the log.
    patch.status = 'delivered'; patch.delivered_at = at
    logPatch.delivered_at = at; logPatch.read_at = at
  } else if (status.status === 'failed') {
    patch.status = 'failed'; patch.failed_at = at
    patch.last_error = status.errors?.[0]?.title ?? 'Delivery failed'
    logPatch.failed_at = at
  } else {
    return
  }

  const { data: row } = await db.from('notification_outbox')
    .select('id').eq('provider_message_id', status.id).maybeSingle()
  if (!row) return

  await db.from('notification_outbox').update(patch).eq('id', row.id)
  if (Object.keys(logPatch).length > 0) {
    await db.from('fee_reminder_log').update(logPatch).eq('outbox_id', row.id)
  }
}

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'remove me']

/**
 * An inbound message. The only one that changes anything is a STOP.
 *
 * Honouring it matters twice over: it is what a person asked for, and Meta
 * scores the number's quality on whether people block it. A school that keeps
 * messaging after STOP loses the channel for everybody.
 */
async function handleInbound(
  db: Db, message: { from: string; type: string; text?: { body?: string } },
) {
  if (message.type !== 'text') return
  const body = (message.text?.body ?? '').trim().toLowerCase()
  if (!STOP_WORDS.some(w => body === w || body.startsWith(w))) return

  const msisdn = message.from.replace(/\D/g, '')
  const now = new Date().toISOString()

  // The number may already be on file, or may only be known through
  // student_details. Cover both so an opt-out is never lost.
  const { data: existing } = await db.from('whatsapp_numbers')
    .select('id').eq('msisdn', msisdn)

  if (existing && existing.length > 0) {
    await db.from('whatsapp_numbers').update({ opt_out_at: now }).eq('msisdn', msisdn)
    return
  }

  const { data: match } = await db.rpc('fee_students_by_msisdn', { p_msisdn: msisdn })
  for (const studentId of (match ?? []) as string[]) {
    await db.from('whatsapp_numbers').upsert(
      { student_id: studentId, msisdn, opt_out_at: now, source: 'inbound_stop' },
      { onConflict: 'student_id,msisdn' })
  }
}
