import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { adminClient } from '@/lib/serverAuth'
import { drainReminders, sameSecret } from '@/lib/whatsapp/reminderServer'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * The reminder outbox worker.
 *
 * Called every minute by wa_kick_drain() through pg_net — and only when
 * something is queued, so a quiet minute costs a COUNT, not an invocation.
 * Authenticated with the secret in wa_runtime_config, which the app minted
 * itself (see ensureReminderRuntime); there is no user on a cron call.
 */
export async function POST(request: NextRequest) {
  const db = adminClient()
  if (!db) return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })

  const { data } = await db.from('wa_runtime_config').select('value').eq('key', 'cron_secret').maybeSingle()
  const expected = (data?.value as string | null) ?? null
  if (!expected || !sameSecret(request.headers.get('x-cron-secret'), expected)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const limit = await request.json()
    .then((b: { limit?: number }) => Math.min(Math.max(Number(b?.limit) || 50, 1), 100))
    .catch(() => 50)

  try {
    const result = await drainReminders(db, limit)
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 })
  }
}
