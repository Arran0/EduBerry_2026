import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireCapability, serviceClient } from '@/lib/fees/serverGuard'
import { CHANNELS, type ChannelName } from '@/lib/fees/notify/channels'

// Deliver what the scheduler queued.
//
// Claim-then-send: a row is moved to 'sending' with a conditional update before
// anything is delivered, so two concurrent runs cannot both send it. The claim
// is `eq('status', 'queued')` on the update — if the row has moved on, the
// update matches nothing and this worker skips it. That is the only safe way to
// do this without a queue server.
//
// A skip and a failure are different outcomes and are recorded differently. A
// parent with no push-enabled device is 'skipped' — retrying will never reach
// them and a retry queue full of those is noise. A transport error is 'failed'
// and is retried, up to a limit.

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_ATTEMPTS = 3
const BATCH = 200

interface QueuedRow {
  id: string
  recipient_id: string
  channel: ChannelName
  title: string | null
  body: string | null
  payload: { url?: string } | null
  fee_id: string | null
  attempts: number
}

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get('x-fee-cron-secret')
  const viaCron = !!cronSecret && cronSecret === process.env.FEE_CRON_SECRET

  let db: SupabaseClient
  if (viaCron) {
    const svc = serviceClient()
    if (!svc.ok) return svc.response
    db = svc.db
  } else {
    const guard = await requireCapability(request, 'view_reports')
    if (!guard.ok) return guard.response
    db = guard.actor.db
  }

  const { data: rows, error } = await db
    .from('fee_notifications')
    .select('id, recipient_id, channel, title, body, payload, fee_id, attempts')
    .eq('status', 'queued')
    .lte('scheduled_for', new Date().toISOString())
    .lt('attempts', MAX_ATTEMPTS)
    .order('scheduled_for', { ascending: true })
    .limit(BATCH)

  if (error) {
    console.error('reminders/send: read failed', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const queued = (rows ?? []) as unknown as QueuedRow[]
  if (!queued.length) return NextResponse.json({ success: true, sent: 0, skipped: 0, failed: 0 })

  let sent = 0, skipped = 0, failed = 0

  for (const row of queued) {
    // Claim it. If another worker got there first this matches nothing and we
    // move on without sending.
    const { data: claimed } = await db
      .from('fee_notifications')
      .update({ status: 'sending', attempts: row.attempts + 1 })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select('id')

    if (!claimed?.length) continue

    const adapter = CHANNELS[row.channel]
    if (!adapter) {
      await db.from('fee_notifications').update({
        status: 'skipped', failure_reason: `Unknown channel "${row.channel}"`,
      }).eq('id', row.id)
      skipped++
      continue
    }

    let outcome
    try {
      outcome = await adapter.send(db, {
        recipientId: row.recipient_id,
        title: row.title ?? 'School fees',
        body: row.body ?? '',
        url: row.payload?.url,
        tag: row.fee_id ? `fee-${row.fee_id}` : 'fee-reminder',
      })
    } catch (e) {
      outcome = { status: 'failed' as const, reason: (e as Error).message }
    }

    if (outcome.status === 'sent') {
      await db.from('fee_notifications').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider_ref: outcome.providerRef ?? null,
      }).eq('id', row.id)
      sent++
    } else if (outcome.status === 'skipped') {
      await db.from('fee_notifications').update({
        status: 'skipped', failure_reason: outcome.reason,
      }).eq('id', row.id)
      skipped++
    } else {
      // Back to the queue if there are attempts left, otherwise give up and say
      // so — a row stuck in 'sending' forever would be invisible.
      const exhausted = row.attempts + 1 >= MAX_ATTEMPTS
      await db.from('fee_notifications').update({
        status: exhausted ? 'failed' : 'queued',
        failure_reason: outcome.reason,
      }).eq('id', row.id)
      failed++
    }
  }

  return NextResponse.json({
    success: true, processed: queued.length, sent, skipped, failed,
    more: queued.length === BATCH,
  })
}

/** What is waiting, for the dashboard's "reminders" panel. */
export async function GET(request: NextRequest) {
  const guard = await requireCapability(request, 'view_reports')
  if (!guard.ok) return guard.response

  const { data, error } = await guard.actor.db
    .from('fee_notifications')
    .select('status, channel')
    .limit(10000)
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  const counts: Record<string, number> = {}
  for (const r of data ?? []) {
    const key = `${r.status}:${r.channel}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return NextResponse.json({ success: true, counts })
}
