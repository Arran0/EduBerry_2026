// ─────────────────────────────────────────────────────────────────────────────
// Concessions, fines, late fees and reminders — client side.
//
// Every write goes through an RPC or an API route, because each one has to
// touch several tables in one transaction: a concession writes a row, an
// invoice line and a ledger entry, and a half-applied concession is a bill
// nobody can explain.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, isMissingRelation, authHeader } from '@/lib/supabase'
import type { LateFeeRule } from './engine/latefee'
import { toPaise } from './engine/money'

// ── Rows ────────────────────────────────────────────────────────────────
export interface DiscountTypeRow {
  id: string
  academic_year_id: string
  name: string
  code: string
  mode: 'fixed' | 'percent'
  value: number
  scope: 'all' | 'heads'
  head_ids: string[]
  stackable: boolean
  auto_rule: 'none' | 'sibling' | 'staff_ward' | 'early_payment'
  auto_config: Record<string, unknown>
  approval_threshold: number | null
  active: boolean
  notes: string | null
}

export interface ScholarshipRow {
  id: string
  academic_year_id: string
  name: string
  code: string
  funder: string | null
  annual_budget: number | null
  seats: number | null
  active: boolean
  awarded?: number
  recipients?: number
  remaining?: number | null
}

export interface ConcessionRow {
  id: string
  student_id: string
  academic_year_id: string
  kind: 'discount' | 'scholarship' | 'waiver'
  type_id: string | null
  scholarship_id: string | null
  invoice_id: string | null
  amount: number
  reason: string | null
  status: 'pending' | 'approved' | 'declined' | 'applied' | 'removed'
  requested_by: string | null
  approved_by: string | null
  approved_at: string | null
  decline_reason: string | null
  removal_reason: string | null
  created_at: string
}

export interface FineCategoryRow {
  id: string; name: string; code: string; default_amount: number; active: boolean; sort: number
}

export interface FineRow {
  id: string
  student_id: string
  academic_year_id: string
  category_id: string | null
  invoice_id: string | null
  amount: number
  reason: string | null
  status: 'applied' | 'waived' | 'removed'
  waived_amount: number | null
  waive_reason: string | null
  created_at: string
}

export interface LateFeeRuleRow {
  id: string
  academic_year_id: string
  name: string
  scope: 'all' | 'group' | 'structure' | 'installment'
  scope_id: string | null
  grace_days: number
  charge_type: 'flat' | 'percent'
  rate: number
  frequency: 'once' | 'daily' | 'weekly' | 'monthly'
  basis: 'whole' | 'unpaid'
  cap_amount: number | null
  cap_percent: number | null
  enabled: boolean
  enabled_from: string | null
  notes: string | null
}

export interface LateFeeChargeRow {
  id: string
  invoice_id: string
  rule_id: string | null
  as_of: string
  days_late: number
  amount: number
  status: 'charged' | 'waived' | 'recalculated'
  waive_reason: string | null
}

export interface ReminderLogRow {
  id: number
  student_id: string
  invoice_id: string | null
  channel: string
  template_key: string | null
  msisdn: string | null
  balance_then: number | null
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  failed_at: string | null
  paid_at: string | null
  created_at: string
}

function empty<T>(error: { code?: string; message?: string } | null, fallback: T): T {
  if (isMissingRelation(error)) return fallback
  throw error
}

/** Database row → the engine's own shape, in paise. */
export function toEngineRule(row: LateFeeRuleRow): LateFeeRule {
  return {
    id: row.id,
    name: row.name,
    graceDays: row.grace_days,
    chargeType: row.charge_type,
    rate: Number(row.rate),
    frequency: row.frequency,
    basis: row.basis,
    capAmount: row.cap_amount === null ? null : toPaise(row.cap_amount),
    capPercent: row.cap_percent === null ? null : Number(row.cap_percent),
    enabled: row.enabled,
    enabledFrom: row.enabled_from,
  }
}

