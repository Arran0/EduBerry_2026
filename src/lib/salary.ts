import { supabase, UserProfile, isMissingRelation } from './supabase'

// ============================================
// Types
// ============================================

// Per-staff salary record status reuses the bus payroll lifecycle. It's no
// longer hand-clicked per record — 'approved' is set in bulk when a cycle is
// closed, 'paid' by payout confirmation (webhook) or the bulk "mark all paid".
export type SalaryStatus = 'draft' | 'approved' | 'paid'
export type SalaryCycleStatus = 'open' | 'closed'

export interface SalaryCycle {
  id: string
  period_month: number   // 1..12
  period_year: number
  status: SalaryCycleStatus
  notes: string | null
  payroll_config: import('./payroll').PayrollCalibration | null   // null = use the site-wide default
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

/**
 * The support-staff shape embedded on a SalaryRecord — just what the salary
 * app needs to show and file a row, not the full SupportStaff record from
 * src/lib/supportStaff.ts.
 */
export interface SalaryRecordSupportStaff {
  id: string
  full_name: string
  designation: string | null
  is_active: boolean
}

export interface SalaryRecord {
  id: string
  cycle_id: string
  // Exactly one of staff_id / support_staff_id is set — see
  // supabase-migrations/add_support_staff_salary.sql. Support staff have no
  // profiles row (no login) to reference, so they carry support_staff_id
  // instead. Use recordPersonId()/recordPersonName() below rather than
  // reading staff_id directly wherever "whoever this record is for" is
  // needed — every base-salary/bank-account/attendance lookup keys off that,
  // not off staff_id specifically.
  staff_id: string | null
  support_staff_id: string | null
  base_amount: number
  status: SalaryStatus
  payout_status: string | null   // null | 'initiated' | 'processed' | 'failed'
  payout_reference: string | null
  notes: string | null
  /** Paid in cash for this cycle — kept out of the bank CSV and automated payouts. */
  pay_by_cash: boolean
  // Manual overrides of the derived pay cycle columns; null = use the derived value.
  working_days_override: number | null
  leave_override: number | null
  late_override: number | null
  half_day_override: number | null
  pf_amount_override: number | null
  esi_amount_override: number | null
  // Frozen once, when the cycle is locked (see freezeCycleRecordSnapshots) —
  // "who this was for" and "what their attendance-derived counts were" at
  // that moment, so a hard-deleted account, a later ban, a role change, or an
  // attendance edit made after the lock can never move a closed cycle's
  // figures. Null on an open record, or on one locked before this existed.
  person_name_snapshot: string | null
  person_role_snapshot: string | null
  working_days_snapshot: number | null
  leave_snapshot: number | null
  late_snapshot: number | null
  half_day_snapshot: number | null
  bonus_points_snapshot: number | null
  created_at: string
  updated_at: string
  items?: SalaryRecordItem[]
  staff?: UserProfile | null                       // embedded for admin views (staff & drivers)
  support_staff?: SalaryRecordSupportStaff | null   // embedded for admin views (support staff)
  cycle?: SalaryCycle | null     // embedded for staff views (month/year)
}

/** The id this record is actually about, whichever of the two is set. Every
 *  lookup keyed "by person" (base salary, bank account, attendance, bonus
 *  points) uses this — never staff_id directly, since a support-staff
 *  record's staff_id is null. Empty for a record whose person was since
 *  hard-deleted (both ids go null with them — see recordPersonLeft); such a
 *  record still carries person_name_snapshot for display. */
export function recordPersonId(r: Pick<SalaryRecord, 'staff_id' | 'support_staff_id'>): string {
  return r.staff_id ?? r.support_staff_id ?? ''
}

/** Display name regardless of which kind of person the record is for — falls
 *  back to the name frozen at lock time once the profile/support-staff row
 *  behind the record is gone. */
export function recordPersonName(r: Pick<SalaryRecord, 'staff' | 'support_staff' | 'person_name_snapshot'>): string {
  return r.staff?.full_name ?? r.support_staff?.full_name ?? r.person_name_snapshot ?? ''
}

/**
 * True once the person has left — resigned staff/driver, support staff
 * marked inactive, or (staff_id and support_staff_id both null) the account
 * was deleted outright. Only meaningful for deciding whether an OPEN cycle's
 * roster still includes them; a CLOSED cycle keeps every record regardless
 * of what this returns — see the cycle detail page's `load()`.
 */
export function recordPersonLeft(
  r: Pick<SalaryRecord, 'staff' | 'support_staff' | 'staff_id' | 'support_staff_id'>,
): boolean {
  if (r.staff) return !!r.staff.is_banned
  if (r.support_staff) return !r.support_staff.is_active
  return !r.staff_id && !r.support_staff_id
}

/** Which of the three rosters this record's person belongs to — for filtering the cycle sheet.
 *  Falls back to the role frozen at lock time when the profile is gone. */
export function recordPersonKind(
  r: Pick<SalaryRecord, 'support_staff_id' | 'staff' | 'person_role_snapshot'>,
): 'staff' | 'driver' | 'support' {
  if (r.support_staff_id) return 'support'
  const role = r.staff?.role ?? r.person_role_snapshot
  if (role === 'driver') return 'driver'
  if (role === 'support') return 'support'
  return 'staff'
}

/** The pay-cycle columns an admin may type over by hand. */
export interface SalaryRecordOverrides {
  base_amount?: number
  working_days_override?: number | null
  leave_override?: number | null
  late_override?: number | null
  half_day_override?: number | null
  pf_amount_override?: number | null
  esi_amount_override?: number | null
  pay_by_cash?: boolean
}

export interface StaffSalaryBase {
  id: string
  staff_id: string
  base_amount: number
  active: boolean
  notes: string | null
  // PF/ESI calibration — see src/lib/payroll.ts for how these feed into the pay cycle math.
  pf_basic: number | null
  pf_applicable: boolean
  esi_override: boolean | null   // null = auto by wage ceiling, true/false = always/never
  // Statutory identifiers — see src/lib/statutory.ts for how these feed the EPF/ESI returns.
  uan: string | null             // 12-digit EPFO Universal Account Number
  esi_ip_number: string | null   // 10-digit ESIC Insured Person number
  eps_applicable: boolean        // member is in the pension scheme (8.33% of the employer share)
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

/** Staff roles eligible for salaries: teacher / coordinator / principal / admin (drivers are handled separately). */
const ELIGIBLE_STAFF_ROLES = ['teacher', 'coordinator', 'principal', 'admin']

/** Eligible staff for salaries: not resigned (banned), minus anyone hidden from the salary app in settings. */
export async function fetchEligibleStaff(): Promise<UserProfile[]> {
  const [{ data, error }, hiddenIds] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .in('role', ELIGIBLE_STAFF_ROLES)
      .eq('is_banned', false)
      .order('full_name', { ascending: true }),
    fetchHiddenSalaryMemberIds(),
  ])
  if (error) { console.error('fetchEligibleStaff failed:', error); return [] }
  const hidden = new Set(hiddenIds)
  return ((data as UserProfile[]) || []).filter(p => !hidden.has(p.id))
}

