import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { adminClient } from '@/lib/serverAuth'

export const runtime = 'nodejs'

/**
 * Resolve a tokenised pay link. No login.
 *
 * The RPC returns only what is printed on the bill — no student id, no profile,
 * nothing that could be walked to another family's record — and records that
 * the link was opened, which is what the reminder log's "seen" column is built
 * from.
 */
export async function GET(_request: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const db = adminClient()
  if (!db) {
    return NextResponse.json({ success: false, ok: false, reason: 'not_found' }, { status: 500 })
  }

  const token = (params.token ?? '').trim()
  if (!token || token.length > 128) {
    return NextResponse.json({ success: true, ok: false, reason: 'not_found' })
  }

  const { data, error } = await db.rpc('fee_resolve_pay_link', { p_token: token })
  if (error) {
    return NextResponse.json({ success: true, ok: false, reason: 'not_found' })
  }

  return NextResponse.json({ success: true, ...(data as Record<string, unknown>) })
}
