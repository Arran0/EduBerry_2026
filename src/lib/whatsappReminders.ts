import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp reminders — the browser's side.
//
// Three places a school messages families: an absent student, an
// announcement, a child who has not come to the bus. Every list here comes
// from a wa_* RPC that decides scope and reachability in the database, and
// every send goes through /api/whatsapp/reminders/send, which queues on the
// outbox (one message per student per fact, enforced by its dedupe key) and
// sends straight away. See supabase-migrations/whatsapp_reminders_r1.sql.
// ─────────────────────────────────────────────────────────────────────────────

export type ReminderKind = 'attendance_absent' | 'announcement' | 'bus_not_arrived'
export type ScheduleKind = 'attendance_absent' | 'bus_inbound' | 'bus_outbound'

/** What every listed student carries: can they be reached, and what has gone to them. */
export interface ReminderState {
  contactable: boolean
  /** Last four digits only. */
  masked: string | null
  reminded_at: string | null
  /** The outbox status for this fact, or null when nothing has been queued. */
  delivery: string | null
  last_error: string | null
}

export interface AbsenteeRow extends ReminderState {
  student_id: string
  full_name: string
  homeroom_id: string
  homeroom_name: string
  grade: number | null
  section: string | null
}

export interface AnnouncementRecipientRow extends ReminderState {
  student_id: string
  full_name: string
  grade: number | null
  section: string | null
}

export interface BusCandidateRow extends ReminderState {
  run_id: string
  route_id: string
  route_name: string
  direction: 'inbound' | 'outbound'
  run_status: string
  scheduled_start_at: string
  /** Riders on this trip already marked aboard — 0 means the route may not be running. */
  boarded: number
  /** Riders on this trip not yet aboard. */
  waiting: number
  student_id: string
  full_name: string
  grade: number | null
  section: string | null
  state: 'expected' | 'absent' | 'no_show'
  stop_name: string | null
}

export interface ReminderLogRow {
  id: number
  student_id: string
  full_name: string
  subject_id: string | null
  service_date: string
  trigger: 'manual' | 'scheduled'
  masked: string | null
  sent_by_name: string | null
  created_at: string
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  failed_at: string | null
  skipped_at: string | null
  error: string | null
}

export interface ReminderSchedule {
  kind: ScheduleKind
  enabled: boolean
  /** 'HH:MM:SS' from Postgres. */
  send_at: string
  /** 0 = Sunday. */
  days: number[]
  last_run_on: string | null
}

export interface WaTemplate {
  key: string
  provider_template_name: string | null
  provider_template_lang: string | null
  variable_order: string[] | null
  title_template: string | null
  body_template: string | null
  active: boolean
}

export interface SendResult {
  queued: number
  considered: number
  skipped: Record<string, number>
  /** How many the send route's own pass delivered to Meta before answering. */
  sent: number
  note?: string
}

export interface ReminderStatus {
  /** Phone number id and access token are both saved. */
  connected: boolean
  /** The database knows where the sender lives, so the timer can reach it. */
  drainReady: boolean
}

/** Told, or about to be. A failed or skipped one may be sent again. */
export function alreadyReminded(r: ReminderState): boolean {
  return !!r.delivery && ['queued', 'sending', 'sent', 'delivered'].includes(r.delivery)
}

/** Whether a row can be ticked right now. */
export function canPick(r: ReminderState): boolean {
  return r.contactable && !alreadyReminded(r)
}

export const SKIP_REASONS: Record<string, string> = {
  not_absent: 'no longer marked absent',
  not_your_class: 'not in your classes',
  on_leave: 'on leave',
  no_contact_or_opted_out: 'no WhatsApp number on file, or the family replied STOP',
  already_reminded: 'already reminded — one message per student',
  not_in_audience: 'not in this announcement’s audience',
  boarded_or_excused: 'already on the bus, or excused',
  trip_not_running: 'that trip is not running',
  unknown: 'for another reason',
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {})
  if (error) throw new Error(error.message)
  return data as T
}

export const fetchAbsentees = () => rpc<AbsenteeRow[]>('wa_attendance_absentees')

