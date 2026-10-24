import 'server-only'

// ─────────────────────────────────────────────────────────────────────────────
// Outbound email through Cloudflare Email Service (REST API).
//
// These are platform credentials, not school ones: every school deployment
// sends from the same verified company domain, so they live in env vars set by
// us at deploy time and deliberately have no in-app settings screen or
// integration_secrets fallback. A school can't point mail at another domain.
//
//   CLOUDFLARE_ACCOUNT_ID       the account that owns the sending domain
//   CLOUDFLARE_EMAIL_API_TOKEN  API token with Email Sending permission
//   EMAIL_FROM_ADDRESS          e.g. no-reply@mail.eduberry.in (onboarded domain)
//   EMAIL_PLATFORM_NAME         optional, defaults to "EduBerry"
//
// With any of the first three missing, isEmailConfigured() is false and the
// callers fall back to Supabase Auth's own mailer, as before.
// ─────────────────────────────────────────────────────────────────────────────

export interface OutboundEmail {
  to: string
  fromName: string
  replyTo?: string | null
  subject: string
  html: string
  text: string
}

export type SendResult =
  | { ok: true }
  | { ok: false; error: string; retryable: boolean }

export function isEmailConfigured(): boolean {
  return !!(process.env.CLOUDFLARE_ACCOUNT_ID
    && process.env.CLOUDFLARE_EMAIL_API_TOKEN
    && process.env.EMAIL_FROM_ADDRESS)
}

export function platformName(): string {
  return process.env.EMAIL_PLATFORM_NAME?.trim() || 'EduBerry'
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/

export function isPlausibleEmail(s: string | null | undefined): s is string {
  return !!s && EMAIL_RE.test(s.trim())
}

export async function sendEmail(msg: OutboundEmail): Promise<SendResult> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_EMAIL_API_TOKEN
  const fromAddress = process.env.EMAIL_FROM_ADDRESS
  if (!accountId || !token || !fromAddress) {
    return { ok: false, error: 'Email sending is not configured', retryable: false }
  }

  const body: Record<string, unknown> = {
    from: { address: fromAddress, name: msg.fromName },
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  }
  if (isPlausibleEmail(msg.replyTo)) body.reply_to = msg.replyTo.trim()

  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`

  // One retry on throttling / a 5xx; anything else needs a fix, not a retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      if (attempt === 0) continue
      return { ok: false, error: `Email service unreachable: ${(err as Error).message}`, retryable: true }
    }

    const json = await res.json().catch(() => null) as
      | { success?: boolean; errors?: { code: number; message: string }[]; result?: { permanent_bounces?: string[] } }
      | null

    if (res.ok && json?.success) {
      if (json.result?.permanent_bounces?.length) {
        return { ok: false, error: 'The address bounced permanently', retryable: false }
      }
      return { ok: true }
    }

    const retryable = res.status === 429 || res.status >= 500
    const detail = json?.errors?.map(e => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`
    if (retryable && attempt === 0) {
      await new Promise(r => setTimeout(r, 1000))
      continue
    }
    console.error('Cloudflare email send failed:', detail)
    return { ok: false, error: `Email not sent (${detail})`, retryable }
  }
  return { ok: false, error: 'Email not sent', retryable: true }
}
