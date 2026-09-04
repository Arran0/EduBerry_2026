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

/**
 * A route that needs several permissions at once.
 *
 * Reports the first one the caller is missing rather than a generic refusal, so
 * an administrator can fix it without guessing which of four switches is off.
 */
export async function requireFeePermissions(
  request: NextRequest,
  keys: FeePermissionKey[],
): Promise<
  | { ok: true; db: SupabaseClient; userId: string }
  | { ok: false; response: NextResponse }
> {
  const first = await requireFeePermission(request, keys[0])
  if (!first.ok) return first

  for (const key of keys.slice(1)) {
    const { data } = await first.db.rpc('has_fee_permission_for', {
      p_user: first.userId, p_key: key,
    })
    if (data !== true) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: `This action needs the "${key}" fee permission.` },
          { status: 403 }),
      }
    }
  }
  return first
}

/**
 * Whether the caller may see amounts.
 *
 * Routes that return money call this and null the figures out when it is false.
 * The database views do the same for direct reads; a route assembling its own
 * response has to remember, which is why this is one line to call.
 */
export async function callerSeesAmounts(
  db: SupabaseClient, userId: string,
): Promise<boolean> {
  const { data } = await db.rpc('has_fee_permission_for', {
    p_user: userId, p_key: 'fees.view_amounts',
  })
  return data === true
}
