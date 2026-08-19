import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { adminClient, callerUserId } from '@/lib/serverAuth'

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

  if (!endpoint || !p256dh || !auth) {
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
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
