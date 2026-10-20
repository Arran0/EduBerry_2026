import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

// Append one entry to admin_audit_log (see supabase-migrations/add_admin_audit_log.sql).
//
// Called after the action has succeeded, with the service-role client. A failed
// log write is reported but never undoes or blocks the action itself — the
// admin already did it, and refusing to say so would only lose the record.

export interface AdminAuditEntry {
  actorId: string
  action: string
  targetId?: string | null
  details?: Record<string, unknown>
}

export async function logAdminAction(
  admin: SupabaseClient,
  request: NextRequest,
  entry: AdminAuditEntry,
): Promise<void> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null

  const { error } = await admin.from('admin_audit_log').insert({
    actor_id: entry.actorId,
    action: entry.action,
    target_id: entry.targetId ?? null,
    details: entry.details ?? null,
    ip,
  })
  if (error) console.error(`admin audit write failed (${entry.action}):`, error)
}
