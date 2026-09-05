// ─────────────────────────────────────────────────────────────────────────────
// Invoices, payments and the ledger, client side.
//
// Reads go through the `_v` views, never the base tables. That is not a style
// choice: the views wrap every money column in fee_visible_amount(), so a user
// without `fees.view_amounts` gets NULL from the database and the figure is not
// in the response at all. A query against fee_invoices directly would hand them
// the number and rely on the interface to hide it, which is exactly the trick
// Round 1 promised not to play.
//
// Writes that move money do not happen here at all. They go through the API
// routes, which check the permission and then call an RPC that does the whole
// thing in one transaction.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, isMissingRelation, authHeader } from '@/lib/supabase'

export type InvoiceStatus =
  | 'draft' | 'pending' | 'partly_paid' | 'paid' | 'overdue' | 'cancelled'

export type PaymentMethod =
  | 'cash' | 'upi' | 'card' | 'netbanking' | 'bank_transfer'
  | 'cheque' | 'dd' | 'wallet' | 'razorpay' | 'adjustment'

export const PAYMENT_METHODS: { key: PaymentMethod; label: string }[] = [
  { key: 'cash',          label: 'Cash' },
  { key: 'upi',           label: 'UPI' },
  { key: 'card',          label: 'Card' },
  { key: 'netbanking',    label: 'Net banking' },
  { key: 'bank_transfer', label: 'Bank transfer' },
  { key: 'cheque',        label: 'Cheque' },
  { key: 'dd',            label: 'Demand draft' },
  { key: 'wallet',        label: 'Wallet' },
]

/** Money fields are `null` when the caller may not see amounts. */
export interface InvoiceRow {
  id: string
  profile_id: string
  student_id: string
  academic_year_id: string
  installment_id: string | null
  number: string
  seq: number
  issue_date: string
  due_date: string
  status: InvoiceStatus
  autogen: boolean
  verify_token: string
  cancelled_reason: string | null
  cancelled_at: string | null
  gross: number | null
  discount_total: number | null
  tax_total: number | null
  late_fee_total: number | null
  fine_total: number | null
  net: number | null
  paid: number | null
  balance: number | null
}

export interface InvoiceLineRow {
  id: string
  invoice_id: string
  kind: 'fee' | 'discount' | 'scholarship' | 'waiver' | 'fine' | 'late_fee' | 'carry_forward'
  fee_head_id: string | null
  label: string
  amount: number
  tax_rate: number
  tax_amount: number
  note: string | null
  sort: number
}

export interface PaymentRow {
  id: string
  student_id: string
  academic_year_id: string
  receipt_no: string | null
  seq: number | null
  paid_on: string
  method: PaymentMethod
  reference: string | null
  notes: string | null
  instrument_id: string | null
  status: 'pending' | 'verified' | 'reversed' | 'failed'
  collected_by: string | null
  reversed_at: string | null
  reversal_reason: string | null
  receipt_hash: string | null
  amount: number | null
}

export interface InstrumentRow {
  id: string
  student_id: string
  kind: 'cheque' | 'dd'
  number: string
  bank: string | null
  branch: string | null
  account_holder: string | null
  amount: number
  instrument_date: string | null
  is_postdated: boolean
  present_on: string | null
  status: 'received' | 'deposited' | 'cleared' | 'bounced' | 'cancelled'
  bounce_charge: number | null
  bounce_reason: string | null
  timeline: { at: string; from?: string; to: string; by?: string; note?: string }[]
}

export interface LedgerRow {
  id: number
  student_id: string
  academic_year_id: string
  entry_date: string
  kind: string
  ref_table: string | null
  ref_id: string | null
  note: string | null
  debit: number | null
  credit: number | null
  balance_after: number | null
}

export interface FeeProfileRow {
  id: string
  student_id: string
  academic_year_id: string
  fee_group_id: string | null
  structure_id: string | null
  structure_source: { rank: number; why: string } | null
  status: 'active' | 'withdrawn' | 'transferred'
  prorate_from: string | null
  is_rte: boolean
  opening_balance: number | null
  notes: string | null
}

const INVOICE_COLS =
  'id, profile_id, student_id, academic_year_id, installment_id, number, seq, issue_date, ' +
  'due_date, status, autogen, verify_token, cancelled_reason, cancelled_at, gross, ' +
  'discount_total, tax_total, late_fee_total, fine_total, net, paid, balance'

