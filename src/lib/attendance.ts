import { supabase, UserProfile } from './supabase'
import { fetchStaffDetailsMap } from './staffDetails'

// ============================================
// Types
// ============================================

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'on_leave' | 'excused' | 'on_duty' | 'half_day'
export type StaffAttendanceStatus = 'present' | 'absent' | 'late' | 'on_leave' | 'wfh' | 'half_day' | 'e'
// WFH is kept in the type for backward-compat with existing records and admin overrides,
// but it is no longer offered as a self-service option for regular staff.
// 'e' = exception / permission-break: teacher checked out mid-day and returned (second check-in).

export interface AttendanceRecord {
  id: string
  homeroom_id: string
  student_id: string
  date: string
  status: AttendanceStatus
  leave_application_id: string | null
  marked_by: string | null
  remarks: string | null
  created_at: string
  updated_at: string
}

export interface StaffAttendanceRecord {
  id: string
  staff_id: string
  date: string
  status: StaffAttendanceStatus
  check_in_time: string | null
  check_in_lat: number | null
  check_in_lng: number | null
  check_in_accuracy: number | null
  geofence_passed: boolean | null
  check_out_time: string | null
  check_out_lat: number | null
  check_out_lng: number | null
  check_out_accuracy: number | null
  check_in_time_2: string | null
  check_in_lat_2: number | null
  check_in_lng_2: number | null
  check_in_accuracy_2: number | null
  check_out_time_2: string | null
  check_out_lat_2: number | null
  check_out_lng_2: number | null
  check_out_accuracy_2: number | null
  leave_application_id: string | null
  marked_by: string | null
  remarks: string | null
  created_at: string
  updated_at: string
  staff?: UserProfile
}

export interface AttendanceSheetRow {
  student: UserProfile
  record: AttendanceRecord | null
}

export interface AttendanceSummary {
  total_days: number
  present: number
  absent: number
  late: number
  on_leave: number
  excused: number
  on_duty: number
  half_day: number
  present_pct: number
}

export interface GeofenceConfig {
  enabled: boolean
  lat: number | null
  lng: number | null
  radius_m: number
}

/**
 * A named centre point applied to one group of staff instead of the
 * school-wide config above (e.g. a second campus or an annexe block).
 */
export interface GeofenceZone {
  id: string
  label: string
  lat: number
  lng: number
  radius_m: number
  staff_ids: string[]
}

export interface GeofenceZoneInput {
  label: string
  lat: number
  lng: number
  radius_m: number
  staff_ids: string[]
}

/** The geofence one staff member is actually checked against. */
export interface EffectiveGeofence extends GeofenceConfig {
  zone_id: string | null
  zone_label: string | null
}

export interface AttendanceConfig {
  late_cutoff: string | null
  // Local "HH:MM" — staff who check OUT before this time are auto-marked half_day.
  checkout_cutoff: string | null
}

export interface Holiday {
  id: string
  date: string
  name: string
}

export type DayTimingScopeType = 'date' | 'weekday'
export type DayTimingScope =
  | { type: 'date'; date: string }
  | { type: 'weekday'; weekday: number } // 0 = Sunday .. 6 = Saturday

export interface DayTimingGroup {
  id: string
  scope_type: DayTimingScopeType
  scope_date: string | null
  scope_weekday: number | null
  label: string
  is_default: boolean
  late_cutoff: string // 'HH:MM:SS' — check in after this time is marked Late
  checkout_cutoff: string // check out before this time is marked Half Day
  staff_ids: string[]
}

export interface DayTimingGroupInput {
  label: string
  is_default: boolean
  late_cutoff: string // 'HH:MM'
  checkout_cutoff: string
  staff_ids: string[]
}

export interface StaffMonthlyStats {
  working_days: number   // weekdays in month that are not holidays, up to today
  present: number
  late: number
  half_day: number
  wfh: number
  on_leave: number
  absent: number
  e: number
  holidays: number
  present_pct: number    // (present + late + wfh + 0.5*half_day + e) / working_days
}

// Statuses that count as the staff member having shown up for work.
export const PRESENT_STATUSES: StaffAttendanceStatus[] = ['present', 'late', 'wfh', 'half_day']

export function isPresentStatus(status: StaffAttendanceStatus): boolean {
  return PRESENT_STATUSES.includes(status)
}

// ============================================
// Display Helpers
// ============================================

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  on_leave: 'On Leave (OL)',
  excused: 'Excused',
  on_duty: 'On Duty (OD)',
  half_day: 'Half Day',
}

export const STAFF_ATTENDANCE_STATUS_LABELS: Record<StaffAttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  on_leave: 'On Leave',
  wfh: 'Work from Home',
  half_day: 'Half Day',
  e: 'Exception',
}

export const ATTENDANCE_STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-700 border-green-200',
  absent: 'bg-red-100 text-red-700 border-red-200',
  late: 'bg-amber-100 text-amber-700 border-amber-200',
  on_leave: 'bg-blue-100 text-blue-700 border-blue-200',
  excused: 'bg-purple-100 text-purple-700 border-purple-200',
  on_duty: 'bg-teal-100 text-teal-700 border-teal-200',
  half_day: 'bg-orange-100 text-orange-700 border-orange-200',
}

export const STAFF_ATTENDANCE_STATUS_COLORS: Record<StaffAttendanceStatus, string> = {
  present: 'bg-green-100 text-green-700 border-green-200',
  absent: 'bg-red-100 text-red-700 border-red-200',
  late: 'bg-amber-100 text-amber-700 border-amber-200',
  on_leave: 'bg-blue-100 text-blue-700 border-blue-200',
  wfh: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  half_day: 'bg-orange-100 text-orange-700 border-orange-200',
  e: 'bg-violet-100 text-violet-700 border-violet-200',
}

// ============================================
// Haversine distance helper
// ============================================

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000 // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ============================================
// Student Attendance
// ============================================

export async function fetchMyAttendanceByMonth(
  studentId: string,
  year: number,
  month: number, // 1-based
  homeroomId?: string
): Promise<AttendanceRecord[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  let query = supabase
    .from('attendance_records')
    .select('*')
    .eq('student_id', studentId)
    .gte('date', startDate)
    .lte('date', endDate)

  if (homeroomId) query = query.eq('homeroom_id', homeroomId)

  const { data, error } = await query.order('date', { ascending: true })

  if (error) {
    console.error('fetchMyAttendanceByMonth error:', error)
    return []
  }
  return data ?? []
}

export async function fetchAttendanceSummary(
  studentId: string,
  homeroomId?: string,
  startDate?: string,
  endDate?: string
): Promise<AttendanceSummary> {
  // Default: current academic year (April → March)
  const now = new Date()
  const yearStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const defaultStart = `${yearStart}-04-01`
  const defaultEnd = `${yearStart + 1}-03-31`

  let query = supabase
    .from('attendance_records')
    .select('status')
    .eq('student_id', studentId)
    .gte('date', startDate ?? defaultStart)
    .lte('date', endDate ?? defaultEnd)

  if (homeroomId) query = query.eq('homeroom_id', homeroomId)

  const { data, error } = await query

  if (error) {
    console.error('fetchAttendanceSummary error:', error)
    return { total_days: 0, present: 0, absent: 0, late: 0, on_leave: 0, excused: 0, on_duty: 0, half_day: 0, present_pct: 0 }
  }

  const records = data ?? []
  const counts = { present: 0, absent: 0, late: 0, on_leave: 0, excused: 0, on_duty: 0, half_day: 0 }
  for (const r of records) {
    if (r.status in counts) counts[r.status as AttendanceStatus]++
  }

  const total_days = records.length
  // Present percentage excludes on_leave and on_duty days from denominator
  const denominator = total_days - counts.on_leave - counts.on_duty
  const present_pct = denominator > 0 ? Math.round((counts.present / denominator) * 100) : 0

  return { total_days, ...counts, present_pct }
}

// ============================================
// Staff: Homeroom Sheet
// ============================================

export async function fetchAttendanceSheet(
  homeroomId: string,
  date: string
): Promise<AttendanceSheetRow[]> {
  // Fetch all members of the homeroom
  const { data: members, error: memError } = await supabase
    .from('homeroom_members')
    .select(`
      student_id,
      student:profiles!homeroom_members_student_id_fkey(
        id, email, full_name, role, avatar_url, grade, section
      )
    `)
    .eq('homeroom_id', homeroomId)
    .order('created_at', { ascending: true })

  if (memError) {
    console.error('fetchAttendanceSheet members error:', memError)
    return []
  }

  // Fetch existing records for this homeroom+date
  const { data: records, error: recError } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('homeroom_id', homeroomId)
    .eq('date', date)

  if (recError) {
    console.error('fetchAttendanceSheet records error:', recError)
  }

  const recordByStudent: Record<string, AttendanceRecord> = {}
  for (const r of records ?? []) {
    recordByStudent[r.student_id] = r
  }

  return (members ?? []).map(m => {
    const student = Array.isArray(m.student) ? m.student[0] : m.student
    return {
      student: student as UserProfile,
      record: recordByStudent[m.student_id] ?? null,
    }
  })
}

