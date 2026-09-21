import { supabase } from '@/lib/supabase'

/**
 * Everything the operations screen shows above the fold, in one row.
 *
 * Live and Insights used to be two tabs and are now one page, which means one
 * screen wants fleet state, ridership, seat efficiency, GPS health and the fee
 * position at the same moment. Each is a scalar aggregate, so the database
 * computes all of them and sends back a single JSON object rather than the
 * browser issuing eight queries and counting rows itself.
 */
export interface TodaySnapshot {
  ok: boolean
  service_date: string
  runs_total: number
  runs_on_road: number
  runs_done: number
  runs_late: number
  /** Runs whose telemetry is actually live — the honest denominator. */
  runs_live: number
  runs_stale: number
  riders_expected: number
  riders_boarded: number
  riders_dropped: number
  riders_excused: number
  riders_no_show: number
  seats_capacity: number
  fees_billed: number
  fees_collected: number
  fees_outstanding: number
  fees_overdue: number
  gps_avg_coverage_pct: number | null
  gps_days: number
}

export async function fetchTodaySnapshot(): Promise<TodaySnapshot | null> {
  const { data, error } = await supabase.rpc('transport_today_snapshot')
  if (error) { console.error('fetchTodaySnapshot failed:', error); return null }
  const row = data as TodaySnapshot | null
  return row?.ok ? row : null
}

/**
 * Seats bought vs seats used, as a percentage.
 *
 * Returns null rather than 0 when there is no capacity to divide by: "0%
 * utilisation" and "we do not know the fleet's capacity" are different
 * statements and only one of them should ever be printed on a dashboard.
 */
export function seatEfficiency(s: TodaySnapshot): number | null {
  if (!s.seats_capacity) return null
  return Math.round((s.riders_boarded / s.seats_capacity) * 100)
}

/**
 * Riders who were expected and have not boarded, excluding approved leave.
 *
 * Excused children were never expected, so counting them here would make every
 * Monday morning look like a fleet-wide failure.
 */
export function unaccounted(s: TodaySnapshot): number {
  return Math.max(0, s.riders_expected - s.riders_boarded - s.riders_excused)
}
