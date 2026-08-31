import { supabase, UserProfile } from './supabase'
import type { CycleTally } from './salary'

// Driver Payroll data layer — a cycle-based payroll for bus drivers that mirrors
// the staff Salary Manager (src/lib/salary.ts) on the driver_payroll_* tables:
//   • per-driver base salary config
//   • monthly cycle header → one record per driver → line items
//     (positive = bonus/earning, negative = deduction/penalty)
//   • provider bank disbursement reconciled by webhook
// Driver bank accounts and the shared payout config live in src/lib/bus.ts /
// src/lib/salary.ts and are re-exported where convenient.

// ============================================
// Types
// ============================================

export type DriverSalaryStatus = 'draft' | 'approved' | 'paid'
export type DriverCycleStatus = 'open' | 'closed'

export interface DriverCycle {
  id: string
  period_month: number   // 1..12
  period_year: number
  status: DriverCycleStatus
  notes: string | null
  payroll_config: import('./payroll').PayrollCalibration | null   // null = use the site-wide default
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface DriverSalaryRecordItem {
  id: string
  record_id: string
  label: string
  amount: number
  created_at: string
}

export interface DriverSalaryRecord {
  id: string
  cycle_id: string
  driver_id: string
  base_amount: number
  status: DriverSalaryStatus
  payout_status: string | null   // null | 'initiated' | 'processed' | 'failed'
  payout_reference: string | null
  notes: string | null
  // Manual overrides of the derived pay cycle columns; null = use the derived value.
  working_days_override: number | null
  leave_override: number | null
  late_override: number | null
  half_day_override: number | null
  pf_amount_override: number | null
  esi_amount_override: number | null
  created_at: string
  updated_at: string
  items?: DriverSalaryRecordItem[]
  driver?: UserProfile | null     // embedded for admin views
  cycle?: DriverCycle | null      // embedded for driver self-views (month/year)
}

/** The pay-cycle columns an admin may type over by hand. */
export interface DriverSalaryRecordOverrides {
  base_amount?: number
  working_days_override?: number | null
  leave_override?: number | null
  late_override?: number | null
  pf_amount_override?: number | null
  esi_amount_override?: number | null
}

export interface DriverSalaryBase {
  id: string
  driver_id: string
  base_amount: number
  active: boolean
  notes: string | null
  pf_basic: number | null
  pf_applicable: boolean
  esi_override: boolean | null   // null = auto by wage ceiling, true/false = always/never
  // Statutory identifiers — see src/lib/statutory.ts for how these feed the EPF/ESI returns.
  uan: string | null             // 12-digit EPFO Universal Account Number
  esi_ip_number: string | null   // 10-digit ESIC Insured Person number
  eps_applicable: boolean        // member is in the pension scheme (8.33% of the employer share)
  created_at: string
  updated_at: string
  driver?: UserProfile | null
}

// ============================================
// Helpers
// ============================================

/** Net pay = base + sum(items). Positive items are bonuses, negative are deductions. */
export function driverSalaryNet(record: DriverSalaryRecord): number {
  const items = record.items ?? []
  return Number(record.base_amount || 0) + items.reduce((sum, i) => sum + Number(i.amount || 0), 0)
}

// Re-export the shared period formatter so callers have one import surface.
export { formatPeriod } from './salary'

/** All drivers (role = 'driver'), ordered by name. */
export async function fetchEligibleDrivers(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'driver')
    .order('full_name', { ascending: true })
  if (error) { console.error('fetchEligibleDrivers failed:', error); return [] }
  return (data as UserProfile[]) || []
}

// ============================================
// Driver self
// ============================================

/** A driver's own salary records, with items and the cycle period, newest first. */
export async function fetchSalaryForDriver(driverId: string): Promise<DriverSalaryRecord[]> {
  const { data, error } = await supabase
    .from('driver_payroll_records')
    .select('*, items:driver_payroll_record_items(*), cycle:driver_payroll_cycles!cycle_id(*)')
    .eq('driver_id', driverId)
  if (error) { console.error('fetchSalaryForDriver failed:', error); return [] }
  const rows = (data as DriverSalaryRecord[]) || []
  return rows.sort((a, b) => {
    const ay = a.cycle?.period_year ?? 0, by = b.cycle?.period_year ?? 0
    if (ay !== by) return by - ay
    return (b.cycle?.period_month ?? 0) - (a.cycle?.period_month ?? 0)
  })
}

