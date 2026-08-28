/**
 * Trip runs — the instance of a route on a date, and everything hanging off it.
 *
 * Nothing here computes state. Arrival, ETA, delay and progress are all decided
 * by the database (see supabase-migrations/transport_r2_b_derivation.sql); the
 * client reads the numbers it was given. The one thing the client is the
 * authority on is a raw sensor reading, which is why `pushFix` is the only
 * write that carries measurements.
 */

import { supabase } from '../supabase'
import type {
  TransportAlert, TransportBoardingEvent, TransportFix, TransportRun,
  TransportRunPassenger, TransportRunStop, TransportScanMethod,
} from './types'

const PROFILE_COLS = 'id, full_name, avatar_url'
const STUDENT_COLS = 'id, full_name, avatar_url, grade, section'

const RUN_SELECT = `*,
  route:transport_routes!route_id(id, name, code, color),
  vehicle:transport_vehicles!vehicle_id(id, registration_no, display_name, capacity),
  driver:profiles!driver_id(${PROFILE_COLS}),
  attendant:profiles!attendant_id(${PROFILE_COLS})`

/** Today in the school's local calendar, as `YYYY-MM-DD`. */
export function todayISO(): string {
  return new Date().toLocaleDateString('en-CA')
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function fetchRunsForDate(date = todayISO()): Promise<TransportRun[]> {
  const { data, error } = await supabase
    .from('transport_trip_runs')
    .select(RUN_SELECT)
    .eq('service_date', date)
    .order('scheduled_start_at', { ascending: true })
  if (error) { console.error('fetchRunsForDate failed:', error); return [] }
  return (data as unknown as TransportRun[]) || []
}

/** Runs the signed-in crew member is driving or attending today. */
export async function fetchMyRuns(date = todayISO()): Promise<TransportRun[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('transport_trip_runs')
    .select(RUN_SELECT)
    .eq('service_date', date)
    .or(`driver_id.eq.${user.id},attendant_id.eq.${user.id}`)
    .order('scheduled_start_at', { ascending: true })
  if (error) { console.error('fetchMyRuns failed:', error); return [] }
  return (data as unknown as TransportRun[]) || []
}

/**
 * Every run currently on the road — what the admin fleet map shows.
 *
 * `scheduled` is included so a bus that has not moved yet is visible as a
 * pending row rather than absent, which is the difference between "nothing is
 * wrong" and "we cannot see it".
 */
export async function fetchActiveRuns(): Promise<TransportRun[]> {
  const { data, error } = await supabase
    .from('transport_trip_runs')
    .select(RUN_SELECT)
    .eq('service_date', todayISO())
    .in('status', ['scheduled', 'boarding', 'in_progress'])
    .order('scheduled_start_at', { ascending: true })
  if (error) { console.error('fetchActiveRuns failed:', error); return [] }
  return (data as unknown as TransportRun[]) || []
}

export async function fetchRun(runId: string): Promise<TransportRun | null> {
  const { data, error } = await supabase
    .from('transport_trip_runs')
    .select(RUN_SELECT)
    .eq('id', runId)
    .maybeSingle()
  if (error) { console.error('fetchRun failed:', error); return null }
  return (data as unknown as TransportRun) ?? null
}

/** The run carrying this student today, if any. */
export async function fetchRunsForStudent(
  studentId: string,
  date = todayISO(),
): Promise<TransportRun[]> {
  const { data: rows, error } = await supabase
    .from('transport_run_passengers')
    .select('run_id')
    .eq('student_id', studentId)
  if (error) { console.error('fetchRunsForStudent failed:', error); return [] }
  const ids = (rows || []).map((r: { run_id: string }) => r.run_id)
  if (ids.length === 0) return []

  const { data, error: runErr } = await supabase
    .from('transport_trip_runs')
    .select(RUN_SELECT)
    .in('id', ids)
    .eq('service_date', date)
    .order('scheduled_start_at', { ascending: true })
  if (runErr) { console.error('fetchRunsForStudent runs failed:', runErr); return [] }
  return (data as unknown as TransportRun[]) || []
}

export async function fetchRunStops(runId: string): Promise<TransportRunStop[]> {
  const { data, error } = await supabase
    .from('transport_run_stops')
    .select('*, stop:transport_route_stops!stop_id(id, name, landmark, lat, lng, radius_m, kind)')
    .eq('run_id', runId)
    .order('seq', { ascending: true })
  if (error) { console.error('fetchRunStops failed:', error); return [] }
  return (data as unknown as TransportRunStop[]) || []
}

export async function fetchRunPassengers(runId: string): Promise<TransportRunPassenger[]> {
  const { data, error } = await supabase
    .from('transport_run_passengers')
    .select(`*, student:profiles!student_id(${STUDENT_COLS})`)
    .eq('run_id', runId)
  if (error) { console.error('fetchRunPassengers failed:', error); return [] }
  return ((data as unknown as TransportRunPassenger[]) || []).sort((a, b) =>
    (a.student?.full_name ?? '').localeCompare(b.student?.full_name ?? ''),
  )
}

export async function fetchOpenAlerts(): Promise<TransportAlert[]> {
  const { data, error } = await supabase
    .from('transport_alerts')
    .select(`*,
      route:transport_routes!route_id(id, name, code, color),
      student:profiles!student_id(${PROFILE_COLS})`)
    .in('status', ['open', 'acknowledged'])
    .order('severity', { ascending: false })
    .order('last_seen_at', { ascending: false })
  if (error) { console.error('fetchOpenAlerts failed:', error); return [] }
  return (data as unknown as TransportAlert[]) || []
}

/** Alerts a parent should see for their child's run. */
export async function fetchAlertsForRuns(runIds: string[]): Promise<TransportAlert[]> {
  if (runIds.length === 0) return []
  const { data, error } = await supabase
    .from('transport_alerts')
    .select('*')
    .in('run_id', runIds)
    .in('status', ['open', 'acknowledged'])
    .order('last_seen_at', { ascending: false })
  if (error) { console.error('fetchAlertsForRuns failed:', error); return [] }
  return (data as unknown as TransportAlert[]) || []
}

// ── Writes ──────────────────────────────────────────────────────────────────

export async function startRun(runId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('transport_start_run', { p_run: runId })
  if (error) { console.error('startRun failed:', error); return { success: false, error: error.message } }
  const res = data as { ok: boolean; error?: string }
  return res?.ok ? { success: true } : { success: false, error: res?.error ?? 'Could not start the trip' }
}

/**
 * End a run. The database refuses while anyone is still marked aboard, and the
 * refusal comes back as a message the driver can act on rather than a raw
 * constraint violation.
 */
export async function endRun(
  runId: string,
): Promise<{ success: boolean; error?: string; stillAboard?: number }> {
  const { data, error } = await supabase.rpc('transport_end_run', { p_run: runId })
  if (error) { console.error('endRun failed:', error); return { success: false, error: error.message } }
  const res = data as { ok: boolean; error?: string; still_aboard?: number }
  if (res?.ok) return { success: true }
  return { success: false, error: res?.error ?? 'Could not end the trip', stillAboard: res?.still_aboard }
}

export async function markBoarding(
  runId: string,
  studentId: string,
  event: TransportBoardingEvent,
  opts: { stopId?: string | null; method?: TransportScanMethod; note?: string } = {},
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('transport_mark_boarding', {
    p_run: runId,
    p_student: studentId,
    p_event: event,
    p_stop: opts.stopId ?? null,
    p_method: opts.method ?? 'manual',
    p_note: opts.note ?? null,
  })
  if (error) { console.error('markBoarding failed:', error); return { success: false, error: error.message } }
  const res = data as { ok: boolean; error?: string }
  return res?.ok ? { success: true } : { success: false, error: res?.error ?? 'Could not save' }
}

/**
 * Write one position fix.
 *
 * This is the driver-phone half of the telemetry contract; hardware arrives at
 * `/api/transport/ingest` in Round 3 and lands in the same table through the
 * same trigger. `recordedAt` is the device's clock, deliberately distinct from
 * the server's `received_at`, so a queue flushed after a dead zone replays as
 * correct history rather than as a jump.
 *
 * Duplicate rows are absorbed by the (run_id, reported_by, recorded_at) unique
 * index, which is what makes replaying an offline queue safe.
 */
export async function pushFix(fix: TransportFix): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not signed in' }

  const { error } = await supabase.from('transport_telemetry').insert({
    run_id: fix.runId,
    source: 'driver_app',
    reported_by: user.id,
    lat: fix.lat,
    lng: fix.lng,
    accuracy_m: fix.accuracyM ?? null,
    heading_deg: fix.headingDeg ?? null,
    speed_kmh: fix.speedKmh ?? null,
    recorded_at: fix.recordedAt,
  })
  if (error) {
    // 23505 is the dedupe index doing its job on a replayed fix, not a failure.
    if (error.code === '23505') return { success: true }
    console.error('pushFix failed:', error)
    return { success: false, error: error.message }
  }
  return { success: true }
}

