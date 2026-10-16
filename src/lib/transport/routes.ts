/**
 * Routes — the thing a bus runs along.
 *
 * `transport_routes` is the renamed `bus_trips`. It was always route-shaped;
 * see the header of `supabase-migrations/transport_r1_foundation.sql` for why a
 * rename was safer than a replacement.
 */

import { supabase } from '../supabase'
import type { RouteInput, TransportDirection, TransportRoute } from './types'

const PROFILE_COLS = 'id, full_name, avatar_url, role'
const VEHICLE_COLS = 'id, registration_no, display_name, capacity'

// Never `select('*')` on an embedded profiles row: profiles is joined from ~50
// places and a wildcard there is the single biggest egress multiplier in the
// app (see the Development Conventions in README.md).
const ROUTE_SELECT = `*,
  default_vehicle:transport_vehicles!default_vehicle_id(${VEHICLE_COLS}),
  default_driver:profiles!default_driver_id(${PROFILE_COLS}),
  default_attendant:profiles!default_attendant_id(${PROFILE_COLS})`

export async function fetchRoutes(includeArchived = false): Promise<TransportRoute[]> {
  let q = supabase.from('transport_routes').select(ROUTE_SELECT).order('name', { ascending: true })
  if (!includeArchived) q = q.is('archived_at', null)
  const { data, error } = await q
  if (error) { console.error('fetchRoutes failed:', error); return [] }
  return (data as unknown as TransportRoute[]) || []
}

export async function fetchRoute(routeId: string): Promise<TransportRoute | null> {
  const { data, error } = await supabase
    .from('transport_routes')
    .select(ROUTE_SELECT)
    .eq('id', routeId)
    .single()
  if (error) { console.error('fetchRoute failed:', error); return null }
  return data as unknown as TransportRoute
}

export async function createRoute(
  input: RouteInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('transport_routes')
    .insert({ ...input, created_by: user?.id })
    .select('id')
    .single()
  if (error) {
    console.error('createRoute failed:', error)
    if (error.code === '23505') return { success: false, error: 'A route with that code already exists.' }
    return { success: false, error: error.message }
  }
  return { success: true, id: data.id }
}

export async function updateRoute(
  routeId: string,
  input: Partial<RouteInput> & { school_stop_id?: string | null },
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_routes').update(input).eq('id', routeId)
  if (error) {
    console.error('updateRoute failed:', error)
    if (error.code === '23505') return { success: false, error: 'A route with that code already exists.' }
    return { success: false, error: error.message }
  }
  if (input.direction) return syncDirection(routeId, input.direction)
  return { success: true }
}

/**
 * Bring a route's riders and schedule into line with its direction.
 *
 * Riders ride the route's one direction, and the route's schedule runs in it.
 * On a from-school route the rider's stop is where they get off, so the drop
 * stop mirrors the pickup stop (the trip builder reads the drop stop for that
 * direction; everything else reads the pickup stop as "their stop").
 */
async function syncDirection(
  routeId: string,
  direction: TransportDirection,
): Promise<{ success: boolean; error?: string }> {
  const inbound = direction === 'inbound'
  const { error: aErr } = await supabase
    .from('transport_student_assignments')
    .update({ rides_inbound: inbound, rides_outbound: !inbound })
    .eq('route_id', routeId)
    .is('ended_on', null)
  if (aErr) { console.error('syncDirection(assignments) failed:', aErr); return { success: false, error: aErr.message } }

  if (!inbound) {
    const { data } = await supabase
      .from('transport_student_assignments')
      .select('id, pickup_stop_id, drop_stop_id')
      .eq('route_id', routeId)
      .is('ended_on', null)
    const stale = ((data ?? []) as { id: string; pickup_stop_id: string | null; drop_stop_id: string | null }[])
      .filter(a => a.pickup_stop_id && a.drop_stop_id !== a.pickup_stop_id)
    await Promise.all(stale.map(a => supabase
      .from('transport_student_assignments')
      .update({ drop_stop_id: a.pickup_stop_id })
      .eq('id', a.id)))
  }

  const { error: sErr } = await supabase
    .from('transport_route_schedules')
    .update({ direction })
    .eq('route_id', routeId)
    .neq('direction', direction)
  if (sErr) { console.error('syncDirection(schedules) failed:', sErr); return { success: false, error: sErr.message } }
  return { success: true }
}

export async function setRouteActive(routeId: string, active: boolean) {
  return updateRoute(routeId, { active })
}

/**
 * Archive rather than delete.
 *
 * A route is referenced by issued fees and (from Round 2) by every historical
 * trip run, so deleting one would either fail or silently orphan a term's
 * billing. Archiving hides it from the pickers and leaves the history intact.
 */
export async function archiveRoute(routeId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('transport_routes')
    .update({ archived_at: new Date().toISOString(), active: false })
    .eq('id', routeId)
  if (error) { console.error('archiveRoute failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function restoreRoute(routeId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('transport_routes')
    .update({ archived_at: null, active: true })
    .eq('id', routeId)
  if (error) { console.error('restoreRoute failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/**
 * Stops and assigned students, per route, in one call.
 *
 * Previously two queries that each selected every row of a table so the browser
 * could call `.length` on the result — every stop in the school and every
 * active assignment, pulled across the wire to render two numbers in a list.
 * `transport_route_counts()` counts them where the rows already are.
 */
export interface RouteCounts {
  stops: Record<string, number>
  students: Record<string, number>
}

export async function fetchRouteCounts(): Promise<RouteCounts> {
  const { data, error } = await supabase.rpc('transport_route_counts')
  if (error) { console.error('fetchRouteCounts failed:', error); return { stops: {}, students: {} } }
  const stops: Record<string, number> = {}
  const students: Record<string, number> = {}
  for (const r of (data || []) as { route_id: string; stops: number; students: number }[]) {
    stops[r.route_id] = r.stops
    students[r.route_id] = r.students
  }
  return { stops, students }
}

/**
 * What the route search looks through besides the routes themselves: every
 * stop and every current rider, as a few short columns each. Small enough to
 * hold in memory (a school's whole network is a few hundred rows), and it lets
 * one box answer "which route is Ananya on?" as readily as "Route 7".
 */
export interface RouteSearchIndex {
  stops: { route_id: string; name: string; landmark: string | null }[]
  riders: { route_id: string; student_id: string; name: string; grade: number | null; section: string | null }[]
}

export async function fetchRouteSearchIndex(): Promise<RouteSearchIndex> {
  const [{ data: stops, error: sErr }, { data: riders, error: rErr }] = await Promise.all([
    supabase.from('transport_route_stops').select('route_id, name, landmark').eq('active', true),
    supabase
      .from('transport_student_assignments')
      .select('route_id, student_id, student:profiles!student_id(full_name, grade, section)')
      .is('ended_on', null),
  ])
  if (sErr) console.error('fetchRouteSearchIndex(stops) failed:', sErr)
  if (rErr) console.error('fetchRouteSearchIndex(riders) failed:', rErr)
  return {
    stops: (stops ?? []) as RouteSearchIndex['stops'],
    riders: ((riders ?? []) as unknown as { route_id: string; student_id: string; student: { full_name: string; grade: number | null; section: string | null } | null }[])
      .map(r => ({
        route_id: r.route_id,
        student_id: r.student_id,
        name: r.student?.full_name ?? 'Unknown',
        grade: r.student?.grade ?? null,
        section: r.student?.section ?? null,
      })),
  }
}
