// ─────────────────────────────────────────────────────────────────────────────
// The Collection Center's data layer.
//
// Every read here goes to a Round 4 view, and every one of those is
// security_invoker with its money columns wrapped in fee_visible_amount(). A
// caller without `fees.view_amounts` gets NULL from the database — the counts,
// the classes and the shape of the charts still arrive, the rupees do not. So
// nothing in this file needs to know about masking; it only has to be honest
// about a null rather than coercing it to 0.
//
// The search side is deliberately narrow. The natural-language box compiles to
// one of a fixed set of filters over known columns; there is no path from what
// a user types to SQL.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, isMissingRelation, authHeader } from '@/lib/supabase'
import { inChunks } from './chunk'

function empty<T>(error: { code?: string; message?: string } | null, fallback: T): T {
  if (isMissingRelation(error)) return fallback
  throw error
}

// ── Rows ────────────────────────────────────────────────────────────────
export interface YearSummaryRow {
  academic_year_id: string
  code: string
  starts_on: string
  ends_on: string
  /** How far through the session we are, 0–100. The efficiency bar's marker. */
  session_progress: number | null
  students: number
  bills: number
  overdue_bills: number
  gross: number | null
  late_fees: number | null
  fines: number | null
  concessions: number | null
  tax: number | null
  opening_balances: number | null
  payable: number | null
  collected: number | null
  outstanding: number | null
  refunded: number | null
  rte_claimed: number | null
  rte_reimbursed: number | null
  efficiency: number | null
}

export interface CollectionDayRow {
  academic_year_id: string
  day: string
  method: string
  receipts: number
  collected: number | null
}

export type AgingBucket =
  | 'not_yet_due' | 'd1_7' | 'd8_30' | 'd31_60' | 'd61_90' | 'd90_plus'

export const AGING_LABEL: Record<AgingBucket, string> = {
  not_yet_due: 'Not yet due',
  d1_7:        '1–7 days',
  d8_30:       '8–30 days',
  d31_60:      '31–60 days',
  d61_90:      '61–90 days',
  d90_plus:    'Over 90 days',
}

/** Left to right on the cliff — least late first. */
export const AGING_ORDER: AgingBucket[] =
  ['not_yet_due', 'd1_7', 'd8_30', 'd31_60', 'd61_90', 'd90_plus']

export interface AgingRow {
  academic_year_id: string
  bucket: AgingBucket
  bills: number
  students: number
  outstanding: number | null
}

export interface DefaulterClassRow {
  academic_year_id: string
  grade: number | null
  section: string | null
  students_owing: number
  bills: number
  worst_days_late: number | null
  outstanding: number | null
  overdue: number | null
}

export interface ConcessionSummaryRow {
  academic_year_id: string
  kind: string
  grants: number
  students: number
  given_up: number | null
  fines_charged: number | null
  fines_waived: number | null
  late_fees_charged: number | null
  late_fees_waived: number | null
}

export interface InstrumentPipelineRow {
  academic_year_id: string
  kind: string
  status: string
  instruments: number
  amount: number | null
  overdue_to_present: number
}

export interface StaffCollectionRow {
  academic_year_id: string
  staff_id: string | null
  staff_name: string | null
  month: string
  receipts: number
  collected: number | null
  cash: number | null
  reversed: number
}

export interface RefundRow {
  id: string
  student_id: string
  academic_year_id: string
  amount: number
  reason: string
  status: 'requested' | 'approved' | 'declined' | 'paid_out' | 'cancelled'
  method: string | null
  reference: string | null
  requested_by: string | null
  requested_at: string
  approved_by: string | null
  approved_at: string | null
  decline_reason: string | null
  paid_on: string | null
}

export interface RteRow {
  id: string
  student_id: string
  academic_year_id: string
  category: string
  claim_period: string | null
  claimed_amount: number
  reimbursed_amount: number
  reimbursed_on: string | null
  government_ref: string | null
  status: 'enrolled' | 'claimed' | 'part_reimbursed' | 'reimbursed' | 'rejected'
  notes: string | null
}