/**
 * Every non-resigned staff/driver profile that could appear in the salary app,
 * regardless of the hidden-members setting — used by the settings page to
 * manage who's hidden.
 */
export async function fetchAllSalaryMembers(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('role', [...ELIGIBLE_STAFF_ROLES, 'driver'])
    .eq('is_banned', false)
    .order('full_name', { ascending: true })
  if (error) { console.error('fetchAllSalaryMembers failed:', error); return [] }
  return (data as UserProfile[]) || []
}

/** Profile ids an admin has chosen to keep out of the salary app's member lists (e.g. an admin account that isn't on payroll). */
export async function fetchHiddenSalaryMemberIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'salary_hidden_members')
    .maybeSingle()
  if (error) { console.error('fetchHiddenSalaryMemberIds failed:', error); return [] }
  const ids = (data?.value as { ids?: unknown } | null)?.ids
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

export async function saveHiddenSalaryMemberIds(ids: string[]): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'salary_hidden_members', value: { ids } }, { onConflict: 'key' })
  if (error) { console.error('saveHiddenSalaryMemberIds failed:', error); return { success: false, error: error.message } }
  return { success: true }
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
// `is_banned` and `email` ride along because the cycle sheet needs them: a
// resigned member is dropped from the sheet entirely, and the search box
// matches on email as well as name. support_staff rides along the same way,
// for the rows that have no profile at all — see recordPersonId/recordPersonName.
const CYCLE_RECORD_SELECT =
  '*, items:salary_record_items(*), ' +
  'staff:profiles!staff_id(id, full_name, email, avatar_url, role, is_non_teaching, display_role, is_banned), ' +
  'support_staff:support_staff!support_staff_id(id, full_name, designation, is_active)'

