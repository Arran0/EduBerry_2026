/**
 * Distance to a route path, and progress along it.
 *
 * The TypeScript half of a paired implementation: the SQL half is
 * `transport_point_to_path_m` in
 * supabase-migrations/transport_r2_b_derivation.sql. Both use the same local
 * equirectangular projection, and this one imports `projectOnSegment` and
 * `toLocalMetres` from src/lib/geofence.ts rather than copying them, so there
 * is one fewer place for the rules to drift.
 *
 * Used client-side only for display — the authoritative numbers on a run row
 * are always the ones the database computed.
 */

import { haversineDistance, projectOnSegment, toLocalMetres, type LatLng } from '../geofence'

export interface PathProjection {
  /** Metres from the point to the nearest part of the path. */
  distanceM: number
  /** Index of the nearest segment (0-based, so `polyline[i] -> polyline[i+1]`). */
  segmentIndex: number
  /** Metres travelled along the path to the projected point. */
  progressM: number
}

/** Cumulative distance to each vertex: `[0, d1, d1+d2, ...]`. */
export function cumulativeDistances(polyline: LatLng[]): number[] {
  const out: number[] = [0]
  for (let i = 1; i < polyline.length; i++) {
    out.push(out[i - 1] + haversineDistance(
      polyline[i - 1].lat, polyline[i - 1].lng, polyline[i].lat, polyline[i].lng,
    ))
  }
  return out
}

export function projectOntoPath(
  point: LatLng,
  polyline: LatLng[],
  cumulative?: number[] | null,
): PathProjection | null {
  if (polyline.length < 2) return null

  const cum = cumulative && cumulative.length === polyline.length
    ? cumulative
    : cumulativeDistances(polyline)

  // One reference point for the whole path: a school route spans a few km, over
  // which the longitude scale factor is effectively constant.
  const ref = polyline[0]
  const p = toLocalMetres(point, ref)
  const projected = polyline.map(v => toLocalMetres(v, ref))

  let bestD = Infinity
  let bestI = 0
  let bestT = 0

  for (let i = 0; i < projected.length - 1; i++) {
    const { distance, t } = projectOnSegment(p, projected[i], projected[i + 1])
    if (distance < bestD) { bestD = distance; bestI = i; bestT = t }
  }

  const base = cum[bestI] ?? 0
  const segLen = (cum[bestI + 1] ?? base) - base

  return { distanceM: bestD, segmentIndex: bestI, progressM: base + bestT * segLen }
}

/** Metres still to travel along the path from `progressM` to a target point. */
export function remainingAlongPath(
  progressM: number,
  target: LatLng,
  polyline: LatLng[],
  cumulative?: number[] | null,
): number | null {
  const proj = projectOntoPath(target, polyline, cumulative)
  if (!proj) return null
  return Math.max(0, proj.progressM - progressM)
}
