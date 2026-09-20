/**
 * Transport crew — drivers and attendants.
 *
 * An attendant is deliberately NOT a new `profiles.role`. Adding a role literal
 * would mean auditing the ~130 places across ~30 SQL files that already
 * special-case the existing set; `add_non_teaching_staff_flag.sql:5-14`
 * documents that refusal. Crew capability comes from a `transport_staff` row
 * instead, which also gives us the licence/badge/verification fields a school
 * has to be able to produce on request.
 */

import { supabase } from '../supabase'
import type { StaffInput, TransportStaff, TransportStaffKind } from './types'

const PROFILE_COLS = 'id, full_name, avatar_url, role'

export async function fetchTransportStaff(kind?: TransportStaffKind): Promise<TransportStaff[]> {
  let q = supabase
    .from('transport_staff')
    .select(`*, profile:profiles!profile_id(${PROFILE_COLS})`)
    .order('created_at', { ascending: true })
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q
  if (error) { console.error('fetchTransportStaff failed:', error); return [] }
  return ((data as unknown as TransportStaff[]) || []).sort((a, b) =>
    (a.profile?.full_name ?? '').localeCompare(b.profile?.full_name ?? ''),
  )
}

export async function upsertTransportStaff(
  input: StaffInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('transport_staff')
    .upsert({ ...input, created_by: user?.id }, { onConflict: 'profile_id,kind' })
    .select('id')
    .single()
  if (error) { console.error('upsertTransportStaff failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

export async function updateTransportStaff(
  staffId: string,
  input: Partial<StaffInput>,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_staff').update(input).eq('id', staffId)
  if (error) { console.error('updateTransportStaff failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function deleteTransportStaff(staffId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_staff').delete().eq('id', staffId)
  if (error) { console.error('deleteTransportStaff failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/**
 * Accounts eligible to be crew.
 *
 * `role = 'driver'` is the transport account type; an attendant uses one too
 * (see the module note above), so both kinds are picked from the same list.
 */
export async function fetchCrewCandidates() {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLS)
    .eq('role', 'driver')
    .neq('is_banned', true)
    .order('full_name', { ascending: true })
  if (error) { console.error('fetchCrewCandidates failed:', error); return [] }
  return data || []
}

export interface CrewCard {
  profile_id: string
  kind: TransportStaffKind
  phone: string | null
  photo_url: string | null
}

/**
 * The crew details a parent is allowed to see: name (already on the run) plus a
 * phone number and photo. Deliberately not the licence number, address or
 * employee code — those are on the same row but are nobody else's business.
 */
export async function fetchCrewCards(profileIds: string[]): Promise<Record<string, CrewCard>> {
  const ids = profileIds.filter(Boolean)
  if (ids.length === 0) return {}
  const { data, error } = await supabase
    .from('transport_staff')
    .select('profile_id, kind, phone, photo_url')
    .in('profile_id', ids)
    .eq('active', true)
  if (error) { console.error('fetchCrewCards failed:', error); return {} }
  const out: Record<string, CrewCard> = {}
  for (const r of (data || []) as CrewCard[]) out[r.profile_id] = r
  return out
}