export async function bulkMarkAttendance(
  homeroomId: string,
  date: string,
  rows: { studentId: string; status: AttendanceStatus; remarks?: string }[],
  markedBy: string
): Promise<boolean> {
  if (rows.length === 0) return true

  const upsertRows = rows.map(r => ({
    homeroom_id: homeroomId,
    student_id: r.studentId,
    date,
    status: r.status,
    remarks: r.remarks ?? null,
    marked_by: markedBy,
  }))

  const { error } = await supabase
    .from('attendance_records')
    .upsert(upsertRows, { onConflict: 'homeroom_id,student_id,date' })

  if (error) {
    console.error('bulkMarkAttendance error:', error)
    return false
  }
  return true
}

// ============================================
// Leave → Attendance Sync
// ============================================

function getDatesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const current = new Date(startDate)
  const end = new Date(endDate)
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0])
    current.setDate(current.getDate() + 1)
  }
  return dates
}

export async function syncLeaveToStudentAttendance(
  leaveApplicationId: string,
  studentId: string,
  startDate: string,
  endDate: string,
  leaveType?: string
): Promise<void> {
  // Find all homerooms the student belongs to
  const { data: memberships, error: memError } = await supabase
    .from('homeroom_members')
    .select('homeroom_id')
    .eq('student_id', studentId)

  if (memError || !memberships?.length) return

  // OD leave → Present (student is working, just off-site); casual/medical → Absent
  const attendanceStatus: AttendanceStatus = leaveType === 'on_duty' ? 'present' : 'absent'

  const dates = getDatesBetween(startDate, endDate)
  const rows: Record<string, unknown>[] = []

  for (const { homeroom_id } of memberships) {
    for (const date of dates) {
      rows.push({
        homeroom_id,
        student_id: studentId,
        date,
        status: attendanceStatus,
        leave_application_id: leaveApplicationId,
      })
    }
  }

  if (rows.length === 0) return

  const { error } = await supabase
    .from('attendance_records')
    .upsert(rows, { onConflict: 'homeroom_id,student_id,date' })

  if (error) console.error('syncLeaveToStudentAttendance error:', error)
}

export async function syncLeaveToStaffAttendance(
  leaveApplicationId: string,
  staffId: string,
  startDate: string,
  endDate: string,
  leaveType?: string
): Promise<void> {
  const dates = getDatesBetween(startDate, endDate)
  // On Duty auto-marks Present; any other approved leave auto-marks Absent —
  // status only ever lands on one of the five manual options (P/A/Late/½/Exception).
  const status: StaffAttendanceStatus = leaveType === 'on_duty' ? 'present' : 'absent'

  const rows = dates.map(date => ({
    staff_id: staffId,
    date,
    status,
    leave_application_id: leaveApplicationId,
  }))

  if (rows.length === 0) return

  const { error } = await supabase
    .from('staff_attendance_records')
    .upsert(rows, { onConflict: 'staff_id,date' })

  if (error) console.error('syncLeaveToStaffAttendance error:', error)
}

// ============================================
// Staff Self-Attendance
// ============================================

/**
 * Authoritative "now" for check-in/checkout, sourced from the DB server clock
 * rather than the device's — a device clock can be set to whatever the user
 * likes, which would otherwise let them dodge the late/half-day cutoffs.
 * Falls back to the device clock only if the RPC call itself fails.
 */
export async function fetchServerTime(): Promise<Date> {
  const { data, error } = await supabase.rpc('get_server_time')
  if (error || !data) {
    console.error('fetchServerTime error, falling back to device clock:', error)
    return new Date()
  }
  return new Date(data as string)
}

/** Returns 'late' if current local time is past the cutoff, otherwise 'present'. */
export function deriveCheckInStatus(lateCutoff: string | null | undefined, now: Date = new Date()): StaffAttendanceStatus {
  if (!lateCutoff) return 'present'
  const [h, m] = lateCutoff.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return 'present'
  const cutoffMinutes = h * 60 + m
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return nowMinutes > cutoffMinutes ? 'late' : 'present'
}

/**
 * Minimum gap enforced between successive check-in/checkout actions
 * (check-in → checkout → return check-in → final checkout), so a misclick
 * can't immediately undo the action right after it. Shared by the server
 * write path (authoritative) and the UI (countdown / disabled state).
 */
export const MIN_ACTION_GAP_MS = 5 * 60 * 1000

/** Milliseconds remaining before the next action is allowed; 0 once the gap has elapsed. */
export function msUntilActionAllowed(prevIso: string | null | undefined, now: Date): number {
  if (!prevIso) return 0
  const elapsed = now.getTime() - new Date(prevIso).getTime()
  return Math.max(0, MIN_ACTION_GAP_MS - elapsed)
}

export interface CheckInOptions {
  coords?: { lat: number; lng: number; accuracy: number }
  geofenceConfig?: GeofenceConfig
  lateCutoff?: string | null
  /** Explicit status override (e.g. 'wfh', 'half_day'). When omitted, present/late is derived. */
  status?: StaffAttendanceStatus
}

export async function checkInStaff(
  staffId: string,
  options: CheckInOptions = {}
): Promise<{ success: boolean; status?: StaffAttendanceStatus; geofencePassed?: boolean; distanceM?: number; tooSoonMs?: number }> {
  const { coords, geofenceConfig, lateCutoff, status } = options
  let geofencePassed: boolean | undefined
  let distanceM: number | undefined

  if (coords && geofenceConfig?.enabled && geofenceConfig.lat != null && geofenceConfig.lng != null) {
    distanceM = Math.round(
      haversineDistance(coords.lat, coords.lng, geofenceConfig.lat, geofenceConfig.lng)
    )
    // Tolerance for the device's own reported GPS uncertainty, capped so a wildly
    // inaccurate fix can't be used to pass from far away. Mirrors StaffCheckIn's
    // client-side checkGeofence() so the stored geofence_passed flag always agrees
    // with whatever actually let the check-in through.
    const tolerance = Math.min(coords.accuracy || 0, 75)
    geofencePassed = distanceM <= geofenceConfig.radius_m + tolerance
  }

  const serverNow = await fetchServerTime()
  const today = serverNow.toISOString().split('T')[0]
  const now = serverNow.toISOString()

  // Check for an existing record to determine first vs second check-in.
  const { data: existing } = await supabase
    .from('staff_attendance_records')
    .select('check_in_time, check_out_time, check_in_time_2')
    .eq('staff_id', staffId).eq('date', today).maybeSingle()

  if (existing?.check_in_time_2) return { success: false } // already at max 2 check-ins

  if (existing?.check_in_time && existing?.check_out_time) {
    // Second check-in after first checkout — permission break return.
    const tooSoonMs = msUntilActionAllowed(existing.check_out_time, serverNow)
    if (tooSoonMs > 0) return { success: false, tooSoonMs }

    const { error } = await supabase.from('staff_attendance_records').update({
      status: 'e',
      check_in_time_2: now,
      check_in_lat_2: coords?.lat ?? null,
      check_in_lng_2: coords?.lng ?? null,
      check_in_accuracy_2: coords?.accuracy ?? null,
    }).eq('staff_id', staffId).eq('date', today)
    if (error) { console.error('checkInStaff (2nd) error:', error); return { success: false } }
    return { success: true, status: 'e', geofencePassed, distanceM }
  }

  // WFH / Half Day are explicit choices; Present/Late is derived from the cutoff.
  const finalStatus: StaffAttendanceStatus =
    status && status !== 'present' ? status : deriveCheckInStatus(lateCutoff, serverNow)

  const { error } = await supabase
    .from('staff_attendance_records')
    .upsert(
      {
        staff_id: staffId,
        date: today,
        status: finalStatus,
        check_in_time: now,
        check_in_lat: coords?.lat ?? null,
        check_in_lng: coords?.lng ?? null,
        check_in_accuracy: coords?.accuracy ?? null,
        geofence_passed: geofencePassed ?? null,
      },
      { onConflict: 'staff_id,date' }
    )

  if (error) {
    console.error('checkInStaff error:', error)
    return { success: false }
  }

  return { success: true, status: finalStatus, geofencePassed, distanceM }
}

