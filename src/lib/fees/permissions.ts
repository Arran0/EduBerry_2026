// ─────────────────────────────────────────────────────────────────────────────
// The 28 fee permissions, client side.
//
// The database is the authority — every fee table's RLS calls
// has_fee_permission(), and every API route calls requireFeePermission(). This
// module exists so the interface can stop showing a clerk a Reverse button they
// will only be refused when they press it, and so the settings screen has a
// catalogue to render.
//
// It is not a security boundary. Anything here can be lied to by a modified
// client; nothing here is the only thing standing between a user and an action.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, isMissingRelation } from '@/lib/supabase'

export type FeePermissionKey =
  | 'fees.view' | 'fees.view_amounts'
  | 'fees.config.manage' | 'fees.config.clone_year'
  | 'fees.settings.manage' | 'fees.permissions.manage'
  | 'fees.profile.view' | 'fees.profile.create'
  | 'fees.invoice.generate' | 'fees.invoice.autogen'
  | 'fees.invoice.cancel' | 'fees.invoice.send'
  | 'fees.collect' | 'fees.collect.backdate' | 'fees.receipt.print'
  | 'fees.payment.reverse' | 'fees.instrument.manage'
  | 'fees.discount.apply' | 'fees.discount.approve'
  | 'fees.scholarship.manage' | 'fees.waiver.approve'
  | 'fees.fine.apply' | 'fees.latefee.manage'
  | 'fees.reminder.send'
  | 'fees.refund.approve'
  | 'fees.reports.view' | 'fees.audit.view' | 'fees.rte.manage'

export interface FeePermission {
  key: FeePermissionKey
  label: string
  help: string
  category: string
  sort: number
  is_dangerous: boolean
}

export interface FeeRoleGrant {
  role: string
  permission_key: FeePermissionKey
  granted: boolean
}

export interface FeeUserGrant {
  user_id: string
  permission_key: FeePermissionKey
  granted: boolean
  note: string | null
}

/** The presets the settings screen offers, matching apply_fee_permission_preset(). */
export const FEE_PRESETS = [
  { key: 'clerk',      label: 'Front desk',  help: 'Look a student up, take the money, print the slip. Nothing else — no amounts on reports, no reversal, no price list.' },
  { key: 'accountant', label: 'Accounts',    help: 'Everything operational: bills, collection, cheques, discounts, fines, reminders and reports. Not reversal, not the price list, not this matrix.' },
  { key: 'principal',  label: 'Oversight',   help: 'Approvals and the audit trail, including the payment reversal the counter must not have.' },
  { key: 'full',       label: 'Everything',  help: 'All 28 permissions.' },
  { key: 'none',       label: 'No access',   help: 'Explicitly denies all 28, overriding whatever the role would have given.' },
] as const

export type FeePresetKey = typeof FEE_PRESETS[number]['key']

/**
 * The caller's own permissions, in one round trip rather than 28.
 *
 * Returns an empty set when the migration has not been applied, which reads as
 * "no fee access" and keeps the module hidden rather than crashing a nav bar.
 */
export async function fetchMyFeePermissions(): Promise<Set<FeePermissionKey>> {
  const { data, error } = await supabase.rpc('my_fee_permissions')
  if (error) {
    if (isMissingRelation(error)) return new Set()
    throw error
  }
  return new Set((data ?? []) as FeePermissionKey[])
}

export async function fetchFeePermissionCatalogue(): Promise<FeePermission[]> {
  const { data, error } = await supabase
    .from('fee_permissions')
    .select('key, label, help, category, sort, is_dangerous')
    .order('sort')
  if (error) {
    if (isMissingRelation(error)) return []
    throw error
  }
  return (data ?? []) as FeePermission[]
}

export async function fetchRoleGrants(): Promise<FeeRoleGrant[]> {
  const { data, error } = await supabase
    .from('fee_role_grants')
    .select('role, permission_key, granted')
  if (error) {
    if (isMissingRelation(error)) return []
    throw error
  }
  return (data ?? []) as FeeRoleGrant[]
}

export async function setRoleGrant(
  role: string, key: FeePermissionKey, granted: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('fee_role_grants')
    .upsert({ role, permission_key: key, granted, updated_at: new Date().toISOString() },
            { onConflict: 'role,permission_key' })
  if (error) throw error
}

export async function fetchUserGrants(userId: string): Promise<FeeUserGrant[]> {
  const { data, error } = await supabase
    .from('fee_user_grants')
    .select('user_id, permission_key, granted, note')
    .eq('user_id', userId)
  if (error) {
    if (isMissingRelation(error)) return []
    throw error
  }
  return (data ?? []) as FeeUserGrant[]
}

/**
 * Three states, not two: granted, denied, or inherit the role.
 *
 * Deleting the row rather than storing `false` is what "inherit" means, and
 * conflating the two would make a deliberate revocation indistinguishable from
 * never having been asked.
 */
export async function setUserGrant(
  userId: string, key: FeePermissionKey, granted: boolean | null, note?: string,
): Promise<void> {
  if (granted === null) {
    const { error } = await supabase
      .from('fee_user_grants').delete().eq('user_id', userId).eq('permission_key', key)
    if (error) throw error
    return
  }
  const { error } = await supabase
    .from('fee_user_grants')
    .upsert({
      user_id: userId, permission_key: key, granted,
      note: note ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,permission_key' })
  if (error) throw error
}

export async function applyPreset(userId: string, preset: FeePresetKey): Promise<void> {
  const { error } = await supabase.rpc('apply_fee_permission_preset', {
    p_user: userId, p_preset: preset,
  })
  if (error) throw error
}

export interface PermissionHolder {
  id: string
  full_name: string
  role: string
  /** Whether the answer came from a personal override or the role default. */
  via: 'override' | 'role'
}

/**
 * Who actually holds a permission, and why.
 *
 * This is the coverage check the settings screen shows. "Who can reverse a
 * payment?" is a question a head teacher will ask, and reading it off a grid of
 * 28 columns by seven roles plus per-person overrides is not an answer.
 */
export async function fetchPermissionHolders(
  key: FeePermissionKey,
): Promise<PermissionHolder[]> {
  const [{ data: profiles, error: pErr }, roleGrants, { data: overrides, error: oErr }] =
    await Promise.all([
      // Only administrators can hold a fee permission — the resolver gates on
      // it, so anyone else listed here would be a name beside a key they do
      // not actually have.
      supabase.from('profiles').select('id, full_name, role')
        .eq('is_banned', false).eq('role', 'admin'),
      fetchRoleGrants(),
      supabase.from('fee_user_grants').select('user_id, granted').eq('permission_key', key),
    ])
  if (pErr) throw pErr
  if (oErr && !isMissingRelation(oErr)) throw oErr

  const overrideBy = new Map<string, boolean>(
    (overrides ?? []).map(o => [o.user_id as string, o.granted as boolean]))
  const roleAllows = new Map<string, boolean>(
    roleGrants.filter(g => g.permission_key === key).map(g => [g.role, g.granted]))

  const holders: PermissionHolder[] = []
  for (const p of (profiles ?? []) as { id: string; full_name: string; role: string }[]) {
    const override = overrideBy.get(p.id)
    if (override === true) {
      holders.push({ id: p.id, full_name: p.full_name, role: p.role, via: 'override' })
    } else if (override === undefined && roleAllows.get(p.role)) {
      holders.push({ id: p.id, full_name: p.full_name, role: p.role, via: 'role' })
    }
  }
  return holders.sort((a, b) => a.full_name.localeCompare(b.full_name))
}
