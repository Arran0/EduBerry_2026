import { supabase } from './supabase'
import type { AttendanceStatus } from './attendance'
import type { LeaveStatus, LeaveType } from './leave'

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp for the student attendance report.
//
// The report answers "who was absent today". This answers the question the
// office asks straight afterwards: "have their parents been told". Both the
// hand-picked bulk send and the automatic morning run go through the same two
// database functions, so a message sent by a clerk and one sent by the
// scheduler are indistinguishable downstream — same outbox, same dedupe key,
// same log row.
//
// Nothing here talks to Meta. Queueing is all the browser does; the outbox
// drain (src/app/api/attendance/cron/drain/route.ts) does the sending, which is
// what makes "message this whole class" one fast request instead of forty
// sequential HTTPS calls the user watches.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a student's day amounts to, once the approved leave behind the mark is
 * taken into account.
 *
 * This is deliberately not the same list as AttendanceStatus: 'absent' with an
 * approved medical leave attached is not the same thing to tell a parent as a
 * bare 'absent', and the whole value of this layer is that it never conflates
 * the two. Resolved in SQL by attendance_message_kind() so the automatic run
 * and the popup cannot drift apart.
 */
export type MessageKind =
  | 'absent' | 'late' | 'half_day' | 'excused' | 'leave'
  | 'leave_casual' | 'leave_medical' | 'on_duty'
  | 'late_permit' | 'half_day_permit'

export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  absent:          'Absent',
  late:            'Late',
  half_day:        'Half day',
  excused:         'Excused',
  leave:           'On leave',
  leave_casual:    'Casual leave (CL)',
  leave_medical:   'Medical leave (ML)',
  on_duty:         'On duty (OD)',
  late_permit:     'Late permit',
  half_day_permit: 'Half day permit',
}

/** Pill classes per kind, matching the report's own status colours. */
export const MESSAGE_KIND_PILL: Record<MessageKind, string> = {
  absent:          'bg-red-50 text-red-700 border-red-200',
  late:            'bg-amber-50 text-amber-700 border-amber-200',
  half_day:        'bg-orange-50 text-orange-700 border-orange-200',
  excused:         'bg-purple-50 text-purple-700 border-purple-200',
  leave:           'bg-blue-50 text-blue-700 border-blue-200',
  leave_casual:    'bg-blue-50 text-blue-700 border-blue-200',
  leave_medical:   'bg-sky-50 text-sky-700 border-sky-200',
  on_duty:         'bg-violet-50 text-violet-700 border-violet-200',
  late_permit:     'bg-amber-50 text-amber-700 border-amber-200',
  half_day_permit: 'bg-orange-50 text-orange-700 border-orange-200',
}

/** The kinds that exist because somebody applied and the school approved it. */
export const APPROVED_LEAVE_KINDS: MessageKind[] = [
  'leave_casual', 'leave_medical', 'on_duty', 'late_permit', 'half_day_permit', 'leave',
]

export function isApprovedLeaveKind(kind: MessageKind | null): boolean {
  return kind !== null && APPROVED_LEAVE_KINDS.includes(kind)
}

export const templateForKind = (kind: MessageKind): string => `attendance_${kind}`

/** One row of the bulk list, exactly as attendance_message_candidates returns it. */
export interface MessageCandidate {
  student_id: string
  full_name: string
  email: string | null
  avatar_url: string | null
  grade: number | null
  section: string | null
  homeroom_id: string | null
  homeroom_name: string | null
  status: AttendanceStatus | null
  kind: MessageKind | null
  template_key: string | null
  leave_type: LeaveType | null
  leave_status: LeaveStatus | null
  /** Last four digits only. The full number never reaches the browser. */
  msisdn_tail: string | null
  contactable: boolean
  opted_out: boolean
  /** A message for this student, this date and this template already went. */
  already_sent: boolean
}

export interface CandidateFilters {
  date: string
  homeroomIds?: string[] | null
  grades?: number[] | null
  sections?: string[] | null
  /** Attendance statuses, not kinds — this filters the mark, before leave is
   *  taken into account, which is what the report's own tabs do. */
  statuses?: AttendanceStatus[] | null
  limit?: number
}

function emptyish<T>(v: T[] | null | undefined): T[] | null {
  return v && v.length > 0 ? v : null
}

export async function fetchMessageCandidates(f: CandidateFilters): Promise<MessageCandidate[]> {
  const { data, error } = await supabase.rpc('attendance_message_candidates', {
    p_date: f.date,
    p_homeroom_ids: emptyish(f.homeroomIds),
    p_grades: emptyish(f.grades),
    p_sections: emptyish(f.sections),
    p_statuses: emptyish(f.statuses),
    p_limit: f.limit ?? 500,
  })
  if (error) {
    console.error('fetchMessageCandidates error:', error)
    throw new Error(error.message || 'Could not load the list.')
  }
  return (data ?? []) as MessageCandidate[]
}