// ============================================
// Cycles (admin)
// ============================================

export async function fetchDriverCycles(): Promise<DriverCycle[]> {
  const { data, error } = await supabase
    .from('driver_payroll_cycles')
    .select('*')
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })
  if (error) { console.error('fetchDriverCycles failed:', error); return [] }
  return (data as DriverCycle[]) || []
}

export async function fetchDriverCycle(cycleId: string): Promise<DriverCycle | null> {
  const { data, error } = await supabase.from('driver_payroll_cycles').select('*').eq('id', cycleId).single()
  if (error) { console.error('fetchDriverCycle failed:', error); return null }
  return data as DriverCycle
}

/** All records for a cycle, with items and driver, ordered by driver name. */
export async function fetchDriverCycleRecords(cycleId: string): Promise<DriverSalaryRecord[]> {
  const { data, error } = await supabase
    .from('driver_payroll_records')
    .select('*, items:driver_payroll_record_items(*), driver:profiles!driver_id(*)')
    .eq('cycle_id', cycleId)
  if (error) { console.error('fetchDriverCycleRecords failed:', error); return [] }
  return ((data as DriverSalaryRecord[]) || []).sort(
    (a, b) => (a.driver?.full_name ?? '').localeCompare(b.driver?.full_name ?? ''),
  )
}

/** Count of records per cycle, keyed by cycle_id (for the cycles list). */
export async function fetchDriverCycleRecordCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('driver_payroll_records').select('cycle_id')
  if (error) { console.error('fetchDriverCycleRecordCounts failed:', error); return {} }
  const counts: Record<string, number> = {}
  for (const r of (data || []) as { cycle_id: string }[]) {
    counts[r.cycle_id] = (counts[r.cycle_id] ?? 0) + 1
  }
  return counts
}

/** Per-cycle record and paid-record counts, so the list can flag fully-disbursed cycles. */
export async function fetchDriverCycleTallies(): Promise<Record<string, CycleTally>> {
  const { data, error } = await supabase.from('driver_payroll_records').select('cycle_id, status')
  if (error) { console.error('fetchDriverCycleTallies failed:', error); return {} }
  const out: Record<string, CycleTally> = {}
  for (const r of (data || []) as { cycle_id: string; status: DriverSalaryStatus }[]) {
    const t = out[r.cycle_id] ?? (out[r.cycle_id] = { total: 0, paid: 0 })
    t.total += 1
    if (r.status === 'paid') t.paid += 1
  }
  return out
}

/** Run a monthly cycle: ensure the cycle exists and generate a draft record per active driver. */
export async function generateDriverCycle(
  month: number,
  year: number,
): Promise<{ success: boolean; cycleId?: string; created?: number; error?: string }> {
  const { data, error } = await supabase.rpc('generate_driver_payroll_cycle', {
    p_month: month,
    p_year: year,
  })
  if (error) { console.error('generateDriverCycle failed:', error); return { success: false, error: error.message } }
  const row = Array.isArray(data) ? data[0] : data
  return { success: true, cycleId: row?.cycle_id, created: row?.created_count ?? 0 }
}

