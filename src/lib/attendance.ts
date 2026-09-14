import { supabase, UserProfile } from './supabase'
import { fetchStaffDetailsMap } from './staffDetails'
import { DEFAULT_TRUSTED_ACCURACY_M, LatLng, haversineDistance as haversine } from './geofence'
import { HomeroomClassTeacher, normalizeClassTeacher } from './homerooms'

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

/**
 * Every column of a staff attendance row the app actually reads.
 *
 * Deliberately not `*`: the table also stores the raw latitude, longitude and
 * accuracy of each of the four punches, and no screen has ever rendered them —
 * the UI shows the server's verdict and the distance from the fence. Selecting
 * `*` handed every viewer of the staff report their colleagues' precise
 * check-in coordinates for the day, which is both a privacy leak and 12 needless
 * columns on every row. Keep this list and the interface below in step.
 */
const STAFF_ATTENDANCE_COLUMNS =
  'id, staff_id, date, status, ' +
  'check_in_time, check_out_time, check_in_time_2, check_out_time_2, ' +
  'check_in_distance_m, check_out_distance_m, check_in_distance_m_2, check_out_distance_m_2, ' +
  'check_in_verdict, check_out_verdict, check_in_verdict_2, check_out_verdict_2, ' +
  'geofence_passed, leave_application_id, marked_by, remarks, ' +
  'forgotten_checkout_ack_at, created_at, updated_at'

export interface StaffAttendanceRecord {
  id: string
  staff_id: string
  date: string
  status: StaffAttendanceStatus
  check_in_time: string | null
  // Unsigned metres from the fence boundary at this punch, when a location
  // check ran (attendance_persist_off_campus_distance.sql) — null on a row
  // written before that migration, or when no check happened at all.
  check_in_distance_m: number | null
  // true: the check-in reading passed the fence. false: a reading was taken
  // and it did not (verdict 'outside' — still written, and flagged; see
  // describeLocationWarning). null: no check happened at all — no fence
  // configured, no position taken, or the staff member is exempt.
  geofence_passed: boolean | null
  check_out_time: string | null
  check_out_distance_m: number | null
  check_in_time_2: string | null
  check_in_distance_m_2: number | null
  check_out_time_2: string | null
  check_out_distance_m_2: number | null
  leave_application_id: string | null
  marked_by: string | null
  remarks: string | null
  created_at: string
  updated_at: string
  staff?: UserProfile
  // Per-punch geofence verdict as decided by the server. Informational only —
  // 'uncertain' is accepted the same as 'inside', there is no review queue.
  check_in_verdict: LocationVerdict | null
  check_out_verdict: LocationVerdict | null
  check_in_verdict_2: LocationVerdict | null
  check_out_verdict_2: LocationVerdict | null
  // Set once the staff member has dismissed the forgotten-checkout warning
  // for this row — server-side, so it follows them across devices/browsers
  // instead of only the one where they dismissed it.
  forgotten_checkout_ack_at: string | null
}

/**
 * The outcome the server recorded for a punch. Every one of these is
 * accepted — see attendance_allow_off_campus_flagged.sql for the last verdict
 * that used to refuse (`outside`) and why it stopped.
 *   inside          the reading placed them on campus. Not flagged.
 *   uncertain       too coarse to tell either way — not flagged: it failed to
 *                   disprove presence exactly as much as it failed to prove it
 *   outside         a reading placed them away from campus — flagged strictly,
 *                   as the strongest of the three kinds of evidence that
 *                   something is wrong (see LocationWarningKind)
 *   device_issue    no position at all, because the device could not produce
 *                   one in time — flagged, not strictly
 *   location_off    no position because location access is switched off —
 *                   flagged strictly (see the migration for what that costs)
 *   no_fix          legacy: no position, before device_issue/location_off
 *                   were distinguished. Kept so existing rows still read.
 *   exempt          the staff member is exempted from the fence
 *   no_fence        geofencing is switched off school-wide
 */
export type LocationVerdict =
  | 'inside' | 'outside' | 'uncertain' | 'device_issue' | 'location_off'
  | 'no_fix' | 'exempt' | 'no_fence'

/** The slice of an attendance row the student calendars actually render. */
export type AttendanceDayRecord = Pick<AttendanceRecord, 'id' | 'date' | 'status'>

/** The slice a mark sheet needs to seed its editor rows. */
export type AttendanceSheetRecord =
  Pick<AttendanceRecord, 'status' | 'remarks' | 'leave_application_id'>

