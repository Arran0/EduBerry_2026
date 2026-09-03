// ============================================================================
// Work locations and legal entities — browser-side data layer.
// ----------------------------------------------------------------------------
// The location is where multi-state payroll actually lives: it carries the
// state that selects the Professional Tax and LWF rule sets, and the EPFO and
// ESIC registrations the monthly returns are filed under.
//
// Nothing here resolves anything. Which location governs whom is
// `resolveLocationFor` in the engine, imported by the screen for its coverage
// check, so the answer the admin is shown is the answer payroll will use.
// ============================================================================

import { supabase } from '@/lib/supabase'
import type { WorkLocationRow } from './rows'
import { toWorkLocation } from './rows'
import type { WorkLocation } from './engine/types'

type Result = { success: boolean; error?: string; id?: string }

function fail(where: string, error: { message: string } | null): Result {
  if (error) { console.error(`${where} failed:`, error); return { success: false, error: error.message } }
  return { success: true }
}

export interface LegalEntity {
  id: string
  name: string
  code: string | null
  pan: string | null
  tan: string | null
  registeredAddress: string | null
  deductorName: string | null
  deductorDesignation: string | null
  isDefault: boolean
  status: 'active' | 'archived'
}

const ENTITY_COLUMNS =
  'id, name, code, pan, tan, registered_address, deductor_name, deductor_designation, is_default, status'

const LOCATION_COLUMNS =
  '*, entity:payroll_legal_entities(name), ' +
  'members:payroll_location_members(id, employee_id, effective_from, effective_to, reason)'

export async function fetchEntities(): Promise<LegalEntity[]> {
  const { data, error } = await supabase
    .from('payroll_legal_entities').select(ENTITY_COLUMNS).order('is_default', { ascending: false }).order('name')
  if (error) { console.error('fetchEntities failed:', error); return [] }
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    id: r.id as string, name: r.name as string, code: (r.code as string) ?? null,
    pan: (r.pan as string) ?? null, tan: (r.tan as string) ?? null,
    registeredAddress: (r.registered_address as string) ?? null,
    deductorName: (r.deductor_name as string) ?? null,
    deductorDesignation: (r.deductor_designation as string) ?? null,
    isDefault: r.is_default as boolean, status: r.status as 'active' | 'archived',
  }))
}

export async function saveEntity(
  e: Partial<LegalEntity> & { name: string }, id?: string,
): Promise<Result> {
  const row = {
    name: e.name, code: e.code || null, pan: e.pan || null, tan: e.tan || null,
    registered_address: e.registeredAddress || null,
    deductor_name: e.deductorName || null, deductor_designation: e.deductorDesignation || null,
  }
  if (id) return fail('saveEntity', (await supabase.from('payroll_legal_entities').update(row).eq('id', id)).error)
  const { data, error } = await supabase.from('payroll_legal_entities').insert(row).select('id').single()
  if (error) return fail('saveEntity', error)
  return { success: true, id: data?.id as string }
}

/** Every location with its members, mapped straight into the engine's shape. */
export async function fetchLocations(includeArchived = false): Promise<WorkLocation[]> {
  let q = supabase.from('payroll_work_locations').select(LOCATION_COLUMNS).order('priority', { ascending: false })
  if (!includeArchived) q = q.eq('status', 'active')
  const { data, error } = await q
  if (error) { console.error('fetchLocations failed:', error); return [] }
  return ((data ?? []) as unknown as WorkLocationRow[]).map(toWorkLocation)
}

export interface LocationInput {
  entityId: string
  name: string
  code: string | null
  address: string | null
  stateCode: string
  isDefault: boolean
  priority: number
  match: WorkLocation['match']
  epfEstablishmentId: string | null
  esiEmployerCode: string | null
  ptRegistrationNo: string | null
  ptEnrolmentNo: string | null
  lwfRegistrationNo: string | null
  effectiveFrom: string
}

export async function saveLocation(input: LocationInput, id?: string): Promise<Result> {
  const row = {
    entity_id: input.entityId,
    name: input.name,
    code: input.code || null,
    address: input.address || null,
    state_code: input.stateCode,
    is_default: input.isDefault,
    priority: input.priority,
    match: input.match,
    epf_establishment_id: input.epfEstablishmentId || null,
    esi_employer_code: input.esiEmployerCode || null,
    pt_registration_no: input.ptRegistrationNo || null,
    pt_enrolment_no: input.ptEnrolmentNo || null,
    lwf_registration_no: input.lwfRegistrationNo || null,
    effective_from: input.effectiveFrom,
  }

  // One default at a time is a partial unique index, which would reject the
  // insert rather than move the flag. Standing the old default down first is
  // what the admin means by ticking the box on a different location.
  if (input.isDefault) {
    await supabase.from('payroll_work_locations').update({ is_default: false })
      .eq('is_default', true).neq('id', id ?? '00000000-0000-0000-0000-000000000000')
  }

  if (id) return fail('saveLocation', (await supabase.from('payroll_work_locations').update(row).eq('id', id)).error)
  const { data, error } = await supabase.from('payroll_work_locations').insert(row).select('id').single()
  if (error) return fail('saveLocation', error)
  return { success: true, id: data?.id as string }
}

