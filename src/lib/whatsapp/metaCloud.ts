// ─────────────────────────────────────────────────────────────────────────────
// Meta WhatsApp Cloud API.
//
// One POST to graph.facebook.com per message. The parts that are easy to get
// wrong, and which the setup guide in docs/fee-upgrade-plan.md calls out:
//
//   - the recipient is E.164 with no leading +
//   - a template message's body parameters are positional, so the order has to
//     match what was registered in WhatsApp Manager
//   - a URL button takes only the dynamic suffix; the rest of the link is
//     fixed when the template is approved
//   - error code 131047 means the 24-hour window closed and a template is
//     required, which is not retryable by resending the same thing
// ─────────────────────────────────────────────────────────────────────────────

import {
  isRetryableStatus,
  type SendResult, type TemplateMessage, type WhatsAppCredentials, type WhatsAppProvider,
} from './provider'

// Meta switches v21.0 off on 21 Jan 2027; v26.0 runs until 2028 or later.
export const GRAPH_VERSION = 'v26.0'

/** Error codes where retrying the identical request cannot help. */
const PERMANENT_CODES = new Set([
  131047, // re-engagement required: the 24h window closed
  131026, // undeliverable — the number is not on WhatsApp
  132000, // template param count mismatch
  132001, // template does not exist in this language
  132005, // template param text too long
  132018, // invalid template parameters (reported from v23.0)
  131051, // unsupported message type
  100,    // malformed request
])

export const metaCloudProvider: WhatsAppProvider = {
  name: 'meta_cloud',

  async send(message: TemplateMessage, creds: WhatsAppCredentials): Promise<SendResult> {
    if (!creds.phoneNumberId || !creds.accessToken) {
      return { ok: false, error: 'WhatsApp is not configured yet', retryable: false }
    }

    const components: Record<string, unknown>[] = []

    if (message.bodyParams.length > 0) {
      components.push({
        type: 'body',
        parameters: message.bodyParams.map(text => ({ type: 'text', text })),
      })
    }

    if (message.urlButtonParam) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: message.urlButtonParam }],
      })
    }

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: message.to,
      type: 'template',
      template: {
        name: message.templateName,
        language: { code: message.languageCode || 'en' },
        ...(components.length > 0 ? { components } : {}),
      },
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          // A send that hangs must not hold the whole batch. The outbox will
          // pick it up again on the next tick.
          signal: AbortSignal.timeout(15_000),
        },
      )

      const json = await res.json().catch(() => ({} as Record<string, unknown>))

      if (res.ok) {
        const id = (json as { messages?: { id?: string }[] })?.messages?.[0]?.id
        return { ok: true, providerMessageId: id }
      }

      const err = (json as { error?: { message?: string; code?: number; error_data?: { details?: string } } }).error
      const code = err?.code
      const detail = err?.error_data?.details

      return {
        ok: false,
        error: [err?.message, detail, code ? `(code ${code})` : null].filter(Boolean).join(' — ')
               || `HTTP ${res.status}`,
        retryable: isRetryableStatus(res.status) && !(code && PERMANENT_CODES.has(code)),
      }
    } catch (e) {
      // Network failure or timeout: worth another go on the next tick.
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Network error reaching WhatsApp',
        retryable: true,
      }
    }
  },
}

/**
 * Verify Meta's X-Hub-Signature-256 on an inbound webhook.
 *
 * Without this, anyone who learns the callback URL can post fake delivery
 * receipts, or a fake STOP that silently opts a family out of every future
 * message. `timingSafeEqual` because a plain comparison leaks the signature a
 * byte at a time.
 */
export async function verifyMetaSignature(
  rawBody: string, header: string | null, appSecret: string,
): Promise<boolean> {
  if (!header || !appSecret) return false
  const expected = header.startsWith('sha256=') ? header.slice(7) : header

  const crypto = await import('node:crypto')
  const digest = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')

  const a = Buffer.from(digest, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
