import 'server-only'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { isEmailConfigured, isPlausibleEmail, platformName, sendEmail } from './cloudflare'
import { renderAccountEmail, senderDisplayName, type AccountEmailKind } from './templates'

// ─────────────────────────────────────────────────────────────────────────────
// Invite and password-reset emails, sent by us instead of Supabase Auth.
//
// Supabase's built-in mailer can only say what its dashboard template says, and
// on the default SMTP it is rate limited to a handful of mails an hour. So the
// server asks Auth for the one-time token with admin.generateLink (which sends
// nothing) and mails its own branded link through Cloudflare.
//
// The link points at this site's /update-password with the token hash rather
// than at Supabase's /verify endpoint. The page redeems it with verifyOtp from
// JavaScript, so a mail scanner that pre-fetches links (Outlook Safe Links,
// Gmail's image proxy) can't burn the token before the person clicks.
// ─────────────────────────────────────────────────────────────────────────────

export { isEmailConfigured }

interface SchoolIdentity {
  schoolName: string
  logoUrl: string | null
  accentColor: string | null
  schoolEmail: string | null
}

/** School name, logo and contact from site_settings, read with the service role. */
export async function loadSchoolIdentity(admin: SupabaseClient): Promise<SchoolIdentity> {
  const { data } = await admin
    .from('site_settings')
    .select('key, value')
    .in('key', ['branding', 'school_profile'])

  const byKey = new Map<string, Record<string, unknown>>()
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    if (row.value && typeof row.value === 'object') byKey.set(row.key, row.value as Record<string, unknown>)
  }
  const branding = byKey.get('branding') ?? {}
  const profile = byKey.get('school_profile') ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  return {
    schoolName: str(branding.schoolName) ?? str(branding.appSubtitle) ?? '',
    logoUrl: str(branding.logoUrl),
    accentColor: str(branding.primaryColor),
    schoolEmail: isPlausibleEmail(str(profile.email)) ? str(profile.email) : null,
  }
}

/** The public origin that /update-password links should use. */
export function resolveSiteUrl(request: Request, fallback: string): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
    || request.headers.get('origin')
    || fallback
}

export type AccountEmailResult =
  | { sent: true; user: User | null }
  /** actionUrl is set when the link was made but the mail failed, so an admin can hand it over. */
  | { sent: false; user: User | null; error: string; actionUrl?: string }

interface SendAccountEmailOptions {
  email: string
  kind: AccountEmailKind
  /**
   * Which wording to use, when it differs from the token type: a reset link
   * sent to someone who has never signed in reads as "set up your account".
   */
  template?: AccountEmailKind
  siteUrl: string
  /** Stored on the new auth user (invite only) — same as inviteUserByEmail's `data`. */
  metadata?: Record<string, unknown>
  recipientName?: string | null
  /** Reuse across a bulk import instead of re-reading settings per row. */
  identity?: SchoolIdentity
}

/**
 * Mint an invite or recovery token and email it. For `invite` this also creates
 * the auth user, exactly like inviteUserByEmail does; `user` is returned even
 * when the mail itself fails so the caller can still finish the profile.
 */
export async function sendAccountEmail(
  admin: SupabaseClient,
  opts: SendAccountEmailOptions,
): Promise<AccountEmailResult> {
  const redirectTo = `${opts.siteUrl}/update-password`
  const { data, error } = opts.kind === 'invite'
    ? await admin.auth.admin.generateLink({
        type: 'invite', email: opts.email, options: { data: opts.metadata, redirectTo },
      })
    : await admin.auth.admin.generateLink({
        type: 'recovery', email: opts.email, options: { redirectTo },
      })

  if (error || !data?.properties?.hashed_token) {
    return { sent: false, user: data?.user ?? null, error: error?.message || 'Could not create the link' }
  }

  const actionUrl = `${redirectTo}?${new URLSearchParams({
    token_hash: data.properties.hashed_token,
    type: opts.kind,
  })}`

  const identity = opts.identity ?? await loadSchoolIdentity(admin)
  const platform = platformName()
  const rendered = renderAccountEmail({
    kind: opts.template ?? opts.kind,
    schoolName: identity.schoolName,
    platformName: platform,
    actionUrl,
    recipientName: opts.recipientName ?? (data.user?.user_metadata?.full_name as string | undefined),
    logoUrl: identity.logoUrl,
    schoolEmail: identity.schoolEmail,
    accentColor: identity.accentColor,
  })

  const result = await sendEmail({
    to: opts.email,
    fromName: senderDisplayName(identity.schoolName, platform),
    // Replies go to the school office, not to our no-reply mailbox.
    replyTo: identity.schoolEmail,
    ...rendered,
  })

  return result.ok
    ? { sent: true, user: data.user ?? null }
    : { sent: false, user: data.user ?? null, error: result.error, actionUrl }
}
