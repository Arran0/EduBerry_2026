/**
 * Trip history and replay.
 *
 * A finished run is worth more than a live one to everybody except a parent
 * waiting at a gate: it is what an admin looks at when a complaint arrives on
 * Thursday about something that happened on Tuesday. The track comes from
 * `transport_replay_run`, which merges the 30-second archive with whatever of
 * the firehose has not been pruned yet, so a run from this morning replays at
 * full resolution and one from last month replays coarsely, without the caller
 * needing to know which.
 */

import { supabase } from '../supabase'
import type { LatLng, TransportBoardingEvent, TransportDirection, TransportRunStatus, TransportScanMethod } from './types'
import { todayISO } from './runs'

export interface ReplayPoint extends LatLng {
  at: string
  heading_deg: number | null
  speed_kmh: number | null
  /** 'live' is a full-resolution fix; 'archive' is a 30-second bucket. */
  res: 'live' | 'archive'
}

export interface ReplayStop {
  stop_id: string
  seq: number
  name: string
  lat: number
  lng: number
  radius_m: number
  scheduled_arrival_at: string | null
  arrived_at: string | null
  departed_at: string | null
  delay_seconds: number | null
  skipped: boolean
  arrival_verdict: string | null
  expected_boardings: number
  actual_boardings: number
}

export interface ReplayEvent {
  at: string
  kind: 'arrival' | 'departure' | 'skip'
  stop_id: string | null
  source: string
}

export interface ReplayBoarding {
  at: string
  student_id: string
  event: TransportBoardingEvent
  stop_id: string | null
  method: TransportScanMethod
}

export interface RunReplay {
  run: {
    id: string
    route_id: string
    direction: TransportDirection
    service_date: string
    status: TransportRunStatus
    started_at: string | null
    ended_at: string | null
    scheduled_start_at: string
    scheduled_end_at: string | null
    vehicle_id: string | null
    driver_id: string | null
    attendant_id: string | null
  }
  track: ReplayPoint[]
  stops: ReplayStop[]
  events: ReplayEvent[]
  boardings: ReplayBoarding[]
}

export async function fetchReplay(runId: string): Promise<RunReplay | null> {
  const { data, error } = await supabase.rpc('transport_replay_run', { p_run: runId })
  if (error) { console.error('fetchReplay failed:', error); return null }
  const res = data as ({ ok: true } & RunReplay) | { ok: false; error: string }
  if (!res?.ok) { console.error('fetchReplay refused:', (res as { error?: string })?.error); return null }
  return res
}

/** Finished runs, newest first — the history list the replay is opened from. */
export async function fetchRunHistory(
  opts: { from?: string; to?: string; routeId?: string | null; yearId?: string | null; limit?: number } = {},
): Promise<import('./types').TransportRun[]> {
  let q = supabase
    .from('transport_trip_runs')
    .select(`*,
      route:transport_routes!route_id(id, name, code, color),
      vehicle:transport_vehicles!vehicle_id(id, registration_no, display_name, capacity),
      driver:profiles!driver_id(id, full_name, avatar_url),
      attendant:profiles!attendant_id(id, full_name, avatar_url)`)
    // 'abandoned' is a finished run too — one the tick closed out because it sat
    // hours past its window. Leaving it out would hide exactly the trips a reviewer
    // most wants to find in History.
    .in('status', ['completed', 'cancelled', 'missed', 'abandoned'])
    .order('service_date', { ascending: false })
    .order('scheduled_start_at', { ascending: false })
    .limit(opts.limit ?? 60)

  if (opts.from) q = q.gte('service_date', opts.from)
  if (opts.to) q = q.lte('service_date', opts.to)
  if (opts.routeId) q = q.eq('route_id', opts.routeId)
  if (opts.yearId) q = q.eq('academic_year_id', opts.yearId)

  const { data, error } = await q
  if (error) { console.error('fetchRunHistory failed:', error); return [] }
  return (data as unknown as import('./types').TransportRun[]) || []
}

/**
 * The bus's position at an arbitrary instant, interpolated between fixes.
 *
 * A scrubber that snapped to the nearest stored fix would jump in 30-second
 * steps on an archived run, which reads as a stuttering bus rather than a
 * coarse recording. Interpolating is a small lie in the same direction the bus
 * was already travelling, and it is the one the eye expects.
 */
export function positionAt(track: ReplayPoint[], atMs: number): ReplayPoint | null {
  if (track.length === 0) return null
  if (atMs <= new Date(track[0].at).getTime()) return track[0]
  const last = track[track.length - 1]
  if (atMs >= new Date(last.at).getTime()) return last

  let lo = 0
  let hi = track.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (new Date(track[mid].at).getTime() <= atMs) lo = mid
    else hi = mid
  }

  const a = track[lo]
  const b = track[hi]
  const t0 = new Date(a.at).getTime()
  const t1 = new Date(b.at).getTime()
  const f = t1 === t0 ? 0 : (atMs - t0) / (t1 - t0)
  return {
    at: new Date(atMs).toISOString(),
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
    heading_deg: a.heading_deg,
    speed_kmh: a.speed_kmh,
    res: a.res,
  }
}

/** The window a scrubber spans: first fix to last, or the scheduled window. */
export function replayWindow(r: RunReplay): { startMs: number; endMs: number } {
  const first = r.track[0]?.at ?? r.run.started_at ?? r.run.scheduled_start_at
  const lastPoint = r.track[r.track.length - 1]?.at
  const last = lastPoint ?? r.run.ended_at ?? r.run.scheduled_end_at ?? first
  const startMs = new Date(first).getTime()
  const endMs = Math.max(new Date(last).getTime(), startMs + 60_000)
  return { startMs, endMs }
}

export { todayISO }