export async function setDriverCycleStatus(
  cycleId: string,
  status: DriverCycleStatus,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('driver_payroll_cycles').update({ status }).eq('id', cycleId)
  if (error) { console.error('setDriverCycleStatus failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/**
 * Delete a cycle outright. Its records — and their line items — go with it via
 * ON DELETE CASCADE, so this wipes the whole month's payroll for drivers.
 */
export async function deleteDriverCycle(cycleId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('driver_payroll_cycles').delete().eq('id', cycleId)
  if (error) { console.error('deleteDriverCycle failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Save (or clear, with null) this cycle's own payroll settings override. */
export async function setDriverCyclePayrollConfig(
  cycleId: string,
  config: import('./payroll').PayrollCalibration | null,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('driver_payroll_cycles').update({ payroll_config: config }).eq('id', cycleId)
  if (error) { console.error('setDriverCyclePayrollConfig failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Records & line items (admin)
// ============================================

export async function addDriverSalaryItem(
  recordId: string,
  label: string,
  amount: number,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('driver_payroll_record_items')
    .insert({ record_id: recordId, label, amount })
  if (error) { console.error('addDriverSalaryItem failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function deleteDriverSalaryItem(itemId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('driver_payroll_record_items').delete().eq('id', itemId)
  if (error) { console.error('deleteDriverSalaryItem failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function setDriverSalaryRecordStatus(
  recordId: string,
  status: DriverSalaryStatus,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('driver_payroll_records').update({ status }).eq('id', recordId)
  if (error) { console.error('setDriverSalaryRecordStatus failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Save hand-typed overrides for one record. Pass null for a field to clear it and fall back to the derived value. */
export async function updateDriverSalaryRecordOverrides(
  recordId: string,
  patch: DriverSalaryRecordOverrides,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('driver_payroll_records').update(patch).eq('id', recordId)
  if (error) { console.error('updateDriverSalaryRecordOverrides failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Bulk item insert — used to snapshot computed PF/ESI/LOP/bonus onto every record when a cycle is closed. */
export async function bulkInsertDriverSalaryItems(
  items: { record_id: string; label: string; amount: number }[],
): Promise<{ success: boolean; error?: string }> {
  if (items.length === 0) return { success: true }
  const { error } = await supabase.from('driver_payroll_record_items').insert(items)
  if (error) { console.error('bulkInsertDriverSalaryItems failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Remove auto-inserted items (by their stable labels) across a set of records — used when reopening a cycle. */
export async function deleteDriverSalaryItemsByLabel(
  recordIds: string[],
  labels: string[],
): Promise<{ success: boolean; error?: string }> {
  if (recordIds.length === 0 || labels.length === 0) return { success: true }
  const { error } = await supabase
    .from('driver_payroll_record_items')
    .delete()
    .in('record_id', recordIds)
    .in('label', labels)
  if (error) { console.error('deleteDriverSalaryItemsByLabel failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function bulkSetDriverSalaryRecordStatus(
  recordIds: string[],
  status: DriverSalaryStatus,
): Promise<{ success: boolean; error?: string }> {
  if (recordIds.length === 0) return { success: true }
  const { error } = await supabase.from('driver_payroll_records').update({ status }).in('id', recordIds)
  if (error) { console.error('bulkSetDriverSalaryRecordStatus failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Base salary config (admin)
// ============================================

/** Every driver base-salary row, with the driver profile, ordered by name. */
export async function fetchDriverBaseSalaries(): Promise<DriverSalaryBase[]> {
  const { data, error } = await supabase
    .from('driver_payroll_base')
    .select('*, driver:profiles!driver_id(*)')
  if (error) { console.error('fetchDriverBaseSalaries failed:', error); return [] }
  return ((data as DriverSalaryBase[]) || []).sort(
    (a, b) => (a.driver?.full_name ?? '').localeCompare(b.driver?.full_name ?? ''),
  )
}

export interface DriverBaseSalaryInput {
  driver_id: string
  base_amount: number
  active?: boolean
  notes?: string | null
  pf_basic?: number | null
  pf_applicable?: boolean
  esi_override?: boolean | null
  uan?: string | null
  esi_ip_number?: string | null
  eps_applicable?: boolean
}

export async function upsertDriverBaseSalary(input: DriverBaseSalaryInput): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('driver_payroll_base')
    .upsert({ ...input, created_by: user?.id }, { onConflict: 'driver_id' })
  if (error) { console.error('upsertDriverBaseSalary failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Disbursement (shared payout provider; see src/lib/bus.ts)
// ============================================

import type { PayoutFileResult } from './salary'
export type { PayoutConfig, PayoutFileResult } from './salary'
export { fetchPayoutConfig, savePayoutConfig } from './salary'

/** Initiate provider payouts for an approved driver cycle via the server route. */
export async function initiateDriverCyclePayouts(cycleId: string): Promise<{
  success: boolean; manual?: boolean; initiated?: number; error?: string
  /** bank_file mode: the file to hand to the bank. Money moves on upload. */
  requiresUpload?: boolean; file?: PayoutFileResult | null
}> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { success: false, error: 'Not authenticated' }
  try {
    const res = await fetch('/api/bus/payroll/payout/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ cycle_id: cycleId }),
    })
    const json = await res.json()
    if (!json.success) return { success: false, error: json.error ?? 'Failed to initiate payouts' }
    return {
      success: true, manual: json.manual, initiated: json.initiated,
      requiresUpload: json.requires_upload, file: json.file ?? null,
    }
  } catch (e) {
    console.error('initiateDriverCyclePayouts failed:', e)
    return { success: false, error: 'Network error starting payouts' }
  }
}
