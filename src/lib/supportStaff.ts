import { supabase, isMissingRelation } from './supabase'
import type { StaffAttendanceRecord, StaffAttendanceStatus } from './attendance'

// ============================================
// Support staff — ground-level cleaning / maintenance staff
// --------------------------------------------
// These people have no account and no app: many have no phone at all, so
// there is nothing for them to sign in to and nothing for them to punch with.
// They exist only as names an admin maintains in the Staff Profile Manager,
// used in two places — attendance (always marked FOR them by an admin) and
// salary management.
//
// They deliberately live in their own table rather than in `profiles`, whose
// id is a foreign key to auth.users: a profile row would mean a login, and it
// would put them into every list that reads staff by role. See
// supabase-migrations/add_support_staff.sql.
// ============================================

export interface SupportStaff {
  id: string
  full_name: string
  // ── Employment ──────────────────────────────
  employee_id: string | null
  designation: string | null            // Housekeeping / Gardener / Security / Helper…
  department: string | null
  employment_type: string | null        // Permanent / Contractual / Daily Wage…
  date_of_joining: string | null        // 'YYYY-MM-DD'
  monthly_wage: number | null           // used by salary management
  // ── Contact ─────────────────────────────────
  phone: string | null
  alternate_phone: string | null
  emergency_contact_name: string | null
  emergency_contact: string | null
  address: string | null
  // ── Personal ────────────────────────────────
  date_of_birth: string | null          // 'YYYY-MM-DD'
  gender: string | null
  blood_group: string | null
  // ── Identity / payout ───────────────────────
  aadhaar_no: string | null
  pan_no: string | null
  bank_account_no: string | null
  bank_name: string | null
  ifsc_code: string | null
  notes: string | null
  /** false = left the school. The row stays so past attendance still has a name. */
  is_active: boolean
  /** Excluded from the attendance list, counts and statistics. */
  attendance_hidden: boolean
  created_by?: string | null
  created_at?: string
  updated_at?: string
}

/** Everything an admin can set on a support staff member. */
export type SupportStaffPatch = Partial<
  Omit<SupportStaff, 'id' | 'created_by' | 'created_at' | 'updated_at'>
>

/**
 * No WFH here: it describes a punch, and support staff never punch. Exception
 * is kept, though — it now covers the same "otherwise fine, but flag it"
 * case an admin can mark for regular staff (e.g. a mid-day permission break),
 * just recorded by hand instead of derived from a second check-in.
 *
 * `on_leave` has no button of its own any more (see QUICK_SET in
 * SupportStaffAttendanceReport) but is kept in the type so older records
 * still display correctly.
 */
export type SupportAttendanceStatus = 'present' | 'absent' | 'late' | 'half_day' | 'on_leave' | 'e'

export interface SupportAttendanceRecord {
  id: string
  support_staff_id: string
  date: string
  status: SupportAttendanceStatus
  marked_by: string | null
  remarks: string | null
  created_at?: string
  updated_at?: string
}

export const SUPPORT_ATTENDANCE_STATUS_LABELS: Record<SupportAttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  half_day: 'Half Day',
  on_leave: 'On Leave',
  e: 'Exception',
}

export const SUPPORT_ATTENDANCE_STATUS_PILL: Record<SupportAttendanceStatus, string> = {
  present:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  absent:   'bg-red-50 text-red-700 border-red-200',
  late:     'bg-amber-50 text-amber-700 border-amber-200',
  half_day: 'bg-orange-50 text-orange-700 border-orange-200',
  on_leave: 'bg-blue-50 text-blue-700 border-blue-200',
  e:        'bg-violet-50 text-violet-700 border-violet-200',
}

/** Statuses that count as the person having worked the day. */
export const SUPPORT_PRESENT_STATUSES: SupportAttendanceStatus[] = ['present', 'late', 'half_day', 'e']

// ============================================
// Roster
// ============================================

const SUPPORT_STAFF_COLUMNS = `
  id, full_name, employee_id, designation, department, employment_type,
  date_of_joining, monthly_wage, phone, alternate_phone, emergency_contact_name,
  emergency_contact, address, date_of_birth, gender, blood_group, aadhaar_no,
  pan_no, bank_account_no, bank_name, ifsc_code, notes, is_active,
  attendance_hidden, created_at, updated_at
`

