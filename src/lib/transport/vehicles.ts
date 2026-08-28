/**
 * Fleet vehicles.
 *
 * Follows the house data-layer pattern: log and return a neutral value rather
 * than throwing, so a failed fetch renders an empty screen instead of an error
 * boundary.
 */

import { supabase } from '../supabase'
import type { TransportVehicle, VehicleInput } from './types'
import { VEHICLE_COMPLIANCE_FIELDS } from './types'

export async function fetchVehicles(): Promise<TransportVehicle[]> {
  const { data, error } = await supabase
    .from('transport_vehicles')
    .select('*')
    .order('display_name', { ascending: true, nullsFirst: false })
    .order('registration_no', { ascending: true })
  if (error) { console.error('fetchVehicles failed:', error); return [] }
  return (data as TransportVehicle[]) || []
}

export async function createVehicle(
  input: VehicleInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('transport_vehicles')
    .insert({ ...input, created_by: user?.id })
    .select('id')
    .single()
  if (error) {
    console.error('createVehicle failed:', error)
    // The unique index normalises case and spaces, so the same bus entered as
    // "KL07AB1234" and "KL 07 AB 1234" collides. Say so plainly.
    if (error.code === '23505') {
      return { success: false, error: 'A vehicle with that registration number already exists.' }
    }
    return { success: false, error: error.message }
  }
  return { success: true, id: data.id }
}

export async function updateVehicle(
  vehicleId: string,
  input: Partial<VehicleInput>,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_vehicles').update(input).eq('id', vehicleId)
  if (error) {
    console.error('updateVehicle failed:', error)
    if (error.code === '23505') {
      return { success: false, error: 'A vehicle with that registration number already exists.' }
    }
    return { success: false, error: error.message }
  }
  return { success: true }
}

export async function deleteVehicle(vehicleId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_vehicles').delete().eq('id', vehicleId)
  if (error) { console.error('deleteVehicle failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** What a vehicle is called on screen. Registration is the fallback identity. */
export function vehicleLabel(v: Pick<TransportVehicle, 'display_name' | 'registration_no'> | null | undefined): string {
  if (!v) return '—'
  return v.display_name?.trim() || v.registration_no
}

export interface ComplianceWarning {
  label: string
  date: string
  daysLeft: number
  expired: boolean
}

/**
 * Compliance documents due within `withinDays` (or already lapsed).
 *
 * A bus whose fitness certificate lapsed yesterday is not allowed to carry
 * children, so this is surfaced as a warning on the fleet screen rather than
 * left for someone to notice in a spreadsheet.
 */
export function complianceWarnings(v: TransportVehicle, withinDays = 30): ComplianceWarning[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const out: ComplianceWarning[] = []
  for (const { key, label } of VEHICLE_COMPLIANCE_FIELDS) {
    const raw = v[key]
    if (!raw) continue
    const due = new Date(raw + 'T00:00:00')
    if (Number.isNaN(due.getTime())) continue
    const daysLeft = Math.round((due.getTime() - today.getTime()) / 86_400_000)
    if (daysLeft <= withinDays) out.push({ label, date: raw, daysLeft, expired: daysLeft < 0 })
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft)
}
