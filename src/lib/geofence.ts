/**
 * Geofence geometry and the location verdict model.
 *
 * This module is the single source of truth for "is this staff member at the
 * place they are supposed to be?", and is deliberately pure — no Supabase, no
 * React — so the same rules can be unit-reasoned about and mirrored exactly by
 * the `attendance_location_verdict()` SQL function that the server write path
 * uses. If you change a rule here, change it there too.
 *
 * ── Why the old rule was wrong ────────────────────────────────────────────────
 * The previous check was `distance <= radius + min(accuracy, 75)`. It treated a
 * device's reported accuracy as a small bonus tolerance, capped at 75m so that a
 * wildly imprecise fix could not be used to pass from far away. That cap is what
 * blocked genuinely-present staff: a phone that falls back to Wi-Fi or cell
 * positioning reports accuracy in the hundreds of metres, and its reported point
 * can land several hundred metres from where the person is actually standing.
 * Capping the tolerance at 75m makes those fixes fail *even when the person is
 * stood in the middle of the campus*, because the error being compensated for is
 * far larger than the compensation allowed.
 *
 * ── The model used instead ────────────────────────────────────────────────────
 * A GPS reading is not a point. It is a disc: a centre, plus a radius
 * (`accuracy`) inside which the true position is expected to lie. So the honest
 * question is how that disc relates to the fence:
 *
 *   - The disc cannot reach the fence at all  → the person is genuinely elsewhere.
 *   - The disc overlaps the fence, and the disc is small enough to be worth
 *     trusting                                 → accept.
 *   - The disc overlaps the fence, but is so large that "overlaps" means almost
 *     nothing (a 900m disc overlaps half the town) → we genuinely do not know.
 *
 * That third case is the one the old code got wrong, because it had nowhere to
 * put "don't know" — it only had pass and fail, so it failed them. Here it is a
 * first-class verdict that routes to human review instead of silently punishing
 * someone for their phone's hardware.
 */

export type LatLng = { lat: number; lng: number }

/**
 * A verdict deliberately has three outcomes, not two.
 *
 * `uncertain` is not a failure mode — it is the honest answer whenever the
 * reading is too coarse to distinguish presence from absence, and it is what
 * gets routed to a coordinator rather than blocking the staff member.
 */
export type LocationVerdict = 'inside' | 'outside' | 'uncertain'

/** Why a verdict came out the way it did — drives the message the staff member sees. */
export type VerdictReason =
  /** The accuracy disc lies entirely within the fence. */
  | 'well_inside'
  /** The disc overlaps the fence and is precise enough to trust. */
  | 'overlaps_fence'
  /** The disc cannot reach the fence even at its most generous. */
  | 'disc_clear_of_fence'
  /** The disc overlaps, but is too coarse for the overlap to mean anything. */
  | 'accuracy_too_coarse'
  /** No usable fix was obtained at all. */
  | 'no_fix'

/**
 * Above this reported accuracy a fix is treated as too coarse to *accept* on its
 * own. Chosen because a phone with a working GNSS lock outdoors reports well
 * under 50m, and one that has fallen back to Wi-Fi/cell trilateration typically
 * reports 100m or more — so this sits at the boundary between "the satellites
 * answered" and "the phone guessed from the network".
 *
 * Note this only gates *acceptance*. A coarse fix can still produce a confident
 * `outside`, because a disc that cannot reach the campus at all proves absence
 * no matter how coarse it is.
 */
export const DEFAULT_TRUSTED_ACCURACY_M = 100

/**
 * Accuracy beyond which a fix is flagged as a coarse/approximate lock in the UI,
 * so the staff member can be told to switch precise location on rather than
 * being left to wonder why check-in keeps asking for review. iOS with "Precise
 * Location" disabled reports on the order of 1–3km.
 */
export const COARSE_LOCK_ACCURACY_M = 500

/**
 * Beyond this distance from the fence boundary, naming the exact metre count
 * in the confirmation prompt stops being useful information a staff member
 * could act on ("walk 40m closer") and just becomes a number. Past it the
 * prompt says "You are not on campus" instead of a distance.
 *
 * This affects only what the confirmation says, not what it decides — every
 * `outside` verdict is offered the same "mark anyway, flagged" choice
 * regardless of distance. See attendance_allow_off_campus_flagged.sql.
 */
export const FAR_OUTSIDE_CONFIRM_M = 1000

/** A fence is either a circle around a centre point, or a campus outline. */
export type Fence =
  | { kind: 'circle'; centre: LatLng; radiusM: number }
  | { kind: 'polygon'; vertices: LatLng[]; bufferM: number }

export interface GeofenceEvaluation {
  verdict: LocationVerdict
  reason: VerdictReason
  /**
   * Distance from the reading to the fence *boundary*, signed: negative when the
   * reading sits inside the fence, positive when outside. This is the quantity
   * the verdict rules are written against, because it behaves identically for a
   * circle and for a campus outline.
   */
  signedDistanceM: number
  /** Unsigned distance to the fence boundary — what gets shown to the user. */
  distanceM: number
  accuracyM: number
  /**
   * How much slack the verdict had, in metres. Positive when the accuracy disc
   * overlaps the fence (how far past the boundary the disc reaches), negative
   * when it falls short. Logged so the accuracy threshold can be tuned against
   * real attempt data rather than guesswork.
   */
  marginM: number
  /** True when the fix looks like a network/approximate lock rather than GNSS. */
  coarse: boolean
}