export const STUDENT_SEARCH_MIN_CHARS = 2

/**
 * Typeahead for adding one student to the list by hand.
 *
 * Searches the whole school by name, email, admission number or roll number —
 * for a class teacher, their own students only, enforced in the database rather
 * than here. A student with no record for the date comes back with a null
 * status, which the popup shows as "nothing recorded" rather than hiding: a
 * missing mark is a real answer to "has anyone told this family".
 */
export async function searchStudentsForMessage(
  query: string, date: string, limit = 12,
): Promise<MessageCandidate[]> {
  if (query.trim().length < STUDENT_SEARCH_MIN_CHARS) return []
  const { data, error } = await supabase.rpc('attendance_student_search', {
    p_query: query.trim(), p_date: date, p_limit: limit,
  })
  if (error) {
    console.error('searchStudentsForMessage error:', error)
    return []
  }
  return (data ?? []) as MessageCandidate[]
}

export interface BulkQueueResult {
  queued: number
  /** Counts keyed by reason — see SKIP_REASONS for the words to show. */
  skipped: Record<string, number>
  considered: number
}

/**
 * Queue the bulk list.
 *
 * `template` null means each student gets the template their own day resolves
 * to, which is almost always what you want: one press then tells an absent
 * family one thing and an approved-medical-leave family another. Passing a key
 * forces that one template on everybody.
 */
export async function queueAttendanceMessages(
  studentIds: string[], date: string, template?: string | null,
): Promise<BulkQueueResult> {
  const { data, error } = await supabase.rpc('attendance_bulk_queue', {
    p_students: studentIds,
    p_date: date,
    p_template: template ?? null,
    p_schedule: null,
    p_actor: null,
  })
  if (error) throw new Error(error.message || 'Those messages were not queued.')
  const r = (data ?? {}) as Partial<BulkQueueResult>
  return { queued: r.queued ?? 0, skipped: r.skipped ?? {}, considered: r.considered ?? 0 }
}

/** Why a student was skipped, in words the office can act on. */
export const SKIP_REASONS: Record<string, string> = {
  no_attendance_record:    'no attendance marked for the day',
  nothing_to_report:       'marked present — nothing to tell',
  no_such_template:        'that message is not registered yet',
  no_contact_or_opted_out: 'no number on file, or opted out',
  already_sent:            'already messaged for this day',
  out_of_scope:            'not in a class you manage',
  unknown:                 'skipped',
}