export async function fetchCycleRecords(cycleId: string): Promise<SalaryRecord[]> {
  const { data, error } = await supabase
    .from('salary_records')
    .select(CYCLE_RECORD_SELECT)
    .eq('cycle_id', cycleId)
  if (error) { console.error('fetchCycleRecords failed:', error); return [] }
  return ((data as unknown as SalaryRecord[]) || []).sort(
    (a, b) => recordPersonName(a).localeCompare(recordPersonName(b)),
  )
}

/**
 * One record, in the same shape the sheet holds.
 *
 * Editing a single cell used to reload the whole cycle — every record, every
 * bank account, a month of attendance — to refresh one number. This is what
 * the sheet re-reads instead when only one row can have changed.
 */
export async function fetchSalaryRecord(recordId: string): Promise<SalaryRecord | null> {
  const { data, error } = await supabase
    .from('salary_records')
    .select(CYCLE_RECORD_SELECT)
    .eq('id', recordId)
    .maybeSingle()
  if (error) { console.error('fetchSalaryRecord failed:', error); return null }
  return (data as unknown as SalaryRecord) ?? null
}

export interface CycleTally { total: number; paid: number }

/**
 * Per-cycle record and paid-record counts, so the list can flag fully-disbursed
 * cycles. An OPEN cycle keeps its rows out of this count for whoever has since
 * resigned (staff/driver), left (support staff), been deleted outright, or
 * since been hidden from the salary app — neither is on payroll any more,
 * matching exactly what the cycle detail page itself excludes from the sheet
 * while it's still open (see its `load`). A CLOSED cycle is history: every
 * record it had at lock time counts, whatever has happened to the person
 * since — matching the same page's behavior once locked.
 */