/**
 * The support staff roster, alphabetical. Resigned members are included by
 * default so the profile manager can list them (struck through, as banned
 * profiles are); the attendance report asks for active members only.
 */
export async function fetchSupportStaff(
  { activeOnly = false, trackedOnly = false }: { activeOnly?: boolean; trackedOnly?: boolean } = {}
): Promise<SupportStaff[]> {
  let query = supabase
    .from('support_staff')
    .select(SUPPORT_STAFF_COLUMNS)
    .order('full_name', { ascending: true })
  if (activeOnly) query = query.eq('is_active', true)
  if (trackedOnly) query = query.eq('attendance_hidden', false)

  const { data, error } = await query
  if (error) {
    // The feature degrades to "no support staff" until the migration is applied
    // rather than filling the console with the same red 404 on every load.
    if (isMissingRelation(error)) {
      console.warn('support_staff table missing — run supabase-migrations/add_support_staff.sql')
      return []
    }
    console.error('fetchSupportStaff error:', error)
    return []
  }
  return (data ?? []) as unknown as SupportStaff[]
}

function normalizePatch(patch: SupportStaffPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = typeof value === 'string' && value.trim() === '' ? null : value
  }
  return out
}

export async function createSupportStaff(
  patch: SupportStaffPatch & { full_name: string },
  createdBy?: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const full_name = patch.full_name.trim()
  if (!full_name) return { success: false, error: 'Full name is required' }

  const { data, error } = await supabase
    .from('support_staff')
    .insert({ ...normalizePatch(patch), full_name, created_by: createdBy ?? null })
    .select('id')
    .single()

  if (error) {
    console.error('createSupportStaff error:', error)
    return {
      success: false,
      error: isMissingRelation(error)
        ? 'Support staff are not set up in this database yet — run add_support_staff.sql'
        : error.message,
    }
  }
  return { success: true, id: data?.id }
}

export async function updateSupportStaff(
  id: string,
  patch: SupportStaffPatch,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('support_staff')
    .update(normalizePatch(patch))
    .eq('id', id)
  if (error) {
    console.error('updateSupportStaff error:', error)
    return { success: false, error: error.message }
  }
  return { success: true }
}

export async function deleteSupportStaff(id: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('support_staff').delete().eq('id', id)
  if (error) {
    console.error('deleteSupportStaff error:', error)
    return { success: false, error: error.message }
  }
  return { success: true }
}

/** Marks a support staff member as left / restores them. */
export async function setSupportStaffActive(
  id: string,
  active: boolean,
): Promise<{ success: boolean; error?: string }> {
  return updateSupportStaff(id, { is_active: active })
}

// ============================================
// Attendance
// ============================================

/** Every support attendance row for one date. */
export async function fetchSupportAttendanceByDate(
  date: string,
): Promise<SupportAttendanceRecord[]> {
  const { data, error } = await supabase
    .from('support_staff_attendance')
    .select('*')
    .eq('date', date)
  if (error) {
    if (isMissingRelation(error)) return []
    console.error('fetchSupportAttendanceByDate error:', error)
    return []
  }
  return (data ?? []) as SupportAttendanceRecord[]
}

/**
 * Every support attendance row in a date window (inclusive). One query backs
 * both the day's list and the month-to-date statistics beside each name.
 */
export async function fetchSupportAttendanceRange(
  startDate: string,
  endDate: string,
): Promise<SupportAttendanceRecord[]> {
  const { data, error } = await supabase
    .from('support_staff_attendance')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
  if (error) {
    if (isMissingRelation(error)) return []
    console.error('fetchSupportAttendanceRange error:', error)
    return []
  }
  return (data ?? []) as SupportAttendanceRecord[]
}

export async function markSupportAttendance(
  supportStaffId: string,
  date: string,
  status: SupportAttendanceStatus,
  markedBy: string,
  remarks?: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('support_staff_attendance')
    .upsert(
      {
        support_staff_id: supportStaffId,
        date,
        status,
        marked_by: markedBy,
        remarks: remarks ?? null,
      },
      { onConflict: 'support_staff_id,date' },
    )
  if (error) {
    console.error('markSupportAttendance error:', error)
    return false
  }
  return true
}