export interface AttendanceSheetRow {
  student: UserProfile
  record: AttendanceSheetRecord | null
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

/** A circle around a centre point, or an outline traced around the campus. */
export type FenceShape = 'circle' | 'polygon'

export interface GeofenceConfig {
  enabled: boolean
  lat: number | null
  lng: number | null
  /** Circle radius, or — for a polygon fence — the outward buffer on the outline. */
  radius_m: number
  shape: FenceShape
  polygon: LatLng[] | null
  /**
   * Reported accuracy above which a reading is labelled `uncertain` rather
   * than `inside` in telemetry — see src/lib/geofence.ts. Both outcomes are
   * accepted identically; this only affects the diagnostics panel, so it is
   * not admin-configurable and always holds the internal default.
   */
  trusted_accuracy_m: number
}

/**
 * A named fence applied to one group of staff instead of the school-wide
 * config above (e.g. a second campus or an annexe block).
 */
export interface GeofenceZone {
  id: string
  label: string
  lat: number
  lng: number
  radius_m: number
  shape: FenceShape
  polygon: LatLng[] | null
  /** Per-zone override; null falls back to the school-wide value. */
  trusted_accuracy_m: number | null
  staff_ids: string[]
}

export interface GeofenceZoneInput {
  label: string
  lat: number
  lng: number
  radius_m: number
  shape: FenceShape
  polygon: LatLng[] | null
  trusted_accuracy_m: number | null
  staff_ids: string[]
}

/** The geofence one staff member is actually checked against. */
export interface EffectiveGeofence extends GeofenceConfig {
  zone_id: string | null
  zone_label: string | null
}

export interface AttendanceConfig {
  // Local "HH:MM" — staff who check IN in a later minute than this are marked
  // late. The cutoff minute itself is on time, so 08:45 means Late from 08:46.
  late_cutoff: string | null
  // Local "HH:MM" — staff who check OUT in an earlier minute are half_day.
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
  // 'HH:MM:SS' — a check-in in a later minute than this is marked Late; the
  // cutoff minute itself is still on time.
  late_cutoff: string
  checkout_cutoff: string // check out in an earlier minute than this is a Half Day
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
  working_days: number   // days in month up to today, minus non-working days — NOT reduced by holidays
  present: number
  late: number
  half_day: number
  wfh: number
  on_leave: number
  absent: number
  e: number
  holidays: number
  non_working: number    // excluded entirely from working_days — unpaid, not worked
  present_pct: number    // (present + late + wfh + 0.5*half_day + e + holidays) / (working_days - on_leave)
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
// Location warnings on a staff attendance row
// ============================================
//
// Three verdicts write a punch without a confirmed on-campus location:
//
//   outside        a reading placed them away from campus — the strongest
//                  evidence of the three that something is wrong, because
//                  this is the one case where a location WAS measured and it
//                  did not clear the fence. Flagged strict.
//   location_off   location access was switched off, so nothing was ever
//                  measured. A choice, and flagged as one — strict, same as
//                  `outside`.
//   device_issue   the receiver was asked and could not answer in time. Not
//                  anybody's fault, so flagged plainly rather than
//                  accusingly — the one non-strict kind.
//
// A coarse fix that still overlapped the fence (`uncertain`) is deliberately
// NOT here. That reading placed the staff member on campus as well as it placed
// them anywhere; flagging it would put a mark on the record of everyone whose
// phone happens to have mediocre GPS, which is noise, not oversight. The
// warning is reserved for punches where the location question was actually
// left unanswered, or answered "no".
//
// None of the three block the punch — see attendance_allow_off_campus_flagged.sql
// for why `outside` stopped being a refusal. Accepting any of them silently
// would be the dishonest half of that decision: the row would read exactly
// like a verified check-in and nobody would ever know the difference. So the
// warning is derived here, once, and rendered the same way to the staff
// member and to the office. It is the only reason it is reasonable to let
// these punches through at all.

/**
 * How the location came to be unverified, ranked most to least serious for
 * picking the one that headlines a day with more than one kind.
 *
 * `off_campus` outranks `no_access`: a measured reading placing someone away
 * from campus is direct evidence against presence, where denying access is
 * only the absence of evidence for it. Both outrank `device_issue`, which is
 * nobody's doing.
 */
export type LocationWarningKind = 'off_campus' | 'no_access' | 'device_issue'

const KIND_SEVERITY: LocationWarningKind[] = ['off_campus', 'no_access', 'device_issue']

/** Verdicts that mean "written, but the location was not confirmed". */

const VERDICT_KIND: Partial<Record<LocationVerdict, LocationWarningKind>> = {
  outside: 'off_campus',
  location_off: 'no_access',
  device_issue: 'device_issue',
}

export interface LocationWarning {
  /** The most severe kind across the day's punches — see KIND_SEVERITY. */
  kind: LocationWarningKind
  /** True for a kind that should be rendered in red and sorted to the top. */
  strict: boolean
  /**
   * Chip label. Carries the distance directly ("Off campus · 340m") when the
   * headline kind is off_campus and every off-campus punch on the row agrees
   * on the number — the common case, one off-campus punch. With more than one
   * off-campus punch reporting different distances, a single chip cannot
   * state two numbers, so it falls back to the plain kind label and the
   * distances move to `details` instead.
   */
  short: string
  /** Heading for a badge tooltip or banner. */
  title: string
  /** The whole message in one sentence — which punches, and what it means. */
  summary: string
  /**
   * Per-cause (or, for off_campus, per-punch) lines, and USUALLY EMPTY.
   *
   * They exist only when the summary sentence cannot carry everything: a day
   * that mixed causes, or several off-campus punches at genuinely different
   * distances. When one cause covers every flagged punch — including a single
   * off-campus distance shared by all of them — the summary already says it,
   * and a bullet repeating it makes the card look like it is warning about
   * two separate things.
   */
  details: string[]
}

export const PUNCH_SLOTS = [
  { label: 'Check-in',        verdict: 'check_in_verdict',    time: 'check_in_time',    distance: 'check_in_distance_m' },
  { label: 'Check-out',       verdict: 'check_out_verdict',   time: 'check_out_time',   distance: 'check_out_distance_m' },
  { label: 'Return check-in', verdict: 'check_in_verdict_2',  time: 'check_in_time_2',  distance: 'check_in_distance_m_2' },
  { label: 'Final check-out', verdict: 'check_out_verdict_2', time: 'check_out_time_2', distance: 'check_out_distance_m_2' },
] as const

/** "Check-in", "Check-in and Check-out", "Check-in, Check-out and Return check-in". */
function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/** "340m", or "4.2km" once metres stop being the useful unit. */
function formatDistanceM(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`
}

/**
 * Why one punch went unverified, as a clause that follows "was recorded".
 * off_campus is the one kind whose wording depends on the punch, since the
 * distance varies — `distanceM` is required there and ignored for the other
 * two. `null` covers a row written before distance was persisted per punch
 * (attendance_persist_off_campus_distance.sql) — still accurate, just not as
 * specific as a newer row can be.
 */
function causeClause(kind: LocationWarningKind, distanceM: number | null): string {
  if (kind === 'off_campus') {
    return distanceM != null
      ? `${formatDistanceM(distanceM)} outside the check-in zone`
      : 'with a location outside the check-in zone'
  }
  return kind === 'no_access'
    ? 'with location access switched off'
    : 'without any position, because the device could not get a fix in time'
}

/** The same causes, phrased to follow an em dash rather than "was recorded". */
function causeFragment(kind: LocationWarningKind, distanceM: number | null): string {
  if (kind === 'off_campus') {
    return distanceM != null
      ? `the recorded location was ${formatDistanceM(distanceM)} outside the check-in zone`
      : 'the recorded location was outside the check-in zone'
  }
  return kind === 'no_access'
    ? 'location access was switched off'
    : 'the device could not get a fix in time'
}

/**
 * The warning to show for one attendance row, or null when every punch on it
 * was decided normally. Pure — both the staff member's own card and the admin
 * report call this, so the two can never drift into saying different things
 * about the same row.
 */
export function describeLocationWarning(
  record: Pick<
    StaffAttendanceRecord,
    | 'check_in_verdict' | 'check_out_verdict' | 'check_in_verdict_2' | 'check_out_verdict_2'
    | 'check_in_time' | 'check_out_time' | 'check_in_time_2' | 'check_out_time_2'
    | 'check_in_distance_m' | 'check_out_distance_m' | 'check_in_distance_m_2' | 'check_out_distance_m_2'
  > | null | undefined,
): LocationWarning | null {
  if (!record) return null

  const flagged: { label: string; kind: LocationWarningKind; distanceM: number | null }[] = []
  for (const slot of PUNCH_SLOTS) {
    const kind = VERDICT_KIND[record[slot.verdict] ?? 'inside']
    if (kind) flagged.push({ label: slot.label, kind, distanceM: record[slot.distance] ?? null })
  }
  if (flagged.length === 0) return null

  const kinds = new Set(flagged.map(f => f.kind))
  const kind = KIND_SEVERITY.find(k => kinds.has(k))!
  const strict = kind !== 'device_issue'
  const mixed = kinds.size > 1

  // The off-campus punches specifically, and whether they agree on a distance.
  // Two off-campus punches at the same distance can still share one sentence;
  // different distances cannot, so that case forces the same "generalise and
  // let the bullets carry it" treatment as mixing causes.
  const offCampus = flagged.filter(f => f.kind === 'off_campus')
  const offCampusDistances = [...new Set(offCampus.map(f => f.distanceM))]
  const offCampusVaries = offCampusDistances.length > 1
  // The one distance to quote when they agree — including the case where
  // there is only one off-campus punch, or several sharing the one number.
  const offCampusDistance = offCampusVaries ? null : offCampusDistances[0] ?? null

  const needsDetail = mixed || offCampusVaries

  // "Every punch today" only when there is more than one and all of them are
  // flagged — with a single punch on the day it would be a grand way of saying
  // "Check-in".
  const recordedPunches = PUNCH_SLOTS.filter(s => record[s.time]).length
  const allFlagged = flagged.length > 1 && flagged.length === recordedPunches
  const subject = allFlagged ? 'Every punch today' : joinLabels(flagged.map(f => f.label))
  // "Every punch" is singular however many punches it covers; a list of them
  // is plural unless it is a list of one.
  const verb = allFlagged || flagged.length === 1 ? 'was' : 'were'

  // One cause (and, for off_campus, one agreed distance): the summary names
  // the punches and the cause together, and there is nothing left for a
  // bullet list to add.
  // Otherwise: the summary generalises and the bullets carry the specifics —
  // one line per off-campus punch (each has its own distance), one line per
  // cause for no_access/device_issue (theirs doesn't vary by punch).
  const summary = needsDetail
    ? `${flagged.length} of today's punches were recorded without a verified location.`
    : `${subject} ${verb} recorded ${causeClause(kind, offCampusDistance)}, so presence on campus was not confirmed.`

  const details = needsDetail
    ? [
      ...offCampus.map(f => `${f.label} — ${causeFragment('off_campus', f.distanceM)}.`),
      ...(['no_access', 'device_issue'] as const)
        .filter(k => kinds.has(k))
        .map(k => `${joinLabels(flagged.filter(f => f.kind === k).map(f => f.label))} — ${causeFragment(k, null)}.`),
    ]
    : []

  const short: Record<LocationWarningKind, string> = {
    off_campus: offCampusDistance != null ? `Off campus · ${formatDistanceM(offCampusDistance)}` : 'Off campus',
    no_access: 'No GPS access',
    device_issue: 'Bad GPS',
  }
  const title: Record<LocationWarningKind, string> = {
    off_campus: 'Marked away from campus',
    no_access: 'Marked without location access',
    device_issue: 'Marked without a location check',
  }

  return { kind, strict, short: short[kind], title: title[kind], summary, details }
}

/** True when this row carries a location warning — the cheap check for lists. */
export function hasLocationWarning(
  record: Parameters<typeof describeLocationWarning>[0],
): boolean {
  if (!record) return false
  return PUNCH_SLOTS.some(slot => !!VERDICT_KIND[record[slot.verdict] ?? 'inside'])
}

/**
 * Sort comparator that lifts flagged rows to the top of a list, strict ones
 * first. Used everywhere the report renders staff, so an unverified punch is
 * the first thing read rather than something found by scrolling.
 */
export function byLocationWarningFirst(
  a: Parameters<typeof describeLocationWarning>[0],
  b: Parameters<typeof describeLocationWarning>[0],
): number {
  const rank = (r: Parameters<typeof describeLocationWarning>[0]) => {
    const w = describeLocationWarning(r)
    return w ? (w.strict ? 0 : 1) : 2
  }
  return rank(a) - rank(b)
}

// ============================================
// Haversine distance helper
// ============================================

// Re-exported from the geofence module, which owns all distance/fence geometry
// so the client and the SQL verdict function stay in step.
export const haversineDistance = haversine

// ============================================
// Student Attendance
// ============================================

export async function fetchMyAttendanceByMonth(
  studentId: string,
  year: number,
  month: number, // 1-based
  homeroomId?: string
): Promise<AttendanceDayRecord[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  let query = supabase
    .from('attendance_records')
    .select('id, date, status')
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
    .select('student_id, status, remarks, leave_application_id')
    .eq('homeroom_id', homeroomId)
    .eq('date', date)

  if (recError) {
    console.error('fetchAttendanceSheet records error:', recError)
  }

  const recordByStudent: Record<string, AttendanceSheetRecord> = {}
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

/**
 * Saves a homeroom's marked sheet in one upsert.
 *
 * As in adminMarkStaffAttendance, `markedBy` is informational — the
 * `force_marked_by` trigger stores auth.uid() regardless of what is sent.
 */
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

  // OD leave → Present (student is working, just off-site); half day → half
  // day; late permit → late; casual/medical → Absent
  const attendanceStatus: AttendanceStatus =
    leaveType === 'on_duty' ? 'present'
      : leaveType === 'half_day' ? 'half_day'
        : leaveType === 'late' ? 'late'
          : 'absent'

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
  // On Duty auto-marks Present, Half Day Permit auto-marks Half Day, Late
  // Permit auto-marks Late, and any other approved leave auto-marks Absent —
  // status only ever lands on one of the five manual options (P/A/Late/½/Exception).
  const status: StaffAttendanceStatus =
    leaveType === 'on_duty' ? 'present'
      : leaveType === 'half_day' ? 'half_day'
        : leaveType === 'late' ? 'late'
          : 'absent'

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

/**
 * The school's timezone, from the same setting the database reads. Cutoffs are
 * wall-clock times, so they only mean anything against a zone — and reading the
 * device's own zone would let a traveller (or a fiddled setting) shift them.
 * Falls back to the device zone only if the RPC itself fails, matching
 * fetchServerTime()'s fallback.
 */
export async function fetchAttendanceTimezone(): Promise<string | null> {
  const { data, error } = await supabase.rpc('attendance_timezone')
  if (error || !data) {
    console.error('fetchAttendanceTimezone error, falling back to device zone:', error)
    return null
  }
  return data as string
}

/** Minutes since midnight for `date`, read in `timezone` (device zone when null). */
export function minuteOfDayInZone(date: Date, timezone?: string | null): number {
  if (!timezone) return date.getHours() * 60 + date.getMinutes()
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0')
  // 24:00 is how en-GB spells midnight in some runtimes; normalise it to 0.
  return (get('hour') % 24) * 60 + get('minute')
}

/** 'YYYY-MM-DD' for `date` in `timezone` (device zone when null). */
export function dateStringInZone(date: Date, timezone?: string | null): string {
  if (!timezone) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }
  // en-CA formats as YYYY-MM-DD, which is the shape every date field here uses.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

/** Minutes since midnight for an "HH:MM" / "HH:MM:SS" cutoff; null if unset or unparseable. */
function minutesFromCutoff(cutoff: string | null | undefined): number | null {
  if (!cutoff) return null
  const [h, m] = cutoff.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

/**
 * Whether `now` has moved past an "HH:MM" (or "HH:MM:SS") cutoff.
 *
 * The cutoff minute itself is still on time: a late cutoff of 08:45 keeps every
 * check-in inside 08:45 Present, and Late starts at 08:46:00. Both sides are
 * therefore compared as whole minutes since midnight — the resolution the
 * cutoff is actually configured in. Mirrors attendance_minute_of_day() in SQL,
 * which is what the punch itself is scored by.
 */
function isPastCutoff(
  cutoff: string | null | undefined,
  now: Date,
  timezone?: string | null
): boolean {
  const cutoffMinutes = minutesFromCutoff(cutoff)
  if (cutoffMinutes === null) return false
  return minuteOfDayInZone(now, timezone) > cutoffMinutes
}

/**
 * Returns 'late' if `now` is past the late cutoff, otherwise 'present'.
 *
 * Advisory only — this drives the "you'll be marked Late" heads-up. The status
 * actually written is derived by the punch RPC from the server clock. Pass the
 * server time and the school timezone so the two agree.
 */
export function deriveCheckInStatus(
  lateCutoff: string | null | undefined,
  now: Date = new Date(),
  timezone?: string | null
): StaffAttendanceStatus {
  return isPastCutoff(lateCutoff, now, timezone) ? 'late' : 'present'
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

// ============================================
// The punch (check-in / check-out)
//
// Both are thin wrappers over the `staff_attendance_punch` RPC. Everything that
// decides the outcome — who the caller is, the clock, the geofence verdict, the
// minimum gap between actions, and the late / half-day derivation — happens in
// the database. Previously all of it happened here, in the browser, which meant
// the device being checked was also the thing reporting whether it passed.
//
// The client's only job now is to hand over honest sensor readings.
// ============================================

/** Sensor readings and acquisition diagnostics for one punch attempt. */
export interface PunchReading {
  lat: number
  lng: number
  accuracy: number
  sampleCount?: number
  agreeingCount?: number
  bestAccuracyM?: number
  spreadM?: number
  acquisitionMs?: number
  coarseLock?: boolean
}

export type PunchErrorCode =
  | 'not_authenticated'
  | 'bad_action'
  /** Legacy: refused for being off campus, before that verdict was accepted
   *  and flagged instead (attendance_allow_off_campus_flagged.sql). Never
   *  returned by a current server; kept so an older deployment still reads. */
  | 'outside_zone'
  | 'no_fix'
  | 'too_soon'
  | 'already_checked_in'
  | 'already_checked_out'
  | 'already_complete'
  | 'not_checked_in'
  | 'request_failed'

export interface PunchResult {
  success: boolean
  errorCode?: PunchErrorCode
  /** Milliseconds still to wait, when refused for `too_soon`. */
  tooSoonMs?: number
  verdict?: LocationVerdict
  /** Distance to the fence boundary in metres. */
  distanceM?: number
  accuracyM?: number
  status?: StaffAttendanceStatus
  /** Which of the four punch slots was written: 'in' | 'out' | 'in2' | 'out2'. */
  punchSlot?: string
  markedHalfDay?: boolean
  /** Label of the zone checked against, for a message naming the right campus. */
  zoneLabel?: string | null
  radiusM?: number
  attemptId?: string | null
}

interface PunchRpcRow {
  success: boolean
  error_code: PunchErrorCode | null
  too_soon_ms: number | null
  verdict: LocationVerdict | null
  distance_m: number | null
  accuracy_m: number | null
  status: StaffAttendanceStatus | null
  punch_slot: string | null
  marked_half_day: boolean | null
  zone_label: string | null
  radius_m: number | null
  attempt_id: string | null
}

async function punch(
  action: 'checkin' | 'checkout',
  reading?: PunchReading,
  failure?: string | null,
): Promise<PunchResult> {
  const { data, error } = await supabase.rpc('staff_attendance_punch', {
    p_action: action,
    p_lat: reading?.lat ?? null,
    p_lng: reading?.lng ?? null,
    p_accuracy: reading?.accuracy ?? null,
    p_sample_count: reading?.sampleCount ?? null,
    p_agreeing_count: reading?.agreeingCount ?? null,
    p_best_accuracy_m: reading?.bestAccuracyM ?? null,
    p_spread_m: reading?.spreadM ?? null,
    p_acquisition_ms: reading?.acquisitionMs ?? null,
    p_coarse_lock: reading?.coarseLock ?? false,
    p_failure: failure ?? null,
    p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 400) : null,
  })

  if (error) {
    console.error(`staff_attendance_punch(${action}) error:`, error)
    return { success: false, errorCode: 'request_failed' }
  }

  const row = (Array.isArray(data) ? data[0] : data) as PunchRpcRow | undefined
  if (!row) return { success: false, errorCode: 'request_failed' }

  return {
    success: row.success,
    errorCode: row.error_code ?? undefined,
    tooSoonMs: row.too_soon_ms ?? undefined,
    verdict: row.verdict ?? undefined,
    distanceM: row.distance_m ?? undefined,
    accuracyM: row.accuracy_m ?? undefined,
    status: row.status ?? undefined,
    punchSlot: row.punch_slot ?? undefined,
    markedHalfDay: row.marked_half_day ?? undefined,
    zoneLabel: row.zone_label,
    radiusM: row.radius_m ?? undefined,
    attemptId: row.attempt_id,
  }
}

/**
 * Records a check-in. `reading` is omitted when no fix could be obtained at all;
 * the server then refuses unless the staff member is geofence-exempt, and
 * `failure` is logged so a device that never gets a fix is visible in telemetry
 * rather than invisible.
 */
export async function checkInStaff(reading?: PunchReading, failure?: string | null): Promise<PunchResult> {
  return punch('checkin', reading, failure)
}

export async function checkOutStaff(reading?: PunchReading, failure?: string | null): Promise<PunchResult> {
  return punch('checkout', reading, failure)
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
    .select(STAFF_ATTENDANCE_COLUMNS)
    .eq('staff_id', staffId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })

  if (error) {
    console.error('fetchMyStaffAttendance error:', error)
    return []
  }
  return (data ?? []) as unknown as StaffAttendanceRecord[]
}

/**
 * A staff member's own past days left with a punch open — checked in (either
 * slot) with no matching checkout. Surfaced as a warning the next time they
 * open the attendance app, since a past day can no longer be checked out of.
 *
 * Excludes rows already acknowledged (see `ackForgottenCheckout`) — that
 * marker is server-side, so a case dismissed on one device stays dismissed
 * everywhere else the staff member opens the app too.
 */
export async function fetchOpenPunchRecords(
  staffId: string,
  beforeDate: string,
  lookbackDays = 14,
): Promise<StaffAttendanceRecord[]> {
  const since = new Date(beforeDate + 'T12:00:00')
  since.setDate(since.getDate() - lookbackDays)
  const sinceDate = since.toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('staff_attendance_records')
    .select(STAFF_ATTENDANCE_COLUMNS)
    .eq('staff_id', staffId)
    .lt('date', beforeDate)
    .gte('date', sinceDate)
    .is('forgotten_checkout_ack_at', null)
    .or('and(check_in_time.not.is.null,check_out_time.is.null),and(check_in_time_2.not.is.null,check_out_time_2.is.null)')
    .order('date', { ascending: false })

  if (error) {
    console.error('fetchOpenPunchRecords error:', error)
    return []
  }
  return (data ?? []) as unknown as StaffAttendanceRecord[]
}

/**
 * Dismisses the forgotten-checkout warning for these rows — the staff member
 * has seen them, so `fetchOpenPunchRecords` stops returning them, on every
 * device. Staff have no direct UPDATE grant on this table (see the RLS
 * policies on `staff_attendance_records`), so this goes through a
 * SECURITY DEFINER RPC scoped to the caller's own rows.
 */
export async function ackForgottenCheckout(recordIds: string[]): Promise<void> {
  if (recordIds.length === 0) return
  const { error } = await supabase.rpc('ack_forgotten_checkout', { p_record_ids: recordIds })
  if (error) console.error('ackForgottenCheckout error:', error)
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
      ${STAFF_ATTENDANCE_COLUMNS},
      staff:profiles!staff_attendance_records_staff_id_fkey(
        id, email, full_name, role, avatar_url, geofence_exempt, is_banned, attendance_hidden
      )
    `)
    .eq('date', date)

  if (error) {
    console.error('fetchStaffAttendanceReportByDate error:', error)
    return []
  }
  return ((data ?? []) as unknown as StaffAttendanceRecord[]).filter(r =>
    r.staff && !r.staff.attendance_hidden && !r.staff.is_banned && STAFF_ROLES.includes(r.staff.role)
  )
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

// Present/absent status sets shared by every screen that tallies student
// attendance in the browser (the report, the class-teacher card) — late and
// on-duty count as present, on-leave counts as absent, so results always agree
// with the categorization the Student Attendance report displays.
// The same split is encoded in the `student_attendance_tally` and
// `homeroom_attendance_counts` functions, which do their counting in the
// database; change both together.
export const STUDENT_PRESENT_STATUSES = new Set<AttendanceStatus>(['present', 'late', 'on_duty'])
export const STUDENT_ABSENT_STATUSES  = new Set<AttendanceStatus>(['absent', 'on_leave'])

export interface StudentAttendanceTally { present: number; absent: number; irregular: number }

/**
 * Whole-school present / absent / irregular tallies for a date.
 *
 * Counted in the database (`student_attendance_tally`) rather than by three
 * separate exact-count round trips from the browser: one query instead of
 * three on a home-page tile every manager loads, and no dependence on
 * PostgREST's row cap, since no rows travel at all. The function is
 * SECURITY INVOKER, so RLS still decides which rows are countable — a student
 * calling it sees exactly what they could already count for themselves.
 */
export async function fetchStudentAttendanceTallyByDate(date: string): Promise<StudentAttendanceTally> {
  const { data, error } = await supabase
    .rpc('student_attendance_tally', { p_date: date })
    .maybeSingle<StudentAttendanceTally>()

  if (error) {
    console.error('fetchStudentAttendanceTallyByDate error:', error)
    return { present: 0, absent: 0, irregular: 0 }
  }
  return {
    present: data?.present ?? 0,
    absent: data?.absent ?? 0,
    irregular: data?.irregular ?? 0,
  }
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

/**
 * Admin / principal / coordinator sets a staff member's status for a day.
 *
 * `markedBy` is the caller's own id. It is sent for clarity, not for trust:
 * a `force_marked_by` trigger overwrites the stored value with auth.uid(), so
 * the row is always attributed to the session that actually wrote it.
 */
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

/** Removes a mark, putting the staff member back to "not marked" for that day. */
export async function clearStaffAttendance(staffId: string, date: string): Promise<boolean> {
  const { error } = await supabase
    .from('staff_attendance_records')
    .delete()
    .eq('staff_id', staffId)
    .eq('date', date)
  if (error) {
    console.error('clearStaffAttendance error:', error)
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

  const v = data.value as Partial<GeofenceConfig>
  return {
    enabled: v.enabled ?? false,
    lat: v.lat ?? null,
    lng: v.lng ?? null,
    radius_m: v.radius_m ?? 200,
    // Defaults keep every fence saved before this rebuild working unchanged.
    shape: v.shape ?? 'circle',
    polygon: v.polygon ?? null,
    trusted_accuracy_m: v.trusted_accuracy_m ?? DEFAULT_TRUSTED_ACCURACY_M,
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

const GEOFENCE_ZONE_COLUMNS = 'id, label, lat, lng, radius_m, shape, polygon, trusted_accuracy_m'

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
    shape: z.shape,
    // A polygon zone still stores lat/lng (the outline's centroid) so existing
    // list views and map pins have a point to show without parsing the outline.
    polygon: z.shape === 'polygon' ? z.polygon : null,
    trusted_accuracy_m: z.trusted_accuracy_m,
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
async function fetchGeofenceZoneForStaff(staffId: string): Promise<GeofenceZone | null> {
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

  const base: GeofenceConfig = config ?? {
    enabled: false, lat: null, lng: null, radius_m: 200,
    shape: 'circle', polygon: null,
    trusted_accuracy_m: DEFAULT_TRUSTED_ACCURACY_M,
  }
  if (!zone) return { ...base, zone_id: null, zone_label: null }

  return {
    // The master switch always comes from the school-wide config: a zone moves
    // where a staff member has to stand, never whether GPS is checked at all.
    enabled: base.enabled,
    lat: zone.lat,
    lng: zone.lng,
    radius_m: zone.radius_m,
    shape: zone.shape,
    polygon: zone.polygon,
    trusted_accuracy_m: zone.trusted_accuracy_m ?? base.trusted_accuracy_m,
    zone_id: zone.id,
    zone_label: zone.label,
  }
}

// ============================================
// Location attempt telemetry
//
// Every acquisition attempt is logged, accepted or refused. This is what makes
// the accuracy threshold tunable against evidence: without it there is no way
// to answer "who is failing, how often, and at what accuracy" — which is the
// question that should have set the original 75m cap and didn't.
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
  // Merge rather than replace. The same JSONB row also holds `timezone`, which
  // is set straight in SQL and is what both the punch RPC and the UI read
  // cutoffs against — saving the two cutoffs must not drop it.
  const { data: existing } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'attendance_config')
    .maybeSingle()

  const value = { ...(existing?.value as Record<string, unknown> | null ?? {}), ...config }

  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'attendance_config', value }, { onConflict: 'key' })

  if (error) {
    console.error('saveAttendanceConfig error:', error)
    return false
  }
  return true
}

// ============================================
// Scope-based day rules — shared engine behind Holidays and Non-working Days.
// Each is its own table (attendance_holidays / attendance_non_working_days +
// a *_members side table), but both now support the same date-vs-weekday
// split attendance_day_timings already uses for cutoffs:
//   * scope_type = 'date'    → one exact date (the original behaviour)
//   * scope_type = 'weekday' → repeats every week on that weekday, so a
//     standing weekly off (Sunday) doesn't need re-entering every week —
//     see add_attendance_holiday_weekday_scope.sql for why that mattered:
//     an unmarked Sunday was silently scored as an unpaid absence in payroll.
// A date rule wins over a matching weekday rule for the same calendar date
// (mirrors resolveLateCutoff's date-over-weekday priority).
// ============================================

interface ScopeRuleRow {
  id: string
  scope_type: DayTimingScopeType
  scope_date: string | null
  scope_weekday: number | null
  name: string
  is_default: boolean
}

interface ScopeRuleGroup extends ScopeRuleRow {
  staff_ids: string[]
}

interface ScopeRuleGroupInput {
  name: string
  is_default: boolean
  staff_ids: string[]
}

/** Which table pair a call operates on — the only thing that differs between Holidays and Non-working Days. */
interface ScopeRuleTables {
  table: string
  membersTable: string
  memberFk: string
  columns: string
  defaultLabel: string
  groupLabel: string
}

const HOLIDAY_TABLES: ScopeRuleTables = {
  table: 'attendance_holidays',
  membersTable: 'attendance_holiday_members',
  memberFk: 'holiday_id',
  columns: 'id, scope_type, scope_date, scope_weekday, name, is_default',
  defaultLabel: 'Holiday',
  groupLabel: 'Group holiday',
}

const NON_WORKING_DAY_TABLES: ScopeRuleTables = {
  table: 'attendance_non_working_days',
  membersTable: 'attendance_non_working_day_members',
  memberFk: 'non_working_day_id',
  columns: 'id, scope_type, scope_date, scope_weekday, name, is_default',
  defaultLabel: 'Non-working day',
  groupLabel: 'Group non-working day',
}

async function attachScopeMembers(rows: ScopeRuleRow[], t: ScopeRuleTables): Promise<ScopeRuleGroup[]> {
  if (rows.length === 0) return []
  const { data: members, error } = await supabase
    .from(t.membersTable)
    .select(`${t.memberFk}, staff_id`)
    .in(t.memberFk, rows.map(r => r.id))

  if (error) console.error(`attachScopeMembers(${t.membersTable}) error:`, error)

  const staffByRule = new Map<string, string[]>()
  for (const m of (members ?? []) as unknown as Record<string, string>[]) {
    const key = m[t.memberFk]
    if (!staffByRule.has(key)) staffByRule.set(key, [])
    staffByRule.get(key)!.push(m.staff_id)
  }
  return rows.map(r => ({ ...r, staff_ids: staffByRule.get(r.id) ?? [] }))
}

/** Rules directly attached to one scope (an exact date, or one weekday number). */
async function fetchScopeRulesByScope(t: ScopeRuleTables, scope: DayTimingScope): Promise<ScopeRuleGroup[]> {
  let query = supabase.from(t.table).select(t.columns).eq('scope_type', scope.type)
  query = scope.type === 'date' ? query.eq('scope_date', scope.date) : query.eq('scope_weekday', scope.weekday)

  const { data, error } = await query
  if (error) {
    console.error(`fetchScopeRulesByScope(${t.table}) error:`, error)
    return []
  }
  return attachScopeMembers((data ?? []) as unknown as ScopeRuleRow[], t)
}

/** Every rule in effect for a calendar date: exact-date rules first, then any weekly-recurring rule for that weekday. */
async function fetchScopeRulesForDate(t: ScopeRuleTables, date: string): Promise<ScopeRuleGroup[]> {
  const weekday = new Date(date + 'T12:00:00').getDay()
  const [dateRules, weekdayRules] = await Promise.all([
    fetchScopeRulesByScope(t, { type: 'date', date }),
    fetchScopeRulesByScope(t, { type: 'weekday', weekday }),
  ])
  return [...dateRules, ...weekdayRules]
}

/** Every rule that exists, of either scope — for a management/overview list (e.g. Settings). */
async function fetchAllScopeRules(t: ScopeRuleTables): Promise<ScopeRuleGroup[]> {
  const { data: rows, error } = await supabase
    .from(t.table)
    .select(t.columns)
    .order('scope_type', { ascending: true })
    .order('scope_weekday', { ascending: true })
    .order('scope_date', { ascending: true })

  if (error) {
    console.error(`fetchAllScopeRules(${t.table}) error:`, error)
    return []
  }
  return attachScopeMembers((rows ?? []) as unknown as ScopeRuleRow[], t)
}

/**
 * Replaces every rule for one scope with the given set (delete-then-insert).
 * Pass an empty array to clear the rule for that scope entirely.
 */
async function saveScopeRules(
  t: ScopeRuleTables,
  scope: DayTimingScope,
  groups: ScopeRuleGroupInput[],
  createdBy: string,
): Promise<boolean> {
  let delQuery = supabase.from(t.table).select('id').eq('scope_type', scope.type)
  delQuery = scope.type === 'date' ? delQuery.eq('scope_date', scope.date) : delQuery.eq('scope_weekday', scope.weekday)

  const { data: existing, error: fetchError } = await delQuery
  if (fetchError) {
    console.error(`saveScopeRules(${t.table}) fetch error:`, fetchError)
    return false
  }

  if (existing && existing.length > 0) {
    const { error: delError } = await supabase.from(t.table).delete().in('id', existing.map(r => r.id))
    if (delError) {
      console.error(`saveScopeRules(${t.table}) delete error:`, delError)
      return false
    }
  }

  if (groups.length === 0) return true

  const rows = groups.map(g => ({
    id: crypto.randomUUID(),
    scope_type: scope.type,
    scope_date: scope.type === 'date' ? scope.date : null,
    scope_weekday: scope.type === 'weekday' ? scope.weekday : null,
    name: g.name.trim() || (g.is_default ? t.defaultLabel : t.groupLabel),
    is_default: g.is_default,
    created_by: createdBy,
  }))

  const { error: insError } = await supabase.from(t.table).insert(rows)
  if (insError) {
    console.error(`saveScopeRules(${t.table}) insert error:`, insError)
    return false
  }

  const memberRows = groups.flatMap((g, i) =>
    g.staff_ids.map(staff_id => ({ [t.memberFk]: rows[i].id, staff_id }))
  )

  if (memberRows.length > 0) {
    const { error: memInsError } = await supabase.from(t.membersTable).insert(memberRows)
    if (memInsError) {
      console.error(`saveScopeRules(${t.membersTable}) members insert error:`, memInsError)
      return false
    }
  }

  return true
}

/**
 * Resolves every is_default rule (date-scoped and weekly-recurring) into
 * concrete per-date entries for one calendar month — what the mini calendar
 * and payroll actually consume. A date rule wins over a weekday rule that
 * would otherwise also cover that date.
 */
async function fetchResolvedDatesForMonth(
  t: ScopeRuleTables, year: number, month: number,
): Promise<{ id: string; date: string; name: string }[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const [dateRes, weekdayRes] = await Promise.all([
    supabase.from(t.table).select('id, scope_date, name').eq('is_default', true).eq('scope_type', 'date')
      .gte('scope_date', startDate).lte('scope_date', endDate),
    supabase.from(t.table).select('id, scope_weekday, name').eq('is_default', true).eq('scope_type', 'weekday'),
  ])
  if (dateRes.error) console.error(`fetchResolvedDatesForMonth(${t.table}) date error:`, dateRes.error)
  if (weekdayRes.error) console.error(`fetchResolvedDatesForMonth(${t.table}) weekday error:`, weekdayRes.error)

  const byDate = new Map<string, { id: string; date: string; name: string }>()
  for (const r of (dateRes.data ?? []) as { id: string; scope_date: string; name: string }[]) {
    byDate.set(r.scope_date, { id: r.id, date: r.scope_date, name: r.name })
  }

  const weekdayRules = (weekdayRes.data ?? []) as { id: string; scope_weekday: number; name: string }[]
  if (weekdayRules.length > 0) {
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (byDate.has(dateStr)) continue // an exact-date rule already covers this day
      const rule = weekdayRules.find(r => r.scope_weekday === new Date(dateStr + 'T12:00:00').getDay())
      if (rule) byDate.set(dateStr, { id: `${rule.id}:${dateStr}`, date: dateStr, name: rule.name })
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// ============================================
// Holidays (whole-school, is_default rows only — the simple case used by
// personal calendars and the home dashboard, which aren't staff-aware)
// ============================================

export async function fetchHolidays(year?: number, month?: number): Promise<Holiday[]> {
  if (year == null || month == null) {
    // No month bound to expand weekday rules against (unbounded) — not used
    // by any current caller, so this stays limited to exact-date rules only.
    const { data, error } = await supabase
      .from('attendance_holidays')
      .select('id, scope_date, name')
      .eq('is_default', true).eq('scope_type', 'date')
      .order('scope_date', { ascending: true })
    if (error) { console.error('fetchHolidays error:', error); return [] }
    return ((data ?? []) as { id: string; scope_date: string; name: string }[])
      .map(r => ({ id: r.id, date: r.scope_date, name: r.name }))
  }
  return fetchResolvedDatesForMonth(HOLIDAY_TABLES, year, month)
}

export async function fetchHolidayByDate(date: string): Promise<Holiday | null> {
  const rules = await fetchScopeRulesForDate(HOLIDAY_TABLES, date)
  const rule = rules.find(r => r.is_default)
  return rule ? { id: rule.id, date, name: rule.name } : null
}

// ============================================
// Holiday groups — a scope's holiday(s), optionally split so only specific
// teachers get the day off instead of the whole school (mirrors DayTimingGroup).
// ============================================

export interface HolidayGroup {
  id: string
  scope_type: DayTimingScopeType
  scope_date: string | null
  scope_weekday: number | null
  name: string
  is_default: boolean
  staff_ids: string[]
}

export interface HolidayGroupInput {
  name: string
  is_default: boolean
  staff_ids: string[]
}

export async function fetchHolidaysForDate(date: string): Promise<HolidayGroup[]> {
  return fetchScopeRulesForDate(HOLIDAY_TABLES, date)
}

/** Every rule directly attached to one scope — used by the edit modal, which manages one scope's rules as a unit. */
export async function fetchHolidaysByScope(scope: DayTimingScope): Promise<HolidayGroup[]> {
  return fetchScopeRulesByScope(HOLIDAY_TABLES, scope)
}

/**
 * Replaces every holiday row for a scope with the given set (delete-then-insert).
 * Pass an empty array to clear the holiday for that scope entirely.
 */
export async function saveHolidays(
  scope: DayTimingScope,
  groups: HolidayGroupInput[],
  createdBy: string
): Promise<boolean> {
  return saveScopeRules(HOLIDAY_TABLES, scope, groups, createdBy)
}

/** Every holiday rule that exists, of either scope — for a management/overview list (e.g. Settings). */
export async function fetchAllHolidayRules(): Promise<HolidayGroup[]> {
  return fetchAllScopeRules(HOLIDAY_TABLES)
}

// ============================================
// Non-working days — a day that is genuinely not worked and not paid, unlike
// a Holiday (which is a paid day off and, since upgrade_attendance_holidays_
// groups.sql / the working-days rework, no longer shrinks working days).
// Mirrors the Holiday functions above one-for-one — see
// add_attendance_non_working_days.sql.
// ============================================

/** Same shape as `Holiday`, backed by its own table (attendance_non_working_days). */
export interface NonWorkingDay {
  id: string
  date: string
  name: string
}

export async function fetchNonWorkingDays(year?: number, month?: number): Promise<NonWorkingDay[]> {
  if (year == null || month == null) {
    const { data, error } = await supabase
      .from('attendance_non_working_days')
      .select('id, scope_date, name')
      .eq('is_default', true).eq('scope_type', 'date')
      .order('scope_date', { ascending: true })
    if (error) { console.error('fetchNonWorkingDays error:', error); return [] }
    return ((data ?? []) as { id: string; scope_date: string; name: string }[])
      .map(r => ({ id: r.id, date: r.scope_date, name: r.name }))
  }
  return fetchResolvedDatesForMonth(NON_WORKING_DAY_TABLES, year, month)
}

export interface NonWorkingDayGroup {
  id: string
  scope_type: DayTimingScopeType
  scope_date: string | null
  scope_weekday: number | null
  name: string
  is_default: boolean
  staff_ids: string[]
}

export interface NonWorkingDayGroupInput {
  name: string
  is_default: boolean
  staff_ids: string[]
}

export async function fetchNonWorkingDaysForDate(date: string): Promise<NonWorkingDayGroup[]> {
  return fetchScopeRulesForDate(NON_WORKING_DAY_TABLES, date)
}

/** Every rule directly attached to one scope — used by the edit modal, which manages one scope's rules as a unit. */
export async function fetchNonWorkingDaysByScope(scope: DayTimingScope): Promise<NonWorkingDayGroup[]> {
  return fetchScopeRulesByScope(NON_WORKING_DAY_TABLES, scope)
}

/**
 * Replaces every non-working-day row for a scope with the given set
 * (delete-then-insert). Pass an empty array to clear it for that scope entirely.
 */
export async function saveNonWorkingDays(
  scope: DayTimingScope,
  groups: NonWorkingDayGroupInput[],
  createdBy: string
): Promise<boolean> {
  return saveScopeRules(NON_WORKING_DAY_TABLES, scope, groups, createdBy)
}

/** Every non-working-day rule that exists, of either scope — for a management/overview list (e.g. Settings). */
export async function fetchAllNonWorkingDayRules(): Promise<NonWorkingDayGroup[]> {
  return fetchAllScopeRules(NON_WORKING_DAY_TABLES)
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

// ============================================
// Retroactive recomputation
//
// A day's status is decided at the punch, from the cutoffs in force at that
// moment — and the rules a day is scored against are editable afterwards. Add a
// checkout cutoff to a Saturday on Monday morning and every staff member who
// left early that Saturday is still stamped Half Day, with the LOP rupees under
// it, against a rule that no longer says what it said. Declaring a past day a
// holiday or a non-working day has the same effect.
//
// attendance_retroactive_recompute.sql re-derives those statuses. It is not run
// speculatively: every write to a cutoff / holiday / non-working-day rule marks
// the affected scope dirty in `attendance_recompute_queue`, and this drains it.
// With nothing queued — the overwhelmingly common case — the call is a single
// indexed read of an empty table, which is what makes it reasonable for the
// attendance report and the salary pages to call on every load.
//
// Only the punch's own rows move: a status an admin set by hand (`marked_by`)
// or one written by the leave sync (`leave_application_id`) is left alone. See
// the migration for the full list of guards, and for why a closed pay cycle is
// deliberately not touched.
// ============================================

export interface AttendanceRecomputeResult {
  /** Dates that were re-derived. 0 when nothing had changed. */
  datesProcessed: number
  /** Statuses that actually moved — always 0 on a second run over the same dates. */
  recordsUpdated: number
}

const NO_RECOMPUTE: AttendanceRecomputeResult = { datesProcessed: 0, recordsUpdated: 0 }

// A page load can reach this from several places at once (the report, a summary
// card, a cycle sheet). They all want the same answer, so the first call in
// flight is the one that runs and the rest wait on it.
let recomputeInFlight: Promise<AttendanceRecomputeResult> | null = null

/**
 * Applies any attendance-rule change made since the last run, and reports what
 * moved. Safe and cheap to call from any screen: callers without permission to
 * change the rules get a no-op result rather than an error.
 */
export async function recomputePendingAttendance(): Promise<AttendanceRecomputeResult> {
  if (recomputeInFlight) return recomputeInFlight

  const run = (async (): Promise<AttendanceRecomputeResult> => {
    const { data, error } = await supabase.rpc('attendance_recompute_pending')
    if (error) {
      // A deployment that hasn't had the migration applied yet lands here. The
      // caller carries on with the statuses as stored — stale, but the same
      // behaviour as before this existed, rather than a broken page.
      console.error('recomputePendingAttendance error:', error)
      return NO_RECOMPUTE
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      { dates_processed: number; records_updated: number } | undefined
    return {
      datesProcessed: Number(row?.dates_processed ?? 0),
      recordsUpdated: Number(row?.records_updated ?? 0),
    }
  })()

  recomputeInFlight = run
  try {
    return await run
  } finally {
    if (recomputeInFlight === run) recomputeInFlight = null
  }
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

/**
 * Drivers, trackable the same way school staff are (not resigned, not
 * hidden). Drivers have a real login but no self check-in of their own — see
 * ProtectedLayout, which routes role='driver' straight to /driver and away
 * from this app entirely — so like ground-level support staff, every row is
 * set by an admin. Folded into the Support Staff section of the attendance
 * report rather than getting a self-service flow of its own.
 */
export async function fetchTrackedDrivers(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, attendance_hidden')
    .eq('role', 'driver')
    .eq('is_banned', false)
    .eq('attendance_hidden', false)
    .order('full_name', { ascending: true })
  if (error) {
    console.error('fetchTrackedDrivers error:', error)
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

/**
 * All attendance records for a set of staff across a whole month (no status
 * filter) — payroll's raw input.
 *
 * Paged, and it has to be: a month for a whole payroll cycle is one row per
 * staff member per marked day, so a school of 95 staff clears PostgREST's
 * 1000-row response cap before the third week. A truncated reply is not an
 * error — it arrives as a short list of perfectly valid rows — and the days it
 * drops read as never marked, which `deriveDayStatus` turns into Absent. That
 * silently inflates the Leave column, and every LOP rupee under it, for
 * whichever staff happened to sit past the cut. Ordered so the paging window
 * is stable between round-trips.
 */
export async function fetchMonthlyAttendanceRecords(
  staffIds: string[],
  year: number,
  month: number
): Promise<StaffAttendanceRecord[]> {
  if (staffIds.length === 0) return []
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const PAGE = 1000
  const out: StaffAttendanceRecord[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('staff_attendance_records')
      .select(STAFF_ATTENDANCE_COLUMNS)
      .in('staff_id', staffIds)
      .gte('date', start)
      .lte('date', end)
      .order('staff_id', { ascending: true })
      .order('date', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) {
      // Returning what has landed so far would understate attendance exactly
      // the way the row cap did, so a failed page fails the whole fetch.
      console.error('fetchMonthlyAttendanceRecords error:', error)
      return []
    }
    out.push(...((data ?? []) as unknown as StaffAttendanceRecord[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

// ============================================
// Derived day status & monthly stats
// ============================================

/**
 * Effective status for a calendar day, deriving Absent for working days with no
 * record. Every day of the week is treated the same — weekends are working days
 * unless explicitly marked a holiday or non-working day. A day becomes Absent
 * the moment it is "today" or earlier and has no record — the staff member can
 * still check in to flip it to Present/Late. Returns null for future days.
 *
 * A Holiday is a *paid* day off — see computeMonthlyStats, it still counts
 * toward working days. A non-working day is neither worked nor paid, and a
 * non-working rule wins over a holiday rule on the same date (an edge case
 * that shouldn't normally arise, but the day can only be one or the other).
 */
export function deriveDayStatus(
  dateStr: string,
  record: StaffAttendanceRecord | undefined,
  holidaySet: Set<string>,
  nonWorkingSet: Set<string>,
  today: string,
): StaffAttendanceStatus | 'holiday' | 'non_working' | null {
  if (record) return record.status
  if (nonWorkingSet.has(dateStr)) return 'non_working'
  if (holidaySet.has(dateStr)) return 'holiday'
  if (dateStr > today) return null // future days
  return 'absent'
}

export function computeMonthlyStats(
  year: number,
  month: number,
  records: StaffAttendanceRecord[],
  holidays: Holiday[],
  today: string = new Date().toISOString().split('T')[0],
  nonWorkingDays: (Holiday | NonWorkingDay)[] = [],
): StaffMonthlyStats {
  const holidaySet = new Set(holidays.map(h => h.date))
  const nonWorkingSet = new Set(nonWorkingDays.map(h => h.date))
  const recordByDate = new Map(records.map(r => [r.date, r]))
  const lastDay = new Date(year, month, 0).getDate()

  const stats: StaffMonthlyStats = {
    working_days: 0, present: 0, late: 0, half_day: 0, wfh: 0,
    on_leave: 0, absent: 0, e: 0, holidays: 0, non_working: 0, present_pct: 0,
  }

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const eff = deriveDayStatus(dateStr, recordByDate.get(dateStr), holidaySet, nonWorkingSet, today)
    if (eff === null) continue
    if (eff === 'non_working') { stats.non_working++; continue } // excluded entirely — unpaid, not worked
    if (eff === 'holiday') { stats.holidays++; stats.working_days++; continue } // paid — counts toward working days
    // Working day
    stats.working_days++
    if (eff === 'on_leave') stats.on_leave++
    else if (eff in stats) (stats as unknown as Record<string, number>)[eff]++
  }

  // Present percentage excludes approved leave days from the denominator.
  // Holidays are credited as full paid days, same weight as Present.
  const denominator = stats.working_days - stats.on_leave
  const credited = stats.present + stats.late + stats.wfh + stats.half_day * 0.5 + stats.e + stats.holidays
  stats.present_pct = denominator > 0 ? Math.round((credited / denominator) * 100) : 0
  return stats
}

// ============================================
// All-student attendance report
// (present + irregular, optionally per-homeroom)
// ============================================

/** One student's status for one day, as the report lists it. */
export interface StudentAttendanceEntry {
  student: UserProfile
  status: AttendanceStatus
  homeroom_id: string
  homeroom_name?: string
}

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
  class_teacher: HomeroomClassTeacher | null
  present: number
  absent: number
  /** Every recorded status that is neither present nor absent (late, on leave, …). */
  irregular: number
  /** present + absent + irregular — 0 when the sheet hasn't been marked yet. */
  marked: number
}

interface HomeroomTallyRow {
  homeroom_id: string
  present: number
  absent: number
  irregular: number
}

/**
 * Per-homeroom tallies for a date, counted in the database.
 *
 * This used to pull every attendance row for the homerooms on screen — paged
 * 1000 at a time past PostgREST's response cap — purely to add three numbers
 * per homeroom in the browser. `homeroom_attendance_counts` returns one row
 * per homeroom instead, so a whole-school page moves ~30 rows rather than the
 * whole day's roster. SECURITY INVOKER, so RLS still applies.
 */
async function fetchHomeroomTallies(
  date: string,
  homeroomIds: string[]
): Promise<HomeroomTallyRow[]> {
  if (homeroomIds.length === 0) return []
  const { data, error } = await supabase.rpc('homeroom_attendance_counts', {
    p_date: date,
    p_homeroom_ids: homeroomIds,
  })
  if (error) {
    console.error('fetchHomeroomTallies error:', error)
    return []
  }
  return (data ?? []) as HomeroomTallyRow[]
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
      .select(
        'id, name, grade, section, class_teacher:profiles!homerooms_class_teacher_id_fkey(id, full_name, email, avatar_url)',
        { count: 'exact' }
      )
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

  // Late and on-duty count as present, on leave counts as absent — matching
  // the student-wise report's split. Only half day (and the rarely-used
  // "excused") remain genuinely irregular. That split lives in the RPC now.
  const tallies = await fetchHomeroomTallies(date, homerooms.map(h => h.id))
  const tallyById = new Map(tallies.map(t => [t.homeroom_id, t]))

  const rows: HomeroomAttendanceCounts[] = homerooms.map(h => {
    const t = tallyById.get(h.id) ?? { present: 0, absent: 0, irregular: 0 }
    return {
      homeroom_id: h.id,
      homeroom_name: h.name as string,
      grade: (h.grade as number | null) ?? null,
      section: (h.section as string | null) ?? null,
      class_teacher: normalizeClassTeacher(h.class_teacher),
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
export function resolveLateCutoff(
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

/** Sibling to resolveLateCutoff, resolving checkout_cutoff instead. */
function resolveCheckoutCutoff(
  timings: DayTimingGroup[],
  staffId: string,
  fallback: string | null
): string | null {
  const dateRules = timings.filter(t => t.scope_type === 'date')
  const weekdayRules = timings.filter(t => t.scope_type === 'weekday')
  for (const pool of [dateRules, weekdayRules]) {
    const override = pool.find(t => !t.is_default && t.staff_ids.includes(staffId))
    if (override) return override.checkout_cutoff
  }
  for (const pool of [dateRules, weekdayRules]) {
    const everyone = pool.find(t => t.is_default)
    if (everyone) return everyone.checkout_cutoff
  }
  return fallback
}

export interface AttendanceTimingDelta {
  /** Minutes the check-in landed past the effective late cutoff. 0 if not late / no cutoff. */
  lateByMinutes: number
  /** Minutes the checkout landed before the effective checkout cutoff. 0 if not early / no cutoff. */
  earlyByMinutes: number
}

/**
 * For every 'late' or 'half_day' record given, how late the check-in was past
 * the effective late cutoff, and/or how early the checkout was before the
 * effective checkout cutoff — reusing the same per-date day-timing resolution
 * and zone-aware minute math as fetchLateSummaryReport. Keyed
 * `${staff_id}|${date}`. Used by payroll to apply a late/half-day grace period
 * against the cutoff that actually applied to that staff member that day.
 */
export async function fetchAttendanceTimingDeltas(
  records: Pick<StaffAttendanceRecord, 'staff_id' | 'date' | 'status' | 'check_in_time' | 'check_out_time'>[]
): Promise<Map<string, AttendanceTimingDelta>> {
  const relevant = records.filter(r => r.status === 'late' || r.status === 'half_day')
  if (relevant.length === 0) return new Map()

  // A month of payroll asks about ~30 distinct dates, and resolving each one
  // through fetchDayTimingsForDate would re-read the *weekday* rules 30 times
  // over — there are only ever seven of those. Splitting the two scopes and
  // reading each weekday once is the same set of rules for the same dates,
  // for roughly half the round trips; on a screen that already makes over a
  // hundred, and in a browser that runs six at a time, that is the difference
  // between slow and timing out.
  const uniqueDates = [...new Set(relevant.map(r => r.date))]
  const weekdayOf = (d: string) => new Date(d + 'T12:00:00').getDay()
  const uniqueWeekdays = [...new Set(uniqueDates.map(weekdayOf))]

  const [globalConfig, dateRuleSets, weekdayRuleSets, timezone] = await Promise.all([
    fetchAttendanceConfig(),
    Promise.all(uniqueDates.map(d => fetchDayTimingsByScope({ type: 'date', date: d }))),
    Promise.all(uniqueWeekdays.map(w => fetchDayTimingsByScope({ type: 'weekday', weekday: w }))),
    fetchAttendanceTimezone(),
  ])

  // Date rules first, then the weekday's — the same order fetchDayTimingsForDate
  // concatenates them in, which is what resolveLateCutoff's precedence expects.
  const rulesByWeekday = new Map(uniqueWeekdays.map((w, i) => [w, weekdayRuleSets[i]]))
  const timingsByDate = new Map(uniqueDates.map((d, i) => [
    d, [...dateRuleSets[i], ...(rulesByWeekday.get(weekdayOf(d)) ?? [])],
  ]))

  const out = new Map<string, AttendanceTimingDelta>()
  for (const r of relevant) {
    const timings = timingsByDate.get(r.date) ?? []
    let lateByMinutes = 0
    let earlyByMinutes = 0

    if (r.status === 'late' && r.check_in_time) {
      const cutoff = resolveLateCutoff(timings, r.staff_id, globalConfig.late_cutoff)
      const cutoffMinutes = minutesFromCutoff(cutoff)
      if (cutoffMinutes !== null) {
        const checkInMinutes = minuteOfDayInZone(new Date(r.check_in_time), timezone)
        lateByMinutes = Math.max(0, checkInMinutes - cutoffMinutes)
      }
    }

    if (r.status === 'half_day' && r.check_out_time) {
      const cutoff = resolveCheckoutCutoff(timings, r.staff_id, globalConfig.checkout_cutoff)
      const cutoffMinutes = minutesFromCutoff(cutoff)
      if (cutoffMinutes !== null) {
        const checkOutMinutes = minuteOfDayInZone(new Date(r.check_out_time), timezone)
        earlyByMinutes = Math.max(0, cutoffMinutes - checkOutMinutes)
      }
    }

    out.set(`${r.staff_id}|${r.date}`, { lateByMinutes, earlyByMinutes })
  }
  return out
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

  const [globalConfig, timingsPerDate, detailsMap, timezone] = await Promise.all([
    fetchAttendanceConfig(),
    Promise.all(uniqueDates.map(d => fetchDayTimingsForDate(d))),
    fetchStaffDetailsMap(uniqueStaffIds),
    fetchAttendanceTimezone(),
  ])
  const timingsByDate = new Map(uniqueDates.map((d, i) => [d, timingsPerDate[i]]))

  const rows = records.map(r => {
    const staff = r.staff as UserProfile
    const cutoff = resolveLateCutoff(timingsByDate.get(r.date) ?? [], r.staff_id, globalConfig.late_cutoff)
    const cutoffMinutes = minutesFromCutoff(cutoff)
    let lateByMinutes = 0
    if (cutoffMinutes !== null && r.check_in_time) {
      // Read in the school's zone, not the reader's device zone — the same
      // stored timestamp otherwise reports a different arrival time depending
      // on who opens the report. The cutoff minute counts as on time, so a
      // check-in inside it is 0 minutes late.
      const checkInMinutes = minuteOfDayInZone(new Date(r.check_in_time), timezone)
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