const PAYMENT_COLS =
  'id, student_id, academic_year_id, receipt_no, seq, paid_on, method, reference, notes, ' +
  'instrument_id, status, collected_by, reversed_at, reversal_reason, receipt_hash, amount'

/**
 * A deployment that has not run the Round 2 migrations yet should show an empty
 * fee module, not a crash. Every other module in this repo degrades the same
 * way — see isMissingRelation in src/lib/supabase.ts.
 */
function emptyOnMissing<T>(error: { code?: string; message?: string } | null, fallback: T): T {
  if (isMissingRelation(error)) return fallback
  throw error
}

// ── Reads ───────────────────────────────────────────────────────────────
export async function fetchInvoices(filter: {
  academicYearId: string
  studentId?: string
  status?: InvoiceStatus[]
  limit?: number
}): Promise<InvoiceRow[]> {
  let q = supabase.from('fee_invoices_v').select(INVOICE_COLS)
    .eq('academic_year_id', filter.academicYearId)
    .order('seq', { ascending: false })
    .limit(filter.limit ?? 500)

  if (filter.studentId) q = q.eq('student_id', filter.studentId)
  if (filter.status?.length) q = q.in('status', filter.status)

  const { data, error } = await q
  if (error) return emptyOnMissing(error, [])
  return (data ?? []) as unknown as InvoiceRow[]
}

/**
 * Every bill in the session that is still owed, oldest due date first.
 *
 * Its own function rather than `fetchInvoices` with a status filter because
 * this is the query the collections and charges screens run against the whole
 * school, and it needs a ceiling high enough for one — 500 would silently drop
 * the tail of a nine-hundred-student list, and the number missing from a
 * "who owes us money" screen is exactly the number nobody would notice.
 */
export async function fetchUnpaidInvoices(academicYearId: string): Promise<InvoiceRow[]> {
  const { data, error } = await supabase.from('fee_invoices_v').select(INVOICE_COLS)
    .eq('academic_year_id', academicYearId)
    .in('status', ['pending', 'partly_paid', 'overdue'])
    .order('due_date')
    .limit(5000)
  if (error) return emptyOnMissing(error, [])
  return (data ?? []) as unknown as InvoiceRow[]
}

/** The bills a payment can be put against, oldest first. */
export async function fetchOutstandingInvoices(
  studentId: string, academicYearId: string,
): Promise<InvoiceRow[]> {
  const { data, error } = await supabase.from('fee_invoices_v').select(INVOICE_COLS)
    .eq('student_id', studentId)
    .eq('academic_year_id', academicYearId)
    .in('status', ['pending', 'partly_paid', 'overdue'])
    .order('due_date')
  if (error) return emptyOnMissing(error, [])
  return (data ?? []) as unknown as InvoiceRow[]
}

export async function fetchInvoiceLines(invoiceIds: string[]): Promise<InvoiceLineRow[]> {
  if (invoiceIds.length === 0) return []
  const { data, error } = await supabase.from('fee_invoice_lines')
    .select('id, invoice_id, kind, fee_head_id, label, amount, tax_rate, tax_amount, note, sort')
    .in('invoice_id', invoiceIds)
    .order('sort')
  if (error) return emptyOnMissing(error, [])
  return (data ?? []) as InvoiceLineRow[]
}

export async function fetchPayments(filter: {
  academicYearId: string
  studentId?: string
  from?: string
  to?: string
  limit?: number
}): Promise<PaymentRow[]> {
  let q = supabase.from('fee_payments_v').select(PAYMENT_COLS)
    .eq('academic_year_id', filter.academicYearId)
    .order('paid_on', { ascending: false })
    .order('seq', { ascending: false })
    .limit(filter.limit ?? 500)

  if (filter.studentId) q = q.eq('student_id', filter.studentId)
  if (filter.from) q = q.gte('paid_on', filter.from)
  if (filter.to) q = q.lte('paid_on', filter.to)

  const { data, error } = await q
  if (error) return emptyOnMissing(error, [])
  return (data ?? []) as unknown as PaymentRow[]
}