/** Removes a mark, putting the person back to "not marked" for that day. */
export async function clearSupportAttendance(
  supportStaffId: string,
  date: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('support_staff_attendance')
    .delete()
    .eq('support_staff_id', supportStaffId)
    .eq('date', date)
  if (error) {
    console.error('clearSupportAttendance error:', error)
    return false
  }
  return true
}

// ============================================
// Statistics
// ============================================

export interface SupportDayStats {
  total: number
  present: number     // present + late + half_day + e
  absent: number
  late: number
  half_day: number
  on_leave: number
  e: number
  not_marked: number
  present_pct: number
}

/**
 * The day's tallies across a roster. Unlike the regular staff report, an
 * unmarked support staff member is NOT derived as absent: nobody can check
 * themselves in here, so a missing row means the admin has not gotten to them
 * yet, which is a different fact from being away — and counting it as absent
 * would silently distort the salary side.
 *
 * Roster and records are typed loosely (just an id, just a status keyed by
 * support_staff_id) so the same function also covers drivers folded into
 * this section from `profiles` — see SupportStaffAttendanceReport.tsx, which
 * maps their staff_attendance_records rows onto this shape rather than this
 * function knowing two different tables.
 */
export function computeSupportDayStats(
  roster: { id: string }[],
  records: { support_staff_id: string; status: SupportAttendanceStatus }[],
): SupportDayStats {
  const byStaff = new Map(records.map(r => [r.support_staff_id, r]))
  const stats: SupportDayStats = {
    total: roster.length,
    present: 0, absent: 0, late: 0, half_day: 0, on_leave: 0, e: 0,
    not_marked: 0, present_pct: 0,
  }
  for (const person of roster) {
    const record = byStaff.get(person.id)
    if (!record) { stats.not_marked++; continue }
    switch (record.status) {
      case 'present': stats.present++; break
      case 'late': stats.late++; stats.present++; break
      case 'half_day': stats.half_day++; stats.present++; break
      case 'absent': stats.absent++; break
      case 'on_leave': stats.on_leave++; break
      case 'e': stats.e++; stats.present++; break
    }
  }
  stats.present_pct = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0
  return stats
}

export interface SupportPersonStats {
  marked_days: number
  present: number
  late: number
  half_day: number
  absent: number
  on_leave: number
  e: number
  /** (present + late + e + ½·half_day) / (marked days − leave), over marked days only. */
  present_pct: number
}

/**
 * Month-to-date figures for one person, computed over the days actually
 * marked. Unmarked days are left out of both sides of the fraction for the
 * reason given on computeSupportDayStats — it keeps the percentage a
 * statement about observed days rather than about how far the admin has got.
 *
 * Takes just `{ status }[]` (SupportAttendanceRecord satisfies this) so a
 * driver's staff_attendance_records rows can be passed in after mapping
 * their status into this narrower enum, without a second copy of this math.
 */
export function computeSupportPersonStats(
  records: { status: SupportAttendanceStatus }[],
): SupportPersonStats {
  const stats: SupportPersonStats = {
    marked_days: records.length,
    present: 0, late: 0, half_day: 0, absent: 0, on_leave: 0, e: 0, present_pct: 0,
  }
  for (const r of records) {
    switch (r.status) {
      case 'present': stats.present++; break
      case 'late': stats.late++; break
      case 'half_day': stats.half_day++; break
      case 'absent': stats.absent++; break
      case 'on_leave': stats.on_leave++; break
      case 'e': stats.e++; break
    }
  }
  const denominator = stats.marked_days - stats.on_leave
  const credited = stats.present + stats.late + stats.e + stats.half_day * 0.5
  stats.present_pct = denominator > 0 ? Math.round((credited / denominator) * 100) : 0
  return stats
}

/** Groups a flat range of records by person, each list sorted by date. */
export function groupSupportRecordsByStaff(
  records: SupportAttendanceRecord[],
): Map<string, SupportAttendanceRecord[]> {
  const map = new Map<string, SupportAttendanceRecord[]>()
  for (const r of records) {
    const list = map.get(r.support_staff_id)
    if (list) list.push(r)
    else map.set(r.support_staff_id, [r])
  }
  for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date))
  return map
}

/**
 * Adapts one support-staff attendance row into the shape
 * computeStaffAttendanceStats (src/lib/payroll.ts) and deriveDayStatus /
 * computeMonthlyStats (src/lib/attendance.ts) already know how to reduce
 * over — so a support staff member's pay-cycle figures (working days,
 * leave, late, half day) come from the exact same math as everyone else's
 * pay cycle, rather than a second copy of it. Every geofence/check-in field,
 * which that math never reads, is filled with null; there is no punch to
 * report because support staff never punch in.
 */
