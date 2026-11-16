import 'server-only'
import { render } from '../templates'
import type { SendResult, WhatsAppMessage, WhatsAppProvider } from './provider'

const GRAPH_VERSION = 'v26.0'

/**
 * The Graph API version to call. A version saved in the school's settings is
 * used only if it is at least v26.0: Meta switches v21.0 off on 21 Jan 2027,
 * and an old saved value must not pin the school to a version that stops working.
 */
export function graphVersion(configured: string | undefined): string {
  const m = /^v(\d+)\.(\d+)$/.exec((configured ?? '').trim())
  return m && Number(m[1]) >= 26 ? `v${m[1]}.${m[2]}` : GRAPH_VERSION
}

/**
 * Meta WhatsApp Cloud API.
 *
 * Business-initiated messages must use a template Meta has approved, which is
 * why `message_templates.provider_template_name` exists: our stable key
 * (`transport.child_not_boarded`) maps to whatever name the school got approved,
 * and `variable_order` maps our named variables onto Meta's positional
 * {{1}}…{{n}} body parameters.
 */
export const metaCloud: WhatsAppProvider = {
  slug: 'meta_cloud',

  async send(msg: WhatsAppMessage, config: Record<string, string>): Promise<SendResult> {
    const phoneNumberId = config.phone_number_id
    const token = config.access_token
    const version = graphVersion(config.api_version)

    if (!phoneNumberId || !token) {
      return { ok: false, error: 'WhatsApp is not configured', retryable: false }
    }

    const name = msg.template?.provider_template_name
    if (!name) {
      // No approved template name yet. Failing loudly and permanently is right:
      // Meta would reject it anyway, and a retry loop would just burn attempts
      // while the school waits for approval.
      return {
        ok: false,
        error: 'No approved WhatsApp template name for this event yet',
        retryable: false,
      }
    }

    const order = msg.template?.variable_order ?? []
    const parameters = order.map(key => ({
      type: 'text',
      text: String(msg.variables[key] ?? ''),
    }))

    const body = {
      messaging_product: 'whatsapp',
      to: msg.to,
      type: 'template',
      template: {
        name,
        language: { code: msg.template?.provider_template_lang || 'en' },
        components: parameters.length > 0
          ? [{ type: 'body', parameters }]
          : [],
      },
    }

    try {
      const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        const err = (json as { error?: { message?: string; code?: number } }).error
        // 4xx other than rate limiting is a problem with the message, not the
        // connection, so there is nothing to gain from trying again.
        const retryable = res.status === 429 || res.status >= 500
        return { ok: false, error: err?.message ?? `HTTP ${res.status}`, retryable }
      }

      const id = (json as { messages?: { id: string }[] }).messages?.[0]?.id
      return { ok: true, providerMessageId: id, retryable: false }
    } catch (e) {
      return { ok: false, error: (e as Error).message, retryable: true }
    }
  },
}

/** Free-form body, used only inside the 24-hour service window. */
export function freeFormBody(msg: WhatsAppMessage): string {
  return render(msg.template?.body_template, msg.variables) || msg.fallbackBody
}