export interface AuditRow {
  id: number
  actor_id: string | null
  action: string
  entity: string
  entity_id: string | null
  student_id: string | null
  reason: string | null
  amount: number | null
  created_at: string
}

export interface SearchHit {
  kind: 'student' | 'invoice' | 'receipt' | 'cheque'
  id: string
  student_id: string | null
  academic_year_id: string | null
  title: string
  subtitle: string
}

// ── Reads ───────────────────────────────────────────────────────────────
export async function fetchYearSummary(yearId: string): Promise<YearSummaryRow | null> {
  const { data, error } = await supabase.from('fee_year_summary')
    .select('*').eq('academic_year_id', yearId).maybeSingle()
  if (error) return empty(error, null)
  return (data as YearSummaryRow) ?? null
}

export async function fetchCollectionDaily(yearId: string): Promise<CollectionDayRow[]> {
  const { data, error } = await supabase.from('fee_collection_daily')
    .select('*').eq('academic_year_id', yearId).order('day')
  if (error) return empty(error, [])
  return (data ?? []) as CollectionDayRow[]
}

export async function fetchAging(yearId: string): Promise<AgingRow[]> {
  const { data, error } = await supabase.from('fee_outstanding_aging')
    .select('*').eq('academic_year_id', yearId)
  if (error) return empty(error, [])
  const rows = (data ?? []) as AgingRow[]
  return rows.sort((a, b) => AGING_ORDER.indexOf(a.bucket) - AGING_ORDER.indexOf(b.bucket))
}

export async function fetchDefaultersByClass(yearId: string): Promise<DefaulterClassRow[]> {
  const { data, error } = await supabase.from('fee_defaulters_by_class')
    .select('*').eq('academic_year_id', yearId)
  if (error) return empty(error, [])
  return (data ?? []) as DefaulterClassRow[]
}

export async function fetchConcessionSummary(yearId: string): Promise<ConcessionSummaryRow[]> {
  const { data, error } = await supabase.from('fee_concession_summary')
    .select('*').eq('academic_year_id', yearId)
  if (error) return empty(error, [])
  return (data ?? []) as ConcessionSummaryRow[]
}

export async function fetchInstrumentPipeline(yearId: string): Promise<InstrumentPipelineRow[]> {
  const { data, error } = await supabase.from('fee_instrument_pipeline')
    .select('*').eq('academic_year_id', yearId)
  if (error) return empty(error, [])
  return (data ?? []) as InstrumentPipelineRow[]
}

export async function fetchStaffCollection(yearId: string): Promise<StaffCollectionRow[]> {
  const { data, error } = await supabase.from('fee_staff_collection')
    .select('*').eq('academic_year_id', yearId).order('month', { ascending: false })
  if (error) return empty(error, [])
  return (data ?? []) as StaffCollectionRow[]
}

export async function fetchRefunds(yearId: string): Promise<RefundRow[]> {
  const { data, error } = await supabase.from('fee_refunds')
    .select('*').eq('academic_year_id', yearId).order('requested_at', { ascending: false })
  if (error) return empty(error, [])
  return (data ?? []) as RefundRow[]
}

export async function fetchRteRegister(yearId: string): Promise<RteRow[]> {
  const { data, error } = await supabase.from('fee_rte_register')
    .select('*').eq('academic_year_id', yearId)
  if (error) return empty(error, [])
  return (data ?? []) as RteRow[]
}

export async function fetchAudit(filter: {
  yearId?: string; studentId?: string; entity?: string; limit?: number
}): Promise<AuditRow[]> {
  let q = supabase.from('fee_audit_log')
    .select('id, actor_id, action, entity, entity_id, student_id, reason, amount, created_at')
    .order('id', { ascending: false })
    .limit(filter.limit ?? 300)
  if (filter.yearId) q = q.eq('academic_year_id', filter.yearId)
  if (filter.studentId) q = q.eq('student_id', filter.studentId)
  if (filter.entity) q = q.eq('entity', filter.entity)
  const { data, error } = await q
  if (error) return empty(error, [])
  return (data ?? []) as AuditRow[]
}