// ── Reads ───────────────────────────────────────────────────────────────
export async function fetchDiscountTypes(yearId: string): Promise<DiscountTypeRow[]> {
  const { data, error } = await supabase.from('fee_discount_types')
    .select('*').eq('academic_year_id', yearId).order('name')
  if (error) return empty(error, [])
  return (data ?? []) as DiscountTypeRow[]
}

export async function fetchScholarships(yearId: string): Promise<ScholarshipRow[]> {
  const { data, error } = await supabase.from('fee_scholarship_budgets')
    .select('*').eq('academic_year_id', yearId).order('name')
  if (error) return empty(error, [])
  return (data ?? []) as ScholarshipRow[]
}

export async function fetchConcessions(filter: {
  yearId: string; studentId?: string; status?: ConcessionRow['status'][]
}): Promise<ConcessionRow[]> {
  let q = supabase.from('fee_concessions').select('*')
    .eq('academic_year_id', filter.yearId)
    .order('created_at', { ascending: false })
  if (filter.studentId) q = q.eq('student_id', filter.studentId)
  if (filter.status?.length) q = q.in('status', filter.status)
  const { data, error } = await q
  if (error) return empty(error, [])
  return (data ?? []) as ConcessionRow[]
}

export async function fetchFineCategories(): Promise<FineCategoryRow[]> {
  const { data, error } = await supabase.from('fee_fine_categories')
    .select('*').eq('active', true).order('sort')
  if (error) return empty(error, [])
  return (data ?? []) as FineCategoryRow[]
}

export async function fetchFines(yearId: string, studentId?: string): Promise<FineRow[]> {
  let q = supabase.from('fee_fines').select('*').eq('academic_year_id', yearId)
    .order('created_at', { ascending: false })
  if (studentId) q = q.eq('student_id', studentId)
  const { data, error } = await q
  if (error) return empty(error, [])
  return (data ?? []) as FineRow[]
}

export async function fetchLateFeeRules(yearId: string): Promise<LateFeeRuleRow[]> {
  const { data, error } = await supabase.from('fee_late_fee_rules')
    .select('*').eq('academic_year_id', yearId).order('name')
  if (error) return empty(error, [])
  return (data ?? []) as LateFeeRuleRow[]
}

export async function fetchLateFeeCharges(invoiceIds: string[]): Promise<LateFeeChargeRow[]> {
  if (invoiceIds.length === 0) return []
  const { data, error } = await supabase.from('fee_late_fee_charges')
    .select('*').in('invoice_id', invoiceIds).order('as_of', { ascending: false })
  if (error) return empty(error, [])
  return (data ?? []) as LateFeeChargeRow[]
}

export async function fetchReminderLog(filter: {
  studentId?: string; invoiceId?: string; limit?: number
}): Promise<ReminderLogRow[]> {
  let q = supabase.from('fee_reminder_log').select('*')
    .order('created_at', { ascending: false }).limit(filter.limit ?? 200)
  if (filter.studentId) q = q.eq('student_id', filter.studentId)
  if (filter.invoiceId) q = q.eq('invoice_id', filter.invoiceId)
  const { data, error } = await q
  if (error) return empty(error, [])
  return (data ?? []) as ReminderLogRow[]
}

// ── Writes ──────────────────────────────────────────────────────────────
export async function saveDiscountType(
  patch: Partial<DiscountTypeRow> & { academic_year_id: string; name: string; code: string },
): Promise<void> {
  const { error } = await supabase.from('fee_discount_types')
    .upsert(patch, { onConflict: 'academic_year_id,code' })
  if (error) throw error
}

export async function saveScholarship(
  patch: Partial<ScholarshipRow> & { academic_year_id: string; name: string; code: string },
): Promise<void> {
  const { awarded, recipients, remaining, ...row } = patch as Record<string, unknown>
  void awarded; void recipients; void remaining
  const { error } = await supabase.from('fee_scholarships')
    .upsert(row, { onConflict: 'academic_year_id,code' })
  if (error) throw error
}

export interface ApplyConcessionResult {
  concession_id: string
  status: string
  needs_approval: boolean
  label: string
}

