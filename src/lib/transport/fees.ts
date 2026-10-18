/**
 * Bus fees, priced from the route.
 *
 * Every route runs one way (to school or from school) and is priced one of two
 * ways, chosen on its Fees tab:
 *
 *   - by stop: each stop has a monthly price, and a rider pays their stop's;
 *   - by student: each rider has their own monthly amount
 *     (`transport_student_assignments.fee_amount`).
 *
 * Until a route's pricing is chosen its riders are not billed. A child on two
 * routes (to school on bus 2, home on bus 10) holds two assignments and gets
 * two bills, one per route per month. `bus_fees.billing_period` plus a partial
 * unique index stop the same month being billed twice
 * (see transport_r6_a_fee_grid.sql and transport_r6_b_route_direction_fee_mode.sql).
 */

import { supabase } from '../supabase'
import type { RouteFeeMode, TransportAssignment } from './types'

export interface StopFee {
  stop_id: string
  route_id: string
  amount: number | null
}

/** Where a rider's amount came from — or why there is none. */
export type FeeSource = 'stop' | 'student' | 'missing' | 'unset'

export interface ResolvedFee {
  amount: number | null
  source: FeeSource
  /** The stop the price was read from, in stop mode. */
  stopId: string | null
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function fetchStopFees(routeId?: string): Promise<Record<string, StopFee>> {
  let q = supabase.from('transport_stop_fees').select('stop_id, route_id, amount')
  if (routeId) q = q.eq('route_id', routeId)
  const { data, error } = await q
  if (error) { console.error('fetchStopFees failed:', error); return {} }
  const out: Record<string, StopFee> = {}
  for (const r of (data ?? []) as StopFee[]) out[r.stop_id] = { ...r, amount: num(r.amount) }
  return out
}

export async function saveStopFee(
  stopId: string,
  routeId: string,
  amount: number | null,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('transport_stop_fees')
    .upsert({
      stop_id: stopId,
      route_id: routeId,
      amount,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stop_id' })
  if (error) { console.error('saveStopFee failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

type FeeInputs = Pick<TransportAssignment, 'pickup_stop_id' | 'drop_stop_id' | 'fee_amount'>

/** The rider's own stop: where they board a to-school bus or leave a from-school one. */
export const riderStopId = (a: Pick<TransportAssignment, 'pickup_stop_id' | 'drop_stop_id'>) =>
  a.pickup_stop_id ?? a.drop_stop_id ?? null

/** What this rider owes per month on this route, and where the number came from. */
export function resolveRiderFee(
  a: FeeInputs,
  grid: Record<string, StopFee>,
  mode: RouteFeeMode | null | undefined,
): ResolvedFee {
  if (!mode) return { amount: null, source: 'unset', stopId: null }
  if (mode === 'student') {
    const v = num(a.fee_amount)
    return v == null ? { amount: null, source: 'missing', stopId: null } : { amount: v, source: 'student', stopId: null }
  }
  const stopId = riderStopId(a)
  const v = stopId ? grid[stopId]?.amount ?? null : null
  return v == null ? { amount: null, source: 'missing', stopId } : { amount: v, source: 'stop', stopId }
}

// ── Billing runs ────────────────────────────────────────────────────────────

export interface BillableRider {
  assignment_id: string
  route_id: string
  route_name: string
  student_id: string
  student_name: string
  fee: ResolvedFee
  /** A live bill for this route, child and month already exists. */
  alreadyBilled: boolean
}

interface AssignmentLite extends FeeInputs {
  id: string
  route_id: string
  student_id: string
  student: { full_name: string } | null
  route: { name: string; active: boolean; archived_at: string | null; fee_mode: RouteFeeMode | null } | null
}

/** `'2026-10'` → `'October 2026'`. */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

export function currentPeriod(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Everyone who would be billed for `period` on the given routes (all active
 * routes when omitted), with their resolved amount and whether they already
 * hold a bill for it.
 */
export async function previewBills(period: string, routeIds?: string[], yearId?: string | null): Promise<BillableRider[]> {
  let aq = supabase
    .from('transport_student_assignments')
    .select(`id, route_id, student_id, pickup_stop_id, drop_stop_id, fee_amount,
      student:profiles!student_id(full_name),
      route:transport_routes!route_id(name, active, archived_at, fee_mode)`)
    .is('ended_on', null)
  if (routeIds?.length) aq = aq.in('route_id', routeIds)
  if (yearId) aq = aq.eq('academic_year_id', yearId)

  let bq = supabase
    .from('bus_fees')
    .select('route_id, passenger_id')
    .eq('billing_period', period)
    .neq('status', 'cancelled')
  if (routeIds?.length) bq = bq.in('route_id', routeIds)

  const [{ data: rows, error }, grid, { data: billed }] = await Promise.all([aq, fetchStopFees(), bq])
  if (error) { console.error('previewBills failed:', error); return [] }

  const taken = new Set(((billed ?? []) as { route_id: string; passenger_id: string }[])
    .map(b => `${b.route_id}:${b.passenger_id}`))

  return ((rows ?? []) as unknown as AssignmentLite[])
    .filter(a => a.route && a.route.active && !a.route.archived_at)
    .map(a => ({
      assignment_id: a.id,
      route_id: a.route_id,
      route_name: a.route?.name ?? 'Route',
      student_id: a.student_id,
      student_name: a.student?.full_name ?? 'Unknown',
      fee: resolveRiderFee(a, grid, a.route?.fee_mode),
      alreadyBilled: taken.has(`${a.route_id}:${a.student_id}`),
    }))
    .sort((x, y) => x.route_name.localeCompare(y.route_name) || x.student_name.localeCompare(y.student_name))
}

// ── Month-wise position ─────────────────────────────────────────────────────

export interface MonthFeePosition {
  /** `YYYY-MM` */
  period: string
  billed: number
  collected: number
  outstanding: number
  bills: number
}

/** The twelve months of an academic year (`'2026-27'` → Apr 2026 … Mar 2027). */
export function academicMonths(yearCode: string): string[] {
  const start = Number(yearCode.slice(0, 4))
  return Array.from({ length: 12 }, (_, i) => {
    const m = (3 + i) % 12
    const y = start + (3 + i >= 12 ? 1 : 0)
    return `${y}-${String(m + 1).padStart(2, '0')}`
  })
}

/** January to December of a calendar year (`2026` → `2026-01` … `2026-12`). */
export function calendarMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

/**
 * Which calendar year the month-by-month chart shows for a session: this
 * year when the session reaches into it, else the year the session starts in
 * (so a past or planned session still shows its own months).
 */
export function chartYearFor(session: { starts_on: string; ends_on: string }, today = new Date()): number {
  const y = today.getFullYear()
  const startY = Number(session.starts_on.slice(0, 4))
  const endY = Number(session.ends_on.slice(0, 4))
  return y >= startY && y <= endY ? y : startY
}

/**
 * Billed / collected / outstanding per month, January to December of
 * `calendarYear`, counting only the bills of one academic session.
 *
 * Bus fees are fee-app bills now (transport_r6_c): each monthly transport
 * issue's bills carry the month on the issue and the session on the issue.
 * Older bills from the bus app's own ledger (bus_fees) carry their session
 * too (transport_r7) and are placed by their billing month, due date or
 * creation date, so history is not lost.
 */
export async function fetchMonthlyBusFees(
  session: { id: string },
  calendarYear: number,
): Promise<MonthFeePosition[]> {
  const months = calendarMonths(calendarYear)
  const out = new Map(months.map(p => [p, { period: p, billed: 0, collected: 0, outstanding: 0, bills: 0 }]))

  const [{ data: issues }, { data: legacy }, { data: pays }] = await Promise.all([
    supabase.from('fee_issues').select('id, bill_month')
      .eq('academic_year_id', session.id).eq('status', 'issued').eq('filters->>transport', 'true'),
    supabase.from('bus_fees').select('id, amount, status, billing_period, due_date, created_at')
      .eq('academic_year_id', session.id).neq('status', 'cancelled'),
    supabase.from('bus_payments').select('fee_id, amount')
      .eq('academic_year_id', session.id).eq('status', 'verified'),
  ])

  // Fee-app bills, only the issues whose month falls in the chart's year.
  const monthOf = new Map(((issues ?? []) as { id: string; bill_month: string }[])
    .map(i => [i.id, i.bill_month.slice(0, 7)] as const)
    .filter(([, m]) => out.has(m)))
  if (monthOf.size) {
    const { data: invoices, error } = await supabase
      .from('fee_invoices')
      .select('issue_id, net, paid, balance')
      .in('issue_id', [...monthOf.keys()])
      .neq('status', 'cancelled')
    if (error) console.error('fetchMonthlyBusFees(invoices) failed:', error)
    for (const i of (invoices ?? []) as { issue_id: string; net: unknown; paid: unknown; balance: unknown }[]) {
      const bucket = out.get(monthOf.get(i.issue_id) ?? '')
      if (!bucket) continue
      bucket.billed += Number(i.net) || 0
      bucket.collected += Number(i.paid) || 0
      bucket.outstanding += Math.max(0, Number(i.balance) || 0)
      bucket.bills += 1
    }
  }

  // The bus app's older ledger.
  const paid = new Map<string, number>()
  for (const p of (pays ?? []) as { fee_id: string; amount: unknown }[]) {
    paid.set(p.fee_id, (paid.get(p.fee_id) ?? 0) + (Number(p.amount) || 0))
  }
  for (const f of (legacy ?? []) as { id: string; amount: unknown; status: string; billing_period: string | null; due_date: string | null; created_at: string }[]) {
    const bucket = out.get(f.billing_period ?? (f.due_date ?? f.created_at).slice(0, 7))
    if (!bucket) continue
    const amt = Number(f.amount) || 0
    const got = f.status === 'paid' ? amt : Math.min(amt, paid.get(f.id) ?? 0)
    bucket.billed += amt
    bucket.collected += got
    bucket.outstanding += Math.max(0, amt - got)
    bucket.bills += 1
  }
  return months.map(p => out.get(p)!)
}
