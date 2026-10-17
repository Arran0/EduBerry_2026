/**
 * School-level transport settings: the map provider key and where the school is.
 *
 * Both live in `site_settings` (readable by every signed-in user, written by
 * admins), because both are needed wherever a transport map is drawn — the
 * admin fleet map and, later, the parents' live view.
 *
 * Map tiles, in order of preference:
 *   1. the school's own Mapbox public token, set in Configuration;
 *   2. the token this deployment ships with (NEXT_PUBLIC_MAPBOX_TOKEN) — the
 *      fallback we provide;
 *   3. OpenStreetMap's tiles, which need no key.
 * A Mapbox public token ("pk.…") is meant to sit in a browser, so storing it
 * in a readable setting is how Mapbox expects it to be used; a secret token
 * ("sk.…") is refused. Schools should URL-restrict their token to this site.
 *
 * School location, in order: the location set in Configuration, else the
 * first attendance geofence zone (the school's own fence), else none — and
 * the map asks for one.
 */

import { supabase } from '../supabase'
import { MAPBOX_TOKEN, OSM_TILES, mapboxTiles, type TileSource } from './mapTiles'

const MAP_KEY = 'transport_map'
const SCHOOL_KEY = 'transport_school_location'

export interface MapSettings {
  mapbox_token: string | null
  style: string
}

export interface SchoolLocation {
  lat: number
  lng: number
  label: string
  source: 'configured' | 'geofence'
}

export const MAP_STYLES: { key: string; label: string }[] = [
  { key: 'mapbox/streets-v12', label: 'Streets' },
  { key: 'mapbox/light-v11', label: 'Light' },
  { key: 'mapbox/outdoors-v12', label: 'Outdoors' },
  { key: 'mapbox/satellite-streets-v12', label: 'Satellite' },
]

let mapCache: Promise<MapSettings> | null = null
let schoolCache: Promise<SchoolLocation | null> | null = null

async function readSetting<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase.from('site_settings').select('value').eq('key', key).maybeSingle()
  if (error) { console.error(`read ${key} failed:`, error); return null }
  return (data?.value as T | undefined) ?? null
}

async function writeSetting(key: string, value: unknown): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key, value: value as Record<string, unknown> }, { onConflict: 'key' })
  if (error) { console.error(`write ${key} failed:`, error); return { success: false, error: error.message } }
  return { success: true }
}

// ── Map provider ────────────────────────────────────────────────────────────

export function fetchMapSettings(force = false): Promise<MapSettings> {
  if (!mapCache || force) {
    mapCache = readSetting<Partial<MapSettings>>(MAP_KEY).then(v => ({
      mapbox_token: v?.mapbox_token?.trim() || null,
      style: v?.style || MAP_STYLES[0].key,
    }))
  }
  return mapCache
}

export async function saveMapSettings(s: MapSettings): Promise<{ success: boolean; error?: string }> {
  const token = s.mapbox_token?.trim() || null
  if (token && token.startsWith('sk.')) {
    return { success: false, error: 'That is a secret token. Use a public token (it starts with “pk.”) — secret tokens must never be put in a web page.' }
  }
  if (token && !token.startsWith('pk.')) {
    return { success: false, error: 'A Mapbox public token starts with “pk.”.' }
  }
  const res = await writeSetting(MAP_KEY, { mapbox_token: token, style: s.style })
  if (res.success) mapCache = Promise.resolve({ mapbox_token: token, style: s.style })
  return res
}

/** Asks Mapbox whether a token can load the chosen style. */
export async function testMapboxToken(token: string, style = MAP_STYLES[0].key): Promise<{ ok: boolean; message: string }> {
  const t = token.trim()
  if (!t.startsWith('pk.')) return { ok: false, message: 'A Mapbox public token starts with “pk.”.' }
  try {
    const res = await fetch(`https://api.mapbox.com/styles/v1/${style}?access_token=${encodeURIComponent(t)}`)
    if (res.ok) return { ok: true, message: 'Mapbox accepted the token.' }
    if (res.status === 401) return { ok: false, message: 'Mapbox rejected the token — check it was copied in full.' }
    if (res.status === 403) return { ok: false, message: 'Mapbox refused this site. Add this site’s address to the token’s URL restrictions.' }
    return { ok: false, message: `Mapbox answered ${res.status}.` }
  } catch {
    return { ok: false, message: 'Could not reach Mapbox from this browser.' }
  }
}

export type TileOrigin = 'school' | 'provided' | 'osm'

/** The tiles to draw, and whose key they use. */
export function tilesFor(s: MapSettings | null): { tiles: TileSource; origin: TileOrigin } {
  if (s?.mapbox_token) return { tiles: mapboxTiles(s.mapbox_token, s.style), origin: 'school' }
  if (MAPBOX_TOKEN) return { tiles: mapboxTiles(MAPBOX_TOKEN, s?.style), origin: 'provided' }
  return { tiles: OSM_TILES, origin: 'osm' }
}

// ── School location ─────────────────────────────────────────────────────────

export function fetchSchoolLocation(force = false): Promise<SchoolLocation | null> {
  if (!schoolCache || force) {
    schoolCache = (async () => {
      const set = await readSetting<Partial<SchoolLocation>>(SCHOOL_KEY)
      if (set && Number.isFinite(set.lat) && Number.isFinite(set.lng)) {
        return { lat: Number(set.lat), lng: Number(set.lng), label: set.label || 'School', source: 'configured' as const }
      }
      const fence = await fetchGeofenceSchool()
      return fence
    })()
  }
  return schoolCache
}

/** The school's attendance geofence, if one has been drawn. */
export async function fetchGeofenceSchool(): Promise<SchoolLocation | null> {
  const { data, error } = await supabase
    .from('attendance_geofence_zones')
    .select('label, lat, lng')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  const z = data as { label: string | null; lat: number; lng: number }
  return { lat: Number(z.lat), lng: Number(z.lng), label: z.label || 'School', source: 'geofence' }
}

export async function saveSchoolLocation(loc: { lat: number; lng: number; label: string } | null): Promise<{ success: boolean; error?: string }> {
  const value = loc ? { lat: Number(loc.lat.toFixed(6)), lng: Number(loc.lng.toFixed(6)), label: loc.label.trim() || 'School' } : {}
  const res = await writeSetting(SCHOOL_KEY, value)
  if (res.success) schoolCache = null
  return res
}
