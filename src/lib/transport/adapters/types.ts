import 'server-only'

/**
 * The normalized telemetry contract.
 *
 * One shape, whatever produced the fix. An adapter's whole job is to turn a
 * vendor's payload into this — including converting speed to km/h, which sounds
 * trivial and is the single most common way a fleet integration goes wrong: a
 * vendor reporting m/s silently makes every ETA out by a factor of 3.6.
 */
export interface IngestFix {
  /** IMEI or the vendor's own device id. Resolved to a source server-side. */
  externalId: string
  lat: number
  lng: number
  accuracyM?: number | null
  headingDeg?: number | null
  /** ALWAYS km/h. */
  speedKmh?: number | null
  altitudeM?: number | null
  satellites?: number | null
  ignition?: boolean | null
  odometerKm?: number | null
  batteryPct?: number | null
  /** Device clock, ISO-8601 UTC. */
  recordedAt: string
  raw?: unknown
}

export interface TelemetryAdapter {
  readonly slug: string
  /** Turn one webhook body into zero or more fixes. Never throws: a malformed
   *  payload returns an empty array so one bad device cannot wedge the stream. */
  parse(body: unknown): IngestFix[]
}

export function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

export function isoTime(v: unknown): string | null {
  if (typeof v === 'number') {
    // Vendors send both seconds and milliseconds since epoch.
    const ms = v > 1e12 ? v : v * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}
