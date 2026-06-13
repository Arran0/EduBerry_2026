import { supabase, UserProfile, UserRole } from './supabase'

// ============================================
// Types
// ============================================

export type TripAttendanceStatus = 'picked_up' | 'dropped' | 'absent'
export type BusFeeStatus = 'unpaid' | 'partial' | 'paid' | 'cancelled'
export type BusPaymentMethod = 'razorpay' | 'upi_qr' | 'cash'
export type BusPaymentStatus = 'pending' | 'verified' | 'failed'
export type PayrollStatus = 'draft' | 'approved' | 'paid'

export interface BusTrip {
  id: string
  name: string
  route_description: string | null
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

export interface BusFee {
  id: string
  trip_id: string | null
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
  trip?: Pick<BusTrip, 'id' | 'name'> | null
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

export interface DriverPayroll {
  id: string
  driver_id: string
  period_start: string
  period_end: string
  base_amount: number
  status: PayrollStatus
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  items?: DriverPayrollItem[]
  driver?: UserProfile | null
}

export interface DriverPayrollItem {
  id: string
  payroll_id: string
  label: string
  amount: number
  created_at: string
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
    .from('bus_trips')
    .select('*, default_driver:profiles!default_driver_id(*)')
    .order('name', { ascending: true })
  if (error) { console.error('fetchTrips failed:', error); return [] }
  return (data as BusTrip[]) || []
}

export async function fetchTrip(tripId: string): Promise<BusTrip | null> {
  const { data, error } = await supabase
    .from('bus_trips')
    .select('*, default_driver:profiles!default_driver_id(*)')
    .eq('id', tripId)
    .single()
  if (error) { console.error('fetchTrip failed:', error); return null }
  return data as BusTrip
}

export interface TripInput {
  name: string
  route_description?: string | null
  pickup_time?: string | null
  drop_time?: string | null
  default_driver_id?: string | null
  active?: boolean
}

export async function createTrip(input: TripInput): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('bus_trips')
    .insert({ ...input, created_by: user?.id })
    .select('id')
    .single()
  if (error) { console.error('createTrip failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

export async function updateTrip(tripId: string, input: Partial<TripInput>): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('bus_trips').update(input).eq('id', tripId)
  if (error) { console.error('updateTrip failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function setTripActive(tripId: string, active: boolean): Promise<{ success: boolean; error?: string }> {
  return updateTrip(tripId, { active })
}

// ============================================
// Passengers
// ============================================

export async function fetchTripPassengers(tripId: string): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('trip_passengers')
    .select('passenger:profiles!passenger_id(*)')
    .eq('trip_id', tripId)
  if (error) { console.error('fetchTripPassengers failed:', error); return [] }
  const rows = (data as unknown as { passenger: UserProfile | null }[]) || []
  return rows
    .map(r => r.passenger)
    .filter((p): p is UserProfile => !!p)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

/** Passenger count per trip, keyed by trip_id (admin overview). */
export async function fetchTripPassengerCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('trip_passengers').select('trip_id')
  if (error) { console.error('fetchTripPassengerCounts failed:', error); return {} }
  const counts: Record<string, number> = {}
  for (const r of (data || []) as { trip_id: string }[]) {
    counts[r.trip_id] = (counts[r.trip_id] ?? 0) + 1
  }
  return counts
}

/** Anyone who can be a passenger: any profile that is not an admin or a driver. */
export async function fetchAssignablePassengers(): Promise<UserProfile[]> {
  const excluded: UserRole[] = ['admin', 'driver']
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .not('role', 'in', `(${excluded.join(',')})`)
    .order('full_name', { ascending: true })
  if (error) { console.error('fetchAssignablePassengers failed:', error); return [] }
  return (data as UserProfile[]) || []
}

/** Reconcile a trip's passenger set to exactly `passengerIds` (diff insert/delete). */
export async function setTripPassengers(tripId: string, passengerIds: string[]): Promise<{ success: boolean; error?: string }> {
  const { data: existing, error: fetchErr } = await supabase
    .from('trip_passengers')
    .select('passenger_id')
    .eq('trip_id', tripId)
  if (fetchErr) { console.error('setTripPassengers fetch failed:', fetchErr); return { success: false, error: fetchErr.message } }

  const current = new Set((existing || []).map((r: { passenger_id: string }) => r.passenger_id))
  const target = new Set(passengerIds)
  const toAdd = passengerIds.filter(id => !current.has(id))
  const toRemove = [...current].filter(id => !target.has(id))

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('trip_passengers')
      .insert(toAdd.map(passenger_id => ({ trip_id: tripId, passenger_id })))
    if (error) { console.error('setTripPassengers insert failed:', error); return { success: false, error: error.message } }
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('trip_passengers')
      .delete()
      .eq('trip_id', tripId)
      .in('passenger_id', toRemove)
    if (error) { console.error('setTripPassengers delete failed:', error); return { success: false, error: error.message } }
  }
  return { success: true }
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
    .from('bus_trips')
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
    .from('bus_trips')
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
// Fees & collection
// ============================================

export async function fetchFeesForPassenger(passengerId: string): Promise<BusFee[]> {
  const { data, error } = await supabase
    .from('bus_fees')
    .select('*, trip:bus_trips!trip_id(id, name)')
    .eq('passenger_id', passengerId)
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchFeesForPassenger failed:', error); return [] }
  return (data as BusFee[]) || []
}

export async function fetchAllFees(): Promise<BusFee[]> {
  const { data, error } = await supabase
    .from('bus_fees')
    .select('*, passenger:profiles!passenger_id(*), trip:bus_trips!trip_id(id, name)')
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchAllFees failed:', error); return [] }
  return (data as BusFee[]) || []
}

export function summarizeFees(fees: BusFee[]): FeeCollectionSummary {
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
  passenger_id: string
  trip_id?: string | null
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
// Payroll
// ============================================

export async function fetchPayrollForDriver(driverId: string): Promise<DriverPayroll[]> {
  const { data, error } = await supabase
    .from('driver_payroll')
    .select('*, items:driver_payroll_items(*)')
    .eq('driver_id', driverId)
    .order('period_start', { ascending: false })
  if (error) { console.error('fetchPayrollForDriver failed:', error); return [] }
  return (data as DriverPayroll[]) || []
}

export async function fetchAllPayroll(): Promise<DriverPayroll[]> {
  const { data, error } = await supabase
    .from('driver_payroll')
    .select('*, items:driver_payroll_items(*), driver:profiles!driver_id(*)')
    .order('period_start', { ascending: false })
  if (error) { console.error('fetchAllPayroll failed:', error); return [] }
  return (data as DriverPayroll[]) || []
}

export interface PayrollInput {
  driver_id: string
  period_start: string
  period_end: string
  base_amount: number
  notes?: string | null
}

export async function createPayroll(input: PayrollInput): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('driver_payroll')
    .insert({ ...input, created_by: user?.id })
    .select('id')
    .single()
  if (error) { console.error('createPayroll failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

export async function addPayrollItem(payrollId: string, label: string, amount: number): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('driver_payroll_items')
    .insert({ payroll_id: payrollId, label, amount })
  if (error) { console.error('addPayrollItem failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function deletePayrollItem(itemId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('driver_payroll_items').delete().eq('id', itemId)
  if (error) { console.error('deletePayrollItem failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function setPayrollStatus(payrollId: string, status: PayrollStatus): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('driver_payroll').update({ status }).eq('id', payrollId)
  if (error) { console.error('setPayrollStatus failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Net pay = base + sum(items). */
export function payrollNet(payroll: DriverPayroll): number {
  const items = payroll.items ?? []
  return Number(payroll.base_amount || 0) + items.reduce((sum, i) => sum + Number(i.amount || 0), 0)
}

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
