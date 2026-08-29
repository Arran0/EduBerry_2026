import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, callerUserId } from '@/lib/serverAuth'

/**
 * Every payroll route starts the same way: service-role client, authenticated
 * caller, admin role. Payroll writes money, so this is deliberately strict and
 * deliberately in one place rather than copied into each route.
 */
export async function requireAdmin(request: NextRequest): Promise<
  { ok: true; db: SupabaseClient; userId: string } | { ok: false; response: NextResponse }
> {
  const db = adminClient()
  if (!db) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 }) }
  }
  const userId = await callerUserId(db, request)
  if (!userId) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) }
  }
  const { data: profile } = await db.from('profiles').select('role').eq('id', userId).single()
  if (profile?.role !== 'admin') {
    return { ok: false, response: NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 }) }
  }
  return { ok: true, db, userId }
}
