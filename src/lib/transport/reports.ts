/**
 * Transport reports.
 *
 * Every figure here comes from transport_run_metrics / transport_stop_metrics,
 * which the nightly rollup writes. Nothing on this screen aggregates live
 * tables, which is deliberate: a reports page that scans the roster is fine in
 * year one and is a thirty-second page load in year three.
 *
 * The consequence to be honest about in the UI: today is not in these numbers
 * until tomorrow's rollup. A report that silently mixed a complete yesterday
 * with a third of today would be worse than one that says where it stops.
 */

import { supabase } from '../supabase'

export interface OnTimeRow {
  route_id: string
  route_name: string
  direction: 'inbound' | 'outbound'
  runs: number
  stops_arrived: number
  stops_on_time: number
  on_time_pct: number | null
  avg_delay_seconds: number | null
  max_delay_seconds: number | null
}

export interface UtilisationRow {
  route_id: string
  route_name: string
  capacity: number | null
  avg_expected: number | null
  avg_boarded: number | null
  utilisation_pct: number | null
  no_show_pct: number | null
  /** Absolute rider counts across the window, not per-run averages. */
  total_boarded: number
  total_excused: number
  total_no_show: number
}

export interface StopDelayRow {
  stop_id: string
  stop_name: string
  route_id: string | null
  route_name: string | null
  direction: 'inbound' | 'outbound'
  arrivals: number
  on_time_pct: number | null
  avg_delay_seconds: number | null
  max_delay_seconds: number | null
}

export interface GpsHealthRow {
  vehicle_id: string
  registration_no: string
  display_name: string | null
  runs: number
  avg_coverage_pct: number | null
  worst_coverage_pct: number | null
  longest_gap_seconds: number | null
  total_fixes: number
}

export interface MismatchRow {
  service_date: string
  student_id: string
  student_name: string
  route_name: string | null
  boarding_state: string
  class_status: string
  /**
   * The guardian's number, resolved server-side exactly as the notification
   * path resolves it (assignment override -> guardian -> student). The report
   * exists to cause a phone call, and a name with no number leaves the one
   * person who can answer the question a search away.
   */
  guardian_phone: string | null
  whatsapp_opted_in: boolean
}

async function report<T>(fn: string, from: string, to: string): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, { p_from: from, p_to: to })
  if (error) { console.error(`${fn} failed:`, error); return [] }
  return (data as T[]) || []
}

export const fetchOnTimeReport = (from: string, to: string) =>
  report<OnTimeRow>('transport_report_ontime', from, to)

export const fetchUtilisationReport = (from: string, to: string) =>
  report<UtilisationRow>('transport_report_utilisation', from, to)

export const fetchStopDelayReport = (from: string, to: string) =>
  report<StopDelayRow>('transport_report_delay_by_stop', from, to)

export const fetchGpsHealthReport = (from: string, to: string) =>
  report<GpsHealthRow>('transport_report_gps_health', from, to)

/**
 * Boarded the bus, marked absent in class.
 *
 * The report a standalone tracker cannot produce, and the reason for building
 * transport inside the ERP rather than beside it. Leave is already excluded in
 * SQL, so a row here is a genuine "where did this child go?".
 */
export const fetchAttendanceMismatch = (from: string, to: string) =>
  report<MismatchRow>('transport_report_attendance_mismatch', from, to)

/** "4 min 20 s late" / "on time" / "2 min early" — the phrasing of a delay. */
export function formatDelay(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const abs = Math.abs(seconds)
  if (abs < 60) return seconds > 0 ? `${abs}s late` : abs === 0 ? 'on time' : `${abs}s early`
  const m = Math.floor(abs / 60)
  const s = abs % 60
  const body = s === 0 ? `${m} min` : `${m} min ${s}s`
  return seconds > 0 ? `${body} late` : `${body} early`
}

export function pct(value: number | null | undefined): string {
  return value == null ? '—' : `${value}%`
}

/**
 * The last N days, as the {from, to} every report takes.
 *
 * With a session, the window is kept inside it: it ends on the session's last
 * day when that has passed, and never reaches back before its first. So "last
 * 30 days" of a past session is that session's final month.
 */
export function windowOf(
  days: number,
  session?: { starts_on: string; ends_on: string } | null,
): { from: string; to: string } {
  const iso = (d: Date) => d.toLocaleDateString('en-CA')
  let to = iso(new Date())
  if (session && session.ends_on < to) to = session.ends_on
  let from = iso(new Date(new Date(`${to}T12:00:00`).getTime() - (days - 1) * 86_400_000))
  if (session && from < session.starts_on) from = session.starts_on
  return { from, to }
}

export const REPORT_WINDOWS: { days: number; label: string }[] = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
]
