/**
 * Routes — the thing a bus runs along.
 *
 * `transport_routes` is the renamed `bus_trips`. It was always route-shaped;
 * see the header of `supabase-migrations/transport_r1_foundation.sql` for why a
 * rename was safer than a replacement.
 */

import { supabase } from '../supabase'
import type { RouteInput, TransportRoute } from './types'

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
