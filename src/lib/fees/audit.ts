import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

// ============================================================================
// The fee audit trail.
// ----------------------------------------------------------------------------
// Who changed which fee, concession, refund or structure, when, and from what.
// Written only from server routes with the service role — a log its own subject
// can author is not evidence, so there is deliberately no INSERT policy for any
// role on fee_audit_log.
//
// DPDP: `before`/`after` carry only the fields that actually changed, never the
// whole row. An audit log that copies every column of every write becomes a
// second, less-protected copy of the student database, and the minimising
// choice here is also the correct one. Retention is 180 days
// (fees_v2_rbac_audit.sql schedules the prune).
// ============================================================================

export type AuditEntityType =
  | 'fee' | 'fee_head' | 'fee_structure' | 'fee_structure_item'
  | 'fee_policy_group' | 'fee_assignment' | 'fee_concession'
  | 'fee_payment' | 'fee_refund' | 'fee_receipt' | 'fee_demand_run'
  | 'fee_transaction' | 'fee_family'

export interface AuditInput {
  actorId: string | null
  action: string
  entityType: AuditEntityType
  entityId?: string | null
  studentId?: string | null
  /** One line an admin can read in a list without opening the diff. */
  summary?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  request?: NextRequest
}

/**
 * Append an audit entry. Never throws and never blocks the caller's result: a
 * failed audit write must be loud in the logs but must not roll back a payment
 * that actually happened. The reverse — losing the money to keep the log tidy —
 * is the worse failure.
 */
export async function auditFeeAction(db: SupabaseClient, input: AuditInput): Promise<void> {
  try {
    let actorRole: string | null = null
    if (input.actorId) {
      const { data } = await db.from('profiles').select('role').eq('id', input.actorId).maybeSingle()
      actorRole = (data?.role as string) ?? null
    }

    await db.from('fee_audit_log').insert({
      actor_id: input.actorId,
      actor_role: actorRole,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      student_id: input.studentId ?? null,
      summary: input.summary ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      ip: clientIp(input.request),
      user_agent: input.request?.headers.get('user-agent') ?? null,
    })
  } catch (e) {
    console.error('auditFeeAction failed (the action itself was not rolled back):', e)
  }
}

/**
 * The changed fields only, as a before/after pair. Keys whose value is
 * unchanged are dropped entirely, so the log records the change rather than the
 * record.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
  fields: (keyof T)[],
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}
  for (const f of fields) {
    const bv = before?.[f]
    const av = after?.[f]
    if (JSON.stringify(bv) === JSON.stringify(av)) continue
    b[f as string] = bv ?? null
    a[f as string] = av ?? null
  }
  return { before: b, after: a }
}

/**
 * Behind Vercel and most proxies the socket address is the proxy's, so the
 * first hop in x-forwarded-for is the real client. Trusting the whole header
 * would let a caller spoof it, hence [0] and nothing else.
 */
function clientIp(request?: NextRequest): string | null {
  if (!request) return null
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')
}