// ── Search ──────────────────────────────────────────────────────────────
/**
 * One box over students, bill numbers, receipt numbers, UTRs and cheque
 * numbers.
 *
 * The term is matched with `ilike` against a pre-lowered haystack column, and
 * the wildcards a user could inject (`%`, `_`) are escaped first — otherwise a
 * lone `%` returns the whole index, which is slow rather than dangerous, but
 * still not what they asked for.
 */
export async function searchFees(term: string, limit = 25): Promise<SearchHit[]> {
  const q = term.trim().toLowerCase()
  if (q.length < 2) return []
  const escaped = q.replace(/[\\%_]/g, m => `\\${m}`)
  const { data, error } = await supabase.from('fee_search_index')
    .select('kind, id, student_id, academic_year_id, title, subtitle')
    .ilike('haystack', `%${escaped}%`)
    .limit(limit)
  if (error) return empty(error, [])
  return (data ?? []) as SearchHit[]
}

// ── The question box ────────────────────────────────────────────────────
/**
 * A typed question, not free text.
 *
 * "which students of class 5 haven't paid?" resolves to one of these shapes
 * with its parameters filled in. The shapes are a closed set: whatever a user
 * types, the only thing that reaches the database is one of the queries below
 * with a grade, a bucket or a number substituted in. There is no branch where
 * user text becomes SQL.
 */
export type QuestionKind =
  | 'unpaid_in_class' | 'most_overdue' | 'paid_today' | 'biggest_defaulters'
  | 'aging' | 'staff_month' | 'unreachable'

export interface ParsedQuestion {
  kind: QuestionKind
  /** Echoed back to the reader, so they can see what was understood. */
  label: string
  grade?: number
  section?: string
  limit?: number
}

const GRADE_WORDS: Record<string, number> = {
  lkg: -2, ukg: -1, nursery: -3, prekg: -3, 'pre-kg': -3,
}

/**
 * Read a question into one of the shapes above.
 *
 * Deliberately simple: keyword matching, not a parser. When nothing matches it
 * returns null and the interface falls back to plain search, which is a better
 * failure than confidently answering a different question.
 */