export function supportRecordToStaffShape(r: SupportAttendanceRecord): StaffAttendanceRecord {
  return {
    id: r.id,
    staff_id: r.support_staff_id,
    date: r.date,
    status: r.status as StaffAttendanceStatus,
    check_in_time: null, check_in_lat: null, check_in_lng: null, check_in_accuracy: null,
    check_in_distance_m: null, geofence_passed: null,
    check_out_time: null, check_out_lat: null, check_out_lng: null, check_out_accuracy: null,
    check_out_distance_m: null,
    check_in_time_2: null, check_in_lat_2: null, check_in_lng_2: null, check_in_accuracy_2: null,
    check_in_distance_m_2: null,
    check_out_time_2: null, check_out_lat_2: null, check_out_lng_2: null, check_out_accuracy_2: null,
    check_out_distance_m_2: null,
    leave_application_id: null, marked_by: r.marked_by, remarks: r.remarks,
    created_at: r.created_at ?? '', updated_at: r.updated_at ?? '',
    check_in_verdict: null, check_out_verdict: null, check_in_verdict_2: null, check_out_verdict_2: null,
    forgotten_checkout_ack_at: null,
  }
}

// ============================================
// Salary — base config & bank account
// --------------------------------------------
// Mirrors staff_salary_base / staff_bank_accounts (src/lib/salary.ts) and
// driver_payroll_base / driver_bank_accounts (src/lib/driverSalary.ts, bus.ts)
// column-for-column, in their own tables: support staff have no profiles row
// to hang a foreign key off, so they can't share the staff/driver tables —
// see supabase-migrations/add_support_staff_salary.sql.
// ============================================

export interface SupportStaffSalaryBase {
  id: string
  support_staff_id: string
  base_amount: number
  active: boolean
  notes: string | null
  pf_basic: number | null
  pf_applicable: boolean
  esi_override: boolean | null
  uan: string | null
  esi_ip_number: string | null
  eps_applicable: boolean
  created_at: string
  updated_at: string
}

export interface SupportStaffBankAccount {
  id: string
  support_staff_id: string
  account_holder_name: string
  account_number: string
  ifsc: string
  bank_name: string | null
  payout_fund_account_id: string | null
  created_at: string
  updated_at: string
}

/** Every support staff base-salary row, ordered by nothing in particular — callers key it by support_staff_id. */
export async function fetchSupportStaffSalaryBases(): Promise<SupportStaffSalaryBase[]> {
  const { data, error } = await supabase.from('support_staff_salary_base').select('*')
  if (error) {
    if (isMissingRelation(error)) return []
    console.error('fetchSupportStaffSalaryBases failed:', error)
    return []
  }
  return (data as SupportStaffSalaryBase[]) || []
}

export interface SupportStaffBaseSalaryInput {
  support_staff_id: string
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

export async function upsertSupportStaffSalaryBase(
  input: SupportStaffBaseSalaryInput,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('support_staff_salary_base')
    .upsert({ ...input, created_by: user?.id }, { onConflict: 'support_staff_id' })
  if (error) { console.error('upsertSupportStaffSalaryBase failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** All support staff bank accounts (admin). */
export async function fetchSupportStaffBankAccounts(): Promise<SupportStaffBankAccount[]> {
  const { data, error } = await supabase.from('support_staff_bank_accounts').select('*')
  if (error) {
    if (isMissingRelation(error)) return []
    console.error('fetchSupportStaffBankAccounts failed:', error)
    return []
  }
  return (data as SupportStaffBankAccount[]) || []
}

export interface SupportStaffBankAccountInput {
  support_staff_id: string
  account_holder_name: string
  account_number: string
  ifsc: string
  bank_name?: string | null
}

export async function upsertSupportStaffBankAccount(
  input: SupportStaffBankAccountInput,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('support_staff_bank_accounts')
    .upsert({ ...input, created_by: user?.id }, { onConflict: 'support_staff_id' })
  if (error) { console.error('upsertSupportStaffBankAccount failed:', error); return { success: false, error: error.message } }
  return { success: true }
}
