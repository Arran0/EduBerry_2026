import 'server-only'
import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The one place web push is sent from.
 *
 * This block used to be copy-pasted into src/app/api/announcements/notify and
 * src/app/api/leave/notify. Extracting it and leaving the copies behind is how
 * you end up with three copies, so both routes were moved onto this in the same
 * change.
 *
 * The fan-out is chunked. The original fired one unbounded `Promise.all` over
 * every subscription in the school, which at assembly scale is hundreds of
 * simultaneous HTTPS requests inside one serverless invocation.
 */

const CHUNK = 25

export interface PushPayload {
  title: string
  body: string
  url?: string
  /** Replaces an earlier notification with the same tag on the lock screen. */
  tag?: string
}

export interface PushResult {
  sent: number
  pruned: number
  skipped?: string
}

/** True when the deployment has VAPID keys configured at all. */
export function pushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

function configure(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@eduberry.app'
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  return true
}

/**
 * Send one payload to every device belonging to `userIds`.
 *
 * Push is optional infrastructure: with no keys configured this reports
 * `skipped` rather than failing, so a notification that cannot go out never
 * makes the action that triggered it look like it failed.
 */
export async function sendPushToUsers(
  client: SupabaseClient,
  userIds: string[],
  payload: PushPayload,
): Promise<PushResult> {
  if (userIds.length === 0) return { sent: 0, pruned: 0 }
  if (!configure()) return { sent: 0, pruned: 0, skipped: 'VAPID keys not configured' }

  const { data: subscriptions, error } = await client
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', userIds)

  if (error || !subscriptions || subscriptions.length === 0) {
    if (error) console.error('sendPushToUsers: subscription lookup failed:', error)
    return { sent: 0, pruned: 0 }
  }

  const body = JSON.stringify(payload)
  const staleIds: string[] = []
  let sent = 0

  for (let i = 0; i < subscriptions.length; i += CHUNK) {
    const batch = subscriptions.slice(i, i + CHUNK)
    await Promise.all(batch.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        )
        sent++
      } catch (err) {
        // 404/410 mean the browser threw the subscription away — prune it so
        // the table does not accumulate dead devices.
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) staleIds.push(sub.id)
        else console.warn('Push send failed:', status, (err as Error).message)
      }
    }))
  }

  if (staleIds.length > 0) {
    await client.from('push_subscriptions').delete().in('id', staleIds)
  }

  return { sent, pruned: staleIds.length }
}
