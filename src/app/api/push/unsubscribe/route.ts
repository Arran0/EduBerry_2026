import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { adminClient, callerUserId } from '@/lib/serverAuth'

/** Forget one device. Scoped to the caller so nobody can unsubscribe others. */
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
  const endpoint = body?.endpoint
  if (typeof endpoint !== 'string' || !endpoint) {
    return NextResponse.json({ success: false, error: 'Missing endpoint' }, { status: 400 })
  }

  const { error } = await client
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', userId)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
