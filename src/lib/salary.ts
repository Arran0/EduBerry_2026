import { supabase, UserProfile } from './supabase'

// ============================================
// Types
// ============================================

// Per-staff salary record status reuses the bus payroll lifecycle.
export type SalaryStatus = 'draft' | 'approved' | 'paid'
export type SalaryCycleStatus = 'open' | 'processing' | 'completed'

export interface SalaryCycle {
  id: string
  period_month: number   // 1..12
  period_year: number
  status: SalaryCycleStatus
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SalaryRecordItem {
  id: string
  record_id: string
  label: string
  amount: number
  created_at: string
}

export interface SalaryRecord {
  id: string
  cycle_id: string
  staff_id: string
  base_amount: number
  status: SalaryStatus
  payout_status: string | null   // null | 'initiated' | 'processed' | 'failed'
  payout_reference: string | null
  notes: string | null
  created_at: string
  updated_at: string
  items?: SalaryRecordItem[]
  staff?: UserProfile | null     // embedded for admin views
  cycle?: SalaryCycle | null     // embedded for staff views (month/year)
}

export interface StaffSalaryBase {
  id: string
  staff_id: string
  base_amount: number
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
  staff?: UserProfile | null
}

export interface StaffBankAccount {
  id: string
  staff_id: string
  account_holder_name: string
  account_number: string
  ifsc: string
  bank_name: string | null
  payout_fund_account_id: string | null
  created_at: string
  updated_at: string
}

// ============================================
// Helpers
// ============================================

/** Net pay = base + sum(items). Positive items are bonuses, negative are penalties. */
export function salaryNet(record: SalaryRecord): number {
  const items = record.items ?? []
  return Number(record.base_amount || 0) + items.reduce((sum, i) => sum + Number(i.amount || 0), 0)
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "June 2026" for a 1-based month. */
export function formatPeriod(month: number, year: number): string {
  return `${MONTHS[month - 1] ?? month} ${year}`
}

/** Eligible staff for salaries: teacher / coordinator / principal (excludes admin & driver). */
export async function fetchEligibleStaff(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['teacher', 'coordinator', 'principal'])
    .order('full_name', { ascending: true })
  if (error) { console.error('fetchEligibleStaff failed:', error); return [] }
  return (data as UserProfile[]) || []
}

// ============================================
// Staff self
// ============================================

/** A staff member's own salary records, with items and the cycle period, newest first. */
export async function fetchSalaryForStaff(staffId: string): Promise<SalaryRecord[]> {
  const { data, error } = await supabase
    .from('salary_records')
    .select('*, items:salary_record_items(*), cycle:salary_cycles!cycle_id(*)')
    .eq('staff_id', staffId)
  if (error) { console.error('fetchSalaryForStaff failed:', error); return [] }
  const rows = (data as SalaryRecord[]) || []
  // Order by the embedded cycle period (most recent month first).
  return rows.sort((a, b) => {
    const ay = a.cycle?.period_year ?? 0, by = b.cycle?.period_year ?? 0
    if (ay !== by) return by - ay
    return (b.cycle?.period_month ?? 0) - (a.cycle?.period_month ?? 0)
  })
}

// ============================================
// Cycles (admin)
// ============================================

export async function fetchCycles(): Promise<SalaryCycle[]> {
  const { data, error } = await supabase
    .from('salary_cycles')
    .select('*')
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })
  if (error) { console.error('fetchCycles failed:', error); return [] }
  return (data as SalaryCycle[]) || []
}

export async function fetchCycle(cycleId: string): Promise<SalaryCycle | null> {
  const { data, error } = await supabase.from('salary_cycles').select('*').eq('id', cycleId).single()
  if (error) { console.error('fetchCycle failed:', error); return null }
  return data as SalaryCycle
}

/** All records for a cycle, with items and staff, ordered by staff name. */
export async function fetchCycleRecords(cycleId: string): Promise<SalaryRecord[]> {
  const { data, error } = await supabase
    .from('salary_records')
    .select('*, items:salary_record_items(*), staff:profiles!staff_id(*)')
    .eq('cycle_id', cycleId)
  if (error) { console.error('fetchCycleRecords failed:', error); return [] }
  return ((data as SalaryRecord[]) || []).sort(
    (a, b) => (a.staff?.full_name ?? '').localeCompare(b.staff?.full_name ?? ''),
  )
}

/** Count of records per cycle, keyed by cycle_id (for the cycles list). */
export async function fetchCycleRecordCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('salary_records').select('cycle_id')
  if (error) { console.error('fetchCycleRecordCounts failed:', error); return {} }
  const counts: Record<string, number> = {}
  for (const r of (data || []) as { cycle_id: string }[]) {
    counts[r.cycle_id] = (counts[r.cycle_id] ?? 0) + 1
  }
  return counts
}