export interface CheckOutOptions {
  coords?: { lat: number; lng: number; accuracy: number }
  geofenceConfig?: GeofenceConfig
  checkoutCutoff?: string | null
}

export async function checkOutStaff(
  staffId: string,
  options: CheckOutOptions = {}
): Promise<{ success: boolean; markedHalfDay?: boolean; geofencePassed?: boolean; distanceM?: number; tooSoonMs?: number }> {
  const { coords, geofenceConfig, checkoutCutoff } = options
  let geofencePassed: boolean | undefined
  let distanceM: number | undefined

  if (coords && geofenceConfig?.enabled && geofenceConfig.lat != null && geofenceConfig.lng != null) {
    distanceM = Math.round(
      haversineDistance(coords.lat, coords.lng, geofenceConfig.lat, geofenceConfig.lng)
    )
    // Tolerance for the device's own reported GPS uncertainty, capped so a wildly
    // inaccurate fix can't be used to pass from far away. Mirrors StaffCheckIn's
    // client-side checkGeofence() so the stored geofence_passed flag always agrees
    // with whatever actually let the check-out through.
    const tolerance = Math.min(coords.accuracy || 0, 75)
    geofencePassed = distanceM <= geofenceConfig.radius_m + tolerance
  }

  const now = await fetchServerTime()
  const today = now.toISOString().split('T')[0]

  // Check for an existing record to determine first vs second checkout.
  const { data: existing } = await supabase
    .from('staff_attendance_records')
    .select('check_in_time, check_out_time, check_in_time_2, check_out_time_2')
    .eq('staff_id', staffId).eq('date', today).maybeSingle()

  if (existing?.check_out_time_2) return { success: false } // already at max 2 checkouts

  if (existing?.check_in_time_2) {
    // Second checkout after second check-in.
    const tooSoonMs = msUntilActionAllowed(existing.check_in_time_2, now)
    if (tooSoonMs > 0) return { success: false, tooSoonMs }

    const { error } = await supabase.from('staff_attendance_records').update({
      check_out_time_2: now.toISOString(),
      check_out_lat_2: coords?.lat ?? null,
      check_out_lng_2: coords?.lng ?? null,
      check_out_accuracy_2: coords?.accuracy ?? null,
    }).eq('staff_id', staffId).eq('date', today)
    if (error) { console.error('checkOutStaff (2nd) error:', error); return { success: false } }
    return { success: true, geofencePassed, distanceM }
  }

  // First checkout — must be at least the mandatory gap after check-in.
  const tooSoonMs = msUntilActionAllowed(existing?.check_in_time, now)
  if (tooSoonMs > 0) return { success: false, tooSoonMs }

  let markedHalfDay = false
  if (checkoutCutoff) {
    const [h, m] = checkoutCutoff.split(':').map(Number)
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      const cutoffMinutes = h * 60 + m
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      if (nowMinutes < cutoffMinutes) markedHalfDay = true
    }
  }

  const updates: Record<string, unknown> = {
    check_out_time: now.toISOString(),
    check_out_lat: coords?.lat ?? null,
    check_out_lng: coords?.lng ?? null,
    check_out_accuracy: coords?.accuracy ?? null,
  }
  if (markedHalfDay) updates.status = 'half_day'

  const { error } = await supabase
    .from('staff_attendance_records')
    .update(updates)
    .eq('staff_id', staffId)
    .eq('date', today)

  if (error) {
    console.error('checkOutStaff error:', error)
    return { success: false }
  }

  return { success: true, markedHalfDay, geofencePassed, distanceM }
}

/** Staff edits the status of their own attendance entry (any date). */
export async function staffUpdateOwnStatus(
  staffId: string,
  date: string,
  status: StaffAttendanceStatus
): Promise<boolean> {
  const { error } = await supabase
    .from('staff_attendance_records')
    .upsert({ staff_id: staffId, date, status }, { onConflict: 'staff_id,date' })

  if (error) {
    console.error('staffUpdateOwnStatus error:', error)
    return false
  }
  return true
}

export async function fetchMyStaffAttendance(
  staffId: string,
  year: number,
  month: number
): Promise<StaffAttendanceRecord[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const { data, error } = await supabase
    .from('staff_attendance_records')
    .select('*')
    .eq('staff_id', staffId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })

  if (error) {
    console.error('fetchMyStaffAttendance error:', error)
    return []
  }
  return data ?? []
}

/** Resolve a single profile's display name by id — used to show who marked a
 *  staff member's attendance (admin quick-set / approved leave). Returns null
 *  if the id is missing or not found. */
export async function fetchProfileNameById(id: string): Promise<string | null> {
  if (!id) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('fetchProfileNameById error:', error)
    return null
  }
  return data?.full_name ?? null
}

export async function fetchAllStaffByDate(date: string): Promise<StaffAttendanceRecord[]> {
  const { data, error } = await supabase
    .from('staff_attendance_records')
    .select(`
      *,
      staff:profiles!staff_attendance_records_staff_id_fkey(
        id, email, full_name, role, avatar_url, geofence_exempt
      )
    `)
    .eq('date', date)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('fetchAllStaffByDate error:', error)
    return []
  }
  return data ?? []
}

// Roles that appear in the staff attendance report. Admins are included by
// default; a specific staff member (any role) can be hidden from attendance
// lists/counts individually via profiles.attendance_hidden (Settings → Attendance).
const STAFF_ROLES = ['teacher', 'coordinator', 'principal', 'admin']

/**
 * All staff attendance records for a date with profile data joined, hidden
 * staff removed. One indexed query on `date`; bounded by how many staff have
 * a record that day, so it stays light even for large schools. The caller
 * splits these into present / exception groups and paginates the present list.
 */
export async function fetchStaffAttendanceReportByDate(
  date: string
): Promise<StaffAttendanceRecord[]> {
  const { data, error } = await supabase
    .from('staff_attendance_records')
    .select(`
      *,
      staff:profiles!staff_attendance_records_staff_id_fkey(
        id, email, full_name, role, avatar_url, geofence_exempt, is_banned, attendance_hidden
      )
    `)
    .eq('date', date)

  if (error) {
    console.error('fetchStaffAttendanceReportByDate error:', error)
    return []
  }
  return (data ?? []).filter(r => r.staff && !r.staff.attendance_hidden && !r.staff.is_banned)
}

/** Student attendance status values for the given homerooms on a date. Used
 *  by the home-page class-teacher attendance card to tally present/absent
 *  across the homeroom(s) a teacher owns. */
export async function fetchStudentAttendanceStatusesForHomerooms(
  homeroomIds: string[],
  date: string,
): Promise<{ status: AttendanceStatus }[]> {
  if (homeroomIds.length === 0) return []
  const { data, error } = await supabase
    .from('attendance_records')
    .select('status')
    .eq('date', date)
    .in('homeroom_id', homeroomIds)
  if (error) {
    console.error('fetchStudentAttendanceStatusesForHomerooms error:', error)
    return []
  }
  return (data ?? []) as { status: AttendanceStatus }[]
}

/** Head-count of trackable staff (excludes hidden and resigned staff). Cheap COUNT query. */
export async function fetchTrackedStaffCount(): Promise<number> {
  const { count, error } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .in('role', STAFF_ROLES)
    .eq('is_banned', false)
    .eq('attendance_hidden', false)
  if (error) {
    console.error('fetchTrackedStaffCount error:', error)
    return 0
  }
  return count ?? 0
}

export async function adminMarkStaffAttendance(
  staffId: string,
  date: string,
  status: StaffAttendanceStatus,
  markedBy: string,
  remarks?: string
): Promise<boolean> {
  const { error } = await supabase
    .from('staff_attendance_records')
    .upsert(
      {
        staff_id: staffId,
        date,
        status,
        marked_by: markedBy,
        remarks: remarks ?? null,
      },
      { onConflict: 'staff_id,date' }
    )

  if (error) {
    console.error('adminMarkStaffAttendance error:', error)
    return false
  }
  return true
}

// ============================================
// Geofence Config (site_settings key: 'geofence')
// ============================================

export async function fetchGeofenceConfig(): Promise<GeofenceConfig | null> {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'geofence')
    .maybeSingle()

  if (error) {
    console.error('fetchGeofenceConfig error:', error)
    return null
  }

  if (!data?.value) return null

  const v = data.value as GeofenceConfig
  return {
    enabled: v.enabled ?? false,
    lat: v.lat ?? null,
    lng: v.lng ?? null,
    radius_m: v.radius_m ?? 200,
  }
}

