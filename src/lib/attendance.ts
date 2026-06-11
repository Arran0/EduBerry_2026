import { supabase, UserProfile } from './supabase'

// ============================================
// Types
// ============================================

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'on_leave' | 'excused'
export type StaffAttendanceStatus = 'present' | 'absent' | 'late' | 'on_leave' | 'wfh' | 'half_day'
// WFH is kept in the type for backward-compat with existing records and admin overrides,
// but it is no longer offered as a self-service option for regular staff.

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
  present_pct: number
}

export interface GeofenceConfig {
  enabled: boolean
  lat: number | null
  lng: number | null
  radius_m: number
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

export interface StaffMonthlyStats {
  working_days: number   // weekdays in month that are not holidays, up to today
  present: number
  late: number
  half_day: number
  wfh: number
  on_leave: number
  absent: number
  holidays: number
  present_pct: number    // (present + late + wfh + 0.5*half_day) / working_days
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
  on_leave: 'On Leave',
  excused: 'Excused',
}

export const STAFF_ATTENDANCE_STATUS_LABELS: Record<StaffAttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  on_leave: 'On Leave',
  wfh: 'Work from Home',
  half_day: 'Half Day',
}

export const ATTENDANCE_STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-700 border-green-200',
  absent: 'bg-red-100 text-red-700 border-red-200',
  late: 'bg-amber-100 text-amber-700 border-amber-200',
  on_leave: 'bg-blue-100 text-blue-700 border-blue-200',
  excused: 'bg-purple-100 text-purple-700 border-purple-200',
}

export const STAFF_ATTENDANCE_STATUS_COLORS: Record<StaffAttendanceStatus, string> = {
  present: 'bg-green-100 text-green-700 border-green-200',
  absent: 'bg-red-100 text-red-700 border-red-200',
  late: 'bg-amber-100 text-amber-700 border-amber-200',
  on_leave: 'bg-blue-100 text-blue-700 border-blue-200',
  wfh: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  half_day: 'bg-orange-100 text-orange-700 border-orange-200',
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
    return { total_days: 0, present: 0, absent: 0, late: 0, on_leave: 0, excused: 0, present_pct: 0 }
  }

  const records = data ?? []
  const counts = { present: 0, absent: 0, late: 0, on_leave: 0, excused: 0 }
  for (const r of records) {
    if (r.status in counts) counts[r.status as AttendanceStatus]++
  }

  const total_days = records.length
  // Present percentage excludes on_leave days from denominator
  const denominator = total_days - counts.on_leave
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
  endDate: string
): Promise<void> {
  // Find all homerooms the student belongs to
  const { data: memberships, error: memError } = await supabase
    .from('homeroom_members')
    .select('homeroom_id')
    .eq('student_id', studentId)

  if (memError || !memberships?.length) return

  const dates = getDatesBetween(startDate, endDate)
  const rows: Record<string, unknown>[] = []

  for (const { homeroom_id } of memberships) {
    for (const date of dates) {
      rows.push({
        homeroom_id,
        student_id: studentId,
        date,
        status: 'on_leave',
        leave_application_id: leaveApplicationId,
      })
    }
  }

  if (rows.length === 0) return

  // Upsert — only update status to on_leave if not already marked present
  // We set ignoreDuplicates: false so existing records get updated
  const { error } = await supabase
    .from('attendance_records')
    .upsert(rows, { onConflict: 'homeroom_id,student_id,date' })

  if (error) console.error('syncLeaveToStudentAttendance error:', error)
}

