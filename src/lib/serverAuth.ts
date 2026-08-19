import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

/**
 * Shared server-side helper: build a service-role client and identify the
 * caller from their Bearer token. Mirrors the pattern used by the admin
 * routes, which each rebuild this inline.
 */
export function adminClient(): SupabaseClient | null {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) return null

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Resolves the caller's user id from the Authorization header, or null. */
export async function callerUserId(
  client: SupabaseClient,
  request: NextRequest,
): Promise<string | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const { data: { user }, error } = await client.auth.getUser(authHeader.slice(7))
  if (error || !user) return null
  return user.id
}
