import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { adminClient } from '@/lib/serverAuth'

export const runtime = 'nodejs'

/**
 * Verify a printed invoice or receipt. No login.
 *
 * This is the strongest anti-fraud measure in the module: anyone holding the
 * paper — a parent, a bank, an auditor — can check it against the school's own
 * records. The RPC re-computes the receipt's hash rather than trusting the
 * stored one, so a row altered in the database shows as ALTERED rather than
 * quietly passing.
 *
 * It returns only what is already printed on the document, so there is nothing
 * here that a person holding it does not already have.
 */
export async function GET(_request: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const db = adminClient()
  if (!db) {
    return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })
  }

  const token = (params.token ?? '').trim()
  if (!token || token.length > 128) {
    return NextResponse.json({ success: false, error: 'Not a valid verification code' }, { status: 400 })
  }

  const { data, error } = await db.rpc('fee_verify_document', { p_token: token })
  if (error) {
    return NextResponse.json({ success: false, error: 'Could not verify that code' }, { status: 500 })
  }

  return NextResponse.json({ success: true, ...(data as Record<string, unknown>) })
}