export async function saveGeofenceConfig(config: GeofenceConfig): Promise<boolean> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'geofence', value: config as unknown as Record<string, unknown> }, { onConflict: 'key' })

  if (error) {
    console.error('saveGeofenceConfig error:', error)
    return false
  }
  return true
}

// ============================================
// Geofence zones — per-group centre points that replace the school-wide
// centre above for the staff assigned to them (mirrors DayTimingGroup).
// The master enable switch stays in the school-wide config: a zone only
// moves where a staff member has to stand, never whether GPS is checked.
// ============================================

const GEOFENCE_ZONE_COLUMNS = 'id, label, lat, lng, radius_m'

export async function fetchGeofenceZones(): Promise<GeofenceZone[]> {
  const { data, error } = await supabase
    .from('attendance_geofence_zones')
    .select(GEOFENCE_ZONE_COLUMNS)
    .order('label', { ascending: true })

  if (error) {
    console.error('fetchGeofenceZones error:', error)
    return []
  }

  const rows = (data ?? []) as Omit<GeofenceZone, 'staff_ids'>[]
  if (rows.length === 0) return []

  const { data: members, error: memError } = await supabase
    .from('attendance_geofence_zone_members')
    .select('zone_id, staff_id')
    .in('zone_id', rows.map(r => r.id))

  if (memError) console.error('fetchGeofenceZones members error:', memError)

  const staffByZone = new Map<string, string[]>()
  for (const m of members ?? []) {
    if (!staffByZone.has(m.zone_id)) staffByZone.set(m.zone_id, [])
    staffByZone.get(m.zone_id)!.push(m.staff_id)
  }
  return rows.map(r => ({ ...r, staff_ids: staffByZone.get(r.id) ?? [] }))
}

/**
 * Replaces every zone with the given set (delete-then-insert, same shape as
 * saveDayTimings). Pass an empty array to drop all zones and put everyone back
 * on the school-wide centre point.
 */
export async function saveGeofenceZones(
  zones: GeofenceZoneInput[],
  createdBy: string
): Promise<boolean> {
  // A staff member in two zones would have no single centre point to check
  // against — the UI resolves these before saving, this is the backstop.
  const seen = new Set<string>()
  for (const z of zones) {
    for (const id of z.staff_ids) {
      if (seen.has(id)) {
        console.error('saveGeofenceZones error: staff member assigned to more than one zone')
        return false
      }
      seen.add(id)
    }
  }

  const { data: existing, error: fetchError } = await supabase
    .from('attendance_geofence_zones')
    .select('id')

  if (fetchError) {
    console.error('saveGeofenceZones fetch error:', fetchError)
    return false
  }

  if (existing && existing.length > 0) {
    const { error: delError } = await supabase
      .from('attendance_geofence_zones')
      .delete()
      .in('id', existing.map(r => r.id))
    if (delError) {
      console.error('saveGeofenceZones delete error:', delError)
      return false
    }
  }

  if (zones.length === 0) return true

  const rows = zones.map(z => ({
    id: crypto.randomUUID(),
    label: z.label.trim() || 'Zone',
    lat: z.lat,
    lng: z.lng,
    radius_m: z.radius_m,
    created_by: createdBy,
  }))

  const { error: insError } = await supabase.from('attendance_geofence_zones').insert(rows)
  if (insError) {
    console.error('saveGeofenceZones insert error:', insError)
    return false
  }

  const memberRows = zones.flatMap((z, i) =>
    z.staff_ids.map(staff_id => ({ zone_id: rows[i].id, staff_id }))
  )

  if (memberRows.length > 0) {
    const { error: memInsError } = await supabase.from('attendance_geofence_zone_members').insert(memberRows)
    if (memInsError) {
      console.error('saveGeofenceZones members insert error:', memInsError)
      return false
    }
  }

  return true
}

/** The zone one staff member belongs to, or null when they use the school-wide centre. */
export async function fetchGeofenceZoneForStaff(staffId: string): Promise<GeofenceZone | null> {
  const { data: member, error: memError } = await supabase
    .from('attendance_geofence_zone_members')
    .select('zone_id')
    .eq('staff_id', staffId)
    .limit(1)
    .maybeSingle()

  if (memError) {
    console.error('fetchGeofenceZoneForStaff member error:', memError)
    return null
  }
  if (!member) return null

  const { data: zone, error: zoneError } = await supabase
    .from('attendance_geofence_zones')
    .select(GEOFENCE_ZONE_COLUMNS)
    .eq('id', member.zone_id)
    .maybeSingle()

  if (zoneError) {
    console.error('fetchGeofenceZoneForStaff zone error:', zoneError)
    return null
  }
  return zone ? { ...(zone as Omit<GeofenceZone, 'staff_ids'>), staff_ids: [staffId] } : null
}

/**
 * The geofence to check one staff member against: their zone's centre point if
 * they're in one, otherwise the school-wide centre. `enabled` always comes from
 * the school-wide config so the master switch keeps working for everyone.
 */
export async function fetchEffectiveGeofenceForStaff(staffId: string): Promise<EffectiveGeofence> {
  const [config, zone] = await Promise.all([
    fetchGeofenceConfig(),
    fetchGeofenceZoneForStaff(staffId),
  ])

  const base: GeofenceConfig = config ?? { enabled: false, lat: null, lng: null, radius_m: 200 }
  if (!zone) return { ...base, zone_id: null, zone_label: null }

  return {
    enabled: base.enabled,
    lat: zone.lat,
    lng: zone.lng,
    radius_m: zone.radius_m,
    zone_id: zone.id,
    zone_label: zone.label,
  }
}

// ============================================
// Attendance Config (site_settings key: 'attendance_config')
// ============================================

export async function fetchAttendanceConfig(): Promise<AttendanceConfig> {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'attendance_config')
    .maybeSingle()

  if (error) {
    console.error('fetchAttendanceConfig error:', error)
    return { late_cutoff: null, checkout_cutoff: null }
  }

  const v = (data?.value ?? {}) as Partial<AttendanceConfig>
  return { late_cutoff: v.late_cutoff ?? null, checkout_cutoff: v.checkout_cutoff ?? null }
}

export async function saveAttendanceConfig(config: AttendanceConfig): Promise<boolean> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'attendance_config', value: config as unknown as Record<string, unknown> }, { onConflict: 'key' })

  if (error) {
    console.error('saveAttendanceConfig error:', error)
    return false
  }
  return true
}

// ============================================
// Holidays (whole-school, is_default rows only — the simple case used by
// personal calendars and the home dashboard, which aren't staff-aware)
// ============================================

export async function fetchHolidays(year?: number, month?: number): Promise<Holiday[]> {
  let query = supabase.from('attendance_holidays').select('id, date, name').eq('is_default', true)

  if (year != null && month != null) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    query = query.gte('date', startDate).lte('date', endDate)
  }

  const { data, error } = await query.order('date', { ascending: true })
  if (error) {
    console.error('fetchHolidays error:', error)
    return []
  }
  return (data ?? []) as Holiday[]
}

export async function fetchHolidayByDate(date: string): Promise<Holiday | null> {
  const { data, error } = await supabase
    .from('attendance_holidays')
    .select('id, date, name')
    .eq('date', date)
    .eq('is_default', true)
    .maybeSingle()
  if (error) {
    console.error('fetchHolidayByDate error:', error)
    return null
  }
  return (data as Holiday) ?? null
}

// ============================================
// Holiday groups — a date's holiday(s), optionally split so only specific
// teachers get the day off instead of the whole school (mirrors DayTimingGroup).
// ============================================

export interface HolidayGroup {
  id: string
  date: string
  name: string
  is_default: boolean
  staff_ids: string[]
}

export interface HolidayGroupInput {
  name: string
  is_default: boolean
  staff_ids: string[]
}

const HOLIDAY_COLUMNS = 'id, date, name, is_default'

export async function fetchHolidaysForDate(date: string): Promise<HolidayGroup[]> {
  const { data: rows, error } = await supabase
    .from('attendance_holidays')
    .select(HOLIDAY_COLUMNS)
    .eq('date', date)
    .order('is_default', { ascending: false })

  if (error) {
    console.error('fetchHolidaysForDate error:', error)
    return []
  }
  if (!rows || rows.length === 0) return []

  const { data: members, error: memError } = await supabase
    .from('attendance_holiday_members')
    .select('holiday_id, staff_id')
    .in('holiday_id', rows.map(r => r.id))

  if (memError) console.error('fetchHolidaysForDate members error:', memError)

  const staffByHoliday = new Map<string, string[]>()
  for (const m of members ?? []) {
    if (!staffByHoliday.has(m.holiday_id)) staffByHoliday.set(m.holiday_id, [])
    staffByHoliday.get(m.holiday_id)!.push(m.staff_id)
  }

  return rows.map(r => ({ ...r, staff_ids: staffByHoliday.get(r.id) ?? [] })) as HolidayGroup[]
}