export function parseQuestion(input: string): ParsedQuestion | null {
  const q = input.trim().toLowerCase()
  if (q.length < 4) return null

  const gradeMatch = q.match(/\b(?:class|grade|std|standard)\s*(\d{1,2})\b/)
  const wordGrade = Object.keys(GRADE_WORDS).find(w => q.includes(w))
  const grade = gradeMatch ? Number(gradeMatch[1]) : wordGrade ? GRADE_WORDS[wordGrade] : undefined
  const sectionMatch = q.match(/\b(?:class|grade|std)\s*\d{1,2}\s*([a-e])\b/)

  const wantsUnpaid = /\b(unpaid|not paid|haven'?t paid|has not paid|pending|due|owe|owing|defaulter)/.test(q)
  const wantsToday = /\btoday\b/.test(q)
  const wantsOverdue = /\b(overdue|late|longest|most overdue)\b/.test(q)
  const wantsBiggest = /\b(biggest|largest|top|highest)\b/.test(q)
  const wantsStaff = /\b(collected by|staff|clerk|counter)\b/.test(q)
  const wantsUnreachable = /\b(no number|unreachable|no phone|cannot contact|opted out)\b/.test(q)
  const wantsAging = /\b(aging|ageing|how late|buckets?)\b/.test(q)

  if (wantsUnreachable) {
    return { kind: 'unreachable', label: 'Families with dues and no number on file' }
  }
  if (wantsToday) {
    return { kind: 'paid_today', label: 'Paid today' }
  }
  if (wantsStaff) {
    return { kind: 'staff_month', label: 'Collected by each staff member' }
  }
  if (wantsAging) {
    return { kind: 'aging', label: 'Outstanding by how late it is' }
  }
  if (grade !== undefined && wantsUnpaid) {
    return {
      kind: 'unpaid_in_class',
      label: `Unpaid in class ${gradeMatch?.[1] ?? wordGrade?.toUpperCase()}${sectionMatch ? sectionMatch[1].toUpperCase() : ''}`,
      grade,
      section: sectionMatch ? sectionMatch[1].toUpperCase() : undefined,
    }
  }
  if (wantsBiggest && wantsUnpaid) {
    return { kind: 'biggest_defaulters', label: 'Largest amounts outstanding', limit: 20 }
  }
  if (wantsOverdue) {
    return { kind: 'most_overdue', label: 'Longest overdue', limit: 20 }
  }
  if (wantsUnpaid) {
    return { kind: 'biggest_defaulters', label: 'Everyone with dues', limit: 50 }
  }
  return null
}

export interface QuestionAnswer {
  label: string
  columns: string[]
  rows: Record<string, string | number>[]
  /** Students the answer is about, so the reader can remind them in one press. */
  studentIds: string[]
}

/**
 * Run one of the shapes above.
 *
 * Note what this function does *not* take: a string. Everything the user typed
 * was consumed by `parseQuestion`, and what arrives here is a kind plus a
 * grade, a section or a row limit. Each branch is a query written out in full
 * here, so the only thing a question can change is which of these runs and
 * what numbers go into its filters.
 */
export async function runQuestion(
  q: ParsedQuestion, yearId: string, showAmounts: boolean,
): Promise<QuestionAnswer> {
  const money = (v: number | null | undefined) =>
    showAmounts && v !== null && v !== undefined ? Number(v) : '••••'

  switch (q.kind) {
    case 'aging': {
      const rows = await fetchAging(yearId)
      return {
        label: q.label,
        columns: ['How late', 'Bills', 'Students', 'Outstanding'],
        studentIds: [],
        rows: rows.map(r => ({
          'How late': AGING_LABEL[r.bucket],
          Bills: r.bills,
          Students: r.students,
          Outstanding: money(r.outstanding),
        })),
      }
    }

    case 'staff_month': {
      const rows = await fetchStaffCollection(yearId)
      return {
        label: q.label,
        columns: ['Staff', 'Month', 'Receipts', 'Collected', 'Cash', 'Reversed'],
        studentIds: [],
        rows: rows.map(r => ({
          Staff: r.staff_name ?? 'Not recorded',
          Month: r.month,
          Receipts: r.receipts,
          Collected: money(r.collected),
          Cash: money(r.cash),
          Reversed: r.reversed,
        })),
      }
    }

    case 'paid_today': {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase.from('fee_payments_v')
        .select('receipt_no, student_id, paid_on, method, amount, status')
        .eq('academic_year_id', yearId).eq('paid_on', today)
        .neq('status', 'reversed')
        .order('seq', { ascending: false })
      if (error) return empty(error, { label: q.label, columns: [], rows: [], studentIds: [] })
      const rows = (data ?? []) as { receipt_no: string | null; student_id: string;
                                     method: string; amount: number | null }[]
      const names = await namesFor(rows.map(r => r.student_id))
      return {
        label: q.label,
        columns: ['Receipt', 'Student', 'Method', 'Amount'],
        studentIds: rows.map(r => r.student_id),
        rows: rows.map(r => ({
          Receipt: r.receipt_no ?? '—',
          Student: names.get(r.student_id) ?? 'Student',
          Method: r.method,
          Amount: money(r.amount),
        })),
      }
    }

    default: {
      // The three defaulter shapes differ only in how they are filtered and
      // sorted, so they share one query rather than three near-copies.
      let query = supabase.from('fee_invoices_v')
        .select('number, student_id, due_date, balance, status')
        .eq('academic_year_id', yearId)
        .in('status', ['pending', 'partly_paid', 'overdue'])
        .gt('balance', 0)

      if (q.kind === 'most_overdue') query = query.order('due_date')
      else query = query.order('balance', { ascending: false })

      const { data, error } = await query.limit(q.limit ?? 50)
      if (error) return empty(error, { label: q.label, columns: [], rows: [], studentIds: [] })

      let rows = (data ?? []) as { number: string; student_id: string;
                                   due_date: string; balance: number | null }[]

      // Class filters run against profiles, which is where grade lives, so the
      // narrowing happens here rather than in the invoice query.
      let names: Map<string, string>
      if (q.kind === 'unpaid_in_class' && q.grade !== undefined) {
        const inClass = await studentsInClass(q.grade, q.section)
        rows = rows.filter(r => inClass.has(r.student_id))
        names = new Map(Array.from(inClass.entries()))
      } else if (q.kind === 'unreachable') {
        const { fetchContactableStudents } = await import('./charges')
        const reachable = await fetchContactableStudents(rows.map(r => r.student_id))
        rows = rows.filter(r => !reachable.has(r.student_id))
        names = await namesFor(rows.map(r => r.student_id))
      } else {
        names = await namesFor(rows.map(r => r.student_id))
      }

      return {
        label: q.label,
        columns: ['Student', 'Bill', 'Due', 'Outstanding'],
        studentIds: Array.from(new Set(rows.map(r => r.student_id))),
        rows: rows.map(r => ({
          Student: names.get(r.student_id) ?? 'Student',
          Bill: r.number,
          Due: r.due_date,
          Outstanding: money(r.balance),
        })),
      }
    }
  }
}

/** Student id → name, chunked so a long list stays inside one URL. */
export async function namesFor(ids: string[]): Promise<Map<string, string>> {
  type Row = { id: string; full_name: string }
  const rows = await inChunks(Array.from(new Set(ids)), async batch => {
    const { data, error } = await supabase.from('profiles')
      .select('id, full_name').in('id', batch)
    if (error) return empty(error, [] as Row[])
    return (data ?? []) as Row[]
  })
  return new Map(rows.map(r => [r.id, r.full_name]))
}

async function studentsInClass(grade: number, section?: string): Promise<Map<string, string>> {
  let q = supabase.from('profiles').select('id, full_name')
    .eq('role', 'student').eq('grade', grade)
  if (section) q = q.eq('section', section)
  const { data, error } = await q
  if (error) return empty(error, new Map<string, string>())
  const out = new Map<string, string>()
  ;(data ?? []).forEach(r => {
    const row = r as { id: string; full_name: string }
    out.set(row.id, row.full_name)
  })
  return out
}

// ── Writes ──────────────────────────────────────────────────────────────
export async function requestRefund(input: {
  student_id: string
  academic_year_id: string
  amount: number
  reason: string
  source_payment_id?: string | null
  source_credit_id?: string | null
}) {
  const res = await fetch('/api/fees/refunds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(input),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || 'The refund was not requested.')
  }
  return json as { refund_id: string; status: string; still_owing: number; warning: string | null }
}

export async function decideRefund(id: string, approve: boolean, note?: string) {
  const res = await fetch(`/api/fees/refunds/${id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ approve, note }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || 'That decision did not go through.')
  }
  return json as { status: string }
}

export async function payRefund(
  id: string, method: string, reference?: string, paidOn?: string,
) {
  const res = await fetch(`/api/fees/refunds/${id}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ method, reference, paid_on: paidOn }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || 'The pay-out did not go through.')
  }
  return json as { status: string; paid_on: string }
}

export async function recordRte(input: {
  student_id: string
  academic_year_id: string
  claimed?: number
  reimbursed?: number
  period?: string
  government_ref?: string
  reimbursed_on?: string
}) {
  const { data, error } = await supabase.rpc('fee_record_rte', {
    p_student: input.student_id,
    p_year: input.academic_year_id,
    p_claimed: input.claimed ?? null,
    p_reimbursed: input.reimbursed ?? null,
    p_period: input.period ?? null,
    p_ref: input.government_ref ?? null,
    p_on: input.reimbursed_on ?? null,
    p_actor: null,
  })
  if (error) throw error
  return data as { id: string; status: string; claimed: number; reimbursed: number }
}

export async function carryForward(fromYearId: string, toYearId: string, commit = false) {
  const res = await fetch('/api/fees/years/carry-forward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ from: fromYearId, to: toYearId, commit }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || 'The carry-forward did not run.')
  }
  return json as { committed: boolean; students: number; total: number }
}