export async function fetchCycleTallies(): Promise<Record<string, CycleTally>> {
  // Counted in Postgres — one row per cycle — rather than by pulling every
  // salary record ever written into the browser to count them here. The rules
  // (and the reason a closed cycle is exempt from them) live in
  // supabase-migrations/salary_cycle_tally_rpcs.sql, ported verbatim from the
  // loop this replaced; recordPersonLeft above is still the client-side half of
  // the same rule for the screens that hold the records themselves.
  const { data, error } = await supabase.rpc('salary_cycle_tallies')
  if (error) { console.error('fetchCycleTallies failed:', error); return {} }
  const out: Record<string, CycleTally> = {}
  for (const r of (data ?? []) as { cycle_id: string; total: number; paid: number }[]) {
    out[r.cycle_id] = { total: Number(r.total) || 0, paid: Number(r.paid) || 0 }
  }
  return out
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

/**
 * Add a record for every bus driver missing one from this cycle.
 *
 * A cycle is meant to list everyone who gets paid, drivers included. The
 * generate_salary_cycle function does that once add_unified_cycle_records.sql
 * has been applied, but this runs the same fill-in from the client so drivers
 * appear whether or not that migration has reached the database yet. It only
 * ever inserts what is missing, so it is safe to call on every generate and
 * becomes a no-op once the function is doing the work.
 */
export async function ensureDriverRecordsInCycle(
  cycleId: string,
): Promise<{ success: boolean; added?: number; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()

  const [driversRes, basesRes, existingRes, hiddenIds] = await Promise.all([
    supabase.from('profiles').select('id').eq('role', 'driver').eq('is_banned', false),
    supabase.from('driver_payroll_base').select('driver_id, base_amount, active'),
    supabase.from('salary_records').select('id, staff_id, base_amount').eq('cycle_id', cycleId).not('staff_id', 'is', null),
    fetchHiddenSalaryMemberIds(),
  ])
  if (driversRes.error) return { success: false, error: driversRes.error.message }
  if (existingRes.error) return { success: false, error: existingRes.error.message }

  const bases = new Map(
    ((basesRes.data ?? []) as { driver_id: string; base_amount: number; active: boolean }[])
      .map(b => [b.driver_id, b]),
  )
  const already = ((existingRes.data ?? []) as { id: string; staff_id: string; base_amount: number }[])
  const alreadyIds = new Set(already.map(r => r.staff_id))
  const hidden = new Set(hiddenIds)

  const rows = ((driversRes.data ?? []) as { id: string }[])
    // A driver explicitly marked inactive or resigned (banned), or hidden
    // from the salary app, stays off payroll; one with no base row at all is
    // still included, at zero, to be filled in on the cycle page.
    .filter(d => !alreadyIds.has(d.id) && (bases.get(d.id)?.active ?? true) && !hidden.has(d.id))
    .map(d => ({
      cycle_id: cycleId,
      staff_id: d.id,
      base_amount: bases.get(d.id)?.base_amount ?? 0,
      created_by: user?.id,
    }))

  if (rows.length > 0) {
    const { error } = await supabase.from('salary_records').insert(rows)
    if (error) { console.error('ensureDriverRecordsInCycle failed:', error); return { success: false, error: error.message } }
  }

  // Catch up drivers whose cycle row was created before a base salary
  // existed and is still sitting at that zero default, now that a base is on
  // file — otherwise a base added after the cycle opened never shows up.
  // One upsert for the whole catch-up rather than an UPDATE per driver: this
  // runs on every load of an open cycle, and a round trip per row is a round
  // trip per row whether or not any of them turn out to need syncing.
  const resync = already.flatMap(r => {
    const base = bases.get(r.staff_id)
    return Number(r.base_amount) === 0 && base && Number(base.base_amount) !== 0
      ? [{ id: r.id, cycle_id: cycleId, staff_id: r.staff_id, base_amount: base.base_amount }]
      : []
  })
  if (resync.length > 0) {
    const { error } = await supabase.from('salary_records').upsert(resync, { onConflict: 'id' })
    if (error) console.error('ensureDriverRecordsInCycle base sync failed:', error)
  }

  return { success: true, added: rows.length }
}

/**
 * Add a record for every active support staff member missing one from this
 * cycle — the client-side fallback for support staff, exactly mirroring
 * ensureDriverRecordsInCycle above (see it for why this exists alongside the
 * generate_salary_cycle RPC doing the same thing server-side).
 */
export async function ensureSupportStaffRecordsInCycle(
  cycleId: string,
): Promise<{ success: boolean; added?: number; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()

  const [supportRes, basesRes, existingRes, hiddenIds] = await Promise.all([
    supabase.from('support_staff').select('id').eq('is_active', true),
    supabase.from('support_staff_salary_base').select('support_staff_id, base_amount, active'),
    supabase.from('salary_records').select('id, support_staff_id, base_amount').eq('cycle_id', cycleId).not('support_staff_id', 'is', null),
    fetchHiddenSalaryMemberIds(),
  ])
  if (supportRes.error) {
    // A school with no support staff module applied yet has no such table —
    // treat it as "nobody to add" rather than failing the whole cycle run.
    if (isMissingRelation(supportRes.error)) return { success: true, added: 0 }
    return { success: false, error: supportRes.error.message }
  }
  if (existingRes.error) return { success: false, error: existingRes.error.message }

  const bases = new Map(
    ((basesRes.data ?? []) as { support_staff_id: string; base_amount: number; active: boolean }[])
      .map(b => [b.support_staff_id, b]),
  )
  const already = ((existingRes.data ?? []) as { id: string; support_staff_id: string; base_amount: number }[])
  const alreadyIds = new Set(already.map(r => r.support_staff_id))
  const hidden = new Set(hiddenIds)

  const rows = ((supportRes.data ?? []) as { id: string }[])
    .filter(s => !alreadyIds.has(s.id) && (bases.get(s.id)?.active ?? true) && !hidden.has(s.id))
    .map(s => ({
      cycle_id: cycleId,
      support_staff_id: s.id,
      base_amount: bases.get(s.id)?.base_amount ?? 0,
      created_by: user?.id,
    }))

  if (rows.length > 0) {
    const { error } = await supabase.from('salary_records').insert(rows)
    if (error) { console.error('ensureSupportStaffRecordsInCycle failed:', error); return { success: false, error: error.message } }
  }

  // Catch up support staff whose cycle row was created before a base salary
  // existed and is still sitting at that zero default — one upsert for the
  // whole catch-up, same as ensureDriverRecordsInCycle above.
  const resync = already.flatMap(r => {
    const base = bases.get(r.support_staff_id)
    return Number(r.base_amount) === 0 && base && Number(base.base_amount) !== 0
      ? [{ id: r.id, cycle_id: cycleId, support_staff_id: r.support_staff_id, base_amount: base.base_amount }]
      : []
  })
  if (resync.length > 0) {
    const { error } = await supabase.from('salary_records').upsert(resync, { onConflict: 'id' })
    if (error) console.error('ensureSupportStaffRecordsInCycle base sync failed:', error)
  }

  return { success: true, added: rows.length }
}

export async function setCycleStatus(
  cycleId: string,
  status: SalaryCycleStatus,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('salary_cycles').update({ status }).eq('id', cycleId)
  if (error) { console.error('setCycleStatus failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/**
 * Delete a cycle outright. Its records — and their line items — go with it via
 * ON DELETE CASCADE, so this wipes the whole month's payroll for staff.
 */
export async function deleteCycle(cycleId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('salary_cycles').delete().eq('id', cycleId)
  if (error) { console.error('deleteCycle failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Save (or clear, with null) this cycle's own payroll settings override. */
export async function setCyclePayrollConfig(
  cycleId: string,
  config: import('./payroll').PayrollCalibration | null,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('salary_cycles').update({ payroll_config: config }).eq('id', cycleId)
  if (error) { console.error('setCyclePayrollConfig failed:', error); return { success: false, error: error.message } }
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

/** Save hand-typed overrides for one record. Pass null for a field to clear it and fall back to the derived value. */
export async function updateSalaryRecordOverrides(
  recordId: string,
  patch: SalaryRecordOverrides,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('salary_records').update(patch).eq('id', recordId)
  if (error) { console.error('updateSalaryRecordOverrides failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** One record's figures, frozen onto it the moment a cycle is locked — see freezeCycleRecordSnapshots. */
export interface CycleRecordSnapshot {
  id: string
  /** The record's own cycle and person, carried so the freeze can go out as one
   *  upsert — PostgREST evaluates salary_records' NOT NULL and person-check
   *  constraints against the row it forms before the id conflict resolves it
   *  into an UPDATE, so both have to be on every row. */
  cycle_id: string
  staff_id: string | null
  support_staff_id: string | null
  person_name_snapshot: string | null
  person_role_snapshot: string | null
  /** For a field the admin had already hand-overridden before the lock, the
   *  caller passes the value the record already carries rather than a freshly
   *  derived one — that figure is fixed by the override and must not move. */
  working_days_snapshot: number | null
  leave_snapshot: number | null
  late_snapshot: number | null
  half_day_snapshot: number | null
  bonus_points_snapshot: number
}

/**
 * Freeze "who this was for" and the attendance-derived counts behind PF/ESI/LOP
 * onto every record when a cycle is locked, alongside bulkInsertSalaryItems
 * snapshotting the rupee amounts. Without this, a closed cycle's Working
 * Days/Leave/Late/Half Day/bonus-point columns kept recomputing from
 * whatever attendance, holidays and task points look like *today* — and a
 * hard-deleted or since-renamed person's row went blank.
 *
 * The values differ per row, so this cannot be one UPDATE — but it can be one
 * request: an upsert keyed on the primary key writes every row's own figures
 * in a single statement. It used to fire one UPDATE per record, which on a
 * hundred-person cycle meant a hundred round trips inside the lock, any one of
 * which failing left the cycle half-frozen. Every column is sent on every row
 * (see CycleRecordSnapshot) so the rows share one column list.
 */
export async function freezeCycleRecordSnapshots(
  snapshots: CycleRecordSnapshot[],
): Promise<{ success: boolean; error?: string }> {
  if (snapshots.length === 0) return { success: true }
  const { error } = await supabase.from('salary_records').upsert(snapshots, { onConflict: 'id' })
  if (error) { console.error('freezeCycleRecordSnapshots failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Bulk item insert — used to snapshot computed PF/ESI/LOP/bonus onto every record when a cycle is closed. */
export async function bulkInsertSalaryItems(
  items: { record_id: string; label: string; amount: number }[],
): Promise<{ success: boolean; error?: string }> {
  if (items.length === 0) return { success: true }
  const { error } = await supabase.from('salary_record_items').insert(items)
  if (error) { console.error('bulkInsertSalaryItems failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Remove auto-inserted items (by their stable labels) across a set of records — used when reopening a cycle. */
export async function deleteSalaryItemsByLabel(
  recordIds: string[],
  labels: string[],
): Promise<{ success: boolean; error?: string }> {
  if (recordIds.length === 0 || labels.length === 0) return { success: true }
  const { error } = await supabase
    .from('salary_record_items')
    .delete()
    .in('record_id', recordIds)
    .in('label', labels)
  if (error) { console.error('deleteSalaryItemsByLabel failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function bulkSetSalaryRecordStatus(
  recordIds: string[],
  status: SalaryStatus,
): Promise<{ success: boolean; error?: string }> {
  if (recordIds.length === 0) return { success: true }
  const { error } = await supabase.from('salary_records').update({ status }).in('id', recordIds)
  if (error) { console.error('bulkSetSalaryRecordStatus failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/**
 * Drop draft records for people who have since resigned or been hidden from
 * the salary app, right before a cycle locks.
 *
 * These rows exist because the roster sync re-adds anyone missing a record
 * every time an open cycle loads (see generateSalaryCycle /
 * ensureDriverRecordsInCycle / ensureSupportStaffRecordsInCycle) — while the
 * cycle stays open they are correctly filtered out of the sheet, but a
 * CLOSED cycle shows every record it has with no such filter, since it is
 * meant to be history. Left alone, locking would make them reappear: someone
 * who never had a row on the sheet the admin reviewed would suddenly be
 * counted, paid, and show up in every export. Deleting them here — never on
 * an open cycle, where the same person coming off the hidden list or back
 * from resignation should simply pick their row back up — keeps a locked
 * cycle's history to exactly what was approved.
 */
export async function deleteSalaryRecordsByIds(
  recordIds: string[],
): Promise<{ success: boolean; error?: string }> {
  if (recordIds.length === 0) return { success: true }
  const { error } = await supabase.from('salary_records').delete().in('id', recordIds)
  if (error) { console.error('deleteSalaryRecordsByIds failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Base salary config (admin)
// ============================================

/** Every staff base-salary row, with the staff profile, ordered by name. */
export async function fetchBaseSalaries(): Promise<StaffSalaryBase[]> {
  const { data, error } = await supabase
    .from('staff_salary_base')
    .select('*, staff:profiles!staff_id(id, full_name, avatar_url, role, is_non_teaching, display_role)')
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
  pf_basic?: number | null
  pf_applicable?: boolean
  esi_override?: boolean | null
  uan?: string | null
  esi_ip_number?: string | null
  eps_applicable?: boolean
}

/** The staff member's own current base salary config. */
export async function fetchMyBaseSalary(staffId: string): Promise<StaffSalaryBase | null> {
  const { data, error } = await supabase
    .from('staff_salary_base')
    .select('*, staff:profiles!staff_id(id, full_name, avatar_url, role, is_non_teaching, display_role)')
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

/** Mask all but the last 4 digits of an account number for display. */
export function maskAccountNumber(acc: string): string {
  const s = (acc || '').trim()
  if (s.length <= 4) return s
  return '••••' + s.slice(-4)
}

// ============================================
// Payout configuration (site_settings)
// ============================================

// The payout config now describes a direct bank connection (see bankConfig.ts)
// rather than an aggregator. Re-exported here so the many existing
// `from '@/lib/salary'` imports across Salary, Driver Payroll and Settings
// keep resolving unchanged.
export type { PayoutConfig, PayoutProviderId } from './bankConfig'
export {
  fetchPayoutConfig, savePayoutConfig, normalizePayoutConfig,
  PAYOUT_CONFIG_DEFAULTS, PAYOUT_PROVIDERS,
} from './bankConfig'

// ============================================
// Task-manager bonus points
// ============================================

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

/** A bulk-transfer file the bank expects the admin to upload. */
export interface PayoutFileResult { filename: string; content: string; mime: string }

/** Initiate bank disbursement for an approved cycle via the server route. */
export async function initiateCyclePayouts(cycleId: string): Promise<{
  success: boolean; manual?: boolean; initiated?: number; error?: string
  /** bank_file mode: the file to hand to the bank. Money moves on upload. */
  requiresUpload?: boolean; file?: PayoutFileResult | null
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
    return {
      success: true, manual: json.manual, initiated: json.initiated,
      requiresUpload: json.requires_upload, file: json.file ?? null,
    }
  } catch (e) {
    console.error('initiateCyclePayouts failed:', e)
    return { success: false, error: 'Network error starting payouts' }
  }
}

// ============================================
// Bulk roster writes
// ============================================

/** The roster tables a sheet may save into, and the column each is keyed by. */
export type RosterTable =
  | 'staff_salary_base' | 'driver_payroll_base' | 'support_staff_salary_base'
  | 'staff_bank_accounts' | 'driver_bank_accounts' | 'support_staff_bank_accounts'

/**
 * Write every edited row of one roster table in a single request.
 *
 * The Base Salaries and Bank Accounts sheets used to save a row at a time,
 * each preceded by a round trip to the auth server for the user id — forty
 * calls in sequence for twenty edits. The session the client already holds
 * names the user, and an array upsert writes them all at once; RLS still
 * decides whether the write is allowed, exactly as for a single row.
 */
export async function bulkUpsertRoster(
  table: RosterTable,
  conflictColumn: 'staff_id' | 'driver_id' | 'support_staff_id',
  rows: Record<string, unknown>[],
): Promise<{ success: boolean; error?: string }> {
  if (rows.length === 0) return { success: true }
  const { data: { session } } = await supabase.auth.getSession()
  const createdBy = session?.user?.id
  const { error } = await supabase
    .from(table)
    .upsert(rows.map(r => ({ ...r, created_by: createdBy })), { onConflict: conflictColumn })
  if (error) { console.error(`bulkUpsertRoster(${table}) failed:`, error); return { success: false, error: error.message } }
  return { success: true }
}
