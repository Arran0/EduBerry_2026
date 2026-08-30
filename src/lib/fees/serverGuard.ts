import 'server-only'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, callerUserId } from '@/lib/serverAuth'

// ============================================================================
// Route guards for the fee module.
// ----------------------------------------------------------------------------
// Every fee route starts the same way: service-role client, authenticated
// caller, and a check of what that caller is allowed to do. Fees move money, so
// this is deliberately strict and deliberately in one place rather than copied
// into each route — which is how the current module ended up with three
// webhooks that each check something slightly different.
//
// The capability check reads fee_permissions where that table exists (added in
// fees_v2_rbac_audit.sql) and falls back to "admin can do everything" until it
// does, so this file is safe to deploy before that migration is run.
// ============================================================================

export type FeeCapability =
  | 'issue_fee'
  | 'record_payment'
  | 'verify_payment'
  | 'cancel_fee'
  | 'cancel_receipt'
  | 'request_concession'
  | 'approve_concession'
  | 'request_refund'
  | 'approve_refund'
  | 'publish_structure'
  | 'run_demand'
  | 'view_reports'
  | 'export_accounting'

export interface FeeActor {
  db: SupabaseClient
  userId: string
  role: string
}

type Guard = { ok: true; actor: FeeActor } | { ok: false; response: NextResponse }

function deny(message: string, status: number): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ success: false, error: message }, { status }) }
}

/** A service-role client, or a 500 — used by webhooks, which have no caller. */
export function serviceClient(): { ok: true; db: SupabaseClient } | { ok: false; response: NextResponse } {
  const db = adminClient()
  if (!db) return deny('Server not configured', 500)
  return { ok: true, db }
}

/** Identify the caller and load their role. */
export async function requireCaller(request: NextRequest): Promise<Guard> {
  const db = adminClient()
  if (!db) return deny('Server not configured', 500)

  const userId = await callerUserId(db, request)
  if (!userId) return deny('Unauthorized', 401)

  const { data: profile } = await db.from('profiles').select('role, is_banned').eq('id', userId).maybeSingle()
  if (!profile) return deny('Unauthorized', 401)
  if (profile.is_banned) return deny('This account is suspended.', 403)

  return { ok: true, actor: { db, userId, role: profile.role as string } }
}

/**
 * Require a specific capability. Falls back to role === 'admin' until
 * fee_permissions exists, so behaviour before and after that migration is the
 * same for an admin and closed for everyone else.
 */
export async function requireCapability(request: NextRequest, capability: FeeCapability): Promise<Guard> {
  const caller = await requireCaller(request)
  if (!caller.ok) return caller

  const { db, role } = caller.actor
  const { data, error } = await db
    .from('fee_permissions').select('role').eq('role', role).eq('capability', capability).maybeSingle()

  // The table not existing yet is not an authorisation failure; it is the
  // pre-RBAC world, where admin does everything.
  if (error) {
    if (role !== 'admin') return deny('You do not have permission to do this.', 403)
    return caller
  }
  if (!data) return deny(`Your role (${role}) is not permitted to ${capability.replace(/_/g, ' ')}.`, 403)
  return caller
}

/** Shorthand for the many routes that are simply admin-only. */
export async function requireFeeAdmin(request: NextRequest): Promise<Guard> {
  const caller = await requireCaller(request)
  if (!caller.ok) return caller
  if (caller.actor.role !== 'admin') return deny('Admin access required', 403)
  return caller
}

/**
 * A payer acting on a fee. Returns the fee when the caller is its student, a
 * linked family payer, or an admin — the three people who legitimately may pay
 * a given bill.
 */
export async function requirePayerFor(
  request: NextRequest,
  source: 'school' | 'bus',
  feeId: string,
): Promise<
  | { ok: true; actor: FeeActor; fee: { id: string; student_id: string; amount: number; status: string; upi_reference: string } }
  | { ok: false; response: NextResponse }
> {
  const caller = await requireCaller(request)
  if (!caller.ok) return caller
  const { db, userId, role } = caller.actor

  const table = source === 'school' ? 'school_fees' : 'bus_fees'
  const studentCol = source === 'school' ? 'student_id' : 'passenger_id'

  const { data: raw } = await db
    .from(table).select(`id, ${studentCol}, amount, status, upi_reference`).eq('id', feeId).maybeSingle()
  if (!raw) return deny('Fee not found', 404)

  const fee = {
    id: raw.id as string,
    student_id: (raw as Record<string, unknown>)[studentCol] as string,
    amount: Number((raw as Record<string, unknown>).amount) || 0,
    status: (raw as Record<string, unknown>).status as string,
    upi_reference: (raw as Record<string, unknown>).upi_reference as string,
  }

  if (fee.student_id === userId || role === 'admin') return { ok: true, actor: caller.actor, fee }

  // A parent paying for their child. Both must be in the same family, and the
  // caller must be recorded as a payer rather than merely present — a sibling
  // is in the family too and is not a payer.
  const { data: link } = await db
    .from('fee_family_members')
    .select('family_id, role')
    .eq('profile_id', userId)
    .eq('role', 'payer')
  const familyIds = (link ?? []).map(l => l.family_id as string)
  if (familyIds.length) {
    const { data: child } = await db
      .from('fee_family_members')
      .select('id')
      .eq('profile_id', fee.student_id)
      .eq('role', 'student')
      .in('family_id', familyIds)
      .maybeSingle()
    if (child) return { ok: true, actor: caller.actor, fee }
  }

  return deny('This fee is not yours', 403)
}
