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
export type FeePaymentMethod = 'razorpay' | 'upi_qr' | 'cash'
export type FeePaymentStatus = 'pending' | 'verified' | 'failed'

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

export async function fetchFeesForStudent(studentId: string): Promise<SchoolFee[]> {
  const { data, error } = await supabase
    .from('school_fees')
    .select('*, fee_head:fee_heads!fee_head_id(id, name)')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchFeesForStudent failed:', error); return [] }
  return (data as SchoolFee[]) || []
}

export async function fetchAllFees(): Promise<SchoolFee[]> {
  const { data, error } = await supabase
    .from('school_fees')
    .select('*, student:profiles!student_id(*), fee_head:fee_heads!fee_head_id(id, name)')
    .order('created_at', { ascending: false })
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
}

export async function createFee(input: FeeInput): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('school_fees')
    .insert({ ...input, created_by: user?.id })
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
    .insert(inputs.map(i => ({ ...i, created_by: user?.id })))
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