/**
 * Replaces every holiday row for a date with the given set (delete-then-insert).
 * Pass an empty array to clear the holiday for that date entirely.
 */
export async function saveHolidays(
  date: string,
  groups: HolidayGroupInput[],
  createdBy: string
): Promise<boolean> {
  const { data: existing, error: fetchError } = await supabase
    .from('attendance_holidays')
    .select('id')
    .eq('date', date)

  if (fetchError) {
    console.error('saveHolidays fetch error:', fetchError)
    return false
  }

  if (existing && existing.length > 0) {
    const { error: delError } = await supabase
      .from('attendance_holidays')
      .delete()
      .in('id', existing.map(r => r.id))
    if (delError) {
      console.error('saveHolidays delete error:', delError)
      return false
    }
  }

  if (groups.length === 0) return true

  const rows = groups.map(g => ({
    id: crypto.randomUUID(),
    date,
    name: g.name.trim() || (g.is_default ? 'Holiday' : 'Group holiday'),
    is_default: g.is_default,
    created_by: createdBy,
  }))

  const { error: insError } = await supabase.from('attendance_holidays').insert(rows)
  if (insError) {
    console.error('saveHolidays insert error:', insError)
    return false
  }

  const memberRows = groups.flatMap((g, i) =>
    g.staff_ids.map(staff_id => ({ holiday_id: rows[i].id, staff_id }))
  )

  if (memberRows.length > 0) {
    const { error: memInsError } = await supabase.from('attendance_holiday_members').insert(memberRows)
    if (memInsError) {
      console.error('saveHolidays members insert error:', memInsError)
      return false
    }
  }

  return true
}

/** Every holiday rule that exists — for a management/overview list (e.g. Settings). */
export async function fetchAllHolidayRules(): Promise<HolidayGroup[]> {
  const { data: rows, error } = await supabase
    .from('attendance_holidays')
    .select(HOLIDAY_COLUMNS)
    .order('date', { ascending: true })
    .order('is_default', { ascending: false })

  if (error) {
    console.error('fetchAllHolidayRules error:', error)
    return []
  }
  if (!rows || rows.length === 0) return []

  const { data: members, error: memError } = await supabase
    .from('attendance_holiday_members')
    .select('holiday_id, staff_id')
    .in('holiday_id', rows.map(r => r.id))

  if (memError) console.error('fetchAllHolidayRules members error:', memError)

  const staffByHoliday = new Map<string, string[]>()
  for (const m of members ?? []) {
    if (!staffByHoliday.has(m.holiday_id)) staffByHoliday.set(m.holiday_id, [])
    staffByHoliday.get(m.holiday_id)!.push(m.staff_id)
  }

  return rows.map(r => ({ ...r, staff_ids: staffByHoliday.get(r.id) ?? [] })) as HolidayGroup[]
}

// ============================================
// Day Timings (late-cutoff / checkout-cutoff overrides, scoped either
// to one specific date or to a repeating weekday, and optionally split
// into per-team overrides instead of applying to everyone)
// ============================================

type DayTimingRow = Omit<DayTimingGroup, 'staff_ids'>

async function attachStaffIds(rows: DayTimingRow[]): Promise<DayTimingGroup[]> {
  if (rows.length === 0) return []
  const { data: members, error } = await supabase
    .from('attendance_day_timing_members')
    .select('timing_id, staff_id')
    .in('timing_id', rows.map(r => r.id))

  if (error) console.error('attachStaffIds error:', error)

  const staffByTiming = new Map<string, string[]>()
  for (const m of members ?? []) {
    if (!staffByTiming.has(m.timing_id)) staffByTiming.set(m.timing_id, [])
    staffByTiming.get(m.timing_id)!.push(m.staff_id)
  }
  return rows.map(r => ({ ...r, staff_ids: staffByTiming.get(r.id) ?? [] }))
}

const DAY_TIMING_COLUMNS = 'id, scope_type, scope_date, scope_weekday, label, is_default, late_cutoff, checkout_cutoff'

/** Rules directly attached to one scope (an exact date, or one weekday number). */
export async function fetchDayTimingsByScope(scope: DayTimingScope): Promise<DayTimingGroup[]> {
  let query = supabase.from('attendance_day_timings').select(DAY_TIMING_COLUMNS).eq('scope_type', scope.type)
  query = scope.type === 'date' ? query.eq('scope_date', scope.date) : query.eq('scope_weekday', scope.weekday)

  const { data, error } = await query
  if (error) {
    console.error('fetchDayTimingsByScope error:', error)
    return []
  }
  return attachStaffIds((data ?? []) as DayTimingRow[])
}

/**
 * Every rule in effect for a calendar date: exact-date rules first (higher
 * priority), followed by any weekly-recurring rule for that date's weekday.
 */
export async function fetchDayTimingsForDate(date: string): Promise<DayTimingGroup[]> {
  const weekday = new Date(date + 'T12:00:00').getDay()
  const [dateRules, weekdayRules] = await Promise.all([
    fetchDayTimingsByScope({ type: 'date', date }),
    fetchDayTimingsByScope({ type: 'weekday', weekday }),
  ])
  return [...dateRules, ...weekdayRules]
}

/** Every cutoff rule that exists, of either scope — for a management/overview list (e.g. Settings). */
export async function fetchAllDayTimingRules(): Promise<DayTimingGroup[]> {
  const { data, error } = await supabase
    .from('attendance_day_timings')
    .select(DAY_TIMING_COLUMNS)
    .order('scope_type', { ascending: true })
    .order('scope_weekday', { ascending: true })
    .order('scope_date', { ascending: true })

  if (error) {
    console.error('fetchAllDayTimingRules error:', error)
    return []
  }
  return attachStaffIds((data ?? []) as DayTimingRow[])
}

/**
 * Replaces every rule for one scope with the given set (delete-then-insert).
 * Pass an empty array to clear the override for that scope.
 */
export async function saveDayTimings(
  scope: DayTimingScope,
  groups: DayTimingGroupInput[],
  createdBy: string
): Promise<boolean> {
  let delQuery = supabase.from('attendance_day_timings').select('id').eq('scope_type', scope.type)
  delQuery = scope.type === 'date' ? delQuery.eq('scope_date', scope.date) : delQuery.eq('scope_weekday', scope.weekday)

  const { data: existing, error: fetchError } = await delQuery
  if (fetchError) {
    console.error('saveDayTimings fetch error:', fetchError)
    return false
  }

  if (existing && existing.length > 0) {
    const { error: delError } = await supabase
      .from('attendance_day_timings')
      .delete()
      .in('id', existing.map(r => r.id))
    if (delError) {
      console.error('saveDayTimings delete error:', delError)
      return false
    }
  }

  if (groups.length === 0) return true

  const rows = groups.map(g => ({
    id: crypto.randomUUID(),
    scope_type: scope.type,
    scope_date: scope.type === 'date' ? scope.date : null,
    scope_weekday: scope.type === 'weekday' ? scope.weekday : null,
    label: g.label.trim() || (g.is_default ? 'Everyone' : 'Override'),
    is_default: g.is_default,
    late_cutoff: g.late_cutoff,
    checkout_cutoff: g.checkout_cutoff,
    created_by: createdBy,
  }))

  const { error: insError } = await supabase.from('attendance_day_timings').insert(rows)
  if (insError) {
    console.error('saveDayTimings insert error:', insError)
    return false
  }

  const memberRows = groups.flatMap((g, i) =>
    g.staff_ids.map(staff_id => ({ timing_id: rows[i].id, staff_id }))
  )

  if (memberRows.length > 0) {
    const { error: memInsError } = await supabase.from('attendance_day_timing_members').insert(memberRows)
    if (memInsError) {
      console.error('saveDayTimings members insert error:', memInsError)
      return false
    }
  }

  return true
}

/**
 * Effective late-cutoff / checkout-cutoff for one staff member on one date, if an
 * override applies. Priority: exact-date team override > exact-date "everyone"
 * override > weekly-recurring team override > weekly-recurring "everyone"
 * override. Returns null when nothing applies, meaning the caller should fall
 * back to the school-wide `attendance_config` cutoffs.
 */
