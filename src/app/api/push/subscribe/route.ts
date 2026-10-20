import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { adminClient, callerUserId } from '@/lib/serverAuth'

// The server later POSTs to this URL (web-push), so it must be a real browser
// push service rather than any address a caller chooses.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                 // Chrome, Edge (Chromium), Opera, Samsung
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/,               // Safari / iOS PWAs
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,               // legacy Edge / WNS
]

function isPushServiceUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && PUSH_HOSTS.some(re => re.test(url.hostname))
  } catch {
    return false
  }
}

/** Enrol one browser/device for Web Push against the calling user. */
export async function POST(request: NextRequest) {
  const client = adminClient()
  if (!client) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 })
  }

  const userId = await callerUserId(client, request)
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const subscription = body?.subscription
  const endpoint = subscription?.endpoint
  const p256dh    = subscription?.keys?.p256dh
  const auth      = subscription?.keys?.auth

  if (typeof endpoint !== 'string' || !isPushServiceUrl(endpoint) || !p256dh || !auth) {
    return NextResponse.json({ success: false, error: 'Invalid subscription' }, { status: 400 })
  }

  // The endpoint is unique, so re-subscribing the same browser (or a device
  // that changed hands) updates the row rather than duplicating it.
  const { error } = await client
    .from('push_subscriptions')
    .upsert({
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: typeof body?.userAgent === 'string' ? body.userAgent.slice(0, 400) : null,
      last_used_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' })

  if (error) {
    console.error('push subscribe failed:', error)
    return NextResponse.json({ success: false, error: 'Could not save subscription' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