const EARTH_RADIUS_M = 6371000
const toRad = (deg: number) => (deg * Math.PI) / 180

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Projects a lat/lng to metres east/north of a reference point.
 *
 * A campus spans at most a few hundred metres, so a local equirectangular
 * projection is accurate to well under a metre at that scale — far below the GPS
 * error we are reasoning about — and it makes segment distance ordinary planar
 * geometry instead of spherical trigonometry.
 */
function toLocalMetres(p: LatLng, ref: LatLng): { x: number; y: number } {
  const midLat = toRad((p.lat + ref.lat) / 2)
  return {
    x: toRad(p.lng - ref.lng) * Math.cos(midLat) * EARTH_RADIUS_M,
    y: toRad(p.lat - ref.lat) * EARTH_RADIUS_M,
  }
}

function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  // Degenerate segment (duplicated vertex) — fall back to point distance.
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Ray-casting point-in-polygon on projected (planar) coordinates. */
function pointInPolygon(p: { x: number; y: number }, ring: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].y, xi = ring[i].x
    const yj = ring[j].y, xj = ring[j].x
    const straddles = yi > p.y !== yj > p.y
    if (straddles && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function polygonCentroid(vertices: LatLng[]): LatLng {
  const n = vertices.length || 1
  return {
    lat: vertices.reduce((s, v) => s + v.lat, 0) / n,
    lng: vertices.reduce((s, v) => s + v.lng, 0) / n,
  }
}

/**
 * Signed distance from a reading to the fence boundary — negative inside,
 * positive outside. Both fence shapes reduce to this one number, which is what
 * lets the verdict rules below stay shape-agnostic.
 */
export function signedDistanceToFence(point: LatLng, fence: Fence): number {
  if (fence.kind === 'circle') {
    return haversineDistance(point.lat, point.lng, fence.centre.lat, fence.centre.lng) - fence.radiusM
  }

  const ref = polygonCentroid(fence.vertices)
  const ring = fence.vertices.map(v => toLocalMetres(v, ref))
  const p = toLocalMetres(point, ref)

  let nearestEdge = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    nearestEdge = Math.min(nearestEdge, distanceToSegment(p, ring[j], ring[i]))
  }

  // The buffer widens the outline outward, so a campus outline traced along the
  // building walls still admits someone stood just outside the door.
  const signed = pointInPolygon(p, ring) ? -nearestEdge : nearestEdge
  return signed - fence.bufferM
}

/**
 * The verdict rules, in one place.
 *
 * Read `signed` as "how far past the fence boundary the reading sits" and
 * `accuracy` as "how far the true position could be from that reading". Then:
 *
 *   signed + accuracy <= 0   the disc is wholly inside      → inside, certainly
 *   signed - accuracy > 0    the disc cannot reach the fence → outside, certainly
 *   otherwise                the disc straddles the boundary → depends on how
 *                            much the disc is worth trusting
 *
 * Only the straddling case consults the accuracy threshold, and that is the
 * entire fix for the blocked-staff problem: a straddling *precise* fix is
 * accepted (as before, and slightly more generously), while a straddling
 * *coarse* fix is no longer failed — it is escalated.
 */
export function evaluateGeofence(
  point: LatLng,
  accuracyM: number,
  fence: Fence,
  trustedAccuracyM: number = DEFAULT_TRUSTED_ACCURACY_M,
): GeofenceEvaluation {
  const accuracy = Math.max(0, accuracyM || 0)
  const signed = signedDistanceToFence(point, fence)
  const margin = accuracy - signed
  const coarse = accuracy > COARSE_LOCK_ACCURACY_M

  const base = {
    signedDistanceM: Math.round(signed),
    distanceM: Math.round(Math.abs(signed)),
    accuracyM: Math.round(accuracy),
    marginM: Math.round(margin),
    coarse,
  }

  // The disc cannot reach the fence. True regardless of how coarse the fix is:
  // a 900m disc whose nearest edge is still 2km from campus proves absence just
  // as well as a 10m one would.
  if (signed > accuracy) {
    return { ...base, verdict: 'outside', reason: 'disc_clear_of_fence' }
  }

  // The disc lies wholly inside the fence — no threshold needed, the reading
  // cannot be consistent with the person being anywhere else.
  if (signed + accuracy <= 0) {
    return { ...base, verdict: 'inside', reason: 'well_inside' }
  }

  // Straddling. Trust it if the disc is tight enough to carry information.
  if (accuracy <= trustedAccuracyM) {
    return { ...base, verdict: 'inside', reason: 'overlaps_fence' }
  }

  // Straddling, but the disc is so large that overlapping the campus is nearly
  // unavoidable. This is the population that used to be rejected outright.
  return { ...base, verdict: 'uncertain', reason: 'accuracy_too_coarse' }
}

/** Builds the fence to check against from a stored config row. */
export function fenceFromConfig(config: {
  lat: number | null
  lng: number | null
  radius_m: number
  shape?: 'circle' | 'polygon' | null
  polygon?: LatLng[] | null
}): Fence | null {
  if (config.shape === 'polygon' && config.polygon && config.polygon.length >= 3) {
    return { kind: 'polygon', vertices: config.polygon, bufferM: config.radius_m }
  }
  if (config.lat == null || config.lng == null) return null
  return { kind: 'circle', centre: { lat: config.lat, lng: config.lng }, radiusM: config.radius_m }
}
