import { supabase, UserProfile } from './supabase'

// School Fee Manager data layer. Mirrors the fee section of src/lib/bus.ts but
// operates on the school_fees / school_fee_payments / fee_heads tables. Fees are
// issued from a reusable fee-head catalogue, can be bulk-targeted by homeroom,
// and reuse the site-wide Razorpay / UPI / Smart Collect payment config shared
// with the Bus module (re-exported at the bottom of this file).

// ============================================
// Types
// ============================================

export type FeeStatus = 'unpaid' | 'partial' | 'paid' | 'cancelled'
export type FeePaymentMethod = 'razorpay' | 'upi_qr' | 'cash' | 'card' | 'bank' | 'cheque'
export type FeePaymentStatus = 'pending' | 'verified' | 'failed'

/** Methods an admin can record by hand at the office (everything that isn't an
 *  online gateway / student-initiated UPI claim). Drives the Collection Report
 *  method filter and the Record-payment modal. */
export const OFFLINE_METHODS: FeePaymentMethod[] = ['cash', 'upi_qr', 'card', 'bank', 'cheque']

export const METHOD_LABELS: Record<FeePaymentMethod, string> = {
  cash: 'Cash', upi_qr: 'UPI', card: 'Card', bank: 'Bank', cheque: 'Cheque', razorpay: 'Razorpay',
}