export async function pushFixes(fixes: TransportFix[]): Promise<{ success: boolean; error?: string }> {
  if (fixes.length === 0) return { success: true }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not signed in' }

  const { error } = await supabase.from('transport_telemetry').upsert(
    fixes.map(f => ({
      run_id: f.runId,
      source: 'driver_app' as const,
      reported_by: user.id,
      lat: f.lat,
      lng: f.lng,
      accuracy_m: f.accuracyM ?? null,
      heading_deg: f.headingDeg ?? null,
      speed_kmh: f.speedKmh ?? null,
      recorded_at: f.recordedAt,
    })),
    { onConflict: 'run_id,reported_by,recorded_at', ignoreDuplicates: true },
  )
  if (error) { console.error('pushFixes failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function acknowledgeAlert(alertId: string): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('transport_alerts')
    .update({ status: 'acknowledged', acknowledged_by: user?.id ?? null, acknowledged_at: new Date().toISOString() })
    .eq('id', alertId)
  if (error) { console.error('acknowledgeAlert failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function resolveAlert(
  alertId: string,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('transport_alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolution_note: note ?? null })
    .eq('id', alertId)
  if (error) { console.error('resolveAlert failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Admin action: build the runs for a date that has none yet. */
export async function materialiseRuns(date: string): Promise<{ success: boolean; created?: number; error?: string }> {
  const { data, error } = await supabase.rpc('transport_materialise_runs', { p_date: date })
  if (error) { console.error('materialiseRuns failed:', error); return { success: false, error: error.message } }
  return { success: true, created: (data as number) ?? 0 }
}

// ── Presentation helpers ────────────────────────────────────────────────────

/** "in 6 min" / "now" / "2 min ago" — the phrasing a parent reads. */
export function relativeMinutes(iso: string | null | undefined): string | null {
  if (!iso) return null
  const diffMs = new Date(iso).getTime() - Date.now()
  const mins = Math.round(diffMs / 60000)
  if (Number.isNaN(mins)) return null
  if (mins <= 0 && mins > -1) return 'now'
  if (mins > 0) return `in ${mins} min`
  return `${Math.abs(mins)} min ago`
}

export function formatClock(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** How stale the last fix is, in seconds. */
export function fixAgeSeconds(run: Pick<TransportRun, 'last_fix_at'>): number | null {
  if (!run.last_fix_at) return null
  return Math.max(0, Math.round((Date.now() - new Date(run.last_fix_at).getTime()) / 1000))
}