export async function applyConcession(input: {
  invoice_id: string
  kind: 'discount' | 'scholarship' | 'waiver'
  amount: number
  type_id?: string | null
  scholarship_id?: string | null
  fee_head_id?: string | null
  reason?: string
  label?: string
}): Promise<ApplyConcessionResult> {
  const { data, error } = await supabase.rpc('fee_apply_concession', {
    p_invoice: input.invoice_id,
    p_kind: input.kind,
    p_amount: input.amount,
    p_type: input.type_id ?? null,
    p_scholarship: input.scholarship_id ?? null,
    p_head: input.fee_head_id ?? null,
    p_reason: input.reason ?? null,
    p_label: input.label ?? null,
    p_actor: null,
  })
  if (error) throw error
  return data as ApplyConcessionResult
}

export async function decideConcession(id: string, approve: boolean, note?: string) {
  const { data, error } = await supabase.rpc('fee_decide_concession', {
    p_concession: id, p_approve: approve, p_note: note ?? null, p_actor: null,
  })
  if (error) throw error
  return data as { status: string }
}

export async function removeConcession(id: string, reason: string, moveTo?: string) {
  const { data, error } = await supabase.rpc('fee_remove_concession', {
    p_concession: id, p_reason: reason, p_move_to: moveTo ?? null,
  })
  if (error) throw error
  return data as { status: string; from?: string; to?: string }
}

export async function addFine(input: {
  student_id: string
  academic_year_id: string
  amount: number
  category_id?: string | null
  reason?: string
  /** Null raises its own slip rather than adding to an existing bill. */
  invoice_id?: string | null
  due_date?: string
}) {
  const { data, error } = await supabase.rpc('fee_add_fine', {
    p_student: input.student_id,
    p_year: input.academic_year_id,
    p_amount: input.amount,
    p_category: input.category_id ?? null,
    p_reason: input.reason ?? null,
    p_invoice: input.invoice_id ?? null,
    p_due_date: input.due_date ?? null,
  })
  if (error) throw error
  return data as { fine_id: string; invoice_id: string; own_slip: boolean; number: string }
}

export async function waiveFine(id: string, reason: string, amount?: number) {
  const { data, error } = await supabase.rpc('fee_waive_fine', {
    p_fine: id, p_reason: reason, p_amount: amount ?? null,
  })
  if (error) throw error
  return data as { waived: number; full: boolean }
}

export async function saveLateFeeRule(
  patch: Partial<LateFeeRuleRow> & { academic_year_id: string; name: string },
): Promise<LateFeeRuleRow> {
  // `enabled` and `enabled_from` are deliberately not writable here — they go
  // through the RPC, which can only ever stamp today. A client that could set
  // an earlier date could back-charge a whole term.
  const { enabled, enabled_from, ...row } = patch as Record<string, unknown>
  void enabled; void enabled_from
  const { data, error } = await supabase.from('fee_late_fee_rules')
    .upsert(row).select().single()
  if (error) throw error
  return data as LateFeeRuleRow
}

export async function setLateFeeRuleEnabled(id: string, enabled: boolean) {
  const { data, error } = await supabase.rpc('fee_set_late_fee_rule_enabled', {
    p_rule: id, p_enabled: enabled,
  })
  if (error) throw error
  return data as { enabled: boolean; from: string }
}

export interface SweepResult {
  committed: boolean
  as_of: string
  bills: number
  total: number
  exempt: number
  by_class: Record<string, number>
}

export async function runLateFeeSweep(
  yearId: string, commit = false, asOf?: string,
): Promise<SweepResult> {
  const { data, error } = await supabase.rpc('fee_late_fee_sweep', {
    p_year: yearId, p_commit: commit, p_as_of: asOf ?? null,
  })
  if (error) throw error
  return data as SweepResult
}

export async function waiveLateFee(chargeId: string, reason: string) {
  const { data, error } = await supabase.rpc('fee_waive_late_fee', {
    p_charge: chargeId, p_reason: reason,
  })
  if (error) throw error
  return data as { status: string }
}