export const fetchAnnouncementRecipients = (announcementId: string) =>
  rpc<AnnouncementRecipientRow[]>('wa_announcement_recipients', { p_announcement: announcementId })

export const fetchBusCandidates = () => rpc<BusCandidateRow[]>('wa_bus_candidates')

export const fetchReminderLog = (kind: ReminderKind, subjectId?: string | null) =>
  rpc<ReminderLogRow[]>('wa_reminder_log_recent', { p_kind: kind, p_subject: subjectId ?? null })

export async function fetchSchedules(kinds: ScheduleKind[]): Promise<ReminderSchedule[]> {
  const { data, error } = await supabase
    .from('wa_reminder_schedules')
    .select('kind, enabled, send_at, days, last_run_on')
    .in('kind', kinds)
  if (error) throw new Error(error.message)
  return (data ?? []) as ReminderSchedule[]
}

export const saveSchedule = (s: Pick<ReminderSchedule, 'kind' | 'enabled' | 'send_at' | 'days'>) =>
  rpc<ReminderSchedule>('wa_save_schedule', {
    p_kind: s.kind, p_enabled: s.enabled, p_send_at: s.send_at.slice(0, 5), p_days: s.days,
  })

export const fetchTemplates = (prefix: 'attendance.absent_not_arrived' | 'announcement.' | 'transport.bus_not_arrived') =>
  rpc<WaTemplate[]>('wa_templates', { p_prefix: prefix })

export const saveTemplate = (t: {
  key: string; name: string; lang?: string; active: boolean; title?: string | null; body?: string | null
}) =>
  rpc<null>('wa_save_template', {
    p_key: t.key, p_name: t.name, p_lang: t.lang ?? 'en', p_active: t.active,
    p_title: t.title ?? null, p_body: t.body ?? null,
  })

async function authed(path: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('You are signed out. Sign in again and retry.')
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...(init?.headers ?? {}) },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json
}

export async function fetchReminderStatus(): Promise<ReminderStatus> {
  const json = await authed('/api/whatsapp/reminders/status')
  return { connected: !!json.connected, drainReady: !!json.drainReady }
}

export type SendRequest =
  | { kind: 'attendance'; student_ids: string[] }
  | { kind: 'announcement'; announcement_id: string; student_ids: string[]; template?: string }
  | { kind: 'bus'; runs: { run_id: string; student_ids: string[] }[] }

export async function sendReminders(body: SendRequest): Promise<SendResult> {
  const json = await authed('/api/whatsapp/reminders/send', { method: 'POST', body: JSON.stringify(body) })
  return {
    queued: json.queued ?? 0, considered: json.considered ?? 0,
    skipped: json.skipped ?? {}, sent: json.sent ?? 0, note: json.note,
  }
}

// ── Template text ────────────────────────────────────────────────────────

/** Example values shown beside a template, and in the preview. */
export const SAMPLE_VARS: Record<string, string> = {
  school: 'Muthamil Public School',
  student: 'Aarav Kumar',
  time: '9:30 AM',
  route: 'R4 · Anna Nagar',
  title: 'Sports Day on Friday',
  summary: 'Students should come in sports uniform by 8:00 AM.',
}

/** `{{name}}` filled from values; unknown names left as they are. */
export function renderTemplate(body: string | null | undefined, vars: Record<string, string>): string {
  return (body ?? '').replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m)
}

/**
 * The body as WhatsApp Manager wants it typed: `{{student}}` becomes `{{2}}`
 * when student is the second entry in variable_order. That order is the
 * contract — the sender fills {{1}}, {{2}}… from it.
 */
export function toMetaBody(body: string | null | undefined, order: string[] | null | undefined): string {
  const pos = new Map((order ?? []).map((k, i) => [k, i + 1]))
  return (body ?? '').replace(/\{\{(\w+)\}\}/g, (m, k: string) => (pos.has(k) ? `{{${pos.get(k)}}}` : m))
}

/** "09:30:00" → "9:30 AM". */
export function clock(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const hh = ((h + 11) % 12) + 1
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
