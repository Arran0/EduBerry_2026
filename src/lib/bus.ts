import { supabase, UserProfile, UserRole } from './supabase'
import { academicYearOf, currentAcademicYear } from './fees'

export { academicYearOf, currentAcademicYear }

/** Distinct academic years derived from bus fee due_date / created_at, newest first. */
export async function listBusAcademicYears(): Promise<string[]> {
  const years = new Set<string>([currentAcademicYear()])
  const { data } = await supabase.from('bus_fees').select('due_date, created_at')
  for (const r of (data ?? []) as { due_date: string | null; created_at: string }[]) {
    const d = r.due_date || r.created_at
    if (d) years.add(academicYearOf(d))
  }
  return [...years].sort((a, b) => b.localeCompare(a))
}

// ============================================
// Types
// ============================================

export type TripAttendanceStatus = 'picked_up' | 'dropped' | 'absent'
export type BusFeeStatus = 'unpaid' | 'partial' | 'paid' | 'cancelled'
export type BusPaymentMethod = 'razorpay' | 'upi_qr' | 'cash' | 'card' | 'bank' | 'cheque'
export type BusPaymentStatus = 'pending' | 'verified' | 'failed'

export const BUS_OFFLINE_METHODS: BusPaymentMethod[] = ['cash', 'upi_qr', 'card', 'bank', 'cheque']
export const BUS_METHOD_LABELS: Record<BusPaymentMethod, string> = {
  razorpay: 'Razorpay', upi_qr: 'UPI QR', cash: 'Cash', card: 'Card', bank: 'Bank', cheque: 'Cheque',
}

export interface BusTrip {
  id: string
  name: string
  description: string | null
  pickup_time: string | null
  drop_time: string | null
  default_driver_id: string | null
  active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  default_driver?: UserProfile | null
}

export interface TripDriverOverride {
  id: string
  trip_id: string
  date: string
  driver_id: string
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  driver?: UserProfile | null
}

export interface TripAttendance {
  id: string
  trip_id: string
  passenger_id: string
  date: string
  status: TripAttendanceStatus
  marked_by: string | null
  picked_up_at: string | null
  dropped_at: string | null
  created_at: string
  updated_at: string
}

/** A passenger row for a trip roster, with the latest attendance for a given date. */
export interface TripRosterRow {
  passenger: UserProfile
  record: TripAttendance | null
}

