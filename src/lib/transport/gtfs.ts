/**
 * GTFS export.
 *
 * Round 1 adopted GTFS's vocabulary on the argument that an export would later
 * be a view rather than a migration. This file is what that bought: the
 * database hands back arrays already shaped like GTFS records, and everything
 * here is CSV quoting and a ZIP.
 *
 * Why a school wants it: a municipal authority asking for the feed, a parent's
 * third-party map app, a safety audit, or simply the school's next vendor. An
 * open-format export is the difference between data the school owns and data
 * that happens to live in EdZee, and being able to hand it over on demand is a
 * better argument for staying than a lock-in would be.
 */

import { supabase } from '../supabase'
import { csvFile, makeZip, type ZipEntry } from '../zip'

export interface GtfsStatic {
  generated_at: string
  agency: Record<string, unknown>[]
  routes: Record<string, unknown>[]
  stops: Record<string, unknown>[]
  calendar: Record<string, unknown>[]
  calendar_dates: Record<string, unknown>[]
  trips: Record<string, unknown>[]
  stop_times: Record<string, unknown>[]
  shapes: { shape_id: string; points: { lat: number; lng: number }[] }[]
}

export async function fetchGtfsStatic(): Promise<GtfsStatic | null> {
  const { data, error } = await supabase.rpc('transport_gtfs_static')
  if (error) { console.error('fetchGtfsStatic failed:', error); return null }
  const res = data as ({ ok: true } & GtfsStatic) | { ok: false; error: string }
  if (!res?.ok) { console.error('fetchGtfsStatic refused:', (res as { error?: string })?.error); return null }
  return res
}

export async function fetchGtfsRealtime(): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc('transport_gtfs_realtime')
  if (error) { console.error('fetchGtfsRealtime failed:', error); return null }
  const res = data as { ok?: boolean; error?: string }
  if (!res?.ok) { console.error('fetchGtfsRealtime refused:', res?.error); return null }
  return res as Record<string, unknown>
}

/** The spec's column order per file. Consumers should not care; some do. */
const COLUMNS: Record<string, string[]> = {
  'agency.txt': ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
  'routes.txt': ['route_id', 'agency_id', 'route_short_name', 'route_long_name',
    'route_desc', 'route_type', 'route_color'],
  'stops.txt': ['stop_id', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon', 'location_type'],
  'calendar.txt': ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'saturday', 'sunday', 'start_date', 'end_date'],
  'calendar_dates.txt': ['service_id', 'date', 'exception_type'],
  'trips.txt': ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'shape_id'],
  'stop_times.txt': ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
  'shapes.txt': ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'],
}

/**
 * Turn the payload into the files of a feed.
 *
 * Two small reshapes the database deliberately did not do: `stop_lng` becomes
 * `stop_lon`, because GTFS spells it that way and the rest of this codebase
 * does not; and each shape's polyline is exploded into one row per point with
 * its sequence, which is a flattening that belongs where the CSV is written
 * rather than in a JSON payload.
 */
export function gtfsFiles(feed: GtfsStatic): ZipEntry[] {
  const stops = feed.stops.map(s => ({ ...s, stop_lon: s.stop_lng }))

  const shapePoints: Record<string, unknown>[] = []
  for (const shape of feed.shapes ?? []) {
    ;(shape.points ?? []).forEach((p, i) => {
      shapePoints.push({
        shape_id: shape.shape_id,
        shape_pt_lat: p.lat,
        shape_pt_lon: p.lng,
        shape_pt_sequence: i + 1,
      })
    })
  }

  const byFile: Record<string, Record<string, unknown>[]> = {
    'agency.txt': feed.agency,
    'routes.txt': feed.routes,
    'stops.txt': stops,
    'calendar.txt': feed.calendar,
    'calendar_dates.txt': feed.calendar_dates,
    'trips.txt': feed.trips,
    'stop_times.txt': feed.stop_times,
    'shapes.txt': shapePoints,
  }

  return Object.entries(byFile)
    // calendar_dates.txt and shapes.txt are optional; an empty one is noise
    // in a feed validator, so it is left out rather than shipped headers-only.
    .filter(([name, rows]) =>
      rows.length > 0 || !['calendar_dates.txt', 'shapes.txt'].includes(name))
    .map(([name, rows]) => ({ name, data: csvFile(COLUMNS[name], rows) }))
}

export function gtfsZip(feed: GtfsStatic): Blob {
  return makeZip(gtfsFiles(feed))
}

/** What a feed would contain, for showing before anybody downloads it. */
export function gtfsSummary(feed: GtfsStatic): { label: string; count: number }[] {
  return [
    { label: 'Routes', count: feed.routes.length },
    { label: 'Stops', count: feed.stops.length },
    { label: 'Services', count: feed.calendar.length },
    { label: 'Trips', count: feed.trips.length },
    { label: 'Stop times', count: feed.stop_times.length },
    { label: 'Holidays excluded', count: feed.calendar_dates.length },
  ]
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