export async function fetchAllocations(
  paymentIds: string[],
): Promise<{ payment_id: string; invoice_id: string; amount: number }[]> {
  if (paymentIds.length === 0) return []
  const { data, error } = await supabase.from('fee_payment_allocations')
    .select('payment_id, invoice_id, amount')
    .in('payment_id', paymentIds)
  if (error) return emptyOnMissing(error, [])
  return (data ?? []) as { payment_id: string; invoice_id: string; amount: number }[]
}

export async function fetchInstruments(filter: {
  studentId?: string
  postdatedOnly?: boolean
  status?: InstrumentRow['status'][]
}): Promise<InstrumentRow[]> {
  let q = supabase.from('fee_instruments')
    .select('id, student_id, kind, number, bank, branch, account_holder, amount, instrument_date, is_postdated, present_on, status, bounce_charge, bounce_reason, timeline')
    .order('present_on', { nullsFirst: false })

  if (filter.studentId) q = q.eq('student_id', filter.studentId)
  if (filter.postdatedOnly) q = q.eq('is_postdated', true)
  if (filter.status?.length) q = q.in('status', filter.status)

  const { data, error } = await q
  if (error) return emptyOnMissing(error, [])
  return (data ?? []) as InstrumentRow[]
}

export async function fetchLedger(
  studentId: string, academicYearId: string,
): Promise<LedgerRow[]> {
  const { data, error } = await supabase.from('fee_ledger_v')
    .select('id, student_id, academic_year_id, entry_date, kind, ref_table, ref_id, note, debit, credit, balance_after')
    .eq('student_id', studentId)
    .eq('academic_year_id', academicYearId)
    .order('id')
  if (error) return emptyOnMissing(error, [])
  return (data ?? []) as LedgerRow[]
}

export async function fetchProfile(
  studentId: string, academicYearId: string,
): Promise<FeeProfileRow | null> {
  const { data, error } = await supabase.from('fee_profiles_v')
    .select('id, student_id, academic_year_id, fee_group_id, structure_id, structure_source, status, prorate_from, is_rte, opening_balance, notes')
    .eq('student_id', studentId)
    .eq('academic_year_id', academicYearId)
    .maybeSingle()
  if (error) return emptyOnMissing(error, null)
  return (data as FeeProfileRow) ?? null
}

export interface ProfileListRow extends FeeProfileRow {
  full_name: string
  grade: number | null
  section: string | null
  admission_no: string | null
  billed: number | null
  paid: number | null
  outstanding: number | null
}

/**
 * The student list, with each student's totals.
 *
 * Two queries plus an in-memory join rather than a query per student — the
 * repo's own PERFORMANCE.md calls looping a query per row the most expensive
 * recurring mistake here, and this list is 930 rows on the whole-school view.
 */
export async function fetchProfileList(academicYearId: string): Promise<ProfileListRow[]> {
  const [{ data: profiles, error: pErr }, { data: invoices, error: iErr }] = await Promise.all([
    supabase.from('fee_profiles_v')
      .select('id, student_id, academic_year_id, fee_group_id, structure_id, structure_source, status, prorate_from, is_rte, opening_balance, notes')
      .eq('academic_year_id', academicYearId),
    supabase.from('fee_invoices_v')
      .select('student_id, net, paid, balance, status')
      .eq('academic_year_id', academicYearId)
      .neq('status', 'cancelled'),
  ])
  if (pErr) return emptyOnMissing(pErr, [])
  if (iErr) return emptyOnMissing(iErr, [])

  const ids = (profiles ?? []).map(p => (p as FeeProfileRow).student_id)
  if (ids.length === 0) return []

  // Chunked: PostgREST builds the .in() list into the URL, and 930 uuids is
  // past what a proxy will accept in one request line.
  const people = new Map<string, { full_name: string; grade: number | null; section: string | null }>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('profiles')
      .select('id, full_name, grade, section').in('id', ids.slice(i, i + 300))
    for (const row of data ?? []) {
      people.set(row.id as string, {
        full_name: row.full_name as string,
        grade: row.grade as number | null,
        section: row.section as string | null,
      })
    }
  }

  const admission = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('student_details')
      .select('student_id, admission_no').in('student_id', ids.slice(i, i + 300))
    for (const row of data ?? []) {
      admission.set(row.student_id as string, row.admission_no as string | null)
    }
  }

  const totals = new Map<string, { billed: number; paid: number; outstanding: number }>()
  let anyAmountVisible = false
  for (const inv of (invoices ?? []) as { student_id: string; net: number | null; paid: number | null; balance: number | null }[]) {
    if (inv.net !== null) anyAmountVisible = true
    const t = totals.get(inv.student_id) ?? { billed: 0, paid: 0, outstanding: 0 }
    t.billed += inv.net ?? 0
    t.paid += inv.paid ?? 0
    t.outstanding += inv.balance ?? 0
    totals.set(inv.student_id, t)
  }

  return (profiles ?? []).map(raw => {
    const p = raw as FeeProfileRow
    const person = people.get(p.student_id)
    const t = totals.get(p.student_id)
    return {
      ...p,
      full_name: person?.full_name ?? 'Unknown',
      grade: person?.grade ?? null,
      section: person?.section ?? null,
      admission_no: admission.get(p.student_id) ?? null,
      // Summing masked (null) amounts would produce a confident 0, which reads
      // as "this family owes nothing" — worse than showing nothing at all.
      billed: anyAmountVisible ? (t?.billed ?? 0) : null,
      paid: anyAmountVisible ? (t?.paid ?? 0) : null,
      outstanding: anyAmountVisible ? (t?.outstanding ?? 0) : null,
    }
  }).sort((a, b) => a.full_name.localeCompare(b.full_name))
}