export async function archiveLocation(id: string): Promise<Result> {
  return fail('archiveLocation', (await supabase.from('payroll_work_locations')
    .update({ status: 'archived' }).eq('id', id)).error)
}

/**
 * Move people to a location from a date.
 *
 * A transfer is not an edit. The previous assignment is closed the day before
 * the new one opens and stays on the record, because the months it covered were
 * taxed in that state and a return was filed there. The database rejects any
 * overlap outright, so a mistake here fails loudly rather than quietly taxing
 * somebody twice.
 */
export async function assignToLocation(
  locationId: string, employeeIds: string[], effectiveFrom: string, reason: string | null, actorId: string,
): Promise<Result> {
  if (employeeIds.length === 0) return { success: true }

  const dayBefore = new Date(`${effectiveFrom}T12:00:00Z`)
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1)
  const closeOn = dayBefore.toISOString().slice(0, 10)

  // Close whatever is open for these people on or before the new start.
  const { error: closeErr } = await supabase.from('payroll_location_members')
    .update({ effective_to: closeOn })
    .in('employee_id', employeeIds)
    .is('effective_to', null)
    .lte('effective_from', closeOn)
  if (closeErr) return fail('assignToLocation (closing previous)', closeErr)

  // An assignment that had not started yet is a correction, not a transfer:
  // there is no history to keep, so it goes.
  const { error: dropErr } = await supabase.from('payroll_location_members')
    .delete().in('employee_id', employeeIds).gte('effective_from', effectiveFrom)
  if (dropErr) return fail('assignToLocation (clearing future)', dropErr)

  return fail('assignToLocation', (await supabase.from('payroll_location_members').insert(
    employeeIds.map(employee_id => ({
      location_id: locationId, employee_id, effective_from: effectiveFrom,
      reason, created_by: actorId,
    })),
  )).error)
}

export async function removeFromLocation(memberRowId: string): Promise<Result> {
  return fail('removeFromLocation', (await supabase.from('payroll_location_members')
    .delete().eq('id', memberRowId)).error)
}

/** The school-wide fallback state, used only when someone has no location at all. */
export async function fetchDefaultJurisdiction(): Promise<string> {
  const { data } = await supabase.from('site_settings')
    .select('value').eq('key', 'payroll_default_jurisdiction').maybeSingle()
  return (data?.value as string) || 'IN-TN'
}

export async function saveDefaultJurisdiction(stateCode: string): Promise<Result> {
  return fail('saveDefaultJurisdiction', (await supabase.from('site_settings')
    .upsert({ key: 'payroll_default_jurisdiction', value: stateCode }, { onConflict: 'key' })).error)
}

/** ISO 3166-2:IN codes, for the state picker. */
export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: 'IN-AN', name: 'Andaman & Nicobar Islands' },
  { code: 'IN-AP', name: 'Andhra Pradesh' },
  { code: 'IN-AR', name: 'Arunachal Pradesh' },
  { code: 'IN-AS', name: 'Assam' },
  { code: 'IN-BR', name: 'Bihar' },
  { code: 'IN-CH', name: 'Chandigarh' },
  { code: 'IN-CT', name: 'Chhattisgarh' },
  { code: 'IN-DL', name: 'Delhi' },
  { code: 'IN-GA', name: 'Goa' },
  { code: 'IN-GJ', name: 'Gujarat' },
  { code: 'IN-HR', name: 'Haryana' },
  { code: 'IN-HP', name: 'Himachal Pradesh' },
  { code: 'IN-JK', name: 'Jammu & Kashmir' },
  { code: 'IN-JH', name: 'Jharkhand' },
  { code: 'IN-KA', name: 'Karnataka' },
  { code: 'IN-KL', name: 'Kerala' },
  { code: 'IN-LA', name: 'Ladakh' },
  { code: 'IN-MP', name: 'Madhya Pradesh' },
  { code: 'IN-MH', name: 'Maharashtra' },
  { code: 'IN-MN', name: 'Manipur' },
  { code: 'IN-ML', name: 'Meghalaya' },
  { code: 'IN-MZ', name: 'Mizoram' },
  { code: 'IN-NL', name: 'Nagaland' },
  { code: 'IN-OR', name: 'Odisha' },
  { code: 'IN-PY', name: 'Puducherry' },
  { code: 'IN-PB', name: 'Punjab' },
  { code: 'IN-RJ', name: 'Rajasthan' },
  { code: 'IN-SK', name: 'Sikkim' },
  { code: 'IN-TN', name: 'Tamil Nadu' },
  { code: 'IN-TG', name: 'Telangana' },
  { code: 'IN-TR', name: 'Tripura' },
  { code: 'IN-UP', name: 'Uttar Pradesh' },
  { code: 'IN-UT', name: 'Uttarakhand' },
  { code: 'IN-WB', name: 'West Bengal' },
]

export const stateName = (code: string) =>
  INDIAN_STATES.find(s => s.code === code)?.name ?? code