export function describeSkips(skipped: Record<string, number>): string[] {
  return Object.entries(skipped)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${SKIP_REASONS[reason] ?? SKIP_REASONS.unknown}`)
}

// ── Templates ───────────────────────────────────────────────────────────────

export interface AttendanceTemplate {
  key: string
  provider_template_name: string | null
  title_template: string | null
  body_template: string | null
  variable_order: string[] | null
  active: boolean
}

/** The attendance templates, in the order the picker should offer them. */
export const TEMPLATE_ORDER: MessageKind[] = [
  'absent', 'late', 'half_day', 'excused',
  'leave_casual', 'leave_medical', 'on_duty', 'late_permit', 'half_day_permit', 'leave',
]

export async function fetchAttendanceTemplates(): Promise<AttendanceTemplate[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('key, provider_template_name, title_template, body_template, variable_order, active')
    .eq('channel', 'whatsapp')
    .like('key', 'attendance_%')
  if (error) {
    console.error('fetchAttendanceTemplates error:', error)
    return []
  }
  const rows = (data ?? []) as AttendanceTemplate[]
  const rank = new Map(TEMPLATE_ORDER.map((k, i) => [templateForKind(k), i]))
  return rows.sort((a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99))
}

/** `{{name}}` substitution, matching render() in src/lib/notifications/templates.ts. */
export function renderTemplate(body: string | null | undefined, vars: Record<string, string>): string {
  if (!body) return ''
  return body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')
}

// ── Automation ──────────────────────────────────────────────────────────────

export interface NotifySchedule {
  id: string
  name: string
  enabled: boolean
  statuses: AttendanceStatus[]
  homeroom_ids: string[] | null
  grades: number[] | null
  sections: string[] | null
  /** 'HH:MM:SS', read in the school's timezone — not the browser's. */
  send_at: string
  /** 0 is Sunday. */
  quiet_days: number[]
  /** null = each student gets the template their own day resolves to. */
  template_key: string | null
  skip_approved_leave: boolean
  last_run_on: string | null
  last_run_at: string | null
  last_run_summary: { considered?: number; queued?: number; skipped?: Record<string, number>; skipped_reason?: string } | null
  created_at: string
}

export type NotifyScheduleInput = Omit<
  NotifySchedule, 'id' | 'last_run_on' | 'last_run_at' | 'last_run_summary' | 'created_at'
> & { id?: string }

export async function fetchNotifySchedules(): Promise<NotifySchedule[]> {
  const { data, error } = await supabase
    .from('attendance_notify_schedules')
    .select('*')
    .order('send_at')
  if (error) {
    console.error('fetchNotifySchedules error:', error)
    return []
  }
  return (data ?? []) as NotifySchedule[]
}

export async function saveNotifySchedule(input: NotifyScheduleInput): Promise<string> {
  const row = {
    name: input.name.trim() || 'Daily absentee notice',
    enabled: input.enabled,
    statuses: input.statuses.length > 0 ? input.statuses : ['absent'],
    // An empty scope array and null both mean "the whole school"; store null so
    // the SQL side has one case to handle rather than two.
    homeroom_ids: emptyish(input.homeroom_ids),
    grades: emptyish(input.grades),
    sections: emptyish(input.sections),
    send_at: input.send_at.length === 5 ? `${input.send_at}:00` : input.send_at,
    quiet_days: input.quiet_days ?? [],
    template_key: input.template_key || null,
    skip_approved_leave: input.skip_approved_leave,
  }

  if (input.id) {
    const { error } = await supabase
      .from('attendance_notify_schedules').update(row).eq('id', input.id)
    if (error) throw new Error(error.message || 'Could not save that schedule.')
    return input.id
  }

  const { data, error } = await supabase
    .from('attendance_notify_schedules').insert(row).select('id').single()
  if (error) throw new Error(error.message || 'Could not create that schedule.')
  return (data as { id: string }).id
}

export async function setNotifyScheduleEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('attendance_notify_schedules').update({ enabled }).eq('id', id)
  if (error) throw new Error(error.message || 'Could not change that schedule.')
}

export async function deleteNotifySchedule(id: string): Promise<void> {
  const { error } = await supabase.from('attendance_notify_schedules').delete().eq('id', id)
  if (error) throw new Error(error.message || 'Could not delete that schedule.')
}

// ── The log ─────────────────────────────────────────────────────────────────

export interface MessageLogRow {
  id: number
  student_id: string
  homeroom_id: string | null
  attendance_date: string
  kind: MessageKind
  template_key: string
  msisdn: string | null
  schedule_id: string | null
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  failed_at: string | null
  created_at: string
  student?: { full_name: string; avatar_url: string | null } | null
}

export async function fetchMessageLog(
  opts: { date?: string; limit?: number } = {},
): Promise<MessageLogRow[]> {
  let q = supabase
    .from('attendance_message_log')
    .select('*, student:profiles!attendance_message_log_student_id_fkey(full_name, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 200)
  if (opts.date) q = q.eq('attendance_date', opts.date)

  const { data, error } = await q
  if (error) {
    console.error('fetchMessageLog error:', error)
    return []
  }
  return (data ?? []) as MessageLogRow[]
}

/** sent → delivered → read, or failed. What the log row shows at a glance. */
export function deliveryState(
  row: Pick<MessageLogRow, 'sent_at' | 'delivered_at' | 'read_at' | 'failed_at'>,
): { label: string; className: string } {
  if (row.failed_at)    return { label: 'Failed',    className: 'bg-red-50 text-red-700 border-red-200' }
  if (row.read_at)      return { label: 'Read',      className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  if (row.delivered_at) return { label: 'Delivered', className: 'bg-sky-50 text-sky-700 border-sky-200' }
  if (row.sent_at)      return { label: 'Sent',      className: 'bg-slate-100 text-slate-600 border-slate-200' }
  return { label: 'Queued', className: 'bg-amber-50 text-amber-700 border-amber-200' }
}

// ── Can this person send at all ─────────────────────────────────────────────

export interface NotifyAccess { canSend: boolean; isManager: boolean }

export async function fetchNotifyAccess(): Promise<NotifyAccess> {
  const [may, manager] = await Promise.all([
    supabase.rpc('attendance_may_notify', { p_user: null }),
    supabase.rpc('attendance_notify_is_manager', { p_user: null }),
  ])
  return {
    canSend: may.data === true,
    isManager: manager.data === true,
  }
}

/** Whether WhatsApp is connected, so the popup can say so before anyone sends
 *  into a queue that will not drain. Reads the non-secret half only. */
export async function fetchWhatsAppReady(): Promise<boolean> {
  const { data, error } = await supabase
    .from('fee_settings')
    .select('value')
    .eq('key', 'whatsapp').eq('status', 'published').is('effective_to', null)
    .maybeSingle()
  if (error) return false
  const v = (data?.value ?? {}) as { phone_number_id?: string; credentials_saved?: boolean }
  return !!v.phone_number_id && !!v.credentials_saved
}
