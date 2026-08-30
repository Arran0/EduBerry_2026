import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// ============================================================================
// Reminder channels.
// ----------------------------------------------------------------------------
// EdZee has exactly one outbound notification channel today: Web Push, on the
// app's own VAPID keys (src/lib/push.ts, /api/announcements/notify,
// /api/leave/notify). There is no WhatsApp, SMS or email provider anywhere in
// the repository — no Twilio, no MSG91, no SendGrid, no SMTP.
//
// So this module does not invent one. It defines the interface a channel has to
// satisfy, implements push on the stack that already exists, and provides the
// other three as adapters that report themselves unconfigured. A school that
// buys a WhatsApp BSP fills in one function and the scheduler, the outbox, the
// dedupe rule and the escalation ladder all keep working unchanged.
//
// An unconfigured channel returns `not_configured`, which the sender records as
// 'skipped' rather than 'failed'. That distinction matters: a school looking at
// the outbox needs to see "we never had a way to send this", not a retry queue
// filling up with messages that were never going anywhere.
// ============================================================================

export type ChannelName = 'push' | 'in_app' | 'whatsapp' | 'sms' | 'email'

export interface OutboundMessage {
  recipientId: string
  title: string
  body: string
  /** Deep link into the app — the whole point of a fee reminder. */
  url?: string
  /** Collapses repeats on the same fee in the notification tray. */
  tag?: string
}

export type SendOutcome =
  | { status: 'sent'; providerRef?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

export interface ChannelAdapter {
  name: ChannelName
  /** Whether this channel can actually deliver right now. */
  isConfigured(db: SupabaseClient): Promise<boolean>
  send(db: SupabaseClient, message: OutboundMessage): Promise<SendOutcome>
}

// ── Push ────────────────────────────────────────────────────────────────────

function vapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || 'mailto:admin@eduberry.app' }
}

export const pushChannel: ChannelAdapter = {
  name: 'push',

  async isConfigured() { return vapid() !== null },

  async send(db, message) {
    const keys = vapid()
    if (!keys) return { status: 'skipped', reason: 'VAPID keys are not configured' }
    webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)

    const { data: subs } = await db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', message.recipientId)

    if (!subs?.length) {
      // Not a failure. The parent simply has not enabled notifications on any
      // device, and retrying will not change that.
      return { status: 'skipped', reason: 'No push-enabled device' }
    }

    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url ?? '/more/fees',
      tag: message.tag ?? 'fee-reminder',
    })

    const stale: string[] = []
    let delivered = 0

    await Promise.all(subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        delivered++
      } catch (err) {
        // 404/410 mean the browser discarded the subscription. Prune it, the
        // same way announcements/notify does, so the table does not fill with
        // devices that can never be reached again.
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) stale.push(sub.id)
        else console.warn('fee reminder push failed:', status, (err as Error).message)
      }
    }))

    if (stale.length) await db.from('push_subscriptions').delete().in('id', stale)

    if (delivered === 0) return { status: 'failed', reason: 'Every device rejected the push' }
    return { status: 'sent', providerRef: `push:${delivered}` }
  },
}

// ── In-app ──────────────────────────────────────────────────────────────────
// Always available, because the row in fee_notifications IS the in-app
// notification — the parent's fee screen reads it. Nothing external to call.

export const inAppChannel: ChannelAdapter = {
  name: 'in_app',
  async isConfigured() { return true },
  async send() { return { status: 'sent' } },
}

// ── Not yet available ───────────────────────────────────────────────────────
// Written against the interface so that wiring a provider is one function, not
// a redesign. Each names the credentials it would need, so the gap is legible
// rather than silent.

function unconfigured(name: ChannelName, needs: string): ChannelAdapter {
  return {
    name,
    async isConfigured() { return false },
    async send() {
      return { status: 'skipped', reason: `${name} is not configured — needs ${needs}` }
    },
  }
}

/**
 * WhatsApp needs a Business Solution Provider (Meta Cloud API, Gupshup,
 * Interakt…), a verified sender number, and pre-approved message templates —
 * a fee reminder is a "utility" template and cannot be free text.
 */
export const whatsappChannel = unconfigured('whatsapp', 'a WhatsApp BSP account and approved templates')

/** SMS needs a DLT-registered sender id and template (TRAI), plus a gateway. */
export const smsChannel = unconfigured('sms', 'a DLT-registered sender id and an SMS gateway')

/** Email needs a transactional provider and a verified sending domain. */
export const emailChannel = unconfigured('email', 'a transactional email provider and a verified domain')

export const CHANNELS: Record<ChannelName, ChannelAdapter> = {
  push: pushChannel,
  in_app: inAppChannel,
  whatsapp: whatsappChannel,
  sms: smsChannel,
  email: emailChannel,
}

/** Which channels can actually deliver, for the settings screen to be honest about. */
export async function availableChannels(db: SupabaseClient): Promise<ChannelName[]> {
  const names = Object.keys(CHANNELS) as ChannelName[]
  const checks = await Promise.all(names.map(async n => [n, await CHANNELS[n].isConfigured(db)] as const))
  return checks.filter(([, ok]) => ok).map(([n]) => n)
}