export async function setLateFeeExemption(
  invoiceId: string, exempt: boolean, reason?: string,
): Promise<void> {
  if (!exempt) {
    const { error } = await supabase.from('fee_late_fee_exemptions')
      .delete().eq('invoice_id', invoiceId)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('fee_late_fee_exemptions')
    .upsert({ invoice_id: invoiceId, reason: reason ?? null }, { onConflict: 'invoice_id' })
  if (error) throw error
}

// ── Reminders ───────────────────────────────────────────────────────────
export interface SendRemindersResult {
  queued: number
  considered: number
  skipped: Record<string, number>
}

/**
 * Queue reminders for a set of bills.
 *
 * Through the API route rather than the RPC directly, so one request covers a
 * whole class instead of the browser waiting on forty sequential calls.
 */
export async function sendReminders(
  invoiceIds: string[], template?: string, notBefore?: string,
): Promise<SendRemindersResult> {
  const res = await fetch('/api/fees/reminders/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ invoice_ids: invoiceIds, template, not_before: notBefore }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || 'Could not queue those reminders.')
  }
  return json as SendRemindersResult
}

/** Why a reminder was skipped, in words the office can act on. */
export const SKIP_REASONS: Record<string, string> = {
  already_settled: 'already paid',
  no_contact_or_opted_out: 'no number on file, or opted out',
  already_sent_today: 'already reminded today',
  error: 'could not be queued',
  unknown: 'skipped',
}

// ── Reminder schedules ──────────────────────────────────────────────────
export interface ReminderScheduleRow {
  id: string
  academic_year_id: string
  name: string
  enabled: boolean
  /** Days relative to the due date; negative is before it. */
  offsets: number[]
  send_at: string
  channels: string[]
  skip_if_paid: boolean
  /** 0 is Sunday. Days the school does not want messages going out. */
  quiet_days: number[]
}

export async function fetchReminderSchedules(yearId: string): Promise<ReminderScheduleRow[]> {
  const { data, error } = await supabase.from('fee_reminder_schedules')
    .select('*').eq('academic_year_id', yearId).order('name')
  if (error) return empty(error, [])
  return (data ?? []) as ReminderScheduleRow[]
}

export async function saveReminderSchedule(
  patch: Partial<ReminderScheduleRow> & { academic_year_id: string; name: string },
): Promise<void> {
  const { error } = await supabase.from('fee_reminder_schedules').upsert(patch)
  if (error) throw error
}

/**
 * Which students can be messaged at all, for the collections list.
 *
 * The same fallback chain as `fee_contact_msisdn`: an opted-in WhatsApp number
 * first, then the guardian's phone, then the student's own. Computed here in
 * two queries rather than one RPC per row, and used only to grey out a Remind
 * button — the server decides for real when the send happens.
 */
export async function fetchContactableStudents(studentIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const hasDigits = (v: unknown) => typeof v === 'string' && /\d/.test(v)

  for (let i = 0; i < studentIds.length; i += 300) {
    const slice = studentIds.slice(i, i + 300)

    const { data: numbers, error: numbersError } = await supabase.from('whatsapp_numbers')
      .select('student_id, msisdn, opt_out_at').in('student_id', slice)
    if (numbersError) return empty(numbersError, out)

    // An opted-out number is not a contact, and it is the only number on file
    // for that student unless another row says otherwise.
    const optedOut = new Set<string>()
    ;(numbers ?? []).forEach(r => {
      const row = r as { student_id: string; msisdn: string | null; opt_out_at: string | null }
      if (row.opt_out_at) optedOut.add(row.student_id)
      else if (hasDigits(row.msisdn)) out.add(row.student_id)
    })

    const { data: details, error: detailsError } = await supabase.from('student_details')
      .select('student_id, guardian_phone, phone').in('student_id', slice)
    if (detailsError) return empty(detailsError, out)
    ;(details ?? []).forEach(r => {
      const row = r as { student_id: string; guardian_phone: string | null; phone: string | null }
      if (optedOut.has(row.student_id)) return
      if (hasDigits(row.guardian_phone) || hasDigits(row.phone)) out.add(row.student_id)
    })
  }
  return out
}
