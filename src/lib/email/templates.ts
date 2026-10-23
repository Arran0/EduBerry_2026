// ─────────────────────────────────────────────────────────────────────────────
// Account emails: the invite ("set up your password") and the reset.
//
// Pure functions with no Supabase or network import, so they can be unit
// tested and previewed. Every email goes out from the platform's own domain
// (see src/lib/email/cloudflare.ts); the school appears in the display name,
// the heading and the body, never as the sending address. That keeps SPF,
// DKIM and DMARC on one domain we control instead of asking every school to
// set DNS records up for us.
// ─────────────────────────────────────────────────────────────────────────────

export type AccountEmailKind = 'invite' | 'recovery'

export interface AccountEmailInput {
  kind: AccountEmailKind
  /** The school this account belongs to, e.g. "Muthamil Public School". */
  schoolName: string
  /** The platform the mail is sent through, e.g. "EduBerry". */
  platformName: string
  /** One-time link to /update-password. */
  actionUrl: string
  /** Recipient's name, when known. */
  recipientName?: string | null
  /** Absolute https URL of the school logo, if one is set. */
  logoUrl?: string | null
  /** The school's own contact address, shown as who to ask for help. */
  schoolEmail?: string | null
  /** Brand colour for the button; falls back to a neutral dark. */
  accentColor?: string | null
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Only a plain 3- or 6-digit hex goes into the inline style; anything else
// (an admin typo, a CSS expression) falls back.
const safeColor = (c: string | null | undefined) =>
  c && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : '#18181b'

const safeHttpsUrl = (u: string | null | undefined) => {
  if (!u) return null
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/** "Muthamil Public School via EduBerry" — the From display name. */
export function senderDisplayName(schoolName: string, platformName: string): string {
  // Quotes, angle brackets and line breaks would break the header out of shape.
  const clean = (s: string) => s.replace(/["<>\r\n]/g, '').trim()
  const school = clean(schoolName)
  const platform = clean(platformName)
  return school ? `${school} via ${platform}` : platform
}

export function renderAccountEmail(input: AccountEmailInput): RenderedEmail {
  const school = input.schoolName.trim() || input.platformName
  const platform = input.platformName
  const isInvite = input.kind === 'invite'
  const firstName = input.recipientName?.trim().split(/\s+/)[0] || ''
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,'

  const subject = isInvite
    ? `Set up your ${school} account`
    : `Reset your ${school} password`
  const heading = isInvite ? 'Welcome! Set your password' : 'Reset your password'
  const lead = isInvite
    ? `${school} has created an account for you. Choose a password to activate it and sign in.`
    : `We received a request to reset the password for your ${school} account. Choose a new password using the button below.`
  const button = isInvite ? 'Set my password' : 'Reset my password'
  const ignore = isInvite
    ? `If you weren't expecting this, you can ignore this email.`
    : `If you didn't ask for this, you can ignore this email — your password won't change.`
  const help = input.schoolEmail
    ? `Questions? Contact ${school} at ${input.schoolEmail}.`
    : `Questions? Contact your school office.`
  const footer = `Sent by ${platform} on behalf of ${school}.`

  const text = [
    greeting,
    '',
    lead,
    '',
    `${button}: ${input.actionUrl}`,
    '',
    'This link can be used once and expires soon.',
    ignore,
    '',
    help,
    '',
    '—',
    footer,
  ].join('\n')

  const e = escapeHtml
  const accent = safeColor(input.accentColor)
  const logo = safeHttpsUrl(input.logoUrl)
  const href = e(input.actionUrl)

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="padding:28px 32px 8px;text-align:center;">
${logo ? `<img src="${e(logo)}" alt="" height="56" style="height:56px;max-width:200px;margin-bottom:12px;">` : ''}
<div style="font-size:15px;font-weight:700;color:#3f3f46;">${e(school)}</div>
</td></tr>
<tr><td style="padding:16px 32px 8px;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${e(heading)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${e(greeting)}</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${e(lead)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${accent};">
<a href="${href}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${e(button)}</a>
</td></tr></table>
<p style="margin:24px 0 8px;font-size:13px;line-height:1.6;color:#52525b;">Or paste this link into your browser:<br><a href="${href}" style="color:#52525b;word-break:break-all;">${href}</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#52525b;">This link can be used once and expires soon. ${e(ignore)}</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#52525b;">${e(help)}</p>
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;text-align:center;">${e(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  return { subject, html, text }
}
