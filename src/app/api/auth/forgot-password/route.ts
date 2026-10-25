import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { adminClient as makeAdminClient } from '@/lib/serverAuth'
import { isEmailConfigured, resolveSiteUrl, sendAccountEmail } from '@/lib/email/accountEmails'

// Public "Forgot your password?" from the login page.
//
// Always answers the same way whether or not the address has an account, so
// the form can't be used to find out who is enrolled. When Cloudflare sending
// isn't configured it says so ({ fallback: true }) and the page uses Supabase's
// own resetPasswordForEmail, exactly as before.
//
// Abuse limits: mail only ever goes to an existing account's own address, at
// most once a minute per address and a few times an hour per IP. The counters
// are per server instance — enough to stop a script hammering one address, not
// a substitute for the edge rate limiting a busy deployment should add.

const PER_EMAIL_MS = 60_000
const PER_IP_WINDOW_MS = 60 * 60_000
const PER_IP_MAX = 10

const lastByEmail = new Map<string, number>()
const hitsByIp = new Map<string, number[]>()

function allow(ip: string, email: string, now: number): boolean {
  const last = lastByEmail.get(email)
  if (last && now - last < PER_EMAIL_MS) return false
  const hits = (hitsByIp.get(ip) ?? []).filter(t => now - t < PER_IP_WINDOW_MS)
  if (hits.length >= PER_IP_MAX) { hitsByIp.set(ip, hits); return false }
  hits.push(now)
  hitsByIp.set(ip, hits)
  lastByEmail.set(email, now)
  // Keep the maps from growing without bound on a long-lived instance.
  if (lastByEmail.size > 5000) lastByEmail.clear()
  if (hitsByIp.size > 5000) hitsByIp.clear()
  return true
}

export async function POST(request: NextRequest) {
  if (!isEmailConfigured()) return NextResponse.json({ success: true, fallback: true })

  const adminClient = makeAdminClient()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!adminClient || !supabaseUrl) return NextResponse.json({ success: true, fallback: true })

  const body = await request.json().catch(() => ({}))
  const email: string = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !email.includes('@')) {
    return NextResponse.json({ success: false, error: 'Enter a valid email address' }, { status: 400 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
  if (!allow(ip, email, Date.now())) return NextResponse.json({ success: true })

  // Only existing members get mail. profiles.email can keep its original
  // casing, so match case-insensitively (with LIKE wildcards escaped).
  const pattern = email.replace(/[\\%_]/g, c => `\\${c}`)
  const { data: profile } = await adminClient
    .from('profiles')
    .select('id, full_name')
    .ilike('email', pattern)
    .limit(1)
    .maybeSingle()

  if (profile) {
    const result = await sendAccountEmail(adminClient, {
      email,
      kind: 'recovery',
      siteUrl: resolveSiteUrl(request),
      recipientName: profile.full_name,
    })
    if (!result.sent) console.error('forgot-password email failed:', result.error)
  }

  return NextResponse.json({ success: true })
}