export async function syncLeaveToStaffAttendance(
  leaveApplicationId: string,
  staffId: string,
  startDate: string,
  endDate: string
): Promise<void> {
  const dates = getDatesBetween(startDate, endDate)

  const rows = dates.map(date => ({
    staff_id: staffId,
    date,
    status: 'on_leave' as StaffAttendanceStatus,
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

/** Returns 'late' if current local time is past the cutoff, otherwise 'present'. */
export function deriveCheckInStatus(lateCutoff: string | null | undefined, now: Date = new Date()): StaffAttendanceStatus {
  if (!lateCutoff) return 'present'
  const [h, m] = lateCutoff.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return 'present'
  const cutoffMinutes = h * 60 + m
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return nowMinutes > cutoffMinutes ? 'late' : 'present'
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
): Promise<{ success: boolean; status?: StaffAttendanceStatus; geofencePassed?: boolean; distanceM?: number }> {
  const { coords, geofenceConfig, lateCutoff, status } = options
  let geofencePassed: boolean | undefined
  let distanceM: number | undefined

  if (coords && geofenceConfig?.enabled && geofenceConfig.lat != null && geofenceConfig.lng != null) {
    distanceM = Math.round(
      haversineDistance(coords.lat, coords.lng, geofenceConfig.lat, geofenceConfig.lng)
    )
    geofencePassed = distanceM <= geofenceConfig.radius_m
  }

  const today = new Date().toISOString().split('T')[0]
  // WFH / Half Day are explicit choices; Present/Late is derived from the cutoff.
  const finalStatus: StaffAttendanceStatus =
    status && status !== 'present' ? status : deriveCheckInStatus(lateCutoff)

  const { error } = await supabase
    .from('staff_attendance_records')
    .upsert(
      {
        staff_id: staffId,
        date: today,
        status: finalStatus,
        check_in_time: new Date().toISOString(),
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
): Promise<{ success: boolean; markedHalfDay?: boolean; geofencePassed?: boolean; distanceM?: number }> {
  const { coords, geofenceConfig, checkoutCutoff } = options
  let geofencePassed: boolean | undefined
  let distanceM: number | undefined

  if (coords && geofenceConfig?.enabled && geofenceConfig.lat != null && geofenceConfig.lng != null) {
    distanceM = Math.round(
      haversineDistance(coords.lat, coords.lng, geofenceConfig.lat, geofenceConfig.lng)
    )
    geofencePassed = distanceM <= geofenceConfig.radius_m
  }

  const today = new Date().toISOString().split('T')[0]
  const now = new Date()

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
    return { late_cutoff: null }
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
// Holidays
// ============================================

export async function fetchHolidays(year?: number, month?: number): Promise<Holiday[]> {
  let query = supabase.from('attendance_holidays').select('id, date, name')

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

export async function addHoliday(date: string, name: string, createdBy: string): Promise<boolean> {
  const { error } = await supabase
    .from('attendance_holidays')
    .upsert({ date, name, created_by: createdBy }, { onConflict: 'date' })

  if (error) {
    console.error('addHoliday error:', error)
    return false
  }
  return true
}

export async function deleteHoliday(id: string): Promise<boolean> {
  const { error } = await supabase.from('attendance_holidays').delete().eq('id', id)
  if (error) {
    console.error('deleteHoliday error:', error)
    return false
  }
  return true
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

export async function setStaffExemption(staffId: string, exempt: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('profiles')
    .update({ geofence_exempt: exempt })
    .eq('id', staffId)

  if (error) {
    console.error('setStaffExemption error:', error)
    return false
  }
  return true
}

// ============================================
// Staff directory & scope (admin = all, coordinator = team)
// ============================================

const STAFF_ROLES = ['teacher', 'coordinator', 'principal', 'admin']

export async function fetchAllStaff(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, geofence_exempt')
    .in('role', STAFF_ROLES)
    .order('full_name', { ascending: true })

  if (error) {
    console.error('fetchAllStaff error:', error)
    return []
  }
  return (data ?? []) as UserProfile[]
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
    on_leave: 0, absent: 0, holidays: 0, present_pct: 0,
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
  const credited = stats.present + stats.late + stats.wfh + stats.half_day * 0.5
  stats.present_pct = denominator > 0 ? Math.round((credited / denominator) * 100) : 0
  return stats
}
