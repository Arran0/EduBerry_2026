/**
 * Route stops, and the driven path between them.
 *
 * Stop geofence columns mirror `attendance_geofence_zones` exactly, so
 * `fenceFromConfig()` in src/lib/geofence.ts consumes a stop row unchanged and
 * Round 2's arrival detection can call the existing SQL
 * `attendance_location_verdict()` verbatim rather than forking rules that are
 * already paired between TypeScript and SQL.
 */

import { supabase } from '../supabase'
import { type Fence } from '../geofence'
// One implementation of the arc-length rule, and it lives beside the projection
// that reads the cached array back — the two have to agree to the metre.
import { cumulativeDistances } from './path'
import type { LatLng, StopInput, TransportDirection, TransportRoutePath, TransportStop } from './types'

export async function fetchStops(routeId: string): Promise<TransportStop[]> {
  const { data, error } = await supabase
    .from('transport_route_stops')
    .select('*')
    .eq('route_id', routeId)
    .order('seq', { ascending: true })
  if (error) { console.error('fetchStops failed:', error); return [] }
  return (data as TransportStop[]) || []
}

export async function createStop(
  input: StopInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data, error } = await supabase
    .from('transport_route_stops')
    .insert(input)
    .select('id')
    .single()
  if (error) { console.error('createStop failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

export async function updateStop(
  stopId: string,
  input: Partial<StopInput>,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_route_stops').update(input).eq('id', stopId)
  if (error) { console.error('updateStop failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function deleteStop(stopId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_route_stops').delete().eq('id', stopId)
  if (error) { console.error('deleteStop failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/**
 * Renumber a whole route's stops after a drag-reorder.
 *
 * `transport_route_stops_seq_uniq` is DEFERRABLE INITIALLY DEFERRED precisely
 * so this can write overlapping sequence numbers inside one transaction; the
 * constraint is checked once at commit. Supabase's REST client has no explicit
 * transaction, but an `upsert` of the whole set is a single statement, which is
 * enough — a per-row loop would collide on the first swap.
 */
export async function reorderStops(
  routeId: string,
  orderedStopIds: string[],
): Promise<{ success: boolean; error?: string }> {
  const existing = await fetchStops(routeId)
  const byId = new Map(existing.map(s => [s.id, s]))
  const rows = orderedStopIds.flatMap((id, i) => {
    const s = byId.get(id)
    if (!s) return []
    return [{ ...s, seq: i + 1 }]
  })
  if (rows.length === 0) return { success: true }
  const { error } = await supabase
    .from('transport_route_stops')
    .upsert(rows, { onConflict: 'id' })
  if (error) { console.error('reorderStops failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** The next free sequence number on a route. */
export function nextSeq(stops: TransportStop[]): number {
  return stops.reduce((max, s) => Math.max(max, s.seq), 0) + 1
}

/** A stop as a `Fence`, so the shared geofence evaluator can be used unchanged. */
export function fenceFromStop(stop: TransportStop): Fence {
  if (stop.shape === 'polygon' && stop.polygon?.length) {
    return { kind: 'polygon', vertices: stop.polygon, bufferM: stop.radius_m }
  }
  return { kind: 'circle', centre: { lat: stop.lat, lng: stop.lng }, radiusM: stop.radius_m }
}

// ── Path ────────────────────────────────────────────────────────────────────

export async function fetchRoutePaths(routeId: string): Promise<TransportRoutePath[]> {
  const { data, error } = await supabase
    .from('transport_route_paths')
    .select('*')
    .eq('route_id', routeId)
  if (error) { console.error('fetchRoutePaths failed:', error); return [] }
  return (data as TransportRoutePath[]) || []
}

export async function saveRoutePath(
  routeId: string,
  direction: TransportDirection,
  polyline: LatLng[],
  opts: { corridorM?: number; source?: TransportRoutePath['source'] } = {},
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const cumulative = cumulativeDistances(polyline)
  const { error } = await supabase.from('transport_route_paths').upsert(
    {
      route_id: routeId,
      direction,
      polyline,
      cumulative,
      length_m: cumulative[cumulative.length - 1] ?? 0,
      corridor_m: opts.corridorM ?? 150,
      source: opts.source ?? 'manual',
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'route_id,direction' },
  )
  if (error) { console.error('saveRoutePath failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/**
 * A straight-line path through the stops, in the given direction.
 *
 * A stand-in until someone draws the real road path or a run records one — it
 * is honest about being an approximation (`source: 'stops'`), which matters
 * because Round 2 uses the path for deviation detection and a corridor drawn
 * through buildings would flag every trip.
 */
export async function derivePathFromStops(
  routeId: string,
  direction: TransportDirection,
): Promise<{ success: boolean; error?: string }> {
  const stops = (await fetchStops(routeId)).filter(s => s.active)
  if (stops.length < 2) return { success: false, error: 'Add at least two stops first.' }
  const ordered = direction === 'inbound' ? stops : [...stops].reverse()
  return saveRoutePath(
    routeId,
    direction,
    ordered.map(s => ({ lat: s.lat, lng: s.lng })),
    { corridorM: 250, source: 'stops' },
  )
}