/** Run a monthly cycle: ensure the cycle exists and generate a draft record per active staff. */
export async function generateSalaryCycle(
  month: number,
  year: number,
): Promise<{ success: boolean; cycleId?: string; created?: number; error?: string }> {
  const { data, error } = await supabase.rpc('generate_salary_cycle', {
    p_month: month,
    p_year: year,
  })
  if (error) { console.error('generateSalaryCycle failed:', error); return { success: false, error: error.message } }
  // RPC returns a single-row table { cycle_id, created_count }.
  const row = Array.isArray(data) ? data[0] : data
  return { success: true, cycleId: row?.cycle_id, created: row?.created_count ?? 0 }
}

export async function setCycleStatus(
  cycleId: string,
  status: SalaryCycleStatus,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('salary_cycles').update({ status }).eq('id', cycleId)
  if (error) { console.error('setCycleStatus failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Records & line items (admin)
// ============================================

export async function addSalaryItem(
  recordId: string,
  label: string,
  amount: number,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('salary_record_items')
    .insert({ record_id: recordId, label, amount })
  if (error) { console.error('addSalaryItem failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function deleteSalaryItem(itemId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('salary_record_items').delete().eq('id', itemId)
  if (error) { console.error('deleteSalaryItem failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function setSalaryRecordStatus(
  recordId: string,
  status: SalaryStatus,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('salary_records').update({ status }).eq('id', recordId)
  if (error) { console.error('setSalaryRecordStatus failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Base salary config (admin)
// ============================================

/** Every staff base-salary row, with the staff profile, ordered by name. */
export async function fetchBaseSalaries(): Promise<StaffSalaryBase[]> {
  const { data, error } = await supabase
    .from('staff_salary_base')
    .select('*, staff:profiles!staff_id(*)')
  if (error) { console.error('fetchBaseSalaries failed:', error); return [] }
  return ((data as StaffSalaryBase[]) || []).sort(
    (a, b) => (a.staff?.full_name ?? '').localeCompare(b.staff?.full_name ?? ''),
  )
}

export interface BaseSalaryInput {
  staff_id: string
  base_amount: number
  active?: boolean
  notes?: string | null
}

/** The staff member's own current base salary config. */
export async function fetchMyBaseSalary(staffId: string): Promise<StaffSalaryBase | null> {
  const { data, error } = await supabase
    .from('staff_salary_base')
    .select('*, staff:profiles!staff_id(*)')
    .eq('staff_id', staffId)
    .maybeSingle()
  if (error) { console.error('fetchMyBaseSalary failed:', error); return null }
  return (data as StaffSalaryBase) ?? null
}

export async function upsertBaseSalary(input: BaseSalaryInput): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('staff_salary_base')
    .upsert({ ...input, created_by: user?.id }, { onConflict: 'staff_id' })
  if (error) { console.error('upsertBaseSalary failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Bank accounts (admin-managed; staff read-only)
// ============================================

/** All staff bank accounts (admin). Keyed-table form is built by the caller. */
export async function fetchBankAccounts(): Promise<StaffBankAccount[]> {
  const { data, error } = await supabase.from('staff_bank_accounts').select('*')
  if (error) { console.error('fetchBankAccounts failed:', error); return [] }
  return (data as StaffBankAccount[]) || []
}

/** Bank accounts keyed by staff_id — for bulk lookups (e.g. bank transfer statement). */
export async function fetchBankAccountsMap(): Promise<Record<string, StaffBankAccount>> {
  const accounts = await fetchBankAccounts()
  const map: Record<string, StaffBankAccount> = {}
  for (const a of accounts) map[a.staff_id] = a
  return map
}

/** The current user's own bank account (staff self-view). */
export async function fetchMyBankAccount(staffId: string): Promise<StaffBankAccount | null> {
  const { data, error } = await supabase
    .from('staff_bank_accounts')
    .select('*')
    .eq('staff_id', staffId)
    .maybeSingle()
  if (error) { console.error('fetchMyBankAccount failed:', error); return null }
  return (data as StaffBankAccount) ?? null
}

export interface BankAccountInput {
  staff_id: string
  account_holder_name: string
  account_number: string
  ifsc: string
  bank_name?: string | null
}

export async function upsertBankAccount(input: BankAccountInput): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('staff_bank_accounts')
    .upsert({ ...input, created_by: user?.id }, { onConflict: 'staff_id' })
  if (error) { console.error('upsertBankAccount failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function deleteBankAccount(staffId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('staff_bank_accounts').delete().eq('staff_id', staffId)
  if (error) { console.error('deleteBankAccount failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Mask all but the last 4 digits of an account number for display. */
export function maskAccountNumber(acc: string): string {
  const s = (acc || '').trim()
  if (s.length <= 4) return s
  return '••••' + s.slice(-4)
}

// ============================================
// Payout configuration (site_settings)
// ============================================

export interface PayoutConfig {
  enabled: boolean
  provider: 'manual' | 'razorpayx' | 'cashfree'
  key_id: string
}

export async function fetchPayoutConfig(): Promise<PayoutConfig> {
  const { data } = await supabase.from('site_settings').select('value').eq('key', 'payout_config').maybeSingle()
  const v = (data?.value ?? {}) as Partial<PayoutConfig>
  return { enabled: v.enabled ?? false, provider: v.provider ?? 'manual', key_id: v.key_id ?? '' }
}

export async function savePayoutConfig(config: PayoutConfig): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'payout_config', value: config as unknown as Record<string, unknown> }, { onConflict: 'key' })
  if (error) { console.error('savePayoutConfig failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Recommendation rates (site_settings)
// ============================================

/** Rates used to recommend bonuses/penalties when reviewing a cycle. */
export interface SalaryRates {
  bonus_point_value: number       // ₹ per task-manager bonus point
  absent_penalty_per_day: number  // ₹ deducted per absent day
}

export const DEFAULT_SALARY_RATES: SalaryRates = {
  bonus_point_value: 50,
  absent_penalty_per_day: 500,
}

export async function fetchSalaryRates(): Promise<SalaryRates> {
  const { data } = await supabase.from('site_settings').select('value').eq('key', 'salary_rates').maybeSingle()
  const v = (data?.value ?? {}) as Partial<SalaryRates>
  return {
    bonus_point_value: v.bonus_point_value ?? DEFAULT_SALARY_RATES.bonus_point_value,
    absent_penalty_per_day: v.absent_penalty_per_day ?? DEFAULT_SALARY_RATES.absent_penalty_per_day,
  }
}

export async function saveSalaryRates(rates: SalaryRates): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'salary_rates', value: rates as unknown as Record<string, unknown> }, { onConflict: 'key' })
  if (error) { console.error('saveSalaryRates failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Bonus / penalty recommendations
// ============================================

/** Stable label prefixes so applied recommendation items can be detected/deduped. */
export const BONUS_ITEM_PREFIX = 'Task bonus'
export const PENALTY_ITEM_PREFIX = 'Absence penalty'

export interface SalaryRecommendation {
  bonusPoints: number
  bonusAmount: number
  absentDays: number
  penaltyAmount: number
}

/** Convert task bonus points + absent days into recommended rupee amounts. */
export function buildRecommendation(points: number, absents: number, rates: SalaryRates): SalaryRecommendation {
  return {
    bonusPoints: points,
    bonusAmount: Math.round((points || 0) * rates.bonus_point_value),
    absentDays: absents,
    penaltyAmount: Math.round((absents || 0) * rates.absent_penalty_per_day),
  }
}

/**
 * Task-manager bonus points earned per staff in a month, keyed by staff_id.
 * Uses the same get_monthly_member_stats RPC that powers team analytics
 * (see src/app/api/analytics/team/route.ts).
 */
export async function fetchMonthlyBonusPoints(
  staffIds: string[],
  year: number,
  month: number,
): Promise<Record<string, number>> {
  if (staffIds.length === 0) return {}
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthStartTs = `${monthStart}T00:00:00.000Z`
  const { data, error } = await supabase.rpc('get_monthly_member_stats', {
    p_member_ids: staffIds,
    p_month_start: monthStart,
    p_month_start_ts: monthStartTs,
  })
  if (error) { console.error('fetchMonthlyBonusPoints failed:', error); return {} }
  const out: Record<string, number> = {}
  for (const r of (data ?? []) as { user_id: string; bonus: number }[]) {
    out[r.user_id] = Number(r.bonus) || 0
  }
  return out
}

/** Number of 'absent' staff_attendance_records per staff in a month, keyed by staff_id. */
export async function fetchMonthlyAbsentCounts(
  staffIds: string[],
  year: number,
  month: number,
): Promise<Record<string, number>> {
  if (staffIds.length === 0) return {}
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const { data, error } = await supabase
    .from('staff_attendance_records')
    .select('staff_id')
    .in('staff_id', staffIds)
    .eq('status', 'absent')
    .gte('date', start)
    .lte('date', end)
  if (error) { console.error('fetchMonthlyAbsentCounts failed:', error); return {} }
  const out: Record<string, number> = {}
  for (const r of (data ?? []) as { staff_id: string }[]) {
    out[r.staff_id] = (out[r.staff_id] ?? 0) + 1
  }
  return out
}

/** Initiate provider payouts for an approved cycle via the server route. */
export async function initiateCyclePayouts(cycleId: string): Promise<{
  success: boolean; manual?: boolean; initiated?: number; error?: string
}> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { success: false, error: 'Not authenticated' }
  try {
    const res = await fetch('/api/salary/payout/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ cycle_id: cycleId }),
    })
    const json = await res.json()
    if (!json.success) return { success: false, error: json.error ?? 'Failed to initiate payouts' }
    return { success: true, manual: json.manual, initiated: json.initiated }
  } catch (e) {
    console.error('initiateCyclePayouts failed:', e)
    return { success: false, error: 'Network error starting payouts' }
  }
}