export interface FeeHead {
  id: string
  name: string
  description: string | null
  default_amount: number
  active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SchoolFee {
  id: string
  fee_head_id: string | null
  student_id: string
  amount: number
  description: string | null
  due_date: string | null
  status: FeeStatus
  academic_year: string | null
  upi_reference: string
  created_by: string | null
  created_at: string
  updated_at: string
  student?: UserProfile | null
  fee_head?: Pick<FeeHead, 'id' | 'name'> | null
}

export interface SchoolFeePayment {
  id: string
  fee_id: string
  payer_id: string | null
  method: FeePaymentMethod
  amount: number
  status: FeePaymentStatus
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  razorpay_signature: string | null
  upi_txn_ref: string | null
  // Smart Collect (bank/PSP auto-reconciliation) columns, per add_fee_manager.sql.
  provider: string | null
  collect_vpa: string | null
  provider_ref: string | null
  utr: string | null
  verified_by: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

export interface FeeCollectionSummary {
  total_amount: number
  collected_amount: number
  outstanding_amount: number
  paid_count: number
  unpaid_count: number
  partial_count: number
  cancelled_count: number
  total_count: number
}

// ============================================
// Academic year (Apr–Mar, 'YYYY-YY')
// ------------------------------------------------------------
// Matches homerooms.academic_year and the homeroom_expiry_dates keys.
// ============================================

/** The 'YYYY-YY' academic year a date falls in (Indian Apr–Mar session). */
export function academicYearOf(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const month = d.getMonth() + 1 // 1–12
  const start = month >= 4 ? d.getFullYear() : d.getFullYear() - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

export function currentAcademicYear(): string {
  return academicYearOf(new Date())
}

/** Distinct academic years across issued fees and homerooms, newest first,
 *  always including the current year — powers the Fee Manager year toggler. */
export async function listAcademicYears(): Promise<string[]> {
  const years = new Set<string>([currentAcademicYear()])
  const [{ data: feeYears }, { data: hrYears }] = await Promise.all([
    supabase.from('school_fees').select('academic_year').not('academic_year', 'is', null),
    supabase.from('homerooms').select('academic_year').not('academic_year', 'is', null),
  ])
  for (const r of feeYears ?? []) if (r.academic_year) years.add(r.academic_year as string)
  for (const r of hrYears ?? []) if (r.academic_year) years.add(r.academic_year as string)
  return [...years].sort((a, b) => b.localeCompare(a))
}

// ============================================
// Fee heads (reusable catalogue)
// ============================================

export async function fetchFeeHeads(): Promise<FeeHead[]> {
  const { data, error } = await supabase
    .from('fee_heads')
    .select('*')
    .order('name', { ascending: true })
  if (error) { console.error('fetchFeeHeads failed:', error); return [] }
  return (data as FeeHead[]) || []
}

export interface FeeHeadInput {
  name: string
  description?: string | null
  default_amount: number
  active?: boolean
}

export async function createFeeHead(input: FeeHeadInput): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('fee_heads')
    .insert({ ...input, created_by: user?.id })
    .select('id')
    .single()
  if (error) { console.error('createFeeHead failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

export async function updateFeeHead(headId: string, input: Partial<FeeHeadInput>): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('fee_heads').update(input).eq('id', headId)
  if (error) { console.error('updateFeeHead failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function setFeeHeadActive(headId: string, active: boolean): Promise<{ success: boolean; error?: string }> {
  return updateFeeHead(headId, { active })
}

// ============================================
// Homeroom bulk targeting
// ============================================

/** Union of the student profiles belonging to the given homerooms, de-duplicated. */
export async function fetchStudentsForHomerooms(homeroomIds: string[]): Promise<UserProfile[]> {
  if (homeroomIds.length === 0) return []
  const { data, error } = await supabase
    .from('homeroom_members')
    .select('student:profiles!homeroom_members_student_id_fkey(*)')
    .in('homeroom_id', homeroomIds)
  if (error) { console.error('fetchStudentsForHomerooms failed:', error); return [] }
  const rows = (data as unknown as { student: UserProfile | UserProfile[] | null }[]) || []
  const byId = new Map<string, UserProfile>()
  for (const r of rows) {
    const s = Array.isArray(r.student) ? r.student[0] : r.student
    if (s) byId.set(s.id, s)
  }
  return [...byId.values()].sort((a, b) => a.full_name.localeCompare(b.full_name))
}

/** Every student profile (for adding individuals to a bulk fee issue). */
export async function fetchAllStudents(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .order('full_name', { ascending: true })
  if (error) { console.error('fetchAllStudents failed:', error); return [] }
  return (data as UserProfile[]) || []
}

// ============================================
// Fees & collection
// ============================================

export async function fetchFeesForStudent(studentId: string, year?: string): Promise<SchoolFee[]> {
  let q = supabase
    .from('school_fees')
    .select('*, fee_head:fee_heads!fee_head_id(id, name)')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
  if (year) q = q.eq('academic_year', year)
  const { data, error } = await q
  if (error) { console.error('fetchFeesForStudent failed:', error); return [] }
  return (data as SchoolFee[]) || []
}

export async function fetchAllFees(year?: string): Promise<SchoolFee[]> {
  let q = supabase
    .from('school_fees')
    .select('*, student:profiles!student_id(*), fee_head:fee_heads!fee_head_id(id, name)')
    .order('created_at', { ascending: false })
  if (year) q = q.eq('academic_year', year)
  const { data, error } = await q
  if (error) { console.error('fetchAllFees failed:', error); return [] }
  return (data as SchoolFee[]) || []
}

export function summarizeFees(fees: SchoolFee[]): FeeCollectionSummary {
  const summary: FeeCollectionSummary = {
    total_amount: 0, collected_amount: 0, outstanding_amount: 0,
    paid_count: 0, unpaid_count: 0, partial_count: 0, cancelled_count: 0, total_count: fees.length,
  }
  for (const f of fees) {
    const amt = Number(f.amount) || 0
    if (f.status === 'cancelled') { summary.cancelled_count++; continue }
    summary.total_amount += amt
    if (f.status === 'paid') { summary.collected_amount += amt; summary.paid_count++ }
    else if (f.status === 'partial') { summary.partial_count++; summary.outstanding_amount += amt }
    else { summary.unpaid_count++; summary.outstanding_amount += amt }
  }
  return summary
}

export interface FeeInput {
  student_id: string
  fee_head_id?: string | null
  amount: number
  description?: string | null
  due_date?: string | null
  /** 'YYYY-YY'. Stamped from the targeted homeroom's year when issuing in bulk;
   *  falls back to the year of due_date / today. */
  academic_year?: string | null
}

/** Ensure every issued fee carries an academic year so it scopes to the toggler. */
function withAcademicYear(input: FeeInput): FeeInput {
  return {
    ...input,
    academic_year: input.academic_year ?? academicYearOf(input.due_date ?? new Date()),
  }
}

export async function createFee(input: FeeInput): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('school_fees')
    .insert({ ...withAcademicYear(input), created_by: user?.id })
    .select('id')
    .single()
  if (error) { console.error('createFee failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

/** Issue the same fee to many students at once. */
export async function createFeesBulk(inputs: FeeInput[]): Promise<{ success: boolean; error?: string }> {
  if (inputs.length === 0) return { success: true }
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('school_fees')
    .insert(inputs.map(i => ({ ...withAcademicYear(i), created_by: user?.id })))
  if (error) { console.error('createFeesBulk failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function setFeeStatus(feeId: string, status: FeeStatus): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('school_fees').update({ status }).eq('id', feeId)
  if (error) { console.error('setFeeStatus failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function cancelFee(feeId: string): Promise<{ success: boolean; error?: string }> {
  return setFeeStatus(feeId, 'cancelled')
}

/** Lightweight status read used to poll for auto-confirmation. */
export async function fetchFeeStatus(feeId: string): Promise<FeeStatus | null> {
  const { data, error } = await supabase.from('school_fees').select('status').eq('id', feeId).maybeSingle()
  if (error) { console.error('fetchFeeStatus failed:', error); return null }
  return (data?.status as FeeStatus) ?? null
}

// ============================================
// Payments
// ============================================

export async function fetchPaymentsForFee(feeId: string): Promise<SchoolFeePayment[]> {
  const { data, error } = await supabase
    .from('school_fee_payments')
    .select('*')
    .eq('fee_id', feeId)
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchPaymentsForFee failed:', error); return [] }
  return (data as SchoolFeePayment[]) || []
}

/** A student logs that they paid a fee via UPI QR; admin verifies later. */
export async function recordUpiClaim(
  feeId: string,
  amount: number,
  upiTxnRef: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('school_fee_payments').insert({
    fee_id: feeId,
    payer_id: user?.id,
    method: 'upi_qr',
    amount,
    status: 'pending',
    upi_txn_ref: upiTxnRef,
  })
  if (error) { console.error('recordUpiClaim failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Pending payment claim awaiting admin verification, with fee + payer context. */
export interface PendingPayment extends SchoolFeePayment {
  fee?: (Pick<SchoolFee, 'id' | 'amount' | 'description' | 'upi_reference'> & { student?: UserProfile | null }) | null
}

export async function fetchPendingPayments(): Promise<PendingPayment[]> {
  const { data, error } = await supabase
    .from('school_fee_payments')
    .select('*, fee:school_fees!fee_id(id, amount, description, upi_reference, student:profiles!student_id(*))')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchPendingPayments failed:', error); return [] }
  return (data as unknown as PendingPayment[]) || []
}

/** Admin confirms a payment claim: mark the payment verified and the fee paid. */
export async function verifyPayment(paymentId: string, feeId: string): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error: pErr } = await supabase
    .from('school_fee_payments')
    .update({ status: 'verified', verified_by: user?.id, verified_at: new Date().toISOString() })
    .eq('id', paymentId)
  if (pErr) { console.error('verifyPayment(payment) failed:', pErr); return { success: false, error: pErr.message } }
  const { error: fErr } = await supabase.from('school_fees').update({ status: 'paid' }).eq('id', feeId)
  if (fErr) { console.error('verifyPayment(fee) failed:', fErr); return { success: false, error: fErr.message } }
  return { success: true }
}

export async function rejectPayment(paymentId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('school_fee_payments').update({ status: 'failed' }).eq('id', paymentId)
  if (error) { console.error('rejectPayment failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Admin records a payment collected at the office (cash / cheque / card / bank /
 *  UPI) — inserts an already-verified payment and marks the fee paid. Mirrors
 *  verifyPayment but for a settlement that never went through a gateway. */
export async function recordOfflinePayment(
  feeId: string,
  method: FeePaymentMethod,
  amount: number,
  reference?: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const now = new Date().toISOString()
  const { error: pErr } = await supabase.from('school_fee_payments').insert({
    fee_id: feeId,
    payer_id: user?.id,
    method,
    amount,
    status: 'verified',
    verified_by: user?.id,
    verified_at: now,
    upi_txn_ref: reference?.trim() || null,
  })
  if (pErr) { console.error('recordOfflinePayment(payment) failed:', pErr); return { success: false, error: pErr.message } }
  const { error: fErr } = await supabase.from('school_fees').update({ status: 'paid' }).eq('id', feeId)
  if (fErr) { console.error('recordOfflinePayment(fee) failed:', fErr); return { success: false, error: fErr.message } }
  return { success: true }
}

// ============================================
// Dashboard KPIs & reports
// ============================================

/** The five at-a-glance numbers on the admin Fee Manager dashboard. */
export interface DashboardSummary {
  total_expected: number
  collected: number
  outstanding: number
  today_collection: number
  students_with_dues: number
}

/** KPIs for a (year-scoped) set of fees + their verified payments. Pass the same
 *  year-filtered `fees` (fetchAllFees(year)) and verified `payments`
 *  (fetchCollectionReport({ year })) so the figures rescope with the toggler. */
export function summarizeDashboard(fees: SchoolFee[], payments: SchoolFeePayment[]): DashboardSummary {
  let total_expected = 0
  let collected = 0
  const dueStudents = new Set<string>()
  for (const f of fees) {
    if (f.status === 'cancelled') continue
    const amt = Number(f.amount) || 0
    total_expected += amt
    if (f.status === 'paid') collected += amt
    else dueStudents.add(f.student_id)
  }
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  let today_collection = 0
  for (const p of payments) {
    if (p.status !== 'verified' || !p.verified_at) continue
    if (new Date(p.verified_at) >= startOfToday) today_collection += Number(p.amount) || 0
  }
  return {
    total_expected,
    collected,
    outstanding: total_expected - collected,
    today_collection,
    students_with_dues: dueStudents.size,
  }
}

/** A verified payment with the fee + student context the Collection Report needs. */
export interface CollectionRow extends SchoolFeePayment {
  fee?: (
    Pick<SchoolFee, 'id' | 'amount' | 'description' | 'upi_reference' | 'academic_year'> & {
      student?: UserProfile | null
      fee_head?: Pick<FeeHead, 'id' | 'name'> | null
    }
  ) | null
}

export interface CollectionFilter {
  /** Inclusive lower bound on verified_at (ISO timestamp, e.g. start-of-day). */
  from?: string
  /** Inclusive upper bound on verified_at (ISO timestamp, e.g. end-of-day). */
  to?: string
  methods?: FeePaymentMethod[]
  year?: string
}

/** Verified payments for the Collection Report / Daily Collection Report. The
 *  academic-year filter is applied client-side (it lives on the joined fee). */
export async function fetchCollectionReport(filter: CollectionFilter = {}): Promise<CollectionRow[]> {
  let q = supabase
    .from('school_fee_payments')
    .select('*, fee:school_fees!fee_id(id, amount, description, upi_reference, academic_year, student:profiles!student_id(*), fee_head:fee_heads!fee_head_id(id, name))')
    .eq('status', 'verified')
    .order('verified_at', { ascending: false })
  if (filter.from) q = q.gte('verified_at', filter.from)
  if (filter.to) q = q.lte('verified_at', filter.to)
  if (filter.methods && filter.methods.length) q = q.in('method', filter.methods)
  const { data, error } = await q
  if (error) { console.error('fetchCollectionReport failed:', error); return [] }
  let rows = (data as unknown as CollectionRow[]) || []
  if (filter.year) rows = rows.filter(r => r.fee?.academic_year === filter.year)
  return rows
}

/** One row of a student's running fee ledger (debit = fee issued, credit = paid). */
export interface LedgerEntry {
  date: string
  type: 'debit' | 'credit'
  particulars: string
  debit: number
  credit: number
  balance: number
  reference: string
}

/** Chronological debit/credit ledger with a running balance for one student. */
export async function fetchStudentLedger(studentId: string, year?: string): Promise<LedgerEntry[]> {
  const fees = (await fetchFeesForStudent(studentId, year)).filter(f => f.status !== 'cancelled')
  const feeIds = fees.map(f => f.id)
  let payments: SchoolFeePayment[] = []
  if (feeIds.length) {
    const { data } = await supabase
      .from('school_fee_payments')
      .select('*')
      .in('fee_id', feeIds)
      .eq('status', 'verified')
    payments = (data as SchoolFeePayment[]) || []
  }
  type Event = { date: string; type: 'debit' | 'credit'; particulars: string; amount: number; reference: string }
  const events: Event[] = []
  for (const f of fees) {
    events.push({
      date: f.due_date || f.created_at,
      type: 'debit',
      particulars: f.description || f.fee_head?.name || 'School fee',
      amount: Number(f.amount) || 0,
      reference: f.upi_reference,
    })
  }
  for (const p of payments) {
    events.push({
      date: p.verified_at || p.created_at,
      type: 'credit',
      particulars: `Payment · ${METHOD_LABELS[p.method] ?? p.method}`,
      amount: Number(p.amount) || 0,
      reference: p.upi_txn_ref || p.razorpay_payment_id || p.utr || '',
    })
  }
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  let balance = 0
  return events.map(e => {
    const debit = e.type === 'debit' ? e.amount : 0
    const credit = e.type === 'credit' ? e.amount : 0
    balance += debit - credit
    return { date: e.date, type: e.type, particulars: e.particulars, debit, credit, balance, reference: e.reference }
  })
}

// ============================================
// Client payment helpers (hit /api/fees/* routes)
// ============================================

/** Create a Razorpay order for a fee via the server route; returns checkout params. */
export async function createRazorpayOrder(feeId: string): Promise<{
  success: boolean; order_id?: string; key_id?: string; amount?: number; error?: string
}> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { success: false, error: 'Not authenticated' }
  try {
    const res = await fetch('/api/fees/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ fee_id: feeId }),
    })
    const json = await res.json()
    if (!json.success) return { success: false, error: json.error ?? 'Failed to start payment' }
    return { success: true, order_id: json.order_id, key_id: json.key_id, amount: json.amount }
  } catch (e) {
    console.error('createRazorpayOrder failed:', e)
    return { success: false, error: 'Network error starting payment' }
  }
}

/** Start a Smart Collect UPI payment; returns the VPA + reference to pay to. */
export async function startUpiCollect(feeId: string): Promise<{
  success: boolean; vpa?: string; reference?: string; payee_name?: string; amount?: number; error?: string
}> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { success: false, error: 'Not authenticated' }
  try {
    const res = await fetch('/api/fees/upi/create-collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ fee_id: feeId }),
    })
    const json = await res.json()
    if (!json.success) return { success: false, error: json.error ?? 'Could not start UPI payment' }
    return { success: true, vpa: json.vpa, reference: json.reference, payee_name: json.payee_name, amount: json.amount }
  } catch (e) {
    console.error('startUpiCollect failed:', e)
    return { success: false, error: 'Network error starting UPI payment' }
  }
}

// ============================================
// Shared payment configuration (site_settings)
// ------------------------------------------------------------
// Re-exported from the Bus module so school fees use the SAME site-wide
// Razorpay / UPI / Smart Collect config — the admin links the bank once.
// ============================================

export type { RazorpayConfig, UpiConfig, SmartCollectConfig } from './bus'
export {
  fetchRazorpayConfig, saveRazorpayConfig,
  fetchUpiConfig, saveUpiConfig,
  fetchSmartCollectConfig, saveSmartCollectConfig,
  buildUpiLink,
} from './bus'
