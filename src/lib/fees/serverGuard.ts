import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, callerUserId } from '@/lib/serverAuth'
import type { FeePermissionKey } from './permissions'

/**
 * Every fee route starts the same way: service-role client, authenticated
 * caller, and the one permission that route needs.
 *
 * This is `src/lib/payroll/serverGuard.ts` with a permission key instead of a
 * role check. Fees move money and the whole point of Round 1 is that "is an
 * admin" is not the question — "may this person reverse a payment" is. Keeping
 * it in one place means a new route cannot forget to ask.
 *
 * The RPCs the route then calls re-check with `fee_requires()`, which accepts a
 * service-role caller precisely because it has been through here first. Two
 * layers, one of which is the database, so a route that forgets still cannot
 * write past RLS.
 */
export async function requireFeePermission(
  request: NextRequest,
  key: FeePermissionKey,
): Promise<
  | { ok: true; db: SupabaseClient; userId: string }
  | { ok: false; response: NextResponse }
> {
  const db = adminClient()
  if (!db) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 }),
    }
  }

  const userId = await callerUserId(db, request)
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const { data, error } = await db.rpc('has_fee_permission_for', { p_user: userId, p_key: key })
  if (error || data !== true) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: `This action needs the "${key}" fee permission.` },
        { status: 403 }),
    }
  }

  return { ok: true, db, userId }
}