export async function fetchEffectiveCutoffsForStaff(
  date: string,
  staffId: string
): Promise<{ late_cutoff: string; checkout_cutoff: string } | null> {
  const timings = await fetchDayTimingsForDate(date)
  const dateRules = timings.filter(t => t.scope_type === 'date')
  const weekdayRules = timings.filter(t => t.scope_type === 'weekday')

  for (const pool of [dateRules, weekdayRules]) {
    const override = pool.find(t => !t.is_default && t.staff_ids.includes(staffId))
    if (override) return { late_cutoff: override.late_cutoff, checkout_cutoff: override.checkout_cutoff }
  }
  for (const pool of [dateRules, weekdayRules]) {
    const everyone = pool.find(t => t.is_default)
    if (everyone) return { late_cutoff: everyone.late_cutoff, checkout_cutoff: everyone.checkout_cutoff }
  }
  return null
}

// All non-hidden, non-resigned trackable staff (teachers, coordinators, principals, admins).
export async function fetchAllTrackedStaff(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, attendance_hidden')
    .in('role', STAFF_ROLES)
    .eq('is_banned', false)
    .eq('attendance_hidden', false)
    .order('full_name', { ascending: true })
  if (error) {
    console.error('fetchAllTrackedStaff error:', error)
    return []
  }
  return (data ?? []) as UserProfile[]
}

// ============================================
// Geofence Exemptions (profiles.geofence_exempt)
// ============================================

export async function fetchMyExemption(staffId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('geofence_exempt')
    .eq('id', staffId)
    .maybeSingle()

  if (error) {
    console.error('fetchMyExemption error:', error)
    return false
  }
  return Boolean(data?.geofence_exempt)
}

// profiles only allows a user to UPDATE their own row (RLS), so an admin
// setting a flag on someone ELSE's profile has to go through this service-role
// route — a direct client-side update here would silently affect zero rows.
async function setStaffFlag(staffId: string, field: 'attendance_hidden' | 'geofence_exempt', value: boolean): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    console.error(`setStaffFlag(${field}) error: not authenticated`)
    return false
  }
  try {
    const response = await fetch('/api/admin/set-staff-flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ userId: staffId, field, value }),
    })
    const result = await response.json()
    if (!result.success) console.error(`setStaffFlag(${field}) error:`, result.error)
    return !!result.success
  } catch (err) {
    console.error(`setStaffFlag(${field}) error:`, err)
    return false
  }
}

export async function setStaffExemption(staffId: string, exempt: boolean): Promise<boolean> {
  return setStaffFlag(staffId, 'geofence_exempt', exempt)
}

/** Hides/unhides one staff member from attendance lists, counts, and rosters. */
export async function setStaffAttendanceVisibility(staffId: string, hidden: boolean): Promise<boolean> {
  return setStaffFlag(staffId, 'attendance_hidden', hidden)
}

// ============================================
// Staff directory & scope (admin = all, coordinator = team)
// ============================================

export async function fetchAllStaff(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, geofence_exempt, attendance_hidden')
    .in('role', STAFF_ROLES)
    .order('full_name', { ascending: true })

  if (error) {
    console.error('fetchAllStaff error:', error)
    return []
  }
  return (data ?? []) as UserProfile[]
}

/**
 * School-wide present/total summary via COUNT queries only — no row data fetched.
 * Safe to call for schools of any size.
 */
export async function fetchSchoolAttendanceSummary(
  date: string
): Promise<{ present: number; total: number }> {
  const [presentRes, totalRes] = await Promise.all([
    supabase
      .from('staff_attendance_records')
      .select('*', { count: 'exact', head: true })
      .eq('date', date)
      .in('status', PRESENT_STATUSES),
    supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .in('role', STAFF_ROLES)
      .eq('is_banned', false)
      .eq('attendance_hidden', false),
  ])
  return {
    present: presentRes.count ?? 0,
    total: totalRes.count ?? 0,
  }
}

/** Lightweight staff name search for calendar view-as picker. Excludes resigned staff. */
export async function searchStaff(
  query: string
): Promise<{ id: string; full_name: string; role: string }[]> {
  if (query.trim().length < 2) return []
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', STAFF_ROLES)
    .eq('is_banned', false)
    .ilike('full_name', `%${query.trim()}%`)
    .order('full_name')
    .limit(8)
  return (data ?? []) as { id: string; full_name: string; role: string }[]
}

/** Attendance records for a set of staff on a given date (used for present/total counts). */
export async function fetchStaffAttendanceForDate(
  staffIds: string[],
  date: string
): Promise<StaffAttendanceRecord[]> {
  if (staffIds.length === 0) return []
  const { data, error } = await supabase
    .from('staff_attendance_records')
    .select('*')
    .eq('date', date)
    .in('staff_id', staffIds)

  if (error) {
    console.error('fetchStaffAttendanceForDate error:', error)
    return []
  }
  return data ?? []
}

/** All attendance records for a set of staff across a whole month (no status filter) — payroll's raw input. */
export async function fetchMonthlyAttendanceRecords(
  staffIds: string[],
  year: number,
  month: number
): Promise<StaffAttendanceRecord[]> {
  if (staffIds.length === 0) return []
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const { data, error } = await supabase
    .from('staff_attendance_records')
    .select('*')
    .in('staff_id', staffIds)
    .gte('date', start)
    .lte('date', end)

  if (error) {
    console.error('fetchMonthlyAttendanceRecords error:', error)
    return []
  }
  return data ?? []
}

// ============================================
// Derived day status & monthly stats
// ============================================

const WEEKEND_DAYS = new Set([0, 6]) // Sun, Sat

function isWeekend(dateStr: string): boolean {
  return WEEKEND_DAYS.has(new Date(dateStr + 'T12:00:00').getDay())
}

function minutesFromCutoff(lateCutoff: string | null | undefined): number | null {
  if (!lateCutoff) return null
  const [h, m] = lateCutoff.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

/**
 * Effective status for a calendar day, deriving Absent for working days with no
 * record. Past working days are Absent; today becomes Absent only once the late
 * cutoff has passed (the staff member can still check in to flip it to Late).
 * Returns null for non-working days (weekend / holiday / future).
 */
export function deriveDayStatus(
  dateStr: string,
  record: StaffAttendanceRecord | undefined,
  holidaySet: Set<string>,
  today: string,
  lateCutoff?: string | null,
  now: Date = new Date()
): StaffAttendanceStatus | 'holiday' | null {
  if (record) return record.status
  if (holidaySet.has(dateStr)) return 'holiday'
  if (isWeekend(dateStr)) return null
  if (dateStr > today) return null // future days
  if (dateStr === today) {
    // Only mark today absent once the configured late cutoff has elapsed.
    const cutoff = minutesFromCutoff(lateCutoff)
    if (cutoff === null) return null
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    return nowMinutes > cutoff ? 'absent' : null
  }
  return 'absent'
}

export function computeMonthlyStats(
  year: number,
  month: number,
  records: StaffAttendanceRecord[],
  holidays: Holiday[],
  today: string = new Date().toISOString().split('T')[0],
  lateCutoff?: string | null
): StaffMonthlyStats {
  const holidaySet = new Set(holidays.map(h => h.date))
  const recordByDate = new Map(records.map(r => [r.date, r]))
  const lastDay = new Date(year, month, 0).getDate()

  const stats: StaffMonthlyStats = {
    working_days: 0, present: 0, late: 0, half_day: 0, wfh: 0,
    on_leave: 0, absent: 0, e: 0, holidays: 0, present_pct: 0,
  }

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const eff = deriveDayStatus(dateStr, recordByDate.get(dateStr), holidaySet, today, lateCutoff)
    if (eff === null) continue
    if (eff === 'holiday') { stats.holidays++; continue }
    // Working day
    stats.working_days++
    if (eff === 'on_leave') stats.on_leave++
    else if (eff in stats) (stats as unknown as Record<string, number>)[eff]++
  }

  // Present percentage excludes approved leave days from the denominator.
  const denominator = stats.working_days - stats.on_leave
  const credited = stats.present + stats.late + stats.wfh + stats.half_day * 0.5 + stats.e
  stats.present_pct = denominator > 0 ? Math.round((credited / denominator) * 100) : 0
  return stats
}

// ============================================
// Absentee Lists (for manager dashboard)
// ============================================

export interface StudentAbsenteeRecord {
  student: UserProfile
  status: AttendanceStatus
  homeroom_id: string
  homeroom_name?: string
}