export interface BusFeeHead {
  id: string
  name: string
  description: string | null
  default_amount: number
  active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface BusFee {
  id: string
  route_id: string | null
  fee_head_id: string | null
  passenger_id: string
  amount: number
  description: string | null
  due_date: string | null
  status: BusFeeStatus
  upi_reference: string
  created_by: string | null
  created_at: string
  updated_at: string
  passenger?: UserProfile | null
  route?: Pick<BusTrip, 'id' | 'name'> | null
  fee_head?: Pick<BusFeeHead, 'id' | 'name'> | null
}

export interface BusPayment {
  id: string
  fee_id: string
  payer_id: string | null
  method: BusPaymentMethod
  amount: number
  status: BusPaymentStatus
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  razorpay_signature: string | null
  upi_txn_ref: string | null
  verified_by: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

export interface BusCollectionRow extends BusPayment {
  fee?: (Pick<BusFee, 'id' | 'amount' | 'status' | 'description' | 'upi_reference'> & {
    passenger?: UserProfile | null
    fee_head?: Pick<BusFeeHead, 'id' | 'name'> | null
  }) | null
}

/** Admin-managed bank account for a driver, used for salary disbursement. */
export interface DriverBankAccount {
  id: string
  driver_id: string
  account_holder_name: string
  account_number: string
  ifsc: string
  bank_name: string | null
  payout_fund_account_id: string | null
  created_at: string
  updated_at: string
}

export interface BusLocation {
  id: string
  trip_id: string
  driver_id: string | null
  lat: number
  lng: number
  heading: number | null
  speed: number | null
  accuracy: number | null
  recorded_at: string
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
// Trips
// ============================================

export async function fetchTrips(): Promise<BusTrip[]> {
  const { data, error } = await supabase
    .from('transport_routes')
    .select('*, default_driver:profiles!default_driver_id(*)')
    .order('name', { ascending: true })
  if (error) { console.error('fetchTrips failed:', error); return [] }
  return (data as BusTrip[]) || []
}

export async function fetchTrip(tripId: string): Promise<BusTrip | null> {
  const { data, error } = await supabase
    .from('transport_routes')
    .select('*, default_driver:profiles!default_driver_id(*)')
    .eq('id', tripId)
    .single()
  if (error) { console.error('fetchTrip failed:', error); return null }
  return data as BusTrip
}

export interface TripInput {
  name: string
  description?: string | null
  pickup_time?: string | null
  drop_time?: string | null
  default_driver_id?: string | null
  active?: boolean
}

export async function createTrip(input: TripInput): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('transport_routes')
    .insert({ ...input, created_by: user?.id })
    .select('id')
    .single()
  if (error) { console.error('createTrip failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

export async function updateTrip(tripId: string, input: Partial<TripInput>): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_routes').update(input).eq('id', tripId)
  if (error) { console.error('updateTrip failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function setTripActive(tripId: string, active: boolean): Promise<{ success: boolean; error?: string }> {
  return updateTrip(tripId, { active })
}

// ============================================
// Passengers
//
// Assignment management now lives in src/lib/transport/assignments.ts against
// the renamed transport_student_assignments table. What remains here is only
// what the legacy driver roster and the bus-fee draft importer still read.
// ============================================

export async function fetchTripPassengers(tripId: string): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('transport_student_assignments')
    .select('passenger:profiles!student_id(*)')
    .eq('route_id', tripId)
    .is('ended_on', null)
  if (error) { console.error('fetchTripPassengers failed:', error); return [] }
  const rows = (data as unknown as { passenger: UserProfile | null }[]) || []
  return rows
    .map(r => r.passenger)
    .filter((p): p is UserProfile => !!p)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

/**
 * Anyone a bus fee can be issued to: any profile that is not an admin or a
 * driver. Bus fees are overwhelmingly a student thing, but staff riders do
 * exist, so the set is deliberately wider than `role = 'student'`.
 */
export async function fetchAssignablePassengers(): Promise<UserProfile[]> {
  const excluded: UserRole[] = ['admin', 'driver']
  const { data, error } = await supabase
    .from('profiles')
    // Not select('*'): profiles is joined from ~50 places and a wildcard here
    // is the single biggest egress multiplier in the app (README conventions).
    .select('id, email, full_name, role, avatar_url, grade, section, created_at, updated_at')
    .not('role', 'in', `(${excluded.join(',')})`)
    .order('full_name', { ascending: true })
  if (error) { console.error('fetchAssignablePassengers failed:', error); return [] }
  return (data as UserProfile[]) || []
}

/** A route rider with the per-route fee + pickup label the admin set. */
export interface TripPassengerDetail {
  passenger_id: string
  fee_amount: number | null
  location: string | null
  passenger?: UserProfile | null
}

/** Riders with their fee amount + pickup label, used by "Import trip" in a Bulk
 *  Issue. Aliased back to the old field names so the fee screens are untouched. */
export async function fetchTripPassengersDetailed(tripId: string): Promise<TripPassengerDetail[]> {
  const { data, error } = await supabase
    .from('transport_student_assignments')
    .select('passenger_id:student_id, fee_amount, location:location_label, passenger:profiles!student_id(*)')
    .eq('route_id', tripId)
    .is('ended_on', null)
  if (error) { console.error('fetchTripPassengersDetailed failed:', error); return [] }
  const rows = (data as unknown as TripPassengerDetail[]) || []
  return rows.sort((a, b) => (a.passenger?.full_name ?? '').localeCompare(b.passenger?.full_name ?? ''))
}

// ============================================
// Drivers & per-date overrides
// ============================================

export async function fetchDrivers(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'driver')
    .order('full_name', { ascending: true })
  if (error) { console.error('fetchDrivers failed:', error); return [] }
  return (data as UserProfile[]) || []
}

export async function fetchDriverOverrides(tripId: string): Promise<TripDriverOverride[]> {
  const { data, error } = await supabase
    .from('trip_driver_overrides')
    .select('*, driver:profiles!driver_id(*)')
    .eq('trip_id', tripId)
    .order('date', { ascending: true })
  if (error) { console.error('fetchDriverOverrides failed:', error); return [] }
  return (data as TripDriverOverride[]) || []
}

export async function setDriverOverride(
  tripId: string,
  date: string,
  driverId: string,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('trip_driver_overrides')
    .upsert(
      { trip_id: tripId, date, driver_id: driverId, note: note ?? null, created_by: user?.id },
      { onConflict: 'trip_id,date' },
    )
  if (error) { console.error('setDriverOverride failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function clearDriverOverride(tripId: string, date: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('trip_driver_overrides')
    .delete()
    .eq('trip_id', tripId)
    .eq('date', date)
  if (error) { console.error('clearDriverOverride failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** The driver responsible for a trip on a date: override if present, else default. */
export async function resolveDriverForDate(tripId: string, date: string): Promise<string | null> {
  const { data: override } = await supabase
    .from('trip_driver_overrides')
    .select('driver_id')
    .eq('trip_id', tripId)
    .eq('date', date)
    .maybeSingle()
  if (override?.driver_id) return override.driver_id
  const { data: trip } = await supabase
    .from('transport_routes')
    .select('default_driver_id')
    .eq('id', tripId)
    .single()
  return trip?.default_driver_id ?? null
}

/** Trips a given driver actually drives on `date` (default driver, minus days
 *  overridden to someone else, plus days overridden to them). */
export async function fetchDriverTripsForDate(driverId: string, date: string): Promise<BusTrip[]> {
  const { data: overrides } = await supabase
    .from('trip_driver_overrides')
    .select('trip_id, driver_id')
    .eq('date', date)
  const overrideByTrip = new Map<string, string>()
  for (const o of overrides || []) overrideByTrip.set(o.trip_id, o.driver_id)

  const { data: trips, error } = await supabase
    .from('transport_routes')
    .select('*, default_driver:profiles!default_driver_id(*)')
    .eq('active', true)
  if (error) { console.error('fetchDriverTripsForDate failed:', error); return [] }

  const result = (trips as BusTrip[] || []).filter(t => {
    const overrideDriver = overrideByTrip.get(t.id)
    if (overrideDriver) return overrideDriver === driverId
    return t.default_driver_id === driverId
  })
  // Trips overridden TO this driver but where they aren't the default may not be
  // in `trips` if RLS excluded them — but is_trip_driver covers override holders,
  // so they are readable; the filter above keeps them. Sort by pickup time.
  return result.sort((a, b) => (a.pickup_time ?? '').localeCompare(b.pickup_time ?? ''))
}

// ============================================
// Attendance
// ============================================

export async function fetchTripAttendance(tripId: string, date: string): Promise<TripAttendance[]> {
  const { data, error } = await supabase
    .from('trip_attendance')
    .select('*')
    .eq('trip_id', tripId)
    .eq('date', date)
  if (error) { console.error('fetchTripAttendance failed:', error); return [] }
  return (data as TripAttendance[]) || []
}

/** A trip roster for `date`: every assigned passenger paired with their record (if any). */
export async function fetchTripRoster(tripId: string, date: string): Promise<TripRosterRow[]> {
  const [passengers, records] = await Promise.all([
    fetchTripPassengers(tripId),
    fetchTripAttendance(tripId, date),
  ])
  const byPassenger = new Map(records.map(r => [r.passenger_id, r]))
  return passengers.map(passenger => ({ passenger, record: byPassenger.get(passenger.id) ?? null }))
}

export async function markPassenger(
  tripId: string,
  passengerId: string,
  date: string,
  status: TripAttendanceStatus,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const now = new Date().toISOString()
  const row: Record<string, unknown> = {
    trip_id: tripId,
    passenger_id: passengerId,
    date,
    status,
    marked_by: user?.id,
  }
  if (status === 'picked_up') row.picked_up_at = now
  if (status === 'dropped') row.dropped_at = now

  const { error } = await supabase
    .from('trip_attendance')
    .upsert(row, { onConflict: 'trip_id,passenger_id,date' })
  if (error) { console.error('markPassenger failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Fee heads (reusable catalogue)
// ============================================

export async function fetchBusFeeHeads(): Promise<BusFeeHead[]> {
  const { data, error } = await supabase
    .from('bus_fee_heads')
    .select('*')
    .order('name', { ascending: true })
  if (error) { console.error('fetchBusFeeHeads failed:', error); return [] }
  return (data as BusFeeHead[]) || []
}

export interface BusFeeHeadInput {
  name: string
  description?: string | null
  default_amount: number
  active?: boolean
}

export async function createBusFeeHead(input: BusFeeHeadInput): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('bus_fee_heads')
    .insert({ ...input, created_by: user?.id })
    .select('id')
    .single()
  if (error) { console.error('createBusFeeHead failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

export async function updateBusFeeHead(headId: string, input: Partial<BusFeeHeadInput>): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('bus_fee_heads').update(input).eq('id', headId)
  if (error) { console.error('updateBusFeeHead failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function setBusFeeHeadActive(headId: string, active: boolean): Promise<{ success: boolean; error?: string }> {
  return updateBusFeeHead(headId, { active })
}

/** Delete a bus fee head — refused if any fee under it has a payment recorded
 *  against it. Fees with no payments are unlinked via ON DELETE SET NULL. */
export async function deleteBusFeeHead(headId: string): Promise<{ success: boolean; error?: string }> {
  const { data: fees } = await supabase.from('bus_fees').select('id').eq('fee_head_id', headId)
  const feeIds = (fees ?? []).map(f => f.id)
  if (feeIds.length) {
    const { count, error: cErr } = await supabase
      .from('bus_payments')
      .select('id', { count: 'exact', head: true })
      .in('fee_id', feeIds)
    if (cErr) { console.error('deleteBusFeeHead(count) failed:', cErr); return { success: false, error: cErr.message } }
    if ((count ?? 0) > 0) {
      return { success: false, error: 'This bus fee head has payments recorded against it and cannot be deleted.' }
    }
  }
  const { error } = await supabase.from('bus_fee_heads').delete().eq('id', headId)
  if (error) { console.error('deleteBusFeeHead failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Fees & collection
// ============================================

export async function fetchFeesForPassenger(passengerId: string): Promise<BusFee[]> {
  const { data, error } = await supabase
    .from('bus_fees')
    .select('*, route:transport_routes!route_id(id, name), fee_head:bus_fee_heads!fee_head_id(id, name)')
    .eq('passenger_id', passengerId)
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchFeesForPassenger failed:', error); return [] }
  return (data as BusFee[]) || []
}

export async function fetchAllFees(): Promise<BusFee[]> {
  const { data, error } = await supabase
    .from('bus_fees')
    .select('*, passenger:profiles!passenger_id(*), route:transport_routes!route_id(id, name), fee_head:bus_fee_heads!fee_head_id(id, name)')
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchAllFees failed:', error); return [] }
  return (data as BusFee[]) || []
}

/**
 * @param paidByFee Verified amount collected per fee id. When supplied, partial
 *   fees split their billed amount between `collected_amount` (received so far)
 *   and `outstanding_amount` (still due) instead of counting the whole bill as
 *   outstanding.
 */
export function summarizeFees(fees: BusFee[], paidByFee?: Map<string, number>): FeeCollectionSummary {
  const summary: FeeCollectionSummary = {
    total_amount: 0, collected_amount: 0, outstanding_amount: 0,
    paid_count: 0, unpaid_count: 0, partial_count: 0, cancelled_count: 0, total_count: fees.length,
  }
  for (const f of fees) {
    const amt = Number(f.amount) || 0
    if (f.status === 'cancelled') { summary.cancelled_count++; continue }
    summary.total_amount += amt
    if (f.status === 'paid') { summary.collected_amount += amt; summary.paid_count++ }
    else if (f.status === 'partial') {
      summary.partial_count++
      const paid = Math.min(amt, paidByFee?.get(f.id) ?? 0)
      summary.collected_amount += paid
      summary.outstanding_amount += amt - paid
    }
    else { summary.unpaid_count++; summary.outstanding_amount += amt }
  }
  return summary
}

export interface FeeInput {
  passenger_id: string
  route_id?: string | null
  fee_head_id?: string | null
  amount: number
  description?: string | null
  due_date?: string | null
}

export async function createFee(input: FeeInput): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('bus_fees')
    .insert({ ...input, created_by: user?.id })
    .select('id')
    .single()
  if (error) { console.error('createFee failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

/** Issue the same fee to many passengers at once. */
export async function createFeesBulk(inputs: FeeInput[]): Promise<{ success: boolean; error?: string }> {
  if (inputs.length === 0) return { success: true }
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('bus_fees')
    .insert(inputs.map(i => ({ ...i, created_by: user?.id })))
  if (error) { console.error('createFeesBulk failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function setFeeStatus(feeId: string, status: BusFeeStatus): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('bus_fees').update({ status }).eq('id', feeId)
  if (error) { console.error('setFeeStatus failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function cancelFee(feeId: string): Promise<{ success: boolean; error?: string }> {
  return setFeeStatus(feeId, 'cancelled')
}

// ============================================
// Payments
// ============================================

export async function fetchPaymentsForFee(feeId: string): Promise<BusPayment[]> {
  const { data, error } = await supabase
    .from('bus_payments')
    .select('*')
    .eq('fee_id', feeId)
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchPaymentsForFee failed:', error); return [] }
  return (data as BusPayment[]) || []
}

/** A verified bus payment with enough fee context to print a receipt. */
export interface PassengerPayment extends BusPayment {
  fee?: (Pick<BusFee, 'id' | 'amount' | 'description' | 'upi_reference' | 'due_date' | 'created_at' | 'updated_at' | 'fee_head_id' | 'passenger_id'> & {
    fee_head?: Pick<BusFeeHead, 'id' | 'name'> | null
  }) | null
}

/** Every verified payment a single passenger has made, newest first — backs the
 *  per-passenger Fee Receipt picker in the bus statements popup. */
export async function fetchVerifiedPaymentsForPassenger(passengerId: string): Promise<PassengerPayment[]> {
  const { data, error } = await supabase
    .from('bus_payments')
    .select('*, fee:bus_fees!fee_id!inner(id, amount, description, upi_reference, due_date, created_at, updated_at, fee_head_id, passenger_id, fee_head:bus_fee_heads!fee_head_id(id, name))')
    .eq('status', 'verified')
    .eq('fee.passenger_id', passengerId)
    .order('verified_at', { ascending: false })
  if (error) { console.error('fetchVerifiedPaymentsForPassenger failed:', error); return [] }
  return (data as unknown as PassengerPayment[]) || []
}

/** A passenger logs that they paid a fee via UPI QR; admin verifies later. */
export async function recordUpiClaim(
  feeId: string,
  amount: number,
  upiTxnRef: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('bus_payments').insert({
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
export interface PendingPayment extends BusPayment {
  fee?: (Pick<BusFee, 'id' | 'amount' | 'description' | 'upi_reference'> & { passenger?: UserProfile | null }) | null
}

export async function fetchPendingPayments(): Promise<PendingPayment[]> {
  const { data, error } = await supabase
    .from('bus_payments')
    .select('*, fee:bus_fees!fee_id(id, amount, description, upi_reference, passenger:profiles!passenger_id(*))')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchPendingPayments failed:', error); return [] }
  return (data as unknown as PendingPayment[]) || []
}

/** Admin confirms a payment claim: mark the payment verified and the fee paid. */
export async function verifyPayment(paymentId: string, feeId: string): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error: pErr } = await supabase
    .from('bus_payments')
    .update({ status: 'verified', verified_by: user?.id, verified_at: new Date().toISOString() })
    .eq('id', paymentId)
  if (pErr) { console.error('verifyPayment(payment) failed:', pErr); return { success: false, error: pErr.message } }
  const { error: fErr } = await supabase.from('bus_fees').update({ status: 'paid' }).eq('id', feeId)
  if (fErr) { console.error('verifyPayment(fee) failed:', fErr); return { success: false, error: fErr.message } }
  return { success: true }
}

export async function rejectPayment(paymentId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('bus_payments').update({ status: 'failed' }).eq('id', paymentId)
  if (error) { console.error('rejectPayment failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function fetchBusCollectionReport(filter: { from?: string; to?: string; methods?: BusPaymentMethod[] } = {}): Promise<BusCollectionRow[]> {
  let q = supabase
    .from('bus_payments')
    .select('*, fee:bus_fees!fee_id(id, amount, status, description, upi_reference, passenger:profiles!passenger_id(*), fee_head:bus_fee_heads!fee_head_id(id, name))')
    .eq('status', 'verified')
    .order('verified_at', { ascending: false })
  if (filter.from) q = q.gte('verified_at', filter.from)
  if (filter.to) q = q.lte('verified_at', filter.to)
  if (filter.methods?.length) q = q.in('method', filter.methods)
  const { data, error } = await q
  if (error) { console.error('fetchBusCollectionReport failed:', error); return [] }
  return (data as unknown as BusCollectionRow[]) || []
}

export async function recordBusOfflinePayment(
  feeId: string,
  method: BusPaymentMethod,
  amount: number,
  reference?: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const now = new Date().toISOString()
  const { error: pErr } = await supabase.from('bus_payments').insert({
    fee_id: feeId, payer_id: user?.id, method, amount,
    status: 'verified', verified_by: user?.id, verified_at: now,
    upi_txn_ref: reference?.trim() || null,
  })
  if (pErr) { console.error('recordBusOfflinePayment(payment) failed:', pErr); return { success: false, error: pErr.message } }
  const [{ data: fee }, { data: pays }] = await Promise.all([
    supabase.from('bus_fees').select('amount').eq('id', feeId).single(),
    supabase.from('bus_payments').select('amount').eq('fee_id', feeId).eq('status', 'verified'),
  ])
  const billed = Number(fee?.amount) || 0
  const paid = (pays ?? []).reduce((s: number, p: { amount: unknown }) => s + (Number(p.amount) || 0), 0)
  const status: BusFeeStatus = paid >= billed ? 'paid' : 'partial'
  const { error: fErr } = await supabase.from('bus_fees').update({ status }).eq('id', feeId)
  if (fErr) { console.error('recordBusOfflinePayment(fee) failed:', fErr); return { success: false, error: fErr.message } }
  return { success: true }
}

// ============================================
// Payment configuration (site_settings)
// ============================================

export interface RazorpayConfig {
  enabled: boolean
  key_id: string
}

export interface UpiConfig {
  vpa: string
  payee_name: string
}

export async function fetchRazorpayConfig(): Promise<RazorpayConfig> {
  const { data } = await supabase.from('site_settings').select('value').eq('key', 'razorpay_config').maybeSingle()
  const v = (data?.value ?? {}) as Partial<RazorpayConfig>
  return { enabled: v.enabled ?? false, key_id: v.key_id ?? '' }
}

export async function saveRazorpayConfig(config: RazorpayConfig): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'razorpay_config', value: config as unknown as Record<string, unknown> }, { onConflict: 'key' })
  if (error) { console.error('saveRazorpayConfig failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export interface SmartCollectConfig {
  enabled: boolean
  mode: 'reference' | 'virtual_vpa'
  provider_name: string
}

export async function fetchSmartCollectConfig(): Promise<SmartCollectConfig> {
  const { data } = await supabase.from('site_settings').select('value').eq('key', 'smart_collect_config').maybeSingle()
  const v = (data?.value ?? {}) as Partial<SmartCollectConfig>
  return { enabled: v.enabled ?? false, mode: v.mode ?? 'reference', provider_name: v.provider_name ?? '' }
}

export async function saveSmartCollectConfig(config: SmartCollectConfig): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'smart_collect_config', value: config as unknown as Record<string, unknown> }, { onConflict: 'key' })
  if (error) { console.error('saveSmartCollectConfig failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Start a Smart Collect UPI payment; returns the VPA + reference to pay to. */
export async function startUpiCollect(feeId: string): Promise<{
  success: boolean; vpa?: string; reference?: string; payee_name?: string; amount?: number; error?: string
}> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { success: false, error: 'Not authenticated' }
  try {
    const res = await fetch('/api/bus/upi/create-collect', {
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

/** Lightweight status read used to poll for auto-confirmation. */
export async function fetchFeeStatus(feeId: string): Promise<BusFeeStatus | null> {
  const { data, error } = await supabase.from('bus_fees').select('status').eq('id', feeId).maybeSingle()
  if (error) { console.error('fetchFeeStatus failed:', error); return null }
  return (data?.status as BusFeeStatus) ?? null
}

export async function fetchUpiConfig(): Promise<UpiConfig> {
  const { data } = await supabase.from('site_settings').select('value').eq('key', 'upi_config').maybeSingle()
  const v = (data?.value ?? {}) as Partial<UpiConfig>
  return { vpa: v.vpa ?? '', payee_name: v.payee_name ?? '' }
}

export async function saveUpiConfig(config: UpiConfig): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'upi_config', value: config as unknown as Record<string, unknown> }, { onConflict: 'key' })
  if (error) { console.error('saveUpiConfig failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Create a Razorpay order for a fee via the server route; returns checkout params. */
export async function createRazorpayOrder(feeId: string): Promise<{
  success: boolean; order_id?: string; key_id?: string; amount?: number; error?: string
}> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { success: false, error: 'Not authenticated' }
  try {
    const res = await fetch('/api/bus/razorpay/create-order', {
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

/** Build a UPI deep link for a fee (rendered as a QR by the payment modal). */
export function buildUpiLink(opts: { vpa: string; payeeName: string; amount: number; note: string }): string {
  const params = new URLSearchParams({
    pa: opts.vpa,
    pn: opts.payeeName,
    am: opts.amount.toFixed(2),
    cu: 'INR',
    tn: opts.note,
  })
  return `upi://pay?${params.toString()}`
}

// ============================================
// Driver bank accounts (admin-managed; driver read-only)
// ============================================

/** Mask all but the last 4 digits of an account number for display. */
export function maskAccountNumber(acc: string): string {
  const s = (acc || '').trim()
  if (s.length <= 4) return s
  return '••••' + s.slice(-4)
}

/** All driver bank accounts (admin). Caller keys them by driver_id. */
export async function fetchDriverBankAccounts(): Promise<DriverBankAccount[]> {
  const { data, error } = await supabase.from('driver_bank_accounts').select('*')
  if (error) { console.error('fetchDriverBankAccounts failed:', error); return [] }
  return (data as DriverBankAccount[]) || []
}

/** The current driver's own bank account (driver self-view). */
export async function fetchMyDriverBankAccount(driverId: string): Promise<DriverBankAccount | null> {
  const { data, error } = await supabase
    .from('driver_bank_accounts')
    .select('*')
    .eq('driver_id', driverId)
    .maybeSingle()
  if (error) { console.error('fetchMyDriverBankAccount failed:', error); return null }
  return (data as DriverBankAccount) ?? null
}

export interface DriverBankAccountInput {
  driver_id: string
  account_holder_name: string
  account_number: string
  ifsc: string
  bank_name?: string | null
}

export async function upsertDriverBankAccount(input: DriverBankAccountInput): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('driver_bank_accounts')
    .upsert({ ...input, created_by: user?.id }, { onConflict: 'driver_id' })
  if (error) { console.error('upsertDriverBankAccount failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function deleteDriverBankAccount(driverId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('driver_bank_accounts').delete().eq('driver_id', driverId)
  if (error) { console.error('deleteDriverBankAccount failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================
// Payroll disbursement (bank payouts)
// ------------------------------------------------------------
// Driver salaries are disbursed through the SAME site-wide payout
// provider the Salary Manager uses (site_settings key='payout_config').
// The provider config helpers are re-exported from ./salary so the bank
// is linked once for the whole organisation.
// ============================================

export type { PayoutConfig } from './salary'
export { fetchPayoutConfig, savePayoutConfig } from './salary'

// ============================================
// Live location & ETA
// ============================================

export async function pushLocation(
  tripId: string,
  pos: { lat: number; lng: number; heading?: number | null; speed?: number | null; accuracy?: number | null },
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('bus_locations').insert({
    trip_id: tripId,
    driver_id: user?.id,
    lat: pos.lat,
    lng: pos.lng,
    heading: pos.heading ?? null,
    speed: pos.speed ?? null,
    accuracy: pos.accuracy ?? null,
  })
  if (error) { console.error('pushLocation failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function fetchLatestLocation(tripId: string): Promise<BusLocation | null> {
  const { data, error } = await supabase
    .from('bus_locations')
    .select('*')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) { console.error('fetchLatestLocation failed:', error); return null }
  return (data as BusLocation) ?? null
}

/** Great-circle distance in kilometres between two lat/lng points. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Rough ETA in minutes from bus to passenger, straight-line at an assumed speed. */
export function estimateEtaMinutes(
  bus: { lat: number; lng: number },
  passenger: { lat: number; lng: number },
  avgSpeedKmh = 25,
): number {
  const km = haversineKm(bus, passenger)
  return Math.max(1, Math.round((km / avgSpeedKmh) * 60))
}

// ============================================
// Monthly Fee Drafts
// ============================================

export type BusFeeDraftStatus = 'draft' | 'issued'

export interface BusFeeDraft {
  id: string
  title: string
  month: string
  route_id: string | null
  fee_head_id: string | null
  description: string | null
  due_date: string | null
  status: BusFeeDraftStatus
  issued_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  route?: Pick<BusTrip, 'id' | 'name'> | null
  fee_head?: Pick<BusFeeHead, 'id' | 'name'> | null
  passenger_count?: number
}

export interface BusFeeDraftInput {
  title: string
  month: string
  route_id?: string | null
  fee_head_id?: string | null
  description?: string | null
  due_date?: string | null
}

export interface BusFeeDraftPassenger {
  id: string
  draft_id: string
  passenger_id: string
  amount: number | null
  description: string | null
  created_at: string
  passenger?: UserProfile | null
}

export async function fetchBusFeeDrafts(): Promise<BusFeeDraft[]> {
  const { data, error } = await supabase
    .from('bus_fee_drafts')
    .select('*, route:transport_routes!route_id(id, name), fee_head:bus_fee_heads!fee_head_id(id, name)')
    .order('month', { ascending: false })
  if (error) { console.error('fetchBusFeeDrafts failed:', error); return [] }

  const drafts = (data as BusFeeDraft[]) || []
  if (drafts.length === 0) return []

  const ids = drafts.map(d => d.id)
  const { data: counts } = await supabase
    .from('bus_fee_draft_passengers')
    .select('draft_id')
    .in('draft_id', ids)

  const countMap: Record<string, number> = {}
  for (const r of (counts || []) as { draft_id: string }[]) {
    countMap[r.draft_id] = (countMap[r.draft_id] ?? 0) + 1
  }

  return drafts.map(d => ({ ...d, passenger_count: countMap[d.id] ?? 0 }))
}

export async function fetchBusFeeDraft(draftId: string): Promise<BusFeeDraft | null> {
  const { data, error } = await supabase
    .from('bus_fee_drafts')
    .select('*, route:transport_routes!route_id(id, name), fee_head:bus_fee_heads!fee_head_id(id, name)')
    .eq('id', draftId)
    .single()
  if (error) { console.error('fetchBusFeeDraft failed:', error); return null }

  const draft = data as BusFeeDraft
  const { data: counts } = await supabase
    .from('bus_fee_draft_passengers')
    .select('draft_id')
    .eq('draft_id', draftId)

  return { ...draft, passenger_count: (counts || []).length }
}

export async function createBusFeeDraft(input: BusFeeDraftInput): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('bus_fee_drafts')
    .insert({ ...input, created_by: user?.id })
    .select('id')
    .single()
  if (error) { console.error('createBusFeeDraft failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

export async function updateBusFeeDraft(draftId: string, input: Partial<BusFeeDraftInput>): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('bus_fee_drafts').update(input).eq('id', draftId)
  if (error) { console.error('updateBusFeeDraft failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function deleteBusFeeDraft(draftId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('bus_fee_drafts').delete().eq('id', draftId)
  if (error) { console.error('deleteBusFeeDraft failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function fetchDraftPassengersWithAmounts(draftId: string): Promise<BusFeeDraftPassenger[]> {
  const { data, error } = await supabase
    .from('bus_fee_draft_passengers')
    .select('*, passenger:profiles!passenger_id(*)')
    .eq('draft_id', draftId)
    .order('created_at', { ascending: true })
  if (error) { console.error('fetchDraftPassengersWithAmounts failed:', error); return [] }
  return (data as unknown as BusFeeDraftPassenger[]) || []
}

export async function addDraftPassenger(draftId: string, passengerId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('bus_fee_draft_passengers')
    .insert({ draft_id: draftId, passenger_id: passengerId })
  if (error) { console.error('addDraftPassenger failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Pull every passenger from a linked trip into a Bulk Issue, carrying each
 *  passenger's per-trip fee amount (→ amount) and location (→ note). Existing
 *  draft rows are refreshed; rows the admin already edited keep their values
 *  unless the trip has a value to fill an empty cell. */
export async function importTripPassengersIntoDraft(
  draftId: string,
  tripId: string,
): Promise<{ success: boolean; added: number; error?: string }> {
  const tripPax = await fetchTripPassengersDetailed(tripId)
  if (tripPax.length === 0) return { success: true, added: 0 }

  const { data: existing, error: exErr } = await supabase
    .from('bus_fee_draft_passengers')
    .select('passenger_id, amount, description')
    .eq('draft_id', draftId)
  if (exErr) { console.error('importTripPassengersIntoDraft fetch failed:', exErr); return { success: false, added: 0, error: exErr.message } }

  const existingMap = new Map(
    (existing || []).map((r: { passenger_id: string; amount: number | null; description: string | null }) => [r.passenger_id, r]),
  )

  const rows = tripPax.map(p => {
    const cur = existingMap.get(p.passenger_id)
    return {
      draft_id: draftId,
      passenger_id: p.passenger_id,
      // Only fill empty cells from the trip so manual edits are never clobbered.
      amount: (cur?.amount ?? null) != null ? cur!.amount : p.fee_amount,
      description: (cur?.description && cur.description.trim()) ? cur.description : p.location,
    }
  })

  const added = rows.filter(r => !existingMap.has(r.passenger_id)).length
  const { error } = await supabase
    .from('bus_fee_draft_passengers')
    .upsert(rows, { onConflict: 'draft_id,passenger_id' })
  if (error) { console.error('importTripPassengersIntoDraft upsert failed:', error); return { success: false, added: 0, error: error.message } }
  return { success: true, added }
}

export async function removeDraftPassenger(draftId: string, passengerId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('bus_fee_draft_passengers')
    .delete()
    .eq('draft_id', draftId)
    .eq('passenger_id', passengerId)
  if (error) { console.error('removeDraftPassenger failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function updateDraftPassengerFee(
  draftId: string,
  passengerId: string,
  amount: number | null,
  description?: string | null,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('bus_fee_draft_passengers')
    .update({ amount, description: description ?? null })
    .eq('draft_id', draftId)
    .eq('passenger_id', passengerId)
  if (error) { console.error('updateDraftPassengerFee failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Issue individual fees to every student in a draft and mark it as issued. */
export async function issueDraft(draftId: string): Promise<{ success: boolean; count?: number; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()

  const { data: draft, error: draftErr } = await supabase
    .from('bus_fee_drafts')
    .select('*')
    .eq('id', draftId)
    .single()
  if (draftErr || !draft) { console.error('issueDraft fetch draft failed:', draftErr); return { success: false, error: 'Draft not found' } }

  const { data: rows, error: pErr } = await supabase
    .from('bus_fee_draft_passengers')
    .select('passenger_id, amount, description')
    .eq('draft_id', draftId)
  if (pErr) { console.error('issueDraft fetch passengers failed:', pErr); return { success: false, error: pErr.message } }

  const passengers = (rows || []) as { passenger_id: string; amount: number | null; description: string | null }[]
  if (passengers.length === 0) return { success: false, error: 'No students in this draft' }

  const missing = passengers.filter(p => !p.amount || Number(p.amount) <= 0)
  if (missing.length > 0) {
    return { success: false, error: `${missing.length} student${missing.length === 1 ? ' has' : 's have'} no fee amount set` }
  }

  const fees = passengers.map(p => ({
    passenger_id: p.passenger_id,
    route_id: (draft.route_id as string | null) ?? null,
    fee_head_id: (draft.fee_head_id as string | null) ?? null,
    amount: p.amount!,
    description: p.description || (draft.description as string | null) || (draft.title as string),
    due_date: (draft.due_date as string | null) ?? null,
    created_by: user?.id,
  }))

  const { error: feesErr } = await supabase.from('bus_fees').insert(fees)
  if (feesErr) { console.error('issueDraft insert fees failed:', feesErr); return { success: false, error: feesErr.message } }

  const { error: updateErr } = await supabase
    .from('bus_fee_drafts')
    .update({ status: 'issued', issued_at: new Date().toISOString() })
    .eq('id', draftId)
  if (updateErr) { console.error('issueDraft update status failed:', updateErr); return { success: false, error: updateErr.message } }

  return { success: true, count: passengers.length }
}
