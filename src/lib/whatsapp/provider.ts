// ─────────────────────────────────────────────────────────────────────────────
// The WhatsApp provider interface.
//
// One interface, one implementation (Meta's Cloud API). It exists as an
// interface anyway because the alternative to Meta is an Indian BSP —
// Gupshup, Interakt, AiSensy — and they differ only in the shape of one HTTP
// call. Swapping is then this file plus one sibling, not a rewrite of the
// worker, the templates, the outbox and the webhook.
// ─────────────────────────────────────────────────────────────────────────────

export interface WhatsAppCredentials {
  phoneNumberId: string
  accessToken: string
  appSecret?: string
  verifyToken?: string
}

export interface TemplateMessage {
  /** E.164 without the plus, e.g. 919876543210. */
  to: string
  /** The name registered in WhatsApp Manager, not our internal key. */
  templateName: string
  languageCode: string
  /**
   * Positional body parameters. Meta's template messages are positional, so
   * this order is the contract with `message_templates.variable_order`.
   */
  bodyParams: string[]
  /**
   * The dynamic part of a URL button, when the template has one. Meta takes
   * only the suffix — the rest of the URL is fixed at template registration.
   */
  urlButtonParam?: string
}

export interface SendResult {
  ok: boolean
  /** Meta's message id, stored so a delivery receipt can be matched back. */
  providerMessageId?: string
  error?: string
  /** True when retrying could plausibly work: a timeout, a 429, a 5xx. */
  retryable?: boolean
}

export interface WhatsAppProvider {
  readonly name: string
  send(message: TemplateMessage, creds: WhatsAppCredentials): Promise<SendResult>
}

/**
 * Fill `{{name}}` placeholders from a variables object, in the order the
 * template declares.
 *
 * A missing variable becomes an empty string rather than the literal
 * `{{amount}}`, because Meta rejects a parameter containing new lines or four
 * consecutive spaces and a visible placeholder in a parent's message is worse
 * than a gap.
 */
export function orderedParams(
  variables: Record<string, unknown>,
  order: string[] | null | undefined,
): string[] {
  if (!order || order.length === 0) return []
  return order.map(key => {
    const v = variables?.[key]
    return v === null || v === undefined ? '' : String(v)
  })
}

/** Whether an HTTP status is worth trying again. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}
