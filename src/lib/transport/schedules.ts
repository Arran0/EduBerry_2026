/**
 * Route schedules — when a route actually runs.
 *
 * A schedule supplies the anchor time; each stop carries its own offset in
 * minutes (`inbound_offset_min` / `outbound_offset_min`), so one stop list
 * serves an 07:10 and an 07:40 departure without being duplicated.
 */

import { supabase } from '../supabase'
import type {
  ScheduleInput,
  TransportDirection,
  TransportSchedule,
  TransportStop,
} from './types'
import { WEEKDAYS } from './types'

const PROFILE_COLS = 'id, full_name, avatar_url'
const SCHEDULE_SELECT = `*,
  vehicle:transport_vehicles!vehicle_id(id, registration_no, display_name),
  driver:profiles!driver_id(${PROFILE_COLS}),
  attendant:profiles!attendant_id(${PROFILE_COLS})`

export async function fetchSchedules(routeId: string): Promise<TransportSchedule[]> {
  const { data, error } = await supabase
    .from('transport_route_schedules')
    .select(SCHEDULE_SELECT)
    .eq('route_id', routeId)
    .order('direction', { ascending: true })
    .order('start_time', { ascending: true })
  if (error) { console.error('fetchSchedules failed:', error); return [] }
  return (data as unknown as TransportSchedule[]) || []
}

export async function createSchedule(
  input: ScheduleInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('transport_route_schedules')
    .insert({ ...input, created_by: user?.id })
    .select('id')
    .single()
  if (error) {
    console.error('createSchedule failed:', error)
    if (error.code === '23505') {
      return { success: false, error: 'This route already has a departure at that time in that direction.' }
    }
    return { success: false, error: error.message }
  }
  return { success: true, id: data.id }
}

export async function updateSchedule(
  scheduleId: string,
  input: Partial<ScheduleInput>,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_route_schedules').update(input).eq('id', scheduleId)
  if (error) {
    console.error('updateSchedule failed:', error)
    if (error.code === '23505') {
      return { success: false, error: 'This route already has a departure at that time in that direction.' }
    }
    return { success: false, error: error.message }
  }
  return { success: true }
}

export async function deleteSchedule(scheduleId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_route_schedules').delete().eq('id', scheduleId)
  if (error) { console.error('deleteSchedule failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** "Mon–Fri", "Mon, Wed, Fri", "Every day" — compact enough for a table cell. */
export function describeDays(days: number[]): string {
  if (!days?.length) return 'Never'
  const set = new Set(days)
  if (set.size === 7) return 'Every day'
  const ordered = WEEKDAYS.filter(d => set.has(d.value))
  // Collapse a contiguous run (in display order) into a range.
  const idx = ordered.map(d => WEEKDAYS.findIndex(w => w.value === d.value))
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
  if (contiguous && ordered.length > 2) return `${ordered[0].short}–${ordered[ordered.length - 1].short}`
  return ordered.map(d => d.short).join(', ')
}

/** "07:10" from a Postgres `time` value, which arrives as "07:10:00". */
export function formatTime(t: string | null | undefined): string {
  if (!t) return '—'
  const [h, m] = t.split(':')
  const hour = Number(h)
  if (Number.isNaN(hour)) return t
  const suffix = hour < 12 ? 'AM' : 'PM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${m} ${suffix}`
}

export interface StopTiming {
  stop: TransportStop
  /** Minutes past the schedule's anchor, or null when the stop has no offset yet. */
  offsetMin: number | null
  /** Wall-clock arrival, "07:24", or null when the offset is unset. */
  at: string | null
}

/**
 * Scheduled arrival at each stop for one schedule.
 *
 * Outbound runs the stop list in reverse, because `seq` is defined in the
 * to-school direction.
 */
export function stopTimings(schedule: TransportSchedule, stops: TransportStop[]): StopTiming[] {
  const active = stops.filter(s => s.active)
  const ordered = schedule.direction === 'inbound' ? active : [...active].reverse()
  const [h, m] = schedule.start_time.split(':').map(Number)
  const anchor = (h || 0) * 60 + (m || 0)
  return ordered.map(stop => {
    const offsetMin = schedule.direction === 'inbound' ? stop.inbound_offset_min : stop.outbound_offset_min
    if (offsetMin == null) return { stop, offsetMin: null, at: null }
    const total = ((anchor + offsetMin) % 1440 + 1440) % 1440
    const hh = String(Math.floor(total / 60)).padStart(2, '0')
    const mm = String(total % 60).padStart(2, '0')
    return { stop, offsetMin, at: `${hh}:${mm}` }
  })
}

/**
 * Spread offsets evenly across the stops of a direction.
 *
 * A starting point an admin then corrects, not a claim about traffic — the
 * first stop sits at the anchor and the last at `totalMinutes`.
 */
export function evenOffsets(stopCount: number, totalMinutes: number): number[] {
  if (stopCount <= 1) return [0]
  const step = totalMinutes / (stopCount - 1)
  return Array.from({ length: stopCount }, (_, i) => Math.round(i * step))
}

export async function applyEvenOffsets(
  routeId: string,
  direction: TransportDirection,
  totalMinutes: number,
): Promise<{ success: boolean; error?: string }> {
  const { data, error: readErr } = await supabase
    .from('transport_route_stops')
    .select('id, seq, active')
    .eq('route_id', routeId)
    .eq('active', true)
    .order('seq', { ascending: true })
  if (readErr) { console.error('applyEvenOffsets read failed:', readErr); return { success: false, error: readErr.message } }
  const stops = (data || []) as { id: string; seq: number }[]
  if (stops.length < 2) return { success: false, error: 'Add at least two stops first.' }

  const ordered = direction === 'inbound' ? stops : [...stops].reverse()
  const offsets = evenOffsets(ordered.length, totalMinutes)
  const column = direction === 'inbound' ? 'inbound_offset_min' : 'outbound_offset_min'

  const results = await Promise.all(
    ordered.map((s, i) =>
      supabase.from('transport_route_stops').update({ [column]: offsets[i] }).eq('id', s.id),
    ),
  )
  const failed = results.find(r => r.error)
  if (failed?.error) { console.error('applyEvenOffsets failed:', failed.error); return { success: false, error: failed.error.message } }
  return { success: true }
}