export async function fetchStudentAbsenteesByDate(
  date: string
): Promise<StudentAbsenteeRecord[]> {
  // Step 1: fetch raw attendance records for the date
  const { data: records, error: recError } = await supabase
    .from('attendance_records')
    .select('student_id, homeroom_id, status')
    .eq('date', date)
    .in('status', ['absent', 'late', 'on_leave'])

  if (recError) {
    console.error('fetchStudentAbsenteesByDate records error:', recError)
    return []
  }
  if (!records || records.length === 0) return []

  // Step 2: fetch student profiles for the returned IDs
  const studentIds = [...new Set(records.map(r => r.student_id))]
  const { data: profiles, error: profError } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, grade, section')
    .in('id', studentIds)

  if (profError) {
    console.error('fetchStudentAbsenteesByDate profiles error:', profError)
    return []
  }

  // Step 3: fetch homeroom names for unique homeroom IDs
  const homeroomIds = [...new Set(records.map(r => r.homeroom_id))]
  const { data: homerooms } = await supabase
    .from('homerooms')
    .select('id, name')
    .in('id', homeroomIds)

  const profileById = new Map((profiles ?? []).map(p => [p.id, p as UserProfile]))
  const homeroomNameById = new Map((homerooms ?? []).map(h => [h.id, h.name as string]))

  const results: StudentAbsenteeRecord[] = []
  for (const r of records) {
    const student = profileById.get(r.student_id)
    if (!student) continue
    results.push({
      student,
      status: r.status as AttendanceStatus,
      homeroom_id: r.homeroom_id,
      homeroom_name: homeroomNameById.get(r.homeroom_id),
    })
  }
  return results
}

// ── All-student attendance report (present + irregular, optionally per-homeroom) ──

export type StudentAttendanceEntry = StudentAbsenteeRecord

// Every status that is NOT a plain "present" — i.e. needs the manager's attention.
// The report splits these further into "absent" and everything else ("irregular").
export const STUDENT_NON_PRESENT_STATUSES: AttendanceStatus[] = [
  'absent', 'late', 'half_day', 'on_leave', 'on_duty', 'excused',
]

// Attach profile + homeroom name to raw attendance rows (two cheap lookups, RLS-safe).
async function hydrateStudentEntries(
  records: { student_id: string; homeroom_id: string; status: string }[]
): Promise<StudentAttendanceEntry[]> {
  if (records.length === 0) return []
  const studentIds = [...new Set(records.map(r => r.student_id))]
  const homeroomIds = [...new Set(records.map(r => r.homeroom_id))]

  const [{ data: profiles }, { data: homerooms }] = await Promise.all([
    supabase.from('profiles')
      .select('id, email, full_name, role, avatar_url, grade, section')
      .in('id', studentIds),
    supabase.from('homerooms').select('id, name').in('id', homeroomIds),
  ])

  const profileById = new Map((profiles ?? []).map(p => [p.id, p as UserProfile]))
  const homeroomNameById = new Map((homerooms ?? []).map(h => [h.id, h.name as string]))

  const out: StudentAttendanceEntry[] = []
  for (const r of records) {
    const student = profileById.get(r.student_id)
    if (!student) continue
    out.push({
      student,
      status: r.status as AttendanceStatus,
      homeroom_id: r.homeroom_id,
      homeroom_name: homeroomNameById.get(r.homeroom_id),
    })
  }
  return out
}

/**
 * Homeroom scope for the student report: a single id, a list of ids (a class
 * teacher's own homerooms), or null/undefined for the whole school.
 */
export type HomeroomScope = string | string[] | null | undefined

/** null = whole school; [] = an explicitly empty scope, which matches nothing. */
function homeroomScopeIds(scope: HomeroomScope): string[] | null {
  if (scope == null) return null
  return Array.isArray(scope) ? scope : [scope]
}

// Non-present students for a date. Pass a homeroom scope to limit the report to
// one homeroom or to a class teacher's homerooms, otherwise it spans the whole
// school. Uses `neq present` rather than an explicit status list so it never
// errors if a newer enum value (e.g. half_day, on_duty) hasn't been migrated
// onto the live database yet.
export async function fetchStudentNonPresentByDate(
  date: string,
  homeroom?: HomeroomScope
): Promise<StudentAttendanceEntry[]> {
  const ids = homeroomScopeIds(homeroom)
  if (ids && ids.length === 0) return []

  let q = supabase
    .from('attendance_records')
    .select('student_id, homeroom_id, status')
    .eq('date', date)
    .neq('status', 'present')
  if (ids) q = ids.length === 1 ? q.eq('homeroom_id', ids[0]) : q.in('homeroom_id', ids)

  const { data, error } = await q
  if (error) {
    console.error('fetchStudentNonPresentByDate error:', error)
    return []
  }
  return hydrateStudentEntries(data ?? [])
}

// Present students for a date, paged so a whole-school list never loads at once.
export async function fetchStudentPresentByDate(
  date: string,
  homeroom: HomeroomScope,
  offset: number,
  limit: number
): Promise<{ rows: StudentAttendanceEntry[]; total: number }> {
  const ids = homeroomScopeIds(homeroom)
  if (ids && ids.length === 0) return { rows: [], total: 0 }

  let q = supabase
    .from('attendance_records')
    .select('student_id, homeroom_id, status', { count: 'exact' })
    .eq('date', date)
    .eq('status', 'present')
    .order('student_id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (ids) q = ids.length === 1 ? q.eq('homeroom_id', ids[0]) : q.in('homeroom_id', ids)

  const { data, error, count } = await q
  if (error) {
    console.error('fetchStudentPresentByDate error:', error)
    return { rows: [], total: 0 }
  }
  const rows = await hydrateStudentEntries(data ?? [])
  return { rows, total: count ?? 0 }
}

// ── Homeroom-wise attendance report ───────────────────────────────────────────

export interface HomeroomAttendanceCounts {
  homeroom_id: string
  homeroom_name: string
  grade: number | null
  section: string | null
  present: number
  absent: number
  /** Every recorded status that is neither present nor absent (late, on leave, …). */
  irregular: number
  /** present + absent + irregular — 0 when the sheet hasn't been marked yet. */
  marked: number
}

// PostgREST caps a single response at 1000 rows, so walk the range in pages.
// Ordered by student_id so the paging window is stable between round-trips.
async function fetchHomeroomStatusRowsPaged(
  date: string,
  homeroomIds: string[]
): Promise<{ homeroom_id: string; status: string }[]> {
  if (homeroomIds.length === 0) return []
  const PAGE = 1000
  const out: { homeroom_id: string; status: string }[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('homeroom_id, status, student_id')
      .eq('date', date)
      .in('homeroom_id', homeroomIds)
      .order('student_id', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) {
      console.error('fetchHomeroomStatusRowsPaged error:', error)
      break
    }
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return out
}

/**
 * Per-homeroom present / absent / irregular tallies for a date, paged over the
 * homeroom list so a large school never loads every classroom at once.
 * Homerooms with no marked sheet are still returned, with zero counts.
 * Pass a homeroom scope to limit the report to one homeroom or to a class
 * teacher's own homerooms.
 */
export async function fetchHomeroomAttendanceCountsByDate(
  date: string,
  homeroom: HomeroomScope,
  offset: number,
  limit: number
): Promise<{ rows: HomeroomAttendanceCounts[]; total: number }> {
  const scopeIds = homeroomScopeIds(homeroom)
  if (scopeIds && scopeIds.length === 0) return { rows: [], total: 0 }

  // Homerooms that had already expired before the reported date can never have
  // attendance on it — leaving them out keeps last year's classes off the list.
  // `expiry_date` post-dates the original schema, so fall back to an unfiltered
  // query if the column isn't there yet rather than failing the whole report.
  const runQuery = (scopeToActive: boolean) => {
    let q = supabase
      .from('homerooms')
      .select('id, name, grade, section', { count: 'exact' })
      .order('grade', { ascending: true, nullsFirst: false })
      .order('section', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1)
    if (scopeIds) q = scopeIds.length === 1 ? q.eq('id', scopeIds[0]) : q.in('id', scopeIds)
    if (scopeToActive) q = q.or(`expiry_date.is.null,expiry_date.gte.${date}`)
    return q
  }

  let { data: homerooms, error, count } = await runQuery(true)
  if (error) {
    ({ data: homerooms, error, count } = await runQuery(false))
  }
  if (error) {
    console.error('fetchHomeroomAttendanceCountsByDate error:', error)
    return { rows: [], total: 0 }
  }
  if (!homerooms || homerooms.length === 0) return { rows: [], total: count ?? 0 }

  const records = await fetchHomeroomStatusRowsPaged(date, homerooms.map(h => h.id))

  const tallyById = new Map<string, { present: number; absent: number; irregular: number }>()
  for (const r of records) {
    let t = tallyById.get(r.homeroom_id)
    if (!t) { t = { present: 0, absent: 0, irregular: 0 }; tallyById.set(r.homeroom_id, t) }
    if (r.status === 'present') t.present++
    else if (r.status === 'absent') t.absent++
    else t.irregular++
  }

  const rows: HomeroomAttendanceCounts[] = homerooms.map(h => {
    const t = tallyById.get(h.id) ?? { present: 0, absent: 0, irregular: 0 }
    return {
      homeroom_id: h.id,
      homeroom_name: h.name as string,
      grade: (h.grade as number | null) ?? null,
      section: (h.section as string | null) ?? null,
      present: t.present,
      absent: t.absent,
      irregular: t.irregular,
      marked: t.present + t.absent + t.irregular,
    }
  })
  return { rows, total: count ?? rows.length }
}

// ============================================
// Consecutive Absence Streaks
// ============================================

// Counts consecutive school days (days with a recorded attendance) where status
// is 'absent' or 'on_leave', walking backwards from `date`.
// Days with no record (weekends, holidays) are skipped — they don't add to the
// streak but don't break it either.
// Only call for IDs whose current-day status is already absent/on_leave;
// streaks for other statuses will be 0 anyway.

export async function fetchStudentAbsenceStreaks(
  studentIds: string[],
  date: string,
  windowDays = 90
): Promise<Map<string, number>> {
  if (studentIds.length === 0) return new Map()
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() - windowDays)
  const startStr = d.toISOString().split('T')[0]

  const { data } = await supabase
    .from('attendance_records')
    .select('student_id, date, status')
    .in('student_id', studentIds)
    .gte('date', startStr)
    .lte('date', date)
    .order('date', { ascending: false })

  if (!data) return new Map()

  const byStudent = new Map<string, { date: string; status: string }[]>()
  for (const r of data) {
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, [])
    byStudent.get(r.student_id)!.push({ date: r.date, status: r.status })
  }

  const STREAK_STATUSES = new Set(['absent', 'on_leave'])
  const result = new Map<string, number>()
  for (const [studentId, records] of byStudent.entries()) {
    let streak = 0
    for (const r of records) {
      if (STREAK_STATUSES.has(r.status)) { streak++ } else { break }
    }
    result.set(studentId, streak)
  }
  return result
}

