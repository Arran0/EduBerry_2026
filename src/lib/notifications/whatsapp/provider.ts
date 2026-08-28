import 'server-only'
import type { MessageTemplate } from '../templates'

/**
 * The WhatsApp provider contract.
 *
 * Deliberately narrow, and deliberately not Meta-shaped: an Indian school is as
 * likely to be onboarded through a BSP (Gupshup, AiSensy, Interakt) as through
 * Meta directly, and which one should be a config value rather than a rewrite.
 * Meta Cloud is simply the first implementation.
 */

export interface WhatsAppMessage {
  /** E.164 digits, no punctuation. */
  to: string
  template: MessageTemplate | null
  variables: Record<string, unknown>
  /** Fallback body when no template row exists — used for the free-form
   *  service window only; a business-initiated message needs a template. */
  fallbackBody: string
}

export interface SendResult {
  ok: boolean
  providerMessageId?: string
  error?: string
  /** False for permanent failures (bad number, template not approved), so the
   *  drain stops retrying instead of burning attempts on a certain failure. */
  retryable: boolean
}

export interface WhatsAppProvider {
  readonly slug: string
  send(msg: WhatsAppMessage, config: Record<string, string>): Promise<SendResult>
}
