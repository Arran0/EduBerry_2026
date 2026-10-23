import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { adminClient, callerUserId } from '@/lib/serverAuth'
import { ensureReminderRuntime, resolveWhatsAppCredentials } from '@/lib/whatsapp/reminderServer'

export const runtime = 'nodejs'

const STAFF = new Set(['admin', 'principal', 'coordinator', 'teacher'])

/**
 * What a reminder popup asks when it opens: is WhatsApp connected, and is the
 * timer able to reach the sender?
 *
 * Opening it is also what sets the timer up. The first time any member of
 * staff opens a reminder popup, the drain's address (from this request) and a
 * freshly minted secret are written to wa_runtime_config — which is how a
 * school gets working automatic reminders without anybody running SQL.
 */
export async function GET(request: NextRequest) {
  const db = adminClient()
  if (!db) return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })

  const userId = await callerUserId(db, request)
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await db.from('profiles').select('role').eq('id', userId).maybeSingle()
  if (!STAFF.has(String(me?.role ?? ''))) {
    return NextResponse.json({ success: false, error: 'Staff only' }, { status: 403 })
  }

  const [{ drainReady }, creds] = await Promise.all([
    ensureReminderRuntime(db, request.nextUrl.origin),
    resolveWhatsAppCredentials(db),
  ])

  return NextResponse.json({ success: true, connected: creds.connected, drainReady })
}