export async function fetchStaffAbsenceStreaks(
  staffIds: string[],
  date: string,
  windowDays = 90
): Promise<Map<string, number>> {
  if (staffIds.length === 0) return new Map()
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() - windowDays)
  const startStr = d.toISOString().split('T')[0]

  const { data } = await supabase
    .from('staff_attendance_records')
    .select('staff_id, date, status')
    .in('staff_id', staffIds)
    .gte('date', startStr)
    .lte('date', date)
    .order('date', { ascending: false })

  if (!data) return new Map()

  const byStaff = new Map<string, { date: string; status: string }[]>()
  for (const r of data) {
    if (!byStaff.has(r.staff_id)) byStaff.set(r.staff_id, [])
    byStaff.get(r.staff_id)!.push({ date: r.date, status: r.status })
  }

  const STREAK_STATUSES = new Set(['absent', 'on_leave'])
  const result = new Map<string, number>()
  for (const [staffId, records] of byStaff.entries()) {
    let streak = 0
    for (const r of records) {
      if (STREAK_STATUSES.has(r.status)) { streak++ } else { break }
    }
    result.set(staffId, streak)
  }
  return result
}

export async function fetchStaffAbsenteesByDate(
  date: string
): Promise<StaffAttendanceRecord[]> {
  const { data, error } = await supabase
    .from('staff_attendance_records')
    .select(`
      *,
      staff:profiles!staff_attendance_records_staff_id_fkey(
        id, email, full_name, role, avatar_url
      )
    `)
    .eq('date', date)
    .in('status', ['absent', 'late', 'half_day', 'on_leave'])
    .order('status')

  if (error) {
    console.error('fetchStaffAbsenteesByDate error:', error)
    return []
  }
  return data ?? []
}

// ============================================
// Late Summary Report (admin) — tabular late-arrival log across a date range,
// in the spirit of the "Late Daily Attendance Logs" export from biometric
// face-ID systems: one row per late check-in, with employee code/department
// (from staff_details) and how late they were against the cutoff in effect
// that day (day-timing overrides, falling back to the school-wide cutoff).
// ============================================

export interface LateSummaryRow {
  date: string
  staff_id: string
  employee_name: string
  employee_code: string
  department: string
  designation: string
  check_in_time: string | null
  check_out_time: string | null
  late_by_minutes: number
  status: StaffAttendanceStatus
}

/** "HH:MM" from a minute count — mirrors how Late By / Duration are shown in the source system. */
export function formatMinutesAsHM(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Same override priority as fetchEffectiveCutoffsForStaff, but against an
// already-fetched timings list so a whole date range can be resolved without
// re-querying per staff member.
function resolveLateCutoff(
  timings: DayTimingGroup[],
  staffId: string,
  fallback: string | null
): string | null {
  const dateRules = timings.filter(t => t.scope_type === 'date')
  const weekdayRules = timings.filter(t => t.scope_type === 'weekday')
  for (const pool of [dateRules, weekdayRules]) {
    const override = pool.find(t => !t.is_default && t.staff_ids.includes(staffId))
    if (override) return override.late_cutoff
  }
  for (const pool of [dateRules, weekdayRules]) {
    const everyone = pool.find(t => t.is_default)
    if (everyone) return everyone.late_cutoff
  }
  return fallback
}

/**
 * Every 'late' record between startDate and endDate (inclusive), hydrated with
 * employee code/department/designation and a computed late-by duration. Pass
 * staffIds to scope to a team/roster; omit for the whole school.
 */
export async function fetchLateSummaryReport(
  startDate: string,
  endDate: string,
  staffIds?: string[]
): Promise<LateSummaryRow[]> {
  let query = supabase
    .from('staff_attendance_records')
    .select(`
      date, staff_id, check_in_time, check_out_time, status,
      staff:profiles!staff_attendance_records_staff_id_fkey(
        id, full_name, attendance_hidden, is_banned
      )
    `)
    .eq('status', 'late')
    .gte('date', startDate)
    .lte('date', endDate)

  if (staffIds && staffIds.length > 0) query = query.in('staff_id', staffIds)

  const { data, error } = await query
  if (error) {
    console.error('fetchLateSummaryReport error:', error)
    return []
  }

  type HydratedRecord = Pick<StaffAttendanceRecord, 'date' | 'staff_id' | 'check_in_time' | 'check_out_time' | 'status'> & {
    staff: (UserProfile & { attendance_hidden?: boolean; is_banned?: boolean }) | null
  }
  const records = ((data ?? []) as unknown as HydratedRecord[]).filter(
    r => r.staff && !r.staff.attendance_hidden && !r.staff.is_banned
  )
  if (records.length === 0) return []

  const uniqueDates = [...new Set(records.map(r => r.date))]
  const uniqueStaffIds = [...new Set(records.map(r => r.staff_id))]

  const [globalConfig, timingsPerDate, detailsMap] = await Promise.all([
    fetchAttendanceConfig(),
    Promise.all(uniqueDates.map(d => fetchDayTimingsForDate(d))),
    fetchStaffDetailsMap(uniqueStaffIds),
  ])
  const timingsByDate = new Map(uniqueDates.map((d, i) => [d, timingsPerDate[i]]))

  const rows = records.map(r => {
    const staff = r.staff as UserProfile
    const cutoff = resolveLateCutoff(timingsByDate.get(r.date) ?? [], r.staff_id, globalConfig.late_cutoff)
    const cutoffMinutes = minutesFromCutoff(cutoff)
    let lateByMinutes = 0
    if (cutoffMinutes !== null && r.check_in_time) {
      const t = new Date(r.check_in_time)
      const checkInMinutes = t.getHours() * 60 + t.getMinutes()
      lateByMinutes = Math.max(0, checkInMinutes - cutoffMinutes)
    }
    const details = detailsMap[r.staff_id]
    return {
      date: r.date,
      staff_id: r.staff_id,
      employee_name: staff.full_name,
      employee_code: details?.employee_id || '—',
      department: details?.department || '—',
      designation: details?.designation || '—',
      check_in_time: r.check_in_time,
      check_out_time: r.check_out_time,
      late_by_minutes: lateByMinutes,
      status: r.status,
    }
  })

  rows.sort((a, b) => (a.date === b.date ? a.employee_name.localeCompare(b.employee_name) : a.date.localeCompare(b.date)))
  return rows
}