// ── Writes, through the API ─────────────────────────────────────────────
async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || 'That did not work. Please try again.')
  }
  return json as T
}

export interface CollectResult {
  payment_id: string
  receipt_no: string
  seq: number
  status: string
  receipt_hash: string
  allocated: number
  credited: number
  instrument_id: string | null
}

export function collectPayment(input: {
  student_id: string
  academic_year_id: string
  amount: number
  method: PaymentMethod
  allocations?: { invoice_id: string; amount: number }[]
  paid_on?: string
  reference?: string
  notes?: string
  instrument?: {
    kind: 'cheque' | 'dd'
    number: string
    bank?: string
    branch?: string
    account_holder?: string
    instrument_date?: string
    is_postdated?: boolean
    present_on?: string
  } | null
}): Promise<CollectResult> {
  return post<CollectResult>('/api/fees/collect', input)
}

export function reversePayment(paymentId: string, reason: string) {
  return post<{ receipt_no: string; reopened: number }>(
    `/api/fees/payments/${paymentId}/reverse`, { reason })
}

export function transitionInstrument(
  instrumentId: string,
  to: InstrumentRow['status'],
  note?: string,
  bounceCharge?: number,
) {
  return post<{ status: string }>(`/api/fees/instruments/${instrumentId}/transition`,
    { to, note, bounce_charge: bounceCharge })
}

export interface GenerateResult {
  committed: boolean
  installment: string
  due_date: string
  per_student: number
  will_create: number
  already_billed: number
  skipped_joined_late: number
  skipped_rte: number
  total_amount: number
  by_group: Record<string, number>
}

export function generateInvoices(installmentId: string, commit = false, profileIds?: string[]) {
  return post<GenerateResult>('/api/fees/invoices/generate',
    { installment_id: installmentId, commit, profile_ids: profileIds })
}

export interface CreateProfilesResult {
  committed: boolean
  created: number
  skipped_existing: number
  rte: number
  without_structure: number
}

export function createProfiles(input: {
  academic_year_id: string
  student_ids?: string[]
  fee_group_id?: string
  commit?: boolean
}) {
  return post<CreateProfilesResult>('/api/fees/profiles/create', input)
}

/** Cancelling a bill. The reason is required and lands on the row. */
export async function cancelInvoice(invoiceId: string, reason: string): Promise<void> {
  if (reason.trim().length < 3) {
    throw new Error('Say why this bill is being cancelled.')
  }
  const { data: user } = await supabase.auth.getUser()
  const { error } = await supabase.from('fee_invoices').update({
    status: 'cancelled',
    cancelled_reason: reason.trim(),
    cancelled_by: user.user?.id ?? null,
    cancelled_at: new Date().toISOString(),
  }).eq('id', invoiceId)
  if (error) throw error
}

export interface VerifyResult {
  kind: 'invoice' | 'receipt' | 'unknown'
  valid: boolean
  state: string
  number?: string
  student?: string
  amount?: number
  paid?: number
  balance?: number
  method?: string
  paid_on?: string
  issued_on?: string
  due_on?: string
  status?: string
  reason?: string | null
  school?: string
}
