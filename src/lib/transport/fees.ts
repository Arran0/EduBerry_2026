/**
 * Bus fees, priced from the route.
 *
 * Two inputs decide what a rider is billed for a trip (a route they are
 * assigned to):
 *
 *   1. A custom amount on their assignment (`fee_amount`) — wins outright.
 *   2. The route's fee grid — one row per stop, a round-trip amount and an
 *      optional one-way amount. Both ways → the round-trip rate of the dearer
 *      of their pickup and drop stops. One way → that direction's stop at the
 *      one-way rate, falling back to the round-trip rate.
 *
 * A child on two trips holds two assignments and so gets two bills, one per
 * route per month. `bus_fees.billing_period` plus a partial unique index stop
 * the same month being billed twice (see transport_r6_a_fee_grid.sql).
 */

import { supabase } from '../supabase'
import type { TransportAssignment } from './types'

export interface StopFee {
  stop_id: string
  route_id: string
  amount_round: number | null
  amount_one_way: number | null
}

export type FeeSource = 'custom' | 'grid' | 'missing'

export interface ResolvedFee {
  amount: number | null
  source: FeeSource
  /** Which grid column produced the amount, for the "why" read-out. */
  basis: 'round' | 'one_way' | null
  /** The stop the grid price was read from. */
  stopId: string | null
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function fetchStopFees(routeId?: string): Promise<Record<string, StopFee>> {
  let q = supabase.from('transport_stop_fees').select('stop_id, route_id, amount_round, amount_one_way')
  if (routeId) q = q.eq('route_id', routeId)
  const { data, error } = await q
  if (error) { console.error('fetchStopFees failed:', error); return {} }
  const out: Record<string, StopFee> = {}
  for (const r of (data ?? []) as StopFee[]) {
    out[r.stop_id] = { ...r, amount_round: num(r.amount_round), amount_one_way: num(r.amount_one_way) }
  }
  return out
}

export async function saveStopFee(
  stopId: string,
  routeId: string,
  amounts: { amount_round: number | null; amount_one_way: number | null },
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('transport_stop_fees')
    .upsert({
      stop_id: stopId,
      route_id: routeId,
      ...amounts,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stop_id' })
  if (error) { console.error('saveStopFee failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

type FeeInputs = Pick<TransportAssignment,
  'pickup_stop_id' | 'drop_stop_id' | 'rides_inbound' | 'rides_outbound' | 'fee_amount'>

/** What this rider owes for this trip per month, and where the number came from. */
export function resolveRiderFee(a: FeeInputs, grid: Record<string, StopFee>): ResolvedFee {
  const custom = num(a.fee_amount)
  if (custom != null) return { amount: custom, source: 'custom', basis: null, stopId: null }

  const pickup = a.pickup_stop_id
  const drop = a.drop_stop_id ?? a.pickup_stop_id
  const both = a.rides_inbound && a.rides_outbound

  if (both) {
    let best: { amount: number; stopId: string } | null = null
    for (const id of [pickup, drop]) {
      const v = id ? grid[id]?.amount_round ?? null : null
      if (id && v != null && (!best || v > best.amount)) best = { amount: v, stopId: id }
    }
    return best
      ? { amount: best.amount, source: 'grid', basis: 'round', stopId: best.stopId }
      : { amount: null, source: 'missing', basis: null, stopId: null }
  }

  const stopId = a.rides_inbound ? pickup : drop
  if (!stopId) return { amount: null, source: 'missing', basis: null, stopId: null }
  const row = grid[stopId]
  if (row?.amount_one_way != null) return { amount: row.amount_one_way, source: 'grid', basis: 'one_way', stopId }
  if (row?.amount_round != null) return { amount: row.amount_round, source: 'grid', basis: 'round', stopId }
  return { amount: null, source: 'missing', basis: null, stopId: null }
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
  route: { name: string; active: boolean; archived_at: string | null } | null
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
export async function previewBills(period: string, routeIds?: string[]): Promise<BillableRider[]> {
  let aq = supabase
    .from('transport_student_assignments')
    .select(`id, route_id, student_id, pickup_stop_id, drop_stop_id, rides_inbound, rides_outbound, fee_amount,
      student:profiles!student_id(full_name),
      route:transport_routes!route_id(name, active, archived_at)`)
    .is('ended_on', null)
  if (routeIds?.length) aq = aq.in('route_id', routeIds)

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
      fee: resolveRiderFee(a, grid),
      alreadyBilled: taken.has(`${a.route_id}:${a.student_id}`),
    }))
    .sort((x, y) => x.route_name.localeCompare(y.route_name) || x.student_name.localeCompare(y.student_name))
}

/**
 * Raise one bill per rider per trip for `period`. Riders already billed for the
 * month and riders without a price are skipped, never guessed at.
 */
export async function issueBills(
  riders: BillableRider[],
  opts: { period: string; dueDate: string | null; feeHeadId: string | null },
): Promise<{ success: boolean; issued: number; error?: string }> {
  const ready = riders.filter(r => !r.alreadyBilled && r.fee.amount != null && r.fee.amount > 0)
  if (ready.length === 0) return { success: true, issued: 0 }
  const { data: { user } } = await supabase.auth.getUser()
  const label = periodLabel(opts.period)
  const rows = ready.map(r => ({
    passenger_id: r.student_id,
    route_id: r.route_id,
    fee_head_id: opts.feeHeadId,
    amount: r.fee.amount as number,
    description: `Bus fee · ${r.route_name} · ${label}`,
    due_date: opts.dueDate,
    billing_period: opts.period,
    created_by: user?.id,
  }))
  const { error } = await supabase.from('bus_fees').insert(rows)
  if (error) {
    console.error('issueBills failed:', error)
    const dup = error.code === '23505'
    return {
      success: false,
      issued: 0,
      error: dup
        ? 'Some of these riders were billed for this month a moment ago. Refresh and try again.'
        : error.message,
    }
  }
  return { success: true, issued: rows.length }
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

/**
 * Billed / collected / outstanding per month across one academic year.
 *
 * A bill belongs to the month it was raised for (`billing_period`), falling back
 * to its due date and then its creation date for bills issued by hand.
 */
export async function fetchMonthlyBusFees(yearCode: string): Promise<MonthFeePosition[]> {
  const months = academicMonths(yearCode)
  const start = Number(yearCode.slice(0, 4))
  // A bill is raised around the month it is for. Reading from six months before
  // the year opens covers fees issued early by hand; the bucketing below is
  // exact, so over-fetching at the edges costs nothing but a few rows.
  const since = `${start - 1}-10-01`

  const [{ data: fees, error }, { data: pays }] = await Promise.all([
    supabase
      .from('bus_fees')
      .select('id, amount, status, billing_period, due_date, created_at')
      .neq('status', 'cancelled')
      .gte('created_at', since),
    supabase.from('bus_payments').select('fee_id, amount').eq('status', 'verified').gte('created_at', since),
  ])
  if (error) { console.error('fetchMonthlyBusFees failed:', error); return months.map(p => ({ period: p, billed: 0, collected: 0, outstanding: 0, bills: 0 })) }

  const paid = new Map<string, number>()
  for (const p of (pays ?? []) as { fee_id: string; amount: unknown }[]) {
    paid.set(p.fee_id, (paid.get(p.fee_id) ?? 0) + (Number(p.amount) || 0))
  }

  const out = new Map(months.map(p => [p, { period: p, billed: 0, collected: 0, outstanding: 0, bills: 0 }]))
  for (const f of (fees ?? []) as { id: string; amount: unknown; status: string; billing_period: string | null; due_date: string | null; created_at: string }[]) {
    if (f.status === 'cancelled') continue
    const key = f.billing_period ?? (f.due_date ?? f.created_at).slice(0, 7)
    const bucket = out.get(key)
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
