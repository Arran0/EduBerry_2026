/**
 * Arc length along a route polyline.
 *
 * `transport_route_paths.cumulative` caches the prefix sums of a path's segment
 * lengths so the SQL derivation (`transport_point_to_path_m` in
 * supabase-migrations/transport_r2_b_derivation.sql) scans a stored array on
 * every fix instead of re-deriving every segment. This computes that array when
 * a path is saved, using the same `haversineDistance` the SQL half uses, so the
 * cached numbers and the numbers the database checks them against agree.
 *
 * This file used to carry a TypeScript `projectOntoPath` as well — the client
 * half of the projection. Nothing ever called it: the derivation trigger writes
 * `progress_m` and `off_route_m` onto the run row on every fix, so every screen
 * reads the authoritative number rather than recomputing an approximation of
 * it. A second implementation of geometry that nothing runs is not a spare, it
 * is a copy waiting to disagree.
 */

import { haversineDistance, type LatLng } from '../geofence'

/** Cumulative distance to each vertex: `[0, d1, d1+d2, ...]`, in metres. */
export function cumulativeDistances(polyline: LatLng[]): number[] {
  const out: number[] = [0]
  for (let i = 1; i < polyline.length; i++) {
    out.push(out[i - 1] + haversineDistance(
      polyline[i - 1].lat, polyline[i - 1].lng, polyline[i].lat, polyline[i].lng,
    ))
  }
  return out
}
